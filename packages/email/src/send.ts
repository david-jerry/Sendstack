import type { CreateBatchEmailOptions } from "resend";
import { SEND_BATCH_SIZE } from "@sendstack/shared";
import { resendClient } from "./client";

export type OutboundMessage = {
  /** Our `campaign_recipients.id`. Round-trips through Resend as a tag. */
  recipientId: string;
  to: string;
  /**
   * Additional visible and blind recipients.
   *
   * A campaign never sets these — every recipient gets their own message so
   * that unsubscribe links, tracking and personalisation stay per-person. They
   * exist for the composer, where copying a colleague on one message is
   * ordinary and expected.
   */
  cc?: string[] | undefined;
  bcc?: string[] | undefined;
  from: string;
  replyTo?: string | undefined;
  subject: string;
  html: string;
  text?: string | undefined;
  headers?: Record<string, string> | undefined;
  /**
   * Files to send with the message.
   *
   * `content` is the raw bytes; the SDK base64-encodes them. Campaigns never
   * set this — a file repeated across ten thousand messages is ten thousand
   * copies over the wire, and the link that avoids that is a better email
   * anyway. It exists for mail a person composed.
   */
  attachments?: OutboundAttachment[] | undefined;
};

export type OutboundAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string | undefined;
};

export type BatchSendResult = {
  sent: { recipientId: string; providerMessageId: string | null }[];
  failed: { recipientId: string; error: string }[];
};

/**
 * The tag that ties a provider event back to one of our recipient rows.
 *
 * Resend echoes tags into every webhook event for a message, which makes
 * correlation independent of response ordering — see the note in `sendBatch`
 * about why that matters. Tag values are restricted to ASCII letters, digits,
 * underscores and dashes; a UUID satisfies that.
 */
export const RECIPIENT_TAG = "recipient_id";

function toResendPayload(message: OutboundMessage): CreateBatchEmailOptions {
  return {
    from: message.from,
    to: [message.to],
    subject: message.subject,
    html: message.html,
    ...(message.text ? { text: message.text } : {}),
    ...(message.cc?.length ? { cc: message.cc } : {}),
    ...(message.bcc?.length ? { bcc: message.bcc } : {}),
    ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    ...(message.headers ? { headers: message.headers } : {}),
    ...(message.attachments?.length ? { attachments: message.attachments } : {}),
    tags: [{ name: RECIPIENT_TAG, value: message.recipientId }],
  };
}

/**
 * Send up to SEND_BATCH_SIZE messages in one API call.
 *
 * `batchValidation: "permissive"` is the important flag. Under the default
 * "strict", one malformed address rejects the entire batch — so a single bad
 * row in a CSV import would block 99 valid sends, and the retry would hit the
 * same wall forever. Permissive sends what it can and reports the rest by
 * index.
 *
 * That per-index reporting creates the one subtlety here: the success array
 * contains only the messages that were accepted, so its indices no longer line
 * up with the input once anything fails. We rebuild the pairing by walking the
 * inputs in order and skipping the reported failures. Message ids assigned by
 * that reconstruction are therefore best-effort, which is exactly why
 * `RECIPIENT_TAG` exists: correlation of later delivery events does not depend
 * on it being right.
 *
 * Two kinds of failure, treated differently on purpose:
 *
 *  - A **per-item** failure — Resend looked at one message and refused it —
 *    is final for that recipient and comes back in `failed`.
 *  - A **transport** failure — a 5xx, a 429, a timeout, an auth error — says
 *    nothing about any individual message, so it is *thrown*. The caller's
 *    retry is the right response, and returning a hundred `failed` entries
 *    instead permanently failed a hundred recipients over a hiccup that a
 *    second attempt would have sailed through. The thrown error is an ordinary
 *    `Error`, never Inngest's `NonRetriableError`, precisely so that retry
 *    happens.
 */
export async function sendBatch(
  messages: OutboundMessage[],
  options: { idempotencyKey: string },
): Promise<BatchSendResult> {
  if (messages.length === 0) return { sent: [], failed: [] };
  if (messages.length > SEND_BATCH_SIZE) {
    throw new Error(
      `sendBatch received ${messages.length} messages; Resend accepts at most ${SEND_BATCH_SIZE}.`,
    );
  }

  const client = await resendClient();
  const response = await client.batch.send(messages.map(toResendPayload), {
    batchValidation: "permissive",
    idempotencyKey: options.idempotencyKey,
  });

  if (response.error || !response.data) {
    throw new BatchTransportError(
      response.error?.message ?? "Resend returned no data",
      response.error?.name,
    );
  }

  const errors = (response.data as { errors?: { index: number; message: string }[] }).errors ?? [];
  const failedByIndex = new Map(errors.map((entry) => [entry.index, entry.message]));
  const accepted = response.data.data ?? [];

  const sent: BatchSendResult["sent"] = [];
  const failed: BatchSendResult["failed"] = [];
  let acceptedCursor = 0;

  messages.forEach((message, index) => {
    const failure = failedByIndex.get(index);
    if (failure !== undefined) {
      failed.push({ recipientId: message.recipientId, error: failure });
      return;
    }
    sent.push({
      recipientId: message.recipientId,
      providerMessageId: accepted[acceptedCursor]?.id ?? null,
    });
    acceptedCursor += 1;
  });

  return { sent, failed };
}

/**
 * The whole batch was refused, or never reached the provider.
 *
 * A distinct class so a caller can tell "retry this" from a programming error
 * without parsing the message. `code` is Resend's error name
 * (`rate_limit_exceeded`, `internal_server_error`, …) when there was one.
 */
export class BatchTransportError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(`Batch send failed: ${message}`);
    this.name = "BatchTransportError";
    this.code = code;
  }
}

/** A single transactional send — inbox replies, password resets, test sends. */
export async function sendOne(
  message: Omit<OutboundMessage, "recipientId"> & { recipientId?: string },
  options?: { idempotencyKey?: string },
): Promise<{ id: string | null; error: string | null }> {
  const client = await resendClient();
  const response = await client.emails.send(
    {
      from: message.from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      ...(message.text ? { text: message.text } : {}),
      ...(message.cc?.length ? { cc: message.cc } : {}),
      ...(message.bcc?.length ? { bcc: message.bcc } : {}),
      ...(message.attachments?.length ? { attachments: message.attachments } : {}),
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      ...(message.headers ? { headers: message.headers } : {}),
      ...(message.recipientId
        ? { tags: [{ name: RECIPIENT_TAG, value: message.recipientId }] }
        : {}),
    },
    options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined,
  );

  if (response.error) return { id: null, error: response.error.message };
  return { id: response.data?.id ?? null, error: null };
}

/** Pull our recipient id back out of a webhook event's tags. */
export function recipientIdFromTags(tags: Record<string, string> | undefined): string | null {
  return tags?.[RECIPIENT_TAG] ?? null;
}
