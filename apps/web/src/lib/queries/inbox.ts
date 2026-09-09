import "server-only";
import { db, sql, sqlArray } from "@sendstack/db";
import { INBOX_PAGE_SIZE } from "@sendstack/shared";
import { toPage, type Cursor, type Page } from "@/lib/cursor";
import { seekWhere } from "@/lib/queries/seek";

export type InboxThread = {
  starred: boolean;
  muted: boolean;
  snoozedUntil: Date | null;
  id: string;
  threadKey: string;
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  snippet: string | null;
  status: "unread" | "read" | "archived" | "spam" | "trash";
  receivedAt: Date;
  messageCount: number;
  hasAttachments: boolean;
  contentFetchedAt: Date | null;
};

/**
 * `all` is the inbox, not literally everything. `starred` and `snoozed` are
 * folders rather than stored statuses — they are derived from the thread flags.
 */
export type InboxThreadStatus =
  | "all"
  | "unread"
  | "read"
  | "archived"
  | "spam"
  | "trash"
  | "starred"
  | "snoozed";
export type InboxThreadSort = "newest" | "oldest";

/**
 * One row per conversation, newest first.
 *
 * `DISTINCT ON (thread_key)` with a matching `ORDER BY` is the Postgres idiom
 * for "the latest row in each group" — it does in one index-ordered pass what
 * a window function or a correlated subquery would do with a sort per group.
 * The outer query then re-sorts those winners by recency for display.
 */
export type ListThreadsOptions = {
  /** Free-text match across sender, subject and snippet. */
  query?: string | undefined;
  /**
   * Which slice of the mailbox. `all` means "not filed away" — the inbox —
   * rather than literally everything, because a list that mixes spam into the
   * inbox is not a list anyone wants.
   */
  status?: InboxThreadStatus | undefined;
  /** Only threads whose body has been fetched. */
  hasContent?: boolean | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  sort?: InboxThreadSort | undefined;
  limit?: number | undefined;
  /** Where the previous page stopped. Absent means start at the top. */
  cursor?: Cursor | null | undefined;
};

export async function listThreadPage(
  options?: ListThreadsOptions,
): Promise<Page<InboxThread>> {
  const status = options?.status ?? "all";
  const sort = options?.sort ?? "newest";
  const limit = options?.limit ?? INBOX_PAGE_SIZE;
  const cursor = options?.cursor ?? null;

  /**
   * Every folder is the same rows under a different filter — nothing is moved
   * or removed, which is what makes archive, spam and trash reversible.
   *
   * A snoozed thread is hidden from the inbox *until* its timestamp passes,
   * and only from the inbox: it is still findable in its own folder and in
   * search, because "remind me later" should never mean "hide this from me".
   */
  const folderFilter =
    status === "all"
      ? sql`i.status IN ('unread','read') AND (t.snoozed_until IS NULL OR t.snoozed_until <= now())`
      : status === "starred"
        ? sql`COALESCE(t.starred, false) AND i.status <> 'trash'`
        : status === "snoozed"
          ? sql`t.snoozed_until IS NOT NULL AND t.snoozed_until > now()`
          : sql`i.status = ${status}::inbound_status`;

  const clauses = [folderFilter];

  if (options?.query) {
    const term = `%${options.query}%`;
    clauses.push(sql`(
      i.from_email ILIKE ${term}
      OR COALESCE(i.from_name, '') ILIKE ${term}
      OR COALESCE(i.subject, '') ILIKE ${term}
      OR COALESCE(i.snippet, '') ILIKE ${term}
    )`);
  }
  if (options?.hasContent) clauses.push(sql`i.content_fetched_at IS NOT NULL`);
  if (options?.from) clauses.push(sql`i.received_at >= ${options.from.toISOString()}`);
  if (options?.to) clauses.push(sql`i.received_at < ${options.to.toISOString()}`);

  const where = sql.join(clauses, sql` AND `);
  const direction = sort === "oldest" ? sql`ASC` : sql`DESC`;

  /**
   * The keyset predicate goes on the CTE's *output*, not inside it.
   *
   * `DISTINCT ON (thread_key)` picks the newest message in each conversation;
   * filtering messages before that runs would change which message wins and
   * therefore what the row says. Applied to the winners it is a plain
   * comparison against the same `(at, id)` the outer `ORDER BY` uses, which
   * is what makes the boundary stable.
   */
  const seekPredicate = seekWhere(
    cursor,
    { at: "latest.received_at", id: "latest.id" },
    sort === "oldest" ? "after" : "before",
  );

  const rows = await db.execute<{
    id: string;
    thread_key: string;
    from_email: string;
    from_name: string | null;
    subject: string | null;
    snippet: string | null;
    status: InboxThread["status"];
    received_at: string;
    message_count: string;
    has_attachments: boolean;
    content_fetched_at: string | null;
    starred: boolean;
    muted: boolean;
    snoozed_until: string | null;
  }>(sql`
    WITH latest AS (
      SELECT DISTINCT ON (i.thread_key)
        i.id, i.thread_key, i.from_email, i.from_name, i.subject, i.snippet,
        i.status, i.received_at, i.has_attachments, i.content_fetched_at,
        COALESCE(t.starred, false) AS starred,
        COALESCE(t.muted, false) AS muted,
        t.snoozed_until
      FROM inbound_emails i
      LEFT JOIN threads t ON t.thread_key = i.thread_key
      WHERE ${where}
      ORDER BY i.thread_key, i.received_at DESC
    ),
    -- The page is chosen *before* anything is counted. Two correlated
    -- subqueries per row is 2N queries for an N-row page — a hundred of them
    -- for a fifty-row mailbox — and they were being run for every thread the
    -- filter matched, not just the ones about to be returned.
    page AS (
      SELECT latest.* FROM latest
      ${seekPredicate}
      -- id is in the ORDER BY as well as the cursor: two messages received in
      -- the same millisecond need a total order or the page boundary moves.
      ORDER BY received_at ${direction}, id ${direction}
      LIMIT ${limit + 1}
    ),
    -- One grouped aggregate each, over the fifty thread keys on the page.
    inbound_counts AS (
      SELECT m.thread_key, count(*) AS n
      FROM inbound_emails m
      WHERE m.thread_key IN (SELECT thread_key FROM page)
      GROUP BY m.thread_key
    ),
    outbound_counts AS (
      SELECT o.thread_key, count(*) AS n
      FROM outbound_messages o
      WHERE o.thread_key IN (SELECT thread_key FROM page)
        AND o.status <> 'draft'
      GROUP BY o.thread_key
    )
    SELECT page.*,
      (COALESCE(inbound_counts.n, 0) + COALESCE(outbound_counts.n, 0)) AS message_count
    FROM page
    LEFT JOIN inbound_counts ON inbound_counts.thread_key = page.thread_key
    LEFT JOIN outbound_counts ON outbound_counts.thread_key = page.thread_key
    ORDER BY page.received_at ${direction}, page.id ${direction}
  `);

  const mapped = Array.from(rows).map((row) => ({
    id: row.id,
    threadKey: row.thread_key,
    fromEmail: row.from_email,
    fromName: row.from_name,
    subject: row.subject,
    snippet: row.snippet,
    status: row.status,
    receivedAt: new Date(row.received_at),
    messageCount: Number(row.message_count),
    hasAttachments: row.has_attachments,
    contentFetchedAt: row.content_fetched_at ? new Date(row.content_fetched_at) : null,
    starred: row.starred,
    muted: row.muted,
    snoozedUntil: row.snoozed_until ? new Date(row.snoozed_until) : null,
  }));

  return toPage(mapped, limit, (thread) => ({ at: thread.receivedAt, id: thread.id }));
}

export type ThreadMessage = {
  id: string;
  fromEmail: string;
  fromName: string | null;
  toEmails: string[];
  subject: string | null;
  html: string | null;
  text: string | null;
  snippet: string | null;
  receivedAt: Date;
  contentFetchedAt: Date | null;
  hasAttachments: boolean;
  status: InboxThread["status"];
  attachments: { id: string; filename: string; contentType: string | null; size: number | null }[];
};

/** Every message in the conversation containing `id`, oldest first. */
export async function getThread(id: string): Promise<{
  messages: ThreadMessage[];
  contact: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    position: string | null;
    phone: string | null;
    email: string;
  } | null;
  campaign: { id: string; name: string } | null;
} | null> {
  const rows = await db.execute<{
    id: string;
    from_email: string;
    from_name: string | null;
    to_emails: string[];
    subject: string | null;
    html: string | null;
    text: string | null;
    snippet: string | null;
    received_at: string;
    content_fetched_at: string | null;
    has_attachments: boolean;
    status: InboxThread["status"];
    contact_id: string | null;
    campaign_id: string | null;
  }>(sql`
    SELECT e.*
    FROM inbound_emails e
    WHERE e.thread_key = (SELECT thread_key FROM inbound_emails WHERE id = ${id}::uuid)
    ORDER BY e.received_at ASC
  `);

  const list = Array.from(rows);
  if (list.length === 0) return null;

  const attachments = await db.execute<{
    id: string;
    inbound_email_id: string;
    filename: string;
    content_type: string | null;
    size: number | null;
  }>(sql`
    SELECT id, inbound_email_id, filename, content_type, size
    FROM inbound_attachments
    WHERE inbound_email_id = ANY(${sqlArray(
      list.map((row) => row.id),
      "uuid",
    )})
  `);

  const attachmentsList = Array.from(attachments);
  const byEmail = new Map<string, typeof attachmentsList>();
  for (const attachment of attachmentsList) {
    const bucket = byEmail.get(attachment.inbound_email_id) ?? [];
    bucket.push(attachment);
    byEmail.set(attachment.inbound_email_id, bucket);
  }

  const last = list[list.length - 1];

  let contactRows: Array<{
    id: string;
    first_name: string | null;
    last_name: string | null;
    company: string | null;
    position: string | null;
    phone: string | null;
    email: string;
  }> = [];

  if (last?.contact_id) {
    contactRows = Array.from(
      await db.execute<{
        id: string;
        first_name: string | null;
        last_name: string | null;
        company: string | null;
        position: string | null;
        phone: string | null;
        email: string;
      }>(sql`
          SELECT id, first_name, last_name, company, position, phone, email
          FROM contacts
          WHERE id = ${last.contact_id}::uuid
        `),
    );
  } else if (last) {
    contactRows = Array.from(
      await db.execute<{
        id: string;
        first_name: string | null;
        last_name: string | null;
        company: string | null;
        position: string | null;
        phone: string | null;
        email: string;
      }>(sql`
          SELECT id, first_name, last_name, company, position, phone, email
          FROM contacts
          WHERE email = ${last.from_email}
          LIMIT 1
        `),
    );
  }

  const [contact] = contactRows;

  const [campaign] = last?.campaign_id
    ? Array.from(
      await db.execute<{ id: string; name: string }>(sql`
          SELECT id, name FROM campaigns WHERE id = ${last.campaign_id}::uuid
        `),
    )
    : [];

  return {
    messages: list.map((row) => ({
      id: row.id,
      fromEmail: row.from_email,
      fromName: row.from_name,
      toEmails: row.to_emails ?? [],
      subject: row.subject,
      html: row.html,
      text: row.text,
      snippet: row.snippet,
      receivedAt: new Date(row.received_at),
      contentFetchedAt: row.content_fetched_at ? new Date(row.content_fetched_at) : null,
      hasAttachments: row.has_attachments,
      status: row.status,
      attachments: (byEmail.get(row.id) ?? []).map((attachment) => ({
        id: attachment.id,
        filename: attachment.filename,
        contentType: attachment.content_type,
        size: attachment.size,
      })),
    })),
    contact: contact
      ? {
        id: contact.id,
        firstName: contact.first_name,
        lastName: contact.last_name,
        company: contact.company,
        position: contact.position,
        phone: contact.phone,
        email: contact.email,
      }
      : null,
    campaign: campaign ? { id: campaign.id, name: campaign.name } : null,
  };
}

