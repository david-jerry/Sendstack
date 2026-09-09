import { OG_ALT, OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/lib/og-image";

/**
 * X reads `twitter:image`, and there is no fallback to `og:image` in the
 * file conventions — a `summary_large_image` card with no `twitter-image`
 * route is a card with no image. Same drawing, second filename.
 *
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

export default function TwitterImage() {
  return renderOgImage();
}
