import { cron } from "inngest";
import { db, sql } from "@sendstack/db";
import { campaignCancelRequested, campaignQueueRequested, eventData, inngest } from "../client";
import { syncSentEmails, type SentSyncResult } from "../outbound-store";
import { reconcileOrSkip } from "../reconcile";

/**
 * Campaigns left `sending` with nothing sending them, claimed for a re-emit.
 *
 * The state is unmistakable and unreachable any other way: `claimCampaignForQueue`
 * sets `started_at` in the same UPDATE that takes the campaign, so a `sending`
 * row with a null `started_at` is one the scheduler moved and the queue job
 * never received. Five minutes is the grace period — long enough that a run
 * merely in flight is not re-emitted underneath itself, short enough that a
 * scheduled campaign is not visibly late.
 *
 * `UPDATE … RETURNING`, not `SELECT`: the write *is* the claim, so two
 * overlapping ticks cannot both pick up the same row, and bumping `updated_at`
 * self-throttles a campaign that stays stranded to one re-emit every five
 * minutes rather than one a minute forever. CLAUDE.md §7 — never
 * read-then-write across an await without the database arbitrating.
 *
 * Exported so it can be executed by a test rather than retyped into one. It
 * returns ids and takes no argument for the same reason `claim-due` does: the
 * caller's only job is to emit for what came back.
 */
export async function reclaimStrandedCampaigns(): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE campaigns
    SET updated_at = now()
    WHERE status = 'sending'
      AND started_at IS NULL
      AND updated_at < now() - interval '5 minutes'
    RETURNING id
  `);
  return Array.from(rows).map((row) => row.id);
}

/**
 * Picks up campaigns whose scheduled time has arrived.
 *
 * The claim is the `UPDATE ... WHERE status = 'scheduled'` itself: it flips the
 * row to `sending` and only the run whose UPDATE actually matched proceeds. So
 * two overlapping cron ticks — or two instances during a deploy — cannot both
 * emit for the same campaign. Selecting first and updating after would leave
 * exactly that race open.
 *
 * This is a dedupe of *emits*, not the materialisation guard. A campaign sent
 * with "Send now" is also `scheduled` with `scheduled_at = now()`, so this
 * tick will find it and emit a second `queue.requested` for it; the receiving
 * job's own claim on `started_at IS NULL` is what makes that second event a
 * no-op. See `claimCampaignForQueue`.
 *
 * The second step is the other half of that: the claim and the emit are
 * separate Inngest steps, and a step is memoised only once its result has been
 * *acknowledged*. Lose that acknowledgement — a killed worker, a network
 * partition on the way back to Inngest — and the retry re-runs `claim-due`,
 * finds no `scheduled` rows because the first attempt already moved them, and
 * returns `[]`. The campaign is then `sending` with `started_at IS NULL`, no
 * recipients, and nothing anywhere ever emits for it again. Recovering it by
 * hand was the only option.
 *
 * Restructuring the steps cannot close this — the gap is inherent to a claim
 * and an emit not being one atomic act — so the cron re-emits for that state
 * instead, five minutes after it was last touched. `claimCampaignForQueue`
 * accepts `sending` with a null `started_at` exactly once, so a duplicate
 * emission (the original acknowledgement having arrived after all) is absorbed
 * the same way "Send now" plus the cron already is.
 */
export const scheduleDueCampaigns = inngest.createFunction(
  {
    id: "schedule-due-campaigns",
    name: "Dispatch scheduled campaigns",
    triggers: [cron("* * * * *")],
  },
  async ({ step }) => {
    const due = await step.run("claim-due", async () => {
      const rows = await db.execute<{ id: string }>(sql`
        UPDATE campaigns
        SET status = 'sending'::campaign_status, updated_at = now()
        WHERE status = 'scheduled'
          AND scheduled_at IS NOT NULL
          AND scheduled_at <= now()
        RETURNING id
      `);
      return Array.from(rows).map((row) => row.id);
    });

    // Ordering is load-bearing: `claim-due` above just set `updated_at = now()`
    // on everything it took, so nothing it claimed can also look stranded.
    const recovered = await step.run("recover-stranded", reclaimStrandedCampaigns);

    const emit = [...due, ...recovered];
    if (emit.length === 0) return { dispatched: 0, recovered: 0 };

    await step.sendEvent(
      "queue-due",
      emit.map((campaignId) => campaignQueueRequested.create({ campaignId })),
    );

    return { dispatched: due.length, recovered: recovered.length };
  },
);

/**
 * Rebuilds the denormalised counters on campaigns that are still moving.
 *
 * The counters are incremented optimistically by the send job and the webhook
 * handler, and either can miss — a dropped webhook, a run that died between
 * the recipient update and the campaign update. This reconciles them against
 * `campaign_recipients`, which is the source of truth, so the dashboard
 * converges on the correct numbers instead of drifting forever.
 *
 * Scoped to campaigns that are `sending` or `paused`, plus anything that
 * completed in the last two days — long enough for the tail of opens and
 * clicks that a finished campaign still collects. Before the scope existed the
 * aggregate ran over every recipient row ever written, every fifteen minutes,
 * to recompute numbers for campaigns from last year that could not have
 * changed.
 *
 * `sent` is `count(*) FILTER (WHERE sent_at IS NOT NULL)` rather than a status
 * list, so it agrees with the worker's optimistic `sent_count`: a recipient
 * that was sent and then bounced still counts as sent — the message left —
 * where a status-based count silently dropped it and the two numbers never
 * matched.
 */
export const reconcileCampaignStats = inngest.createFunction(
  {
    id: "reconcile-campaign-stats",
    name: "Reconcile campaign counters",
    triggers: [cron("*/15 * * * *")],
  },
  async ({ step }) => {
    return step.run("recompute", async () => {
      const rows = await db.execute<{ id: string }>(sql`
        UPDATE campaigns c SET
          sent_count       = s.sent,
          delivered_count  = s.delivered,
          opened_count     = s.opened,
          clicked_count    = s.clicked,
          bounced_count    = s.bounced,
          complained_count = s.complained,
          failed_count     = s.failed,
          suppressed_count = s.suppressed,
          total_recipients = s.total,
          updated_at = now()
        FROM (
          SELECT campaign_id,
            count(*) AS total,
            count(*) FILTER (WHERE sent_at IS NOT NULL) AS sent,
            count(*) FILTER (WHERE status IN ('delivered','opened','clicked')) AS delivered,
            count(*) FILTER (WHERE status IN ('opened','clicked')) AS opened,
            count(*) FILTER (WHERE status = 'clicked') AS clicked,
            count(*) FILTER (WHERE status = 'bounced') AS bounced,
            count(*) FILTER (WHERE status = 'complained') AS complained,
            count(*) FILTER (WHERE status = 'failed') AS failed,
            count(*) FILTER (WHERE status = 'suppressed') AS suppressed
          FROM campaign_recipients
          WHERE campaign_id IN (
            SELECT id FROM campaigns
            WHERE status IN ('sending', 'paused')
               OR completed_at > now() - interval '2 days'
          )
          GROUP BY campaign_id
        ) AS s
        WHERE c.id = s.campaign_id
          AND c.updated_at < now() - interval '1 minute'
        RETURNING c.id
      `);
      return { reconciled: Array.from(rows).length };
    });
  },
);

/**
 * Cancel the recipient rows of a campaign the user has already cancelled.
 *
 * The status flip on `campaigns` happens in the Server Action, guarded by
 * `WHERE status IN (...)` so the person clicking gets an answer — "already
 * finished" — rather than an event that vanishes into a queue. What is left
 * for the job is the part that can be large: relabelling every `pending` row,
 * which on a 200k campaign is not something a request should wait on.
 *
 * Only `pending` rows, not `sending`. A row is `sending` solely while a batch
 * transaction is in flight, and that transaction will write `sent` or `failed`
 * on commit — writing `cancelled` here would either lose to it or, worse, be
 * overwritten by a message that actually went. The claim's own `EXISTS` check
 * on the campaign status is what stops the *next* batch.
 */
export const cancelCampaign = inngest.createFunction(
  { id: "cancel-campaign", name: "Cancel campaign", triggers: [campaignCancelRequested] },
  async ({ event, step }) => {
    const { campaignId } = eventData("campaign/cancel.requested", event.data);
    const cancelled = await step.run("cancel-recipients", async () => {
      const rows = await db.execute<{ id: string }>(sql`
        UPDATE campaign_recipients
        SET status = 'cancelled'::recipient_status
        WHERE campaign_id = ${campaignId}::uuid
          AND status = 'pending'
          AND EXISTS (
            SELECT 1 FROM campaigns WHERE id = ${campaignId}::uuid AND status = 'cancelled'
          )
        RETURNING id
      `);
      return Array.from(rows).length;
    });
    return { campaignId, cancelled };
  },
);

/**
 * Reconciles sent mail and its delivery status against Resend.
 *
 * Delivery webhooks are the fast path and not a guarantee: an endpoint that
 * was unreachable — or a webhook that was never configured at all — leaves
 * every message permanently stuck at whatever status it had when it left,
 * because nothing re-delivers those events.
 *
 * `emails.list()` carries a `last_event` for every message, so this closes the
 * hole the same way `reconcile-inbound` does for received mail. Hourly, and
 * offset from the inbound reconciler so the two do not contend for the same
 * rate limit.
 */
export const reconcileSent = inngest.createFunction(
  {
    id: "reconcile-sent",
    name: "Reconcile sent mail against Resend",
    triggers: [cron("42 * * * *")],
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    // Annotated, so an omitted field in the skip result is a compile error
    // here rather than a silent widening — `reconcileOrSkip`'s `T` is pinned
    // by this annotation. The fallback had been missing `rejoined` before the
    // annotation existed, and every caller reading `result.rejoined` got
    // `number | undefined`. See `reconcile.ts` for which failures skip at all.
    return step.run("sync", async (): Promise<SentSyncResult> =>
      reconcileOrSkip("[outbound]", () => syncSentEmails({ max: 500 }), {
        scanned: 0,
        updated: 0,
        imported: 0,
        rejoined: 0,
        campaignUpdated: 0,
        pages: 0,
      }),
    );
  },
);
