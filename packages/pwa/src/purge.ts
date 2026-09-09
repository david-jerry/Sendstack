"use client";

/**
 * Deletes the worker's cached copies of whatever the signed-in person could
 * see. Call this on sign-out.
 *
 * The reason it exists: caching rendered pages, navigation payloads and API
 * responses is what makes an app work with no connection, and on a shared
 * device it is also what hands the next person the last screen somebody read —
 * served from disk, with no session, and with no request the server could
 * refuse. Signing out has to take it with them.
 *
 * Deliberately not awaited and deliberately unable to throw. Sign-out must not
 * be the thing that fails because a cache could not be opened; the session is
 * already gone server-side by the time this runs, and every private cache the
 * worker keeps expires within a day regardless.
 */
export function purgeCachedData(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  void navigator.serviceWorker.ready
    .then((registration) => {
      registration.active?.postMessage({ type: "purge-private-caches" });
    })
    .catch(() => {
      // No worker registered — nothing was cached, so nothing to purge.
    });
}
