import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { OUTBOUND_STATUSES } from "@sendstack/shared";
import { user } from "./auth";
import { inboundEmails } from "./inbound";
import { bytea } from "./types";

/**
 * Per-conversation state, keyed by the same `thread_key` the messages carry.
 *
 * Separate from the messages because these are properties of the
 * *conversation*, not of any one email in it. Starring a thread and then
 * receiving a reply must not un-star it, and storing the flag on each message
 * would mean deciding which message's copy is authoritative.
 *
 * A row only exists once something has been set — the absence of a row is the
 * default state, so an inbox of ten thousand untouched threads costs nothing.
 */
export const threads = pgTable(
  "threads",
  {
    threadKey: text("thread_key").primaryKey(),
    starred: boolean("starred").notNull().default(false),
    /**
     * A muted thread stops marking itself unread when new mail arrives. It
     * still receives and stores everything — muting is about attention, not
     * delivery, and quietly dropping mail would be a different feature with
     * much worse failure modes.
     */
    muted: boolean("muted").notNull().default(false),
    /**
     * Hidden from the inbox until this passes, then returned to unread. NULL
     * means not snoozed; a past value is treated as expired rather than being
     * cleaned up eagerly, so a missed cron tick cannot lose a thread.
     */
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    assignedUserId: text("assigned_user_id").references(() => user.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("threads_starred_idx").on(t.starred),
    index("threads_snoozed_idx").on(t.snoozedUntil),
  ],
);

export const outboundStatus = pgEnum("outbound_status", OUTBOUND_STATUSES);

/**
 * Mail this instance sent from the inbox: replies, forwards, and the drafts
 * that have not gone yet.
 *
 * Its absence was a real hole — a reply was handed to Resend and then existed
 * nowhere, so the conversation it belonged to showed only one side of itself
 * and "Sent" had nothing to list.
 *
 * A draft is the same row with `status = 'draft'`, which is why Drafts and
 * Sent are one table. The alternative — a separate drafts table — duplicates
 * every column and then needs a hand-off between the two at the exact moment
 * something is most likely to go wrong.
 *
 * Kept apart from `inbound_emails` rather than merged into one `messages`
 * table: the two have genuinely different shapes (a received message has a
 * provider id and headers we did not write; a sent one has a status and an
 * error). The thread view unions them.
 */
export const outboundMessages = pgTable(
  "outbound_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Ties this into the conversation, alongside the inbound messages. */
    threadKey: text("thread_key").notNull(),
    /** The message being replied to or forwarded, when there is one. */
    inReplyToId: uuid("in_reply_to_id").references(() => inboundEmails.id, {
      onDelete: "set null",
    }),
    /** The `Message-ID` of the parent, for the outgoing headers. */
    inReplyToMessageId: text("in_reply_to_message_id"),
    references: text("references").array().notNull().default(sql`'{}'::text[]`),

    kind: text("kind").notNull().default("reply"),

    fromEmail: text("from_email").notNull(),
    fromName: text("from_name"),
    toEmails: text("to_emails").array().notNull().default(sql`'{}'::text[]`),
    ccEmails: text("cc_emails").array().notNull().default(sql`'{}'::text[]`),
    /**
     * Blind copies. Kept on our own record even though they are, by
     * definition, absent from the message the recipients receive — a draft
     * that silently loses its Bcc list between saves would send to the wrong
     * set of people, and a sent record that omits it cannot answer "who
     * actually got this?".
     */
    bccEmails: text("bcc_emails").array().notNull().default(sql`'{}'::text[]`),
    subject: text("subject"),
    html: text("html"),
    text: text("text"),

    status: outboundStatus("status").notNull().default("draft"),
    /** Resend's id, once it has accepted the message. */
    providerMessageId: text("provider_message_id"),
    /**
     * The browser's own id for a send it queued while offline.
     *
     * The provider idempotency key used to be derived from the draft row's id,
     * which the *server* mints — so a queued send with no draft yet minted a
     * new row and a new key on every replay, and a reply the worker did not
     * hear back about went out twice. The client generates this once when it
     * queues the request; the unique index below and the provider key derived
     * from it make every replay collapse onto the first attempt.
     */
    clientKey: text("client_key"),
    /**
     * The provider's most recent delivery event — `delivered`, `opened`,
     * `bounced` and so on.
     *
     * Distinct from `status`, which is this app's own lifecycle (draft →
     * queued → sent). A message can be `sent` from our side and `bounced`
     * from the recipient's, and collapsing the two would lose exactly the
     * half that matters for tracking.
     *
     * Delivery webhooks keep this current; the reconciler fills it in when no
     * webhook ever arrived.
     */
    /**
     * The provider's own name for the last thing that happened, **bare**.
     *
     * `delivered`, never `email.delivered`. Two writers feed this column and
     * they receive different dialects — the webhook gets Resend's prefixed
     * event payload, the Sync reconciler gets `emails.list()`'s unprefixed one
     * — and it used to store whichever arrived last. Every reader then had to
     * strip a prefix that might not be there, which is three copies of one
     * rule, and one of those copies broke in the browser: a client component
     * called `bareEvent`, Turbopack resolved the import to a module fragment
     * where the function was undefined, and every thread view threw.
     *
     * `outbound_last_event_bare` below is what makes the read side able to
     * trust this. Normalisation happens at each writer's ingestion boundary;
     * the constraint is there so a fourth writer fails loudly instead of
     * quietly reintroducing the drift.
     */
    lastEvent: text("last_event"),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    error: text("error"),

    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("outbound_thread_idx").on(t.threadKey, t.createdAt),
    index("outbound_status_idx").on(t.status, t.updatedAt),
    /**
     * The folder lists order by `COALESCE(sent_at, updated_at)` with `id` as
     * the tiebreaker, filtered by status — a sort no other index here serves.
     *
     * Measured with `EXPLAIN`, and the result is worth writing down: for a
     * *single* status this index satisfies the ordering outright, with no
     * Sort node, which is what Drafts (`status = 'draft'`) does. Sent filters
     * `status IN ('sent','queued','failed')`, and no btree index can provide a
     * global order across three leading-column values — Postgres index-scans
     * on status and sorts the result. That is inherent to the query shape
     * rather than a defect here, and it is bounded by the page's `LIMIT`.
     */
    index("outbound_status_activity_idx").on(
      t.status,
      sql`(COALESCE(${t.sentAt}, ${t.updatedAt})) DESC`,
      sql`${t.id} DESC`,
    ),
    /**
     * One row per client key: the arbiter for every idempotent send.
     *
     * Nullable, and a *plain* unique index rather than a partial one — the
     * comment here used to say "unique only where set", which describes its
     * sibling `outbound_provider_key` and not this. The behaviour is the same
     * either way, because Postgres treats NULLs as distinct and so permits any
     * number of keyless rows; a partial index would only be smaller on disk,
     * since most rows have no key. Not worth a migration, worth not lying
     * about.
     */
    uniqueIndex("outbound_client_key_key").on(t.clientKey),
    /**
     * Enforced in the schema rather than trusted from the writers, per §7.
     *
     * `NULL NOT LIKE 'email.%'` is `NULL`, which satisfies a CHECK, so the
     * many rows with no event yet are unaffected. Migration `0019` rewrites
     * the rows written before the rule existed.
     *
     * `email_events.type` deliberately keeps the prefixed form and must not
     * gain this constraint: that table is the verbatim record of what the
     * provider sent, and nothing reads it for logic.
     */
    check("outbound_last_event_bare", sql`${t.lastEvent} NOT LIKE 'email.%'`),
    /**
     * Delivery webhooks arrive keyed by the provider's id, not ours, and one
     * provider id means one row.
     *
     * Two jobs at once: without an index, every `email.delivered` on a one-off
     * reply is a full scan of the sent table, once per event, and Resend sends
     * several per message. And without *uniqueness*, the sent-mail
     * reconciler's `ON CONFLICT DO NOTHING` had no arbiter it could use — the
     * only unique constraint was the primary key, which that insert never
     * supplies, so the clause was dead. Pressing Sync twice, or pressing it
     * while the hourly cron runs, imported the same message twice; the
     * webhook's `UPDATE … WHERE provider_message_id = $1` then updated every
     * copy and its `RETURNING` picked one arbitrarily.
     *
     * Partial, because a draft has no provider id and there may be many of
     * them: in Postgres several NULLs do not collide in a plain unique index,
     * but stating the predicate makes the intent explicit and keeps the index
     * off rows that can never be looked up by it.
     */
    uniqueIndex("outbound_provider_key")
      .on(t.providerMessageId)
      .where(sql`${t.providerMessageId} IS NOT NULL`),
  ],
);

export const attachmentDisposition = pgEnum("attachment_disposition", ["attachment", "inline"]);

/**
 * Files carried by a message this instance sends.
 *
 * The bytes live in Postgres rather than in object storage, for the same
 * reason the logo does: a self-hosted install should need a database and
 * nothing else. Cloudinary is an optimisation for images that are fetched by
 * thousands of mailboxes; an attachment is read twice — once to send it, once
 * if someone opens the sent copy — so the extra dependency would buy nothing.
 *
 * `disposition` separates the two things a file can be:
 *
 *  - `attachment` — sent to the provider as a real MIME attachment.
 *  - `inline`     — an image dropped into the body, referenced by URL. It is
 *                   never sent as an attachment; the recipient's client fetches
 *                   it, exactly as it fetches the logo.
 *
 * Rows cascade with the message, so discarding a draft takes its uploads with
 * it and cannot leave orphaned blobs behind.
 */
export const outboundAttachments = pgTable(
  "outbound_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => outboundMessages.id, { onDelete: "cascade" }),
    disposition: attachmentDisposition("disposition").notNull().default("attachment"),
    filename: text("filename").notNull(),
    contentType: text("content_type"),
    byteSize: integer("byte_size").notNull(),
    bytes: bytea("bytes").notNull(),
    /**
     * Content hash, used as the `?v=` on the inline URL. Mail clients cache
     * images aggressively, and replacing one without a changing URL leaves the
     * old image in every inbox that already fetched it.
     */
    checksum: text("checksum").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("outbound_attachments_message_idx").on(t.messageId)],
);

export const outboundMessagesRelations = relations(outboundMessages, ({ many }) => ({
  attachments: many(outboundAttachments),
}));

export const outboundAttachmentsRelations = relations(outboundAttachments, ({ one }) => ({
  message: one(outboundMessages, {
    fields: [outboundAttachments.messageId],
    references: [outboundMessages.id],
  }),
}));
