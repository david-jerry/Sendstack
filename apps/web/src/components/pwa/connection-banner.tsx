"use client";

import { useEffect } from "react";
import { CloudOff, RefreshCw, Wifi } from "lucide-react";
import { flushQueue } from "@sendstack/pwa";
import { useConnectivityStore } from "@/stores/connectivity-store";
import { cn, plural } from "@/lib/utils";

/**
 * How old the cached mail is, in words rather than the list's own "12m".
 *
 * A sentence, because it is read as one: "showing mail as it was 12 minutes
 * ago" has to parse, and `relativeTime`'s "now" would make it say "as it was
 * now". Deliberately coarse — the reader needs to know whether to trust the
 * list, not the exact second it was stored.
 */
function ageOf(storedAt: number): string {
  const minutes = Math.floor((Date.now() - storedAt) / 60_000);
  if (minutes < 1) return "a moment ago";
  if (minutes < 60) return `${minutes} ${plural(minutes, "minute")} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${plural(hours, "hour")} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${plural(days, "day")} ago`;
}

/**
 * Says when the network has gone, and when it comes back.
 *
 * A mail client has to be explicit about this. Every list is fetched, every
 * send is a request, and without a word about it a dropped connection looks
 * exactly like an app that has stopped working — the same spinner, the same
 * empty list, no explanation.
 *
 * Silent until something actually goes wrong. A permanent "online" bar is a
 * strip of the mailbox spent telling you what you already assumed; the store's
 * `hasDropped` is what keeps it out of the way until it has news.
 */
export function ConnectionBanner() {
  const network = useConnectivityStore((state) => state.network);
  const hasDropped = useConnectivityStore((state) => state.hasDropped);
  const queued = useConnectivityStore((state) => state.queued);
  const servedFromCacheAt = useConnectivityStore((state) => state.servedFromCacheAt);
  const setNetwork = useConnectivityStore((state) => state.setNetwork);

  useEffect(() => {
    /**
     * `navigator.onLine` is read once, then only the events are trusted.
     *
     * It is a notoriously weak signal — true for a captive portal, true on a
     * LAN with no route out — so it is used to seed the state and nothing
     * more. The `online`/`offline` events are the part browsers get right.
     */
    setNetwork(navigator.onLine ? "online" : "offline");

    /**
     * Back online: clear the offline state and ask the worker to drain.
     *
     * Background Sync would replay on its own, but only Chromium implements
     * it — so on Safari and Firefox this call is the only thing that sends a
     * queued message, and it only happens while a tab is open.
     */
    const goOnline = () => {
      setNetwork("online");
      /**
       * Tell the worker to drain its queue.
       *
       * Background Sync would do this on its own, but only Chromium
       * implements it — so on Safari and Firefox this message is the only
       * thing that replays a queued send.
       */
      void flushQueue();
    };
    /** Gone offline. `hasDropped` latches here, which is what reveals the bar. */
    const goOffline = () => setNetwork("offline");

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [setNetwork]);

  const offline = network === "offline";
  if (!hasDropped) return null;

  return (
    <div
      // `status`, not `alert`: losing the network is worth announcing, but not
      // worth interrupting whatever is being read to do it.
      role="status"
      aria-live="polite"
      className={cn(
        "flex shrink-0 items-center justify-center gap-2 px-3 py-1.5 text-[12px] font-medium",
        offline
          ? "bg-signal-warning/15 text-signal-warning"
          : "bg-signal-success/12 text-signal-success",
      )}
    >
      {offline ? (
        <>
          <CloudOff className="size-3.5 shrink-0" />
          <span>
            {servedFromCacheAt === null
              ? "Offline — showing what was already loaded."
              : `Offline — showing mail as it was ${ageOf(servedFromCacheAt)}.`}
            {queued > 0
              ? ` ${queued} ${plural(queued, "message")} waiting to send.`
              : " Anything you send will go out when you reconnect."}
          </span>
        </>
      ) : queued > 0 ? (
        <>
          <RefreshCw className="size-3.5 shrink-0 animate-spin" />
          <span>
            Back online — sending {queued} queued {plural(queued, "message")}.
          </span>
        </>
      ) : (
        <>
          <Wifi className="size-3.5 shrink-0" />
          <span>Back online.</span>
        </>
      )}
    </div>
  );
}
