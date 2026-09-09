import type { Metadata } from "next";

export const NO_INDEX_ROBOTS: NonNullable<Metadata["robots"]> = {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
        index: false,
        follow: false,
        noimageindex: true,
        "max-image-preview": "none",
        "max-snippet": -1,
        "max-video-preview": -1,
    },
};

export const NO_INDEX_METADATA: Metadata = {
    robots: NO_INDEX_ROBOTS,
};

export function parseSiteUrl(input: string | null | undefined): URL | null {
    if (!input) return null;
    try {
        return new URL(input);
    } catch {
        return null;
    }
}

export function absoluteFrom(base: URL | null, pathname: string): string | undefined {
    if (!base) return undefined;
    return new URL(pathname, base).toString();
}