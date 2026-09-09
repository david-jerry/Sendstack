/**
 * Types for `vapid-shape.mjs`, which is plain JavaScript with no imports so it
 * can run in a browser, a service worker, an edge runtime and node alike.
 */

/** Whether a string is the shape `pushManager.subscribe` accepts: 87 base64url chars beginning `B`. */
export function isValidVapidPublicKey(value: unknown): boolean;

/** Whether a string is the raw 32-byte scalar, base64url: 43 characters. */
export function isValidVapidPrivateKey(value: unknown): boolean;

/** Whether the subject is a `mailto:` address or `https:` URL, as RFC 8292 requires. */
export function isValidVapidSubject(value: unknown): boolean;

/** `mailto:` prefixed if it looks like a bare address, otherwise unchanged. */
export function normaliseVapidSubject(value: string): string;

/**
 * Why a credential was rejected, as a sentence, or null if nothing is wrong.
 * Names which half is wrong and how — "invalid VAPID key" is not actionable.
 */
export function describeVapidProblem(credentials: {
  publicKey?: unknown;
  privateKey?: unknown;
  subject?: unknown;
}): string | null;
