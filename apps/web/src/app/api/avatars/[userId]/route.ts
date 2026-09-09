import { getSession } from "@sendstack/auth";
import { getUserAvatar } from "@sendstack/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves a database-backed avatar.
 *
 * Unlike the logo route this one requires a session. A logo is deliberately
 * public — a recipient's mail client fetches it with no cookies — whereas a
 * profile picture is only ever rendered inside the app, and there is no
 * reason to let the open internet enumerate what the people here look like.
 *
 * When Cloudinary is configured `putUserAvatar` hands out the CDN URL and
 * this route is not used; a request that lands here anyway is redirected, so
 * an href stored before the switch keeps resolving.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { userId } = await params;
  const asset = await getUserAvatar(userId);
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
      // The href carries a ?v=<checksum> that changes only when the bytes do.
      // Private, because the response is scoped to a signed-in viewer and must
      // not be held by a shared cache.
      "Cache-Control": "private, max-age=31536000, immutable",
      ETag: `"${asset.checksum}"`,
    },
  });
}
