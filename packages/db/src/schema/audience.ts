import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { CONTACT_STATUSES, SUPPRESSION_REASONS } from "@sendstack/shared";

/**
 * Every email address in this database is stored lowercased and trimmed.
 * Normalisation happens in one place — `normalizeEmail()` in @sendstack/shared —
 * and nothing writes an address that has not been through it. A suppression
 * list that misses `Bob@Example.com` because it stored `bob@example.com` is
 * worse than no suppression list at all.
 */

export const contactStatus = pgEnum("contact_status", CONTACT_STATUSES);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    company: text("company"),
    position: text("position"),
    phone: text("phone"),
    /** Arbitrary merge fields available to templates as {{ attributes.key }}. */
    attributes: jsonb("attributes").notNull().default(sql`'{}'::jsonb`),
    status: contactStatus("status").notNull().default("active"),
    /** Where this contact came from: "import" | "api" | "form" | "manual". */
    source: text("source").notNull().default("manual"),
    /**
     * Soft bounces are transient (full mailbox, greylisting). We keep sending
     * until this crosses SOFT_BOUNCE_LIMIT — declared in @sendstack/shared —
     * then suppress. Hard bounces suppress on the first event. Both decisions
     * are made by the `suppress()` helper and `isHardBounce` in
     * apps/web/src/app/api/webhooks/resend/route.ts; the read side that every
     * send path consults is apps/web/src/lib/queries/suppressions.ts.
     */
    softBounceCount: integer("soft_bounce_count").notNull().default(0),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("contacts_email_key").on(t.email),
    index("contacts_status_idx").on(t.status),
    /**
     * The contacts list's keyset order, matched exactly.
     *
     * `listContactPage` seeks on `(created_at, id) < (…)` and orders by both
     * columns descending, and `created_at` alone cannot serve that: a CSV
     * import writes thousands of rows in the same millisecond — the very
     * collision `seekBefore` exists for — and Postgres then sorts the entire
     * collision group to find each page. Measured on 200k rows with 50k
     * sharing a timestamp: 49.8ms and a full sort on `contacts_created_at_idx`
     * alone, 0.133ms and no sort with this one. `campaigns_created_idx` is the
     * same index for the same reason.
     *
     * It also replaced that single-column `contacts_created_at_idx`, dropped in
     * `0017`: a btree scans in either direction and this one leads with the
     * same column, so it answers everything the narrower index could. Do not
     * re-add one — it would cost write throughput and storage for nothing.
     */
    index("contacts_created_idx").on(sql`${t.createdAt} DESC`, sql`${t.id} DESC`),
  ],
);

export const lists = pgTable(
  "lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("lists_slug_key").on(t.slug)],
);

export const contactGroups = pgTable(
  "contact_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("contact_groups_slug_key").on(t.slug),
    index("contact_groups_name_idx").on(t.name),
  ],
);

export const listMembers = pgTable(
  "list_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    subscribedAt: timestamp("subscribed_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set instead of deleting the row, so re-subscribes keep their history. */
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  },
  (t) => [
    unique("list_members_list_contact_key").on(t.listId, t.contactId),
    index("list_members_contact_idx").on(t.contactId),
  ],
);

export const contactGroupMembers = pgTable(
  "contact_group_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => contactGroups.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("contact_group_members_group_contact_key").on(t.groupId, t.contactId),
    index("contact_group_members_contact_idx").on(t.contactId),
  ],
);

/**
 * The do-not-send list. This is the single most important table in the
 * project: sending to a hard-bounced or complained address is what gets a
 * sending domain blocked. Membership here is checked by `resolveRecipients()`
 * on every send, and nothing bypasses it.
 */
export const suppressionReason = pgEnum("suppression_reason", SUPPRESSION_REASONS);

export const suppressions = pgTable(
  "suppressions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    reason: suppressionReason("reason").notNull(),
    /** Free text: the provider's bounce message, or an operator's note. */
    detail: text("detail"),
    /** The `email_events.provider_event_id` that caused this, when automatic. */
    sourceEventId: text("source_event_id"),
    /**
     * NULL means permanent. A future soft-bounce backoff policy can set this
     * to retry an address after a cooling-off period; nothing does yet.
     */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("suppressions_email_key").on(t.email),
    index("suppressions_reason_idx").on(t.reason),
    index("suppressions_created_at_idx").on(t.createdAt),
  ],
);

export const contactsRelations = relations(contacts, ({ many }) => ({
  memberships: many(listMembers),
  groupMemberships: many(contactGroupMembers),
}));

export const listsRelations = relations(lists, ({ many }) => ({
  members: many(listMembers),
}));

export const listMembersRelations = relations(listMembers, ({ one }) => ({
  list: one(lists, { fields: [listMembers.listId], references: [lists.id] }),
  contact: one(contacts, { fields: [listMembers.contactId], references: [contacts.id] }),
}));

export const contactGroupsRelations = relations(contactGroups, ({ many }) => ({
  members: many(contactGroupMembers),
}));

export const contactGroupMembersRelations = relations(contactGroupMembers, ({ one }) => ({
  group: one(contactGroups, { fields: [contactGroupMembers.groupId], references: [contactGroups.id] }),
  contact: one(contacts, { fields: [contactGroupMembers.contactId], references: [contacts.id] }),
}));
