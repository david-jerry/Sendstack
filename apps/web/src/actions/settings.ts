"use server";

import { revalidatePath } from "next/cache";
import { requireSession, resetAuth } from "@sendstack/auth";
import { brandingFormSchema, emailConfigSchema, isTemplateKind, type TemplateKind } from "@sendstack/shared";
import {
  applyCloudinarySettings,
  assertAuthMethodsUsable,
  clearSecret,
  cloudinaryFromForm,
  deleteBrandingAsset,
  getConfig,
  putBrandingAsset,
  setSecret,
  updateSettings,
  type BrandingKind,
  type SecretKey,
} from "@sendstack/config";
import { resetResendClient } from "@sendstack/email";
import { resetRedisClient } from "@sendstack/redis";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Settings mutations, separate from the wizard's.
 *
 * They differ in one important way: the wizard advances `setup_step` and these
 * do not. Sharing one set of actions would mean editing a setting after setup
 * quietly rewinding the installation's progress marker.
 *
 * They also differ in how blank fields are treated. Here, an empty secret field
 * means "leave what is stored alone" — because the UI cannot show the current
 * value to pre-fill it, so a blank box is the normal state, not an instruction
 * to erase. Clearing is a separate, explicit action.
 */

export async function updateBranding(formData: FormData): Promise<Result> {
  await requireSession();

  // The schema the form already validated against, re-run because a Server
  // Action is a public endpoint. `Object.fromEntries` because the schema names
  // the fields and strips the file entries the loop below reads directly.
  // These checks were written out inline here and in `saveBranding`, and the
  // app URL's trailing-slash strip in both but in neither the schema.
  const parsed = brandingFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the branding fields." };
  }

  const appName = parsed.data.appName;
  if (!appName) return { ok: false, error: "Give your workspace a name." };

  // Saved before the files are read, so a logo chosen in the same submission
  // lands on Cloudinary rather than in the database. Shared with the wizard so
  // the two cannot drift again.
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
  });
  resetAuth();
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateEmailTemplate(template: TemplateKind): Promise<Result> {
  await requireSession();
  // The parameter type is the client's contract, not a guarantee: a Server
  // Action is a public endpoint, and the column is a Postgres enum that would
  // reject an unknown value with an opaque error.
  if (!isTemplateKind(template)) return { ok: false, error: "Unknown email template." };
  await updateSettings({ emailTemplate: template });
  revalidatePath("/settings");
  return { ok: true };
}

export async function updateEmailSettings(input: {
  domain: string;
  fromEmail: string;
  fromName: string;
  postalAddress: string;
  ratePerSecond: number;
  apiKey?: string;
  webhookSecret?: string;
}): Promise<Result> {
  await requireSession();

  /**
   * The wizard's schema, not a second opinion about the same fields.
   *
   * What was here instead: `trim().toLowerCase()` and an `endsWith` check that
   * was skipped when the address was blank — and **no syntax check at all**.
   * So the wizard refused `weird thing@mail.example.com` and this accepted and
   * stored it, and no gate downstream caught the difference, because
   * `deliverabilityReport` only asks whether the address ends with the domain.
   * The first sign of it was an opaque Resend rejection on a real campaign.
   *
   * `hasStoredKey` comes from configuration rather than the caller: a request
   * that asserted it would sidestep the "nothing can be sent without a key"
   * rule. The consequence worth knowing about is that saving this section on
   * an instance whose key has been explicitly forgotten now requires pasting
   * one — which is the same answer the wizard gives.
   */
  const parsed = emailConfigSchema.safeParse({
    ...input,
    hasStoredKey: Boolean((await getConfig({ fresh: true })).resend.apiKey),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the email fields." };
  }
  const { apiKey, domain, fromEmail, fromName, webhookSecret, ratePerSecond } = parsed.data;

  if (apiKey?.trim()) await setSecret("resendApiKey", apiKey);
  if (webhookSecret?.trim()) await setSecret("resendWebhookSecret", webhookSecret);

  // Collapse blank lines but keep the ones the operator typed: a postal
  // address is read as an address, and forcing it onto one line makes it
  // look like a database field rather than a place mail could be sent.
  const postalAddress =
    parsed.data.postalAddress
      ?.split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n") ?? undefined;

  await updateSettings({
    resendDomain: domain,
    resendFromEmail: fromEmail || null,
    resendFromName: fromName || null,
    /**
     * An absent field means "leave the stored value alone"; a blank one means
     * "clear it". The distinction matters because this schema is shared with
     * the wizard's step, which has neither of these two fields — spreading
     * `undefined` into the patch would make saving the wizard's Email step
     * wipe a postal address and reset the send rate.
     */
    ...(postalAddress === undefined ? {} : { postalAddress: postalAddress || null }),
    ...(ratePerSecond === undefined ? {} : { sendRatePerSecond: ratePerSecond }),
  });

  resetResendClient();
  revalidatePath("/settings");
  return { ok: true };
}

export async function updateRealtimeSettings(input: {
  url: string;
  token?: string;
}): Promise<Result> {
  await requireSession();

  const url = input.url.trim();
  if (!url) {
    // `""`, not `null`: null means "never set" and lets REDIS_URL in the
    // environment reconnect on the next read — which made this branch a no-op
    // on every host that had seeded the value. See `resolve()` in config.
    await updateSettings({ redisRestUrl: "" });
    await clearSecret("redisRestToken");
    resetRedisClient();
    revalidatePath("/settings");
    return { ok: true };
  }

  if (input.token?.trim()) await setSecret("redisRestToken", input.token);
  // Switching from an Upstash REST URL to a redis:// one must drop the stale
  // token, or `parseRedisTarget` would keep seeing a half-Upstash config.
  if (/^rediss?:\/\//i.test(url)) await clearSecret("redisRestToken");
  await updateSettings({ redisRestUrl: url });
  resetRedisClient();
  revalidatePath("/settings");
  return { ok: true };
}

export async function updateJobSettings(input: {
  eventKey?: string;
  signingKey?: string;
}): Promise<Result> {
  await requireSession();
  if (input.eventKey?.trim()) await setSecret("inngestEventKey", input.eventKey);
  if (input.signingKey?.trim()) await setSecret("inngestSigningKey", input.signingKey);
  revalidatePath("/settings");
  return { ok: true };
}

export async function updateAuthSettings(input: {
  emailPassword: boolean;
  passkey: boolean;
  magicLink: boolean;
  allowSignup: boolean;
}): Promise<Result> {
  await requireSession();

  // The same rule, and the same wording, as the wizard's step.
  try {
    assertAuthMethodsUsable(input, await getConfig({ fresh: true }));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid selection." };
  }

  await updateSettings({
    authEmailPassword: input.emailPassword,
    authPasskey: input.passkey,
    authMagicLink: input.magicLink,
    allowSignup: input.allowSignup,
  });

  resetAuth();
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Explicit erasure, so a blank field never destroys a stored credential. */
export async function forgetSecret(key: SecretKey): Promise<Result> {
  await requireSession();
  await clearSecret(key);
  resetResendClient();
  resetRedisClient();
  revalidatePath("/settings");
  return { ok: true };
}
