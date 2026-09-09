"use server";

import { revalidatePath } from "next/cache";
import { assertCanSend, requireSession } from "@sendstack/auth";
import { db, isForeignKeyViolation, sql } from "@sendstack/db";
import { campaigns } from "@sendstack/db/schema";
import {
  campaignCancelRequested,
  campaignQueueRequested,
  campaignSendRequested,
  sendEvent,
} from "@sendstack/jobs";
import { deliverabilityReport, getConfig } from "@sendstack/config";
import { customTemplateHtml, htmlToText, isEmptyHtml, wrapEmailBody } from "@sendstack/email";
import {
  campaignFormSchema,
  scheduleCampaignSchema,
  campaignInputSchema,
  parseTemplateRef,
  templateColumns,
  type TemplateRef,
} from "@sendstack/shared";

export async function createCampaign(input: unknown) {
  const session = await requireSession();

  const parsed = campaignInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid campaign" };
  }

  const data = parsed.data;
  const [row] = await db
    .insert(campaigns)
    .values({
      name: data.name,
      subject: data.subject,
      preheader: data.preheader || null,
      fromName: data.fromName,
      fromEmail: data.fromEmail,
      replyTo: data.replyTo || null,
      html: data.html,
      text: data.text || null,
      listId: data.listId,
      emailTemplate: data.emailTemplate,
      customTemplateId: data.customTemplateId,
      createdBy: session.user.id,
    })
    .returning({ id: campaigns.id });

  revalidatePath("/campaigns");
  return { ok: true as const, id: row?.id };
}

/**
 * Create a campaign from the dialog on the campaigns page.
 *
 * Thin on purpose. It differs from `createCampaign` in one way that matters:
 * the sender comes from settings rather than from the form. A from-address
 * that is not on the verified domain is rejected by the provider, and there is
 * nothing useful a person can do with that error inside a create dialog.
 *
 * It creates a draft and stops. Sending is a separate, guarded transition —
 * the dialog's job is to get the message written, not to fire it.
 */
export async function createCampaignDraft(input: {
  name: string;
  subject: string;
  preheader?: string | undefined;
  html: string;
  listId: string;
  template?: TemplateRef | null;
}) {
  const session = await requireSession();
  const config = await getConfig();

  const parsed = campaignFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid campaign" };
  }

  // An uploaded template that no longer exists is refused here with a
  // sentence for the common case; the foreign key on the insert below is the
  // guarantee, and its violation is turned into the same sentence.
  const gone = "That template has been deleted. Choose another design.";
  const ref = input.template ? parseTemplateRef(input.template) : null;
  if (input.template && !ref) {
    return { ok: false as const, error: "That design is not available." };
  }
  if (ref && "customId" in ref && !(await customTemplateHtml(ref.customId))) {
    return { ok: false as const, error: gone };
  }
  if (isEmptyHtml(parsed.data.html)) {
    return { ok: false as const, error: "Write the message before saving." };
  }
  if (!config.resend.fromEmail) {
    return {
      ok: false as const,
      error: "No sender address configured — set one in Settings before creating a campaign.",
    };
  }

  const data = parsed.data;
  let row: { id: string } | undefined;
  try {
    [row] = await db
      .insert(campaigns)
      .values({
        name: data.name,
        subject: data.subject,
        preheader: data.preheader || null,
        fromName: config.resend.fromName,
        fromEmail: config.resend.fromEmail,
        // Styles are inlined on the way in, so what is stored is what would be
        // sent — a campaign that renders differently once queued is a trap.
        html: wrapEmailBody(data.html),
        text: htmlToText(data.html),
        listId: data.listId,
        ...templateColumns(input.template),
        status: "draft",
        createdBy: session.user.id,
      })
      .returning({ id: campaigns.id });
  } catch (error) {
    if (isForeignKeyViolation(error)) return { ok: false as const, error: gone };
    throw error;
  }

  if (!row) return { ok: false as const, error: "Could not create the campaign." };

  revalidatePath("/campaigns");
  return { ok: true as const, id: row.id };
}

/**
 * Whether this instance is configured well enough to mail strangers.
 *
 * Checked before the status transition, not after: a campaign that fails this
 * must stay an editable draft rather than becoming a `scheduled` row nobody
 * can send. The failures it catches are the ones that are invisible at send
 * time — Resend accepts the message, the API returns 200, and the mail goes
 * to spam — so this is the only place they can be surfaced while there is
 * still someone looking at a screen.
 */
async function blockedFromSending(): Promise<{ ok: false; error: string } | null> {
  const report = await deliverabilityReport();
  if (report.canSendCampaigns) return null;

  const first = report.blocking[0]!;
  return {
    ok: false,
    error:
      report.blocking.length === 1
        ? first.detail!
        : `${first.detail!} (${report.blocking.length - 1} more issue${
            report.blocking.length > 2 ? "s" : ""
          } in Settings → Email.)`,
  };
}

/**
 * Hand a campaign to the send pipeline.
 *
 * The status transition happens here, guarded by `WHERE status = 'draft'`, and
 * only a run whose UPDATE actually matched goes on to emit the event. That is
 * what makes a double-clicked "Send" harmless: the second attempt matches zero
 * rows and returns early rather than queueing a second copy of the campaign.
 */
export async function sendCampaignNow(campaignId: string) {
  const session = await requireSession();

  // Two gates, one shape: the Identity context's policy first, then the
  // deliverability report. Either returns the refusal; `??` composes them.
  const blocked =
    (await assertCanSend(session, "campaign.send")) ?? (await blockedFromSending());
  if (blocked) return blocked;

  const claimed = await db.execute<{ id: string }>(sql`
    UPDATE campaigns
    SET status = 'scheduled'::campaign_status, scheduled_at = now(), updated_at = now()
    WHERE id = ${campaignId}::uuid AND status = 'draft'
    RETURNING id
  `);

  if (Array.from(claimed).length === 0) {
    return { ok: false as const, error: "This campaign has already been sent or is in progress." };
  }

  await sendEvent(campaignQueueRequested.create({ campaignId }));

  revalidatePath("/campaigns");
  return { ok: true as const };
}

export async function scheduleCampaign(input: unknown) {
  const session = await requireSession();
  // Scheduling is a send with a delay; the same gate applies at the moment
  // the person commits to it, not only when the cron fires without them.
  const refused = await assertCanSend(session, "campaign.schedule");
  if (refused) return refused;

  const parsed = scheduleCampaignSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid schedule" };
  }

  const { campaignId, scheduledAt } = parsed.data;
  if (scheduledAt === null) return sendCampaignNow(campaignId);

  // Checked at scheduling time as well, so the problem surfaces now rather
  // than at 6am on Tuesday when the cron picks the campaign up.
  const blocked = await blockedFromSending();
  if (blocked) return blocked;

  const claimed = await db.execute<{ id: string }>(sql`
    UPDATE campaigns
    SET status = 'scheduled'::campaign_status,
        scheduled_at = ${scheduledAt}::timestamptz,
        updated_at = now()
    WHERE id = ${campaignId}::uuid AND status IN ('draft', 'scheduled')
    RETURNING id
  `);

  if (Array.from(claimed).length === 0) {
    return { ok: false as const, error: "Only a draft or scheduled campaign can be rescheduled." };
  }

  // No event is sent here — the every-minute cron claims it when the time
  // arrives. Emitting now would send it immediately, which is the opposite of
  // scheduling it.
  revalidatePath("/campaigns");
  return { ok: true as const };
}

/**
 * Stop a campaign between batches.
 *
 * Guarded by the status, and that guard is not cosmetic: without it a *draft*
 * could be paused, and `resumeCampaign` would then move that draft straight to
 * `sending` with no recipients ever materialised — where the send worker finds
 * nothing to claim and marks it `sent`. A campaign that had never been sent to
 * anybody would sit in the list reporting success.
 *
 * `scheduled` is pausable as well as `sending`: the cron claims rows by
 * `status = 'scheduled'`, so pausing is also how a send booked for 6am is
 * called off at midnight.
 */
export async function pauseCampaign(campaignId: string) {
  await requireSession();

  const paused = await db.execute<{ id: string }>(sql`
    UPDATE campaigns SET status = 'paused'::campaign_status, updated_at = now()
    WHERE id = ${campaignId}::uuid AND status IN ('sending', 'scheduled')
    RETURNING id
  `);

  if (Array.from(paused).length === 0) {
    return { ok: false as const, error: "Only a sending or scheduled campaign can be paused." };
  }

  revalidatePath("/campaigns");
  return { ok: true as const };
}

export async function resumeCampaign(campaignId: string) {
  await requireSession();

  const claimed = await db.execute<{ id: string }>(sql`
    UPDATE campaigns SET status = 'sending'::campaign_status, updated_at = now()
    WHERE id = ${campaignId}::uuid AND status = 'paused'
    RETURNING id
  `);
  if (Array.from(claimed).length === 0) {
    return { ok: false as const, error: "That campaign is not paused." };
  }

  // Recipients already materialised, so resume goes straight to sending.
  await sendEvent(campaignSendRequested.create({ campaignId, pass: 0 }));

  revalidatePath("/campaigns");
  return { ok: true as const };
}

/**
 * Cancel a campaign, and only then ask the job to relabel its recipients.
 *
 * The status flip is claimed here rather than in the job, for two reasons.
 * The person clicking gets a real answer — "already finished" instead of an
 * event that disappears into a queue — and the `cancel-campaign` job's own
 * `EXISTS (… status = 'cancelled')` guard depends on this having happened, so
 * emitting the event without claiming first made cancelling a silent no-op.
 * It is also what stops the send worker claiming another batch: the claim
 * checks the campaign is still `sending`.
 *
 * A `sent` campaign cannot be cancelled. The mail has left; saying otherwise
 * in the UI would be a lie about what recipients received.
 */
export async function cancelCampaignAction(campaignId: string) {
  await requireSession();

  const cancelled = await db.execute<{ id: string }>(sql`
    UPDATE campaigns SET status = 'cancelled'::campaign_status, updated_at = now()
    WHERE id = ${campaignId}::uuid
      AND status IN ('draft', 'scheduled', 'sending', 'paused')
    RETURNING id
  `);

  if (Array.from(cancelled).length === 0) {
    return {
      ok: false as const,
      error: "That campaign has already finished or been cancelled.",
    };
  }

  // Relabelling up to 200k `pending` rows is not something a request waits on.
  await sendEvent(campaignCancelRequested.create({ campaignId }));

  revalidatePath("/campaigns");
  return { ok: true as const };
}
