import type { MetadataRoute } from "next";
import { getConfig, getSetupState } from "@sendstack/config";
import { parseSiteUrl } from "@/lib/seo";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    let site = parseSiteUrl(process.env.NEXT_PUBLIC_APP_URL) ?? new URL("http://localhost:3000");

    try {
        const state = await getSetupState();
        if (state.stage !== "complete") return [];
        const config = await getConfig();
        site = parseSiteUrl(config.appUrl) ?? site;
    } catch {
        return [];
    }

    return [
        {
            url: new URL("/", site).toString(),
            lastModified: new Date(),
            changeFrequency: "weekly",
            priority: 1,
        },
    ];
}