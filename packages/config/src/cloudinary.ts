import "server-only";
import { v2 as cloudinary } from "cloudinary";
import { getConfig } from "./config";

/**
 * Cloudinary, configured from stored settings.
 *
 * The SDK keeps credentials in module-level global state, which is a poor fit
 * for configuration that can change at runtime — so rather than configuring it
 * once at import, every call reconfigures it first. That is cheap (it is an
 * object assignment, not a connection) and it removes an entire class of bug
 * where an instance keeps using the previous account after a settings change.
 */
async function configured() {
  const { cloudinary: creds } = await getConfig();
  if (!creds.configured) return null;

  cloudinary.config({
    cloud_name: creds.cloudName!,
    api_key: creds.apiKey!,
    api_secret: creds.apiSecret!,
    secure: true,
  });

  return { client: cloudinary, folder: creds.folder };
}

export type CloudinaryUpload = {
  url: string;
  publicId: string;
  width: number | null;
  height: number | null;
  bytes: number;
  format: string | null;
};

/** Verifies credentials with a real API call, for the setup wizard's Test button. */
export async function pingCloudinary(creds: {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    // This *is* the shared singleton, and these unsaved credentials do land in
    // its module state — the SDK offers no per-call instance. What keeps a
    // failed test from affecting a live upload is `configured()`, which
    // reconfigures from stored settings before every real call, so whatever a
    // probe left behind is overwritten rather than used. Anything added here
    // that uploads without going through `configured()` breaks that.
    const probe = cloudinary.config({
      cloud_name: creds.cloudName.trim(),
      api_key: creds.apiKey.trim(),
      api_secret: creds.apiSecret.trim(),
      secure: true,
    });
    void probe;
    const result = await cloudinary.api.ping();
    if (result.status !== "ok") {
      return { ok: false, error: `Cloudinary replied "${result.status}".` };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/401|Invalid Signature|api_key/i.test(message)) {
      return { ok: false, error: "Cloudinary rejected those credentials. Check the key and secret." };
    }
    if (/cloud_name|404/i.test(message)) {
      return { ok: false, error: "That cloud name was not found." };
    }
    return { ok: false, error: message };
  }
}

/**
 * Upload an image, replacing whatever was there before.
 *
 * `public_id` is deterministic — `<folder>/<kind>` — with `overwrite` and
 * `invalidate` set. That means one asset per kind rather than an ever-growing
 * pile of orphans, and the CDN edge is purged so a rebrand actually takes
 * effect for people who already fetched the old file.
 */
export async function uploadBrandingImage(
  kind: string,
  file: { bytes: Buffer; mimeType: string },
): Promise<CloudinaryUpload | null> {
  const active = await configured();
  if (!active) return null;

  // A data URI rather than a stream: these are small files, and it avoids
  // wrapping the SDK's callback-based upload_stream in a promise.
  const dataUri = `data:${file.mimeType};base64,${file.bytes.toString("base64")}`;

  const result = await active.client.uploader.upload(dataUri, {
    folder: active.folder,
    public_id: kind,
    overwrite: true,
    invalidate: true,
    resource_type: "image",
    // SVG is an image to us and a script container to a browser. Cloudinary
    // sanitises it on the way in when asked.
    ...(file.mimeType === "image/svg+xml" ? { flags: "sanitize" } : {}),
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
    width: result.width ?? null,
    height: result.height ?? null,
    bytes: result.bytes ?? file.bytes.byteLength,
    format: result.format ?? null,
  };
}

/** Remove an uploaded asset. Failure is logged, never thrown. */
export async function deleteCloudinaryImage(publicId: string): Promise<void> {
  const active = await configured();
  if (!active) return;
  try {
    await active.client.uploader.destroy(publicId, { invalidate: true });
  } catch (error) {
    // The database row is going away regardless; a stranded CDN object is
    // untidy, not broken, and must not fail the operation the user asked for.
    console.error("[cloudinary] could not delete", publicId, error);
  }
}
