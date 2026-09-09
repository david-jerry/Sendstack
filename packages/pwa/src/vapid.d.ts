/**
 * Types for `vapid.mjs`, which is plain JavaScript so `bin/cli.mjs` can import
 * it under any node without a build step.
 */

export type VapidKeys = {
  /** 65 bytes, base64url. Safe to ship to the browser. */
  publicKey: string;
  /** 32 bytes, base64url. A secret; encrypt it at rest. */
  privateKey: string;
};

/**
 * A fresh application server keypair. Generate **once per instance** — a
 * browser binds each subscription to the public key it was created with.
 */
export function generateVapidKeys(): VapidKeys;

/**
 * Re-exported from `vapid-shape.mjs`, which has no imports and so can run in a
 * browser too. Import them from `@sendstack/pwa/vapid-shape` in client code.
 */
export {
  describeVapidProblem,
  isValidVapidPrivateKey,
  isValidVapidPublicKey,
  isValidVapidSubject,
  normaliseVapidSubject,
} from "./vapid-shape";

/** Whether the two halves belong to each other. Catches a half-rotated pair. */
export function keysMatch(publicKey: string, privateKey: string): boolean;

