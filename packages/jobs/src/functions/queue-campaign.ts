import { NonRetriableError } from "inngest";
import { deliverabilityReport } from "@sendstack/config";
import { and, db, eq, inArray, isNull, isUnsendable, sql } from "@sendstack/db";
import { campaigns } from "@sendstack/db/schema";
import { campaignQueueRequested, campaignSendRequested, eventData, inngest } from "../client";

type Campaign = typeof campaigns.$inferSelect;

/**
 * Take ownership of a campaign for materialisation, or return null.
 *
 * The claim is the UPDATE itself: `started_at IS NULL` is the one-shot guard,
 * and the row that wins it is the only one that goes on to insert recipients.
 * Everything that can deliver `campaign/queue.requested` twice for one
 * campaign — and there are several — is absorbed here:
 *
 *  - `sendCampaignNow` sets `scheduled` with `scheduled_at = now()` and emits
 *    the event; within sixty seconds the cron finds the same row due, flips
 *    it to `sending` and emits again. The second run finds `started_at` set
 *    and stops.
 *  - The cron's own flip can land *between* the action's UPDATE and this
 *    claim, which is why `sending` is accepted alongside `scheduled`: the row
 *    is still unmaterialised, and refusing it is what used to make every
 *    scheduled campaign fail with "already sending".
 *  - A replayed event, a double-clicked button, a deploy mid-run: all the
 *    same shape.
 *
 * `draft`, `paused`, `sent`, `cancelled` and anything already started return
 * null; the caller turns that into a `NonRetriableError`, because none of
 * those states become claimable by waiting.
 */
export async function claimCampaignForQueue(campaignId: string): Promise<Campaign | null> {
  const [row] = await db
    .update(campaigns)
    .set({ status: "sending", startedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(campaigns.id, campaignId),
        inArray(campaigns.status, ["scheduled", "sending"]),
        isNull(campaigns.startedAt),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * One `INSERT ... SELECT` for the whole audience.
 *
 * The selection happens inside Postgres rather than by streaming contacts
 * through Node. A 200k-contact list would otherwise mean 200k rows over the
 * wire, held in memory, inserted in chunks — slow, and a run that dies halfway
 * leaves an ambiguous partial state.
 *
 * *Every* list member gets a row, including the ones that will never be sent
 * to. Suppressed and inactive contacts are inserted and then marked
 * `suppressed` by `applyQueueSuppressions`, so the campaign carries a complete
 * audit of who was considered and why they were skipped. Filtering them out in
 * the SELECT would have been cheaper and would have left no trace — and "why
 * didn't Dana get this?" is a question that gets asked.
 *
 * `ON CONFLICT DO NOTHING` against the (campaign_id, contact_id) unique index
 * is what makes this safe to run twice: a retry converges instead of
 * duplicating. That index, not this function, is the reason a retry cannot
 * produce two copies of one email.
 */
export async function materialiseRecipients(campaignId: string, listId: string | null): Promise<void> {
  // A null listId means "everyone" — used for announcements. The two arms
  // differ only in their join.
  const source = listId
    ? sql`
        SELECT c.id, c.email
        FROM contacts c
        JOIN list_members lm ON lm.contact_id = c.id
        WHERE lm.list_id = ${listId}
          AND lm.unsubscribed_at IS NULL
      `
    : sql`SELECT c.id, c.email FROM contacts c`;

  await db.execute(sql`
    INSERT INTO campaign_recipients (campaign_id, contact_id, email, status)
    SELECT ${campaignId}::uuid, s.id, s.email, 'pending'::recipient_status
    FROM (${source}) AS s
    ON CONFLICT (campaign_id, contact_id) DO NOTHING
  `);
}

/**
 * Mark the recipients that must not be mailed, and say how many.
 *
 * The condition is `isUnsendable` from `@sendstack/db` — the one definition of
 * the do-not-send rule, shared with `suppressLateArrivals` (the claim-time
 * re-check that guards the send itself) and with the one-to-one paths. It used
 * to be written out here and again there, kept in step by a promise in a
 * docstring; the two had already drifted once, and invariant 5 says every send
 * path checks suppression — two checks that disagree means one of them does
 * not.
 *
 * Idempotent by construction: it only touches `pending` rows, so a second pass
 * finds nothing.
 */
export async function applyQueueSuppressions(campaignId: string): Promise<number> {
  const result = await db.execute<{ count: string }>(sql`
    WITH marked AS (
      UPDATE campaign_recipients cr
      SET status = 'suppressed'::recipient_status
      FROM contacts c
      WHERE cr.contact_id = c.id
        AND cr.campaign_id = ${campaignId}::uuid
        AND cr.status = 'pending'
        AND ${isUnsendable({ contact: "c", email: sql`cr.email` })}
      RETURNING 1
    )
    SELECT count(*)::text AS count FROM marked
  `);
  return Number(result[0]?.count ?? 0);
}

/**
 * Materialise the recipient list for a campaign.
 *
 * The first step is the claim — see `claimCampaignForQueue` — and everything
 * after it is a set-based statement that converges on re-run. The status flip
 * and `started_at` are written by the claim, not at the end: a campaign is
 * "started" the moment something has taken responsibility for it, and writing
 * that last would leave a window in which a second run could take it too.
 */
export const queueCampaign = inngest.createFunction(
  {
    id: "queue-campaign",
    name: "Queue campaign recipients",
    // One materialisation per campaign at a time. Without this, a double-click
    // on "Send" starts two runs that race on the same rows.
    triggers: [campaignQueueRequested],
    concurrency: { key: "event.data.campaignId", limit: 1 },
    retries: 3,
  },
  async ({ event, step }) => {
    const { campaignId } = eventData("campaign/queue.requested", event.data);

    const campaign = await step.run("claim-campaign", async () => {
      const row = await claimCampaignForQueue(campaignId);
      if (!row) {
        throw new NonRetriableError(
          `Campaign ${campaignId} is not claimable: it is missing, already started, or not scheduled.`,
        );
      }

      /**
       * The same check the Send button makes, repeated here because a campaign
       * scheduled last week runs against this week's settings — and the window
       * between the two is exactly where someone changes the app URL.
       *
       * It runs before a single recipient row is materialised, and puts the
       * campaign back to `draft` rather than leaving a `scheduled` row that
       * the cron will pick up again in sixty seconds and fail identically.
       * `started_at` is cleared too — the claim above set it, and a draft that
       * kept it could never be claimed again.
       */
      const report = await deliverabilityReport();
      if (!report.canSendCampaigns) {
        await db
          .update(campaigns)
          .set({ status: "draft", scheduledAt: null, startedAt: null, updatedAt: new Date() })
          .where(eq(campaigns.id, campaignId));

        throw new NonRetriableError(
          `Campaign ${campaignId} was returned to draft rather than sent: ` +
            report.blocking.map((check) => `${check.title} — ${check.detail}`).join(" "),
        );
      }

      return row;
    });

    await step.run("insert-recipients", () => materialiseRecipients(campaignId, campaign.listId));

    const suppressed = await step.run("apply-suppressions", () =>
      applyQueueSuppressions(campaignId),
    );

    const total = await step.run("update-totals", async () => {
      const result = await db.execute<{ total: string }>(sql`
        UPDATE campaigns SET
          total_recipients = (
            SELECT count(*) FROM campaign_recipients WHERE campaign_id = ${campaignId}::uuid
          ),
          suppressed_count = ${suppressed},
          updated_at = now()
        WHERE id = ${campaignId}::uuid
        RETURNING total_recipients::text AS total
      `);
      return Number(result[0]?.total ?? 0);
    });

    await step.sendEvent("start-sending", campaignSendRequested.create({ campaignId, pass: 0 }));

    return { campaignId, total, suppressed, sendable: total - suppressed };
  },
);
