import { db, sql } from "@sendstack/db";
import { emailEvents } from "@sendstack/db/schema";
import {
  WebhookVerificationError,
  isDeliveryEvent,
  isHardBounce,
  isInboundEvent,
  recipientIdFromTags,
  verifyWebhook,
  webhookEventId,
} from "@sendstack/email";
import { broadcastPush } from "@sendstack/email";
import {
  announceInboundEmail,
  outboundStatusCase,
  eventAdvancesCase,
  recipientStatusCase,
  recordInboundEmail,
  type DbExecutor,
} from "@sendstack/jobs";
import { claimOnce, publishRealtime, releaseClaim } from "@sendstack/redis";
import {
  SOFT_BOUNCE_LIMIT,
  bareEvent,
  describeAccountEvent,
  isAccountEventType,
  isDeliveryEventName,
  outboundStatusForEvent,
  parseAddress,
  recipientStatusForEvent,
  suppressionReasonFromOrigin,
  type SuppressionReason,
} from "@sendstack/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every event Resend sends us arrives here.
 *
 * The contract this handler is written against, in order of how much trouble
 * each point causes when ignored:
 *
 *  1. **Verify against the raw body.** `request.text()`, never `request.json()`
 *     — re-serialising changes bytes and the signature will not match.
 *  2. **Assume duplicates.** Delivery is at-least-once with retries at 5s, 5m,
 *     30m, 2h, 5h and 10h. Two independent guards make replays free: a Redis
 *     claim, and a unique index on `email_events.provider_event_id`. The index
 *     is the real one — Redis can evict a key, so it is an optimisation and
 *     never the guarantee. The claim is *released* whenever this handler
 *     fails after winning it, so Redis can never answer "already seen" for
 *     an event Postgres never received; otherwise a transient database error
 *     would lose a webhook for the claim's 24-hour TTL, and only when Redis
 *     was configured.
 *  3. **The dedupe row and the side effects commit together.** The event row
 *     used to be inserted, committed, and only then acted on — so a handler
 *     that failed left behind a row that deduped every retry, and the
 *     suppression or status update it existed to perform never happened at
 *     all. One transaction means a failure rolls the row back with the work,
 *     and the next delivery genuinely is the first.
 *  4. **Announcements happen after the commit.** A realtime event published
 *     from inside the transaction tells the browser to fetch a row it cannot
 *     see yet, and a push notification cannot be un-sent if the transaction
 *     then rolls back. Both are collected and run once the data is durable.
 *  5. **Answer quickly.** Anything slow gets retried, which manufactures the
 *     duplicates in point 2. Persist, hand off to a job, return 200.
 *  6. **Return 200 for anything already handled or unrecognised.** A non-2xx
 *     puts the event back on the retry ladder for ten hours. Reserve failure
 *     for cases where retrying could actually help.
 *  7. **All nineteen event types are handled, in three families.** `email.received`
 *     is inbound; the `email.*` delivery events move statuses; and the ten
 *     account events — domains, Resend's contacts, Resend's suppression list —
 *     are described and announced by `handleAccountEvent`. Of those ten only
 *     `suppression.added` writes anything. A payload the describer cannot read
 *     is stored, logged and 200'd, never 500'd: Resend has changed payload
 *     shapes before, and a retry cannot fix a shape.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();

  let event;
  try {
    event = await verifyWebhook(rawBody, request.headers);
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      console.warn("[webhook] rejected:", error.message);
      return new Response("Invalid signature", { status: 400 });
    }
    throw error;
  }

  const eventId = webhookEventId(request.headers);
  if (!eventId) return new Response("Missing svix-id", { status: 400 });

  const claimKey = `webhook:${eventId}`;
  if (!(await claimOnce(claimKey))) {
    return Response.json({ ok: true, deduped: "redis" });
  }

  let outcome: { deduped: boolean; effects: AfterCommit[] };
  try {
    outcome = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(emailEvents)
        .values({
          providerEventId: eventId,
          type: event.type,
          providerMessageId: "email_id" in event.data ? event.data.email_id : null,
          payload: event as unknown as Record<string, unknown>,
          occurredAt: event.created_at ? new Date(event.created_at) : new Date(),
        })
        .onConflictDoNothing({ target: emailEvents.providerEventId })
        .returning({ id: emailEvents.id });

      // The conflict fired: a previous delivery of this same event already ran
      // the side effects, in its own transaction, so they are durable.
      // Returning rather than throwing keeps this a commit of nothing, instead
      // of a rollback that the caller could not tell from a real failure.
      if (inserted.length === 0) return { deduped: true, effects: [] };

      const effects: AfterCommit[] = [];
      if (isInboundEvent(event)) {
        await handleInbound(tx, event.data, effects);
      } else if (isDeliveryEvent(event)) {
        await handleDelivery(tx, event, eventId, effects);
      } else if (isAccountEventType(event.type)) {
        await handleAccountEvent(tx, event, eventId, effects);
      }
      return { deduped: false, effects };
    });
  } catch (error) {
    /**
     * Nothing is committed, so the retry has to be allowed through — and both
     * guards are cleared to allow it: the transaction rolled the event row
     * back, and the Redis claim is handed back here. Without the release,
     * Redis would answer "already seen" for 24 hours and the event would be
     * lost entirely.
     */
    await releaseClaim(claimKey);
    console.error("[webhook] failed, rolled back", { type: event.type, eventId, error });
    return new Response("Webhook handling failed", { status: 500 });
  }

  if (outcome.deduped) return Response.json({ ok: true, deduped: "database" });

  /**
   * Past the commit, so a failure here is not worth a retry: the data is
   * durable, and a retry would be deduped by the row that is now in place.
   *
   * What each dropped effect actually costs, since "log it and move on" is
   * only defensible if the answer is "little": a realtime event costs a
   * refresh, a push notification costs the notification, and
   * `announceInboundEmail` costs the message body until the hourly
   * `reconcile-inbound` cron re-enqueues the hydrate. All three are recovered
   * by something else, which is why a 200 is right — putting the event back on
   * a ten-hour retry ladder would re-run none of them anyway, because the row
   * now in place dedupes it.
   */
  for (const effect of outcome.effects) {
    try {
      await effect();
    } catch (error) {
      console.warn("[webhook] post-commit effect failed", { type: event.type, eventId, error });
    }
  }

  return Response.json({ ok: true });
}

/**
 * Work that must not run until the transaction has committed.
 *
 * Realtime publishes, push notifications and job enqueues all tell somebody
 * else to go and look at a row. Run inside the transaction they point at data
 * that is not visible yet — and that may never become visible.
 */
type AfterCommit = () => Promise<void>;

/**
 * Phase one of an inbound message: write what the webhook actually contains.
 *
 * Resend's `email.received` payload is metadata only — no body, no headers, no
 * attachment bytes. Those need a second API call, made by the
 * `fetch-inbound-email` job that `announceInboundEmail` enqueues after the
 * commit. Enqueued from inside the transaction, that job would race the commit
 * and find nothing to hydrate.
 */
async function handleInbound(
  tx: DbExecutor,
  data: {
    email_id: string;
    from: string;
    to: string[];
    cc?: string[];
    subject?: string;
    message_id?: string;
    created_at: string;
    attachments?: unknown[];
  },
  effects: AfterCommit[],
) {
  const meta = {
    providerEmailId: data.email_id,
    from: data.from,
    to: data.to,
    cc: data.cc,
    subject: data.subject ?? null,
    messageId: data.message_id ?? null,
    createdAt: data.created_at,
    attachmentCount: data.attachments?.length ?? 0,
  };

  // Shared with the reconciler that pulls from Resend's API, so a message
  // arriving by webhook and the same message arriving by sync produce an
  // identical row and identical follow-up work.
  const record = await recordInboundEmail(meta, tx);
  if (record) effects.push(() => announceInboundEmail(record, meta));
}

/**
 * Advance a recipient's delivery state.
 *
 * Correlation prefers the `recipient_id` tag we attach at send time over the
 * provider's message id, because the tag is unambiguous: it is our own row id
 * echoed back, where the message id depends on our having correctly paired a
 * batch response to its inputs.
 *
 * What an event means, and the "never move backwards" ladder that applies it,
 * both come from `@sendstack/shared` — the same rule the sent-mail reconciler
 * and the send worker use, rendered as SQL by `recipientStatusCase`. This
 * route used to carry its own copy of both and had already drifted from the
 * others: it dropped `delivery_delayed` on the floor, and it recorded a
 * complaint against a one-off message as a clean send.
 */
async function handleDelivery(
  tx: DbExecutor,
  event: { type: string; data: unknown },
  eventId: string,
  effects: AfterCommit[],
) {
  const data = event.data as {
    email_id?: string;
    to?: string[];
    tags?: Record<string, string>;
    bounce?: { type?: string; subType?: string; message?: string };
    failed?: { reason?: string };
    suppressed?: { message?: string; type?: string };
  };

  const incoming = recipientStatusForEvent(event.type);
  const recipientId = recipientIdFromTags(data.tags);
  const messageId = data.email_id ?? null;
  if (!recipientId && !messageId) return;

  const match = recipientId
    ? sql`cr.id = ${recipientId}::uuid`
    : sql`cr.provider_message_id = ${messageId}`;

  /**
   * Resend puts the reason under a different key for each kind of failure, and
   * this read only the bounce one.
   *
   * `email.bounced` carries `data.bounce.message`, `email.failed` carries
   * `data.failed.reason`, `email.suppressed` carries `data.suppressed.message`.
   * So every failure that was not a bounce stored `error IS NULL`: the row said
   * `failed`, the thread view had nothing to show for it, and the bounce push
   * notification — which names `error` — went out with no reason in it.
   *
   * The coalesce order is not a precedence rule. Exactly one of the three keys
   * is present on any given event, because each belongs to a different event
   * type, so reordering these would change nothing. Written as a chain rather
   * than a switch on `event.type` only because that is one fewer thing to keep
   * in step with `DELIVERY_EVENT_NAMES`.
   */
  const detail = data.bounce?.message ?? data.failed?.reason ?? data.suppressed?.message ?? null;

  /**
   * The address this event is about — parsed, not merely lowercased.
   *
   * Resend echoes back the `to` it was handed. For a campaign that is a bare
   * address, but a one-off reply carries whatever the composer put in the
   * header: `Audit Person <wh-audit@example.com>`. `normalizeEmail`, which
   * used to stand here, only trims and lowercases — so a complaint on such a
   * message inserted a `suppressions` row keyed on the whole display form.
   * That row can never match a send-path lookup, the `UPDATE contacts` beside
   * it matched zero rows, and the person who pressed "report spam" stayed
   * perfectly sendable. Invariant 5 failing silently is the worst way for it
   * to fail.
   *
   * `parseAddress` normalises the address it extracts, so it *replaces*
   * `normalizeEmail` here rather than wrapping it. Hoisted above the
   * `outbound_messages` update so the bounce notification can name the same
   * clean address instead of re-reading the raw header.
   */
  const address = data.to?.[0] ? parseAddress(data.to[0]).email : null;

  /**
   * Only the timestamp this event is evidence for is written, and only if it
   * is still null. The previous version set every timestamp column through a
   * `CASE` comparing two constants, which Postgres re-evaluated per row to
   * reach the answer this decides once, here.
   *
   * `error` is **first-wins**, matching the timestamps beside it and reversing
   * what it used to do. Written as `COALESCE(${detail}, cr.error)` it was
   * last-wins, in direct contradiction of the sentence above it: a hard bounce
   * recorded `550 no such user` and a later soft bounce on the same row buried
   * it under `552 full`, so a dead address read as a transient problem. The
   * first failure is the diagnosis worth keeping — it is the one that explains
   * why the send will never succeed — and anything after it is commentary on a
   * row whose `status` already says the message failed.
   */
  const columns = [
    sql`provider_message_id = COALESCE(cr.provider_message_id, ${messageId})`,
    sql`error = COALESCE(cr.error, ${detail})`,
  ];
  if (incoming === "delivered") columns.push(sql`delivered_at = COALESCE(cr.delivered_at, now())`);
  if (incoming === "opened") columns.push(sql`opened_at = COALESCE(cr.opened_at, now())`);
  if (incoming === "clicked") columns.push(sql`clicked_at = COALESCE(cr.clicked_at, now())`);
  if (incoming === "bounced" || incoming === "complained" || incoming === "failed") {
    columns.push(sql`failed_at = COALESCE(cr.failed_at, now())`);
  }

  await tx.execute(sql`
    UPDATE campaign_recipients cr SET
      status = ${recipientStatusCase(sql`cr.status`, incoming)},
      ${sql.join(columns, sql`, `)}
    WHERE ${match}
  `);

  /**
   * The same event, applied to a one-off message.
   *
   * This was missing, and its absence was the whole reason a reply sent from
   * the inbox showed no delivery state: the webhook updated
   * `campaign_recipients` and nothing else, so `outbound_messages.last_event`
   * was only ever written by the polling reconciler behind the Sync button.
   * A bounce on a reply was invisible until somebody thought to press it.
   *
   * Matched on `provider_message_id`, which `sendMessage` stores from Resend's
   * response — a one-off send carries no tag to correlate by.
   */
  if (messageId) {
    /**
     * `last_event` moves forward only.
     *
     * `status` was already protected — it goes through the generated ladder —
     * but `last_event` was an unconditional assignment, and the two disagreed
     * the moment events arrived out of order. Resend's retry ladder (5s, 5m,
     * 30m, 2h, 5h, 10h) makes that routine: an `email.opened` that failed to
     * deliver on its first attempt lands *after* the `email.bounced` that
     * followed it, and a bounced reply was left `status: 'failed'` with
     * `last_event: 'email.opened'`. `lib/queries/thread.ts` selects
     * `last_event` and the thread view renders it, so the bounce displayed as
     * "Opened".
     *
     * The guard is the ladder itself rather than a second ranking beside it.
     * `advanced` is `nextOutboundStatus(o.status, incoming)` rendered as SQL,
     * and it equals `incoming` precisely when the incoming event is not weaker
     * than the state the row already holds.
     *
     * **Which is coarser than the event vocabulary, and knowingly so.**
     * `sent`, `delivery_delayed`, `delivered`, `opened` and `clicked` all map
     * to the status `sent`, and `nextOutboundStatus("sent", "sent")` returns
     * `"sent"` — equal to `incoming` — so the `CASE` fires for any of them
     * against any other. A retried `email.delivered` landing after
     * `email.clicked` does relabel the row "Delivered". What the guard
     * actually promises is narrower than "moves forward only": **a failure is
     * never overwritten by a non-failure**, which is the case that matters,
     * because it is the one where the label decides whether the reply is shown
     * as having gone wrong at all. Ordering *within* the sent band is
     * cosmetic. Ranking events rather than statuses would fix it and would
     * mean a second ladder beside the one in `@sendstack/shared`; that trade
     * has not been made.
     *
     * A refused event still writes `status` (to the value it already had, by
     * definition of the ladder) and still publishes, so the browser refreshes
     * against Postgres — it simply does not get to relabel the row.
     * `last_event_at` carries the same guard, because a timestamp written for
     * a refused event would claim the *stored* event arrived when the refused
     * one did.
     */
    const incomingOutbound = outboundStatusForEvent(event.type);
    const advanced = outboundStatusCase(sql`o.status`, incomingOutbound);

    /**
     * Both ladders, ANDed. Neither alone is sufficient.
     *
     * The status half refuses an event weaker than the row's *status* — which
     * is what stops a late `opened` erasing a bounce, and what protects a row
     * our own send path failed with no event stored at all. The event half
     * refuses one weaker than the stored *event*, which the status half cannot
     * see: `sent`, `delivery_delayed`, `delivered`, `opened` and `clicked` all
     * map to the single status `sent`, so on its own the status guard accepted
     * any of them over any other and a retried `email.delivered` landing after
     * `email.clicked` relabelled the row "Delivered".
     *
     * Dropping either one is a regression with a test to prove it: the status
     * half by `"publishes failed for a failed row that has no stored event"`,
     * the event half by `"keeps the later event when an earlier one is
     * retried"`.
     */
    const statusAdvances = sql`(${advanced}) = ${incomingOutbound}::outbound_status`;
    const advances = sql`(${statusAdvances} AND ${eventAdvancesCase(sql`o.last_event`, event.type)})`;

    const outbound = await tx.execute<{
      id: string;
      thread_key: string;
      last_event: string | null;
      status: string;
      error: string | null;
    }>(sql`
      UPDATE outbound_messages o SET
        last_event = CASE WHEN ${advances} THEN ${bareEvent(event.type)} ELSE o.last_event END,
        last_event_at = CASE WHEN ${advances} THEN now() ELSE o.last_event_at END,
        status = ${advanced},
        error = COALESCE(o.error, ${detail}),
        updated_at = now()
      WHERE o.provider_message_id = ${messageId}
      RETURNING o.id, o.thread_key, o.last_event, o.status, o.error
    `);

    const [row] = Array.from(outbound);
    if (row) {
      /**
       * The event the **row** now holds, not the one that just arrived.
       *
       * This is the other half of the ladder above, and without it that
       * ladder was decorative. `RETURNING` reads post-`UPDATE` values, so
       * `row.last_event` is the laddered result: the incoming event when it
       * advanced, the stored one when it was refused.
       *
       * Publishing the incoming event instead reintroduced the exact bug the
       * `CASE` was written to fix, by a different route. `message-card.tsx`
       * prefers the live store over the server-rendered row, and the store's
       * own "never moves backwards" guard can only compare against a previous
       * *live* event. So for a bounce that happened before the page loaded —
       * in the row, not in the store — a late `email.opened` had nothing to be
       * refused against: it landed, won over `item.lastEvent`, and relabelled
       * a failed reply as "Opened" with no error state. Postgres was right the
       * whole time and the screen disagreed with it, which is precisely what
       * "realtime is latency, never correctness" forbids.
       *
       * `isDeliveryEventName` narrows rather than casts, because what the
       * column holds is wider than the eight names the realtime contract
       * carries. Two things reach the fallback:
       *
       *  - `NULL`, which is the common one. `sendSingleEmail`'s failure path
       *    in `actions/thread.ts` and `actions/compose.ts` writes `status`
       *    and `error` and no `last_event` at all, so a provider event for a
       *    row we had already given up on finds nothing stored.
       *  - `canceled`, `suppressed`, `queued` and `scheduled`, from
       *    `emails.list()`'s wider vocabulary. The reconciler in
       *    `packages/jobs/src/outbound-store.ts` puts `status` through the
       *    shared ladder but writes `last_event = v.event` unguarded, so the
       *    column can hold a pre-send state on a row that has already failed.
       *
       * Both are safe to report as `failed`, and that is not a guess.
       * `nextOutboundStatus` refuses an incoming event only when the stored
       * status is already `failed` and the incoming one is not — every
       * `failed` incoming event advances, by the ladder's own first line. So
       * reaching this branch *is* proof the row is failed. The `"sent"` arm is
       * therefore unreachable and exists to keep the expression total rather
       * than to describe a case.
       */
      // The column holds only bare names — constraint `outbound_last_event_bare`
      // — so this is the stored value, untouched.
      const stored = row.last_event;
      const published = stored && isDeliveryEventName(stored)
        ? stored
        : row.status === "failed"
          ? "failed"
          : "sent";

      effects.push(() =>
        publishRealtime({
          type: "outbound.updated",
          at: new Date().toISOString(),
          messageId: row.id,
          threadKey: row.thread_key,
          event: published,
          /**
           * The stored error, for the same reason as the stored event.
           *
           * `error` is written first-wins (`COALESCE(o.error, …)`), so a
           * refused event must not broadcast its own detail beside an event
           * the row rejected — the card renders `live?.detail` in preference
           * to the row's, and the pair would then describe two different
           * events. In practice only bounces and failures carry a detail and
           * those always advance, so this agrees with the old value on every
           * path that has one; it is the disagreeing paths that matter.
           */
          detail: row.error,
        }),
      );

      /**
       * A bounce or a complaint is worth interrupting someone about.
       *
       * Everything else here is informational — a delivery or an open belongs
       * in the thread, not on a lock screen. A reply that did not arrive is
       * the one case where the sender needs to know now, because the useful
       * response is to try another address.
       *
       * A complaint joins them on the same test, and is arguably the more
       * urgent of the two: it suppresses the address immediately (below) and
       * it is the event that damages sending reputation, so an operator
       * watching a campaign go out needs to see it while the campaign is
       * still going out. It gets its own title because "could not be
       * delivered" is the wrong sentence for a message that arrived and was
       * marked as spam.
       */
      if (
        event.type === "email.bounced" ||
        event.type === "email.failed" ||
        event.type === "email.complained"
      ) {
        const complaint = event.type === "email.complained";
        effects.push(async () => {
          await broadcastPush({
            title: complaint ? "Message marked as spam" : "Message could not be delivered",
            /**
             * The stored error, then the incoming one — the same first-wins
             * order as `error` itself and as the realtime publish above.
             *
             * `error` is written `COALESCE(o.error, …)`, so on a second bounce
             * the row keeps the first diagnosis while `detail` holds the
             * second. Using `detail` alone meant the notification named a
             * reason the thread view did not show.
             *
             * The address is the parsed one, not the raw header: a lock-screen
             * line reading `Audit Person <a@b.com> did not receive…` is the
             * same unparsed value that broke the suppression write below.
             */
            body: complaint
              ? `${address ?? "A recipient"} marked your message as spam. The address has been suppressed.`
              : (row.error ??
                detail ??
                `${address ?? "The recipient"} did not receive your message.`),
            url: complaint ? "/suppressions" : "/sent",
            /**
             * Distinct per outcome, so a complaint arriving after a bounce on
             * the same message does not silently replace it. They are two
             * different things to know and the tag is what decides whether
             * the second one is heard.
             */
            tag: `${complaint ? "complaint" : "bounce"}:${row.id}`,
          });
        });
      }
    }
  }

  if (!address) return;

  /**
   * A delivery clears the soft-bounce counter.
   *
   * `SOFT_BOUNCE_LIMIT` is a threshold on *consecutive* failures — that is
   * what `packages/email/src/webhooks.ts` documents and what the suppression
   * detail below literally writes — but nothing ever reset the count, so it
   * was a lifetime total wearing the word "consecutive". A contact whose
   * mailbox was full on three separate occasions across two years, with every
   * other message delivered, was permanently suppressed and told the bounces
   * ran back to back.
   *
   * `email.delivered` and not `email.sent`: `sent` only means the provider
   * accepted the message, while a soft bounce is the receiving server
   * refusing it. Only an actual delivery is evidence the mailbox is working
   * again, and `incoming` is the shared mapping's answer rather than a second
   * reading of the event name.
   *
   * `soft_bounce_count > 0` keeps this a no-op for the overwhelming majority
   * of deliveries — zero rows touched, and no `updated_at` churn across every
   * contact that has never bounced. One statement, so it cannot interleave
   * with a concurrent increment the way a read-then-write would.
   */
  if (incoming === "delivered") {
    await tx.execute(sql`
      UPDATE contacts
      SET soft_bounce_count = 0, updated_at = now()
      WHERE email = ${address} AND soft_bounce_count > 0
    `);
    return;
  }

  if (event.type === "email.complained") {
    await suppress(tx, address, "complaint", "Recipient marked the message as spam", eventId, effects);
    return;
  }

  if (event.type === "email.bounced") {
    if (isHardBounce(data.bounce)) {
      await suppress(tx, address, "hard_bounce", detail, eventId, effects);
      return;
    }

    /**
     * A soft bounce is transient, so one is not grounds for suppression. The
     * counter and the threshold check happen in a single statement — read the
     * count in Node and write it back and two concurrent bounce webhooks both
     * read 2, both write 3, and the address never reaches the limit.
     */
    const rows = await tx.execute<{ soft_bounce_count: number }>(sql`
      UPDATE contacts
      SET soft_bounce_count = soft_bounce_count + 1, updated_at = now()
      WHERE email = ${address}
      RETURNING soft_bounce_count
    `);
    const count = Array.from(rows)[0]?.soft_bounce_count ?? 0;
    if (count >= SOFT_BOUNCE_LIMIT) {
      await suppress(
        tx,
        address,
        "soft_bounce_limit",
        `${count} consecutive soft bounces`,
        eventId,
        effects,
      );
    }
  }
}

/**
 * The ten Resend events that are about the account rather than a message.
 *
 * Domains, Resend's own contact audience, and Resend's suppression list. All
 * ten were stored in `email_events` and acted on by nothing, so a sending
 * domain that stopped verifying — which breaks every subsequent send — was
 * discoverable only by reading the raw event table.
 *
 * **Only one of the ten writes anything.** `suppression.added` is mirrored,
 * because a do-not-send decision that lives only in Resend's dashboard would
 * make invariant 5 false for our own send paths: they check the local
 * `suppressions` table, not the provider. Everything else notifies and stops:
 *
 *  - `suppression.removed` deliberately does **not** delete locally. Resend
 *    removing its own entry is not evidence the address is safe; ours may have
 *    come from a complaint, and un-suppressing on a provider event would be a
 *    silent way to mail somebody who asked us not to.
 *  - `contact.*` write nothing at all. `contacts` is ours — it is populated by
 *    imports and by the app — and mirroring Resend's audience into it would
 *    mean a `contact.deleted` cascading through `campaign_recipients`
 *    (`onDelete: "cascade"`) and erasing the campaign history that the
 *    campaign counters are reconciled against.
 *  - `domain.*` have nothing local to write; the value is entirely in being
 *    told.
 */
async function handleAccountEvent(
  tx: DbExecutor,
  event: { type: string; data: unknown },
  eventId: string,
  effects: AfterCommit[],
) {
  const activity = describeAccountEvent(event.type, event.data);

  /**
   * A payload we cannot describe is stored and ignored — rule 6 in the
   * docblock at the top of this file. Resend has changed payload shapes
   * before; a 500 here would put an event on a ten-hour retry ladder that
   * cannot succeed, and drop nothing but a notification if it did.
   */
  if (!activity) {
    console.warn("[webhook] account event not describable", { type: event.type, eventId });
    return;
  }

  if (activity.kind === "suppression.added") {
    await suppress(
      tx,
      activity.subject,
      suppressionReasonFromOrigin(activity.origin),
      `Added to Resend's suppression list (${activity.origin ?? "origin not reported"})`,
      eventId,
      effects,
    );
  }

  effects.push(() =>
    publishRealtime({
      type: "account.activity",
      at: new Date().toISOString(),
      eventId,
      ...activity,
    }),
  );

  /**
   * Three of the ten are worth interrupting somebody about, on the same test
   * the bounce notification above uses: does the useful response have to
   * happen now?
   *
   * A domain that changed or vanished stops mail leaving the building, and an
   * address Resend refuses is one an operator may want to look at. A domain
   * being *created* is something the operator just did themselves, and
   * contacts and suppression removals change nothing about whether sending
   * works — those stay in the bell.
   */
  const push =
    activity.kind === "domain.updated"
      ? { title: "Sending domain changed", tag: `domain:${activity.subject}` }
      : activity.kind === "domain.deleted"
        ? { title: "Sending domain removed", tag: `domain:${activity.subject}` }
        : activity.kind === "suppression.added"
          ? { title: "Address suppressed by Resend", tag: `suppression:${activity.subject}` }
          : null;

  if (push) {
    effects.push(async () => {
      await broadcastPush({
        title: push.title,
        body: activity.summary,
        url: activity.href ?? "/settings?tab=email",
        tag: push.tag,
      });
    });
  }
}

/** Add to the do-not-send list and mark the contact, then tell the UI. */
async function suppress(
  tx: DbExecutor,
  email: string,
  reason: SuppressionReason,
  detail: string | null,
  eventId: string,
  effects: AfterCommit[],
) {
  await tx.execute(sql`
    INSERT INTO suppressions (email, reason, detail, source_event_id)
    VALUES (${email}, ${reason}::suppression_reason, ${detail}, ${eventId})
    ON CONFLICT (email) DO NOTHING
  `);

  /**
   * Whether the contact row is marked too, which depends on what the reason is
   * evidence *of*.
   *
   * This used to be unconditional — `complaint` became `complained` and
   * everything else became `bounced` — which was correct while the only three
   * callers were a hard bounce, a soft-bounce limit and a complaint. Resend's
   * `suppression.added` widened the input: an operator adding an address by
   * hand in Resend's dashboard arrives here as `manual`, and calling that a
   * bounce would put "Bounced" against a mailbox nobody has claimed is dead.
   *
   * A null status is not a weaker suppression. The `suppressions` row above is
   * what every send path consults (`isUnsendable`, `packages/db/src/suppression.ts`),
   * so the address is blocked either way; the contact's status is a statement
   * about the mailbox's health, and for a manual entry we have none to make.
   */
  const contactStatus =
    reason === "complaint"
      ? "complained"
      : reason === "hard_bounce" || reason === "soft_bounce_limit"
        ? "bounced"
        : null;

  if (contactStatus) {
    await tx.execute(sql`
      UPDATE contacts
      SET status = ${contactStatus}::contact_status,
          updated_at = now()
      WHERE email = ${email}
    `);
  }

  effects.push(() =>
    publishRealtime({
      type: "suppression.added",
      at: new Date().toISOString(),
      email,
      reason,
    }),
  );
}

/** Resend also pings the endpoint to confirm it is reachable. */
export async function GET() {
  return Response.json({ ok: true, endpoint: "resend-webhook" });
}
