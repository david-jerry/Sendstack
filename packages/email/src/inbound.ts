import { deriveThreadKey, parseAddress, toSnippet } from "@sendstack/shared";
import { resendClient } from "./client";

/**
 * Fetching the body of a received email.
 *
 * This step exists because Resend's `email.received` webhook carries metadata
 * only — sender, recipients, subject, attachment descriptors — and no body,
 * headers or attachment bytes. Those come from a second call to the Received
 * Emails API. So an inbound message is always a two-phase arrival: the row
 * appears immediately from the webhook, and its content fills in a moment
 * later. Both the schema (`contentFetchedAt`) and the UI are built around that
 * gap rather than pretending it does not exist.
 */

export type NormalizedInbound = {
  providerEmailId: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  threadKey: string;
  fromEmail: string;
  fromName: string | null;
  toEmails: string[];
  ccEmails: string[];
  subject: string | null;
  snippet: string | null;
  html: string | null;
  text: string | null;
  headers: Record<string, string> | null;
  attachments: {
    providerAttachmentId: string;
    filename: string;
    contentType: string | null;
    size: number | null;
  }[];
  receivedAt: Date;
};

/** Header lookup that ignores case, since providers do not agree on it. */
function header(headers: Record<string, string> | null, name: string): string | null {
  if (!headers) return null;
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return null;
}

/** `References` is a whitespace-separated list of `<message-id>` tokens. */
function parseReferences(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

/**
 * Phase two of an inbound arrival, and the ingestion boundary for a reply.
 *
 * Normalisation is the point of it, not the fetch. Every address it returns
 * has been through `parseAddress`, which lowercases and trims, and the thread
 * key through `deriveThreadKey` — once, here, rather than at each of the
 * places that later compare them. A caller assembling its own
 * `NormalizedInbound` from the provider's payload would be the one path where
 * a `From` of `Bob@Example.com` reached the database as written and then
 * matched no contact and joined no thread, on equality comparisons that look
 * perfectly correct at both ends.
 *
 * The `html` and `text` it returns are data. Nothing here sanitises them and
 * nothing downstream may treat them as trusted app content.
 *
 * It throws rather than returning a partial record: the row already exists
 * from the webhook, so a failed fetch simply leaves `contentFetchedAt` unset,
 * which is the state the schema and the inbox are already built around.
 */
export async function fetchInboundEmail(providerEmailId: string): Promise<NormalizedInbound> {
  const client = await resendClient();
  const response = await client.emails.receiving.get(providerEmailId);

  if (response.error || !response.data) {
    throw new Error(
      `Failed to fetch received email ${providerEmailId}: ${
        response.error?.message ?? "no data returned"
      }`,
    );
  }

  const email = response.data;
  const from = parseAddress(email.from);
  const headers = email.headers ?? null;
  const inReplyTo = header(headers, "in-reply-to");
  const references = parseReferences(header(headers, "references"));
  const messageId = email.message_id ?? header(headers, "message-id");

  return {
    providerEmailId: email.id,
    messageId,
    inReplyTo,
    references,
    threadKey: deriveThreadKey({ messageId, inReplyTo, references }),
    fromEmail: from.email,
    fromName: from.name,
    toEmails: (email.to ?? []).map((value) => parseAddress(value).email),
    ccEmails: (email.cc ?? []).map((value) => parseAddress(value).email),
    subject: email.subject ?? null,
    snippet: toSnippet(email.text ?? email.html),
    html: email.html ?? null,
    text: email.text ?? null,
    headers,
    attachments: (email.attachments ?? []).map((attachment) => ({
      providerAttachmentId: attachment.id,
      filename: attachment.filename ?? "attachment",
      contentType: attachment.content_type ?? null,
      size: attachment.size ?? null,
    })),
    receivedAt: new Date(email.created_at),
  };
}
