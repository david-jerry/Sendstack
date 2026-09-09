import { index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { campaignRecipients } from "./campaigns";

/**
 * Append-only log of every webhook Resend has ever sent us.
 *
 * `providerEventId` is the `svix-id` header. Resend guarantees *at-least-once*
 * delivery and retries on a 5s / 5m / 30m / 2h / 5h / 10h ladder, so the same
 * event will arrive twice sooner or later. The unique constraint is what makes
 * the handler idempotent: we insert first, and a conflict means "already
 * processed, stop here" — before any counter is incremented or any address is
 * suppressed. Double-counting opens is cosmetic; double-suppressing is not.
 */
export const emailEvents = pgTable(
  "email_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerEventId: text("provider_event_id").notNull(),
    /** e.g. "email.sent", "email.bounced", "email.received". */
    type: text("type").notNull(),
    providerMessageId: text("provider_message_id"),
    recipientId: uuid("recipient_id").references(() => campaignRecipients.id, {
      onDelete: "set null",
    }),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("email_events_provider_event_key").on(t.providerEventId),
    index("email_events_type_idx").on(t.type),
    index("email_events_message_idx").on(t.providerMessageId),
    index("email_events_received_at_idx").on(t.receivedAt),
  ],
);
