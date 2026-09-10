"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { parseRealtimeEvent, type RealtimeEventType } from "@sendstack/shared";
import { REALTIME_INVALIDATIONS } from "@/lib/query-keys";
import { armSound, playEventSound } from "@/lib/notification-sound";
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
  const queryClient = useQueryClient();
  const apply = useRealtimeStore((s) => s.apply);
  const setConnection = useRealtimeStore((s) => s.setConnection);
  const setUnreadCount = useRealtimeStore((s) => s.setUnreadCount);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Event types seen since the last flush, so a burst invalidates each list
   * once rather than once per message.
   *
   * A `Set` in a ref and not state: writing it must not render, and the
   * debounced flush below is the only reader. Twenty replies landing together
   * cost one `["threads"]` invalidation, which is the same economy the
   * debounced refresh was already buying for the Server Components.
   */
  const pendingTypes = useRef<Set<RealtimeEventType>>(new Set());

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
    /**
     * Audio has to wait for a gesture; the listener that notices one is
     * armed here because this hook is mounted exactly once, in the shell.
     * Arming it inside the sound module's own first call would be too late
     * — the first event is precisely the one that would be silent.
     */
    armSound();

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

      /**
       * The Activity toast lives here, not in `ActivityBell`.
       *
       * The bell is mounted **twice** — the sidebar row and the mobile header
       * — so a toast raised from inside it would appear twice for one event at
       * every width that renders both. There is exactly one `EventSource` for
       * the app, and this is it, so a toast raised here is raised once however
       * many bells are on screen.
       *
       * The store is consulted *before* `apply`, which is what makes this
       * idempotent: `apply` dedupes `account.activity` on `eventId`, so asking
       * afterwards would always say "already present". Resend's retry ladder
       * can deliver the same `svix-id` again hours later (invariant 4,
       * realtime expectation 2) and this is where that stops being a second
       * toast.
       */
      const duplicateActivity =
        event.type === "account.activity" &&
        useRealtimeStore.getState().activity.some((item) => item.eventId === event.eventId);

      if (event.type === "account.activity" && !duplicateActivity) {
        const href = event.href;
        toast(event.summary, {
          // Only offered where the describer found somewhere to go: an
          // "Open" that does nothing is worse than no action at all.
          ...(href ? { action: { label: "Open", onClick: () => router.push(href) } } : {}),
        });
      }

      /**
       * The cue, raised here for the same reason the Activity toast is: one
       * `EventSource` for the app means one sound per event, however many
       * components are mounted. Before `apply`, so that a duplicate
       * `account.activity` — which `apply` drops on `eventId` — is also
       * silent the second time, matching the toast exactly.
       */
      if (event.type !== "account.activity" || !duplicateActivity) playEventSound(event);

      apply(event);

      pendingTypes.current.add(event.type);

      /**
       * Both halves of the refresh, on one timer.
       *
       * `router.refresh()` re-renders the Server Components — the folder
       * counts, the bell's seed, the thread reader. It does **not** touch
       * TanStack Query, and every mailbox list is a TanStack query seeded
       * from a prop that is ignored once the cache holds anything. Refreshing
       * without invalidating is what made an arriving message move the unread
       * badge while the list beneath it stayed exactly as it was.
       *
       * Invalidation first, so both requests are in flight together rather
       * than the list waiting on the RSC payload.
       */
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        const types = Array.from(pendingTypes.current);
        pendingTypes.current.clear();

        const seen = new Set<string>();
        for (const type of types) {
          for (const queryKey of REALTIME_INVALIDATIONS[type]) {
            const identity = queryKey.join("/");
            if (seen.has(identity)) continue;
            seen.add(identity);
            void queryClient.invalidateQueries({ queryKey });
          }
        }

        router.refresh();
      }, 400);
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
  }, [apply, queryClient, router, setConnection]);
}

/** Mounted once in the app shell. Renders nothing. */
export function RealtimeBridge({ initialUnread }: { initialUnread: number }) {
  useRealtime({ initialUnread });
  return null;
}
