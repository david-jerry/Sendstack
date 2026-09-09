/**
 * VAPID key generation, with no dependency at all.
 *
 * `web-push` has a `generateVAPIDKeys()` and this could have called it. It
 * does not, for one reason worth the twenty lines: a package whose job is to
 * be dropped into other projects should not drag a mail-sending library into
 * a project that only wants to *generate* a pair — and the whole of VAPID key
 * generation is "make a P-256 keypair and encode both halves base64url",
 * which `node:crypto` already does.
 *
 * Plain JavaScript with JSDoc rather than TypeScript, because `bin/cli.mjs`
 * imports it and that runs under whatever node the consumer has. Types come
 * from `vapid.d.ts` beside it. The duplication is two signatures wide and is
 * the price of being runnable without a build step.
 *
 * The format is fixed by RFC 8292 and by what browsers accept:
 *
 *  - the **public** key is the uncompressed EC point, `0x04 || X || Y`, 65
 *    bytes, base64url — this is what goes to `pushManager.subscribe` as
 *    `applicationServerKey`;
 *  - the **private** key is the raw 32-byte scalar, base64url.
 *
 * Anything else — SPKI, PKCS#8, PEM, base64 with padding — is rejected
 * somewhere downstream with an error that names none of this.
 */

import { createECDH, generateKeyPairSync } from "node:crypto";

/**
 * The validators live in `vapid-shape.mjs` and are re-exported from here.
 *
 * They are pure string arithmetic with no imports, which is what lets the
 * browser use them one line before `atob()` — this file cannot, because
 * `node:crypto` does not exist there. Re-exporting keeps `@sendstack/pwa/vapid`
 * a single import for server code that wants both halves.
 */
export {
  describeVapidProblem,
  isValidVapidPrivateKey,
  isValidVapidPublicKey,
  isValidVapidSubject,
  normaliseVapidSubject,
} from "./vapid-shape.mjs";

import {
  isValidVapidPrivateKey,
  isValidVapidPublicKey,
} from "./vapid-shape.mjs";

/**
 * @typedef {object} VapidKeys
 * @property {string} publicKey 65 bytes, base64url. Safe to ship to the browser.
 * @property {string} privateKey 32 bytes, base64url. A secret; encrypt it at rest.
 */

/**
 * Base64url, unpadded — the only encoding the Push API accepts.
 *
 * @param {Buffer} bytes
 * @returns {string}
 */
function toBase64Url(bytes) {
  return bytes.toString("base64url");
}

/**
 * Base64url back to bytes. Node's `"base64url"` also accepts standard base64,
 * which is why the validators check the alphabet separately.
 *
 * @param {string} value
 * @returns {Buffer}
 */
function fromBase64Url(value) {
  return Buffer.from(value, "base64url");
}

/**
 * A fresh application server keypair.
 *
 * Generate **once per instance**. A browser binds each subscription to the
 * public key it was created with, so replacing the pair silently stops
 * notifications on every device that already subscribed — they are not
 * migrated and they do not error, they simply never arrive again. Anything
 * that rotates these has to delete the subscriptions too, or the device list
 * becomes a list of addresses nothing can reach.
 */
/** @returns {VapidKeys} */
export function generateVapidKeys() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

  // JWK, because it is the one export format that hands over the raw scalar
  // and the raw coordinates. DER would need parsing to find them.
  const jwk = privateKey.export({ format: "jwk" });
  if (!jwk.x || !jwk.y || !jwk.d) {
    throw new Error("Generated key is missing its coordinates; cannot form a VAPID pair.");
  }

  return {
    publicKey: toBase64Url(
      Buffer.concat([Buffer.of(0x04), fromBase64Url(jwk.x), fromBase64Url(jwk.y)]),
    ),
    privateKey: jwk.d,
  };
}

/**
 * Whether the two halves belong to each other.
 *
 * The failure this prevents is specific and nasty: a pair that is half-rotated
 * — a new public key beside an old private one — signs every push with a
 * signature the push service rejects, and the rejection says nothing about
 * keys.
 *
 * The public point is **derived** from the scalar rather than imported
 * alongside it. That distinction is the whole test: `createPrivateKey` will
 * happily import a JWK whose `x`/`y` belong to a different key and echo them
 * straight back, so a comparison built on it returns true for exactly the
 * mismatched pair it was written to catch. ECDH is the API that actually does
 * the multiplication.
 */
/** @param {string} publicKey @param {string} privateKey @returns {boolean} */
export function keysMatch(publicKey, privateKey) {
  if (!isValidVapidPublicKey(publicKey) || !isValidVapidPrivateKey(privateKey)) return false;

  try {
    const ecdh = createECDH("prime256v1");
    // Throws on a scalar outside the curve order, which is also worth knowing.
    ecdh.setPrivateKey(fromBase64Url(privateKey));
    return ecdh.getPublicKey().equals(fromBase64Url(publicKey));
  } catch {
    return false;
  }
}

