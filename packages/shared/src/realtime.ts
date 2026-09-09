import { z } from "zod";
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
