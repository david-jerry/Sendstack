"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { parseRealtimeEvent } from "@sendstack/shared";
import { useRealtimeStore } from "@/stores/realtime-store";

/**
 * Holds the browser's end of the realtime chain.
 *
 * `EventSource` rather than a WebSocket, for two reasons. Resend delivers
 * inbound mail by webhook, so the traffic is strictly server-to-client and the
 * upstream half of a duplex connection would go unused. And SSE reconnects on
 * its own, survives the serverless request model, and needs no protocol
 * upgrade at the proxy — a WebSocket needs a long-lived server process that a
 * Vercel-style deployment does not have.
 *
 * Events nudge local state immediately, then trigger a debounced
 * `router.refresh()`. The nudge is what makes the UI feel live; the refresh is
 * what makes it *correct*, since it re-renders Server Components against
 * Postgres. A burst of twenty arrivals therefore costs one refetch, not twenty.
 */
export function useRealtime(options?: { initialUnread?: number }) {
  const router = useRouter();
  const apply = useRealtimeStore((s) => s.apply);
  const setConnection = useRealtimeStore((s) => s.setConnection);
  const setUnreadCount = useRealtimeStore((s) => s.setUnreadCount);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initialUnread = options?.initialUnread;
  /**
   * **No dependency array, on purpose: a fresh render must reseed, not merely
   * a changed number.**
   *
   * This effect is the whole reconciliation between the live store and
   * Postgres, and `[initialUnread]` silently stopped performing it when the
   * unread badge became a count of conversations. Two messages landing in one
   * already-unread thread leave `folderCounts.unread` identical — so the prop
   * was identical, so the deps were identical, so the effect never ran — while
   * the store had already nudged the count up. The badge then disagreed with
   * the database for the rest of the session with nothing left to correct it.
   * The old row-counting badge hid this by accident: every arriving message
   * moved the server number too, so the deps always changed.
   *
   * `RealtimeBridge` holds no state and no context, so its only source of
   * re-renders is the layout re-rendering — which is exactly what
   * `router.refresh()` causes after every event. Running on each of those is
   * the requirement, stated directly, rather than smuggled in as a token whose
   * only job is to differ.
   *
   * The cost is that a live event arriving between the refresh's query and its
   * render is discarded; the next event's refresh picks it up. That is the
   * right trade where Postgres is the source of truth and this store holds
   * only the delta since the last render.
   */
  useEffect(() => {
    if (typeof initialUnread === "number") setUnreadCount(initialUnread);
  });

  useEffect(() => {
    const source = new EventSource("/api/realtime/stream");

    /**
     * A *re*connect refetches from Postgres; the first open does not.
     *
     * Pub/sub has no replay. Anything published while the stream was down —
     * a proxy cut it, the server recycled it at its lifetime cap, Redis was
     * reconfigured — is gone, and the source of truth is the only way to
     * recover it. The first open is skipped because the page has just been
     * server-rendered from that same source.
     */
    let opened = false;
    source.onopen = () => {
      if (opened) router.refresh();
      opened = true;
      setConnection("open");
    };

    source.onmessage = (message) => {
      const event = parseRealtimeEvent(message.data);
      if (!event) return;
      apply(event);

      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), 400);
    };

    source.onerror = () => {
      // EventSource reconnects by itself with its own backoff; reflect the
      // state and let it. Calling close() here would disable that.
      setConnection(source.readyState === EventSource.CLOSED ? "closed" : "connecting");
    };

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      source.close();
      setConnection("closed");
    };
  }, [apply, router, setConnection]);
}

/** Mounted once in the app shell. Renders nothing. */
export function RealtimeBridge({ initialUnread }: { initialUnread: number }) {
  useRealtime({ initialUnread });
  return null;
}
