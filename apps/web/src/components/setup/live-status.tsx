"use client";

import { cn } from "@/lib/utils";
import type { StreamStatus } from "@/hooks/use-setup-stream";

/**
 * A quiet indicator that the page is watching for changes.
 *
 * It exists so that "restart the server and this page will move on by itself"
 * is a visible promise rather than something the user has to take on trust —
 * the whole point being that nobody sits waiting on a screen that has already
 * gone stale.
 */
export function LiveStatus({ status }: { status: StreamStatus }) {
  const label =
    status === "live"
      ? "Watching for changes"
      : status === "reconnecting"
        ? "Reconnecting…"
        : "Connecting…";

  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className="relative flex size-1.5">
        {status === "live" ? (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-signal-success opacity-60" />
        ) : null}
        <span
          className={cn(
            "relative inline-flex size-1.5 rounded-full",
            status === "live" ? "bg-signal-success" : "bg-signal-warning",
          )}
        />
      </span>
      {label}
    </span>
  );
}
