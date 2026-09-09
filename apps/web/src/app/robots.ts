import type { MetadataRoute } from "next";
import { getConfig, getSetupState } from "@sendstack/config";
import { parseSiteUrl } from "@/lib/seo";

export const dynamic = "force-dynamic";

function fallbackOrigin() {
    return parseSiteUrl(process.env.NEXT_PUBLIC_APP_URL)?.origin ?? "http://localhost:3000";
}

export default async function robots(): Promise<MetadataRoute.Robots> {
    let origin = fallbackOrigin();
    let configured = false;

    try {
        const state = await getSetupState();
        if (state.stage === "complete") {
            configured = true;
            const config = await getConfig();
            origin = parseSiteUrl(config.appUrl)?.origin ?? origin;
        }
    } catch {
        // Setup might be incomplete; default to env/local origin.
    }

    /**
     * An unconfigured instance has nothing to index.
     *
     * Every route on it either redirects to the wizard or *is* the wizard, and
     * the wizard is a form that configures the whole application. Inviting a
     * crawler in while that is true would put a half-built instance in search
     * results under a hostname that is about to change.
     */
    if (!configured) {
        return { rules: { userAgent: "*", disallow: "/" }, host: origin };
    }

    return {
        rules: {
            userAgent: "*",
            allow: ["/"],
            disallow: [
                "/api/",
                "/archive",
                "/campaigns",
                "/contacts",
                "/drafts",
                "/forgot-password",
                "/inbox",
                "/lists",
                "/offline",
                "/sent",
                "/reset-password",
                "/settings",
                "/setup",
                "/sign-in",
                "/sign-up",
                "/spam",
                "/starred",
                "/suppressions",
                "/unsubscribe",
            ],
        },
        sitemap: `${origin}/sitemap.xml`,
        host: origin,
    };
}