/**
 * Address handling. Every address entering the system goes through
 * `normalizeEmail` exactly once, at the edge, and is stored in that form.
 */

/**
 * Lowercase and trim. Deliberately *not* clever: we do not strip Gmail dots or
 * `+tags`, because two addresses that differ that way are genuinely different
 * mailboxes as far as a mail server is concerned, and silently merging them
 * would let a suppressed address receive mail under an alias.
 */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * A cheap syntactic gate — one `@`, something either side, a dot in the
 * domain, no whitespace. It rejects obvious garbage from CSV imports before it
 * reaches the provider.
 *
 * It cannot tell you an address exists. Nothing can, short of sending to it;
 * that is what the suppression list is for.
 */
export function isLikelyValidEmail(input: string): boolean {
  const value = normalizeEmail(input);
  if (value.length === 0 || value.length > 254) return false;
  if (/\s/.test(value)) return false;

  const parts = value.split("@");
  if (parts.length !== 2) return false;

  const [local, domain] = parts as [string, string];
  if (local.length === 0 || local.length > 64) return false;
  if (domain.length === 0 || !domain.includes(".")) return false;
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return false;

  return true;
}

/** Split `"Ada Lovelace" <ada@example.com>` into its parts. */
export function parseAddress(input: string): { name: string | null; email: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(input);
  if (match) {
    const rawName = (match[1] ?? "").replace(/^"|"$/g, "").trim();
    return { name: rawName.length > 0 ? rawName : null, email: normalizeEmail(match[2] ?? "") };
  }
  return { name: null, email: normalizeEmail(input) };
}

/**
 * Group a message into a conversation.
 *
 * The root of a thread is the first entry of `References` — mail clients append
 * to that header as a reply chain grows, so its head is stable across the whole
 * conversation. `In-Reply-To` is the fallback for clients that omit
 * `References`, and a message's own id is the fallback for a brand-new thread.
 */
export function deriveThreadKey(input: {
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: readonly string[] | null;
}): string {
  const root = input.references?.find((value) => value.trim().length > 0);
  return (
    root?.trim() ??
    input.inReplyTo?.trim() ??
    input.messageId?.trim() ??
    `orphan:${crypto.randomUUID()}`
  );
}

/**
 * First `limit` characters of a body, whitespace collapsed, for list rows.
 *
 * The order of the passes matters. Stripping `<[^>]+>` first would take the
 * opening half of a conditional comment — `<!--[if mso]>` — and leave the
 * `<![endif]-->` behind, which is how a list ends up sprinkled with stray
 * angle brackets. Comments and the contents of `<style>`/`<script>` go first,
 * whole; entities are decoded last, once nothing can be mistaken for a tag.
 */
export function toSnippet(body: string | null | undefined, limit = 200): string | null {
  if (!body) return null;
  const flat = body
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length === 0) return null;
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}
