import { createHmac, timingSafeEqual } from "node:crypto";
import { AUTH_SECRET_MIN_LENGTH, absoluteUrl, normalizeEmail } from "@sendstack/shared";

/**
 * Signed one-click unsubscribe.
 *
 * The link carries the address and a signature rather than a database row, so
 * unsubscribing costs no storage and works even for a contact deleted in the
 * meantime. It is signed because an unauthenticated `?email=` parameter lets
 * anyone unsubscribe anyone.
 *
 * Note the omission: no expiry. An unsubscribe link found in a two-year-old
 * email must still work — both because it is the right thing to do and because
 * RFC 8058 and every major mailbox provider expect it. Rotating AUTH_SECRET
 * invalidates every outstanding link, which is the one real cost.
 */
function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < AUTH_SECRET_MIN_LENGTH) {
    throw new Error(
      `AUTH_SECRET must be set to at least ${AUTH_SECRET_MIN_LENGTH} characters. Generate one with ` +
        "`openssl rand -base64 32`.",
    );
  }
  return value;
}

/**
 * The signature over an address, taken on its **normalised** form.
 *
 * `normalizeEmail` here is what makes the link survive the round trip. A
 * mailbox provider posting a one-click unsubscribe does not promise to send
 * the address back in the casing it was given, and a contact list contains
 * `Bob@Example.com` because a person typed it that way — sign the raw string
 * and the token is valid only for the exact spelling that produced it, so a
 * link rejects its own recipient. Both halves normalise, so any casing of one
 * address verifies against any other.
 */
export function signUnsubscribe(email: string): string {
  return createHmac("sha256", secret()).update(normalizeEmail(email)).digest("base64url");
}

/**
 * Whether this token was issued for **this** address.
 *
 * It takes the address rather than just the token, and re-derives, so a
 * signature is bound to the recipient it was minted for: a valid token lifted
 * from one email cannot be replayed against a different `?email=`, which is
 * the whole attack an unsigned parameter would allow.
 *
 * A malformed token is `false` rather than an exception. Blank and truncated
 * values are ordinary input here — they arrive on a query string, from a
 * client that wrapped the link across a line or an address bar that lost the
 * end of it — and `timingSafeEqual` throws on a length mismatch, so without
 * the guard beneath, the commonest broken link in the wild would be a 500
 * instead of a page saying the link is not valid.
 */
export function verifyUnsubscribe(email: string, token: string): boolean {
  const expected = Buffer.from(signUnsubscribe(email));
  const provided = Buffer.from(token);
  // Length must match before timingSafeEqual, which throws on a mismatch.
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

/**
 * The origin every unsubscribe link is hung off.
 *
 * Shared by both builders below so the human link and the machine endpoint can
 * never disagree about which deployment they point at — and so the trailing
 * slash is stripped in one place rather than two.
 */
function appBase(appUrl?: string): string {
  return absoluteUrl(appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");
}

/**
 * The signed `?email=…&token=…` both unsubscribe destinations carry.
 *
 * Factored out because the page and the one-click endpoint must present the
 * *same* signature for the same address: they differ only in path, and the two
 * building their own query strings is how one of them would come to sign the
 * un-normalised address and reject its own link.
 */
function unsubscribeQuery(email: string): string {
  const address = normalizeEmail(email);
  return new URLSearchParams({ email: address, token: signUnsubscribe(address) }).toString();
}

/** The page a person lands on when they click the footer link themselves. */
export function unsubscribeUrl(email: string, appUrl?: string): string {
  return `${appBase(appUrl)}/unsubscribe?${unsubscribeQuery(email)}`;
}

/**
 * RFC 8058 one-click unsubscribe headers.
 *
 * Without these, Gmail and Yahoo show a "report spam" button where they would
 * otherwise show "unsubscribe" — and a spam report costs a sender far more
 * than an unsubscribe does. Both bulk-sender programmes require them.
 *
 * **`/api/unsubscribe`, not the `/unsubscribe` that `unsubscribeUrl` builds.**
 * `List-Unsubscribe-Post` is a promise that the URL beside it answers a POST
 * with no body and no confirmation step, and the mailbox providers take it
 * literally: Gmail and Yahoo POST there the moment a recipient uses the
 * built-in button. `/unsubscribe` is a React page with no route handler, so
 * that POST was answered 405 — nobody was ever unsubscribed by the button,
 * and the recipient's next move is the spam report these headers exist to
 * avoid. The route handler lives at `/api/unsubscribe`, and this is the only
 * thing that points at it.
 *
 * The footer link deliberately keeps the page: a human following a link wants
 * the confirmation screen that a one-click POST must not have.
 */
export function unsubscribeHeaders(email: string, appUrl?: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${appBase(appUrl)}/api/unsubscribe?${unsubscribeQuery(email)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
