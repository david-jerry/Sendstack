import { z } from "zod";
import { ACCOUNT_EVENT_TYPES } from "./account-events";
import { DELIVERY_EVENT_NAMES } from "./delivery-status";
import { INBOUND_STATUSES } from "./enums";

/**
 * The realtime contract, shared by the publisher (webhook handler, Inngest
 * jobs) and the consumer (the browser store). It is parsed on both sides:
 * anything arriving on the channel that does not match is dropped rather than
 * trusted, because a stale deploy publishing an old shape must not be able to
 * corrupt a newer client's state.
 */

export const realtimeEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("inbound.received"),
    at: z.string(),
    emailId: z.string(),
    threadKey: z.string(),
    fromEmail: z.string(),
    fromName: z.string().nullable(),
    subject: z.string().nullable(),
    snippet: z.string().nullable(),
  }),
  z.object({
    type: z.literal("inbound.updated"),
    at: z.string(),
    emailId: z.string(),
    // The database's list, not a copy of it: this omitted `trash` for two
    // migrations and a trashed thread had to be published as `archived`.
    status: z.enum(INBOUND_STATUSES),
    unreadDelta: z.number().int().optional(),
  }),
  /**
   * A message *we* sent moved on — delivered, bounced, opened, complained.
   *
   * Distinct from `campaign.progress`, which aggregates thousands of
   * recipients into a counter. This is one message in one conversation, and
   * the thread showing it needs to update rather than a progress bar.
   */
  z.object({
    type: z.literal("outbound.updated"),
    at: z.string(),
    messageId: z.string(),
    threadKey: z.string().nullable(),
    /**
     * Resend's event name, minus the `email.` prefix.
     *
     * The list itself lives in `delivery-status.ts`, which is where the
     * meaning of each event is defined. It was written out here as well, and
     * a third time in the webhook route — three copies of one vocabulary,
     * which is how the route came to drop `delivery_delayed`.
     */
    event: z.enum(DELIVERY_EVENT_NAMES),
    /** Present on a bounce or failure, which is when it matters. */
    detail: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal("campaign.progress"),
    at: z.string(),
    campaignId: z.string(),
    status: z.string(),
    sentCount: z.number(),
    totalRecipients: z.number(),
  }),
  z.object({
    type: z.literal("suppression.added"),
    at: z.string(),
    email: z.string(),
    reason: z.string(),
  }),
  /**
   * Something changed in the Resend account itself — a sending domain, a
   * contact in Resend's audience, an entry on Resend's suppression list.
   *
   * Carries its own rendered `summary` rather than the raw payload, so the
   * browser does not hold a second copy of the wording. The same describer
   * produced the entries the Activity bell was server-rendered with, which is
   * what lets a live event and a reloaded one be compared and deduped.
   */
  z.object({
    type: z.literal("account.activity"),
    at: z.string(),
    /**
     * The `svix-id`, which is also the `provider_event_id` of the row in
     * `email_events`.
     *
     * Consumers dedupe on it. Necessary rather than convenient: the bell is
     * seeded from Postgres on every layout render *and* fed by SSE, so the
     * same event legitimately arrives twice by two routes, and Resend's retry
     * ladder can deliver the same event again hours later.
     */
    eventId: z.string(),
    kind: z.enum(ACCOUNT_EVENT_TYPES),
    subject: z.string(),
    summary: z.string(),
    href: z.string().nullable(),
    /** Only ever set for `suppression.added`. See `AccountActivity.origin`. */
    origin: z.string().nullable(),
  }),
]);

export type RealtimeEvent = z.infer<typeof realtimeEventSchema>;
export type RealtimeEventType = RealtimeEvent["type"];

/** Parse a raw pub/sub payload, returning null instead of throwing. */
export function parseRealtimeEvent(raw: unknown): RealtimeEvent | null {
  const candidate = typeof raw === "string" ? safeJson(raw) : raw;
  const result = realtimeEventSchema.safeParse(candidate);
  return result.success ? result.data : null;
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
