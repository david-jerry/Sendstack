import "server-only";
import { and, db, eq, isUniqueViolation, outboundMessages, sql } from "@sendstack/db";
import { OUTBOUND_PAGE_SIZE } from "@sendstack/shared";
import { toPage, type Cursor, type Page } from "@/lib/cursor";
import { seekWhere } from "@/lib/queries/seek";

export type OutboundRow = {
  id: string;
  threadKey: string;
  /** The received message this belongs to, so a row can link into its thread. */
  inReplyToId: string | null;
  fromEmail: string;
  fromName: string | null;
  toEmails: string[];
  ccEmails: string[];
  subject: string | null;
  html: string | null;
  text: string | null;
  status: "draft" | "queued" | "sent" | "failed";
  kind: string;
  error: string | null;
  at: Date;
  attachments: { id: string; filename: string; contentType: string | null; byteSize: number }[];
};

/** Sent and Drafts are the same table under a different status filter. */
export type ListOutboundOptions = {
  query?: string | undefined;
  limit?: number | undefined;
  cursor?: Cursor | null | undefined;
};

/**
 * One page of sent mail or drafts, newest first.
 *
 * The sort key is `COALESCE(sent_at, updated_at)` — a draft has never been
 * sent, and ordering it by a null would file every unfinished message at one
 * end of the list. That makes the key an expression rather than a column, so
 * it is computed in a CTE and the cursor compares against the alias; a keyset
 * predicate cannot reference an expression it is being applied to.
 */
export async function listOutboundPage(
  status: "sent" | "draft",
  options?: ListOutboundOptions,
): Promise<Page<OutboundRow>> {
  const term = options?.query?.trim();
  const limit = options?.limit ?? OUTBOUND_PAGE_SIZE;
  const cursor = options?.cursor ?? null;

  const clauses = [
    status === "sent"
      ? sql`o.status IN ('sent','queued','failed')`
      : sql`o.status = 'draft'`,
  ];

  if (term) {
    const like = `%${term}%`;
    /**
     * Recipients are matched with `array_to_string`, not `= ANY`.
     *
     * `to_emails` is an array and someone searching "ada" wants the message
     * addressed to ada@example.com — a containment test would only match a
     * whole address, which is not what a search box is for.
     */
    clauses.push(sql`(
      coalesce(o.subject, '') ILIKE ${like}
      OR array_to_string(o.to_emails, ' ') ILIKE ${like}
      OR array_to_string(o.cc_emails, ' ') ILIKE ${like}
      OR coalesce(o.text, '') ILIKE ${like}
    )`);
  }

  const where = sql.join(clauses, sql` AND `);
  const seekPredicate = seekWhere(cursor, { at: "page.at", id: "page.id" });

  const rows = await db.execute<{
    id: string;
    thread_key: string;
    in_reply_to_id: string | null;
    from_email: string;
    from_name: string | null;
    to_emails: string[];
    cc_emails: string[];
    subject: string | null;
    html: string | null;
    text: string | null;
    status: OutboundRow["status"];
    kind: string;
    error: string | null;
    at: string;
  }>(sql`
    WITH page AS (
      SELECT o.id, o.thread_key, o.in_reply_to_id, o.from_email, o.from_name,
             o.to_emails, o.cc_emails, o.subject, o.html, o.text,
             o.status, o.kind, o.error,
             COALESCE(o.sent_at, o.updated_at) AS at
      FROM outbound_messages o
      WHERE ${where}
    )
    SELECT * FROM page
    ${seekPredicate}
    ORDER BY at DESC, id DESC
    LIMIT ${limit + 1}
  `);

  return toPage(
    Array.from(rows),
    limit,
    (row) => ({
    id: row.id,
    threadKey: row.thread_key,
    inReplyToId: row.in_reply_to_id,
    fromEmail: row.from_email,
    fromName: row.from_name,
    toEmails: row.to_emails ?? [],
    ccEmails: row.cc_emails ?? [],
    subject: row.subject,
    html: row.html,
    text: row.text,
    status: row.status,
    kind: row.kind,
    error: row.error,
    at: new Date(row.at),
    // The list shows a paperclip, not the files. Fetching every message's
    // attachments to render a row nobody has opened is the N+1 this avoids.
    attachments: [],
    }),
    // The raw string, not the mapped `Date` — see `Cursor.at`.
    (row) => ({ at: row.at, id: row.id }),
  );
}

export async function getOutboundMessage(
  folder: "sent" | "draft",
  id: string,
): Promise<OutboundRow | null> {
  const [row] = Array.from(
    await db.execute<{
      id: string;
      thread_key: string;
      in_reply_to_id: string | null;
      from_email: string;
      from_name: string | null;
      to_emails: string[];
      cc_emails: string[];
      subject: string | null;
      html: string | null;
      text: string | null;
      status: OutboundRow["status"];
      kind: string;
      error: string | null;
      at: string;
    }>(sql`
      SELECT o.id, o.thread_key, o.in_reply_to_id, o.from_email, o.from_name,
             o.to_emails, o.cc_emails, o.subject, o.html, o.text,
             o.status, o.kind, o.error,
             COALESCE(o.sent_at, o.updated_at) AS at
      FROM outbound_messages o
      WHERE o.id = ${id}::uuid
        AND ${folder === "sent"
        ? sql`o.status IN ('sent','queued','failed')`
        : sql`o.status = 'draft'`
      }
      LIMIT 1
    `),
  );

  if (!row) return null;

  const attachments = Array.from(
    await db.execute<{
      id: string; filename: string; content_type: string | null; byte_size: number;
    }>(sql`
      SELECT id, filename, content_type, byte_size
      FROM outbound_attachments
      WHERE message_id = ${id}::uuid AND disposition = 'attachment'
      ORDER BY created_at ASC
    `),
  );

  return {
    id: row.id,
    threadKey: row.thread_key,
    inReplyToId: row.in_reply_to_id,
    fromEmail: row.from_email,
    fromName: row.from_name,
    toEmails: row.to_emails ?? [],
    ccEmails: row.cc_emails ?? [],
    subject: row.subject,
    html: row.html,
    text: row.text,
    status: row.status,
    kind: row.kind,
    error: row.error,
    at: new Date(row.at),
    attachments: attachments.map((file) => ({
      id: file.id,
      filename: file.filename,
      contentType: file.content_type,
      byteSize: file.byte_size,
    })),
  };
}

/**
 * Insert-only columns: what a row *is*, fixed when it is first written.
 *
 * Separated from the content because a conflicting replay must not rewrite
 * them. Which conversation a message belongs to and who wrote it are not
 * things a second delivery of the same body gets to change.
 */
export type KeyedDraftIdentity = {
  threadKey: string | undefined;
  kind: string;
  createdBy: string;
  inReplyToId?: string | null;
  inReplyToMessageId?: string | null;
  references?: string[];
};

/** The columns a replay of the same message may legitimately update. */
export type KeyedDraftContent = {
  fromEmail: string;
  fromName?: string | null;
  toEmails: string[];
  ccEmails: string[];
  bccEmails: string[];
  subject: string | null;
  html: string | null;
  text: string;
  updatedAt: Date;
};

/**
 * One outbound row per client key, however many times the body arrives.
 *
 * The same message can reach the server twice — a double-clicked Send, two
 * tabs on one draft, the service worker replaying a queued request whose
 * response a network error hid, minutes apart or concurrently. The unique
 * index `outbound_client_key_key` is the arbiter, and the insert is
 * `ON CONFLICT (client_key) DO UPDATE … RETURNING id`: one statement, so there
 * is no read-then-insert for two replays to race through. Idempotency lives in
 * the schema, per CLAUDE.md §7, not in application logic that races with
 * itself.
 *
 * A row already `sent` is refused the update by `setWhere` rather than
 * overwritten — a sent record is history — and its id is read back so the
 * caller can report it as sent. `status` is never in the update set, so a
 * replay cannot drag a row backwards from `queued` or `failed` to `draft`.
 *
 * A `draftId` alongside the key is a composer that autosaved before the send.
 * That row is *adopted* under the key first, so the send updates it instead of
 * leaving it in Drafts beside a second copy. Adoption is best-effort and
 * triple-guarded — only a draft, only one with no key, only when no other row
 * holds this key — because correctness never depends on it. The upsert is what
 * stops the duplicate; adoption only stops the litter.
 *
 * **It lives here, not in either action module.** Both `actions/compose.ts`
 * and `actions/thread.ts` need it, and every exported symbol in a `"use
 * server"` file becomes a browser-reachable RPC endpoint — so neither can
 * export it for the other. This is the same placement, for the same reason, as
 * `applyThreadStatus` in `lib/queries/thread.ts`. Before it moved here only
 * compose used it, and a double-submitted *reply* inserted a fresh row every
 * time: two sends under two claim keys, which the provider cannot collapse.
 *
 * The identity/content split is a parameter rather than a destructure for a
 * reason. The version in `compose.ts` stripped the insert-only columns by
 * name, so the reply path's `inReplyToId`, `inReplyToMessageId` and
 * `references` would have been swept into the conflict update silently —
 * harmless for those three, a trap for whatever the next caller adds.
 */
export async function upsertKeyedDraft(
  clientKey: string,
  draftId: string | null,
  row: { identity: KeyedDraftIdentity; content: KeyedDraftContent },
): Promise<string> {
  if (draftId) {
    try {
      await db
        .update(outboundMessages)
        .set({ clientKey })
        .where(
          and(
            eq(outboundMessages.id, draftId),
            eq(outboundMessages.status, "draft"),
            sql`${outboundMessages.clientKey} IS NULL`,
            sql`NOT EXISTS (SELECT 1 FROM outbound_messages WHERE client_key = ${clientKey})`,
          ),
        );
    } catch (error) {
      // A replay inserted the keyed row between the subquery and the update.
      // The upsert below finds that row; the orphaned draft is the lesser evil.
      if (!isUniqueViolation(error)) throw error;
    }
  }

  const { identity, content } = row;

  /**
   * Drizzle's builder rather than a hand-written statement, deliberately.
   *
   * It serialises the `Date` and the text arrays for the column types it
   * knows about. A raw `sql` template does not: the first version of this
   * function passed `updatedAt` straight through and postgres.js rejected it
   * with `ERR_INVALID_ARG_TYPE` — "received an instance of Date" — on every
   * keyed send. The explicit column list is not worth re-implementing the
   * driver's type mapping.
   */
  const [inserted] = await db
    .insert(outboundMessages)
    .values({
      clientKey,
      threadKey: identity.threadKey ?? `compose:${crypto.randomUUID()}`,
      kind: identity.kind,
      createdBy: identity.createdBy,
      inReplyToId: identity.inReplyToId ?? null,
      inReplyToMessageId: identity.inReplyToMessageId ?? null,
      ...(identity.references ? { references: identity.references } : {}),
      status: "draft" as const,
      ...content,
    })
    .onConflictDoUpdate({
      target: outboundMessages.clientKey,
      // Content only. `status` is left out so a replay cannot move a row
      // backwards from `queued` or `failed` to `draft`, and the identity
      // columns are left out so it cannot reassign the conversation.
      set: content,
      setWhere: sql`${outboundMessages.status} <> 'sent'`,
    })
    .returning({ id: outboundMessages.id });
  if (inserted) return inserted.id;

  // The update was refused, which only happens for a sent row: read its id
  // back so the caller can say so. Sent is terminal, so this cannot race.
  const [sent] = await db
    .select({ id: outboundMessages.id })
    .from(outboundMessages)
    .where(eq(outboundMessages.clientKey, clientKey))
    .limit(1);
  if (!sent) throw new Error(`No row for client key ${clientKey} after a refused upsert.`);
  return sent.id;
}
