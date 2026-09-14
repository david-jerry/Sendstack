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
    let landingPage = false;

    try {
        const state = await getSetupState();
        if (state.stage === "complete") {
            configured = true;
            const config = await getConfig();
            origin = parseSiteUrl(config.appUrl)?.origin ?? origin;
            landingPage = !config.homeRedirect;
        }
    } catch {
        // Setup might be incomplete; default to env/local origin.
    }

    /**
     * Two instances have nothing to index.
     *
     * **Unconfigured**: every route either redirects to the wizard or *is* the
     * wizard, and the wizard is a form that configures the whole application.
     * Inviting a crawler in while that is true would put a half-built instance
     * in search results under a hostname that is about to change.
     *
     * **Landing page switched off**: `/` answers with a redirect to a sign-in
     * form, and every other route is already disallowed below. `sitemap.ts`
     * returns nothing on the same condition — a sitemap advertising a URL that
     * only ever redirects is the failure mode of letting the two disagree.
     */
    if (!configured || !landingPage) {
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