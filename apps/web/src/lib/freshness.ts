"use client";

/**
 * This app's side of the service worker's cache.
 *
 * `@sendstack/pwa` reads the freshness headers and asks the worker to purge;
 * neither knows about this app's state. That split is deliberate — the package
 * has no business reaching into somebody's store — so the wiring lives here.
 */

import { purgeCachedData, readFreshness } from "@sendstack/pwa";
import { PWA_CACHE_PREFIX } from "@/lib/pwa-cache";
import { useConnectivityStore } from "@/stores/connectivity-store";

/**
 * Records that a list was served from cache, so the banner can say so.
 *
 * Called from the fetch layer rather than from a component, because the fact
 * belongs to the response and there is exactly one place every list response
 * passes through. A store write outside React is fine here — this runs inside
 * a query function, not a render.
 */
export function noteFreshness(response: Response): void {
  const freshness = readFreshness(response, PWA_CACHE_PREFIX);
  if (!freshness) return;
  useConnectivityStore.getState().noteCachedResponse(freshness.storedAt);
}

/**
 * Deletes the worker's copy of this person's mail. Called on sign-out.
 *
 * The worker keeps rendered mailbox pages, list responses and attachments so
 * the app works with no connection. On a shared laptop that would mean the
 * next person to open it gets the last inbox somebody read, served from disk,
 * without a session and without a request the server could refuse.
 */
export const purgeCachedMail = purgeCachedData;
