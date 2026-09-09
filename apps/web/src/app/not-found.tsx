import type { Metadata } from "next";
import { FileQuestion } from "lucide-react";
import Link from "next/link";
import { NO_INDEX_METADATA } from "@/lib/seo";

/**
 * A URL that matches nothing.
 *
 * `noindex`, and deliberately so: a 404 that gets indexed is a 404 that shows
 * up in search results for the product's own name. Next returns a real 404
 * status for non-streamed responses, so crawlers get the right signal either
 * way — this is belt and braces.
 *
 * A Server Component with no data of its own, which is what lets it render
 * statically. Nothing here needs the database, and a 404 that has to reach
 * Postgres is a 404 that can fail.
 */
export const metadata: Metadata = {
  title: "Not found",
  ...NO_INDEX_METADATA,
};

export default function NotFound() {
  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-background px-6"
      role="alert"
    >
      <div className="max-w-[360px] text-center">
        <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-secondary">
          <FileQuestion className="size-4 text-muted-foreground" />
        </div>

        <h1 className="mt-4 text-[15px] font-medium">Page not found</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
          That address does not exist here. If you followed a link from an email, it may have
          pointed at an older version of this instance.
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/inbox"
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go to inbox
          </Link>
          <Link
            href="/"
            className="inline-flex h-8 items-center rounded-md border px-3 text-[13px] font-medium transition-colors hover:bg-accent"
          >
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
