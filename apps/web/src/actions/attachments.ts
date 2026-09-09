"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSession } from "@sendstack/auth";
import { getConfig } from "@sendstack/config";
import { db, eq, sql } from "@sendstack/db";
import { outboundAttachments, outboundMessages } from "@sendstack/db/schema";
import { defaultFrom } from "@sendstack/email";
import { INLINE_IMAGE_TYPES, MAX_ATTACHMENTS_PER_MESSAGE, MAX_ATTACHMENTS_TOTAL_BYTES, MAX_ATTACHMENT_BYTES, absoluteUrl, formatBytes, parseAddress } from "@sendstack/shared";
import { referencesFor, replyParent } from "@/lib/queries/thread";

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

export type AttachedFile = {
  id: string;
  filename: string;
  contentType: string | null;
  byteSize: number;
  disposition: "attachment" | "inline";
  /** Absolute, because an inline image is fetched by the recipient's client. */
  url: string;
};

/** The public URL an inline image is embedded with, and a sent copy links to. */
function attachmentUrl(appUrl: string, id: string, checksum: string): string {
  return `${absoluteUrl(appUrl, `/api/attachments/${id}`)}?v=${checksum.slice(0, 12)}`;
}

/**
 * Attach a file to a message being composed.
 *
 * The draft is created on demand: someone can open the composer and attach a
 * file before typing anything, and refusing that — or silently dropping the
 * file until a subject exists — would be the wrong half of the interaction to
 * enforce. The row it creates is the same draft the autosave would have made.
 */
export async function attachFile(formData: FormData): Promise<Result<{
  draftId: string;
  file: AttachedFile;
}>> {
  const session = await requireSession();

  const file = formData.get("file");
  const disposition = formData.get("disposition") === "inline" ? "inline" : "attachment";
  const submittedDraftId = formData.get("draftId");
  const threadKey = formData.get("threadKey");

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to attach." };
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      error: `${file.name} is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_ATTACHMENT_BYTES)} per file.`,
    };
  }
  if (disposition === "inline" && !INLINE_IMAGE_TYPES.includes(file.type as never)) {
    return { ok: false, error: "Inline images must be PNG, JPEG, GIF, WebP or SVG." };
  }

  const draftId =
    typeof submittedDraftId === "string" && submittedDraftId.length > 0
      ? submittedDraftId
      : null;

  let messageId = draftId;
  if (!messageId) {
    /**
     * A file attached before the first keystroke still starts a draft — and
     * that draft belongs to whatever conversation the composer was open in.
     *
     * It used to be written as `kind: 'compose'` with no parent regardless.
     * `saveDraft` overwrote both on the first keystroke, so the bug only
     * survived when somebody attached a file and closed the composer without
     * typing: the draft then sat in Drafts with no link to the thread it was
     * written in, and no way to get back to it.
     *
     * `replyParent` returns null for a `compose:` key, which is exactly the
     * fresh-compose case, so this needs no test for which kind of key it was
     * handed.
     */
    const parent =
      typeof threadKey === "string" && threadKey.length > 0
        ? await replyParent({ threadKey })
        : null;

    const [created] = await db
      .insert(outboundMessages)
      .values({
        threadKey:
          typeof threadKey === "string" && threadKey.length > 0
            ? threadKey
            : `compose:${crypto.randomUUID()}`,
        kind: parent ? "reply" : "compose",
        inReplyToId: parent?.id ?? null,
        inReplyToMessageId: parent?.messageId ?? null,
        ...(parent ? { references: referencesFor(parent) } : {}),
        fromEmail: parseAddress(await defaultFrom()).email,
        status: "draft",
        createdBy: session.user.id,
      })
      .returning({ id: outboundMessages.id });
    if (!created) return { ok: false, error: "Could not start a draft for this file." };
    messageId = created.id;
  }

  // Narrowed once, because the transaction below closes over it and a `let`
  // widens back to `string | null` inside a callback.
  const parentId: string = messageId;

  const bytes = Buffer.from(await file.arrayBuffer());
  const checksum = createHash("sha256").update(bytes).digest("hex");

  /**
   * Both limits and the insert under one row lock on the parent message.
   *
   * The lock is the arbitration, and a conditional `INSERT … SELECT` would not
   * be a substitute for it. Under READ COMMITTED — Postgres's default, and
   * what this connection uses — the sub-select of a second, concurrent insert
   * reads the snapshot taken when *its* statement began, so it cannot see a
   * sibling's uncommitted row. Two uploads then both count nine, both insert,
   * and the message leaves with twenty-one files or past
   * `MAX_ATTACHMENTS_TOTAL_BYTES`, which most mailboxes bounce outright. There
   * is no unique index that can express "at most N rows per parent", so the
   * only thing that serialises the two is `SELECT … FOR UPDATE` on the row
   * they share.
   *
   * The window needs two upload surfaces at once — pasting an inline image
   * while the attachment bar is still uploading, or the same draft in two
   * tabs — which is why this was quiet rather than absent.
   *
   * `status = 'draft'` rides along on the same lock: only a draft accepts new
   * files, because a message already handed to the provider would show an
   * attachment in the sent copy that no recipient ever received. Checking it
   * before the lock, as this did, left exactly the same gap — Send could flip
   * the row between the check and the insert.
   */
  const stored = await db.transaction(async (tx) => {
    const locked = Array.from(
      await tx.execute<{ id: string }>(sql`
        SELECT id FROM outbound_messages
        WHERE id = ${parentId}::uuid AND status = 'draft'
        FOR UPDATE
      `),
    );
    if (locked.length === 0) {
      return { ok: false as const, error: "That draft is no longer open for editing." };
    }

    // One query for both limits rather than a count and a sum — they are two
    // facts about the same set of rows.
    const [existing] = Array.from(
      await tx.execute<{ count: number; bytes: number }>(sql`
        SELECT count(*)::int AS count, COALESCE(sum(byte_size), 0)::int AS bytes
        FROM outbound_attachments WHERE message_id = ${parentId}::uuid
      `),
    );
    const count = existing?.count ?? 0;
    const used = existing?.bytes ?? 0;

    if (count >= MAX_ATTACHMENTS_PER_MESSAGE) {
      return {
        ok: false as const,
        error: `A message can carry ${MAX_ATTACHMENTS_PER_MESSAGE} files.`,
      };
    }
    if (used + bytes.byteLength > MAX_ATTACHMENTS_TOTAL_BYTES) {
      return {
        ok: false as const,
        error: `That would take the message past ${formatBytes(MAX_ATTACHMENTS_TOTAL_BYTES)}. Most mailboxes reject anything larger.`,
      };
    }

    const [row] = await tx
      .insert(outboundAttachments)
      .values({
        messageId: parentId,
        disposition,
        filename: file.name,
        contentType: file.type || null,
        byteSize: bytes.byteLength,
        bytes,
        checksum,
      })
      .returning({ id: outboundAttachments.id });

    return row
      ? { ok: true as const, id: row.id }
      : { ok: false as const, error: "Could not store that file." };
  });

  if (!stored.ok) return stored;

  const config = await getConfig();
  revalidatePath("/drafts");

  return {
    ok: true,
    draftId: parentId,
    file: {
      id: stored.id,
      filename: file.name,
      contentType: file.type || null,
      byteSize: bytes.byteLength,
      disposition,
      url: attachmentUrl(config.appUrl, stored.id, checksum),
    },
  };
}

/** Remove a file from a draft. Sent messages keep theirs. */
export async function removeAttachment(id: string): Promise<Result> {
  await requireSession();

  // The join is what enforces "drafts only" — deleting by id alone would let a
  // stale composer strip a file off a message that has already gone out.
  const removed = await db.execute<{ id: string }>(sql`
    DELETE FROM outbound_attachments a
    USING outbound_messages m
    WHERE a.id = ${id}::uuid AND m.id = a.message_id AND m.status = 'draft'
    RETURNING a.id
  `);

  if (Array.from(removed).length === 0) {
    return { ok: false, error: "That file is part of a message that has already been sent." };
  }

  revalidatePath("/drafts");
  return { ok: true };
}

/** The files already on a draft, for a composer opening one. */
export async function listAttachments(messageId: string): Promise<AttachedFile[]> {
  await requireSession();
  const config = await getConfig();

  const rows = await db
    .select({
      id: outboundAttachments.id,
      filename: outboundAttachments.filename,
      contentType: outboundAttachments.contentType,
      byteSize: outboundAttachments.byteSize,
      disposition: outboundAttachments.disposition,
      checksum: outboundAttachments.checksum,
    })
    .from(outboundAttachments)
    .where(eq(outboundAttachments.messageId, messageId))
    .orderBy(outboundAttachments.createdAt);

  return rows.map((row) => ({
    id: row.id,
    filename: row.filename,
    contentType: row.contentType,
    byteSize: row.byteSize,
    disposition: row.disposition,
    url: attachmentUrl(config.appUrl, row.id, row.checksum),
  }));
}
