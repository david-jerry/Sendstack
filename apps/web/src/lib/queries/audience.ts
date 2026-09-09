import "server-only";
import { db, sql } from "@sendstack/db";
import { CAMPAIGNS_PAGE_SIZE, CONTACTS_PAGE_SIZE } from "@sendstack/shared";
import { toPage, type Cursor, type Page } from "@/lib/cursor";
import { seek } from "@/lib/queries/seek";
import { COUNT_CAP, toCount, type FolderCount } from "@/lib/queries/thread";

/**
 * How many groups or lists a picker will show.
 *
 * These two lists are not paginated — they populate a `<select>` and the
 * chips on a contact row, where a "load more" would be useless. The cap is
 * what stops that being an unbounded query: without it, an instance with
 * fifty thousand lists loads all of them, and their member counts, to render
 * a dropdown nobody can scroll. Matches the cap on `listSuppressions`.
 */
const PICKER_LIMIT = 200;


export type ContactRow = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  position: string | null;
  phone: string | null;
  status: "active" | "unsubscribed" | "bounced" | "complained";
  groupCount: number;
  groupNames: string[];
  listCount: number;
  suppressed: boolean;
  createdAt: Date;
};

export type ListContactsOptions = {
  query?: string | undefined;
  limit?: number | undefined;
  cursor?: Cursor | null | undefined;
};

export async function listContacts(
  search?: string | ListContactsOptions,
): Promise<ContactRow[]> {
  // Kept callable with a bare search string: several server components pass
  // one, and changing all of them to an object buys nothing.
  const options = typeof search === "string" || search === undefined ? { query: search } : search;
  return (await listContactPage(options)).items;
}

export async function listContactPage(
  options?: ListContactsOptions,
): Promise<Page<ContactRow>> {
  const term = options?.query?.trim();
  const limit = options?.limit ?? CONTACTS_PAGE_SIZE;
  const cursor = options?.cursor ?? null;

  const clauses = [];
  if (term) {
    const like = `%${term}%`;
    clauses.push(sql`(
      c.email ILIKE ${like}
      OR coalesce(c.first_name, '') ILIKE ${like}
      OR coalesce(c.last_name, '') ILIKE ${like}
      OR coalesce(c.company, '') ILIKE ${like}
      OR coalesce(c.position, '') ILIKE ${like}
      OR coalesce(c.phone, '') ILIKE ${like}
    )`);
  }
  if (cursor) clauses.push(seek(cursor, { at: "c.created_at", id: "c.id" }));

  const filter = clauses.length > 0 ? sql`WHERE ${sql.join(clauses, sql` AND `)}` : sql``;

  /**
   * The page first, then its group names, list counts and suppression flags —
   * each as one grouped pass over just this page's rows.
   *
   * It used to be four correlated subqueries in the SELECT list, which
   * Postgres runs once per row: `EXPLAIN` showed `SubPlan` entries with
   * `loops=` equal to the page size, so a fifty-row page was two hundred
   * extra executions and a page of five hundred was two thousand. Restricting
   * each aggregate to `(SELECT id FROM page)` makes the work proportional to
   * the page instead of the page times the table.
   *
   * `group_count` comes from the same join that builds `group_names` rather
   * than a second count of the membership rows. The foreign key makes those
   * numbers identical, and one of them cannot then drift from the other.
   */
  const rows = await db.execute<{
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    company: string | null;
    position: string | null;
    phone: string | null;
    status: ContactRow["status"];
    group_count: string;
    group_names: string[];
    list_count: string;
    suppressed: boolean;
    created_at: string;
  }>(sql`
    WITH page AS (
      SELECT c.id, c.email, c.first_name, c.last_name, c.company, c.position,
             c.phone, c.status, c.created_at
      FROM contacts c
      ${filter}
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ${limit + 1}
    ),
    group_counts AS (
      SELECT cgm.contact_id,
             count(*) AS group_count,
             array_agg(g.name ORDER BY g.name) AS group_names
      FROM contact_group_members cgm
      JOIN contact_groups g ON g.id = cgm.group_id
      WHERE cgm.contact_id IN (SELECT id FROM page)
      GROUP BY cgm.contact_id
    ),
    list_counts AS (
      SELECT lm.contact_id, count(*) AS list_count
      FROM list_members lm
      WHERE lm.unsubscribed_at IS NULL
        AND lm.contact_id IN (SELECT id FROM page)
      GROUP BY lm.contact_id
    ),
    blocked AS (
      -- Expired suppressions are excluded, matching assertNotSuppressed.
      -- Without this the table flagged a contact as suppressed that every
      -- send path would happily mail.
      SELECT s.email
      FROM suppressions s
      WHERE s.email IN (SELECT email FROM page)
        AND (s.expires_at IS NULL OR s.expires_at > now())
    )
    SELECT p.id, p.email, p.first_name, p.last_name, p.company, p.position,
           p.phone, p.status, p.created_at,
           COALESCE(gc.group_count, 0) AS group_count,
           COALESCE(gc.group_names, ARRAY[]::text[]) AS group_names,
           COALESCE(lc.list_count, 0) AS list_count,
           (b.email IS NOT NULL) AS suppressed
    FROM page p
    LEFT JOIN group_counts gc ON gc.contact_id = p.id
    LEFT JOIN list_counts lc ON lc.contact_id = p.id
    LEFT JOIN blocked b ON b.email = p.email
    ORDER BY p.created_at DESC, p.id DESC
  `);

  const mapped = Array.from(rows).map((row) => ({
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    company: row.company,
    position: row.position,
    phone: row.phone,
    status: row.status,
    groupCount: Number(row.group_count),
    groupNames: row.group_names ?? [],
    listCount: Number(row.list_count),
    suppressed: row.suppressed,
    createdAt: new Date(row.created_at),
  }));

  return toPage(mapped, limit, (contact) => ({ at: contact.createdAt, id: contact.id }));
}

export type ContactGroupRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  memberCount: number;
};

/**
 * Every group, with its size, capped at `PICKER_LIMIT`.
 *
 * The count was a correlated subquery — one aggregate per group row — and the
 * outer set had no limit at all, so this scaled as groups times memberships.
 * Now the page is taken first and the counts are one grouped pass over the
 * memberships belonging to it.
 */
export async function listContactGroups(): Promise<ContactGroupRow[]> {
  const rows = await db.execute<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
    member_count: string;
  }>(sql`
    WITH page AS (
      SELECT g.id, g.name, g.slug, g.description
      FROM contact_groups g
      ORDER BY g.name ASC
      LIMIT ${PICKER_LIMIT}
    ),
    counts AS (
      SELECT cgm.group_id, count(*) AS member_count
      FROM contact_group_members cgm
      WHERE cgm.group_id IN (SELECT id FROM page)
      GROUP BY cgm.group_id
    )
    SELECT p.id, p.name, p.slug, p.description,
           COALESCE(c.member_count, 0) AS member_count
    FROM page p
    LEFT JOIN counts c ON c.group_id = p.id
    ORDER BY p.name ASC
  `);

  return Array.from(rows).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    memberCount: Number(row.member_count),
  }));
}

/**
 * The three headline numbers above the contacts table, each capped.
 *
 * An uncapped `count(*)` on `contacts` reads every row of the table to render
 * one number, and it did so on every load of the page — which is exactly the
 * cost CLAUDE.md §7 calls a bug at scale. Each count now stops at
 * `COUNT_CAP + 1` rows, and the extra row is what lets "exactly 20,000" and
 * "more than that" be told apart. The UI renders `20k+` through
 * `formatCount`, the same way the sidebar badges already do.
 */
export async function contactStats(): Promise<{
  total: FolderCount;
  active: FolderCount;
  suppressed: FolderCount;
}> {
  const cap = COUNT_CAP + 1;

  const rows = await db.execute<{
    total: string;
    active: string;
    suppressed: string;
  }>(sql`
    SELECT
      (SELECT count(*)::text FROM (SELECT 1 FROM contacts LIMIT ${cap}) q) AS total,
      (SELECT count(*)::text FROM (
         SELECT 1 FROM contacts WHERE status = 'active' LIMIT ${cap}
       ) q) AS active,
      (SELECT count(*)::text FROM (SELECT 1 FROM suppressions LIMIT ${cap}) q) AS suppressed
  `);
  const row = Array.from(rows)[0];
  return {
    total: toCount(row?.total),
    active: toCount(row?.active),
    suppressed: toCount(row?.suppressed),
  };
}

export type ListRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  memberCount: number;
  createdAt: Date;
};

/**
 * Every list, with its subscribed-member count, capped at `PICKER_LIMIT`.
 *
 * Same rewrite as `listContactGroups`, and `SELECT l.*` is gone with it: the
 * columns are named so that adding one to the table does not silently widen
 * every row this sends to a picker.
 */
export async function listLists(): Promise<ListRow[]> {
  const rows = await db.execute<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
    member_count: string;
    created_at: string;
  }>(sql`
    WITH page AS (
      SELECT l.id, l.name, l.slug, l.description, l.created_at
      FROM lists l
      -- id breaks the tie so which rows fall inside the cap is stable;
      -- created_at alone collides whenever lists are created in a batch.
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT ${PICKER_LIMIT}
    ),
    counts AS (
      SELECT lm.list_id, count(*) AS member_count
      FROM list_members lm
      WHERE lm.unsubscribed_at IS NULL
        AND lm.list_id IN (SELECT id FROM page)
      GROUP BY lm.list_id
    )
    SELECT p.id, p.name, p.slug, p.description, p.created_at,
           COALESCE(c.member_count, 0) AS member_count
    FROM page p
    LEFT JOIN counts c ON c.list_id = p.id
    ORDER BY p.created_at DESC, p.id DESC
  `);
  return Array.from(rows).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    memberCount: Number(row.member_count),
    createdAt: new Date(row.created_at),
  }));
}

export type SuppressionRow = {
  id: string;
  email: string;
  reason: string;
  detail: string | null;
  createdAt: Date;
};

export async function listSuppressions(): Promise<SuppressionRow[]> {
  const rows = await db.execute<{
    id: string;
    email: string;
    reason: string;
    detail: string | null;
    created_at: string;
  }>(sql`
    SELECT id, email, reason, detail, created_at
    FROM suppressions
    ORDER BY created_at DESC, id DESC
    LIMIT ${PICKER_LIMIT}
  `);
  return Array.from(rows).map((row) => ({
    id: row.id,
    email: row.email,
    reason: row.reason,
    detail: row.detail,
    createdAt: new Date(row.created_at),
  }));
}

export type CampaignRow = {
  id: string;
  name: string;
  subject: string;
  status: string;
  listName: string | null;
  totalRecipients: number;
  sentCount: number;
  deliveredCount: number;
  openedCount: number;
  bouncedCount: number;
  suppressedCount: number;
  scheduledAt: Date | null;
  createdAt: Date;
};

/**
 * Campaign totals across the whole table.
 *
 * Summed in the database rather than over the rows on screen: the page used
 * to add up whatever the first hundred campaigns happened to be, so the
 * headline figures moved when the list was filtered and undercounted from the
 * hundred-and-first campaign onwards.
 */
export async function campaignTotals(): Promise<{
  sent: number;
  delivered: number;
  opened: number;
  bounced: number;
}> {
  const [row] = Array.from(
    await db.execute<{
      sent: string;
      delivered: string;
      opened: string;
      bounced: string;
    }>(sql`
      SELECT
        COALESCE(sum(sent_count), 0)::text AS sent,
        COALESCE(sum(delivered_count), 0)::text AS delivered,
        COALESCE(sum(opened_count), 0)::text AS opened,
        COALESCE(sum(bounced_count), 0)::text AS bounced
      FROM campaigns
    `),
  );

  return {
    sent: Number(row?.sent ?? 0),
    delivered: Number(row?.delivered ?? 0),
    opened: Number(row?.opened ?? 0),
    bounced: Number(row?.bounced ?? 0),
  };
}

export type ListCampaignsOptions = {
  query?: string | undefined;
  limit?: number | undefined;
  cursor?: Cursor | null | undefined;
};

export async function listCampaigns(
  options?: ListCampaignsOptions,
): Promise<CampaignRow[]> {
  return (await listCampaignPage(options)).items;
}

export async function listCampaignPage(
  options?: ListCampaignsOptions,
): Promise<Page<CampaignRow>> {
  const term = options?.query?.trim();
  const limit = options?.limit ?? CAMPAIGNS_PAGE_SIZE;
  const cursor = options?.cursor ?? null;

  const clauses = [];
  if (term) {
    const like = `%${term}%`;
    // Name and subject are what a campaign is looked up by; the list it was
    // sent to is the third, because "the one we sent to Beta users" is how
    // people actually remember them.
    clauses.push(sql`(
      c.name ILIKE ${like}
      OR c.subject ILIKE ${like}
      OR coalesce(l.name, '') ILIKE ${like}
    )`);
  }
  if (cursor) clauses.push(seek(cursor, { at: "c.created_at", id: "c.id" }));

  const filter = clauses.length > 0 ? sql`WHERE ${sql.join(clauses, sql` AND `)}` : sql``;

  const rows = await db.execute<{
    id: string;
    name: string;
    subject: string;
    status: string;
    list_name: string | null;
    total_recipients: number;
    sent_count: number;
    delivered_count: number;
    opened_count: number;
    bounced_count: number;
    suppressed_count: number;
    scheduled_at: string | null;
    created_at: string;
  }>(sql`
    SELECT c.id, c.name, c.subject, c.status,
      l.name AS list_name,
      c.total_recipients, c.sent_count, c.delivered_count,
      c.opened_count, c.bounced_count, c.suppressed_count,
      c.scheduled_at, c.created_at
    FROM campaigns c
    LEFT JOIN lists l ON l.id = c.list_id
    ${filter}
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT ${limit + 1}
  `);

  const mapped = Array.from(rows).map((row) => ({
    id: row.id,
    name: row.name,
    subject: row.subject,
    status: row.status,
    listName: row.list_name,
    totalRecipients: Number(row.total_recipients),
    sentCount: Number(row.sent_count),
    deliveredCount: Number(row.delivered_count),
    openedCount: Number(row.opened_count),
    bouncedCount: Number(row.bounced_count),
    suppressedCount: Number(row.suppressed_count),
    scheduledAt: row.scheduled_at ? new Date(row.scheduled_at) : null,
    createdAt: new Date(row.created_at),
  }));

  return toPage(mapped, limit, (campaign) => ({ at: campaign.createdAt, id: campaign.id }));
}
