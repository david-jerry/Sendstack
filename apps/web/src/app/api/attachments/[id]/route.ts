import { db, eq } from "@sendstack/db";
import { outboundAttachments } from "@sendstack/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves one stored file: an inline image inside a delivered email, or a
 * download from the sent copy.
 *
 * Answers without a session, like the branding routes and for the same reason —
 * a recipient's mail client has no cookies for this origin, and an inline image
 * that only renders for the sender is not an inline image. The id is a random
 * UUID, so the URL is the capability; nothing here enumerates.
 *
 * An `inline` file is displayed, an `attachment` is offered as a download.
 * Sending `Content-Disposition: attachment` for the second matters: without it
 * a browser will happily render an uploaded HTML file on this origin.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });

  const [file] = await db
    .select({
      filename: outboundAttachments.filename,
      contentType: outboundAttachments.contentType,
      byteSize: outboundAttachments.byteSize,
      bytes: outboundAttachments.bytes,
      checksum: outboundAttachments.checksum,
      disposition: outboundAttachments.disposition,
    })
    .from(outboundAttachments)
    .where(eq(outboundAttachments.id, id))
    .limit(1);

  if (!file) return new Response("Not found", { status: 404 });

  const inline = file.disposition === "inline";

  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.contentType ?? "application/octet-stream",
      "Content-Length": String(file.byteSize),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${file.filename.replace(/"/g, "")}"`,
      // The bytes at an id never change — a replacement is a new row — so this
      // is safely immutable, which is what keeps a mail provider's image proxy
      // from re-fetching on every open.
      "Cache-Control": "public, max-age=31536000, immutable",
      // Belt and braces behind Content-Disposition: an uploaded SVG or HTML
      // file must not be sniffed into something executable on this origin.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      ETag: `"${file.checksum}"`,
    },
  });
}
