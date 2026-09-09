"use client";

import { create } from "zustand";
import type { RealtimeEvent } from "@sendstack/shared";

export type ConnectionState = "connecting" | "open" | "closed";

type CampaignProgress = { status: string; sentCount: number; totalRecipients: number };

/** The last thing the provider said about one message we sent. */
export type OutboundEvent = { event: string; at: string; detail: string | null };

type RealtimeState = {
  connection: ConnectionState;
  /** Server-rendered baseline, adjusted by live events between navigations. */
  unreadCount: number;
  /**
   * Ids that arrived over SSE since this page rendered, so the list can flag
   * them. Capped at 100 and never cleared — the highlight is meant to survive
   * the debounced `router.refresh()` that folds those rows into the server
   * render, because "this arrived while you were looking at the list" is still
   * true afterwards.
   *
   * A `clearFresh()` action existed for a while with no caller. Wiring it to
   * "the list has rendered" would have erased the highlight on the very next
   * paint, which is the opposite of what it is for, so it was deleted rather
   * than connected.
   */
  freshEmailIds: string[];
  /**
   * Thread keys the badge has already been incremented for, since the last
   * server-rendered count. Cleared by `setUnreadCount`.
   *
   * The badge counts conversations, not messages, so a second message in a
   * thread must not move it. The store cannot always tell: the baseline
   * arrives as a number, not a set of keys, so it knows only which threads it
   * has seen *live*. The guard is therefore exact for a conversation that
   * arrived live, and no help for a second message in a thread that was
   * already unread when the page rendered — that one still reads one too
   * high.
   *
   * What makes that acceptable is that it is **transient**. Every event
   * schedules the debounced `router.refresh()`, every refresh re-renders the
   * layout, and `RealtimeBridge` reseeds from `folderCounts` on each one — so
   * the number is wrong for a few hundred milliseconds and then is not. That
   * only holds because the reseed fires on a fresh render rather than on a
   * *changed* count: switching this badge to conversations made the server
   * number invariant under exactly the events that move the store, so a
   * value-compared reseed would never have fired and the drift would have been
   * permanent. See the reseed effect in `hooks/use-realtime.ts`.
   */
  countedThreadKeys: string[];
  campaignProgress: Record<string, CampaignProgress>;
  /**
   * Keyed by our own message id.
   *
   * Held here so a thread that is already on screen can show "delivered" the
   * moment Resend says so, without waiting for the debounced
   * `router.refresh()` — which is the difference between a send that feels
   * confirmed and one that feels like it vanished.
   */
  outboundEvents: Record<string, OutboundEvent>;
  lastEventAt: string | null;

  setConnection: (state: ConnectionState) => void;
  setUnreadCount: (count: number) => void;
  apply: (event: RealtimeEvent) => void;
};

/**
 * Live UI state, kept separate from server-rendered data on purpose.
 *
 * Postgres is the source of truth and Server Components render from it. This
 * store holds only the delta since that render — a count nudged up, a set of
 * newly-arrived ids, a campaign's progress — so a refetch can overwrite it
 * without a merge conflict. Trying to keep a full mirror of the inbox in the
 * client is what turns a realtime feature into a cache-invalidation problem.
 */
export const useRealtimeStore = create<RealtimeState>((set) => ({
  connection: "connecting",
  unreadCount: 0,
  freshEmailIds: [],
  countedThreadKeys: [],
  campaignProgress: {},
  outboundEvents: {},
  lastEventAt: null,

  setConnection: (connection) => set({ connection }),
  /**
   * Adopt a server-rendered count, discarding the live bookkeeping behind it.
   *
   * `countedThreadKeys` only ever exists to stop a *second* live message
   * double-counting against the baseline that was current when the first one
   * arrived. A new baseline makes those keys meaningless — the render it came
   * from already counts those conversations — and keeping them would suppress
   * the next legitimate increment for a thread that had gone read and come
   * back. So the reset belongs to the reseed and nowhere else; `freshEmailIds`
   * is the list's "new" highlight and has no bearing on the count.
   */
  setUnreadCount: (unreadCount) => set({ unreadCount, countedThreadKeys: [] }),

  apply: (event) =>
    set((state) => {
      const base = { lastEventAt: event.at };

      switch (event.type) {
        case "inbound.received": {
          // Guard against a duplicate delivery double-counting the badge.
          if (state.freshEmailIds.includes(event.emailId)) return state;

          /**
           * One increment per conversation, not per message.
           *
           * The badge is seeded from `folderCounts`, which counts distinct
           * `thread_key`s. Adding one per arriving message made a busy thread
           * inflate it without bound: three replies to one conversation read
           * as three things to read, and the number only came back to the
           * truth on the next server render.
           */
          const counted = state.countedThreadKeys.includes(event.threadKey);
          return {
            ...base,
            unreadCount: counted ? state.unreadCount : state.unreadCount + 1,
            freshEmailIds: [event.emailId, ...state.freshEmailIds].slice(0, 100),
            countedThreadKeys: counted
              ? state.countedThreadKeys
              : [event.threadKey, ...state.countedThreadKeys].slice(0, 100),
          };
        }
        case "inbound.updated": {
          const readNow = event.status !== "unread";
          const nextUnread =
            typeof event.unreadDelta === "number"
              ? Math.max(0, state.unreadCount + event.unreadDelta)
              : readNow
                ? Math.max(0, state.unreadCount - 1)
                : state.unreadCount;
          return {
            ...base,
            unreadCount: nextUnread,
          };
        }
        case "outbound.updated": {
          /**
           * Never moves backwards.
           *
           * Opens and clicks arrive after — and are weaker than — a bounce,
           * and events can arrive out of order on a retry. A click landing
           * after a bounce must not overwrite the bounce, which is the same
           * rule the SQL applies and for the same reason.
           */
          const previous = state.outboundEvents[event.messageId];
          if (previous && FINAL_EVENTS.has(previous.event) && !FINAL_EVENTS.has(event.event)) {
            return base;
          }

          return {
            ...base,
            outboundEvents: {
              ...state.outboundEvents,
              [event.messageId]: {
                event: event.event,
                at: event.at,
                detail: event.detail ?? null,
              },
            },
          };
        }
        case "campaign.progress": {
          return {
            ...base,
            campaignProgress: {
              ...state.campaignProgress,
              [event.campaignId]: {
                status: event.status,
                sentCount: event.sentCount,
                totalRecipients: event.totalRecipients,
              },
            },
          };
        }
        case "suppression.added":
          return base;
        default:
          return state;
      }
    }),
}));

/** Once one of these has landed, a weaker event cannot displace it. */
const FINAL_EVENTS = new Set(["bounced", "complained", "failed"]);

export const useUnreadCount = () => useRealtimeStore((s) => s.unreadCount);
/** The live delivery state of a message we sent, if the provider has spoken. */
export const useOutboundEvent = (messageId: string) =>
  useRealtimeStore((s) => s.outboundEvents[messageId]);
export const useConnection = () => useRealtimeStore((s) => s.connection);
export const useCampaignProgress = (campaignId: string) =>
  useRealtimeStore((s) => s.campaignProgress[campaignId]);
