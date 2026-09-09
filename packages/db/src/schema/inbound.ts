import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { INBOUND_STATUSES } from "@sendstack/shared";
import { contacts } from "./audience";
import { campaigns } from "./campaigns";

// Built from the shared tuple so the realtime schema and this enum cannot
// disagree about the list — see `packages/shared/src/enums.ts`.
export const inboundStatus = pgEnum("inbound_status", INBOUND_STATUSES);

/**
 * A message someone sent *to* us.
 *
 * Resend's `email.received` webhook carries metadata only — no body, no
 * headers, no attachments. So a row lands here with `contentFetchedAt` NULL,
 * a job pulls the full content from the Received Emails API, and only then is
 * the row complete. The UI has to tolerate that gap: a thread can exist for a
 * second or two before it has a body.
 */
export const inboundEmails = pgTable(
  "inbound_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Resend's id for the received email. Dedupes webhook replays. */
    providerEmailId: text("provider_email_id").notNull(),

    /** RFC 5322 headers we need for threading. */
    messageId: text("message_id"),
    inReplyTo: text("in_reply_to"),
    references: text("references").array().notNull().default(sql`'{}'::text[]`),
    /**
     * Stable grouping key: the root Message-ID of the conversation, falling
     * back to this message's own id. Computed in `deriveThreadKey()` rather
     * than by the database so the rule stays testable.
     */
    threadKey: text("thread_key").notNull(),

    fromEmail: text("from_email").notNull(),
    fromName: text("from_name"),
    toEmails: text("to_emails").array().notNull().default(sql`'{}'::text[]`),
    ccEmails: text("cc_emails").array().notNull().default(sql`'{}'::text[]`),
    subject: text("subject"),
    /** First ~200 chars of the text body, for the list column. */
    snippet: text("snippet"),

    html: text("html"),
    text: text("text"),
    headers: jsonb("headers"),
    hasAttachments: boolean("has_attachments").notNull().default(false),

    status: inboundStatus("status").notNull().default("unread"),
    /** Matched on `fromEmail` when the sender is already a known contact. */
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    /** Set when the message is a reply to one of our campaigns. */
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),

    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    contentFetchedAt: timestamp("content_fetched_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("inbound_emails_provider_key").on(t.providerEmailId),
    index("inbound_emails_thread_idx").on(t.threadKey, t.receivedAt),
    index("inbound_emails_status_idx").on(t.status, t.receivedAt),
    /**
     * Counting conversations per folder without sorting the table.
     *
     * A sidebar badge is `count(DISTINCT thread_key) WHERE status = …`, which
     * without this index is a full scan and a sort of every matching row on
     * every page load — fine at a hundred messages, several hundred
     * milliseconds at twenty thousand. Ordered by `(status, thread_key)` it
     * becomes an index-only group-aggregate that streams in order, which is
     * also what lets the count stop early once it has seen enough to say
     * "20k+".
     */
    index("inbound_emails_status_thread_idx").on(t.status, t.threadKey),
    index("inbound_emails_from_idx").on(t.fromEmail),
  ],
);

/**
 * Attachment *metadata*. Resend hands out temporary download URLs rather than
 * the bytes, so `downloadUrl` goes stale — check `urlExpiresAt` and re-fetch
 * from the Attachments API instead of trusting a stored link.
 */
export const inboundAttachments = pgTable(
  "inbound_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inboundEmailId: uuid("inbound_email_id")
      .notNull()
      .references(() => inboundEmails.id, { onDelete: "cascade" }),
    providerAttachmentId: text("provider_attachment_id").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type"),
    size: bigint("size", { mode: "number" }),
    downloadUrl: text("download_url"),
    urlExpiresAt: timestamp("url_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("inbound_attachments_email_idx").on(t.inboundEmailId),
    /**
     * The idempotency guarantee for hydration. A message is hydrated more than
     * once as a matter of course — the webhook-triggered job and the hourly
     * sync both pick up a row whose body has not landed yet — and the insert
     * in `inbound-store.ts` relies on `ON CONFLICT DO NOTHING` against this
     * index. Before it existed that clause had no target and was a no-op, so
     * every re-hydrate duplicated every attachment row.
     */
    uniqueIndex("inbound_attachments_email_provider_key").on(
      t.inboundEmailId,
      t.providerAttachmentId,
    ),
  ],
);

export const inboundEmailsRelations = relations(inboundEmails, ({ one, many }) => ({
  contact: one(contacts, { fields: [inboundEmails.contactId], references: [contacts.id] }),
  campaign: one(campaigns, { fields: [inboundEmails.campaignId], references: [campaigns.id] }),
  attachments: many(inboundAttachments),
}));

export const inboundAttachmentsRelations = relations(inboundAttachments, ({ one }) => ({
  email: one(inboundEmails, {
    fields: [inboundAttachments.inboundEmailId],
    references: [inboundEmails.id],
  }),
}));
