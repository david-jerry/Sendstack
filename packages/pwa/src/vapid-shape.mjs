/**
 * Shape checks for VAPID credentials, with no imports at all.
 *
 * ## Why this is a separate file from `vapid.mjs`
 *
 * Generating a keypair needs `node:crypto`, so `vapid.mjs` cannot run in a
 * browser. But the *most valuable* place to check a key is the browser, one
 * line before `atob()` — and the reason is a real bug this file exists to
 * close:
 *
 * `.env.example` documented the keys with an ellipsis placeholder,
 * `VAPID_PUBLIC_KEY="…"`. Uncomment that and `…` becomes the key. It is a
 * non-empty string, so `push.configured` said yes; it reached
 * `pushManager.subscribe` by way of `atob`, and Chrome answered:
 *
 *     Failed to execute 'atob' on 'Window': The string to be decoded
 *     contains characters outside of the Latin1 range.
 *
 * Which is true, and says nothing about VAPID, keys, or the file the value
 * came from. Worse, the bad value made the app report itself *configured*,
 * which hid the button that would have generated a real pair — so the state
 * could not be escaped from inside the app.
 *
 * Everything here is therefore pure arithmetic on a string: no `Buffer`, no
 * `atob`, no `node:crypto`. It runs in a service worker, a browser, an edge
 * runtime and node, which is what lets one implementation guard every
 * boundary instead of three copies drifting apart.
 *
 * ## The magic numbers
 *
 * Both lengths are forced by the format, so they are checked exactly rather
 * than as a range:
 *
 *  - A **public key** is the uncompressed P-256 point `0x04 || X || Y` — 65
 *    bytes. 65 = 21×3 + 2, so unpadded base64url is 4×22 − 1 = **87 chars**.
 *    The leading `0x04` is `0b00000100`, whose first six bits are `000001` —
 *    base64 index 1 — so a valid key always **starts with `B`**.
 *  - A **private key** is the raw 32-byte scalar. 32 = 10×3 + 2, so unpadded
 *    base64url is 4×11 − 1 = **43 chars**.
 */

/** Base64url alphabet, unpadded. `+`, `/` and `=` are all invalid here. */
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** 87 characters, and the first one pinned by the `0x04` point prefix. */
const PUBLIC_KEY_LENGTH = 87;
const PRIVATE_KEY_LENGTH = 43;

/**
 * Whether a string is the shape `pushManager.subscribe` will accept as an
 * `applicationServerKey`.
 *
 * Checked wherever a key is read or saved rather than only where it is used: a
 * malformed key otherwise fails inside `subscribe()` on somebody else's
 * device, days after the paste that caused it.
 *
 * Deliberately strict about the *encoding* as well as the length. Standard
 * base64 — with `+`, `/` and `=` — is the single most common way to get this
 * wrong, decodes to the right bytes in some libraries and not others, and is
 * rejected here so the failure happens at the paste.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidVapidPublicKey(value) {
  if (typeof value !== "string") return false;
  if (value.length !== PUBLIC_KEY_LENGTH) return false;
  if (!BASE64URL.test(value)) return false;
  // `B` is not cosmetic: it is the encoded `0x04` that marks the point
  // uncompressed. A compressed point (`0x02`/`0x03`) is a valid EC encoding
  // that the Push API will not take.
  return value.startsWith("B");
}

/**
 * Whether a string is the shape of a VAPID private key: the raw 32-byte
 * scalar, base64url.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidVapidPrivateKey(value) {
  if (typeof value !== "string") return false;
  return value.length === PRIVATE_KEY_LENGTH && BASE64URL.test(value);
}

/**
 * Whether the subject is a contact URL a push service will accept.
 *
 * RFC 8292 requires a `mailto:` or `https:` URL. A bare email address is the
 * usual mistake, and the reason it is refused rather than tolerated is that
 * some push services accept it and others reject the whole request — an
 * inconsistency that shows up as "notifications work for some people".
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidVapidSubject(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (/^mailto:\S+@\S+\.\S+$/.test(trimmed)) return true;
  return /^https:\/\/\S+\.\S+/.test(trimmed);
}

/**
 * Adds the `mailto:` a bare address is missing, and changes nothing else.
 *
 * Applied at the point a subject is *entered* so a person typing their own
 * email address into a contact field gets the right thing rather than a
 * validation error explaining a URI scheme.
 *
 * @param {string} value
 * @returns {string}
 */
export function normaliseVapidSubject(value) {
  const trimmed = String(value).trim();
  if (/^[^\s:]+@[^\s:]+\.[^\s:]+$/.test(trimmed)) return `mailto:${trimmed}`;
  return trimmed;
}

/**
 * Why a credential was rejected, in a sentence somebody can act on.
 *
 * Returns null when there is nothing wrong. Exists because a boolean is not
 * enough at the two boundaries that matter: an operator reading a server log
 * needs to know *which* value is wrong and *how*, and "invalid VAPID key" sent
 * them to check the private key when the public one had an ellipsis in it.
 *
 * @param {object} credentials
 * @param {unknown} [credentials.publicKey]
 * @param {unknown} [credentials.privateKey]
 * @param {unknown} [credentials.subject]
 * @returns {string | null}
 */
export function describeVapidProblem({ publicKey, privateKey, subject }) {
  if (publicKey !== undefined && !isValidVapidPublicKey(publicKey)) {
    return describeKeyProblem(publicKey, PUBLIC_KEY_LENGTH, "public");
  }
  if (privateKey !== undefined && !isValidVapidPrivateKey(privateKey)) {
    return describeKeyProblem(privateKey, PRIVATE_KEY_LENGTH, "private");
  }
  if (subject !== undefined && !isValidVapidSubject(subject)) {
    return (
      `The VAPID subject ${quote(subject)} is not a mailto: address or an https: URL, ` +
      "which RFC 8292 requires."
    );
  }
  return null;
}

/**
 * The most specific complaint that fits, checked most-specific first.
 *
 * The ordering is the point. "Wrong length" is technically true of `"…"` and
 * completely unhelpful; "contains non-ASCII characters, it looks like a
 * placeholder" is the sentence that ends the investigation. So the checks run
 * missing → non-ASCII → wrong alphabet → wrong length → wrong key type, and
 * the first match wins.
 *
 * @param {unknown} value The offending credential.
 * @param {number} expected Its required length in characters.
 * @param {"public"|"private"} half Which key, so the message can name it.
 * @returns {string}
 */
function describeKeyProblem(value, expected, half) {
  if (typeof value !== "string" || value.length === 0) {
    return `The VAPID ${half} key is missing.`;
  }
  if (/[^\x20-\x7e]/.test(value)) {
    // The exact case that produced the atob error. Named explicitly, because
    // the placeholder in .env.example was this and nothing said so.
    return (
      `The VAPID ${half} key ${quote(value)} contains non-ASCII characters — ` +
      "it looks like a documentation placeholder rather than a real key. " +
      "Generate a pair in Settings, or with `npx sendstack-pwa vapid`."
    );
  }
  if (!BASE64URL.test(value)) {
    return (
      `The VAPID ${half} key is not base64url. It must use only A-Z, a-z, 0-9, ` +
      "`-` and `_` — standard base64 with `+`, `/` or `=` will not work."
    );
  }
  if (value.length !== expected) {
    return `The VAPID ${half} key is ${value.length} characters; it must be exactly ${expected}.`;
  }
  return (
    `The VAPID ${half} key is the wrong kind of key — it must be an uncompressed ` +
    "P-256 point, which always begins with `B`."
  );
}

/**
 * Quotes a value for a log line, truncated to twelve characters.
 *
 * These messages reach a server log, and a private key quoted in full would
 * outlive the rotation meant to retire it. Twelve is enough to recognise a
 * placeholder — which is the whole reason the value is shown at all — and far
 * too little to reconstruct a key from.
 *
 * @param {unknown} value
 * @returns {string}
 */
function quote(value) {
  const text = String(value);
  return `"${text.length > 12 ? `${text.slice(0, 12)}…` : text}"`;
}
