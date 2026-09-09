import type { WebhookEventPayload } from "resend";
import { getConfig } from "@sendstack/config";
import { DELIVERY_EVENT_NAMES, type DeliveryEventName } from "@sendstack/shared";
import { resendClient } from "./client";

/**
 * Webhook verification.
 *
 * Resend signs with Svix, and the SDK wraps the verification, so we do not
 * hand-roll HMAC here. `verify` throws on a bad or replayed signature —
 * treat any throw as a 400 and do not process the body.
 *
 * Two rules this file exists to enforce:
 *
 *  1. Verify against the *raw* request text. `await request.json()` then
 *     `JSON.stringify` re-serialises with different key order and whitespace,
 *     and the signature will never match. Always `await request.text()`.
 *  2. Never fall back to trusting an unverified body when the secret is
 *     missing. An unauthenticated webhook endpoint lets anyone forge a bounce
 *     and suppress a competitor's address on your instance.
 */
export class WebhookVerificationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WebhookVerificationError";
  }
}

/**
 * The boundary that makes an inbound payload worth acting on at all.
 *
 * Everything downstream of this call is written to tolerate a replay — the
 * unique index on `email_events.provider_event_id`, the monotonic status
 * transitions, the `ON CONFLICT` inserts — but none of that is a defence
 * against a *forged* delivery. Idempotency stops the same event being applied
 * twice; only the signature stops an event Resend never sent being applied
 * once. The two are easily confused, and the route's dedupe machinery looks
 * reassuring enough to invite it.
 *
 * A missing secret, a missing header and a failed signature therefore all
 * throw, and all throw the same type, so a route cannot end up handling two of
 * those three and falling through on the third. Every one of them is a 400 and
 * a body that is never parsed.
 *
 * The `webhook-*` header names are accepted beside the `svix-*` ones so that a
 * route never has to know which spelling the sender used.
 *
 * No unit test here, deliberately: the verification itself is the SDK's, so
 * the behaviour worth pinning is the route's answer to a bad signature, and
 * that test lives with the route.
 */
export async function verifyWebhook(
  rawBody: string,
  headers: Headers,
): Promise<WebhookEventPayload> {
  const { resend } = await getConfig();
  if (!resend.webhookSecret) {
    throw new WebhookVerificationError(
      "No Resend webhook secret is configured. Copy it from the webhook's page in the Resend " +
        "dashboard (it starts with `whsec_`) and paste it into Settings → Email.",
    );
  }

  // Resend's SDK takes the three Svix values, not a whole Headers object, so
  // pull them out here rather than at every call site.
  const id = headers.get("svix-id") ?? headers.get("webhook-id");
  const timestamp = headers.get("svix-timestamp") ?? headers.get("webhook-timestamp");
  const signature = headers.get("svix-signature") ?? headers.get("webhook-signature");

  if (!id || !timestamp || !signature) {
    throw new WebhookVerificationError(
      "Request is missing the svix-id / svix-timestamp / svix-signature headers.",
    );
  }

  try {
    const client = await resendClient();
    return client.webhooks.verify({
      payload: rawBody,
      headers: { id, timestamp, signature },
      webhookSecret: resend.webhookSecret,
    });
  } catch (cause) {
    throw new WebhookVerificationError("Webhook signature verification failed", { cause });
  }
}

/**
 * The unique id of this *delivery attempt*, from the Svix header. Resend
 * guarantees at-least-once delivery and retries on a 5s / 5m / 30m / 2h / 5h /
 * 10h ladder, so duplicates are expected rather than exceptional. This id is
 * stable across the retries of one event, which is exactly what makes it
 * usable as the dedupe key.
 */
export function webhookEventId(headers: Headers): string | null {
  return headers.get("svix-id") ?? headers.get("webhook-id");
}

/**
 * Delivery-state events that map onto a `campaign_recipients` row — the shared
 * vocabulary with Resend's `email.` prefix, so this list cannot drift from the
 * status map that consumes it.
 */
export type DeliveryEventType = `email.${DeliveryEventName}`;

const DELIVERY_EVENT_TYPES = new Set<string>(
  DELIVERY_EVENT_NAMES.map((name): DeliveryEventType => `email.${name}`),
);

export function isDeliveryEvent(
  event: WebhookEventPayload,
): event is Extract<WebhookEventPayload, { type: DeliveryEventType }> {
  return DELIVERY_EVENT_TYPES.has(event.type);
}

export function isInboundEvent(
  event: WebhookEventPayload,
): event is Extract<WebhookEventPayload, { type: "email.received" }> {
  return event.type === "email.received";
}

/**
 * Whether a bounce is permanent.
 *
 * A hard bounce means the mailbox does not exist — retrying it never succeeds
 * and every attempt damages the sending domain's reputation, so it suppresses
 * immediately. A soft bounce (full mailbox, greylisting, transient DNS) is
 * temporary and only suppresses after SOFT_BOUNCE_LIMIT consecutive failures.
 *
 * The check is deliberately loose about casing and wording because the
 * provider's bounce vocabulary is not a stable contract; anything that is not
 * recognisably transient is treated as permanent, which is the safe direction
 * to be wrong in.
 */
export function isHardBounce(bounce: { type?: string; subType?: string } | undefined): boolean {
  const type = (bounce?.type ?? "").toLowerCase();
  const subType = (bounce?.subType ?? "").toLowerCase();
  if (type.includes("transient") || subType.includes("transient")) return false;
  if (subType.includes("mailboxfull") || subType.includes("mailbox_full")) return false;
  return true;
}
