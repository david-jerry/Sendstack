/**
 * A configurable Workbox service worker, as a single function.
 *
 * Imported by the consuming project's own worker entry, which exists only to
 * hold the `__WB_MANIFEST` token — Workbox's `injectManifest` replaces it in
 * the *bundle*, so it has to appear in source somewhere. That entry is three
 * lines; everything else is here.
 *
 * Note that this file never writes that token with its `self.` prefix, in a
 * comment or a string. `injectManifest` refuses to run when it finds more than
 * one match for the exact expression, so a second mention anywhere in the
 * bundle — including in an error message about it — breaks every build that
 * imports this.
 *
 * ## The position this takes
 *
 * Two obvious designs were rejected. Caching nothing but build output is
 * honest and produces an installed app that shows a dead end with no
 * connection — which, on a phone, is most of the time. Caching the API
 * wholesale gives an app that cheerfully shows a week-old inbox as though it
 * were mail.
 *
 * So: **serve what has already been seen, and say how old it is.** Every
 * strategy below is network-first, so a working connection always wins and
 * nothing is served stale while the network can answer. The cache is reached
 * only when the network cannot, and a response that comes from it carries
 * `x-<prefix>-from-cache` and the time it was stored so the UI can tell the
 * reader they are looking at history.
 *
 * The costs that comes with, handled rather than ignored:
 *
 *  - **Private data ends up in Cache Storage.** On a shared device that would
 *    outlive the session, so `purge-private-caches` empties it on sign-out.
 *  - **Credentials, mutations and streams must never be cached.** `api` is an
 *    allowlist, not a denylist: a route added next month is uncached until
 *    somebody decides otherwise.
 *  - **The server almost certainly says `no-store`** on these responses, and
 *    this worker stores them anyway. That is not an oversight. `Cache-Control`
 *    governs the browser's HTTP cache, which is shared, opaque and
 *    unpurgeable, and refusing it there is still right. Cache Storage is none
 *    of those things — this file decides what goes in, for how long, and
 *    signing out empties it.
 */

import { Queue } from "workbox-background-sync";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { clientsClaim } from "workbox-core";
import { ExpirationPlugin } from "workbox-expiration";
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from "workbox-precaching";
import { registerRoute, setCatchHandler } from "workbox-routing";
import { CacheFirst, NetworkFirst } from "workbox-strategies";

const DAY = 24 * 60 * 60;

/**
 * Whether to narrate what the worker is doing, and where.
 *
 * A service worker is the hardest part of a web app to observe: it outlives
 * the page, has no UI, and its console is a separate pane in DevTools that
 * most people never open. So the interesting transitions say so — install,
 * activation, a purge, every outbox outcome — and say it with a prefix that
 * can be filtered on.
 *
 * Off in production, and not configurable: a worker logging on every fetch is
 * noise nobody asked for, and a flag to turn it off is a flag to get wrong.
 * `process.env.NODE_ENV` is replaced by the build step with a literal, so
 * `DEBUG` folds to `false` and the body of `debug()` is eliminated.
 *
 * The call *sites* survive — they still build their message and call a
 * function that does nothing. Measured: it makes no difference to the bundle
 * (65.2 kB either way), so it is left as it is rather than guarded at three
 * dozen call sites for a saving that does not exist.
 */
const DEBUG = process.env.NODE_ENV !== "production";

/**
 * Whether **anything** may be cached at runtime. False in a development build.
 *
 * ## The bug this closes
 *
 * The static-asset route below has always refused to cache
 * `/_next/static/development/…`, because those paths are rebuilt in place and
 * a hit serves yesterday's code. The *content* routes had no such guard — so a
 * development worker cached rendered documents and RSC payloads, and then:
 *
 *  1. a component was edited;
 *  2. the phone requested the page over a tunnel;
 *  3. `NetworkFirst` gave the dev server four seconds, which is not enough
 *     for Next to compile a route on demand behind a tunnel;
 *  4. the worker served the *previous* HTML from `pages`;
 *  5. the freshly-compiled client JS hydrated against it.
 *
 * Which produces exactly this, with the old markup on one side and the new on
 * the other:
 *
 *     Hydration failed because the server rendered HTML didn't match the
 *     client.
 *
 * Note that step 3 needs no network failure. It is not an offline path — a
 * slow dev server is enough, which is why it showed up on a phone and never on
 * a laptop.
 *
 * ## Why this covers build output too
 *
 * The first version of this guard excluded only rendered content, and left
 * static assets cache-first behind a path test for `/_next/static/development/`.
 * That test was written for webpack's dev layout and matches **nothing** under
 * Turbopack, which emits `/_next/static/chunks/apps_web_1anvha4._.js` — a name
 * that is *not* content-hashed and survives edits to the files inside it.
 *
 * Cache-first plus a stable name is the worst possible pair: the first request
 * pins that chunk for thirty days, and every later edit changes the file behind
 * the URL without changing the URL. The server then sends a fresh RSC payload
 * naming client references the pinned chunk does not define, and React says:
 *
 *     Element type is invalid. Received a promise that resolves to: undefined.
 *     Lazy element type must resolve to a class or function.
 *
 * So the rule is the blunt one, and it is the honest one: a development worker
 * caches **nothing** at runtime. Precaching, push and the outbox still work,
 * which is what the development flag exists for.
 *
 * Offline reading therefore needs a production build to test:
 * `pnpm build && pnpm start` behind the same tunnel.
 */
const RUNTIME_CACHING_DEFAULT = !DEBUG;

/**
 * Logs one line, in development only.
 *
 * @param {string} message What happened, in the imperative or the past tense.
 * @param {...unknown} details Anything worth inspecting. Never a request body.
 */
function debug(message, ...details) {
  if (DEBUG) console.info(`[sw] ${message}`, ...details);
}

/**
 * Logs something that went wrong, in every environment.
 *
 * Distinct from `debug` on purpose: a failed cache write or an unreadable
 * legacy queue is worth knowing about on a real device, where there is no
 * development build to reproduce it in.
 *
 * @param {string} message
 * @param {...unknown} details
 */
function warn(message, ...details) {
  console.warn(`[sw] ${message}`, ...details);
}

/**
 * @typedef {object} ServiceWorkerOptions
 * @property {Array<{url: string, revision: string|null}>} precache
 *   The `__WB_MANIFEST` token from the consumer's entry. Required — passing an
 *   empty array is fine, passing nothing is a mistake worth catching.
 * @property {string} [cachePrefix="app"]
 *   Names the caches and the freshness headers. One per project on an origin.
 * @property {string} [offlineUrl="/offline"]
 *   The page a navigation falls back to when nothing is cached for it. Must be
 *   in `precache`, or the fallback is a fallback to nothing.
 * @property {string[]} [api=[]]
 *   Exact same-origin pathnames whose GET responses may be cached. An
 *   allowlist on purpose.
 * @property {string[]} [media=[]]
 *   Path *prefixes* for images, avatars and attachments.
 * @property {boolean} [cacheRscPayloads=true]
 *   Cache Next's client-navigation payloads, so links work offline.
 * @property {boolean} [cacheStaticAssets=true]
 *   Cache the framework's content-hashed build output.
 * @property {boolean} [cacheContent]
 *   Cache rendered documents, navigation payloads, API responses and media.
 *   **Defaults to false in a development bundle**, and turning it on there
 *   will serve stale HTML — see the note on `contentCachingAllowed` below.
 * @property {string} [staticPrefix="/_next/static/"]
 * @property {(url: URL, request: Request) => boolean} [exclude]
 *   Final say. Return true and the worker does not touch the request at all —
 *   for server-sent events, long polls, anything a strategy would buffer.
 * @property {object} [notifications]
 *   Push presentation. Omit to leave push handling out entirely.
 * @property {string} [notifications.icon]
 * @property {string} [notifications.badge]
 * @property {string} [notifications.defaultTitle="New notification"]
 * @property {string} [notifications.defaultUrl="/"]
 * @property {string} [notifications.defaultTag]
 * @property {object} [outbox]
 *   Replay of requests made with no connection. Omit to leave it out.
 * @property {string} [outbox.name]
 * @property {string} [outbox.legacyDatabase]
 *   A pre-Workbox IndexedDB database to drain on install, so an upgrade does
 *   not silently orphan whatever was queued in it.
 */

/**
 * Wires up the worker. Call once, at the top level of the worker entry.
 *
 * @param {ServiceWorkerOptions} options
 */
export function createServiceWorker(options) {
  const {
    precache,
    cachePrefix = "app",
    offlineUrl = "/offline",
    api = [],
    media = [],
    cacheRscPayloads = true,
    cacheStaticAssets = true,
    cacheContent = RUNTIME_CACHING_DEFAULT,
    staticPrefix = "/_next/static/",
    exclude,
    notifications,
    outbox,
  } = options ?? {};

  /**
   * Checked rather than defaulted.
   *
   * Omitting the precache manifest gives a worker that installs cleanly,
   * caches nothing, and has no offline fallback — with no error at any point.
   * That is the single most likely way to misconfigure this, so it is the one
   * thing that throws.
   */
  if (!Array.isArray(precache)) {
    throw new TypeError(
      "createServiceWorker: `precache` must be an array — pass the " +
        "__WB_MANIFEST token from your worker entry, which the build step " +
        "replaces with the real list.",
    );
  }
  if (!/^[a-z0-9-]+$/.test(cachePrefix)) {
    throw new TypeError("createServiceWorker: `cachePrefix` must be lowercase and URL-safe.");
  }

  const CACHE = {
    static: `${cachePrefix}-static`,
    pages: `${cachePrefix}-pages`,
    rsc: `${cachePrefix}-rsc`,
    data: `${cachePrefix}-data`,
    media: `${cachePrefix}-media`,
  };

  /** Everything holding a response derived from a session. Not `static`. */
  const PRIVATE_CACHES = [CACHE.pages, CACHE.rsc, CACHE.data, CACHE.media];

  const CACHED_AT = `x-${cachePrefix}-cached-at`;
  const FROM_CACHE = `x-${cachePrefix}-from-cache`;

  const cacheableApi = new Set(api);
  const mediaPrefixes = [...media];

  // ─── Install and activate ──────────────────────────────────────────────────

  precacheAndRoute(precache);
  cleanupOutdatedCaches();

  const queue = outbox ? createOutbox(outbox) : null;

  debug(
    `configured: prefix "${cachePrefix}", ${precache.length} precached, ` +
      `${cacheableApi.size} cacheable API route(s), ${mediaPrefixes.length} media prefix(es), ` +
      `push ${notifications ? "on" : "off"}, outbox ${queue ? "on" : "off"}, ` +
      `runtime caching ${cacheContent ? "on" : "off"}`,
  );

  self.addEventListener("install", (event) => {
    // A new worker should take over on the next load rather than waiting for
    // every tab to close — for an app left open for days, that is never.
    debug("installing");
    event.waitUntil(
      Promise.all([
        self.skipWaiting(),
        queue && outbox?.legacyDatabase
          ? adoptLegacyOutbox(queue, outbox.legacyDatabase)
          : Promise.resolve(),
      ]),
    );
  });

  self.addEventListener("activate", (event) => {
    debug("activated and claiming clients");

    /**
     * Delete the content caches when content caching is off.
     *
     * Without this, turning it off fixes nothing already installed: a phone
     * that cached rendered HTML under the previous worker keeps those entries
     * for a day, and keeps the disk they occupy indefinitely as the worker
     * updates. `cleanupOutdatedCaches` does not cover them — it versions the
     * *precache* and nothing else.
     *
     * So the guard runs on every activation rather than once. It is cheap
     * (four `caches.delete` calls against caches that usually do not exist)
     * and it is the only thing that repairs an installed copy.
     */
    if (!cacheContent) {
      /**
       * Every cache, including `static`.
       *
       * `PRIVATE_CACHES` is the sign-out set and deliberately spares build
       * output, because that says nothing about anyone. Here the build output
       * is precisely the problem: a pinned dev chunk is what breaks hydration,
       * so an installed copy only recovers if that cache goes too.
       */
      const all = [...PRIVATE_CACHES, CACHE.static];
      event.waitUntil(
        Promise.all(all.map((name) => caches.delete(name))).then((results) => {
          const removed = results.filter(Boolean).length;
          if (removed > 0) {
            warn(
              `runtime caching is off; removed ${removed} stale cache(s) left by a previous ` +
                "worker, including build output that can pin an old chunk",
            );
          }
        }),
      );
    }
  });

  clientsClaim();

  // ─── Freshness ─────────────────────────────────────────────────────────────

  /**
   * Marks what came out of the cache, and when it went in.
   *
   * Without this the page cannot tell a live answer from a remembered one, and
   * the whole design depends on it being able to: data rendered from a
   * week-old cache with no notice is the failure this was meant to avoid.
   */
  const freshness = {
    async cacheWillUpdate({ response }) {
      if (!response || response.status !== 200) return null;
      return withHeader(response, CACHED_AT, new Date().toUTCString());
    },
    async cachedResponseWillBeUsed({ cachedResponse }) {
      if (!cachedResponse) return cachedResponse;
      return withHeader(cachedResponse, FROM_CACHE, "1");
    },
  };

  // ─── Routes ────────────────────────────────────────────────────────────────

  /**
   * Whether any strategy may look at this request at all.
   *
   * Three gates, in the cheapest order. Cross-origin is somebody else's
   * business and caching it would mean caching opaque responses of unknown
   * size. Workbox's `registerRoute` already restricts to GET, so mutations
   * never reach here. And `exclude` is the consumer's final say — the escape
   * hatch that keeps server-sent events out, because a strategy wrapped
   * around an SSE response buffers it until the stream closes, which for a
   * realtime stream is never.
   *
   * @param {URL} url
   * @param {Request} request
   * @returns {boolean}
   */
  const eligible = (url, request) => {
    if (url.origin !== self.location.origin) return false;
    if (exclude && exclude(url, request)) return false;
    return true;
  };

  if (cacheContent && cacheStaticAssets) {
    /**
     * Cache-first, because a content-hashed URL cannot go stale.
     *
     * Unreachable in a development bundle — `cacheContent` is false there, for
     * the reason spelled out on `RUNTIME_CACHING_DEFAULT`. The two path tests
     * below are a second belt for anyone who force-enables caching in
     * development, and are deliberately *not* the primary guard: the
     * `development/` segment they look for is webpack's, and Turbopack does
     * not produce it.
     */
    registerRoute(
      ({ url, request }) =>
        eligible(url, request) &&
        url.pathname.startsWith(staticPrefix) &&
        !url.pathname.includes(`${staticPrefix}development/`) &&
        !url.searchParams.has("__nextDevClientId"),
      new CacheFirst({
        cacheName: CACHE.static,
        plugins: [
          new CacheableResponsePlugin({ statuses: [200] }),
          new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 30 * DAY }),
        ],
      }),
    );
  }

  if (cacheContent && mediaPrefixes.length > 0) {
    /**
     * Network-first despite being effectively immutable.
     *
     * These paths are usually session-checked, and cache-first would keep
     * serving them after the session that was allowed to see them ended.
     * Sign-out purges this cache for the same reason.
     */
    registerRoute(
      ({ url, request }) =>
        eligible(url, request) &&
        mediaPrefixes.some((prefix) => url.pathname.startsWith(prefix)),
      new NetworkFirst({
        cacheName: CACHE.media,
        networkTimeoutSeconds: 8,
        plugins: [
          new CacheableResponsePlugin({ statuses: [200] }),
          new ExpirationPlugin({ maxEntries: 80, maxAgeSeconds: 7 * DAY }),
        ],
      }),
    );
  }

  /**
   * Documents: the last rendered copy of a page already visited.
   *
   * This is the route that makes an installed app usable with no connection.
   * Launching offline is a document navigation to `start_url`, and a hit here
   * is the server-rendered page as it stood when it was last opened.
   *
   * Four seconds, not zero: on a train the connection is not absent, it is
   * bad, and waiting thirty seconds for a page already on the device is worse
   * than showing it and revalidating.
   */
  if (cacheContent) {
    registerRoute(
      ({ url, request }) => eligible(url, request) && request.mode === "navigate",
      new NetworkFirst({
        cacheName: CACHE.pages,
        networkTimeoutSeconds: 4,
        plugins: [
          new CacheableResponsePlugin({ statuses: [200] }),
          new ExpirationPlugin({ maxEntries: 40, maxAgeSeconds: DAY }),
          freshness,
        ],
      }),
    );
  }

  if (cacheContent && cacheRscPayloads) {
    /**
     * React Server Component payloads, so links keep working offline.
     *
     * Without this, launching offline works and then the first tap on a nav
     * link fails — the router fetches a payload rather than a document, and
     * that fetch has nowhere to go.
     *
     * Two details, both load-bearing. **Prefetches are excluded**: a prefetch
     * payload is allowed to be partial — the router asks for loading
     * boundaries rather than the finished tree — so storing one and replaying
     * it for a real navigation is how you get a skeleton that never resolves.
     * And **`ignoreVary`** is what makes a stored payload findable at all:
     * Next varies these on `RSC`, `Next-Router-State-Tree` and
     * `Next-Router-Prefetch`, and the Cache API honours `Vary` unless told not
     * to. The `_rsc` parameter is a hash of that state, so the URL is already
     * a sufficient key.
     *
     * The honest limitation: `_rsc` depends on where the navigation started,
     * so this covers journeys already taken rather than every route reachable
     * from here.
     */
    registerRoute(
      ({ url, request }) =>
        eligible(url, request) &&
        url.searchParams.has("_rsc") &&
        !request.headers.has("next-router-prefetch"),
      new NetworkFirst({
        cacheName: CACHE.rsc,
        networkTimeoutSeconds: 4,
        matchOptions: { ignoreVary: true },
        plugins: [
          new CacheableResponsePlugin({ statuses: [200] }),
          new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: DAY }),
          freshness,
        ],
      }),
    );
  }

  if (cacheContent && cacheableApi.size > 0) {
    /**
     * The listed read endpoints, and only those.
     *
     * Query parameters are part of the cache key, so an offline search only
     * finds what has already been searched for online. That is the honest
     * behaviour: the alternative is a filtered list that silently isn't.
     */
    registerRoute(
      ({ url, request }) => eligible(url, request) && cacheableApi.has(url.pathname),
      new NetworkFirst({
        cacheName: CACHE.data,
        networkTimeoutSeconds: 5,
        plugins: [
          new CacheableResponsePlugin({ statuses: [200] }),
          new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: DAY }),
          freshness,
        ],
      }),
    );
  }

  /**
   * A navigation that missed everything falls back to the offline page.
   *
   * Only documents. An image or a payload that cannot be fetched should fail
   * as itself; answering a `fetch()` with an HTML page produces a parse error
   * somewhere far away from the cause.
   */
  setCatchHandler(async ({ request }) => {
    if (request.destination === "document" || request.mode === "navigate") {
      const offline = await matchPrecache(offlineUrl);
      if (offline) return offline;
    }
    return Response.error();
  });

  // ─── Push ──────────────────────────────────────────────────────────────────

  if (notifications) setUpNotifications(notifications);

  // ─── Messages from the page ────────────────────────────────────────────────

  /**
   * The page's side of the worker, as three messages.
   *
   * `postMessage` rather than a route, because these are commands rather than
   * requests: nothing is fetched and there is no response to return. The
   * contract is small and stable on purpose — it is the one part of this file
   * a consuming app writes code against.
   *
   *  - `purge-private-caches` — on sign-out. See `purgePrivateCaches`.
   *  - `queue-request` — hand over a request to replay when the network is
   *    back. `{ type, request: { url, method?, headers?, body? } }`.
   *  - `flush-queue` — drain now. For the browsers with no Background Sync.
   *
   * Anything else is ignored rather than rejected: an older page talking to a
   * newer worker should degrade, not throw.
   */
  self.addEventListener("message", (event) => {
    const message = event.data ?? {};

    debug(`message: ${message.type ?? "(none)"}`);

    if (message.type === "purge-private-caches") {
      event.waitUntil(purgePrivateCaches(PRIVATE_CACHES));
      return;
    }

    if (!queue) return;

    if (message.type === "queue-request") {
      const { url, method, headers, body } = message.request ?? {};
      if (!url) {
        warn("queue-request arrived with no url; ignoring");
        return;
      }
      debug(`outbox: queued ${method ?? "POST"} ${url}`);
      event.waitUntil(
        queue.pushRequest({
          /**
           * Resolved against this origin rather than left relative.
           *
           * `new Request("/api/…")` does resolve against the worker's scope in
           * a browser, so this was not broken — but it depended on an implicit
           * base that is invisible at the call site, and the page sends a path
           * rather than a URL. Being explicit also means the handler can be
           * tested outside a browser, which is how the dependence was noticed.
           */
          request: new Request(new URL(url, self.location.origin), {
            method: method ?? "POST",
            headers: headers ?? { "Content-Type": "application/json" },
            body,
            credentials: "same-origin",
          }),
        }),
      );
      return;
    }

    if (message.type === "flush-queue") {
      // Fired from the page's `online` event, for the browsers with no
      // Background Sync — Safari, most notably.
      event.waitUntil(drain(queue).catch(() => {}));
    }
  });
}

/**
 * A copy of `response` with one header added.
 *
 * A `Response`'s headers are immutable once it exists, so "adding" one means
 * constructing a new `Response` around the same body. The body is read through
 * `clone()` rather than directly: the original is still on its way to the page
 * or to `cache.put`, and reading a body locks it.
 *
 * `blob()` rather than `text()` because these responses are not all text —
 * `media` holds images and PDFs, and decoding those as UTF-8 would corrupt
 * them silently.
 *
 * @param {Response} response
 * @param {string} name Header name to set.
 * @param {string} value
 * @returns {Promise<Response>} A new response carrying the extra header.
 */
async function withHeader(response, name, value) {
  const headers = new Headers(response.headers);
  headers.set(name, value);
  return new Response(await response.clone().blob(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Everything holding a person's data, deleted.
 *
 * Sign-out is the only moment this is right, and it is the moment it is
 * necessary: caching pages and responses means the last screen somebody read
 * is on the device until it expires, which on a shared laptop is the next
 * person's problem. Build output and the offline page stay — neither says
 * anything about anyone.
 */
/**
 * Deletes the named caches and tells the pages it is done.
 *
 * `caches.delete` resolves `false` for a cache that was never created, which
 * is not a failure — a session that never went offline has nothing to purge —
 * so the results are counted for the log rather than checked.
 *
 * @param {string[]} names Cache names. Never the static one; see `PRIVATE_CACHES`.
 * @returns {Promise<void>}
 */
async function purgePrivateCaches(names) {
  const deleted = await Promise.all(names.map((name) => caches.delete(name)));
  debug(`purged ${deleted.filter(Boolean).length} of ${names.length} private cache(s)`);
  await broadcast({ type: "private-caches-purged" });
}

/**
 * Sends a message to every open window of this origin.
 *
 * The worker cannot show a toast, so anything a person should be told about is
 * posted to the pages instead. `includeUncontrolled` matters: a tab loaded
 * before this worker activated is not yet controlled by it, and skipping those
 * would mean the first tab after an upgrade hears nothing.
 *
 * @param {{type: string} & Record<string, unknown>} message
 * @returns {Promise<void>}
 */
async function broadcast(message) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  debug(`broadcasting ${message.type} to ${windows.length} window(s)`);
  for (const client of windows) client.postMessage(message);
}

/**
 * Registers the two push listeners.
 *
 * Called only when the consumer passed a `notifications` option, so a project
 * that does not use push ships no push handlers at all rather than handlers
 * that fire and show a default title nobody configured.
 *
 * @param {object} options
 * @param {string} [options.icon] Large icon, 192px square is the usual size.
 * @param {string} [options.badge] Monochrome glyph for the Android status bar.
 * @param {string} [options.defaultTitle] Used when the payload has none.
 * @param {string} [options.defaultUrl] Where a tap lands with no `url`.
 * @param {string} [options.defaultTag] Collapses repeats; see below.
 * @returns {void}
 */
function setUpNotifications({
  icon,
  badge,
  defaultTitle = "New notification",
  defaultUrl = "/",
  defaultTag,
}) {
  self.addEventListener("push", (event) => {
    /**
     * A push with no readable payload still shows something.
     *
     * Browsers require a *visible* notification for every push a subscription
     * receives; swallowing one silently can cost the subscription. So a
     * payload that fails to parse becomes a generic notification rather than
     * nothing at all.
     */
    let payload = {};
    try {
      payload = event.data ? event.data.json() : {};
    } catch {
      payload = {};
    }

    event.waitUntil(
      self.registration.showNotification(payload.title ?? defaultTitle, {
        body: payload.body ?? "",
        ...(icon ? { icon } : {}),
        ...(badge ? { badge } : {}),
        /**
         * Replaces rather than stacks. Ten notifications about one thing
         * should be one notification, so the tag is that thing.
         */
        ...(payload.tag ?? defaultTag ? { tag: payload.tag ?? defaultTag } : {}),
        renotify: true,
        data: { url: payload.url ?? defaultUrl },
        timestamp: Date.now(),
      }),
    );
  });

  /**
   * Tapping a notification lands on the thing it was about.
   *
   * Four cases, in the order they are tried, because the obvious
   * implementation gets three of them wrong:
   *
   * 1. **A window already showing the target** — focus it and stop. Navigating
   *    a window to the URL it is already on reloads it, which throws away
   *    whatever the reader had scrolled to or typed.
   * 2. **A window on this origin** — focus it, then navigate. Reusing it is
   *    what stops a tap leaving somebody with two copies of the app.
   * 3. **`navigate()` refused** — it rejects for a client this worker does not
   *    control, which is the normal state of a tab that was open before the
   *    worker activated. Silently doing nothing there is the bug this branch
   *    exists for: the notification closes and nothing happens. Falling back
   *    to a new window is worse than reuse and much better than nothing.
   * 4. **No window at all** — the usual case for a notification, since the
   *    point of push is that the app was closed.
   *
   * `event.notification.close()` first, unconditionally: a notification left
   * on screen after a tap reads as an app that did not respond.
   */
  self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const target = event.notification.data?.url ?? defaultUrl;
    const absolute = new URL(target, self.location.origin);

    event.waitUntil(
      (async () => {
        const windows = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });

        const sameOrigin = windows.filter(
          (client) => new URL(client.url).origin === self.location.origin,
        );

        // 1. Already there.
        const showing = sameOrigin.find(
          (client) => new URL(client.url).pathname === absolute.pathname,
        );
        if (showing) {
          debug(`notificationclick: focusing the window already on ${absolute.pathname}`);
          await showing.focus();
          return;
        }

        // 2 and 3. Reuse a window if one will let us.
        for (const client of sameOrigin) {
          try {
            await client.focus();
            if (typeof client.navigate === "function") {
              await client.navigate(absolute.href);
              debug(`notificationclick: navigated an open window to ${absolute.pathname}`);
              return;
            }
          } catch (error) {
            warn("notificationclick: could not reuse an open window", error);
            break;
          }
        }

        // 4. Nothing to reuse.
        debug(`notificationclick: opening a window at ${absolute.pathname}`);
        await self.clients.openWindow(absolute.href);
      })(),
    );
  });
}

/**
 * Requests that were attempted with no connection.
 *
 * `workbox-background-sync` owns the durable store and the Background Sync
 * registration. What it does not own is the policy, so `drain` is written out
 * rather than left to the default replay:
 *
 *  - a **4xx** is final. The request itself is wrong, and replaying it on
 *    every reconnect would retry forever;
 *  - a **5xx, 408, 429 or a network failure** goes back on the front of the
 *    queue and stops the drain, so order is preserved and the next wake-up
 *    tries again;
 *  - either way the page is told, because a notification is the page's job and
 *    the request may have gone out while the tab was closed.
 */
/**
 * Creates the durable queue and registers its Background Sync handler.
 *
 * Must be called at worker startup, not lazily: constructing a `Queue` is what
 * attaches the `sync` listener, and a listener added after the event loop has
 * settled never receives the wake-up the browser already scheduled.
 *
 * @param {object} options
 * @param {string} [options.name] IndexedDB queue name. One per project.
 * @returns {import("workbox-background-sync").Queue}
 */
function createOutbox({ name = "outbox" }) {
  return new Queue(name, { onSync: ({ queue }) => drain(queue) });
}

/**
 * The drain in progress, if any. Module-level on purpose: see `drain`.
 *
 * @type {Promise<void> | null}
 */
let draining = null;

/**
 * Whether a response means "try this exact request again later".
 *
 * 5xx is the server failing; 408 is the server giving up on a slow upload,
 * which on a phone that has just regained a bar of signal is the common case;
 * 429 is the server asking for exactly the pause a later sync provides. Every
 * other status is an answer, and an answer is final — replaying a 400 on
 * every reconnect would retry forever.
 *
 * @param {Response} response
 */
function isRetryable(response) {
  return response.status >= 500 || response.status === 408 || response.status === 429;
}

/**
 * Replays the queue, oldest first, and stops at the first retryable failure.
 *
 * Shared by the Background Sync callback and the `flush-queue` message, so the
 * policy is identical whichever woke the worker. They can also fire *together*
 * — the page posts `flush-queue` from its `online` event at the same moment
 * the browser fires `sync` — and two drains interleaving over one durable
 * queue is how a request shifted by one loop and re-queued by the other got
 * sent twice. So a second call while one is running joins the running one
 * rather than starting its own; both callers see the same outcome.
 *
 * The loop `shift`s rather than iterating a snapshot, because the queue is
 * durable and the worker can be killed mid-drain: a request already sent must
 * be gone from IndexedDB before the next one is attempted, or a restart would
 * send it twice. `unshiftRequest` on failure puts it back at the *front*,
 * which is what preserves order.
 *
 * Throwing is meaningful here. Background Sync treats a rejected `onSync` as
 * "not done" and schedules another attempt with its own backoff; returning
 * normally tells the browser the queue is empty and drops the registration.
 *
 * @param {import("workbox-background-sync").Queue} queue
 * @returns {Promise<void>}
 * @throws When the network is unreachable or the server answered with a
 *   retryable status (see `isRetryable`), so the browser retries later.
 */
function drain(queue) {
  if (draining) {
    debug("outbox: drain already running; joining it");
    return draining;
  }
  draining = replay(queue).finally(() => {
    draining = null;
  });
  return draining;
}

/**
 * The loop behind `drain`. Never called directly — the guard above is what
 * makes it safe to run against a queue that two events want to empty.
 *
 * @param {import("workbox-background-sync").Queue} queue
 */
async function replay(queue) {
  let entry;
  let sent = 0;

  while ((entry = await queue.shiftRequest())) {
    let response;
    try {
      response = await fetch(entry.request.clone());
    } catch (error) {
      // Still offline. Put it back and let the next sync event try.
      await queue.unshiftRequest(entry);
      debug(`outbox: still offline after ${sent} sent; ${entry.request.url} requeued`);
      throw error;
    }

    if (isRetryable(response)) {
      await queue.unshiftRequest(entry);
      warn(`outbox: ${entry.request.url} returned ${response.status}; requeued for retry`);
      throw new Error(`Queued request failed with ${response.status}; will retry.`);
    }

    if (response.ok) {
      sent += 1;
      debug(`outbox: sent ${entry.request.url}`);
    } else {
      // 4xx: the request itself is wrong. Dropped rather than retried forever.
      warn(`outbox: ${entry.request.url} rejected with ${response.status}; dropped, not retried`);
    }

    await broadcast({
      type: response.ok ? "queued-request-sent" : "queued-request-failed",
      status: response.status,
    });
  }

  debug(`outbox: drained, ${sent} request(s) sent`);
}

/**
 * Moves anything left in a pre-Workbox outbox into this one.
 *
 * A hand-rolled worker keeps queued requests in its own IndexedDB database,
 * under a name Workbox does not look at. Without this step, upgrading an
 * installed copy while something was waiting for a connection drops it
 * silently — the worst available outcome, and the one nobody would ever report
 * because there is nothing to see.
 *
 * Runs once at install and then removes the old database, so the next install
 * finds nothing and does nothing.
 */
/**
 * Moves anything left in a pre-Workbox outbox into this one.
 *
 * @param {import("workbox-background-sync").Queue} queue The new queue.
 * @param {object} legacy
 * @param {string} legacy.name The old IndexedDB database name.
 * @param {string} [legacy.store] Object store inside it. Defaults to `requests`.
 * @returns {Promise<void>} Always resolves; a failure is logged, not thrown.
 */
async function adoptLegacyOutbox(queue, { name, store = "requests" }) {
  try {
    const entries = await new Promise((resolve, reject) => {
      // `onupgradeneeded` firing means the database did not exist. Abort
      // rather than create the very thing being retired.
      const open = indexedDB.open(name, 1);
      let created = false;
      open.onupgradeneeded = () => {
        created = true;
        open.transaction?.abort();
      };
      open.onerror = () => (created ? resolve([]) : reject(open.error));
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains(store)) {
          db.close();
          resolve([]);
          return;
        }
        const request = db.transaction(store, "readonly").objectStore(store).getAll();
        request.onsuccess = () => {
          db.close();
          resolve(request.result ?? []);
        };
        request.onerror = () => {
          db.close();
          reject(request.error);
        };
      };
    });

    for (const value of entries) {
      if (!value?.url) continue;
      await queue.pushRequest({
        // Same reason as `queue-request`: an explicit base, so a stored path
        // resolves the same way wherever this runs.
        request: new Request(new URL(value.url, self.location.origin), {
          method: value.method ?? "POST",
          headers: value.headers ?? { "Content-Type": "application/json" },
          body: value.body,
          credentials: "same-origin",
        }),
      });
    }

    if (entries.length > 0) {
      // Worth a real warning rather than a debug line: it means an upgrade
      // happened while something was queued, which is the case this exists
      // for and the one nobody would otherwise ever see.
      warn(`migrated ${entries.length} queued request(s) out of the legacy "${name}" database`);
    }

    indexedDB.deleteDatabase(name);
  } catch (error) {
    // A queue that cannot be read is not a reason to refuse to install; the
    // alternative is an app with no worker at all.
    warn(`could not migrate the legacy "${name}" outbox; leaving it in place`, error);
  }
}
