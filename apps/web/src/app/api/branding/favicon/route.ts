import { getBrandingAsset } from "@sendstack/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves a database-backed favicon.
 *
 * Answers without a session on purpose: emails embed an absolute link here and
 * a recipient's mail client has no cookies for this origin. Safe, because it is
 * a public brand image and nothing else is reachable.
 *
 * When Cloudinary is configured this route is not used at all — `brandingRefs`
 * hands out the CDN URL instead, and a request that lands here for a
 * Cloudinary-backed asset is redirected rather than 404'd, so a link cached in
 * an already-delivered email keeps working after a switch to Cloudinary.
 */
export async function GET() {
  const asset = await getBrandingAsset("favicon");
  if (!asset) return new Response("Not found", { status: 404 });

  if (asset.storage === "cloudinary") {
    if (!asset.url) return new Response("Not found", { status: 404 });
    return Response.redirect(asset.url, 307);
  }

  if (!asset.bytes) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(asset.bytes), {
    headers: {
      "Content-Type": asset.mimeType ?? "application/octet-stream",
      "Content-Length": String(asset.byteSize ?? asset.bytes.byteLength),
      // The URL carries a ?v=<checksum> that changes only when the bytes do,
      // which is what makes immutable correct. Mail providers cache images
      // hard enough that a stable URL would pin an old logo in place forever.
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: `"${asset.checksum}"`,
    },
  });
}
