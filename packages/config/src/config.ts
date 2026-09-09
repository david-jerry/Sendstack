import "server-only";
import { db, eq } from "@sendstack/db";
import { appSecrets, appSettings } from "@sendstack/db/schema";
import type { TemplateKind } from "@sendstack/shared";
import { CLEARED_SECRET, decryptSecret, encryptSecret, SecretDecryptionError } from "./crypto";
import {
  SECRET_KEYS,
  envCandidates,
  type Provenance,
  type SecretKey,
  type SeededSetting,
} from "./keys";
import { resolvePushConfig, type PushConfig } from "./push-config";
import { invalidateSetupState } from "./setup-state";
import { DEFAULT_BRAND_COLOR } from "@sendstack/shared";

export type AppConfig = {
  appName: string;
  appUrl: string;
  primaryColor: string;
  /** Printed in campaign footers. Required by CAN-SPAM for commercial mail. */
  postalAddress: string | null;
  emailTemplate: TemplateKind;

  resend: {
    apiKey: string | null;
    domain: string | null;
    fromEmail: string | null;
    fromName: string;
    webhookSecret: string | null;
    ratePerSecond: number;
  };

  redis: {
    /** `redis://…` for a Redis server, or `https://…` for Upstash's REST API. */
    url: string | null;
    /** Only meaningful for Upstash REST; a redis:// URL carries its own credentials. */
    token: string | null;
  };

  cloudinary: {
    cloudName: string | null;
    apiKey: string | null;
    apiSecret: string | null;
    folder: string;
    /** True only when all three credentials are present. */
    configured: boolean;
  };
  inngest: { eventKey: string | null; signingKey: string | null };

  /** See `push-config.ts`; `configured` means present *and* well-formed. */
  push: PushConfig;

  auth: {
    emailPassword: boolean;
    passkey: boolean;
    magicLink: boolean;
    allowSignup: boolean;
  };

  setup: { step: string; completedAt: Date | null };

  /** Where each value came from, for the Settings UI. */
  provenance: Record<string, Provenance>;
};

/**
 * Process-local cache.
 *
 * Configuration is read on essentially every request, and decrypting secrets
 * costs an scrypt-derived AES pass each time. A short TTL keeps that cheap
 * while bounding how stale a value can be.
 *
 * The consequence to be honest about: on a multi-instance deployment, saving a
 * setting takes effect immediately on the instance that handled the write and
 * within TTL_MS everywhere else. Cross-instance invalidation would need a
 * pub/sub channel — but the Redis credentials are themselves configuration,
 * so that path is circular. A few seconds of skew is the right trade.
 */
const TTL_MS = 10_000;
let cache: { value: AppConfig; expires: number } | null = null;

/**
 * The cache's only escape hatch.
 *
 * `updateSettings`, `setSecret` and `clearSecret` already call it, so a call
 * site needs it only when a stored value changed by some other route — a
 * migration, a seed script, a direct write. What it cannot do is reach another
 * instance: there, the TTL above is the whole of the guarantee, for the
 * circularity reason given with it.
 */
export function invalidateConfig(): void {
  cache = null;
}

function envValue(name: string): string | null {
  const value = process.env[name];
  return value && value.length > 0 ? value : null;
}

/**
 * Database first, environment as the seed. Records which one answered.
 *
 * Three database states, not two. `null`/absent is "never set" and lets the
 * environment seed the value. `""` is a tombstone — the operator cleared this
 * field in Settings — and must **not** fall through to the environment, or a
 * `REDIS_URL` still exported on the host would resurrect the connection they
 * just turned off. An earlier version treated `""` as "unset" and every clear
 * path in the app was a no-op on any host that had seeded the value.
 */
function resolve(
  dbValue: string | null | undefined,
  envVars: string[],
  provenance: Record<string, Provenance>,
  field: string,
): string | null {
  if (dbValue === "") {
    provenance[field] = "cleared";
    return null;
  }
  if (dbValue !== null && dbValue !== undefined) {
    provenance[field] = "database";
    return dbValue;
  }
  for (const name of envVars) {
    const fromEnv = envValue(name);
    if (fromEnv) {
      provenance[field] = "environment";
      return fromEnv;
    }
  }
  provenance[field] = "unset";
  return null;
}

/**
 * The whole resolved configuration — settings, decrypted secrets, provenance.
 *
 * Two queries per miss, and two however many fields `AppConfig` grows: the
 * secrets arrive as one set and are decrypted into a map before anything reads
 * them, so adding a credential cannot add a round trip. This is read on
 * essentially every request, which is what makes that worth insisting on.
 *
 * **`fresh` is for a decision that depends on a value written moments ago in
 * the same flow.** The Settings page and the wizard both render immediately
 * after their own save, and `applyCloudinarySettings` has to know whether a
 * key is already stored before it can decide that a blank field means "keep
 * it" — served the cached copy, each of those is wrong about state it just
 * created. Everywhere else takes the cache: the cost of being up to TTL_MS
 * stale is nothing next to an scrypt-derived AES pass per secret per request.
 *
 * Every writer in this module invalidates the cache itself. A caller that
 * changes a stored value by any other route has to call `invalidateConfig()`,
 * or read its own write up to TTL_MS late.
 */
export async function getConfig(options?: { fresh?: boolean }): Promise<AppConfig> {
  if (!options?.fresh && cache && cache.expires > Date.now()) return cache.value;

  const [row] = await db.select().from(appSettings).where(eq(appSettings.id, "singleton"));
  const secretRows = await db.select().from(appSecrets);

  const decrypted = new Map<string, string>();
  for (const secret of secretRows) {
    // A tombstone is not ciphertext. Mapped to `""` so `resolve()` sees the
    // same "cleared" signal a setting carries, and never handed to the cipher.
    if (secret.ciphertext === CLEARED_SECRET) {
      decrypted.set(secret.key, "");
      continue;
    }
    try {
      decrypted.set(secret.key, decryptSecret(secret.ciphertext));
    } catch (error) {
      // One unreadable secret must not take the whole app down — the Settings
      // page still needs to load so the value can be re-entered.
      if (error instanceof SecretDecryptionError) {
        console.error(`[config] ${secret.key}: ${error.message}`);
        continue;
      }
      throw error;
    }
  }

  const provenance: Record<string, Provenance> = {};

  const secret = (key: SecretKey) =>
    resolve(decrypted.get(key) ?? null, [SECRET_KEYS[key].envVar], provenance, key);

  const setting = (key: SeededSetting, dbValue: string | null | undefined) =>
    resolve(dbValue, envCandidates(key), provenance, key);

  const value: AppConfig = {
    appName: setting("appName", row?.appName) ?? "Sendstack",
    appUrl: setting("appUrl", row?.appUrl) ?? "http://localhost:3000",
    primaryColor: row?.primaryColor ?? DEFAULT_BRAND_COLOR,
    postalAddress: row?.postalAddress ?? null,
    emailTemplate: row?.emailTemplate ?? "simple",

    resend: {
      apiKey: secret("resendApiKey"),
      domain: setting("resendDomain", row?.resendDomain),
      fromEmail: setting("resendFromEmail", row?.resendFromEmail),
      fromName: setting("resendFromName", row?.resendFromName) ?? row?.appName ?? "Sendstack",
      webhookSecret: secret("resendWebhookSecret"),
      ratePerSecond: row?.sendRatePerSecond ?? 10,
    },

    redis: {
      url: setting("redisRestUrl", row?.redisRestUrl),
      token: secret("redisRestToken"),
    },

    cloudinary: (() => {
      const cloudName = setting("cloudinaryCloudName", row?.cloudinaryCloudName);
      const apiKey = secret("cloudinaryApiKey");
      const apiSecret = secret("cloudinaryApiSecret");
      return {
        cloudName,
        apiKey,
        apiSecret,
        folder: setting("cloudinaryFolder", row?.cloudinaryFolder) ?? "sendstack",
        // All three or none — a partial configuration would fail at upload
        // time with an opaque signature error rather than falling back.
        configured: Boolean(cloudName && apiKey && apiSecret),
      };
    })(),

    inngest: {
      eventKey: secret("inngestEventKey"),
      signingKey: secret("inngestSigningKey"),
    },

    /**
     * Whether push notifications can be signed, and why not if not.
     *
     * The decision lives in `push-config.ts` rather than here because it is
     * the fix for a bug worth a test — a placeholder credential that reported
     * itself configured and then failed in the browser. See that file.
     */
    push: resolvePushConfig(
      {
        publicKey: setting("vapidPublicKey", row?.vapidPublicKey),
        privateKey: secret("vapidPrivateKey"),
        subject: setting("vapidSubject", row?.vapidSubject),
      },
      provenance.vapidPublicKey,
    ),

    auth: {
      // Defaults matter here: a brand-new install with no settings row must
      // still be able to show a login form, so email+password starts on.
      emailPassword: row?.authEmailPassword ?? true,
      passkey: row?.authPasskey ?? false,
      magicLink: row?.authMagicLink ?? false,
      allowSignup: row?.allowSignup ?? false,
    },

    setup: {
      step: row?.setupStep ?? "branding",
      completedAt: row?.setupCompletedAt ?? null,
    },

    provenance,
  };

  cache = { value, expires: Date.now() + TTL_MS };
  return value;
}

/**
 * For every seeded, nullable field below, `null` and `""` are different
 * instructions: `null` returns the field to "never set" (the environment may
 * seed it again), `""` clears it and keeps the environment out. See `resolve()`.
 */
export type SettingsPatch = Partial<{
  appName: string;
  appUrl: string;
  primaryColor: string;
  postalAddress: string | null;
  emailTemplate: TemplateKind;
  vapidPublicKey: string | null;
  vapidSubject: string | null;
  resendDomain: string | null;
  resendFromEmail: string | null;
  resendFromName: string | null;
  sendRatePerSecond: number;
  redisRestUrl: string | null;
  cloudinaryCloudName: string | null;
  cloudinaryFolder: string;
  authEmailPassword: boolean;
  authPasskey: boolean;
  authMagicLink: boolean;
  allowSignup: boolean;
  setupStep: string;
  setupCompletedAt: Date | null;
}>;

/** Upsert the singleton row. Atomic — two concurrent saves cannot fork it. */
export async function updateSettings(patch: SettingsPatch): Promise<void> {
  await db
    .insert(appSettings)
    .values({ id: "singleton", ...patch })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: { ...patch, updatedAt: new Date() },
    });
  invalidateConfig();
  // `setupCompletedAt` lives in this row, and this is its only writer. Doing
  // it here rather than at the call site is what makes it impossible to add a
  // fourth caller that forgets.
  invalidateSetupState();
}

/**
 * Encrypt and store one credential. A blank value is a clear, not a write.
 *
 * That delegation lives here rather than at each call site so no action has to
 * decide what an empty string means. Encrypting `""` would in fact resolve the
 * same way — `resolve()` reads any empty stored value as `cleared` — but by
 * coincidence rather than by the marker every other reader checks for, and a
 * later change to either half would separate them silently. `clearSecret`
 * writes the tombstone deliberately; see it for why a delete will not do.
 *
 * The trim is not cosmetic either. An API key gets here by copy and paste, and
 * a trailing newline sealed inside the envelope is invisible in Settings and
 * comes back from the provider as a rejected credential with no clue why.
 */
export async function setSecret(key: SecretKey, plaintext: string): Promise<void> {
  const trimmed = plaintext.trim();
  if (trimmed.length === 0) {
    await clearSecret(key);
    return;
  }

  await db
    .insert(appSecrets)
    .values({ key, ciphertext: encryptSecret(trimmed) })
    .onConflictDoUpdate({
      target: appSecrets.key,
      set: { ciphertext: encryptSecret(trimmed), updatedAt: new Date() },
    });
  invalidateConfig();
}

/**
 * Clear a secret — by writing a tombstone, not by deleting the row.
 *
 * A deleted row is indistinguishable from "never set", and "never set" is the
 * one state where the environment variable is consulted. Deleting the row on
 * a host that still exports `RESEND_API_KEY` therefore brought the key straight
 * back. The tombstone is what makes "forget this credential" mean it.
 */
export async function clearSecret(key: SecretKey): Promise<void> {
  await db
    .insert(appSecrets)
    .values({ key, ciphertext: CLEARED_SECRET })
    .onConflictDoUpdate({
      target: appSecrets.key,
      set: { ciphertext: CLEARED_SECRET, updatedAt: new Date() },
    });
  invalidateConfig();
}

/**
 * At least one sign-in method must remain enabled.
 *
 * Enforced here rather than only in the form, because this is the check that
 * stops an instance being locked out of itself — there is no recovery path
 * from a running app whose every login route is disabled short of editing the
 * database by hand.
 */
export function assertAuthMethods(methods: {
  emailPassword: boolean;
  passkey: boolean;
  magicLink: boolean;
}): void {
  if (!methods.emailPassword && !methods.passkey && !methods.magicLink) {
    throw new Error(
      "At least one sign-in method must stay enabled, or nobody can get back into this instance.",
    );
  }
}

/**
 * Whether the app URL counts as a secure context for WebAuthn.
 *
 * Browsers only expose passkeys on `https:` origins, with `localhost` and the
 * loopback address exempt so local development works — the same rule the
 * browser applies, expressed once so the wizard, Settings and the pages that
 * decide whether to even offer the toggle cannot disagree about it.
 */
export function isSecureOrigin(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || ["localhost", "127.0.0.1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Whether the chosen sign-in methods can actually work on this instance.
 *
 * `assertAuthMethods` guards against locking everyone out; this guards against
 * the subtler version — a method that is switched on but can never complete.
 * A magic link is delivered by email, so without a Resend key it enables a
 * login nobody can finish; a passkey is bound to a secure origin, so on a plain
 * `http://` URL the browser rejects every registration with an opaque
 * SecurityError. Both the wizard and Settings must apply the same rule with the
 * same wording, which is why it lives here rather than in either action.
 */
export function assertAuthMethodsUsable(
  methods: { emailPassword: boolean; passkey: boolean; magicLink: boolean },
  config: { appUrl: string; resend: { apiKey: string | null } },
): void {
  assertAuthMethods(methods);
  if (methods.magicLink && !config.resend.apiKey) {
    throw new Error("Magic links need a working Resend key — the link is delivered by email.");
  }
  if (methods.passkey && !isSecureOrigin(config.appUrl)) {
    throw new Error(
      "Passkeys require HTTPS (localhost is exempt). Set an https:// app URL first, or leave passkeys off.",
    );
  }
}
