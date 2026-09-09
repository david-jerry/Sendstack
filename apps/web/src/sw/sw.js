/**
 * This app's service worker — the entry, not the implementation.
 *
 * The policy lives in `@sendstack/pwa/sw`; this file exists to hold two things
 * that cannot live in a package: `self.__WB_MANIFEST`, which the build step
 * replaces with the real precache list, and the decisions that are specific to
 * a mail client.
 *
 * Built by `scripts/build-sw.mjs` into `public/sw.js`, which is generated —
 * editing the file in `public/` does nothing.
 */

import { createServiceWorker } from "@sendstack/pwa/sw";
// Bundled in by esbuild, which resolves `.ts` by default. The constant is
// shared with `src/lib/freshness.ts`, which reads the headers this prefix
// names; see that module for why the two must not be separate literals.
import { PWA_CACHE_PREFIX } from "../lib/pwa-cache";

createServiceWorker({
  precache: self.__WB_MANIFEST,
  cachePrefix: PWA_CACHE_PREFIX,
  offlineUrl: "/offline",

  /**
   * Read-only endpoints, listed rather than matched by prefix.
   *
   * These are the four cursor-paginated lists TanStack Query pages through.
   * An allowlist because the alternative cannot be kept correct: `/api/auth`
   * carries session tokens, `/api/compose/send` is a mutation, and a route
   * added next month should be uncached until somebody decides otherwise.
   */
  api: ["/api/inbox/threads", "/api/outbound", "/api/contacts", "/api/campaigns"],

  /** Avatars, logos and attachments — the images a message body points at. */
  media: ["/api/avatars/", "/api/branding/", "/api/attachments/", "/favicon/"],

  /**
   * The two open connections, kept away from every strategy.
   *
   * Wrapping an SSE response in a caching strategy gives a stream that buffers
   * until it closes, which for a realtime stream is never — the inbox simply
   * stops updating, with nothing in the console to say why.
   */
  exclude: (url) =>
    url.pathname === "/api/realtime/stream" || url.pathname === "/api/setup/stream",

  notifications: {
    icon: "/favicon/android-chrome-192x192.png",
    badge: "/favicon/favicon-32x32.png",
    defaultTitle: "New message",
    defaultUrl: "/inbox",
    /** Ten replies to one thread should be one notification, not ten. */
    defaultTag: "sendstack-mail",
  },

  outbox: {
    name: "sendstack-outbox",
    /**
     * The pre-Workbox worker kept queued sends in its own database, under a
     * name Workbox does not look at. Draining it on install is what stops an
     * upgrade silently dropping a reply that was waiting for a connection.
     */
    legacyDatabase: { name: "sendstack-outbox", store: "requests" },
  },
});
