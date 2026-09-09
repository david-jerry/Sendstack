import "server-only";
import { createHash } from "node:crypto";
import { db, eq, inArray } from "@sendstack/db";
import { brandingAssets } from "@sendstack/db/schema";
import { deleteCloudinaryImage, uploadBrandingImage } from "./cloudinary";
import { absoluteUrl } from "@sendstack/shared";

/**
 * Logo and favicon storage, with two backends.
 *
 * Cloudinary when configured — the recommended path, and the one that matters
 * on Vercel. A campaign embeds an absolute link to the logo and every
 * recipient's mail client fetches it, so serving from the app costs one
 * serverless invocation per recipient per open. A CDN URL costs nothing.
 *
 * The database otherwise, so `git clone && pnpm dev` works with no third-party
 * account at all.
 *
 * Callers do not choose. `putBrandingAsset` picks based on configuration, and
 * `brandingRefs` hands back a `BrandingRef` that already carries whichever
 * kind of href resulted — absolute for Cloudinary, an app-relative
 * `/api/branding/…` for the database — so the rest of the codebase never
 * branches on this. `absoluteBrandingUrl` is the one place that has to care,
 * because a mail client has no page to resolve a relative path against.
 */

export const MAX_ASSET_BYTES = 512 * 1024;

export const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
export const ALLOWED_FAVICON_TYPES = [
  "image/png",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/svg+xml",
];

export type BrandingKind = "logo" | "favicon";

export type StoredAsset = {
  kind: string;
  storage: "cloudinary" | "database";
  mimeType: string | null;
  bytes: Buffer | null;
  byteSize: number | null;
  url: string | null;
  publicId: string | null;
  checksum: string;
  updatedAt: Date;
};

export type PutResult = {
  checksum: string;
  storage: "cloudinary" | "database";
  url: string | null;
};

/**
 * The site's own two images, each with its policy attached.
 *
 * Thin over `putImageAsset` on purpose. It narrows `kind` to the two site-wide
 * keys, so nothing can write an arbitrary row through the branding path, and
 * it picks the allowlist per kind: a favicon may be an `.ico` and a logo may
 * not, and both may be an SVG where an avatar may not. The size cap is the
 * site's rather than the avatar's for the same reason the message names mail
 * clients: a logo is fetched by every recipient's client on every open, so it
 * is held to a tighter limit than a picture only this app ever renders.
 */
export async function putBrandingAsset(
  kind: BrandingKind,
  file: { bytes: Buffer; mimeType: string },
): Promise<PutResult> {
  return putImageAsset(kind, file, {
    label: kind,
    allowed: kind === "logo" ? ALLOWED_LOGO_TYPES : ALLOWED_FAVICON_TYPES,
    maxBytes: MAX_ASSET_BYTES,
    tooLargeHint: "mail clients will not wait for a large image",
  });
}

/**
 * The store underneath, addressable by any key.
 *
 * `kind` is the table's primary key, so a caller that needs one image per
 * *thing* rather than one per site — a user avatar, say — namespaces its own
 * key and gets the same two backends, the same validation and the same
 * cleanup, rather than a second half-built copy of all three.
 */
export async function putImageAsset(
  kind: string,
  file: { bytes: Buffer; mimeType: string },
  limits: { label: string; allowed: string[]; maxBytes: number; tooLargeHint: string },
): Promise<PutResult> {
  const { label, allowed, maxBytes } = limits;
  if (!allowed.includes(file.mimeType)) {
    throw new Error(
      `${file.mimeType} is not an accepted ${label} format. Use ${allowed.join(", ")}.`,
    );
  }
  if (file.bytes.byteLength === 0) throw new Error("That file is empty.");
  if (file.bytes.byteLength > maxBytes) {
    throw new Error(
      `That ${label} is ${Math.round(file.bytes.byteLength / 1024)}KB. The limit is ${Math.round(
        maxBytes / 1024,
      )}KB — ${limits.tooLargeHint}.`,
    );
  }

  // Content hash, not a timestamp: re-uploading an identical file keeps the
  // same URL, so caches are not needlessly busted.
  const checksum = createHash("sha256").update(file.bytes).digest("hex").slice(0, 16);

  const previous = await getImageAsset(kind);
  const uploaded = await uploadBrandingImage(kind, file);

  if (uploaded) {
    await db
      .insert(brandingAssets)
      .values({
        kind,
        storage: "cloudinary",
        mimeType: file.mimeType,
        bytes: null,
        byteSize: uploaded.bytes,
        url: uploaded.url,
        publicId: uploaded.publicId,
        width: uploaded.width,
        height: uploaded.height,
        checksum,
      })
      .onConflictDoUpdate({
        target: brandingAssets.kind,
        set: {
          storage: "cloudinary",
          mimeType: file.mimeType,
          // Clear the inline copy: leaving stale bytes behind would let the
          // fallback route serve an old logo if Cloudinary were later removed.
          bytes: null,
          byteSize: uploaded.bytes,
          url: uploaded.url,
          publicId: uploaded.publicId,
          width: uploaded.width,
          height: uploaded.height,
          checksum,
          updatedAt: new Date(),
        },
      });

    // Deterministic public ids mean an overwrite replaced the object in place;
    // only clean up when the id actually changed.
    if (previous?.publicId && previous.publicId !== uploaded.publicId) {
      await deleteCloudinaryImage(previous.publicId);
    }

    return { checksum, storage: "cloudinary", url: uploaded.url };
  }

  await db
    .insert(brandingAssets)
    .values({
      kind,
      storage: "database",
      mimeType: file.mimeType,
      bytes: file.bytes,
      byteSize: file.bytes.byteLength,
      url: null,
      publicId: null,
      checksum,
    })
    .onConflictDoUpdate({
      target: brandingAssets.kind,
      set: {
        storage: "database",
        mimeType: file.mimeType,
        bytes: file.bytes,
        byteSize: file.bytes.byteLength,
        url: null,
        publicId: null,
        checksum,
        updatedAt: new Date(),
      },
    });

  // Switching from Cloudinary back to the database leaves an orphan otherwise.
  if (previous?.publicId) await deleteCloudinaryImage(previous.publicId);

  return { checksum, storage: "database", url: null };
}

export async function getBrandingAsset(kind: BrandingKind): Promise<StoredAsset | null> {
  return getImageAsset(kind);
}

export async function getImageAsset(kind: string): Promise<StoredAsset | null> {
  const [row] = await db.select().from(brandingAssets).where(eq(brandingAssets.kind, kind));
  if (!row) return null;
  return {
    kind: row.kind,
    storage: row.storage,
    mimeType: row.mimeType,
    bytes: row.bytes,
    byteSize: row.byteSize,
    url: row.url,
    publicId: row.publicId,
    checksum: row.checksum,
    updatedAt: row.updatedAt,
  };
}

export async function deleteBrandingAsset(kind: BrandingKind): Promise<void> {
  return deleteImageAsset(kind);
}

/**
 * Remove an asset from both backends.
 *
 * The read comes first because the row holds the only pointer to the remote
 * copy: `publicId` is recorded nowhere else, so deleting the row before
 * looking at it would leave a Cloudinary object no code in this repository can
 * name, let alone remove. The remote delete logs instead of throwing, so a
 * Cloudinary outage still removes the row and the worst case is a stranded
 * object rather than an undeletable logo.
 */
export async function deleteImageAsset(kind: string): Promise<void> {
  const existing = await getImageAsset(kind);
  if (existing?.publicId) await deleteCloudinaryImage(existing.publicId);
  await db.delete(brandingAssets).where(eq(brandingAssets.kind, kind));
}

export type BrandingRef = {
  /** Absolute when hosted on Cloudinary, app-relative otherwise. */
  href: string;
  storage: "cloudinary" | "database";
} | null;

/**
 * How the rest of the app refers to a branding asset.
 *
 * One query returns both kinds, because a page usually needs the favicon and
 * the logo together and an email needs the logo plus the app URL.
 */
export async function brandingRefs(): Promise<{ logo: BrandingRef; favicon: BrandingRef }> {
  const rows = await db
    .select({
      kind: brandingAssets.kind,
      storage: brandingAssets.storage,
      url: brandingAssets.url,
      checksum: brandingAssets.checksum,
    })
    .from(brandingAssets)
    // The table is shared with per-user avatars now, and there is one of those
    // per person. Without this the site's two rows arrive behind everyone's.
    .where(inArray(brandingAssets.kind, ["logo", "favicon"]));

  const toRef = (row: (typeof rows)[number] | undefined): BrandingRef => {
    if (!row) return null;
    if (row.storage === "cloudinary" && row.url) {
      return { href: row.url, storage: "cloudinary" };
    }
    return { href: `/api/branding/${row.kind}?v=${row.checksum}`, storage: "database" };
  };

  return {
    logo: toRef(rows.find((row) => row.kind === "logo")),
    favicon: toRef(rows.find((row) => row.kind === "favicon")),
  };
}

/**
 * The logo URL an email should use — always absolute.
 *
 * A mail client has no page to resolve a relative path against. A Cloudinary
 * href already qualifies; a database-backed one has to be joined to the app
 * URL, which is the case that silently produces a broken image if forgotten.
 */
export function absoluteBrandingUrl(appUrl: string, ref: BrandingRef): string | null {
  if (!ref) return null;
  if (ref.storage === "cloudinary") return ref.href;
  return absoluteUrl(appUrl, ref.href);
}
