import { ImageResponse } from "next/og";
import { getConfigCached, getSetupStateCached } from "@/lib/config-cache";

/**
 * The social preview card, drawn rather than reused.
 *
 * The alternative was the one that was here: pointing `og:image` and
 * `twitter:image` at `android-chrome-512x512.png`. That is a 1:1 image behind
 * a `summary_large_image` card, which wants 2:1 and at least 300×157 — X and
 * Slack either letterbox it into a thin strip or fall back to no image at all,
 * and Facebook's scraper reports it as below the recommended size. A card
 * declared large has to actually be large.
 *
 * 1200×630 is the size every major crawler documents, and the only reason
 * this is generated per request rather than committed as a file is the app
 * name: it comes from settings, so a rebrand has to reach the preview card
 * without a rebuild — the same reason `manifest.ts` is dynamic.
 */
export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

/** Falls back to the product name, because a card is better than a 500. */
async function appName(): Promise<string> {
  try {
    const state = await getSetupStateCached();
    if (state.stage !== "complete") return "Sendstack";
    return (await getConfigCached()).appName;
  } catch {
    return "Sendstack";
  }
}

/**
 * Static, unlike the image itself. `alt` is a module-level export that Next
 * reads without awaiting, so deriving it from configuration would mean either
 * a promise where a string belongs or a database read at module load.
 */
export const OG_ALT = "Open source bulk mail sending with Resend";

export async function renderOgImage(): Promise<ImageResponse> {
  const name = await appName();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          // Literal colours, not the app's CSS tokens: this renders in satori,
          // which has no stylesheet and no custom properties to resolve.
          background: "#09090b",
          color: "#fafafa",
          padding: "80px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "14px",
              background: "#fafafa",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#09090b",
              fontSize: "34px",
              fontWeight: 700,
            }}
          >
            {name.slice(0, 1).toUpperCase()}
          </div>
          <div style={{ fontSize: "34px", fontWeight: 600 }}>{name}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div
            style={{
              fontSize: "68px",
              fontWeight: 600,
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
            }}
          >
            Send bulk campaigns with Resend, then handle replies in one inbox.
          </div>
          <div style={{ fontSize: "30px", color: "#a1a1aa" }}>
            Open source · self-hosted · realtime inbound
          </div>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      headers: {
        /**
         * Crawlers refetch this far more often than the app name changes, and
         * every fetch is a satori render. An hour is long enough to stop that
         * being a way to make the instance do work, short enough that a
         * rebrand shows up the same afternoon.
         */
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    },
  );
}
