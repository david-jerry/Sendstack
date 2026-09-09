"use client";

import { create } from "zustand";

export type NetworkState = "online" | "offline";

type ConnectivityState = {
  network: NetworkState;
  /**
   * True once the connection has dropped at least once.
   *
   * Without it, the banner would have to say "online" on first load — a
   * reassurance nobody asked for, in a bar taking up space at the top of the
   * mailbox. It only earns its place after something went wrong.
   */
  hasDropped: boolean;
  /** Sends handed to the service worker that have not come back yet. */
  queued: number;
  /**
   * When the data now on screen was stored, if it came from the worker's cache.
   *
   * The service worker serves a remembered mailbox when the network cannot
   * answer, which is the difference between an installed app that works on a
   * train and one that shows an apology. The reason this number exists is that
   * the trade only holds if the reader is told: a list of mail with no
   * indication that it is an hour old is the failure the cache was added to
   * avoid, dressed up as a success.
   *
   * Null means everything on screen came from the network.
   */
  servedFromCacheAt: number | null;

  setNetwork: (state: NetworkState) => void;
  enqueue: () => void;
  settleQueued: () => void;
  noteCachedResponse: (storedAt: number) => void;
};

/**
 * Whether the browser thinks it can reach the network, and what is waiting.
 *
 * Separate from `realtime-store`, which tracks the SSE stream. The two are
 * genuinely different questions: the stream can be closed on a perfectly good
 * connection — a serverless timeout, a proxy — and the network can be gone
 * while the last stream event was a second ago. Conflating them produces a
 * banner that cries offline every time a function times out.
 */
export const useConnectivityStore = create<ConnectivityState>((set) => ({
  network: "online",
  hasDropped: false,
  queued: 0,
  servedFromCacheAt: null,

  setNetwork: (network) =>
    set((state) => ({
      network,
      hasDropped: state.hasDropped || network === "offline",
      // Coming back online does not by itself refresh what is on screen, but
      // the next fetch will, and it will come from the network. Holding the
      // stale marker past that point would leave the notice up over live mail.
      servedFromCacheAt: network === "online" ? null : state.servedFromCacheAt,
    })),

  /**
   * Keeps the oldest, not the newest.
   *
   * Several lists can be on screen at once. "Showing mail from 2 minutes ago"
   * when one of the three panels is an hour old understates the problem, and
   * the point of the notice is not to understate it.
   */
  noteCachedResponse: (storedAt) =>
    set((state) => ({
      servedFromCacheAt:
        state.servedFromCacheAt === null ? storedAt : Math.min(state.servedFromCacheAt, storedAt),
    })),

  enqueue: () => set((state) => ({ queued: state.queued + 1 })),
  settleQueued: () => set((state) => ({ queued: Math.max(0, state.queued - 1) })),
}));
