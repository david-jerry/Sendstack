import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { AUTH_SECRET_MIN_LENGTH } from "@sendstack/shared";

/**
 * Encryption for secrets held in the database.
 *
 * AES-256-GCM, not AES-CBC: GCM is authenticated, so a row someone has tampered
 * with fails to decrypt rather than silently yielding different plaintext. For
 * an API key that is the difference between a loud error and quietly sending
 * mail through an attacker's account.
 *
 * The key is derived from AUTH_SECRET with scrypt. That is why AUTH_SECRET
 * cannot itself live in this table, and why rotating it makes every stored
 * secret unreadable — `decryptSecret` reports that as a clear error rather
 * than a corrupt value, and the fix is to re-enter the secrets in Settings.
 */

const VERSION = "v1";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;

/**
 * A fixed salt, deliberately. A random per-row salt would be the textbook
 * choice for password hashing, but this is key derivation from a single
 * high-entropy secret: a per-row salt would force a fresh scrypt (~100ms) for
 * every secret read, on every request, for no gain in security. The salt is
 * versioned so a future scheme can change it without ambiguity.
 */
const SALT = Buffer.from("sendstack.settings.v1");

/**
 * What `app_secrets.ciphertext` holds once a secret has been explicitly cleared.
 *
 * A tombstone rather than a deleted row, because a missing row means "never
 * set" and lets the environment seed the value again — so an operator who
 * cleared `RESEND_API_KEY` in Settings would find it silently back the next
 * request, read from the host. Cannot collide with a real envelope, which
 * always starts with `v1.` and has four parts, and is checked before any
 * decryption is attempted so it never surfaces as a decryption error.
 */
export const CLEARED_SECRET = "cleared";

let cachedKey: Buffer | null = null;
let cachedFrom: string | null = null;

function encryptionKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < AUTH_SECRET_MIN_LENGTH) {
    throw new Error(
      `AUTH_SECRET must be set to at least ${AUTH_SECRET_MIN_LENGTH} characters before settings ` +
        "can be read or written. Generate one with `openssl rand -base64 32`.",
    );
  }

  // scrypt is intentionally slow; deriving it once per process matters.
  if (cachedKey && cachedFrom === secret) return cachedKey;

  cachedKey = scryptSync(secret, SALT, KEY_LENGTH);
  cachedFrom = secret;
  return cachedKey;
}

/** Returns `v1.<iv>.<authTag>.<ciphertext>`, each part base64url. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    data.toString("base64url"),
  ].join(".");
}

export class SecretDecryptionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SecretDecryptionError";
  }
}

/**
 * Read an envelope back, or fail in a way an operator can act on.
 *
 * The version and part count are checked *before* the cipher is touched, so a
 * value that was never ours — a row from a future scheme, or anything that
 * reached this function that should not have — is named for what it is instead
 * of arriving as Node's "unable to authenticate data", which explains nothing
 * and points at nothing.
 *
 * Both failures are one *typed* error, and that is what makes the degradation
 * in `getConfig` possible: it logs the key that could not be read and carries
 * on with the rest, because the Settings page has to stay loadable when the
 * fix is to re-enter the credential there. A plain `Error` would either be
 * matched on its message or take the page down with it.
 *
 * GCM cannot distinguish a wrong key from a tampered row. Rather than guess,
 * the message names the cause that is overwhelmingly likely in practice: that
 * AUTH_SECRET has changed since the value was written.
 */
export function decryptSecret(envelope: string): string {
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new SecretDecryptionError(`Unrecognised secret envelope format: ${parts[0] ?? "empty"}`);
  }

  const [, ivPart, tagPart, dataPart] = parts as [string, string, string, string];

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(ivPart, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (cause) {
    // Overwhelmingly this means AUTH_SECRET changed. Say so, because the
    // generic "unable to authenticate data" from Node explains nothing.
    throw new SecretDecryptionError(
      "Could not decrypt a stored secret. This usually means AUTH_SECRET has changed since " +
        "it was saved — re-enter the affected credentials in Settings.",
      { cause },
    );
  }
}
