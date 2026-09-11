"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import type { ActivityItem } from "@/lib/queries/activity";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { RelativeTime } from "@/components/ui/time";
import { cn } from "@/lib/utils";
import { ACCOUNT_ACTIVITY_LIMIT } from "@sendstack/shared";
import { useActivity } from "@/stores/realtime-store";

/**
 * Remembered per browser, so the dot means "since you last looked here" rather
 * than "since this tab loaded".
 *
 * A `localStorage` key and not a cookie, unlike the sidebar's width: nothing
 * about this has to be known before the first byte of HTML. The dot is allowed
 * to appear a frame after hydration — see `seenAt` below — where a collapsed
 * sidebar rendering full width and snapping shut is not.
 */
const SEEN_KEY = "sendstack.activity-seen-at";

/**
 * When this browser last opened the bell, or `null` if it never has.
 *
 * A read that can throw. `localStorage` is a *getter* that raises in private
 * browsing and wherever site data is blocked, so this is not defensive
 * decoration — it is the difference between the sidebar rendering and the
 * whole shell failing for those readers. Failure is treated as "never
 * looked", which shows the dot: over-reporting an unread change is the
 * harmless direction, and the alternative hides a domain that stopped
 * verifying.
 */
function readSeenAt(): string | null {
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Everything mounted that shows the dot, so a write reaches all of it.
 *
 * The bell is mounted twice — the rail and the mobile header — and the marker
 * is one value shared between them. Without this, opening one popover cleared
 * only that instance's dot and the other kept claiming there was something new
 * until the next remount.
 */
const seenListeners = new Set<() => void>();

/**
 * Records the timestamp of the newest entry the reader has now seen.
 *
 * The newest *item's* `at`, not `Date.now()`. The two differ whenever an event
 * lands between this write and the next render, and storing the clock would
 * mark that event read without it ever having been on screen.
 */
function writeSeenAt(at: string): void {
  try {
    window.localStorage.setItem(SEEN_KEY, at);
  } catch {
    // Nothing to do: the list itself still renders, only the dot is lost.
  }
  for (const listener of seenListeners) listener();
}

function subscribeSeenAt(onChange: () => void): () => void {
  seenListeners.add(onChange);
  return () => seenListeners.delete(onChange);
}

/**
 * `undefined` on the server and during hydration; the stored value after.
 *
 * The sentinel is the whole mechanism. The marker exists only in the browser,
 * so the server cannot know it — and `null` cannot stand in for "unknown"
 * because `null` legitimately means "never looked", which *shows* the dot.
 * Returning `undefined` for the server pass is what keeps the dot out of the
 * HTML and therefore out of a hydration mismatch.
 *
 * `useSyncExternalStore` rather than a `useState` flipped in an effect, for
 * the same reason `useHydrated` uses it: React runs `getServerSnapshot` for
 * both the server render and the hydration render and `getSnapshot` for
 * everything after, with no cascading `setState` in an effect body — which the
 * repo's `react-hooks/set-state-in-effect` rule rejects outright.
 *
 * Deliberately uncached: `getSnapshot` must be pure with respect to the
 * external state, and a module-level cache would have to be invalidated from
 * both `writeSeenAt` and another tab's `storage` event. One `getItem` of one
 * short string, a handful of times per render, is not worth that bookkeeping.
 */
const NOT_READ = () => undefined;

/**
 * One list from two sources, deduped on `eventId`.
 *
 * The overlap is the normal case, not an edge case: the layout reseeds
 * `initial` from Postgres on every navigation while SSE is still delivering
 * the same events, so a given `eventId` is routinely present in both halves.
 * Concatenating would show it twice, and the duplicate would look like Resend
 * having sent the webhook twice.
 *
 * `initial` wins a collision because it came from the source of truth
 * (invariant 1); the live copy carries the same describer's output anyway, so
 * the choice only matters for the shape of the argument, not the pixels.
 */
function mergeActivity(
  initial: readonly ActivityItem[],
  live: readonly ActivityItem[],
): ActivityItem[] {
  const byId = new Map<string, ActivityItem>();
  for (const item of live) byId.set(item.eventId, item);
  for (const item of initial) byId.set(item.eventId, item);

  return (
    [...byId.values()]
      // ISO-8601 UTC strings sort lexicographically, which is why the server
      // query hands them over as strings rather than Dates.
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      .slice(0, ACCOUNT_ACTIVITY_LIMIT)
  );
}

/** One entry. A `<Link>` only when the describer found somewhere to send you. */
function ActivityRow({ item }: { item: ActivityItem }) {
  const body = (
    <>
      <span className="min-w-0 flex-1 text-[13px] leading-snug">{item.summary}</span>
      <RelativeTime value={item.at} className="shrink-0 text-xs text-muted-foreground" />
    </>
  );

  if (!item.href) {
    return <div className="flex items-start gap-2 rounded-md px-1.5 py-1.5">{body}</div>;
  }

  return (
    <Link
      href={item.href}
      className="flex items-start gap-2 rounded-md px-1.5 py-1.5 transition-colors hover:bg-accent"
    >
      {body}
    </Link>
  );
}

/**
 * What changed in the Resend account, and whether any of it is new.
 *
 * Resend posts nineteen webhook types and ten of them concern the account
 * rather than a message — a sending domain unverifying, which silently breaks
 * every send, used to be visible only by querying `email_events` by hand.
 * This is where they surface.
 *
 * **It does not toast.** The toast for a live event is raised once, in
 * `hooks/use-realtime.ts`, because this component is mounted twice — the
 * sidebar row and the mobile header — and a toast raised here would appear
 * twice for one event on every viewport that renders both. Everything this
 * component holds is either a prop or store state, so two instances are
 * otherwise indistinguishable from one.
 */
export function ActivityBell({
  initial,
  variant = "sidebar",
}: {
  initial: ActivityItem[];
  /**
   * `sidebar` is a labelled row in the rail; `icon` is the square button in
   * the mobile header, where the rail is behind a drawer.
   */
  variant?: "sidebar" | "icon";
}) {
  const live = useActivity();
  const items = mergeActivity(initial, live);
  const newest = items[0]?.at ?? null;

  const [open, setOpen] = useState(false);
  /** `undefined` until React has hydrated. See `NOT_READ`. */
  const seenAt = useSyncExternalStore<string | null | undefined>(
    subscribeSeenAt,
    readSeenAt,
    NOT_READ,
  );

  const unread = seenAt !== undefined && newest !== null && (seenAt === null || newest > seenAt);

  /**
   * Marked seen on open, not on close.
   *
   * Opening is the act of reading, and a reader who opens the popover and then
   * navigates away without closing it has still read it.
   */
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next || newest === null) return;
    writeSeenAt(newest);
  };

  const dot = unread ? (
    <span
      aria-hidden
      data-slot="activity-unread"
      className={cn(
        "pointer-events-none absolute size-1.5 rounded-full bg-signal-unread",
        variant === "sidebar" ? "top-1.5 right-1.5" : "top-1 right-1",
      )}
    />
  ) : null;

  const label = unread ? "Activity, new" : "Activity";

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {variant === "sidebar" ? (
        <SidebarMenuItem>
          {/* `asChild` around the trigger rather than the trigger around the
              row: `SidebarMenuButton` wraps itself in a tooltip when given
              one, and a `PopoverTrigger` on the outside would hand its props
              to that wrapper instead of to a DOM node. */}
          <SidebarMenuButton asChild size="sm" tooltip="Activity">
            <PopoverTrigger aria-label={label}>
              <Bell />
              <span>Activity</span>
              {dot}
            </PopoverTrigger>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : (
        <PopoverTrigger
          aria-label={label}
          title="Activity"
          className={cn(
            "relative inline-flex size-7 shrink-0 items-center justify-center rounded-md",
            "text-muted-foreground transition-colors outline-none",
            "hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40",
          )}
        >
          <Bell className="size-4" />
          {dot}
        </PopoverTrigger>
      )}

      <PopoverContent align="start" className="p-2">
        <p className="px-1.5 pb-1.5 text-xs font-medium text-muted-foreground">Activity</p>
        {items.length === 0 ? (
          <p className="px-1.5 py-1 text-[13px] text-muted-foreground">
            Nothing yet. Domain, contact and suppression changes in Resend show up here.
          </p>
        ) : (
          <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
            {items.map((item) => (
              <ActivityRow key={item.eventId} item={item} />
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
