import { OG_ALT, OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/lib/og-image";

/**
 * `force-dynamic` because the card carries the app name, which lives in the
 * database. Without it Next generates the image once at build time — on a
 * machine that may have no database at all, freezing the fallback name into
 * every share preview for the life of the deploy.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = OG_ALT;

export default function OpengraphImage() {
  return renderOgImage();
}
