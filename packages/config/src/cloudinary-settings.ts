import "server-only";
import { clearSecret, getConfig, setSecret, updateSettings } from "./config";
import { pingCloudinary } from "./cloudinary";

/**
 * Reconciling a submitted Cloudinary form with what is already stored.
 *
 * The subtlety that makes this worth isolating: **a blank API key means "keep
 * the stored one", not "there isn't one".** The UI cannot pre-fill a password
 * field, so blank is the normal state of that input on every visit — including
 * when the credentials came from environment variables and the cloud name
 * beside them is populated.
 *
 * Requiring all three fields therefore rejects the most common case: someone
 * who configured Cloudinary in `.env`, opened the wizard, and pressed Save.
 * That is precisely the bug this function exists to make impossible to
 * reintroduce — it was written twice, once correctly and once not.
 *
 * Pure and synchronous on purpose, so every branch is testable without a
 * database or a network round trip.
 */
export type CloudinarySubmission = {
  cloudName: string;
  /** Blank means "keep whatever is stored". */
  apiKey: string;
  /** Blank means "keep whatever is stored". */
  apiSecret: string;
  folder: string;
};

export type CloudinaryStored = {
  cloudName: string | null;
  apiKey: string | null;
  apiSecret: string | null;
};

export type CloudinaryDecision =
  /** Nothing submitted and nothing stored — Cloudinary simply is not in use. */
  | { action: "none" }
  /** The cloud name was cleared deliberately: fall back to database storage. */
  | { action: "clear" }
  | {
      action: "save";
      cloudName: string;
      apiKey: string;
      apiSecret: string;
      folder: string;
      /** Only verify against the API when something actually changed. */
      needsPing: boolean;
      /** Which secrets the form actually supplied, and so should overwrite. */
      writeApiKey: boolean;
      writeApiSecret: boolean;
    }
  | { action: "error"; error: string };

export function reconcileCloudinary(
  submitted: CloudinarySubmission,
  stored: CloudinaryStored,
): CloudinaryDecision {
  const cloudName = submitted.cloudName.trim();
  const submittedKey = submitted.apiKey.trim();
  const submittedSecret = submitted.apiSecret.trim();
  const folder = submitted.folder.trim() || "sendstack";

  if (!cloudName) {
    // A key or secret with no cloud name is not enough to upload anything, and
    // is far more likely a half-filled form than an intent to configure.
    if (submittedKey || submittedSecret) {
      return {
        action: "error",
        error: "Add your Cloudinary cloud name as well, or clear the key and secret.",
      };
    }
    return stored.cloudName ? { action: "clear" } : { action: "none" };
  }

  const apiKey = submittedKey || stored.apiKey;
  const apiSecret = submittedSecret || stored.apiSecret;

  if (!apiKey || !apiSecret) {
    return {
      action: "error",
      error:
        "Cloudinary needs an API key and secret as well as a cloud name. Both are on your " +
        "Cloudinary dashboard.",
    };
  }

  return {
    action: "save",
    cloudName,
    apiKey,
    apiSecret,
    folder,
    // Re-verifying an unchanged configuration on every branding save would add
    // a network round trip to an operation that did not touch Cloudinary.
    needsPing: Boolean(submittedKey || submittedSecret || cloudName !== stored.cloudName),
    writeApiKey: Boolean(submittedKey),
    writeApiSecret: Boolean(submittedSecret),
  };
}

/**
 * Apply a submitted Cloudinary form. The single implementation used by both
 * the setup wizard and the settings page.
 */
export async function applyCloudinarySettings(
  submitted: CloudinarySubmission,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const config = await getConfig({ fresh: true });
  const decision = reconcileCloudinary(submitted, {
    cloudName: config.cloudinary.cloudName,
    apiKey: config.cloudinary.apiKey,
    apiSecret: config.cloudinary.apiSecret,
  });

  if (decision.action === "none") return { ok: true };
  if (decision.action === "error") return { ok: false, error: decision.error };

  if (decision.action === "clear") {
    // Existing Cloudinary-hosted assets keep working until they are replaced;
    // only future uploads fall back to the database.
    //
    // `""`, not `null`: null means "never set" and would let CLOUDINARY_* in
    // the environment reconfigure it on the next read. See `resolve()`.
    await updateSettings({ cloudinaryCloudName: "" });
    await clearSecret("cloudinaryApiKey");
    await clearSecret("cloudinaryApiSecret");
    return { ok: true };
  }

  if (decision.needsPing) {
    const ping = await pingCloudinary({
      cloudName: decision.cloudName,
      apiKey: decision.apiKey,
      apiSecret: decision.apiSecret,
    });
    if (!ping.ok) return { ok: false, error: ping.error };
  }

  if (decision.writeApiKey) await setSecret("cloudinaryApiKey", decision.apiKey);
  if (decision.writeApiSecret) await setSecret("cloudinaryApiSecret", decision.apiSecret);
  await updateSettings({
    cloudinaryCloudName: decision.cloudName,
    cloudinaryFolder: decision.folder,
  });

  return { ok: true };
}

/** Pull the Cloudinary fields out of a branding form. */
export function cloudinaryFromForm(formData: FormData): CloudinarySubmission {
  return {
    cloudName: String(formData.get("cloudinaryCloudName") ?? ""),
    apiKey: String(formData.get("cloudinaryApiKey") ?? ""),
    apiSecret: String(formData.get("cloudinaryApiSecret") ?? ""),
    folder: String(formData.get("cloudinaryFolder") ?? ""),
  };
}
