"use server";

import { writeFile, access, constants } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { Resend } from "resend";
import postgres from "postgres";
import { AUTH_SECRET_MIN_LENGTH, brandingFormSchema, emailConfigSchema } from "@sendstack/shared";
import {
  applyCloudinarySettings,
  assertAuthMethodsUsable,
  cloudinaryFromForm,
  getConfig,
  pingCloudinary,
  putBrandingAsset,
  deleteBrandingAsset,
  requireSetupInProgress,
  setSecret,
  updateSettings,
  type BrandingKind,
} from "@sendstack/config";
import { requireSession, resetAuth } from "@sendstack/auth";
import { resetResendClient } from "@sendstack/email";
import { backendFor, parseRedisTarget, RedisConfigError, resetRedisClient } from "@sendstack/redis";

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

/**
 * Every "Test" button in the wizard runs a real call against the real service.
 *
 * This is the reason the wizard is worth more than editing a file: a typo in a
 * connection string or a key with the wrong permission is caught here, in
 * context, with an explanation — rather than three screens later as a failed
 * campaign, or never, as an inbox that is silently always empty.
 */

/**
 * The first line of every action in this file.
 *
 * A Server Action is a public POST endpoint addressed by id; whether the
 * wizard page still renders is irrelevant to whether it can be called. Before
 * this guard, an anonymous request to a finished instance could overwrite
 * `.env.local`, swap the Resend key so magic links routed elsewhere, or point
 * the server at an arbitrary database URL. Two rules, in order:
 *
 *  1. Setup must still be in progress — `complete` throws, always.
 *  2. Once any account exists, the caller must own a session. Until then there
 *     is nobody who *could* be signed in, so the wizard is necessarily open;
 *     afterwards it is not, because every step can be revisited with Back.
 *
 * Returns what it learned so `finishSetup` need not re-ask whether an account
 * exists. Throws rather than returning a `Result`: these are not conditions a
 * legitimate caller of the wizard can reach, so a friendly message would only
 * help the wrong person.
 */
async function guard(): Promise<{ hasAdmin: boolean }> {
  const { hasAdmin } = await requireSetupInProgress();
  if (hasAdmin) await requireSession();
  return { hasAdmin };
}

// ─── Bootstrap (cannot be stored in the database) ────────────────────────────

export async function generateAuthSecret(): Promise<{ secret: string }> {
  await guard();
  return { secret: randomBytes(32).toString("base64") };
}

export async function testDatabaseUrl(url: string): Promise<Result<{ version: string }>> {
  await guard();
  return probeDatabaseUrl(url);
}

/**
 * Split from the action so `saveBootstrap`, which has already passed the
 * guard, does not run the three setup-state round trips a second time.
 */
async function probeDatabaseUrl(url: string): Promise<Result<{ version: string }>> {
  const trimmed = url.trim();
  if (!/^postgres(ql)?:\/\//.test(trimmed)) {
    return { ok: false, error: "That does not look like a postgresql:// connection string." };
  }

  // A dedicated short-lived connection, never the app pool: this URL is
  // untrusted input and may not resolve at all.
  const client = postgres(trimmed, { max: 1, prepare: false, connect_timeout: 8 });
  try {
    const rows = await client<{ version: string }[]>`SELECT version()`;
    return { ok: true, version: rows[0]?.version.split(" ").slice(0, 2).join(" ") ?? "Postgres" };
  } catch (error) {
    return { ok: false, error: friendlyDbError(error) };
  } finally {
    await client.end({ timeout: 2 }).catch(() => {});
  }
}

function friendlyDbError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOTFOUND|EAI_AGAIN/.test(message)) return "That host could not be resolved. Check the hostname.";
  if (/ECONNREFUSED/.test(message)) return "Connection refused. Is the database running and the port right?";
  if (/password authentication failed/i.test(message)) return "The username or password was rejected.";
  if (/does not exist/i.test(message)) return "That database name does not exist on the server.";
  if (/self.signed|SSL|certificate/i.test(message)) return `TLS problem: ${message}. Try appending ?sslmode=require.`;
  if (/timeout/i.test(message)) return "Timed out. The host may be unreachable or behind a firewall.";
  return message;
}

export type BootstrapWriteResult = Result<{
  written: boolean;
  filePath?: string;
  manual?: string;
}>;

/**
 * Persist DATABASE_URL and AUTH_SECRET.
 *
 * These two cannot live in the settings table — settings stored in Postgres
 * cannot contain the credentials needed to reach Postgres, and secrets
 * encrypted at rest cannot contain their own key.
 *
 * So the wizard writes `.env.local` where the filesystem allows it (a VPS,
 * Docker, local development) and otherwise hands back the exact block to paste
 * into a hosting platform's environment settings. Detecting which case applies
 * rather than assuming is the difference between a working setup and one that
 * silently reverts on the next deploy.
 */
export async function saveBootstrap(input: {
  databaseUrl: string;
  authSecret: string;
}): Promise<BootstrapWriteResult> {
  await guard();

  const databaseUrl = input.databaseUrl.trim();
  const authSecret = input.authSecret.trim();

  if (authSecret.length < AUTH_SECRET_MIN_LENGTH) {
    return {
      ok: false,
      error: `The auth secret must be at least ${AUTH_SECRET_MIN_LENGTH} characters.`,
    };
  }

  const test = await probeDatabaseUrl(databaseUrl);
  if (!test.ok) return test;

  const manual = `DATABASE_URL="${databaseUrl}"\nAUTH_SECRET="${authSecret}"`;
  const root = workspaceRoot();
  const target = path.join(root, ".env.local");

  try {
    // Probe the directory rather than trusting a platform check: a container
    // may be read-only in ways NODE_ENV cannot tell us about.
    await access(root, constants.W_OK);
    await writeFile(
      target,
      `# Written by the Sendstack setup wizard.\n` +
        `# These two values cannot be stored in the database — everything else can,\n` +
        `# and lives in Settings.\n\n${manual}\n`,
      { encoding: "utf8", flag: "w" },
    );
    return { ok: true, written: true, filePath: target, manual };
  } catch {
    return { ok: true, written: false, manual };
  }
}

/**
 * The directory the root `.env` lives in.
 *
 * `process.cwd()` is `apps/web` when Next is running, not the repository root,
 * so writing there would produce a file the app then ignores — the same
 * mismatch that makes `next.config.ts` load the root `.env` explicitly. Walk up
 * for the workspace marker instead, and fall back to cwd for a non-monorepo
 * deployment.
 */
function workspaceRoot(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 5; depth += 1) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

// ─── Branding ────────────────────────────────────────────────────────────────

export async function testCloudinary(input: {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}): Promise<Result> {
  await guard();
  if (!input.cloudName.trim() || !input.apiKey.trim() || !input.apiSecret.trim()) {
    return { ok: false, error: "All three Cloudinary values are required." };
  }
  const result = await pingCloudinary(input);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function saveBranding(formData: FormData): Promise<Result> {
  await guard();

  /**
   * The form's own schema, re-run here because a Server Action is a public
   * endpoint — the browser's validation is a convenience, not a guarantee.
   *
   * `Object.fromEntries` rather than a field list: the schema names the fields
   * it wants and strips everything else, so the file entries and the
   * `remove_logo` flags below pass through untouched and adding a branding
   * field does not mean editing three places. This action and
   * `updateBranding` carried the same three checks inline, word for word,
   * and both stripped the app URL's trailing slash while the schema — the
   * thing the two forms validate against — did not. See `brandingFormSchema`,
   * which now owns that too.
   */
  const parsed = brandingFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the branding fields." };
  }

  // Capitalisation is applied on top of the schema, not inside it: the input
  // capitalises as you type, and this is the same rule for a caller that did not.
  const appName = parsed.data.appName;
  if (appName.length === 0) return { ok: false, error: "Give your workspace a name." };

  // Image hosting is saved BEFORE the files are read, so an upload in the same
  // submission lands on Cloudinary rather than in the database. Doing it the
  // other way round would store the first logo locally and only honour the
  // setting from the next save onward.
  //
  // One shared implementation with the settings page — these were two copies
  // once, and the wizard's copy required all three fields, which rejected the
  // most common case: credentials already in .env, so the cloud name is
  // pre-filled and the password fields are blank.
  const cloudinary = await applyCloudinarySettings(cloudinaryFromForm(formData));
  if (!cloudinary.ok) return cloudinary;

  try {
    for (const kind of ["logo", "favicon"] as BrandingKind[]) {
      const file = formData.get(kind);
      if (file instanceof File && file.size > 0) {
        await putBrandingAsset(kind, {
          bytes: Buffer.from(await file.arrayBuffer()),
          mimeType: file.type,
        });
      }
      if (formData.get(`remove_${kind}`) === "true") await deleteBrandingAsset(kind);
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Upload failed." };
  }

  await updateSettings({
    appName,
    appUrl: parsed.data.appUrl,
    primaryColor: parsed.data.primaryColor,
    setupStep: "email",
  });

  resetAuth(); // baseURL and app name are baked into the auth instance
  revalidatePath("/", "layout");
  return { ok: true };
}

// ─── Email ───────────────────────────────────────────────────────────────────

export async function testResendKey(apiKey: string): Promise<Result<{ domains: string[] }>> {
  await guard();
  return probeResendKey(apiKey);
}

/** The test without the guard, for `saveEmailConfig` which has already passed it. */
async function probeResendKey(apiKey: string): Promise<Result<{ domains: string[] }>> {
  const key = apiKey.trim();
  if (!key.startsWith("re_")) return { ok: false, error: "Resend API keys start with `re_`." };

  try {
    const client = new Resend(key);
    const response = await client.domains.list();
    if (response.error) return { ok: false, error: response.error.message };

    const data = response.data as unknown as { data?: { name: string }[] } | null;
    return { ok: true, domains: (data?.data ?? []).map((domain) => domain.name) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not reach Resend." };
  }
}

export async function saveEmailConfig(input: {
  apiKey: string;
  domain: string;
  fromEmail: string;
  fromName: string;
  webhookSecret: string;
}): Promise<Result> {
  await guard();

  /**
   * The step's own schema, and `hasStoredKey` read from configuration rather
   * than taken from the caller.
   *
   * The three checks that were inline here — trim-and-lowercase, a bespoke
   * address regex, the `endsWith` domain test — are the same rule as
   * `emailConfigSchema`, and the copy in `updateEmailSettings` had already
   * drifted away from both. Whether a key is already stored is the one thing
   * the schema cannot know, and it is not the browser's to assert: a caller
   * claiming `hasStoredKey` would otherwise skip the "you cannot send without
   * a key" rule entirely.
   */
  const parsed = emailConfigSchema.safeParse({
    ...input,
    hasStoredKey: Boolean((await getConfig({ fresh: true })).resend.apiKey),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the email fields." };
  }
  const { apiKey, domain, fromEmail, fromName, webhookSecret } = parsed.data;

  if (apiKey?.trim()) {
    const test = await probeResendKey(apiKey);
    if (!test.ok) return test;
    await setSecret("resendApiKey", apiKey);
  }
  if (webhookSecret?.trim()) {
    await setSecret("resendWebhookSecret", webhookSecret);
  }

  await updateSettings({
    resendDomain: domain,
    resendFromEmail: fromEmail || null,
    resendFromName: fromName || null,
    setupStep: "realtime",
  });

  resetResendClient();
  return { ok: true };
}

// ─── Realtime ────────────────────────────────────────────────────────────────

export async function testRedis(
  url: string,
  token: string,
): Promise<Result<{ latencyMs: number; transport: "upstash" | "tcp" }>> {
  await guard();
  return probeRedis(url, token);
}

/** The test without the guard, for `saveRealtimeConfig` which has already passed it. */
async function probeRedis(
  url: string,
  token: string,
): Promise<Result<{ latencyMs: number; transport: "upstash" | "tcp" }>> {
  let target;
  try {
    target = parseRedisTarget(url, token);
  } catch (error) {
    if (error instanceof RedisConfigError) return { ok: false, error: error.message };
    throw error;
  }
  if (!target) return { ok: false, error: "Enter a Redis URL." };

  // A throwaway backend built from the unsaved values — these credentials are
  // being tried out and must not displace the live client if the test fails.
  const backend = backendFor(target, { probe: true });
  try {
    const started = Date.now();
    await backend.ping();
    const probe = `sendstack:setup:ping:${Date.now()}`;
    const won = await backend.setNx(probe, "1", 30);
    if (!won) return { ok: false, error: "Connected, but the test key could not be written." };
    return { ok: true, latencyMs: Date.now() - started, transport: backend.kind };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reach Redis.";
    if (/401|403|unauthor|WRONGPASS|NOAUTH/i.test(message)) {
      return { ok: false, error: "Rejected. Check the credentials for this database." };
    }
    if (/ECONNREFUSED/i.test(message)) {
      return {
        ok: false,
        error: "Connection refused. Is Redis running and listening on that port?",
      };
    }
    if (/ENOTFOUND|EAI_AGAIN/i.test(message)) {
      return { ok: false, error: "That host could not be resolved." };
    }
    if (/timeout|ETIMEDOUT/i.test(message)) {
      return { ok: false, error: "Timed out. The host may be unreachable or firewalled." };
    }
    return { ok: false, error: message };
  } finally {
    await backend.close().catch(() => {});
  }
}

export async function saveRealtimeConfig(input: {
  url: string;
  token: string;
  skip?: boolean;
}): Promise<Result> {
  await guard();

  if (input.skip) {
    await updateSettings({ redisRestUrl: null, setupStep: "jobs" });
    resetRedisClient();
    return { ok: true };
  }

  const test = await probeRedis(input.url, input.token);
  if (!test.ok) return test;

  // A redis:// URL carries its own credentials, so a blank token there is
  // normal rather than missing. Only store one when there is one.
  if (input.token.trim()) await setSecret("redisRestToken", input.token);
  await updateSettings({ redisRestUrl: input.url.trim(), setupStep: "jobs" });
  resetRedisClient();
  return { ok: true };
}

// ─── Jobs ────────────────────────────────────────────────────────────────────

export async function saveJobsConfig(input: {
  eventKey: string;
  signingKey: string;
}): Promise<Result> {
  await guard();
  if (input.eventKey.trim()) await setSecret("inngestEventKey", input.eventKey);
  if (input.signingKey.trim()) await setSecret("inngestSigningKey", input.signingKey);
  await updateSettings({ setupStep: "auth" });
  return { ok: true };
}

// ─── Authentication ──────────────────────────────────────────────────────────

export async function saveAuthConfig(input: {
  emailPassword: boolean;
  passkey: boolean;
  magicLink: boolean;
}): Promise<Result> {
  await guard();

  // One rule shared with Settings: at least one method, and only methods that
  // can actually complete on this instance (a sender for magic links, a
  // secure origin for passkeys).
  try {
    assertAuthMethodsUsable(input, await getConfig({ fresh: true }));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid selection." };
  }

  await updateSettings({
    authEmailPassword: input.emailPassword,
    authPasskey: input.passkey,
    authMagicLink: input.magicLink,
    setupStep: "account",
  });

  resetAuth();
  return { ok: true };
}

// ─── Completion ──────────────────────────────────────────────────────────────

/**
 * Opens registration just long enough for the first account to be created.
 *
 * `finishSetup` closes it again. Leaving it open would mean anyone who finds
 * the URL can create an account on an instance that can email your entire
 * contact list.
 */
export async function openAccountCreation(): Promise<Result> {
  await guard();
  await updateSettings({ allowSignup: true });
  resetAuth();
  return { ok: true };
}

export async function finishSetup(): Promise<Result> {
  // Reaching here with an account means the guard has already verified the
  // caller's session — sign-up signs the new account in — so the operator
  // closing the wizard is the operator who just created it.
  const { hasAdmin } = await guard();
  if (!hasAdmin) {
    return { ok: false, error: "Create your account before finishing setup." };
  }

  await updateSettings({
    allowSignup: false,
    setupStep: "done",
    setupCompletedAt: new Date(),
  });

  resetAuth();
  revalidatePath("/", "layout");
  return { ok: true };
}
