"use server";

import { revalidatePath } from "next/cache";
import { assertCanSend, requireSession } from "@sendstack/auth";
import { getConfig } from "@sendstack/config";
import {
  and,
  db,
  eq,
  isForeignKeyViolation,
  sql,
} from "@sendstack/db";
import {
  campaigns,
  contacts,
  listMembers,
  lists,
  outboundMessages,
  templates,
} from "@sendstack/db/schema";
import {
  currentBrand,
  customTemplateHtml,
  defaultFrom,
  formatFrom,
  htmlToText,
  isEmptyHtml,
  renderCampaignEmail,
  wrapEmailBody,
  type RenderCampaignInput,
} from "@sendstack/email";
import { campaignQueueRequested, sendEvent } from "@sendstack/jobs";
import { assertNotSuppressed, suppressedMessage } from "@/lib/queries/suppressions";
import {
  isLikelyValidEmail,
  normalizeName,
  parseAddress,
  parseRecipients,
  parseTemplateRef,
  splitAddressList,
  templateColumns,
  unresolvableTags,
  type TemplateRef,
} from "@sendstack/shared";
import { upsertKeyedDraft } from "@/lib/queries/outbound";
import { sendClaimed } from "@/lib/send/one-to-one";

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

/**
 * Resend has no drafts API.
 *
 * The only `draft` in its SDK is `Broadcast.status`, which describes an
 * audience-wide marketing send tied to a Resend segment — not a per-message
 * draft, and not something an ordinary composed email can become. So drafts
 * live here, as `outbound_messages` rows with `status = 'draft'`: the same
 * table Sent uses, which is what lets a draft become a sent message by
 * changing one column instead of moving between two tables at the exact
 * moment a send is most likely to fail.
 */

/** The form's copy of this validation lives in `composeSingleSchema`. */
function splitAddresses(input: string | undefined): string[] {
  return splitAddressList(input ?? "");
}

async function senderAddress(): Promise<string> {
  const config = await getConfig();
  return config.resend.fromEmail
    ? formatFrom(config.resend.fromName, config.resend.fromEmail)
    : await defaultFrom();
}

type Design = Pick<RenderCampaignInput, "template" | "customTemplateHtml">;

const TEMPLATE_GONE = "That template has been deleted. Choose another design.";

/**
 * Turn the picker's choice into what the renderer takes.
 *
 * An uploaded template is fetched here, once per send. A reference to one
 * that has been deleted since the composer opened is an error rather than a
 * silent fall-back to the default design: the person pressed Send having seen
 * a specific look, and shipping a different one without saying so is the kind
 * of surprise that gets noticed by the recipient first.
 */
async function resolveDesign(ref: TemplateRef | undefined): Promise<Result<{ design: Design }>> {
  if (!ref) return { ok: true, design: {} };
  const parsed = parseTemplateRef(ref);
  if (!parsed) return { ok: false, error: "That design is not available." };
  if ("kind" in parsed) return { ok: true, design: { template: parsed.kind } };

  const html = await customTemplateHtml(parsed.customId);
  if (!html) return { ok: false, error: TEMPLATE_GONE };
  return { ok: true, design: { customTemplateHtml: html } };
}

/**
 * Whether the picker's choice still exists, without fetching its HTML.
 *
 * The bulk path stores a reference and lets the send job load the HTML once
 * per run, so all it needs here is a friendly answer for the common case. The
 * guaranteed answer is the foreign key on the insert below — this check can
 * be overtaken by a delete, and the insert cannot.
 */
async function designStillExists(ref: TemplateRef | undefined): Promise<Result> {
  if (!ref) return { ok: true };
  const parsed = parseTemplateRef(ref);
  if (!parsed) return { ok: false, error: "That design is not available." };
  if ("kind" in parsed) return { ok: true };

  const [row] = await db
    .select({ id: templates.id })
    .from(templates)
    .where(eq(templates.id, parsed.customId))
    .limit(1);
  return row ? { ok: true } : { ok: false, error: TEMPLATE_GONE };
}

export type ComposeDraft = {
  draftId?: string | undefined;
  /**
   * The browser's own id for a send it queued while offline. When present it
   * is the message's identity: every replay carrying the same key lands on
   * the same row. See `upsertKeyedDraft` in `lib/queries/outbound.ts`.
   */
  clientKey?: string | undefined;
  to: string;
  cc?: string | undefined;
  bcc?: string | undefined;
  subject: string;
  html: string;
  text: string;
};

// ─── Drafts ──────────────────────────────────────────────────────────────────

/**
 * Save a composed message without sending it.
 *
 * Called on a debounce while typing, so the common case is an update. A
 * message that has been emptied out has its row removed rather than left as a
 * blank entry cluttering Drafts.
 */
export async function saveComposeDraft(
  input: ComposeDraft,
): Promise<Result<{ draftId: string | null }>> {
  const session = await requireSession();

  const to = splitAddresses(input.to);
  const empty = isEmptyHtml(input.html);

  if (empty && to.length === 0 && !input.subject.trim()) {
    if (input.draftId) {
      await db
        .delete(outboundMessages)
        .where(and(eq(outboundMessages.id, input.draftId), eq(outboundMessages.status, "draft")));
      revalidatePath("/drafts");
    }
    return { ok: true, draftId: null };
  }

  const values = {
    // A composed message starts its own conversation. The key is stable for
    // the life of the draft so repeated saves update one row, and so a reply
    // that comes back can be matched to it.
    threadKey: input.draftId ? undefined : `compose:${crypto.randomUUID()}`,
    kind: "compose",
    // `parseAddress`, not a local unwrap of the angle brackets: the copy that
    // used to live here trimmed but never lowercased, so a sender configured
    // as `Hello@Domain.com` was stored mixed-case on the draft while every
    // other address in the system is normalised at its boundary (invariant 6).
    fromEmail: parseAddress(await senderAddress()).email,
    toEmails: to,
    ccEmails: splitAddresses(input.cc),
    bccEmails: splitAddresses(input.bcc),
    subject: input.subject.trim() || null,
    // Styles are inlined on the way in, so what is stored is what would be
    // sent — a draft that renders differently once posted is a trap.
    html: empty ? null : wrapEmailBody(input.html),
    text: input.text,
    status: "draft" as const,
    createdBy: session.user.id,
    updatedAt: new Date(),
  };

  if (input.clientKey) {
    const draftId = await upsertKeyedDraft(input.clientKey, input.draftId ?? null, {
      identity: { threadKey: values.threadKey, kind: values.kind, createdBy: values.createdBy },
      content: {
        fromEmail: values.fromEmail,
        toEmails: values.toEmails,
        ccEmails: values.ccEmails,
        bccEmails: values.bccEmails,
        subject: values.subject,
        html: values.html,
        text: values.text,
        updatedAt: values.updatedAt,
      },
    });
    revalidatePath("/drafts");
    return { ok: true, draftId };
  }

  if (input.draftId) {
    const { threadKey: _ignored, ...patch } = values;
    const [updated] = await db
      .update(outboundMessages)
      .set(patch)
      .where(and(eq(outboundMessages.id, input.draftId), eq(outboundMessages.status, "draft")))
      .returning({ id: outboundMessages.id });
    if (updated) {
      revalidatePath("/drafts");
      return { ok: true, draftId: updated.id };
    }

    /**
     * Nothing matched, which means one of two different things.
     *
     * If the row still exists it has moved on — Send flipped it to `queued`
     * while a debounced save was in flight. Writing a new draft here would put
     * a second copy of a message that was just sent into Drafts, which is the
     * duplicate nobody can explain. If the row is genuinely gone it was
     * discarded, and falling through to create one is right rather than
     * dropping what is still on screen.
     */
    const [moved] = await db
      .select({ id: outboundMessages.id })
      .from(outboundMessages)
      .where(eq(outboundMessages.id, input.draftId))
      .limit(1);
    if (moved) return { ok: true, draftId: null };
  }

  const [created] = await db
    .insert(outboundMessages)
    .values({ ...values, threadKey: values.threadKey ?? `compose:${crypto.randomUUID()}` })
    .returning({ id: outboundMessages.id });

  revalidatePath("/drafts");
  return { ok: true, draftId: created?.id ?? null };
}

/** Load a draft back into the composer. */
export async function loadComposeDraft(draftId: string): Promise<Result<{ draft: ComposeDraft }>> {
  await requireSession();
  const [row] = await db
    .select()
    .from(outboundMessages)
    .where(and(eq(outboundMessages.id, draftId), eq(outboundMessages.status, "draft")))
    .limit(1);

  if (!row) return { ok: false, error: "That draft no longer exists." };

  return {
    ok: true,
    draft: {
      draftId: row.id,
      to: row.toEmails.join(", "),
      cc: row.ccEmails.join(", "),
      bcc: row.bccEmails.join(", "),
      subject: row.subject ?? "",
      html: row.html ?? "",
      text: row.text ?? "",
    },
  };
}

// ─── One recipient ───────────────────────────────────────────────────────────

/**
 * Send a single message, with optional Cc and Bcc.
 *
 * Kept apart from the bulk path deliberately. This is one call to the provider
 * with no batching and no per-recipient personalisation — routing it through
 * the campaign machinery would mean creating a campaign, a list and a
 * recipient row to send one email to one person.
 *
 * Reachable twice for one message: the offline outbox replays a request
 * until it sees a response, and the `online` event and Background Sync can
 * both wake the worker. So with a `clientKey` the row is found or created by
 * that key (`upsertKeyedDraft`), the send is *claimed* with a status transition
 * that refuses a row already `sent`, and the provider key is derived from the
 * client key rather than from the row id — the row id is minted here, so a
 * body with no draft became a new key on every replay and went out twice.
 */
export async function sendSingleEmail(
  input: ComposeDraft & { template?: TemplateRef | undefined },
): Promise<Result<{ id: string }>> {
  const session = await requireSession();
  // The Identity context's send gate. Unenforced today; see `assertCanSend`.
  const refused = await assertCanSend(session, "compose.send");
  if (refused) return refused;

  const to = splitAddresses(input.to);
  const cc = splitAddresses(input.cc);
  const bcc = splitAddresses(input.bcc);

  if (to.length === 0) return { ok: false, error: "Add at least one recipient." };

  const invalid = [...to, ...cc, ...bcc].find((address) => !isLikelyValidEmail(address));
  if (invalid) return { ok: false, error: `${invalid} is not a valid address.` };
  if (!input.subject.trim()) return { ok: false, error: "Add a subject." };
  if (isEmptyHtml(input.html)) return { ok: false, error: "Write something before sending." };

  /**
   * The suppression list applies here too.
   *
   * It is tempting to treat a one-off message as different, but a hard bounce
   * means the mailbox does not exist and a complaint means someone asked not
   * to hear from you — neither stops being true because a human pressed Send.
   */
  const suppressed = await assertNotSuppressed([...to, ...cc, ...bcc]);
  if (suppressed) return { ok: false, error: suppressedMessage(suppressed) };

  const resolved = await resolveDesign(input.template);
  if (!resolved.ok) return resolved;

  const brand = await currentBrand();
  const { html, text } = await renderCampaignEmail({
    brand,
    subject: input.subject,
    bodyHtml: wrapEmailBody(input.html),
    // No unsubscribe footer: this is one-to-one correspondence, not a mailing.
    // CAN-SPAM requires the link on commercial bulk mail, and bolting it onto
    // a personal reply reads as a mistake to the person receiving it. An
    // uploaded template hides its own footer through `{{#if unsubscribeUrl}}`.
    unsubscribeUrl: null,
    ...resolved.design,
  });

  // The draft becomes the sent record: same row, new status. Recording before
  // the provider call means a failure is visible with its error rather than
  // vanishing along with what was written.
  const saved = await saveComposeDraft({ ...input, html, text });
  if (!saved.ok) return saved;
  if (!saved.draftId) return { ok: false, error: "Nothing to send." };

  const id = saved.draftId;

  const from = await senderAddress();
  const outcome = await sendClaimed({
    messageId: id,
    // The client's key when the browser minted one — stable across replays —
    // and the row id otherwise, which for a direct send is a one-shot anyway.
    idempotencyKey: `compose:${input.clientKey ?? id}`,
    message: {
      to: to[0]!,
      // Everyone after the first goes in Cc, so a message addressed to three
      // people arrives as one conversation rather than three separate copies.
      ...(to.length > 1 || cc.length > 0 ? { cc: [...to.slice(1), ...cc] } : {}),
      ...(bcc.length > 0 ? { bcc } : {}),
      from,
      subject: input.subject,
      html,
      text,
    },
  });

  revalidatePath("/sent");
  revalidatePath("/drafts");
  if (!outcome.ok) return outcome;
  return { ok: true, id };
}

// ─── Many recipients ─────────────────────────────────────────────────────────

export type BulkPreview = {
  total: number;
  /** Merge tags this list can actually fill. */
  available: string[];
  skipped: { line: number; value: string; reason: string }[];
  duplicates: number;
  sample: { email: string; firstName: string | null; company: string | null }[];
};

/** Parse recipients without sending, so the composer can show what it found. */
export async function previewRecipients(input: string): Promise<Result<{ preview: BulkPreview }>> {
  await requireSession();
  const parsed = parseRecipients(input);
  return {
    ok: true,
    preview: {
      total: parsed.recipients.length,
      available: parsed.available,
      // A long malformed paste should not ship its entire self back to the
      // browser; the first handful is enough to see what went wrong.
      skipped: parsed.skipped.slice(0, 20),
      duplicates: parsed.duplicates,
      sample: parsed.recipients.slice(0, 3).map((recipient) => ({
        email: recipient.email,
        firstName: recipient.firstName ?? null,
        company: recipient.company ?? null,
      })),
    },
  };
}

/**
 * Queue a personalised send to many recipients.
 *
 * This creates a campaign rather than looping over `sendOne`, because the
 * campaign pipeline already solves everything that makes bulk sending hard:
 * recipients are materialised up front, checked against the suppression list,
 * claimed atomically so two workers cannot double-send, batched to the
 * provider under an idempotency key, and tracked per recipient. A second
 * sending path beside it would be a second path with one set of safeguards.
 */
export async function sendBulkEmail(input: {
  name: string;
  subject: string;
  html: string;
  text: string;
  recipients: string;
  template?: TemplateRef | undefined;
}): Promise<Result<{ campaignId: string; total: number; skipped: number }>> {
  const session = await requireSession();
  const config = await getConfig();

  if (!input.subject.trim()) return { ok: false, error: "Add a subject." };
  if (isEmptyHtml(input.html)) return { ok: false, error: "Write something before sending." };
  if (!config.resend.fromEmail) {
    return { ok: false, error: "No sender address configured — set one in Settings." };
  }
  // Captured after the check: TypeScript cannot carry the narrowing into the
  // transaction callback below.
  const fromEmail = config.resend.fromEmail;

  // Checked before any row is written, so a stale picker gets a sentence
  // rather than a stack trace. The transaction below is what makes it safe.
  const design = await designStillExists(input.template);
  if (!design.ok) return design;

  const parsed = parseRecipients(input.recipients);
  if (parsed.recipients.length === 0) {
    return { ok: false, error: "No valid recipients found." };
  }

  /**
   * Refuse to send a body referencing data the recipients do not have.
   *
   * `{{ company }}` against a list with no company column renders as nothing —
   * "Hi Ada at ," — five hundred times over, and the first anyone hears of it
   * is a reply. Better to stop here than to be politely wrong at scale.
   */
  const [unresolvable] = unresolvableTags(input.html, parsed.available);
  if (unresolvable) {
    return {
      ok: false,
      error: `Your message uses {{ ${unresolvable} }}, which this recipient list does not provide. Remove the tag, or add a ${unresolvable} column.`,
    };
  }

  // Contacts are created for the recipients: a bulk send is an explicit
  // decision to email these people, and the campaign pipeline addresses
  // contacts. Names go through the same normalisation the rest of the app uses.
  const rows = parsed.recipients.map((recipient) => ({
    email: recipient.email,
    firstName: recipient.firstName ? normalizeName(recipient.firstName) : null,
    lastName: recipient.lastName ? normalizeName(recipient.lastName) : null,
    company: recipient.company ?? null,
    position: recipient.position ?? null,
    phone: recipient.phone ?? null,
    source: "compose",
  }));

  const inserted: { id: string }[] = [];
  for (let index = 0; index < rows.length; index += 500) {
    const result = await db
      .insert(contacts)
      .values(rows.slice(index, index + 500))
      .onConflictDoUpdate({
        target: contacts.email,
        // Fill gaps without overwriting what is already known — a pasted list
        // is not more authoritative than a contact someone curated by hand.
        set: {
          firstName: sql`COALESCE(${contacts.firstName}, excluded.first_name)`,
          lastName: sql`COALESCE(${contacts.lastName}, excluded.last_name)`,
          company: sql`COALESCE(${contacts.company}, excluded.company)`,
          position: sql`COALESCE(${contacts.position}, excluded.position)`,
          phone: sql`COALESCE(${contacts.phone}, excluded.phone)`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: contacts.id });
    inserted.push(...result);
  }

  const name = input.name.trim() || input.subject.trim();
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");

  /**
   * The list, its members and the campaign are one unit.
   *
   * A template deleted between the check above and this insert fails the
   * foreign key; without the transaction that would leave a named list and
   * its members behind for a campaign that never existed. The contacts stay
   * regardless — a bulk send is an explicit decision to know these people.
   */
  let created: { campaignId: string } | null;
  try {
    created = await db.transaction(async (tx) => {
      const [list] = await tx
        .insert(lists)
        .values({
          name: `${name} — recipients`,
          slug: `compose-${Date.now().toString(36)}`,
          description: `The ${parsed.recipients.length} addresses this message was composed for, on ${stamp}.`,
        })
        .returning({ id: lists.id });
      if (!list) return null;

      await tx
        .insert(listMembers)
        .values(inserted.map((contact) => ({ listId: list.id, contactId: contact.id })))
        .onConflictDoNothing();

      const [campaign] = await tx
        .insert(campaigns)
        .values({
          name,
          subject: input.subject,
          fromName: config.resend.fromName,
          fromEmail,
          html: wrapEmailBody(input.html),
          text: input.text || htmlToText(input.html),
          listId: list.id,
          status: "draft",
          ...templateColumns(input.template),
          createdBy: session.user.id,
        })
        .returning({ id: campaigns.id });
      return campaign ? { campaignId: campaign.id } : null;
    });
  } catch (error) {
    if (isForeignKeyViolation(error)) return { ok: false, error: TEMPLATE_GONE };
    throw error;
  }

  if (!created) return { ok: false, error: "Could not create the campaign." };
  const campaign = { id: created.campaignId };

  // Claim the transition before handing off, so a double-submitted form
  // queues one send rather than two.
  const claimed = await db.execute<{ id: string }>(sql`
    UPDATE campaigns SET status = 'scheduled'::campaign_status, scheduled_at = now(), updated_at = now()
    WHERE id = ${campaign.id}::uuid AND status = 'draft'
    RETURNING id
  `);
  if (Array.from(claimed).length === 0) {
    return { ok: false, error: "That send is already in progress." };
  }

  await sendEvent(campaignQueueRequested.create({ campaignId: campaign.id }));

  revalidatePath("/campaigns");
  revalidatePath("/contacts");
  revalidatePath("/lists");

  return {
    ok: true,
    campaignId: campaign.id,
    total: parsed.recipients.length,
    skipped: parsed.skipped.length,
  };
}
