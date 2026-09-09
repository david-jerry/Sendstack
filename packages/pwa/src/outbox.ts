"use client";

/**
 * Handing a request to the service worker when there is no network.
 *
 * The alternative — refusing and asking the user to come back — loses the one
 * thing a phone is good for: writing something on a train and having it go out
 * when the tunnel ends. The worker holds the request in IndexedDB, so it
 * survives the tab closing and the phone locking, and replays it when the
 * browser reports a network again.
 *
 * Deliberately a `fetch`-shaped request rather than a Server Action call:
 * action ids are per-build and their bodies are opaque, so a queued action is
 * a message that can never be replayed. Give the worker a real route.
 */

/** A request the worker can rebuild from scratch after a restart. */
export type QueueableRequest = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  /** Already serialised: this crosses `postMessage` and lands in IndexedDB. */
  body?: string;
};

/**
 * Whether there is a worker to hand a request to.
 *
 * `controller` rather than `ready`, deliberately: a worker can be registered
 * and activating without yet controlling this page, and a request posted to
 * one that does not control the page goes nowhere. False on a first visit
 * (the worker registers after `load`), in a browser without service workers,
 * and in development unless the flag is set — so the caller must always have
 * a fallback that keeps the user's text.
 */
export function canQueue(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    Boolean(navigator.serviceWorker.controller)
  );
}

/**
 * Whether this failure was the network rather than the server.
 *
 * A rejected message must not be queued — it would be replayed on every
 * reconnect and never succeed. `fetch` rejects with a `TypeError` when it
 * cannot reach the host at all, which together with `navigator.onLine` is as
 * close as the platform gets to telling the two apart.
 */
export function looksOffline(error: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  return error instanceof TypeError;
}

/**
 * Queue a request for the service worker to replay.
 *
 * Returns false when there is no worker to hand it to — a first visit, a
 * browser without service workers, or development, where the worker is often
 * deliberately not registered. The caller then falls back to keeping the draft
 * locally and saying so, which is the part a package cannot do for you.
 */
export async function queueRequest(request: QueueableRequest): Promise<boolean> {
  if (!canQueue()) return false;

  const registration = await navigator.serviceWorker.ready.catch(() => null);
  const worker = registration?.active;
  if (!worker) return false;

  worker.postMessage({
    type: "queue-request",
    request: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...request,
    },
  });

  return true;
}

/**
 * Asks the worker to replay its queue now.
 *
 * Background Sync does this on its own, but only Chromium implements it — so
 * on Safari and Firefox this call, from the page's `online` event, is the only
 * thing that replays a queued request.
 */
export async function flushQueue(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  registration?.active?.postMessage({ type: "flush-queue" });
}
