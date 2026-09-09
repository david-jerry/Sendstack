import { db, sql, sqlArray, type SQL } from "@sendstack/db";
import { resendClient } from "@sendstack/email";
import {
  SUBJECT_PREFIX_PATTERN,
  bareEvent,
  baseSubject,
  outboundStatusForEvent,
  parseAddress,
  recipientStatusForEvent,
  type OutboundStatus,
  type RecipientStatus,
} from "@sendstack/shared";
import { eventAdvancesCase, outboundStatusCase, recipientStatusCase } from "./delivery-sql";

/**
 * Reconciling what was sent against what the provider says happened to it.
 *
 * Delivery status normally arrives by webhook — `email.delivered`,
 * `email.bounced` and so on. But a webhook only tells you about mail sent
 * *after* the endpoint existed and was reachable, and nothing re-delivers the
 * rest. An instance whose webhook was never configured has no delivery data at
 * all, and no way to get any.
 *
 * Resend's `emails.list()` returns every sent message with a `last_event`, so
 * the provider's API is the fallback answer to "what happened to this". Same
 * shape as the inbound reconciler: the push path is a latency optimisation,
 * and the pull path is what makes it self-healing.
 *
 * The event → status rule lives in `@sendstack/shared` and the SQL is generated
 * from it (`delivery-sql.ts`); nothing here decides what a bounce means.
 */

/** One message as `emails.list()` returns it. */
type ListedMessage = {
  id: string;
  from: string;
  to?: string[];
  cc?: string[] | null;
  subject?: string;
  message_id?: string;
  created_at: string;
  last_event: string;
};

/**
 * Try to put a page of sent messages back in the conversations they belong to.
 *
 * `emails.list()` returns no `In-Reply-To` or `References`, so there is no
 * authoritative link to follow — the only signal available is that a reply
 * goes *to* the person a thread came *from*, carrying that thread's subject
 * under a `Re:` prefix.
 *
 * That is a heuristic, and it is applied narrowly for that reason: both the
 * recipient and the subject must match, and the newest such thread wins. The
 * cost of getting it wrong is a message filed against the wrong conversation
 * with the same subject and the same correspondent; the cost of not trying is
 * that every recovered reply sits alone in Sent while its thread shows only
 * one side of itself.
 *
 * One query for the page: a `LATERAL` per candidate row picks the newest
 * matching thread, and the `inbound_emails (from_email)` lookup is the same
 * one the old per-message version ran a hundred times.
 *
 * Both halves of the comparison have to be parsed and stripped the same way,
 * and neither was. `message.to[0]` is a *header* — `"Ada" <ada@example.com>` —
 * while `inbound_emails.from_email` is a bare address, so passing the header
 * through `normalizeEmail` (which only trims and lowercases) compared a display
 * name against an address and matched nothing: every recovered reply failed to
 * rejoin its thread, which is the only thing this query exists to do. And the
 * `Re:` strip was written out twice, in TypeScript and in SQL, with only the
 * TypeScript copy trimming — so a stored subject with trailing whitespace
 * failed too. `parseAddress` and `SUBJECT_PREFIX_PATTERN` are now the single
 * definition of each side.
 */
async function findThreadsFor(
  messages: ListedMessage[],
): Promise<Map<string, { threadKey: string; inReplyToId: string }>> {
  const candidates = messages.flatMap((message) => {
    const recipient = message.to?.[0];
    const base = baseSubject(message.subject);
    // `parseAddress` normalises the address it extracts, so there is no
    // `normalizeEmail` here — a second pass would be a no-op at best and, on a
    // header, would lowercase a display name into the address column.
    return recipient && base
      ? [{ id: message.id, recipient: parseAddress(recipient).email, base }]
      : [];
  });

  const found = new Map<string, { threadKey: string; inReplyToId: string }>();
  if (candidates.length === 0) return found;

  const rows = await db.execute<{ id: string; thread_key: string; inbound_id: string }>(sql`
    SELECT v.id, t.thread_key, t.inbound_id
    FROM (VALUES ${sql.join(
      candidates.map((c) => sql`(${c.id}::text, ${c.recipient}::text, ${c.base}::text)`),
      sql`, `,
    )}) AS v(id, recipient, base)
    JOIN LATERAL (
      SELECT i.thread_key, i.id AS inbound_id
      FROM inbound_emails i
      WHERE i.from_email = v.recipient
        AND btrim(regexp_replace(COALESCE(i.subject, ''), ${SUBJECT_PREFIX_PATTERN}, '', 'i')) = v.base
      ORDER BY i.received_at DESC
      LIMIT 1
    ) AS t ON true
  `);

  for (const row of Array.from(rows)) {
    found.set(row.id, { threadKey: row.thread_key, inReplyToId: row.inbound_id });
  }
  return found;
}

/** Group a page by the status its `last_event` asserts. */
function groupBy<K extends string>(
  messages: ListedMessage[],
  key: (message: ListedMessage) => K,
): Map<K, ListedMessage[]> {
  const groups = new Map<K, ListedMessage[]>();
  for (const message of messages) {
    const k = key(message);
    const list = groups.get(k);
    if (list) list.push(message);
    else groups.set(k, [message]);
  }
  return groups;
}

/**
 * `(id, created_at)` rows for a `FROM (VALUES ...) v(...)` clause.
 *
 * The event used to ride here too. It is now the group's literal, because the
 * event guard compares against a constant — see `advanceOutbound`.
 */
function valuesOf(messages: ListedMessage[]): SQL {
  return sql.join(
    messages.map((m) => sql`(${m.id}::text, ${m.created_at}::timestamptz)`),
    sql`, `,
  );
}

/**
 * Advance every campaign recipient on the page in one statement per asserted
 * status.
 *
 * The ladder `CASE` is generated for one incoming status at a time, so the
 * page is grouped by that status first: at most one UPDATE per distinct value
 * in Resend's vocabulary — a dozen — however many messages the page holds.
 * The `<>` guard keeps rows that would not change out of the write set, so
 * the returned count is rows that actually moved.
 */
async function advanceRecipients(page: ListedMessage[]): Promise<number> {
  let moved = 0;
  for (const [incoming, group] of groupBy(page, (m) => recipientStatusForEvent(m.last_event))) {
    const next = recipientStatusCase(sql`cr.status`, incoming as RecipientStatus);
    const rows = await db.execute<{ id: string }>(sql`
      UPDATE campaign_recipients cr
      SET status = ${next}
      FROM (VALUES ${valuesOf(group)}) AS v(provider_message_id, created_at)
      WHERE cr.provider_message_id = v.provider_message_id
        AND cr.status <> ${next}
      RETURNING cr.id
    `);
    moved += Array.from(rows).length;
  }
  return moved;
}

/**
 * The same, for one-off messages.
 *
 * **Grouped by event rather than by status, which raises the bound from three
 * statements per page to twelve.** The event guard has to compare the stored
 * event against a *literal* incoming one — `eventAdvancesCase` renders one arm
 * per stored name — and keying on the status instead would need a stored ×
 * incoming cross product, 144 arms, to say the same thing. Twelve is the size
 * of the provider's event vocabulary, so this is still a bounded number of
 * queries per page and not one per row, which is what §7 requires.
 *
 * `last_event` no longer rides in `VALUES`: it is the group's own literal now,
 * so only `created_at` varies per row.
 */
async function advanceOutbound(page: ListedMessage[]): Promise<number> {
  let moved = 0;
  for (const [incoming, group] of groupBy(page, (m) => m.last_event)) {
    const outboundStatus = outboundStatusForEvent(incoming);
    /**
     * Both ladders, for the reason the webhook route states at length: the
     * status ladder collapses the whole sent band into one rung and so cannot
     * order `delivered` against `clicked`, while the event ladder alone would
     * let a stale `delivered` from this eventually-consistent list API land on
     * a row a webhook has already bounced.
     */
    const guard = sql`(${sql`(${outboundStatusCase(sql`o.status`, outboundStatus)}) = ${outboundStatus}::outbound_status`} AND ${eventAdvancesCase(sql`o.last_event`, incoming)})`;

    const rows = await db.execute<{ id: string }>(sql`
      UPDATE outbound_messages o SET
        status = ${outboundStatusCase(sql`o.status`, outboundStatus)},
        last_event = CASE WHEN ${guard} THEN ${incoming} ELSE o.last_event END,
        last_event_at = CASE WHEN ${guard} THEN now() ELSE o.last_event_at END,
        sent_at = COALESCE(o.sent_at, v.created_at),
        updated_at = now()
      FROM (VALUES ${valuesOf(group)}) AS v(provider_message_id, created_at)
      WHERE o.provider_message_id = v.provider_message_id
      RETURNING o.id
    `);
    moved += Array.from(rows).length;
  }
  return moved;
}

export type SentSyncResult = {
  scanned: number;
  /** Rows already ours whose delivery status moved. */
  updated: number;
  /** Sent mail this app had no record of, now imported. */
  imported: number;
  /** Of those, how many were matched back into an existing conversation. */
  rejoined: number;
  /** Campaign recipients whose status the provider corrected. */
  campaignUpdated: number;
  pages: number;
};

/**
 * Pull the provider's view of sent mail and fold it into ours.
 *
 * Per page of up to a hundred messages this runs a bounded handful of
 * statements — one recipient UPDATE and one outbound UPDATE per distinct
 * status on the page, one SELECT for the ids already known, one thread lookup,
 * one multi-row INSERT — where it used to run two to six *per message*. On a
 * 500-message sync that is roughly a dozen round trips instead of two
 * thousand.
 *
 * The import INSERT carries a bare `ON CONFLICT DO NOTHING`, which is not the
 * weak guard it looks like: `outbound_provider_key` is a *unique* partial
 * index on `provider_message_id WHERE provider_message_id IS NOT NULL`, and an
 * unqualified `DO NOTHING` arbitrates on every unique index on the table. So
 * two syncs racing on the same message converge on one row — the schema is the
 * guarantee, per CLAUDE.md §7, and `EXPLAIN (ANALYZE, BUFFERS)` on the
 * statement this builds reports `Conflict Resolution: NOTHING` with the
 * conflicting tuple counted.
 *
 * The arbiter is deliberately *not* named. Inferring a partial index requires
 * repeating its predicate in the `ON CONFLICT` clause, and getting that subtly
 * wrong is a runtime `42P10` on a statement that otherwise works; the
 * known-ids SELECT above already keeps the common case out of the INSERT
 * entirely, so this is the backstop rather than the mechanism.
 *
 * Addresses go through `parseAddress`, never `normalizeEmail`: `emails.list()`
 * returns headers with display names in them, and these columns are addresses.
 */
export async function syncSentEmails(options?: {
  /** Stop after this many messages. Bounds a first sync on a busy account. */
  max?: number;
}): Promise<SentSyncResult> {
  const client = await resendClient();
  const max = options?.max ?? 500;

  let cursor: string | undefined;
  let scanned = 0;
  let updated = 0;
  let imported = 0;
  let rejoined = 0;
  let campaignUpdated = 0;
  let pages = 0;

  while (scanned < max) {
    const response = await client.emails.list({
      limit: Math.min(100, max - scanned),
      ...(cursor ? { after: cursor } : {}),
    } as Parameters<typeof client.emails.list>[0]);

    if (response.error) {
      throw new Error(`Could not list sent emails: ${response.error.message}`);
    }

    const payload = response.data as unknown as {
      data?: ListedMessage[];
      has_more?: boolean;
    } | null;

    /**
     * Normalised once, at the ingestion boundary — invariant 6's shape.
     *
     * `emails.list()` reports unprefixed event names while the webhook
     * receives `email.`-prefixed ones, and `outbound_messages.last_event` used
     * to hold whichever arrived last. Every reader then had to strip a prefix
     * that might not be there, and one of them broke in the browser doing it.
     * The column now holds only bare names, enforced by
     * `outbound_last_event_bare`, and this is the single place this writer
     * makes that true: it covers the insert path, both grouping keys and the
     * `VALUES` list in one line.
     */
    const page = (payload?.data ?? []).map((message) => ({
      ...message,
      last_event: bareEvent(message.last_event),
    }));
    if (page.length === 0) break;
    pages += 1;
    scanned += page.length;

    /**
     * A campaign send is tracked on its recipient row, not in
     * `outbound_messages`. Advancing recipients first and then excluding every
     * id that belongs to one matters: importing a campaign message as well
     * would double-count it in Sent and detach it from the campaign whose
     * numbers it belongs to.
     */
    campaignUpdated += await advanceRecipients(page);
    updated += await advanceOutbound(page);

    const ids = page.map((m) => m.id);
    const known = await db.execute<{ id: string }>(sql`
      SELECT provider_message_id AS id FROM campaign_recipients
      WHERE provider_message_id = ANY(${sqlArray(ids)})
      UNION
      SELECT provider_message_id AS id FROM outbound_messages
      WHERE provider_message_id = ANY(${sqlArray(ids)})
    `);
    const knownIds = new Set(Array.from(known).map((row) => row.id));

    // Within-page dedupe too: the provider has never returned one id twice,
    // and the plain index below would not stop it if it did.
    const seen = new Set<string>();
    const unknown = page.filter((m) => !knownIds.has(m.id) && !seen.has(m.id) && seen.add(m.id));

    if (unknown.length > 0) {
      /**
       * Sent mail this app has never seen — sent from the Resend dashboard,
       * from a website form on the same account, or one whose row was lost.
       *
       * If it looks like a reply to a conversation we hold, it rejoins that
       * conversation. Otherwise its own `Message-ID` becomes its thread key
       * and it stands alone in Sent.
       */
      const threads = await findThreadsFor(unknown);
      rejoined += threads.size;

      const inserted = await db.execute<{ id: string }>(sql`
        INSERT INTO outbound_messages
          (thread_key, in_reply_to_id, kind, from_email, to_emails, cc_emails, subject,
           status, provider_message_id, last_event, last_event_at, sent_at, created_at)
        VALUES ${sql.join(
          unknown.map((message) => {
            const rejoin = threads.get(message.id);
            // Header values, not addresses. `emails.list()` returns
            // `"Acme" <hello@acme.com>` for both `from` and each `to`, and the
            // columns below are addresses — `inbound_emails.from_email` is
            // parsed the same way, and a thread match compares the two.
            const to = (message.to ?? []).map((value) => parseAddress(value).email);
            return sql`(
              ${rejoin?.threadKey ?? message.message_id ?? `external:${message.id}`},
              ${rejoin?.inReplyToId ?? null}::uuid,
              ${rejoin ? "reply" : "external"},
              ${parseAddress(message.from).email},
              ${sqlArray(to)},
              ARRAY[]::text[],
              ${message.subject ?? null},
              ${outboundStatusForEvent(message.last_event)}::outbound_status,
              ${message.id},
              ${message.last_event},
              now(),
              ${message.created_at}::timestamptz,
              ${message.created_at}::timestamptz
            )`;
          }),
          sql`, `,
        )}
        ON CONFLICT DO NOTHING
        RETURNING id
      `);
      imported += Array.from(inserted).length;
    }

    if (!payload?.has_more) break;
    cursor = page[page.length - 1]?.id;
    if (!cursor) break;
  }

  return { scanned, updated, imported, rejoined, campaignUpdated, pages };
}
