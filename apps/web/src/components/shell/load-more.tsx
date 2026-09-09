"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The end of a cursor-paginated list.
 *
 * A button rather than an intersection observer, deliberately. Infinite scroll
 * in a mail client fights the thing the list is for: rows are clicked, which
 * navigates, and coming back to a list that has silently grown by two pages
 * loses your place. A button also has a keyboard path and a state you can see,
 * and it never fires because a resize nudged the sentinel into view.
 *
 * Renders nothing when there is nothing more, so no caller needs to check.
 */
export function LoadMore({
  hasMore,
  loading,
  onLoadMore,
  label = "Load more",
  /** Shown instead of the button once the list is exhausted. */
  exhaustedLabel,
}: {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  label?: string;
  exhaustedLabel?: string | undefined;
}) {
  if (!hasMore) {
    return exhaustedLabel ? (
      <p className="px-4 py-4 text-center text-[11px] text-muted-foreground">{exhaustedLabel}</p>
    ) : null;
  }

  return (
    <div className="flex justify-center px-4 py-3">
      <Button type="button" variant="outline" size="sm" disabled={loading} onClick={onLoadMore}>
        {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
        {loading ? "Loading…" : label}
      </Button>
    </div>
  );
}
