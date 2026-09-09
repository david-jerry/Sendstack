/**
 * The status vocabularies, declared once.
 *
 * Each of these is a Postgres enum in `packages/db`, and each was also spelled
 * out again wherever a Zod schema or a TypeScript union needed it — which is
 * how the realtime contract came to lack `trash` two migrations after the
 * database gained it, and how a trashed thread was published as `archived`
 * to paper over the gap. The database builds its `pgEnum` from these tuples
 * and the schemas build their `z.enum` from them, so the three cannot drift.
 *
 * Order matters and is not decorative: Postgres stores an enum by ordinal, so
 * each tuple is in the order the migrations created the values, with later
 * `ADD VALUE`s appended. drizzle-kit diffs the list against the snapshot and
 * a reordering here would generate a migration that reorders nothing.
 */

/** `inbound_status` — 0000_init, `trash` added in 0005. */
export const INBOUND_STATUSES = ["unread", "read", "archived", "spam", "trash"] as const;
export type InboundStatus = (typeof INBOUND_STATUSES)[number];

/** `suppression_reason` — 0000_init. */
export const SUPPRESSION_REASONS = [
  "hard_bounce",
  "soft_bounce_limit",
  "complaint",
  "unsubscribe",
  "manual",
  "invalid_address",
] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

/** `outbound_status` — 0005_threads_and_outbound. */
export const OUTBOUND_STATUSES = ["draft", "queued", "sent", "failed"] as const;
export type OutboundStatus = (typeof OUTBOUND_STATUSES)[number];

/** `campaign_status` — 0000_init. */
export const CAMPAIGN_STATUSES = [
  "draft",
  "scheduled",
  "sending",
  "paused",
  "sent",
  "failed",
  "cancelled",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** `recipient_status` — 0000_init. */
export const RECIPIENT_STATUSES = [
  "pending",
  "sending",
  "sent",
  "delivered",
  "opened",
  "clicked",
  "bounced",
  "complained",
  "failed",
  "suppressed",
  "cancelled",
] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

/** `contact_status` — 0000_init. */
export const CONTACT_STATUSES = ["active", "unsubscribed", "bounced", "complained"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];
