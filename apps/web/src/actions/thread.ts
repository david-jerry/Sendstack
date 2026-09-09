"use server";

import { revalidatePath } from "next/cache";
import { assertCanSend, requireSession } from "@sendstack/auth";
import { db, and, eq, sql } from "@sendstack/db";
import { outboundMessages, threads } from "@sendstack/db/schema";
import { defaultFrom, isEmptyHtml, wrapEmailBody } from "@sendstack/email";
import { publishRealtime } from "@sendstack/redis";
import { parseAddress, splitAddressList } from "@sendstack/shared";
import { syncSentEmails } from "@sendstack/jobs";
import { assertNotSuppressed, suppressedMessage } from "@/lib/queries/suppressions";
import {
  applyThreadStatus,
  referencesFor,
  replyParent,
  threadKeyOf,
  unreadDeltaFor,
} from "@/lib/queries/thread";
import { upsertKeyedDraft } from "@/lib/queries/outbound";
import { sendClaimed } from "@/lib/send/one-to-one";

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

/** Upsert the per-thread flag row; absence of a row is the default state. */
async function setFlags(
  threadKey: string,
  patch: Partial<{
    starred: boolean;
    muted: boolean;
    snoozedUntil: Date | null;
    assignedUserId: string | null;
  }>,
) {
  await db
    .insert(threads)
    .values({ threadKey, ...patch })
    .onConflictDoUpdate({
      target: threads.threadKey,
      set: { ...patch, updatedAt: new Date() },
    });
}

// ─── Thread flags ────────────────────────────────────────────────────────────

export async function toggleStar(messageId: string, starred: boolean): Promise<Result> {
  await requireSession();
  const threadKey = await threadKeyOf(messageId);
  if (!threadKey) return { ok: false, error: "Thread not found" };
  await setFlags(threadKey, { starred });
  revalidatePath("/inbox");
  return { ok: true };
}

export async function toggleMute(messageId: string, muted: boolean): Promise<Result> {
  await requireSession();
  const threadKey = await threadKeyOf(messageId);
  if (!threadKey) return { ok: false, error: "Thread not found" };
  await setFlags(threadKey, { muted });
  revalidatePath("/inbox");
  return { ok: true };
}

/**
 * Hide a thread until later.
 *
 * The thread is not moved or altered — only `snoozed_until` is set, and the
 * inbox query filters on it. That means a snooze cannot lose a message: if the
 * timestamp is never reached, or the filter is removed, everything is still
 * exactly where it was.
 */
export async function snoozeThread(messageId: string, until: Date | null): Promise<Result> {
  await requireSession();
  const threadKey = await threadKeyOf(messageId);
  if (!threadKey) return { ok: false, error: "Thread not found" };

  if (until && until.getTime() <= Date.now()) {
    return { ok: false, error: "Pick a time in the future." };
  }

  await setFlags(threadKey, { snoozedUntil: until });
  // Waking a thread should get attention, so it returns to unread.
  if (!until) {
    await db.execute(sql`
      UPDATE inbound_emails SET status = 'unread'::inbound_status
      WHERE thread_key = ${threadKey} AND status = 'read'
    `);
  }
  revalidatePath("/inbox");
  return { ok: true };
}

/**
 * Move a whole conversation to a status.
 *
 * `trash` is a status like any other rather than a delete — the row stays, so
 * "deleting" an email is recoverable and a mis-click is not permanent data
 * loss. Nothing in the app hard-deletes a message.
 */
export async function setThreadStatus(
  messageId: string,
  status: "read" | "unread" | "archived" | "spam" | "trash",
): Promise<Result> {
  await requireSession();

  /**
   * The write, the badge delta, and "does this thread exist" — one statement.
   *
   * This is the `setThreadStatus` the toolbar and the row menu actually
   * import; `actions/inbox.ts` used to export a second one that nothing did,
   * which is why its `unreadDelta` was invisible however carefully it was
   * written. Both now go through `applyThreadStatus`.
   *
   * Publishing no `unreadDelta` was not neutral: the store falls back to
   * "anything other than `unread` means minus one", so archiving an
   * already-read conversation and restoring one from Archive — which this
   * screen sends as `"read"` — each took one off the badge permanently.
   */
  const applied = await applyThreadStatus(messageId, status);
  // A conversation always holds at least the message that names it, so zero
  // rows touched is the id matching nothing — the check the pre-flight
  // `threadKeyOf` used to make, without the extra round trip.
  if (applied.touched === 0) return { ok: false, error: "Thread not found" };

  await publishRealtime({
    type: "inbound.updated",
    at: new Date().toISOString(),
    emailId: messageId,
    status,
    unreadDelta: unreadDeltaFor(status, applied),
  });

  /*
   * Every folder is a filter over the same rows, so a status change moves the
   * thread out of one list and into another — and both have to be refreshed.
   * Revalidating only `/inbox` is why an archived thread used to be missing
   * from Archive until a hard reload.
   */
  for (const path of ["/inbox", "/archive", "/spam", "/starred"]) {
    revalidatePath(path);
  }
  return { ok: true };
}

// ─── Composing ───────────────────────────────────────────────────────────────

export type ComposeInput = {
  /** The received message being answered or forwarded. */
  inReplyToId: string;
  kind: "reply" | "forward";
  to: string;
  /** Rich HTML from the editor. */
  html: string;
  /** The same content as plain text, for the alternative part. */
  text: string;
  /** Existing draft to update rather than duplicate. */
  draftId?: string | undefined;
  /**
   * The composer's own id for this reply, minted once per composition.
   *
   * Without it a double-submitted reply inserted a fresh row each time, so two
   * sends went out under two different `outbound:${id}` claim keys and the
   * provider could not collapse them — two real emails. With it the write goes
   * through `upsertKeyedDraft`, where the unique index on `client_key` is the
   * arbiter. Optional because a client that predates it still saves drafts the
   * old way; the send path is where it matters.
   */
  clientKey?: string | undefined;
};

function replySubject(kind: "reply" | "forward", subject: string | null): string {
  const base = subject ?? "(no subject)";
  const prefix = kind === "forward" ? "Fwd: " : "Re: ";
  const already = kind === "forward"
    ? /^fwd?:/i.test(base)
    : /^re:/i.test(base);
  return already ? base : prefix + base;
}

/**
 * Save a draft, creating one on first keystroke and updating it after.
 *
 * A draft is an `outbound_messages` row with `status = 'draft'`, which is why
 * Sent and Drafts are one table. The alternative needs a hand-off between two
 * tables at exactly the moment something is most likely to fail.
 */
export async function saveDraft(
  input: ComposeInput,
): Promise<Result<{ draftId: string | null }>> {
  const session = await requireSession();

  const parent = await replyParent({ messageId: input.inReplyToId });
  if (!parent) return { ok: false, error: "Message not found" };

  /**
   * Normalised and split at the boundary, once — invariant 6.
   *
   * It used to be `input.to.trim()` stored as a single-element array, which
   * broke two things quietly: a suppression on `ada@example.com` did not match
   * a reply addressed to `Ada@Example.com`, and pasting two addresses stored
   * `"a@x.com, b@y.com"` as one value that matched no suppression and no
   * contact. `splitAddressList` is the same parser the compose form uses.
   */
  const to = splitAddressList(input.to);
  const empty = isEmptyHtml(input.html);

  // An empty draft is not worth a row. If one already exists and has been
  // emptied, remove it rather than leaving a blank entry in Drafts.
  if (empty && to.length === 0) {
    if (input.draftId) {
      await db
        .delete(outboundMessages)
        .where(
          and(eq(outboundMessages.id, input.draftId), eq(outboundMessages.status, "draft")),
        );
      revalidatePath("/inbox");
      revalidatePath("/drafts");
    }
    return { ok: true, draftId: null };
  }

  const values = {
    threadKey: parent.threadKey,
    inReplyToId: parent.id,
    inReplyToMessageId: parent.messageId,
    references: referencesFor(parent),
    kind: input.kind,
    fromEmail: parseAddress(await defaultFrom()).email,
    fromName: null,
    toEmails: to.length > 0 ? to : input.kind === "reply" ? [parent.fromEmail] : [],
    subject: replySubject(input.kind, parent.subject),
    // Styles are inlined on the way in, so what is stored is what would be
    // sent — a draft that renders differently once posted is a trap.
    html: empty ? null : wrapEmailBody(input.html),
    text: input.text,
    status: "draft" as const,
    createdBy: session.user.id,
    updatedAt: new Date(),
  };

  /**
   * One row per client key, the same guarantee compose has had.
   *
   * `upsertKeyedDraft` lives in `lib/queries/outbound.ts` because both this
   * module and `actions/compose.ts` need it and a `"use server"` file cannot
   * export an internal write without publishing it as an RPC endpoint. The
   * identity half is passed separately so a replay of the same body cannot
   * reassign which conversation the reply belongs to.
   */
  if (input.clientKey) {
    const draftId = await upsertKeyedDraft(input.clientKey, input.draftId ?? null, {
      identity: {
        threadKey: values.threadKey,
        kind: values.kind,
        createdBy: values.createdBy,
        inReplyToId: values.inReplyToId,
        inReplyToMessageId: values.inReplyToMessageId,
        references: values.references,
      },
      content: {
        fromEmail: values.fromEmail,
        fromName: values.fromName,
        toEmails: values.toEmails,
        ccEmails: [],
        bccEmails: [],
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
    const [updated] = await db
      .update(outboundMessages)
      .set(values)
      .where(and(eq(outboundMessages.id, input.draftId), eq(outboundMessages.status, "draft")))
      .returning({ id: outboundMessages.id });
    if (updated) {
      revalidatePath("/drafts");
      return { ok: true, draftId: updated.id };
    }

    // Nothing matched: either the row moved on — Send flipped it to `queued`
    // while a debounced save was still in flight — or it was discarded. Only
    // the second deserves a fresh row; the first would put a duplicate of a
    // just-sent reply into Drafts.
    const [moved] = await db
      .select({ id: outboundMessages.id })
      .from(outboundMessages)
      .where(eq(outboundMessages.id, input.draftId))
      .limit(1);
    if (moved) return { ok: true, draftId: null };
  }

  const [created] = await db.insert(outboundMessages).values(values).returning({
    id: outboundMessages.id,
  });

  revalidatePath("/drafts");
  return { ok: true, draftId: created?.id ?? null };
}

/**
 * Send a reply or forward, and keep it.
 *
 * The row is written *before* the provider call and updated after, so a
 * message that fails to send is still visible in the thread with its error
 * rather than disappearing along with whatever was typed.
 */
export async function sendMessage(
  input: ComposeInput,
): Promise<Result<{ messageId: string }>> {
  const session = await requireSession();
  // The Identity context's send gate. Unenforced today; see `assertCanSend`.
  const refused = await assertCanSend(session, "thread.send");
  if (refused) return refused;

  if (isEmptyHtml(input.html)) {
    return { ok: false, error: "Write something before sending." };
  }

  const draft = await saveDraft(input);
  if (!draft.ok) return draft;
  if (!draft.draftId) return { ok: false, error: "Nothing to send." };

  const [row] = await db
    .select()
    .from(outboundMessages)
    .where(eq(outboundMessages.id, draft.draftId))
    .limit(1);

  if (!row) return { ok: false, error: "Draft disappeared" };
  if (row.toEmails.length === 0) {
    return { ok: false, error: "Add a recipient." };
  }

  /**
   * A reply is a send, so the suppression list applies to it.
   *
   * This path had no check at all: a hard bounce or a complaint from the very
   * person being replied to was recorded, shown in Suppressions, and then
   * ignored the moment somebody answered their last message. The draft is
   * left as it is — the text stays in the thread, and the person can change
   * the address.
   */
  // Every stored addressee, not just the one `sendOne` currently takes: if
  // this path ever starts copying Cc, the check already covers it.
  const suppressed = await assertNotSuppressed([
    ...row.toEmails,
    ...row.ccEmails,
    ...row.bccEmails,
  ]);
  if (suppressed) return { ok: false, error: suppressedMessage(suppressed) };

  const outcome = await sendClaimed({
    messageId: row.id,
    idempotencyKey: `outbound:${row.id}`,
    message: {
      to: row.toEmails[0]!,
      from: await defaultFrom(),
      subject: row.subject ?? "(no subject)",
      html: row.html ?? "",
      ...(row.text ? { text: row.text } : {}),
      headers: {
        // Without both of these the reply arrives as a new conversation and
        // the thread visibly splits in the recipient's client.
        ...(row.inReplyToMessageId ? { "In-Reply-To": row.inReplyToMessageId } : {}),
        ...(row.references.length > 0 ? { References: row.references.join(" ") } : {}),
      },
    },
  });

  if (!outcome.ok) {
    revalidatePath("/inbox");
    return outcome;
  }

  /**
   * Answering a thread means you have dealt with it.
   *
   * Keyed on `thread_key` and **not** routed through `applyThreadStatus`,
   * which takes an *inbound* message id — `row.id` here is an
   * `outbound_messages` id, and handing it over resolves to no thread at all,
   * so the conversation would silently stay unread. The key is what this
   * caller holds; the message id is what that helper's callers hold.
   *
   * It also deliberately publishes nothing. `applyThreadStatus`' callers are
   * acting *on* a conversation and the badge should follow; this is a
   * side effect of sending, and the reply itself already triggers the refresh
   * that reconciles the count.
   *
   * Skipped on a replay: the row had already gone out, so the thread was
   * marked read by the call that actually sent it, and repeating it would move
   * `read_at` on a conversation nobody just answered.
   */
  if (!outcome.alreadySent) {
    await db.execute(sql`
      UPDATE inbound_emails SET status = 'read'::inbound_status, read_at = COALESCE(read_at, now())
      WHERE thread_key = ${row.threadKey} AND status = 'unread'
    `);
  }

  revalidatePath("/inbox");
  revalidatePath("/sent");
  revalidatePath("/drafts");
  return { ok: true, messageId: row.id };
}

export async function discardDraft(draftId: string): Promise<Result> {
  await requireSession();
  await db
    .delete(outboundMessages)
    .where(and(eq(outboundMessages.id, draftId), eq(outboundMessages.status, "draft")));
  revalidatePath("/inbox");
  revalidatePath("/drafts");
  return { ok: true };
}


/**
 * Pull sent mail and its delivery status from Resend.
 *
 * The counterpart to the inbox's Sync. It runs inline rather than through a
 * job for the same reason: it exists to rescue an account whose webhooks were
 * never wired up, so it cannot depend on the machinery that was not running.
 */
export async function syncSent(): Promise<
  | { ok: true; imported: number; updated: number; campaignUpdated: number; scanned: number }
  | { ok: false; error: string }
> {
  await requireSession();

  try {
    const result = await syncSentEmails({ max: 200 });
    revalidatePath("/sent");
    revalidatePath("/inbox");
    revalidatePath("/campaigns");
    return {
      ok: true,
      imported: result.imported,
      updated: result.updated,
      campaignUpdated: result.campaignUpdated,
      scanned: result.scanned,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed.";
    if (/RESEND_API_KEY|No Resend API key/i.test(message)) {
      return { ok: false, error: "No Resend API key is configured. Add one in Settings → Email." };
    }
    return { ok: false, error: message };
  }
}
