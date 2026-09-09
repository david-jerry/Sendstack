import "server-only";
import { db, sql, sqlArray } from "@sendstack/db";

/**
 * A conversation, as a single timeline.
 *
 * Received and sent messages live in different tables — they have genuinely
 * different shapes — but a conversation is one sequence, so the query unions
 * them and orders by time. Everything downstream works on the union, which is
 * why the reply you just sent appears in the thread instead of vanishing.
 */
export type ThreadItem =
  | {
      kind: "received";
      id: string;
      fromEmail: string;
      fromName: string | null;
      toEmails: string[];
      ccEmails: string[];
      subject: string | null;
      html: string | null;
      text: string | null;
      at: Date;
      contentFetchedAt: Date | null;
      hasAttachments: boolean;
      attachments: { id: string; filename: string; contentType: string | null; size: number | null }[];
    }
  | {
      kind: "sent";
      id: string;
      fromEmail: string;
      fromName: string | null;
      toEmails: string[];
      ccEmails: string[];
      subject: string | null;
      html: string | null;
      text: string | null;
      at: Date;
      status: "draft" | "queued" | "sent" | "failed";
      /**
       * The last thing the provider said — `email.delivered`, `email.bounced`.
       *
       * Distinct from `status`, which is what *we* know: a row reads `sent`
       * the moment Resend accepts it, which is not the same as arriving. This
       * is the difference between "handed over" and "delivered", and a sender
       * asking "did it get there" is asking about this one.
       */
      /**
       * The bare event name — `delivered`, never `email.delivered`.
       *
       * Passed through untouched, because the **column** is bare: constraint
       * `outbound_last_event_bare` enforces it and both writers normalise at
       * their ingestion boundary. Stripping it again here would be a second
       * implementation of a rule the schema now owns, and would leave the next
       * reader unsure which layer is responsible.
       *
       * No client component may call `bareEvent`. One did, and Turbopack
       * resolved the import to a module fragment where the function was
       * undefined — every thread view threw `bareEvent is not a function`.
       * Nothing here needs it now.
       */
      lastEvent: string | null;
      lastEventAt: Date | null;
      /**
       * The key this row was first written under, for reopening its draft.
       *
       * The composer mints one key per composition and must reuse this one
       * when a draft is reopened: `upsertKeyedDraft` adopts only a row whose
       * `client_key IS NULL`, so a fresh key on an already-keyed row would
       * decline adoption and insert a second row — the duplicate the key
       * exists to prevent. Null for anything written before the key existed,
       * or by the attach-before-typing path.
       */
      clientKey: string | null;
      messageKind: string;
      error: string | null;
      attachments: { id: string; filename: string; contentType: string | null; size: number | null }[];
    };

export type ThreadFlags = {
  starred: boolean;
  muted: boolean;
  snoozedUntil: Date | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
};

export type Thread = {
  threadKey: string;
  subject: string | null;
  items: ThreadItem[];
  flags: ThreadFlags;
  /** The most recent *received* message — what a reply defaults to answering. */
  lastReceivedId: string | null;
  status: "unread" | "read" | "archived" | "spam" | "trash";
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
};

export async function getThread(id: string): Promise<Thread | null> {
  const [anchor] = Array.from(
    await db.execute<{ thread_key: string; status: Thread["status"] }>(sql`
      SELECT thread_key, status FROM inbound_emails WHERE id = ${id}::uuid
    `),
  );
  if (!anchor) return null;
  const threadKey = anchor.thread_key;

  /**
   * The two reads are independent, so they go together.
   *
   * `received` and `sent` are separate tables filtered by the same key and
   * neither needs the other — running them in sequence spent a round trip for
   * nothing on the thread view, which is the most-opened screen in the app.
   * `attachments` genuinely depends on `received`, so it stays behind them.
   */
  const [receivedRows, sentRows, flagRows] = await Promise.all([
    db.execute<{
      id: string; from_email: string; from_name: string | null;
      to_emails: string[]; cc_emails: string[]; subject: string | null;
      html: string | null; text: string | null; received_at: string;
      content_fetched_at: string | null; has_attachments: boolean;
      contact_id: string | null; campaign_id: string | null;
    }>(sql`
      SELECT id, from_email, from_name, to_emails, cc_emails, subject, html, text,
             received_at, content_fetched_at, has_attachments, contact_id, campaign_id
      FROM inbound_emails WHERE thread_key = ${threadKey} ORDER BY received_at ASC
    `),
    db.execute<{
      id: string; from_email: string; from_name: string | null;
      to_emails: string[]; cc_emails: string[]; subject: string | null;
      html: string | null; text: string | null; created_at: string; sent_at: string | null;
      status: "draft" | "queued" | "sent" | "failed"; kind: string; error: string | null;
      last_event: string | null; last_event_at: string | null; client_key: string | null;
    }>(sql`
      SELECT id, from_email, from_name, to_emails, cc_emails, subject, html, text,
             created_at, sent_at, status, kind, error, last_event, last_event_at,
             client_key
      FROM outbound_messages WHERE thread_key = ${threadKey} ORDER BY created_at ASC
    `),
    db.execute<{
      starred: boolean; muted: boolean; snoozed_until: string | null;
      assigned_user_id: string | null; assigned_name: string | null;
    }>(sql`
      SELECT t.starred, t.muted, t.snoozed_until, t.assigned_user_id, u.name AS assigned_name
      FROM threads t LEFT JOIN "user" u ON u.id = t.assigned_user_id
      WHERE t.thread_key = ${threadKey}
    `),
  ]);

  const received = Array.from(receivedRows);
  const sent = Array.from(sentRows);
  const [flagRow] = Array.from(flagRows);

  /**
   * The reads that depend on the wave above start together, and are awaited
   * where each is used.
   *
   * Attachments need the message ids, and the contact and campaign need the
   * newest received row, so none of them could join the first wave — but they
   * do not need *each other*. Started as promises rather than awaited in
   * place, the thread view costs **three** round trips instead of five: the
   * anchor, then `received`/`sent`/flags together, then these.
   *
   * Counted at the driver, the five application statements are unchanged; what
   * changed is how many of them wait on one another. This is the most-opened
   * screen in the app, so it is two saved round trips per thread view.
   */
  const last = received[received.length - 1];

  const attachmentsPromise = received.length
    ? db.execute<{
        id: string; inbound_email_id: string; filename: string;
        content_type: string | null; size: number | null;
      }>(sql`
        SELECT id, inbound_email_id, filename, content_type, size
        FROM inbound_attachments
        WHERE inbound_email_id = ANY(${sqlArray(
          received.map((row) => row.id),
          "uuid",
        )})
      `)
    : null;

  const sentAttachmentsPromise = sent.length
    ? db.execute<{
        id: string; message_id: string; filename: string;
        content_type: string | null; size: number | null;
      }>(sql`
        SELECT a.id, a.message_id, a.filename, a.content_type, a.byte_size AS size
        FROM outbound_attachments a
        JOIN outbound_messages m ON m.id = a.message_id
        WHERE m.thread_key = ${threadKey} AND a.disposition = 'attachment'
        ORDER BY a.created_at ASC
      `)
    : null;

  const contactPromise = last?.contact_id
    ? db.execute<{
        id: string; first_name: string | null; last_name: string | null;
        company: string | null; position: string | null; phone: string | null; email: string;
      }>(sql`
        SELECT id, first_name, last_name, company, position, phone, email
        FROM contacts WHERE id = ${last.contact_id}::uuid
      `)
    : null;

  const campaignPromise = last?.campaign_id
    ? db.execute<{ id: string; name: string }>(sql`
        SELECT id, name FROM campaigns WHERE id = ${last.campaign_id}::uuid
      `)
    : null;

  const attachments = attachmentsPromise ? Array.from(await attachmentsPromise) : [];

  const byMessage = new Map<string, typeof attachments>();
  for (const attachment of attachments) {
    const bucket = byMessage.get(attachment.inbound_email_id) ?? [];
    bucket.push(attachment);
    byMessage.set(attachment.inbound_email_id, bucket);
  }

  /**
   * The sent side's files, in one query for the whole thread.
   *
   * Keyed by thread rather than by message id so this stays a single round
   * trip however long the conversation is. Inline images are excluded — they
   * are already in the body, and listing them again would show every embedded
   * logo as a paperclip.
   */
  const sentAttachments = sentAttachmentsPromise
    ? Array.from(await sentAttachmentsPromise)
    : [];

  const bySentMessage = new Map<string, typeof sentAttachments>();
  for (const attachment of sentAttachments) {
    const bucket = bySentMessage.get(attachment.message_id) ?? [];
    bucket.push(attachment);
    bySentMessage.set(attachment.message_id, bucket);
  }

  const items: ThreadItem[] = [
    ...received.map(
      (row): ThreadItem => ({
        kind: "received",
        id: row.id,
        fromEmail: row.from_email,
        fromName: row.from_name,
        toEmails: row.to_emails ?? [],
        ccEmails: row.cc_emails ?? [],
        subject: row.subject,
        html: row.html,
        text: row.text,
        at: new Date(row.received_at),
        contentFetchedAt: row.content_fetched_at ? new Date(row.content_fetched_at) : null,
        hasAttachments: row.has_attachments,
        attachments: (byMessage.get(row.id) ?? []).map((a) => ({
          id: a.id,
          filename: a.filename,
          contentType: a.content_type,
          size: a.size,
        })),
      }),
    ),
    ...sent.map(
      (row): ThreadItem => ({
        kind: "sent",
        id: row.id,
        fromEmail: row.from_email,
        fromName: row.from_name,
        toEmails: row.to_emails ?? [],
        ccEmails: row.cc_emails ?? [],
        subject: row.subject,
        html: row.html,
        text: row.text,
        // A sent message is placed by when it went out; a draft by when it was
        // last touched, so it sits at the end where it is being written.
        at: new Date(row.sent_at ?? row.created_at),
        status: row.status,
        lastEvent: row.last_event,
        lastEventAt: row.last_event_at ? new Date(row.last_event_at) : null,
        clientKey: row.client_key,
        messageKind: row.kind,
        error: row.error,
        attachments: (bySentMessage.get(row.id) ?? []).map((a) => ({
          id: a.id,
          filename: a.filename,
          contentType: a.content_type,
          size: a.size,
        })),
      }),
    ),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  const [contact] = contactPromise ? Array.from(await contactPromise) : [];

  const [campaign] = campaignPromise ? Array.from(await campaignPromise) : [];

  return {
    threadKey,
    subject: received[0]?.subject ?? sent[0]?.subject ?? null,
    items,
    status: anchor.status,
    lastReceivedId: last?.id ?? null,
    flags: {
      starred: flagRow?.starred ?? false,
      muted: flagRow?.muted ?? false,
      snoozedUntil: flagRow?.snoozed_until ? new Date(flagRow.snoozed_until) : null,
      assignedUserId: flagRow?.assigned_user_id ?? null,
      assignedUserName: flagRow?.assigned_name ?? null,
    },
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

/**
 * How high a badge counts before it stops caring about the exact number.
 *
 * The point of a folder badge is "is there a lot in here", and past a few
 * thousand the answer stops changing. Capping it turns an unbounded
 * `count(DISTINCT …)` — a scan and a sort of every matching row, on every page
 * load — into a bounded index walk that stops as soon as it has seen enough.
 */
/**
 * The conversation a message belongs to, or null if the id matches nothing.
 *
 * Every thread mutation is addressed by a message id and applies to the whole
 * conversation, so all of them start here. It lives beside
 * `applyThreadStatus` because the two are always called together and both
 * action modules need the pair — `actions/thread.ts` had it as a private
 * helper, which is why `actions/inbox.ts` grew its own.
 */
export async function threadKeyOf(messageId: string): Promise<string | null> {
  const [row] = Array.from(
    await db.execute<{ thread_key: string }>(sql`
      SELECT thread_key FROM inbound_emails WHERE id = ${messageId}::uuid LIMIT 1
    `),
  );
  return row?.thread_key ?? null;
}

/**
 * The inbound message a reply hangs off, and the headers that thread it.
 *
 * Two writers need this and were looking it up differently. `saveDraft` in
 * `actions/thread.ts` had it inline, keyed on the message the user pressed
 * Reply on. `attachFile` in `actions/attachments.ts` had *nothing*: it creates
 * the draft row when a file is attached before the first keystroke, and it
 * wrote `kind: 'compose'` with no parent even inside a reply thread. Attach a
 * file, close the composer without typing, and the draft sat in Drafts
 * detached from the conversation it was written in. `saveDraft` overwrote both
 * fields on the first keystroke, so it self-healed the moment anyone typed —
 * which is why it went unnoticed.
 *
 * Addressed by either key because the callers genuinely hold different ones.
 * `attachFile` has only the thread, so it takes the newest message in it: the
 * one the user is looking at and would have replied to. `saveDraft` has the
 * exact message and must use it, since a reply to an older message in a long
 * thread is a different parent.
 *
 * Null when nothing matches, which is the ordinary case for `attachFile` — a
 * fresh compose passes a `compose:` key that is not a conversation at all.
 * Callers treat null as "this is not a reply" rather than as an error, so no
 * prefix sniffing is needed anywhere.
 */
export async function replyParent(
  by: { messageId: string } | { threadKey: string },
): Promise<{
  id: string;
  threadKey: string;
  messageId: string | null;
  references: string[];
  fromEmail: string;
  subject: string | null;
} | null> {
  const [row] = Array.from(
    await db.execute<{
      id: string;
      thread_key: string;
      message_id: string | null;
      references: string[];
      from_email: string;
      subject: string | null;
    }>(
      "messageId" in by
        ? sql`
            SELECT id, thread_key, message_id, "references", from_email, subject
            FROM inbound_emails WHERE id = ${by.messageId}::uuid LIMIT 1
          `
        : sql`
            SELECT id, thread_key, message_id, "references", from_email, subject
            FROM inbound_emails WHERE thread_key = ${by.threadKey}
            ORDER BY received_at DESC LIMIT 1
          `,
    ),
  );

  return row
    ? {
        id: row.id,
        threadKey: row.thread_key,
        messageId: row.message_id,
        references: row.references ?? [],
        fromEmail: row.from_email,
        subject: row.subject,
      }
    : null;
}

/**
 * The `References` chain a reply to this parent should carry.
 *
 * RFC 5322: the parent's own chain plus the parent's `Message-ID`. Both
 * callers built this list, and a mail client that cannot follow the chain
 * shows the reply as a new conversation.
 */
export function referencesFor(parent: { messageId: string | null; references: string[] }): string[] {
  return [...parent.references, parent.messageId].filter((value): value is string => Boolean(value));
}

/**
 * Move a whole conversation to a status, and report what the badge should do.
 *
 * Two Server Action modules need this one write — `setThreadStatus` in
 * `actions/thread.ts`, which the toolbar and the row menu call, and
 * `markThreadRead` in `actions/inbox.ts`, which fires when a thread is opened
 * — and neither can import the other's private helper. Before this they each
 * had their own statement and their own idea of the unread delta, and the two
 * had diverged: `actions/inbox.ts` also exported a *second* `setThreadStatus`
 * that nothing imported at all, so a fix applied there changed nothing.
 *
 * **The delta comes from the write, not from a count taken before it.** That
 * is the part that matters. Counting first and publishing `-1` because the
 * count was non-zero is a read-then-write across an `await`: two tabs on the
 * same thread, or a remount re-firing the open handler, both read `unread = 3`
 * and both publish `-1`, and one conversation takes the badge down by two.
 * `WHERE status = 'unread'` inside the `UPDATE` is arbitrated by Postgres —
 * the second caller locks the rows, re-checks, and matches none — so
 * `leftUnread` is the number of rows *this* call actually moved out of unread
 * and nobody else's.
 *
 * The two arms are disjoint by their `WHERE` clauses, which is what makes two
 * `UPDATE`s on one table legal in a single statement: Postgres refuses to
 * modify the same row twice, and no row is both `unread` and not.
 *
 * **Addressed by message id, resolved inside the statement.** Every caller
 * has a message id and needs the conversation, and both used to fetch the
 * thread key first — two round trips for one write, on a path that runs every
 * single time a thread is opened. The sub-select costs an index lookup on the
 * primary key inside a statement that was already going to run.
 *
 * @returns `leftUnread` — rows that were `unread` before this call and are not
 *   now (or, when moving *to* `unread`, rows that were already unread, which
 *   is how the caller knows the conversation was in the folder already); and
 *   `touched`, every row in the conversation. `touched === 0` means the id
 *   matched nothing: a conversation always contains at least the message that
 *   names it, so an existing id cannot produce zero.
 */
export async function applyThreadStatus(
  messageId: string,
  status: "read" | "unread" | "archived" | "spam" | "trash",
): Promise<{ leftUnread: number; touched: number }> {
  const key = sql`(SELECT thread_key FROM inbound_emails WHERE id = ${messageId}::uuid)`;

  const [row] = Array.from(
    await db.execute<{ left_unread: string; rest: string }>(sql`
      WITH moved AS (
        UPDATE inbound_emails
        SET status = ${status}::inbound_status,
            read_at = CASE WHEN ${status} = 'unread' THEN NULL ELSE COALESCE(read_at, now()) END
        WHERE thread_key = ${key} AND status = 'unread'
        RETURNING id
      ), rest AS (
        UPDATE inbound_emails
        SET status = ${status}::inbound_status,
            read_at = CASE WHEN ${status} = 'unread' THEN NULL ELSE COALESCE(read_at, now()) END
        WHERE thread_key = ${key} AND status <> 'unread'
        RETURNING id
      )
      SELECT (SELECT count(*)::text FROM moved) AS left_unread,
             (SELECT count(*)::text FROM rest) AS rest
    `),
  );

  const leftUnread = Number(row?.left_unread ?? 0);
  const rest = Number(row?.rest ?? 0);
  return { leftUnread, touched: leftUnread + rest };
}

/**
 * What `applyThreadStatus`' result means for the unread badge.
 *
 * The badge counts *conversations* (see `folderCounts`), so a thread is worth
 * exactly one whichever way it moves, however many messages it holds. Kept
 * beside the write because the two have to agree, and split out because both
 * callers publish the same realtime event with it.
 *
 * Zero is the common answer and the one the old code got wrong. Archiving a
 * conversation that was already read removes nothing from the unread folder,
 * and neither does restoring one from Archive — which the row menu does as
 * `"read"`, so every un-archive click used to knock one off the badge for good.
 */
export function unreadDeltaFor(
  status: string,
  result: { leftUnread: number; touched: number },
): number {
  if (status === "unread") {
    // Already in the folder if anything was unread; otherwise it joins it.
    return result.leftUnread > 0 || result.touched === 0 ? 0 : 1;
  }
  return result.leftUnread > 0 ? -1 : 0;
}

export const COUNT_CAP = 20_000;

export type FolderCount = {
  /** Rows actually counted. Equal to `COUNT_CAP` when the cap was reached. */
  value: number;
  /** True when there are more than `value`. The UI renders "20k+". */
  capped: boolean;
};

/** Exported so every capped count in the app reads the cap the same way. */
export function toCount(raw: string | undefined): FolderCount {
  const value = Number(raw ?? 0);
  return { value: Math.min(value, COUNT_CAP), capped: value > COUNT_CAP };
}

/**
 * Counts for the sidebar. One round trip rather than six.
 *
 * Every count is capped and every one counts *conversations* rather than
 * messages — a thread of nine archived replies is one row in the folder, and
 * a badge saying nine would send someone looking for eight more.
 *
 * The `LIMIT` inside each subquery is what bounds the work, and it is worth
 * being precise about how. For the row counts it is absolute: a plain index
 * scan stops at the limit and reads nothing more. For the two that count
 * *distinct threads* it depends on the shape Postgres picks — measured on
 * 25,000 archived rows across 12,500 threads:
 *
 *   - a small slice of the table → `Unique` over an index-only scan, which
 *     streams and stops. 0.24ms, reading 200 index rows rather than 25,000.
 *   - most of the table → a hash aggregate over a single pass. Under 10ms,
 *     and crucially no sort, which is what the unbounded version needed.
 *
 * So it is strictly better than the unbounded `count(DISTINCT …)` it replaced:
 * far cheaper when the folder is a fraction of the mailbox, and no worse when
 * it is most of it. The `(status, thread_key)` index is what makes the first
 * case possible at all — without it even the fast path sorts.
 *
 * One more than the cap, so "exactly 20,000" and "more than that" can be told
 * apart.
 *
 * **All six count conversations, and `unread` did not.** It counted rows in
 * `inbound_emails` while `archived` and `spam` beside it counted distinct
 * `thread_key`s, so the sidebar showed three numbers in two different units.
 * The one that settles it is not a philosophical preference between Gmail and
 * Outlook: every one of these badges opens `listThreadPage`, which returns one
 * row per conversation. A badge reading 5 over a list of 2 rows is wrong in
 * any unit. Two messages in one unread thread are one thing to read.
 *
 * The realtime deltas had to move with it — see `unreadDelta` in
 * `actions/inbox.ts` and the `inbound.received` case in `realtime-store.ts`.
 * A badge seeded in conversations and then nudged per message drifts further
 * from the truth with every event, which is worse than either unit alone.
 *
 * The `DISTINCT` costs nothing in the shape that matters and is bounded in the
 * one that does not. Measured with `EXPLAIN (ANALYZE, BUFFERS)` on the
 * statement this function emits, against seeded rows:
 *
 *   - 40,000 messages of which 800 unread across 200 conversations — a
 *     mostly-read mailbox, which is every real one — 0.478ms, 213 buffers.
 *     `Index Only Scan using inbound_emails_status_thread_idx` feeding a
 *     `Sort`/`Unique` over 800 rows. The index is what makes this possible;
 *     the `LEFT JOIN threads` for snooze does not spoil it.
 *   - all 40,000 unread across 10,001 conversations — 23.7ms, 1002 buffers,
 *     one `HashAggregate` over one `Seq Scan`, no sort of the table.
 *
 * The second regime is where the `LIMIT` stops helping: a `HashAggregate` has
 * to consume its whole input before the limit above it can cut the groups, so
 * unlike the old row count this cannot stop early at the cap. That is the
 * price of the number being right, it is the same price `archived` and `spam`
 * already pay, and 23.7ms for a mailbox with 40,000 unread messages in it is
 * not the thing that install has a problem with.
 */
export async function folderCounts(): Promise<{
  unread: FolderCount;
  sent: FolderCount;
  drafts: FolderCount;
  starred: FolderCount;
  archived: FolderCount;
  spam: FolderCount;
}> {
  const cap = COUNT_CAP + 1;

  const [row] = Array.from(
    await db.execute<{
      unread: string;
      sent: string;
      drafts: string;
      starred: string;
      archived: string;
      spam: string;
    }>(sql`
      SELECT
        (SELECT count(*)::text FROM (
           SELECT DISTINCT i.thread_key FROM inbound_emails i
             LEFT JOIN threads t ON t.thread_key = i.thread_key
           WHERE i.status = 'unread'
             AND (t.snoozed_until IS NULL OR t.snoozed_until <= now())
           LIMIT ${cap}
         ) q) AS unread,
        (SELECT count(*)::text FROM (
           SELECT 1 FROM outbound_messages WHERE status = 'sent' LIMIT ${cap}
         ) q) AS sent,
        (SELECT count(*)::text FROM (
           SELECT 1 FROM outbound_messages WHERE status = 'draft' LIMIT ${cap}
         ) q) AS drafts,
        (SELECT count(*)::text FROM (
           SELECT 1 FROM threads WHERE starred LIMIT ${cap}
         ) q) AS starred,
        (SELECT count(*)::text FROM (
           SELECT DISTINCT thread_key FROM inbound_emails
           WHERE status = 'archived' LIMIT ${cap}
         ) q) AS archived,
        (SELECT count(*)::text FROM (
           SELECT DISTINCT thread_key FROM inbound_emails
           WHERE status = 'spam' LIMIT ${cap}
         ) q) AS spam
    `),
  );

  return {
    unread: toCount(row?.unread),
    sent: toCount(row?.sent),
    drafts: toCount(row?.drafts),
    starred: toCount(row?.starred),
    archived: toCount(row?.archived),
    spam: toCount(row?.spam),
  };
}

