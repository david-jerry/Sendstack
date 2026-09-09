import "server-only";
import { and, db, eq, ne } from "@sendstack/db";
import { outboundAttachments, outboundMessages } from "@sendstack/db/schema";
import { htmlToText, sendOne, type OutboundMessage } from "@sendstack/email";

/**
 * The parts of a one-to-one send that only the caller can decide.
 *
 * Everything absent from this type — the attachment query, the claim, the
 * provider call, the two status writes — is the same on both paths and lives
 * below. `html` is required and `text` optional because the fallback is a rule
 * rather than a caller's choice; see `sendClaimed`.
 */
export type OneToOneMessage = Omit<OutboundMessage, "recipientId" | "attachments" | "text"> & {
  text?: string | undefined;
};

/**
 * What happened, in the shape both callers already return.
 *
 * `alreadySent` is not an error and not a plain success: the row had gone out
 * before this call, so nothing was sent now and the caller should answer with
 * the row it has. Distinguished from a fresh send because the reply path also
 * marks its thread read afterwards, and doing that twice is harmless while
 * doing it on a replay is misleading.
 */
export type SendOutcome =
  | { ok: true; alreadySent: boolean }
  | { ok: false; error: string };

/**
 * Claim an outbound row, hand it to the provider, and record what came back.
 *
 * **The three writes here were duplicated between `sendSingleEmail` in
 * `actions/compose.ts` and `sendMessage` in `actions/thread.ts`, byte for
 * byte.** So were the attachment query and the mapping into the provider's
 * shape. What legitimately differs between a composed message and a reply is
 * everything *before* this point — validation, rendering, which addresses go
 * in Cc, the threading headers — and none of it is here.
 *
 * That split is the reason the duplication was dangerous rather than merely
 * untidy. The claim's `WHERE status <> 'sent'` is the only thing standing
 * between a double-clicked Send and a second real email, and it was missing
 * from the reply copy for a while: a row already sent was dragged back to
 * `queued` and handed to the provider again under the same idempotency key,
 * which Resend collapses inside its 24-hour window and not a minute after it.
 * A duplicate that arrives a day late is the hardest kind to notice. One copy
 * of the claim cannot be missing from one path.
 *
 * ## Ordering, all three parts load-bearing
 *
 * Attachments are read *before* the claim so a provider call is never made
 * holding a `queued` row while waiting on a second query. The claim is a
 * single conditional `UPDATE … RETURNING`, so two concurrent submissions do
 * not read-then-write across an `await` (CLAUDE.md §7) — and both may claim,
 * because neither is `sent` yet, which is correct: they then call the provider
 * with the same key and Resend collapses them. The row is recorded after the
 * provider answers, never before, so `providerMessageId` is only ever a real
 * id.
 *
 * Zero rows claimed means the row is already `sent`. That is reported as
 * success, not as a conflict: the browser never saw the first answer, and this
 * is that answer, late.
 *
 * @param messageId the row to send — already written by the caller, so a
 *   provider failure leaves the text visible with its error rather than
 *   vanishing along with what the person wrote.
 */
export async function sendClaimed(options: {
  messageId: string;
  idempotencyKey: string;
  message: OneToOneMessage;
}): Promise<SendOutcome> {
  const { messageId, idempotencyKey, message } = options;

  /**
   * Real attachments only, in the order they were added.
   *
   * An inline image is already a URL in the body; sending it again as a file
   * shows it twice in most clients. One query for the whole message rather
   * than one per file.
   */
  const files = await db
    .select({
      filename: outboundAttachments.filename,
      contentType: outboundAttachments.contentType,
      bytes: outboundAttachments.bytes,
    })
    .from(outboundAttachments)
    .where(
      and(
        eq(outboundAttachments.messageId, messageId),
        eq(outboundAttachments.disposition, "attachment"),
      ),
    )
    .orderBy(outboundAttachments.createdAt);

  const claimed = await db
    .update(outboundMessages)
    .set({ status: "queued", updatedAt: new Date() })
    .where(and(eq(outboundMessages.id, messageId), ne(outboundMessages.status, "sent")))
    .returning({ id: outboundMessages.id });

  if (claimed.length === 0) return { ok: true, alreadySent: true };

  const result = await sendOne(
    {
      ...message,
      /**
       * `||`, not `??`.
       *
       * The two copies of this spelled it differently, and the reply path used
       * `??` — so a row with `text: ""` sent an empty `text/plain` part rather
       * than a conversion of the HTML. A message whose plain-text alternative
       * is blank renders as nothing at all in a text-only client, and blank is
       * exactly what an empty column holds.
       */
      text: message.text || htmlToText(message.html),
      ...(files.length > 0
        ? {
            attachments: files.map((file) => ({
              filename: file.filename,
              content: file.bytes,
              ...(file.contentType ? { contentType: file.contentType } : {}),
            })),
          }
        : {}),
    },
    { idempotencyKey },
  );

  if (result.error) {
    await db
      .update(outboundMessages)
      .set({ status: "failed", error: result.error, updatedAt: new Date() })
      .where(eq(outboundMessages.id, messageId));
    return { ok: false, error: result.error };
  }

  await db
    .update(outboundMessages)
    .set({
      status: "sent",
      providerMessageId: result.id,
      sentAt: new Date(),
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(outboundMessages.id, messageId));

  return { ok: true, alreadySent: false };
}
