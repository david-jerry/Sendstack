import "server-only";
import { deleteImageAsset, getImageAsset, putImageAsset } from "./branding";

/**
 * Profile pictures, on the same store as the logo and favicon.
 *
 * Cloudinary when it is configured, the database when it is not, chosen the
 * same way and by the same code — a self-hosted instance with no third-party
 * account still gets avatars.
 *
 * The key is namespaced per user rather than per site (`avatar:<id>`), which
 * is the only reason a table designed for two rows can hold one per person.
 */

/** 1MB. An avatar is displayed at 40px; anything larger is a photo, not a face. */
export const MAX_AVATAR_BYTES = 1024 * 1024;

/**
 * No SVG, unlike the logo.
 *
 * A logo is uploaded by whoever administers the instance. An avatar is
 * uploaded by any account holder, and an SVG served from our own origin is a
 * script that runs as us — Cloudinary sanitises on upload, but the database
 * backend has nothing to sanitise with.
 */
export const ALLOWED_AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"];

export function avatarKind(userId: string): string {
  return `avatar:${userId}`;
}

/**
 * Store a new avatar and return the URL to render it from.
 *
 * Absolute for Cloudinary, app-relative otherwise — carrying the content hash
 * so replacing the picture actually changes the URL. The caller writes the
 * result to `user.image`, which is what everything else reads.
 */
export async function putUserAvatar(
  userId: string,
  file: { bytes: Buffer; mimeType: string },
): Promise<string> {
  const result = await putImageAsset(avatarKind(userId), file, {
    label: "profile picture",
    allowed: ALLOWED_AVATAR_TYPES,
    maxBytes: MAX_AVATAR_BYTES,
    tooLargeHint: "crop or resize it first",
  });

  if (result.storage === "cloudinary" && result.url) return result.url;
  return `/api/avatars/${encodeURIComponent(userId)}?v=${result.checksum}`;
}

/**
 * The stored asset itself — bytes, storage kind, checksum — and not an href.
 *
 * Its consumer is `/api/avatars/[userId]`, which has nothing else to work
 * with: on the database backend it writes those bytes out as the response, and
 * it still has to cope with a picture that has since moved to Cloudinary by
 * redirecting to the URL. An href alone would leave that route unable to do
 * either, and the bytes are the reason the route exists.
 */
export async function getUserAvatar(userId: string) {
  return getImageAsset(avatarKind(userId));
}

/**
 * Remove the stored picture. Deliberately does **not** clear `user.image`.
 *
 * That column belongs to Better Auth, and this package cannot reach it —
 * `@sendstack/auth` reads configuration and never the other way round, which
 * is the boundary that keeps auth out of the store. So removing a picture is
 * two writes, and the caller owns the second: `removeAvatar` in the profile
 * actions is the pairing to copy. Doing only this one leaves an href pointing
 * at a row that is gone.
 */
export async function deleteUserAvatar(userId: string): Promise<void> {
  await deleteImageAsset(avatarKind(userId));
}
