import { relations } from "drizzle-orm";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { CAMPAIGN_STATUSES, RECIPIENT_STATUSES } from "@sendstack/shared";
import { user } from "./auth";
import { contacts, lists } from "./audience";

export const campaignStatus = pgEnum("campaign_status", CAMPAIGN_STATUSES);

/**
 * Uploaded email templates — the operator's own chrome, beside the four
 * built-in designs.
 *
 * `html` is a complete document carrying the placeholders in
 * `CUSTOM_TEMPLATE_SLOTS`; the renderer fills them per message. It is stored
 * exactly as uploaded rather than pre-processed, so what Settings previews is
 * what a campaign sends.
 *
 * Two unique indexes, and they are the idempotency guarantee rather than an
 * application check: the same file uploaded twice — a double-click, a retried
 * request — hits `checksum` and becomes a no-op that returns the existing row,
 * and two templates cannot share a name in a picker where the name is the
 * only thing distinguishing them. The name index is case-insensitive because
 * "Newsletter" and "newsletter" are the same choice to a person.
 */
export const templates = pgTable(
  "templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    html: text("html").notNull(),
    /** SHA-256 of `html`, so a re-upload is recognised as the same template. */
    checksum: text("checksum").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("templates_checksum_key").on(t.checksum),
    uniqueIndex("templates_name_key").on(sql`lower(${t.name})`),
  ],
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    subject: text("subject").notNull(),
    preheader: text("preheader"),
    fromName: text("from_name").notNull(),
    fromEmail: text("from_email").notNull(),
    replyTo: text("reply_to"),
    html: text("html").notNull(),
    text: text("text"),
    status: campaignStatus("status").notNull().default("draft"),
    /**
     * Which design wraps this campaign's body. Null falls back to the
     * instance-wide choice in settings — a campaign written before templates
     * existed should not suddenly render differently.
     */
    emailTemplate: text("email_template"),
    /**
     * An uploaded template, which wins over `emailTemplate` when set.
     *
     * A foreign key rather than a `custom:<id>` string in the column above:
     * deleting a template then leaves a null, which falls back to the default
     * design, instead of a dangling reference the renderer has to detect.
     * Deletion itself is refused while an unsent campaign points here — see
     * `deleteCustomTemplate` — so the fallback only ever applies to history.
     */
    customTemplateId: uuid("custom_template_id").references(() => templates.id, {
      onDelete: "set null",
    }),
    /**
     * `restrict`, not `set null`: the materialiser reads a null list as "every
     * contact", so a deleted list would silently turn a campaign into a send
     * to the whole database. No delete-list action exists yet; the constraint
     * is here so that when one is written it has to deal with campaigns first.
     */
    listId: uuid("list_id").references(() => lists.id, { onDelete: "restrict" }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    /**
     * Denormalised counters. A cache for the dashboard, never the source of
     * truth — `campaign_recipients` is.
     *
     * Written optimistically by the send worker as each batch commits, and
     * rebuilt from the recipient rows by the `reconcile-campaign-stats` cron.
     * *Not* by the webhook handler, which this docstring used to claim: that
     * handler only ever touches `campaign_recipients`, which is why a
     * reconciler is needed at all.
     */
    totalRecipients: integer("total_recipients").notNull().default(0),
    suppressedCount: integer("suppressed_count").notNull().default(0),
    sentCount: integer("sent_count").notNull().default(0),
    deliveredCount: integer("delivered_count").notNull().default(0),
    openedCount: integer("opened_count").notNull().default(0),
    clickedCount: integer("clicked_count").notNull().default(0),
    bouncedCount: integer("bounced_count").notNull().default(0),
    complainedCount: integer("complained_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),

    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("campaigns_status_idx").on(t.status),
    index("campaigns_scheduled_at_idx").on(t.scheduledAt),
    // The delete guard asks "does any unsent campaign use this template?", and
    // without this that is a sequential scan of every campaign ever sent.
    index("campaigns_custom_template_idx").on(t.customTemplateId),
    // The Campaigns list pages by (created_at, id) descending.
    index("campaigns_created_idx").on(sql`${t.createdAt} DESC`, sql`${t.id} DESC`),
  ],
);

export const recipientStatus = pgEnum("recipient_status", RECIPIENT_STATUSES);

/**
 * One row per (campaign, contact) — created up front when a campaign is
 * queued, then transitioned by the send worker and the webhook handler.
 *
 * The unique constraint is the idempotency guarantee: an Inngest step that
 * retries after a partial failure re-inserts with ON CONFLICT DO NOTHING and
 * cannot produce a second copy of the same email. The worker then claims rows
 * with a conditional `UPDATE ... WHERE status = 'pending'`, so two concurrent
 * workers can never both claim the same recipient.
 */
export const campaignRecipients = pgTable(
  "campaign_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    /** Snapshot of the address at queue time, so history survives edits. */
    email: text("email").notNull(),
    status: recipientStatus("status").notNull().default("pending"),
    /** Resend's email id, used to correlate later webhook events. */
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    attemptCount: integer("attempt_count").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    clickedAt: timestamp("clicked_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("campaign_recipients_campaign_contact_key").on(t.campaignId, t.contactId),
    index("campaign_recipients_claim_idx").on(t.campaignId, t.status),
    index("campaign_recipients_provider_message_idx").on(t.providerMessageId),
  ],
);

export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  list: one(lists, { fields: [campaigns.listId], references: [lists.id] }),
  customTemplate: one(templates, {
    fields: [campaigns.customTemplateId],
    references: [templates.id],
  }),
  recipients: many(campaignRecipients),
}));

export const campaignRecipientsRelations = relations(campaignRecipients, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [campaignRecipients.campaignId],
    references: [campaigns.id],
  }),
  contact: one(contacts, {
    fields: [campaignRecipients.contactId],
    references: [contacts.id],
  }),
}));
