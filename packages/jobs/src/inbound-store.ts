import { db, eq, sql, sqlArray, type Executor } from "@sendstack/db";
import { contacts, inboundAttachments, inboundEmails } from "@sendstack/db/schema";
import {
  broadcastPush,
  fetchInboundEmail,
  resendClient,
  type NormalizedInbound,
} from "@sendstack/email";
import { publishRealtime } from "@sendstack/redis";
import { deriveThreadKey, parseAddress } from "@sendstack/shared";
import { inboundReceived, sendEvent } from "./client";

/**
 * Writing an inbound message, from either direction.
 *
 * Two things produce inbound mail: the `email.received` webhook, and the sync
 * below that reconciles against Resend's API. They must agree exactly on what
 * a row looks like and what happens after one appears — so there is one
 * implementation and both call it.
 */
export type InboundMetadata = {
  providerEmailId: string;
  /** Raw `Name <addr>` as the provider gives it. */
  from: string;
  to?: string[] | undefined;
  cc?: string[] | undefined;
  subject?: string | null | undefined;
  messageId?: string | null | undefined;
  /** ISO timestamp from the provider. */
  createdAt: string;
  attachmentCount?: number | undefined;
};

export type RecordResult = { id: string; threadKey: string; created: boolean };

/**
 * Anything that can run a drizzle query: `db` itself, or the `tx` handed to a
 * `db.transaction` callback. The webhook route passes its transaction so the
 * row lands in the same commit as the dedupe row — see `announceInboundEmail`
 * for why the side effects are *not* taken along.
 *
 * Now `Executor` from `@sendstack/db`, where the type expression belongs and
 * where the send worker's identical copy also went. Kept exported under this
 * name because the webhook route imports it from here; the alias is the
 * migration path, not a second definition.
 */
export type DbExecutor = Executor;

/**
 * The row an `InboundMetadata` becomes, for either an insert of one or an
 * insert of a page.
 *
 * Extracted so the two insert paths cannot disagree about a column. They must
 * produce byte-identical rows — a webhook and the reconciler routinely race on
 * the same message, and whichever loses the unique index has to be able to
 * treat the winner's row as its own.
 *
 * Addresses are parsed, not merely normalised: the provider gives headers, and
 * `"Ada" <ada@example.com>` lowercased is not an address.
 */
function inboundRow(meta: InboundMetadata): typeof inboundEmails.$inferInsert {
  const from = parseAddress(meta.from);
  const messageId = meta.messageId ?? null;

  return {
    providerEmailId: meta.providerEmailId,
    messageId,
    threadKey: deriveThreadKey({ messageId }),
    fromEmail: from.email,
    fromName: from.name,
    toEmails: (meta.to ?? []).map((value) => parseAddress(value).email),
    ccEmails: (meta.cc ?? []).map((value) => parseAddress(value).email),
    subject: meta.subject ?? null,
    hasAttachments: (meta.attachmentCount ?? 0) > 0,
    receivedAt: new Date(meta.createdAt),
  };
}

/**
 * Insert a message if it is new. The write only — no publish, no job.
 *
 * The row lands with metadata only — Resend's webhook carries no body, and the
 * list endpoint carries none either. `contentFetchedAt` stays null until the
 * `fetch-inbound-email` job pulls the body.
 *
 * `ON CONFLICT DO NOTHING` against the unique `provider_email_id` is what makes
 * this safe to call from both paths, repeatedly: a webhook retry and a sync
 * running over the same message converge on one row rather than racing.
 *
 * Split from `announceInboundEmail` because the two must run on different
 * sides of a commit. The webhook route runs this inside the transaction that
 * also records the event, so a handler failure rolls both back and the retry
 * is not deduped away from doing the work. The announcements have to wait for
 * that commit: a realtime event published from inside the transaction would
 * have the browser fetch a row it cannot see yet, and an Inngest job started
 * from inside it would find nothing to hydrate and fail as non-retriable.
 */
export async function recordInboundEmail(
  meta: InboundMetadata,
  executor: DbExecutor = db,
): Promise<RecordResult | null> {
  const [row] = await executor
    .insert(inboundEmails)
    .values(inboundRow(meta))
    .onConflictDoNothing({ target: inboundEmails.providerEmailId })
    .returning({ id: inboundEmails.id, threadKey: inboundEmails.threadKey });

  if (!row) {
    // Already present. Not an error — it is the expected outcome of a webhook
    // retry, and of every sync after the first.
    return null;
  }

  return { id: row.id, threadKey: row.threadKey, created: true };
}

/**
 * Tell the UI a message arrived, and queue the fetch of its body.
 *
 * Called with the result of `recordInboundEmail` once that row is committed.
 * Both effects are safe to repeat — the browser store dedupes on `emailId`
 * and the job is idempotent — so a caller that crashes between the two and
 * runs again does no damage. What is not safe is running them *before* the
 * commit, which is the only reason this is a separate function.
 */
export async function announceInboundEmail(
  record: RecordResult,
  meta: AnnounceMetadata,
): Promise<void> {
  await publishInbound(record, meta);
  await sendEvent(hydrateEvent(meta.providerEmailId, meta.createdAt));
  const from = parseAddress(meta.from);
  await notifyInbound(
    record,
    { fromEmail: from.email, fromName: from.name, subject: meta.subject ?? null, snippet: null },
    // The first notification for this message, so it alerts.
    { renotify: true },
  );
}

/**
 * The push for one arriving message, from whichever half of the arrival has
 * run.
 *
 * Inbound push used to live only in `storeInboundContent`, which runs in the
 * `fetch-inbound-email` job. That made the lock screen depend on Inngest: an
 * install with no job queue configured — which is every install until it is
 * set up — received mail, updated its inbox, and notified nobody, ever. The
 * webhook now notifies as soon as the row commits, and the hydrate replaces
 * that notification with one that has the body in it.
 *
 * **The tag is the message, not the thread, and that is what makes the pair
 * one notification.** A tag collapses notifications that share it, so the
 * second push overwrites the first rather than stacking beneath it — but
 * only if the two agree on the tag, and the two halves cannot agree on a
 * thread key: the webhook derives it from `message_id` alone, while hydrate
 * re-derives it from `in-reply-to` and `references`, which is the whole
 * point of hydrating. A message that joins an existing conversation changes
 * thread key between the two calls, and a thread-keyed tag would then leave
 * the metadata-only notification sitting on the lock screen next to its own
 * replacement. The row id does not move.
 *
 * The cost, stated plainly: three replies to one conversation are now three
 * notifications where they used to collapse into one. Duplicate notifications
 * for a *single* message is the worse failure — it is the one that makes
 * people turn notifications off — and it is the one the row id rules out.
 */
async function notifyInbound(
  record: RecordResult,
  content: {
    fromEmail: string;
    fromName: string | null;
    subject: string | null;
    snippet: string | null;
  },
  options: { renotify: boolean },
): Promise<void> {
  try {
    await broadcastPush({
      title: content.fromName?.trim() || content.fromEmail,
      body: notificationPreview(content.subject, content.snippet),
      // The thread reader for this message. `notificationclick` in the
      // service worker focuses an open window and navigates it here, so
      // tapping the notification lands on the mail rather than on the list.
      url: `/inbox/${record.id}`,
      tag: `inbound:${record.id}`,
      /**
       * The second push must not buzz again.
       *
       * A tag makes the replacement silent-*looking* but not silent:
       * `renotify` defaults to true in the worker, which re-alerts on every
       * replacement. That is right for a second event and wrong here, where
       * the two pushes are one message told twice — and a device that buzzes
       * twice per message is one whose owner turns notifications off, which
       * costs every future message rather than this one.
       */
      renotify: options.renotify,
    });
  } catch (error) {
    /**
     * Never fatal to the caller. `announceInboundEmail` runs after the
     * webhook's transaction has committed and `storeInboundContent` has
     * already stored the mail — in both cases the message is safe, and a
     * push service being slow or down must not turn that into a failed
     * handler and a ten-hour retry ladder that would re-notify rather than
     * re-store.
     */
    console.warn("[inbound] push notification failed", error);
  }
}

/** The fields an announcement needs. Less than a full `InboundMetadata`. */
type AnnounceMetadata = Pick<
  InboundMetadata,
  "providerEmailId" | "from" | "subject" | "createdAt"
>;

/**
 * The realtime half of an announcement, on its own.
 *
 * Split out because the reconciler announces a whole page at once — one
 * `sendEvent` for every message rather than one HTTP call per message — and
 * still has to publish per row, there being no batch publish. Building the
 * payload twice is how the browser ends up told one thing by the webhook and
 * another by the sync.
 */
async function publishInbound(record: RecordResult, meta: AnnounceMetadata): Promise<void> {
  const from = parseAddress(meta.from);

  await publishRealtime({
    type: "inbound.received",
    at: new Date().toISOString(),
    emailId: record.id,
    threadKey: record.threadKey,
    fromEmail: from.email,
    fromName: from.name,
    subject: meta.subject ?? null,
    snippet: null,
  });
}

/** The hydrate job's event. One definition, three emitters. */
function hydrateEvent(providerEmailId: string, receivedAt: string) {
  return inboundReceived.create({ providerEmailId, receivedAt });
}

/**
 * Phase two: fetch a message's body and fill in the row.
 *
 * Shared by the `fetch-inbound-email` job and the inline sync, because an
 * install with no background jobs configured — which is every install until
 * Inngest is set up — would otherwise show a permanent list of headerless
 * stubs. The button that exists to rescue an empty inbox must not depend on
 * the machinery that was not running when the inbox got empty.
 */
export async function hydrateInboundEmail(providerEmailId: string): Promise<boolean> {
  const content = await fetchInboundEmail(providerEmailId);
  return storeInboundContent(content);
}

/**
 * Write a fetched body onto its row and record its attachments.
 *
 * Separated from the provider fetch so that what gets run twice in a test is
 * exactly what production runs twice in life: the webhook-triggered job and
 * the hourly sync both hydrate a row whose body has not landed, and both must
 * produce one row and one attachment per provider attachment id. The UPDATE is
 * naturally idempotent; the attachment insert is idempotent only because of
 * the unique index on `(inbound_email_id, provider_attachment_id)`. The index
 * is the guarantee — before it existed there was no conflict for
 * `ON CONFLICT` to catch and every re-hydrate duplicated every attachment.
 * Naming the columns as the arbiter is documentation of *which* constraint is
 * being relied on; dropping the index breaks this whether they are named or
 * not, which `pipeline.duplicity.integration.test.ts` demonstrates.
 */
export async function storeInboundContent(content: NormalizedInbound): Promise<boolean> {
  // Match the sender to a known contact so the inbox can show history.
  // Deliberately does not *create* one: someone emailing us has not consented
  // to joining a mailing list.
  const [contact] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.email, content.fromEmail))
    .limit(1);

  const [row] = await db
    .update(inboundEmails)
    .set({
      messageId: content.messageId,
      inReplyTo: content.inReplyTo,
      references: content.references,
      threadKey: content.threadKey,
      subject: content.subject,
      snippet: content.snippet,
      html: content.html,
      text: content.text,
      headers: content.headers,
      hasAttachments: content.attachments.length > 0,
      ccEmails: content.ccEmails,
      contactId: contact?.id ?? null,
      contentFetchedAt: new Date(),
    })
    .where(eq(inboundEmails.providerEmailId, content.providerEmailId))
    .returning({ id: inboundEmails.id, threadKey: inboundEmails.threadKey });

  if (!row) return false;

  if (content.attachments.length > 0) {
    await db
      .insert(inboundAttachments)
      .values(
        content.attachments.map((attachment) => ({
          inboundEmailId: row.id,
          providerAttachmentId: attachment.providerAttachmentId,
          filename: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.size,
        })),
      )
      .onConflictDoNothing({
        target: [inboundAttachments.inboundEmailId, inboundAttachments.providerAttachmentId],
      });
  }

  await publishRealtime({
    type: "inbound.received",
    at: new Date().toISOString(),
    emailId: row.id,
    threadKey: row.threadKey,
    fromEmail: content.fromEmail,
    fromName: content.fromName,
    subject: content.subject,
    snippet: content.snippet,
  });

  /**
   * The second of the two pushes for this message, and the one worth
   * reading.
   *
   * The webhook already raised one from metadata the moment the row landed;
   * this replaces it — same tag, now with a snippet — because this is the
   * first point at which there is a body to preview. Neither is redundant:
   * the first is what makes the notification *timely* and what makes it
   * arrive at all on an install with no job queue, and this is what makes it
   * *useful*.
   *
   * Reached by the reconciler as well as the job, so a message the webhook
   * never delivered still notifies once, from here.
   */
  await notifyInbound(
    { id: row.id, threadKey: row.threadKey, created: true },
    {
      fromEmail: content.fromEmail,
      fromName: content.fromName,
      subject: content.subject,
      snippet: content.snippet,
    },
    /**
     * An improvement to a notification already on screen, so it updates in
     * place without alerting. On the reconciler's path — a message the
     * webhook never delivered — this is the *only* push for the message and
     * so the one that will not buzz; the mail is already in the inbox by
     * then, and a silent notification that is there when the phone is next
     * picked up is the right outcome for mail that arrived while the
     * webhook was down.
     */
    { renotify: false },
  );

  return true;
}

/**
 * The two lines of a notification, from a subject and a body snippet.
 *
 * The sender is the title, so this is the *preview* — and a preview of one
 * line is the difference between a notification worth unlocking a phone for
 * and one that says "New message". Both parts are included where both exist,
 * separated by an en dash, because a subject alone often says nothing ("Re:
 * following up") and a snippet alone loses the thread.
 *
 * Truncated at 140 characters. Every platform truncates anyway — Android at
 * roughly two lines, iOS at four, macOS at one — and doing it here means the
 * ellipsis lands on a word boundary instead of mid-syllable, and means the
 * payload stays inside the 4 kB a push service will carry.
 *
 * @param subject The message subject, possibly null or blank.
 * @param snippet The first part of the body, as stored by `hydrateInboundEmail`.
 * @returns A single line, never empty — a push with no body is allowed but
 *   reads as a bug.
 */
export function notificationPreview(
  subject: string | null | undefined,
  snippet: string | null | undefined,
): string {
  const parts = [subject?.trim(), snippet?.trim()].filter(
    (part): part is string => Boolean(part) && part !== "",
  );

  if (parts.length === 0) return "New message";
  return truncateOnWord(parts.join(" — "), 140);
}

/**
 * Cuts a string at the last space before `limit`, adding an ellipsis.
 *
 * Falls back to a hard cut when there is no space to break on, which covers a
 * single very long token — a URL, or a language that does not use spaces.
 *
 * @param text Already trimmed and non-empty.
 * @param limit Maximum length including the ellipsis.
 */
function truncateOnWord(text: string, limit: number): string {
  const collapsed = text.replace(/\s+/g, " ");
  if (collapsed.length <= limit) return collapsed;

  const cut = collapsed.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > limit / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export type SyncResult = {
  scanned: number;
  imported: number;
  /**
   * Stalled rows this call fetched a body for *itself*, inline.
   *
   * It used to add the queued rows to this as well, which made the number
   * meaningless: a run that hydrated nothing and queued a hundred jobs
   * reported `refetched: 100`, and the Sync button told the user a hundred
   * bodies had been re-fetched before a single one had been.
   */
  refetched: number;
  /** Stalled rows handed to the hydrate job instead of fetched here. */
  queued: number;
  pages: number;
};

/**
 * Insert a page of messages in one statement, returning only the new ones.
 *
 * The reconciler used to call `recordInboundEmail` in a loop and announce each
 * result inside it: at the 500-message cap that is 500 inserts, 500 Redis
 * publishes and 500 HTTP calls to Inngest, serially, inside one `step.run`.
 * The second phase in `syncInboundEmails` already had the right shape and this
 * follows it.
 *
 * `RETURNING` order is not the order the values went in — hence the lookup by
 * `provider_email_id` rather than by index. Getting that wrong would announce
 * one message's row under another message's subject.
 *
 * Rows that conflict are simply absent from `RETURNING`, which is what makes
 * this the same "did I create it?" answer `recordInboundEmail` gives: only a
 * genuinely new row is announced, so a reconciler pass over mail the webhook
 * already delivered publishes nothing and queues nothing.
 */
async function recordInboundPage(
  metas: InboundMetadata[],
): Promise<{ record: RecordResult; meta: InboundMetadata }[]> {
  if (metas.length === 0) return [];

  const rows = await db
    .insert(inboundEmails)
    .values(metas.map(inboundRow))
    .onConflictDoNothing({ target: inboundEmails.providerEmailId })
    .returning({
      id: inboundEmails.id,
      threadKey: inboundEmails.threadKey,
      providerEmailId: inboundEmails.providerEmailId,
    });

  const byProviderId = new Map(metas.map((meta) => [meta.providerEmailId, meta]));
  return rows.flatMap((row) => {
    const meta = byProviderId.get(row.providerEmailId);
    return meta ? [{ record: { id: row.id, threadKey: row.threadKey, created: true }, meta }] : [];
  });
}

/**
 * Pull every received message Resend holds and import anything missing.
 *
 * The inbox is fed by webhooks, which are fast but not guaranteed to have ever
 * arrived: the endpoint may have been unreachable, the webhook may not have
 * been configured yet, a deploy may have been mid-flight. Any message that
 * landed during such a window is invisible forever, because nothing ever
 * re-delivers it.
 *
 * Resend keeps received mail and exposes it, so the provider's API — not the
 * webhook stream — is the real source of truth for what arrived. This is the
 * same shape as the campaign-stats reconciler: the push path is a latency
 * optimisation, and a pull path makes it self-healing.
 *
 * It also fixes the second phase: a row whose body never arrived is re-queued
 * for content fetch, so a job that failed while Resend was briefly unavailable
 * is not permanently a headerless stub. Rows this same call just imported are
 * excluded from that phase — they were announced a few lines earlier and are
 * already being hydrated.
 *
 * A page costs a bounded number of round trips: one provider list call, one
 * multi-row INSERT, one `sendEvent` carrying every new message on the page,
 * and the publishes concurrently. It was one INSERT, one publish and one HTTP
 * call *per message*, serially, which at the 500-message cap is 1,500
 * sequential round trips inside a single Inngest step.
 */
export async function syncInboundEmails(options?: {
  /** Stop after this many messages. Bounds a first sync on a busy mailbox. */
  max?: number;
  /**
   * Fetch bodies directly instead of only queueing the job that would.
   *
   * The inline caller (the Sync button) sets this, because it has to work on
   * an install where Inngest is not configured. The scheduled reconciler
   * leaves it off and lets the job queue absorb the volume.
   */
  hydrate?: number;
}): Promise<SyncResult> {
  const client = await resendClient();
  const max = options?.max ?? 500;

  let cursor: string | undefined;
  let scanned = 0;
  let imported = 0;
  let pages = 0;
  /**
   * Provider ids this call has already emitted a hydrate job for.
   *
   * The repair phase selects on `content_fetched_at IS NULL`, which is true of
   * every row the loop below has just created — so it used to pick them
   * straight back up and emit a *second* hydrate job for each. Harmless (the
   * job is idempotent) and expensive: every message on a first sync cost two
   * provider fetches.
   *
   * Bounded by `max`, so at most 500 ids reach the `<> ALL` below as
   * parameters. That is a list, not a subquery, deliberately: the rows are
   * identified by what this call did, which no predicate on the table can
   * express.
   */
  const announced: string[] = [];

  while (scanned < max) {
    const response = await client.emails.receiving.list({
      limit: Math.min(100, max - scanned),
      ...(cursor ? { after: cursor } : {}),
    } as Parameters<typeof client.emails.receiving.list>[0]);

    if (response.error) {
      throw new Error(`Could not list received emails: ${response.error.message}`);
    }

    const payload = response.data as unknown as {
      data?: {
        id: string;
        from: string;
        to?: string[];
        cc?: string[] | null;
        subject?: string;
        message_id?: string;
        created_at: string;
        attachments?: unknown[];
      }[];
      has_more?: boolean;
    } | null;

    const batch = payload?.data ?? [];
    if (batch.length === 0) break;

    pages += 1;
    scanned += batch.length;

    /**
     * Keyed by provider id, which dedupes within the page as a side effect.
     * The provider has never returned one id twice; `ON CONFLICT DO NOTHING`
     * tolerates it in a single statement anyway (unlike `DO UPDATE`, which
     * errors with "cannot affect row a second time"), so this is belt and
     * braces rather than the guarantee.
     */
    const metas = new Map<string, InboundMetadata>();
    for (const message of batch) {
      metas.set(message.id, {
        providerEmailId: message.id,
        from: message.from,
        to: message.to,
        cc: message.cc ?? undefined,
        subject: message.subject ?? null,
        messageId: message.message_id ?? null,
        createdAt: message.created_at,
        attachmentCount: message.attachments?.length ?? 0,
      });
    }

    // Autocommit, so every row is visible before any of it is announced.
    const created = await recordInboundPage(Array.from(metas.values()));
    imported += created.length;

    if (created.length > 0) {
      /**
       * One request to Inngest for the page, then the publishes. Ordering is
       * deliberate: the hydrate jobs are the part that must not be lost — a
       * missed realtime event costs a browser one refresh, a missed hydrate
       * job leaves a permanent headerless stub — so they go first and a Redis
       * failure cannot strand them.
       */
      await sendEvent(
        created.map(({ meta }) => hydrateEvent(meta.providerEmailId, meta.createdAt)),
      );
      announced.push(...created.map(({ meta }) => meta.providerEmailId));

      // Concurrent rather than sequential: there is no batch publish, and a
      // hundred round trips one after another is the same N+1 in a different
      // transport.
      await Promise.all(created.map(({ record, meta }) => publishInbound(record, meta)));
    }

    if (!payload?.has_more) break;
    cursor = batch[batch.length - 1]?.id;
    if (!cursor) break;
  }

  /**
   * Second phase repair: rows that exist but never got a body.
   *
   * Excluding `announced` is what stops this from immediately undoing the work
   * above — those rows are `content_fetched_at IS NULL` by definition, so this
   * SELECT matched every one of them and queued a duplicate hydrate for each.
   * A brand-new three-message sync reported `{ imported: 3, refetched: 3 }`
   * with six hydrate jobs in flight for three messages.
   */
  const stalled = await db.execute<{ provider_email_id: string; received_at: string }>(sql`
    SELECT provider_email_id, received_at
    FROM inbound_emails
    WHERE content_fetched_at IS NULL
      AND provider_email_id <> ALL(${sqlArray(announced)})
    ORDER BY received_at DESC
    LIMIT 100
  `);

  const pending = Array.from(stalled);
  const inline = Math.min(options?.hydrate ?? 0, pending.length);
  let refetched = 0;
  const toQueue: { provider_email_id: string; received_at: string }[] = [];

  for (let index = 0; index < pending.length; index += 1) {
    const row = pending[index]!;
    if (index < inline) {
      try {
        if (await hydrateInboundEmail(row.provider_email_id)) refetched += 1;
        continue;
      } catch (error) {
        // Fall through to the queue — a body that cannot be fetched right now
        // is worth retrying with backoff rather than losing.
        console.warn("[inbound] inline hydrate failed", row.provider_email_id, error);
      }
    }
    toQueue.push(row);
  }

  // One request to Inngest for the whole list, not one per row: `send` takes
  // an array, and a hundred stalled rows used to be a hundred HTTP calls.
  if (toQueue.length > 0) {
    await sendEvent(
      toQueue.map((row) =>
        hydrateEvent(row.provider_email_id, new Date(row.received_at).toISOString()),
      ),
    );
  }

  // `refetched` is inline hydrations only; the queued rows are `queued`. They
  // used to be added together, and the total was reported to the user as
  // bodies already fetched.
  return { scanned, imported, refetched, queued: toQueue.length, pages };
}
