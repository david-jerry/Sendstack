import { NonRetriableError } from "inngest";
import { db, eq, isUnsendable, sql, type Transaction } from "@sendstack/db";
import { campaigns } from "@sendstack/db/schema";
import {
  currentBrand,
  customTemplateHtml,
  formatFrom,
  renderCampaignEmail,
  renderTemplate,
  type TemplateKind,
  sendBatch,
  unsubscribeHeaders,
  unsubscribeUrl,
  type Brand,
  type OutboundMessage,
} from "@sendstack/email";
import { publishRealtime } from "@sendstack/redis";
import { SEND_BATCH_SIZE } from "@sendstack/shared";
import { campaignSendRequested, eventData, inngest } from "../client";

/**
 * How many batches one run will process before handing off to a continuation.
 * Bounds run duration — 25 × 100 = 2,500 emails — so a run stays well inside
 * any platform execution limit and a failure replays a small slice rather than
 * an entire 200k campaign.
 */
const MAX_BATCHES_PER_RUN = 25;

type ClaimedRecipient = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  position: string | null;
  phone: string | null;
  attributes: Record<string, unknown> | null;
};

/**
 * The campaign fields a batch needs, and no timestamps.
 *
 * The row arrives through `step.run`, which serialises its result as JSON, so
 * every `Date` on the Drizzle row type comes back as a string. Naming only the
 * columns the send actually reads keeps the type honest about what survives
 * the round trip — and none of them is a date.
 */
type Campaign = Pick<
  typeof campaigns.$inferSelect,
  | "id"
  | "status"
  | "subject"
  | "preheader"
  | "html"
  | "text"
  | "replyTo"
  | "emailTemplate"
  | "customTemplateId"
  | "fromName"
  | "fromEmail"
>;

export type BatchOutcome = {
  claimed: number;
  sent: number;
  failed: number;
  /** Rows marked suppressed by the re-check at claim time. */
  suppressed: number;
};

/**
 * Reasons not to mail someone that arrived after materialisation.
 *
 * `applyQueueSuppressions` marks suppressed and inactive contacts once, when
 * the recipient rows are created — but a campaign can sit `scheduled` for a
 * week, or `paused` for a day, and anything that happens in between must
 * still stop the send. This runs inside the claim transaction, just before
 * the claim, so a contact suppressed a second ago is never handed to the
 * provider. Only `pending` rows are touched, so it converges to zero rows on
 * every run after the first.
 *
 * The condition is `isUnsendable` from `@sendstack/db`, which is *the*
 * definition of the do-not-send rule and is shared with
 * `applyQueueSuppressions` and the one-to-one paths. This docstring used to
 * promise instead to hold its own copy "character-for-character" identical to
 * that function's — a promise between two copies, which is the arrangement
 * that had already let claim-time drift narrower than materialisation-time and
 * mail anyone whose `contacts.status` moved off `active` in between.
 *
 * `isUnsendable` uses `EXISTS` rather than a second join, which matters here:
 * `suppressions` is unique on `email`, so a join could not multiply rows
 * today, but the count this returns is a count of *recipients* marked and a
 * subquery cannot ever make it anything else.
 */
export async function suppressLateArrivals(tx: Transaction, campaignId: string): Promise<number> {
  const marked = await tx.execute<{ id: string }>(sql`
    UPDATE campaign_recipients cr
    SET status = 'suppressed'::recipient_status
    FROM contacts c
    WHERE cr.contact_id = c.id
      AND cr.campaign_id = ${campaignId}::uuid
      AND cr.status = 'pending'
      AND ${isUnsendable({ contact: "c", email: sql`cr.email` })}
    RETURNING cr.id
  `);
  return Array.from(marked).length;
}

/**
 * Claim the next slice of pending recipients, with the merge data attached.
 *
 * `FOR UPDATE SKIP LOCKED` means two workers take disjoint slices instead of
 * blocking on each other or, worse, both sending to the same person. The
 * conditional `status = 'pending'` is what makes the claim atomic: a row can
 * only ever be claimed once per attempt.
 *
 * Two things about the shape:
 *
 *  - No `ORDER BY`. Under SKIP LOCKED the order a worker *sees* rows in is not
 *    the order it *gets* them in, so a sort bought nothing but a sort. The
 *    (campaign_id, status) index answers the subquery directly. Rows are
 *    sorted by `id` in Node afterwards, because the payload sent to the
 *    provider has to be byte-identical on a retry — see `sendNextBatch`.
 *  - `contacts` is joined once in `FROM`, not read six times per row in
 *    `RETURNING` as correlated subselects. The plan is one join over the
 *    claimed slice; the old shape was six index lookups per claimed row.
 *
 *    The join condition reads `picked.contact_id`, and it has to: an
 *    `UPDATE … FROM` may not reference its own target from inside the `FROM`
 *    clause, so `ON c.id = cr.contact_id` is rejected outright with `42P01`.
 *    That is why the subquery selects `contact_id` as well as `id` — it is
 *    the only legal thing for the join to hang on. This statement went in
 *    without ever being executed and broke every batch until
 *    `pipeline.duplicity.integration.test.ts` ran it against a real Postgres.
 *
 * The `EXISTS` on `campaigns` is the pause check. Without it a pause takes
 * effect only when the next *run* starts — up to 25 batches later — because
 * the campaign status is read once per run. With it, a pause stops the very
 * next batch: the subquery matches nothing and the run winds down.
 */
export async function claimBatch(tx: Transaction, campaignId: string): Promise<ClaimedRecipient[]> {
  const claimed = await tx.execute<ClaimedRecipient>(sql`
    UPDATE campaign_recipients cr
    SET status = 'sending'::recipient_status,
        attempt_count = cr.attempt_count + 1
    FROM (
      SELECT id, contact_id FROM campaign_recipients
      WHERE campaign_id = ${campaignId}::uuid
        AND status = 'pending'
        AND EXISTS (
          SELECT 1 FROM campaigns WHERE id = ${campaignId}::uuid AND status = 'sending'
        )
      LIMIT ${SEND_BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    ) AS picked
    JOIN contacts c ON c.id = picked.contact_id
    WHERE cr.id = picked.id
    RETURNING cr.id, cr.email,
              c.first_name, c.last_name, c.company, c.position, c.phone, c.attributes
  `);

  // Deterministic order so a retried step builds the identical batch payload.
  return (Array.from(claimed) as ClaimedRecipient[]).sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * Claim, render, send and record one batch — as a single transaction.
 *
 * The transaction is the correctness argument, so it is worth spelling out.
 * Inngest memoises a completed step, and a step that throws is retried from
 * the top. Before this, the claim was committed the moment it ran: a failure
 * anywhere after it — a render error, a provider 500, a dropped connection on
 * the status write — left those rows in `sending` forever, and the retry
 * claimed a *different* hundred rows under the *same* idempotency key. Resend
 * rejects a reused key with a different payload, so the retry failed too; and
 * the stranded rows were later "released" back to pending by a pause and sent
 * a second time.
 *
 * Wrapping claim → render → send → writes in one transaction makes a failure
 * roll the claim back. The retry then claims the same rows (nothing else can
 * have taken them; they were never visibly `sending`), sorts them by id,
 * renders the same content, and sends under the same key. If the provider had
 * in fact accepted the first attempt, the identical key + identical payload
 * collapses onto it and no second copy goes out. If it had not, this is the
 * first attempt.
 *
 * The row locks from `FOR UPDATE` are held across the provider call. That is
 * acceptable because nothing else wants those rows — the per-campaign
 * concurrency limit is 1 — and the `campaigns` row is only touched by the
 * final counter UPDATE, so a pause or cancel waits at most for that last
 * statement, not for the HTTP round trip.
 *
 * The idempotency key is `campaign:{id}:{runId}:{batch}`. A run id is unique
 * per Inngest run and stable across the retries of a step within it, which is
 * exactly the shape the key needs: retries collapse, and a *resumed* campaign
 * — a new run — gets fresh keys rather than reusing `pass 0`'s keys against a
 * different set of recipients, which is what the old `{pass}:{batch}` key did.
 */
export async function sendNextBatch(input: {
  campaign: Campaign;
  brand: Brand;
  /** HTML of an uploaded template, or null for a built-in design. */
  uploaded: string | null;
  from: string;
  idempotencyKey: string;
}): Promise<BatchOutcome> {
  const { campaign, brand, uploaded, from } = input;
  const campaignId = campaign.id;

  return db.transaction(async (tx) => {
    const suppressed = await suppressLateArrivals(tx, campaignId);
    const rows = await claimBatch(tx, campaignId);

    if (rows.length === 0) {
      if (suppressed > 0) {
        await tx.execute(sql`
          UPDATE campaigns SET
            suppressed_count = suppressed_count + ${suppressed},
            updated_at = now()
          WHERE id = ${campaignId}::uuid
        `);
      }
      return { claimed: 0, sent: 0, failed: 0, suppressed };
    }

    const messages: OutboundMessage[] = await Promise.all(
      rows.map(async (row): Promise<OutboundMessage> => {
        const link = unsubscribeUrl(row.email, brand.appUrl);
        /**
         * Every merge tag the composer can offer has to be populated here.
         * A tag in the palette that this object does not supply renders as
         * an empty string in someone's inbox — "Hi ," — and nothing
         * anywhere reports it. `MERGE_FIELDS` is the shared list both
         * sides read from.
         */
        const context = {
          email: row.email,
          firstName: row.first_name ?? "",
          lastName: row.last_name ?? "",
          company: row.company ?? "",
          position: row.position ?? "",
          phone: row.phone ?? "",
          attributes: row.attributes ?? {},
          unsubscribeUrl: link,
        };

        // Merge fields are substituted into the *body* first, then the body
        // is wrapped in the chosen template. Doing it the other way round
        // would let a contact's name interpolate into the template's own
        // markup.
        const { html, text } = await renderCampaignEmail({
          brand,
          subject: renderTemplate(campaign.subject, context),
          preheader: campaign.preheader ? renderTemplate(campaign.preheader, context) : null,
          bodyHtml: renderTemplate(campaign.html, context),
          unsubscribeUrl: link,
          ...(campaign.emailTemplate ? { template: campaign.emailTemplate as TemplateKind } : {}),
          // The uploaded chrome may carry `{{ firstName }}` of its own;
          // the body's tags were resolved above and are not touched again.
          customTemplateHtml: uploaded,
          context,
        });

        return {
          recipientId: row.id,
          to: row.email,
          from,
          replyTo: campaign.replyTo ?? undefined,
          subject: renderTemplate(campaign.subject, context),
          html,
          /**
           * The renderer's text, never `campaign.text`. The column holds a
           * plain-text rendering of the *body alone* — `htmlToText(body)` at
           * creation — so it carries neither the unsubscribe link nor the
           * postal address, both of which the text part legally has to
           * carry for bulk mail. The renderer derives its text from the full
           * wrapped document, so it does. The column remains useful as the
           * composer's preview; it is not what goes on the wire.
           */
          text,
          headers: unsubscribeHeaders(row.email, brand.appUrl),
        };
      }),
    );

    // Throws on a transport-level failure, which rolls the claim back and
    // lets the step retry with backoff. Per-item rejections come back in
    // `failed` and are final for that recipient.
    const outcome = await sendBatch(messages, { idempotencyKey: input.idempotencyKey });

    /**
     * Both writes are conditional on the row still being `sending`. The
     * provider can post `email.delivered` — or `email.bounced` — for a message
     * in this batch before this statement runs, and the webhook handler will
     * have advanced the row already. An unconditional `SET status = 'sent'`
     * moved it backwards; `COALESCE` on the timestamps and the provider id
     * keep whatever the earlier writer recorded.
     */
    if (outcome.sent.length > 0) {
      await tx.execute(sql`
        UPDATE campaign_recipients AS cr
        SET status = CASE WHEN cr.status = 'sending' THEN 'sent'::recipient_status ELSE cr.status END,
            provider_message_id = COALESCE(cr.provider_message_id, v.provider_message_id),
            sent_at = COALESCE(cr.sent_at, now())
        FROM (VALUES ${sql.join(
          outcome.sent.map(
            (entry) => sql`(${entry.recipientId}::uuid, ${entry.providerMessageId}::text)`,
          ),
          sql`, `,
        )}) AS v(id, provider_message_id)
        WHERE cr.id = v.id
      `);
    }

    if (outcome.failed.length > 0) {
      await tx.execute(sql`
        UPDATE campaign_recipients AS cr
        SET status = CASE WHEN cr.status = 'sending' THEN 'failed'::recipient_status ELSE cr.status END,
            error = COALESCE(cr.error, v.error),
            failed_at = COALESCE(cr.failed_at, now())
        FROM (VALUES ${sql.join(
          outcome.failed.map((entry) => sql`(${entry.recipientId}::uuid, ${entry.error}::text)`),
          sql`, `,
        )}) AS v(id, error)
        WHERE cr.id = v.id
      `);
    }

    // Last, so the campaigns row lock is held for one statement rather than
    // for the whole provider round trip.
    await tx.execute(sql`
      UPDATE campaigns SET
        sent_count       = sent_count       + ${outcome.sent.length},
        failed_count     = failed_count     + ${outcome.failed.length},
        suppressed_count = suppressed_count + ${suppressed},
        updated_at = now()
      WHERE id = ${campaignId}::uuid
    `);

    return {
      claimed: rows.length,
      sent: outcome.sent.length,
      failed: outcome.failed.length,
      suppressed,
    };
  });
}

export const sendCampaign = inngest.createFunction(
  {
    id: "send-campaign",
    name: "Send campaign batches",
    concurrency: { key: "event.data.campaignId", limit: 1 },
    // Spread load at the provider. Tune alongside `sendRatePerSecond` in
    // app_settings (Settings → Email) and whatever your Resend plan allows.
    throttle: { limit: 10, period: "1s" },
    retries: 4,
    triggers: [campaignSendRequested],
  },
  async ({ event, step, runId }) => {
    const { campaignId, pass } = eventData("campaign/send.requested", event.data);

    const campaign = await step.run("load-campaign", async () => {
      const row = await db.query.campaigns.findFirst({ where: eq(campaigns.id, campaignId) });
      if (!row) throw new NonRetriableError(`Campaign ${campaignId} not found`);
      return row;
    });

    if (campaign.status !== "sending") {
      /**
       * Paused or cancelled before this run began. Since a batch's claim now
       * lives and dies with its transaction, a row can only be `sending`
       * while a batch is in flight — so this normally matches nothing. It
       * stays as a safety net for the one case a transaction cannot cover: a
       * process killed between the provider accepting the batch and the
       * commit, where Postgres rolled the claim back but the message went.
       * Returning those rows to `pending` lets the resume re-send under the
       * same content; the provider's idempotency key is per run, so that
       * re-send is a genuine second copy, and this is the documented cost of
       * that failure mode rather than a hidden one.
       */
      await step.run("release-claimed", async () => {
        await db.execute(sql`
          UPDATE campaign_recipients SET status = 'pending'::recipient_status
          WHERE campaign_id = ${campaignId}::uuid AND status = 'sending'
        `);
      });
      return { campaignId, stopped: campaign.status };
    }

    const from = formatFrom(campaign.fromName, campaign.fromEmail);

    // Resolved once per run, not per recipient: the brand block requires a
    // settings read and a branding-checksum query, and a 2,500-message run
    // would otherwise repeat both 2,500 times for an identical result.
    const brand = await step.run("load-brand", async () => currentBrand());

    // Same reasoning as the brand: an uploaded template is one row, read once
    // here and handed to every render below. Null when the campaign uses a
    // built-in design — or when the template has since been deleted, which
    // the delete guard prevents for an unsent campaign but history can hit.
    const templateId = campaign.customTemplateId;
    const uploaded = templateId
      ? await step.run("load-template", async () => customTemplateHtml(templateId))
      : null;

    let processed = 0;

    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
      const result = await step.run(`batch-${pass}-${batch}`, () =>
        sendNextBatch({
          campaign,
          brand,
          uploaded,
          from,
          idempotencyKey: `campaign:${campaignId}:${runId}:${batch}`,
        }),
      );

      processed += result.claimed;

      if (result.claimed > 0) {
        await step.run(`progress-${pass}-${batch}`, async () => {
          const [row] = await db
            .select({
              status: campaigns.status,
              sentCount: campaigns.sentCount,
              totalRecipients: campaigns.totalRecipients,
            })
            .from(campaigns)
            .where(eq(campaigns.id, campaignId));
          if (!row) return null;
          await publishRealtime({
            type: "campaign.progress",
            at: new Date().toISOString(),
            campaignId,
            status: row.status,
            sentCount: row.sentCount,
            totalRecipients: row.totalRecipients,
          });
          return null;
        });
      }

      // Nothing left to claim: either the campaign is done, or it was paused
      // or cancelled between batches and the claim's EXISTS check matched
      // nothing. The `status = 'sending'` guard tells the two apart — a
      // paused campaign keeps its pending rows and its status, and a
      // cancelled one must not be relabelled `sent` because its rows were
      // just relabelled `cancelled`.
      if (result.claimed < SEND_BATCH_SIZE) {
        await step.run(`complete-${pass}-${batch}`, async () => {
          await db.execute(sql`
            UPDATE campaigns SET
              status = 'sent'::campaign_status,
              completed_at = now(),
              updated_at = now()
            WHERE id = ${campaignId}::uuid
              AND status = 'sending'
              AND NOT EXISTS (
                SELECT 1 FROM campaign_recipients
                WHERE campaign_id = ${campaignId}::uuid AND status IN ('pending', 'sending')
              )
          `);
        });
        return { campaignId, pass, processed, done: true };
      }
    }

    // Hit the per-run ceiling with work remaining: continue in a fresh run so
    // no single execution outlives its platform's timeout.
    await step.sendEvent(
      "continue",
      campaignSendRequested.create({ campaignId, pass: pass + 1 }),
    );

    return { campaignId, pass, processed, done: false };
  },
);
