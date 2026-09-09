import type { MetadataRoute } from "next";
import { getConfig, getSetupState } from "@sendstack/config";

export const dynamic = "force-dynamic";

/**
 * What the browser needs to install this as an app.
 *
 * Generated per request rather than written as a static file, for the same
 * reason `generateMetadata` is: the name and colour come from settings, so a
 * rebrand should reach the installed icon and splash screen without a rebuild.
 *
 * Wrapped in a try/catch because this route is reachable before the database
 * exists — during the setup wizard — and a manifest that 500s makes the whole
 * app un-installable with no visible error.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  let name = "Sendstack";
  let themeColor = "#18181b";

  try {
    const state = await getSetupState();
    if (state.stage === "complete") {
      const config = await getConfig();
      name = config.appName;
      themeColor = config.primaryColor;
    }
  } catch {
    // Defaults are fine; an un-configured instance still deserves a manifest.
  }

  return {
    name,
    short_name: name.length > 12 ? name.slice(0, 12) : name,
    description: `${name} — campaigns and replies in one place.`,
    /**
     * `standalone`, not `browser`: this is a mail client, and the browser's
     * own address bar and back button fight a list/detail layout that manages
     * its own navigation.
     */
    display: "standalone",
    /**
     * Straight into the mailbox. `/` only exists to redirect, so starting
     * there costs the installed app a round trip on every launch.
     */
    start_url: "/inbox",
    scope: "/",
    /** Matches the app shell so there is no white flash before first paint. */
    background_color: "#ffffff",
    theme_color: themeColor,
    orientation: "any",
    icons: [
      {
        src: "/favicon/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/favicon/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      /**
       * `maskable` as well as `any`, pointing at the same file.
       *
       * Android crops a non-maskable icon into whatever shape the launcher
       * uses, which on a circular mask eats the corners. Declaring it maskable
       * asks for the safe-zone treatment instead. The icon should ideally have
       * its own padded variant; until it does, this is the better of the two
       * available failure modes.
       */
      {
        src: "/favicon/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    /** Long-press the installed icon to write a message or read the inbox. */
    shortcuts: [
      { name: "Inbox", url: "/inbox" },
      { name: "Drafts", url: "/drafts" },
      { name: "Campaigns", url: "/campaigns" },
    ],
    categories: ["productivity", "business"],
  };
}
