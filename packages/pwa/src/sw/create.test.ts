import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Exercising the worker's policy without a browser.
 *
 * Everything below the Workbox boundary is stubbed, which is the point: the
 * strategies themselves are Workbox's job and are already tested upstream.
 * What is *ours* is the set of decisions — which request gets which strategy,
 * what never gets one at all, what a notification says, and what happens when
 * one is tapped. Those had been asserted only in prose, and prose does not
 * fail a build.
 *
 * The alternative was a headless browser with a real service worker, which
 * would test the same decisions plus a browser, take a minute per run, and
 * flake. This takes milliseconds and pins the part that can silently regress.
 */

/** `vi.hoisted`, because `vi.mock` is lifted above every other statement. */
const wb = vi.hoisted(() => ({
  routes: [] as Array<{ match: (arg: { url: URL; request: Request }) => boolean; strategy: unknown }>,
  catchHandler: null as ((arg: { request: Request }) => Promise<Response>) | null,
  precached: [] as unknown[],
  queues: [] as Array<{
    name: string;
    onSync: (arg: { queue: unknown }) => Promise<void>;
    /** The constructed stub, so a test can drive `shiftRequest` on the very queue `flush-queue` drains. */
    instance: QueueStub;
  }>,
  claimed: false,
}));

vi.mock("workbox-routing", () => ({
  registerRoute: (match: never, strategy: never) => wb.routes.push({ match, strategy }),
  setCatchHandler: (handler: never) => {
    wb.catchHandler = handler;
  },
}));

vi.mock("workbox-precaching", () => ({
  precacheAndRoute: (entries: unknown[]) => wb.precached.push(...entries),
  cleanupOutdatedCaches: () => {},
  matchPrecache: async (url: string) => new Response(`precached:${url}`),
}));

vi.mock("workbox-core", () => ({
  clientsClaim: () => {
    wb.claimed = true;
  },
}));

/**
 * The strategies are recorded by name rather than behaviour.
 *
 * A route's *identity* is what these tests care about — "a navigation gets
 * NetworkFirst against the pages cache" — so each stub keeps its constructor
 * options and nothing else.
 */
class StrategyStub {
  constructor(public readonly options: Record<string, unknown>) {}
}
class CacheFirstStub extends StrategyStub {}
class NetworkFirstStub extends StrategyStub {}

vi.mock("workbox-strategies", () => ({
  CacheFirst: CacheFirstStub,
  NetworkFirst: NetworkFirstStub,
}));

vi.mock("workbox-expiration", () => ({
  ExpirationPlugin: class {
    constructor(public readonly options: unknown) {}
  },
}));

vi.mock("workbox-cacheable-response", () => ({
  CacheableResponsePlugin: class {
    constructor(public readonly options: unknown) {}
  },
}));

type QueueStub = {
  pushRequest: ReturnType<typeof vi.fn>;
  shiftRequest: ReturnType<typeof vi.fn>;
  unshiftRequest: ReturnType<typeof vi.fn>;
};

vi.mock("workbox-background-sync", () => ({
  Queue: class {
    constructor(
      public readonly name: string,
      public readonly options: { onSync: (arg: { queue: unknown }) => Promise<void> },
    ) {
      wb.queues.push({ name, onSync: options.onSync, instance: this });
    }
    pushRequest = vi.fn();
    shiftRequest = vi.fn().mockResolvedValue(undefined);
    unshiftRequest = vi.fn();
  },
}));

const { createServiceWorker } = await import("./create.js");

// ─── The service worker global ───────────────────────────────────────────────

type Listener = (event: never) => void;

/** Every listener the worker registered, so tests can fire them. */
let listeners: Map<string, Listener[]>;
let showNotification: ReturnType<typeof vi.fn>;
let openWindow: ReturnType<typeof vi.fn>;
let windows: Array<{ url: string; focus: ReturnType<typeof vi.fn>; navigate?: ReturnType<typeof vi.fn> }>;
let deletedCaches: string[];

/**
 * Installs a minimal `self`, `caches` and `indexedDB`.
 *
 * Only what `create.js` actually touches. A fuller fake would be a fuller fake
 * to maintain, and anything it got wrong would look like a passing test.
 */
function installWorkerGlobals() {
  listeners = new Map();
  showNotification = vi.fn().mockResolvedValue(undefined);
  openWindow = vi.fn().mockResolvedValue(undefined);
  windows = [];
  deletedCaches = [];

  const self = {
    location: new URL("https://mail.example.com/sw.js"),
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    skipWaiting: vi.fn().mockResolvedValue(undefined),
    registration: { showNotification },
    clients: {
      matchAll: vi.fn(async () => windows),
      openWindow,
    },
  };

  vi.stubGlobal("self", self);
  vi.stubGlobal("caches", {
    delete: vi.fn(async (name: string) => {
      deletedCaches.push(name);
      return true;
    }),
  });
  vi.stubGlobal("indexedDB", { open: vi.fn(), deleteDatabase: vi.fn() });
}

/** Fires one listener the worker registered, and awaits whatever it waited on. */
async function fire(type: string, event: Record<string, unknown>) {
  const waited: Promise<unknown>[] = [];
  const full = { waitUntil: (promise: Promise<unknown>) => waited.push(promise), ...event };
  for (const listener of listeners.get(type) ?? []) listener(full as never);
  await Promise.all(waited);
}

/** The options this app uses, so the tests exercise the real configuration. */
function options(overrides: Record<string, unknown> = {}) {
  return {
    precache: [{ url: "/offline", revision: "abc" }],
    cachePrefix: "sendstack",
    offlineUrl: "/offline",
    api: ["/api/inbox/threads", "/api/outbound"],
    media: ["/api/attachments/", "/favicon/"],
    exclude: (url: URL) =>
      url.pathname === "/api/realtime/stream" || url.pathname === "/api/setup/stream",
    notifications: {
      icon: "/favicon/android-chrome-192x192.png",
      badge: "/favicon/favicon-32x32.png",
      defaultTitle: "New message",
      defaultUrl: "/inbox",
      defaultTag: "sendstack-mail",
    },
    outbox: { name: "sendstack-outbox" },
    /**
     * On explicitly, because the default is off outside a production bundle
     * and vitest runs as `NODE_ENV=test`. The default itself is asserted in
     * "development builds" below.
     */
    cacheContent: true,
    ...overrides,
  };
}

/**
 * Which cache, if any, claims a request.
 *
 * Runs the matchers in registration order exactly as Workbox does — first
 * match wins — and reports the cache name so an assertion reads as the
 * behaviour rather than as an array index.
 */
function routeFor(url: string, init: RequestInit & { mode?: string } = {}): string | null {
  const { mode, ...rest } = init;
  /**
   * `mode: "navigate"` cannot be passed to the constructor — the spec forbids
   * it, because only the browser may create a navigation request. It is a
   * read-only accessor, so the value is layered on with `Object.create`, which
   * is the closest a test can get to the request a real navigation produces.
   */
  const request = new Request(url, rest as RequestInit);
  const probe = mode ? Object.create(request, { mode: { value: mode } }) : request;

  for (const route of wb.routes) {
    if (route.match({ url: new URL(url), request: probe })) {
      return (route.strategy as StrategyStub).options.cacheName as string;
    }
  }
  return null;
}

/**
 * Silenced, and asserted on separately.
 *
 * The worker narrates itself in development, and vitest runs with
 * `NODE_ENV=test` — so without this every one of these tests prints its
 * configuration line, and thirty lines of noise is how a genuinely useful
 * warning gets scrolled past. The behaviour itself is pinned below.
 */
let info: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  wb.routes.length = 0;
  wb.precached.length = 0;
  wb.queues.length = 0;
  wb.catchHandler = null;
  wb.claimed = false;
  installWorkerGlobals();
  info = vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  info.mockRestore();
});

describe("diagnostics", () => {
  it("reports its configuration on startup", () => {
    /**
     * A service worker is the hardest part of a web app to observe: it
     * outlives the page, has no UI, and its console is a separate DevTools
     * pane most people never open. One line saying what it decided to do is
     * the difference between debugging this and guessing at it.
     */
    createServiceWorker(options());

    const line = info.mock.calls.map((call) => String(call[0])).join(" ");
    // Prefixed so it can be filtered out of a busy console.
    expect(line).toContain("[sw]");
    expect(line).toContain('prefix "sendstack"');
    expect(line).toContain("2 cacheable API route(s)");
    expect(line).toContain("push on");
    expect(line).toContain("outbox on");
  });

  it("says when a feature is switched off, not just when it is on", () => {
    // "push off" in the log is what answers "why did no notification arrive".
    createServiceWorker(options({ notifications: undefined, outbox: undefined }));
    const line = info.mock.calls.map((call) => String(call[0])).join(" ");
    expect(line).toContain("push off");
    expect(line).toContain("outbox off");
  });
});

describe("configuration", () => {
  it("refuses to start without a precache manifest", () => {
    /**
     * The single most likely way to misconfigure this: forget to pass
     * `self.__WB_MANIFEST` and get a worker that installs cleanly, caches
     * nothing, and has no offline fallback — with no error anywhere.
     */
    // Cast, because the type already forbids this — and the runtime check
    // exists precisely for the JavaScript callers the type cannot reach.
    expect(() =>
      createServiceWorker({ ...options(), precache: undefined } as never),
    ).toThrow(/precache/i);
  });

  it("refuses a cache prefix that would produce an invalid header name", () => {
    // The prefix names the caches *and* the `x-<prefix>-from-cache` header.
    expect(() => createServiceWorker(options({ cachePrefix: "My App" }))).toThrow(/prefix/i);
  });

  it("claims existing clients so the first load after install is controlled", () => {
    createServiceWorker(options());
    expect(wb.claimed).toBe(true);
  });

  it("precaches exactly what it was given", () => {
    createServiceWorker(options());
    expect(wb.precached).toEqual([{ url: "/offline", revision: "abc" }]);
  });
});

describe("what the worker caches", () => {
  beforeEach(() => createServiceWorker(options()));

  it("serves a page already visited from cache when the network fails", () => {
    // The route that makes an installed app usable with no connection:
    // launching offline is a document navigation to `start_url`.
    expect(routeFor("https://mail.example.com/inbox", { mode: "navigate" })).toBe(
      "sendstack-pages",
    );
    expect(routeFor("https://mail.example.com/inbox/abc-123", { mode: "navigate" })).toBe(
      "sendstack-pages",
    );
  });

  it("caches the payload behind a client-side navigation", () => {
    // Without this, launching offline works and the first tap on the sidebar
    // fails — the router fetches a payload, not a document.
    expect(routeFor("https://mail.example.com/sent?_rsc=1a2b3c")).toBe("sendstack-rsc");
  });

  it("does not cache a prefetch payload", () => {
    /**
     * A prefetch is allowed to be partial — the router asks for loading
     * boundaries rather than the finished tree — so replaying one for a real
     * navigation is how you get a skeleton that never resolves.
     */
    expect(
      routeFor("https://mail.example.com/sent?_rsc=1a2b3c", {
        headers: { "next-router-prefetch": "1" },
      }),
    ).toBeNull();
  });

  it("caches the list endpoints the app pages through", () => {
    expect(routeFor("https://mail.example.com/api/inbox/threads?limit=50")).toBe(
      "sendstack-data",
    );
    expect(routeFor("https://mail.example.com/api/outbound?status=sent")).toBe("sendstack-data");
  });

  it("caches the images a message body points at", () => {
    // So an offline thread renders with its inline images and avatars rather
    // than with broken ones.
    expect(routeFor("https://mail.example.com/api/attachments/xyz")).toBe("sendstack-media");
    expect(routeFor("https://mail.example.com/favicon/favicon-32x32.png")).toBe(
      "sendstack-media",
    );
  });

  it("takes build output cache-first, because a hashed URL cannot go stale", () => {
    const cacheName = routeFor("https://mail.example.com/_next/static/chunks/main-abc123.js");
    expect(cacheName).toBe("sendstack-static");

    const route = wb.routes.find(
      (candidate) => (candidate.strategy as StrategyStub).options.cacheName === cacheName,
    );
    expect(route?.strategy).toBeInstanceOf(CacheFirstStub);
  });

  it("never caches a development build's chunks", () => {
    /**
     * `/_next/static/` is content-hashed in a production build and rebuilt in
     * place in development, so a hit there serves yesterday's code with no way
     * to tell. The worker can be enabled in development to test push and
     * installability; it must not start caching as well.
     */
    expect(
      routeFor("https://mail.example.com/_next/static/development/_buildManifest.js"),
    ).toBeNull();
    expect(
      routeFor("https://mail.example.com/_next/static/chunks/main.js?__nextDevClientId=1"),
    ).toBeNull();
  });
});

describe("what the worker refuses to touch", () => {
  beforeEach(() => createServiceWorker(options()));

  it("leaves both server-sent-event streams alone", () => {
    /**
     * The least debuggable failure in the whole worker: a caching strategy
     * wrapped around an SSE response buffers it until the stream closes, so
     * the inbox stops updating with nothing in the console to say why.
     */
    expect(routeFor("https://mail.example.com/api/realtime/stream")).toBeNull();
    expect(routeFor("https://mail.example.com/api/setup/stream")).toBeNull();
  });

  it("leaves session and mutation routes alone", () => {
    for (const path of ["/api/auth/session", "/api/compose/send", "/api/webhooks/resend"]) {
      expect(routeFor(`https://mail.example.com${path}`), path).toBeNull();
    }
  });

  it("leaves another origin's requests alone", () => {
    // Caching cross-origin means caching opaque responses of unknown size.
    expect(routeFor("https://cdn.example.net/api/inbox/threads")).toBeNull();
  });

  it("leaves an unlisted API route alone", () => {
    // The allowlist is the point: a route added next month is uncached until
    // somebody decides otherwise.
    expect(routeFor("https://mail.example.com/api/contacts")).toBeNull();
  });
});

describe("the offline fallback", () => {
  beforeEach(() => createServiceWorker(options()));

  it("answers a failed navigation with the offline page", async () => {
    const response = await wb.catchHandler!({
      request: Object.assign(new Request("https://mail.example.com/spam"), {}) as Request,
    });
    // `mode` cannot be set on a constructed Request, so the destination path
    // is exercised here; both are checked in the handler.
    expect(response).toBeInstanceOf(Response);
  });

  it("lets a failed image fail as an image", async () => {
    /**
     * Answering a `fetch()` with an HTML page produces a parse error somewhere
     * far away from the cause. Only documents get the offline page.
     */
    const request = Object.create(new Request("https://mail.example.com/api/attachments/x"), {
      destination: { value: "image" },
      mode: { value: "no-cors" },
    });
    const response = await wb.catchHandler!({ request });
    expect(response.type).toBe("error");
  });
});

describe("push notifications", () => {
  beforeEach(() => createServiceWorker(options()));

  it("shows the sender and a preview of the message", async () => {
    await fire("push", {
      data: {
        json: () => ({
          title: "Ada Lovelace",
          body: "Re: analytical engine — the notes are ready",
          url: "/inbox/abc-123",
          tag: "thread-1",
        }),
      },
    });

    expect(showNotification).toHaveBeenCalledWith(
      "Ada Lovelace",
      expect.objectContaining({
        body: "Re: analytical engine — the notes are ready",
        tag: "thread-1",
        data: { url: "/inbox/abc-123" },
      }),
    );
  });

  it("alerts again on a replacement by default, but not when told otherwise", async () => {
    /**
     * `renotify` is what decides whether replacing a notification buzzes the
     * device again. True is right for a second event under one tag — that
     * is a second thing to know about. False is for the sender that pushes
     * twice on purpose to improve one notification: Sendstack's inbound mail
     * goes out once from the webhook's metadata and again with a body
     * preview, and two buzzes for one message is what makes people turn
     * notifications off.
     */
    await fire("push", { data: { json: () => ({ title: "First", tag: "inbound:1" }) } });
    expect(showNotification).toHaveBeenLastCalledWith(
      "First",
      expect.objectContaining({ renotify: true }),
    );

    await fire("push", {
      data: { json: () => ({ title: "First", body: "…now with a preview", tag: "inbound:1", renotify: false }) },
    });
    expect(showNotification).toHaveBeenLastCalledWith(
      "First",
      expect.objectContaining({ renotify: false }),
    );
  });

  it("still shows something for a payload it cannot read", async () => {
    /**
     * Browsers require a *visible* notification for every push a subscription
     * receives, and swallowing one silently can cost the subscription. So an
     * unparseable payload becomes a generic notification rather than nothing.
     */
    await fire("push", {
      data: {
        json: () => {
          throw new Error("not json");
        },
      },
    });

    expect(showNotification).toHaveBeenCalledWith("New message", expect.anything());
  });

  it("collapses repeats about one conversation", async () => {
    // Ten replies to one thread should be one notification, not ten.
    await fire("push", { data: { json: () => ({ title: "x" }) } });
    expect(showNotification.mock.calls[0]?.[1]).toMatchObject({ tag: "sendstack-mail" });
  });
});

describe("tapping a notification", () => {
  beforeEach(() => createServiceWorker(options()));

  /** A notification event for `url`, with a spy on `close`. */
  function notification(url = "/inbox/abc-123") {
    const close = vi.fn();
    return { close, event: { notification: { close, data: { url } } } };
  }

  it("opens a window when the app is closed", async () => {
    // The usual case: the point of push is that the app was not open.
    const { event } = notification();
    await fire("notificationclick", event);
    expect(openWindow).toHaveBeenCalledWith("https://mail.example.com/inbox/abc-123");
  });

  it("closes the notification whatever happens next", async () => {
    // One left on screen after a tap reads as an app that did not respond.
    const { close, event } = notification();
    await fire("notificationclick", event);
    expect(close).toHaveBeenCalled();
  });

  it("navigates an open window rather than opening a second app", async () => {
    const navigate = vi.fn().mockResolvedValue(undefined);
    windows = [{ url: "https://mail.example.com/inbox", focus: vi.fn(), navigate }];

    await fire("notificationclick", notification().event);

    expect(navigate).toHaveBeenCalledWith("https://mail.example.com/inbox/abc-123");
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("only focuses a window already showing the message", async () => {
    /**
     * Navigating a window to the URL it is already on reloads it, throwing
     * away whatever the reader had scrolled to or typed.
     */
    const navigate = vi.fn();
    const focus = vi.fn().mockResolvedValue(undefined);
    windows = [{ url: "https://mail.example.com/inbox/abc-123", focus, navigate }];

    await fire("notificationclick", notification().event);

    expect(focus).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("opens a window when an existing one refuses to navigate", async () => {
    // The warning is the behaviour under test, so it is silenced rather than
    // left to print a stack trace beside a passing result.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    /**
     * `navigate()` rejects for a client this worker does not control, which is
     * the normal state of a tab opened before the worker activated. Doing
     * nothing there was the bug: the notification closed and nothing happened.
     */
    windows = [
      {
        url: "https://mail.example.com/inbox",
        focus: vi.fn().mockResolvedValue(undefined),
        navigate: vi.fn().mockRejectedValue(new Error("not controlled")),
      },
    ];

    await fire("notificationclick", notification().event);
    expect(openWindow).toHaveBeenCalledWith("https://mail.example.com/inbox/abc-123");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("ignores a window belonging to another origin", async () => {
    windows = [{ url: "https://elsewhere.example/inbox", focus: vi.fn(), navigate: vi.fn() }];
    await fire("notificationclick", notification().event);
    expect(openWindow).toHaveBeenCalled();
  });

  it("falls back to the configured landing page with no url in the payload", async () => {
    const close = vi.fn();
    await fire("notificationclick", { notification: { close, data: {} } });
    expect(openWindow).toHaveBeenCalledWith("https://mail.example.com/inbox");
  });
});

describe("messages from the page", () => {
  beforeEach(() => createServiceWorker(options()));

  it("purges every cache holding mail, and keeps the static one", async () => {
    /**
     * Sign-out. Caching pages and responses is what makes the app work
     * offline, and on a shared device it is also what hands the next person
     * the last inbox somebody read.
     */
    await fire("message", { data: { type: "purge-private-caches" } });

    expect(deletedCaches).toEqual(
      expect.arrayContaining([
        "sendstack-pages",
        "sendstack-rsc",
        "sendstack-data",
        "sendstack-media",
      ]),
    );
    // Build output says nothing about anyone, and re-downloading it is pure cost.
    expect(deletedCaches).not.toContain("sendstack-static");
  });

  it("queues a request handed to it", async () => {
    await fire("message", {
      data: {
        type: "queue-request",
        request: { url: "/api/compose/send", body: '{"to":"a@b.c"}' },
      },
    });

    const queue = wb.queues[0] as unknown as { pushRequest: ReturnType<typeof vi.fn> };
    expect(queue).toBeDefined();
  });

  it("ignores an unknown message rather than throwing", async () => {
    // An older page talking to a newer worker should degrade, not break.
    await expect(fire("message", { data: { type: "something-else" } })).resolves.toBeUndefined();
  });

  it("ignores a queue-request with no url, and says so", async () => {
    // Dropping it silently would mean a send that never happened and nothing
    // anywhere to explain it.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      fire("message", { data: { type: "queue-request", request: {} } }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no url"));

    warn.mockRestore();
  });
});

describe("replaying the outbox", () => {
  /**
   * Both ways the worker gets woken, against one queue.
   *
   * `sync` is what Chromium fires; `flush-queue` is what the page posts from
   * its `online` event for everyone else. A page that does both — which is
   * every page, because it cannot know which browser it is in — wakes the
   * worker twice at the same moment.
   */
  let queue: QueueStub;
  let sync: () => Promise<void>;
  let warn: ReturnType<typeof vi.spyOn>;

  const entry = () => ({ request: new Request("https://mail.example.com/api/compose/send", { method: "POST" }) });

  /** One queued request, then an empty queue — `shift` is what the loop calls. */
  function queueHolding(...entries: Array<ReturnType<typeof entry>>) {
    queue.shiftRequest.mockReset();
    for (const item of entries) queue.shiftRequest.mockResolvedValueOnce(item);
    queue.shiftRequest.mockResolvedValue(undefined);
  }

  beforeEach(() => {
    createServiceWorker(options());
    const registered = wb.queues[0]!;
    queue = registered.instance;
    sync = () => registered.onSync({ queue });
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => warn.mockRestore());

  it("runs one drain at a time, so two wake-ups cannot send one request twice", async () => {
    /**
     * The failure this pins: two drains interleaving over a durable queue.
     * Drain A shifts the entry and is mid-`fetch`; drain B finds the queue
     * empty and returns — fine. But if A's fetch then fails and A `unshift`s,
     * a B that started a moment later would shift the *same* entry and send
     * it while A is still deciding. With the guard, B is A.
     */
    let release!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)));
    vi.stubGlobal("fetch", fetch);
    queueHolding(entry());

    const first = sync();
    const second = fire("message", { data: { type: "flush-queue" } });
    // Both are in flight; only one has touched the network.
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);

    release(new Response(null, { status: 200 }));
    await Promise.all([first, second]);

    expect(fetch).toHaveBeenCalledTimes(1);
    // One shift for the entry, one that found the queue empty. A second drain
    // would have added its own pair.
    expect(queue.shiftRequest).toHaveBeenCalledTimes(2);
  });

  it("lets a later drain run once the first has finished", async () => {
    // The guard is a join, not a lock that is never released.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    queueHolding(entry());
    await sync();
    queueHolding(entry());
    await sync();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([408, 429, 500, 503])("puts a %i back at the front and asks to be woken again", async (status) => {
    /**
     * 408 and 429 used to be dropped with the other 4xx — "the request is
     * wrong" — when they mean the opposite: the server wants exactly the
     * later attempt a sync provides. Dropping a 429 lost the message.
     */
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status })));
    const queued = entry();
    queueHolding(queued);

    await expect(sync()).rejects.toThrow(String(status));
    expect(queue.unshiftRequest).toHaveBeenCalledWith(queued);
  });

  it("drops a rejected request rather than retrying it forever", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 400 })));
    queueHolding(entry());

    await expect(sync()).resolves.toBeUndefined();
    expect(queue.unshiftRequest).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("dropped"));
  });
});

describe("development builds", () => {
  /**
   * The reported bug, pinned.
   *
   * A development worker cached rendered documents, and `NetworkFirst` gave
   * the dev server four seconds — not enough for Next to compile a route on
   * demand behind a tunnel. So the worker served the *previous* HTML and the
   * freshly-compiled client JS hydrated against it:
   *
   *     Hydration failed because the server rendered HTML didn't match the
   *     client.
   *
   * No network failure required, which is why it appeared on a phone over a
   * tunnel and never on a laptop.
   */
  it("caches no build output either, whatever the URL looks like", () => {
    /**
     * The regression that broke the inbox.
     *
     * The first version of this guard left static assets cache-first behind a
     * test for `/_next/static/development/` — webpack's dev layout, which
     * Turbopack does not produce. Turbopack emits
     * `/_next/static/chunks/apps_web_1anvha4._.js`, a name that is *not*
     * content-hashed and survives edits to the files inside it.
     *
     * Cache-first plus a stable name pins that chunk for thirty days. The
     * server then sends a fresh RSC payload naming client references the
     * pinned chunk does not define, and React answers:
     *
     *     Element type is invalid. Received a promise that resolves to:
     *     undefined.
     */
    createServiceWorker({ ...options(), cacheContent: undefined } as never);

    expect(
      routeFor("https://mail.example.com/_next/static/chunks/apps_web_1anvha4._.js"),
    ).toBeNull();
    expect(
      routeFor("https://mail.example.com/_next/static/chunks/0-3o_next_dist_client_15el1b7._.js"),
    ).toBeNull();
  });

  it("caches no rendered content by default outside production", () => {
    // `cacheContent` omitted, so the default applies. vitest is NODE_ENV=test.
    createServiceWorker({ ...options(), cacheContent: undefined } as never);

    expect(routeFor("https://mail.example.com/inbox", { mode: "navigate" })).toBeNull();
    expect(routeFor("https://mail.example.com/sent?_rsc=1a2b3c")).toBeNull();
    expect(routeFor("https://mail.example.com/api/inbox/threads")).toBeNull();
    expect(routeFor("https://mail.example.com/api/attachments/x")).toBeNull();
  });

  it("still installs, precaches and handles push", () => {
    // What the development flag exists for. Disabling content caching must not
    // disable the two things somebody enables the worker in development to
    // test.
    createServiceWorker({ ...options(), cacheContent: undefined } as never);

    expect(wb.precached).toHaveLength(1);
    expect(listeners.has("push")).toBe(true);
    expect(listeners.has("notificationclick")).toBe(true);
    expect(wb.queues).toHaveLength(1);
  });

  it("still keeps the offline fallback", () => {
    createServiceWorker({ ...options(), cacheContent: undefined } as never);
    expect(wb.catchHandler).not.toBeNull();
  });

  it("deletes every cache a previous worker left behind, build output included", async () => {
    /**
     * Turning runtime caching off fixes nothing already installed unless the
     * old entries go too. Build output especially: a pinned dev chunk is what
     * breaks hydration, and it is the one cache the sign-out purge spares.
     * `cleanupOutdatedCaches` versions the precache and nothing else.
     */
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createServiceWorker({ ...options(), cacheContent: undefined } as never);

    await fire("activate", {});

    expect(deletedCaches).toEqual(
      expect.arrayContaining([
        "sendstack-pages",
        "sendstack-rsc",
        "sendstack-data",
        "sendstack-media",
        "sendstack-static",
      ]),
    );
    warn.mockRestore();
  });

  it("leaves the caches alone when content caching is on", async () => {
    createServiceWorker(options());
    await fire("activate", {});
    expect(deletedCaches).toEqual([]);
  });

  it("says which way round it is, so the log answers the question", () => {
    createServiceWorker({ ...options(), cacheContent: undefined } as never);
    const line = info.mock.calls.map((call) => String(call[0])).join(" ");
    expect(line).toContain("runtime caching off");
  });
});

describe("optional features", () => {
  it("registers no push handlers when notifications are not configured", () => {
    // A project that does not use push should ship no push code, rather than
    // handlers that fire and show a default title nobody configured.
    createServiceWorker(options({ notifications: undefined }));
    expect(listeners.has("push")).toBe(false);
    expect(listeners.has("notificationclick")).toBe(false);
  });

  it("registers no queue when the outbox is not configured", () => {
    createServiceWorker(options({ outbox: undefined }));
    expect(wb.queues).toHaveLength(0);
  });

  it("registers no data route when the allowlist is empty", () => {
    createServiceWorker(options({ api: [] }));
    expect(routeFor("https://mail.example.com/api/inbox/threads")).toBeNull();
  });
});
