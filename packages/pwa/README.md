# @sendstack/pwa

A PWA layer for a Next.js App Router project: a configurable Workbox service
worker, the build step that compiles it, the browser-side hooks for installing
the app and turning on push, and VAPID key generation.

Extracted from [Sendstack](../../README.md), which is the reference consumer —
everything below is what `apps/web` actually does.

## What it is, and what it deliberately is not

The parts worth sharing between projects are the ones with a *correct answer*:
the worker's caching policy, the platform detection behind an install button,
the ordering that keeps a permission prompt inside its user gesture. Getting
any of those subtly wrong produces a bug that reports nothing.

So this package ships those, and nothing else. It does not register the worker,
mount a component, render a button, or decide what your UI says. It has no
opinion about your state management, your auth, or where you store push
subscriptions. Those are yours.

**The whole position on caching, in one line:** serve what has already been
seen, and say how old it is. Every strategy is network-first, so a working
connection always wins; the cache is reached only when the network cannot
answer, and anything served from it is labelled.

## Where it is used in Sendstack

The setup guide below is written for any consumer. If you are working in this
repository, these are the files that already do it — read them before changing
anything here, because they are what will break.

| File | Imports | For |
| --- | --- | --- |
| `apps/web/src/sw/sw.js` | `createServiceWorker` from `/sw` | The worker entry, holding the `__WB_MANIFEST` token and the app's cache policy |
| `apps/web/scripts/build-sw.mjs` | `buildAndReport` from `/build` | Compiling the worker; runs as part of `pnpm dev` and `pnpm build` |
| `apps/web/src/lib/outbox.ts` | `queueRequest`, `canQueue`, `flushQueue`, `looksOffline` | The offline send queue. This package owns the queue; that file owns the one app-specific part — which request represents a send |
| `apps/web/src/lib/freshness.ts` | `readFreshness`, `purgeCachedData` | Telling the reader how stale a cached page is, and clearing it on sign-out |
| `apps/web/src/hooks/use-push.ts` | `usePush` | The push permission flow behind Settings → Notifications |
| `apps/web/src/components/pwa/install-item.tsx` | `useInstallPrompt` | The install button in the sidebar |
| `apps/web/src/components/pwa/connection-banner.tsx` | `flushQueue` | Replaying the outbox when the connection returns |
| `apps/web/src/actions/push.ts` | `generateVapidKeys` from `/vapid` | The Generate keys button in Settings |
| `packages/config/src/push-config.ts` | `describeVapidProblem` from `/vapid-shape` | Reporting a malformed VAPID key as unconfigured rather than failing inside `atob()` |

Two things follow from that list. This package is imported by exactly one app
and one other package, so a breaking change here has a small and knowable
blast radius — but `packages/config` depends on the `vapid-shape` subpath
only, and that subpath must stay free of anything browser-specific because
config runs on the server. And the worker itself is **not** registered by this
package: `apps/web/src/components/pwa/service-worker.tsx` does that, gated on
`NEXT_PUBLIC_ENABLE_SW` in development.

## Install

```bash
pnpm add @sendstack/pwa
```

Peer dependency: React 19. `workbox-*` and `esbuild` come with it.

In a monorepo shipping TypeScript source, add it to `transpilePackages`:

```ts
// next.config.ts
const nextConfig = { transpilePackages: ["@sendstack/pwa"] };
```

## Setup, in five steps

### 1. The worker entry

Three lines is a working worker. This file exists to hold the `__WB_MANIFEST`
token, which the build step replaces with the real precache list — it has to
appear in source somewhere, and a package cannot hold it.

```js
// src/sw/sw.js
import { createServiceWorker } from "@sendstack/pwa/sw";

createServiceWorker({ precache: self.__WB_MANIFEST });
```

A realistic one names what may be cached:

```js
import { createServiceWorker } from "@sendstack/pwa/sw";

createServiceWorker({
  precache: self.__WB_MANIFEST,
  cachePrefix: "myapp",
  offlineUrl: "/offline",

  // Read-only endpoints, listed rather than matched by prefix. An allowlist,
  // because the alternative cannot be kept correct — a route added next month
  // should be uncached until somebody decides otherwise.
  api: ["/api/posts", "/api/comments"],

  // Path prefixes for images and attachments.
  media: ["/api/avatars/", "/uploads/"],

  // Final say. Return true and the worker does not touch the request at all.
  // Server-sent events belong here: a caching strategy wrapped around an SSE
  // response buffers it until the stream closes, which is never.
  exclude: (url) => url.pathname === "/api/stream",

  notifications: {
    icon: "/icons/192.png",
    badge: "/icons/badge.png",
    defaultTitle: "New activity",
    defaultUrl: "/",
  },

  // Replay of requests made with no connection. Omit to leave it out.
  outbox: { name: "myapp-outbox" },
});
```

Every option and the reasoning behind each default is in
[`src/sw/create.js`](src/sw/create.js).

### 2. The build step

```js
// pwa.config.mjs
const config = {
  source: "src/sw/sw.js",
  output: "public/sw.js",
  publicDir: "public",
  precacheGlobs: ["icons/**/*.png"],
  precacheRoutes: ["/offline"],
};

export default config;
```

```jsonc
// package.json — before Next, not after, and not via a `prebuild` hook:
// pnpm does not run npm's pre/post lifecycle scripts by default.
{
  "scripts": {
    "dev": "sendstack-pwa build && next dev",
    "build": "sendstack-pwa build && next build",
    "build:sw": "sendstack-pwa build"
  }
}
```

`output` **must** be served from the origin root — `public/sw.js` for Next — or
the worker's scope will not cover the whole app. Add it to `.gitignore`: it is
generated, and committing it means reviewing a bundled copy of Workbox on every
change.

Prefer calling it in-process? `import { buildAndReport } from
"@sendstack/pwa/build"`.

### 3. Register it

The package does not do this, because *when* to register is a product decision.
The version that has survived contact with reality:

```tsx
"use client";
import { useEffect } from "react";

export function ServiceWorkerBridge() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Development is excluded by default: a worker caching build output while
    // the build output changes on every keystroke is a morning lost.
    const allowed =
      process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_ENABLE_SW === "1";

    if (!allowed) {
      // Say so. A worker that is built, served and never registered looks
      // exactly like one that is broken.
      console.info("[pwa] Service worker disabled: set NEXT_PUBLIC_ENABLE_SW=1.");
      return;
    }

    // Registration is deferred to `load` so it never competes with the first
    // paint — the worker is only useful on the *second* visit.
    const register = () =>
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((reason) => console.error("[pwa] Registration failed:", reason));

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
```

Two things that catch everyone:

- **A service worker needs a secure context.** `localhost` counts; a LAN
  address does not. Testing on a phone therefore needs a real HTTPS origin — a
  Cloudflare or ngrok tunnel is the usual answer.
- **`Cache-Control` on `/sw.js`.** Next serves `public/` with a long-lived
  header in production, which for every other file is right and for this one
  means a deploy that never reaches an installed app:

  ```ts
  // next.config.ts
  async headers() {
    return [{
      source: "/sw.js",
      headers: [
        { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        { key: "Service-Worker-Allowed", value: "/" },
      ],
    }];
  }
  ```

### 4. The install button

```tsx
"use client";
import { useInstallPrompt } from "@sendstack/pwa";

export function InstallButton() {
  const { state, promptInstall } = useInstallPrompt();

  // Renders nothing unless it can act. An "Install" button that does nothing
  // when pressed is worse than an app that never offered.
  if (state === "checking" || state === "unavailable") return null;

  // iOS has no prompt to show: Share → Add to Home Screen is the only route,
  // and it is two taps deep in a menu most people never open.
  if (state === "manual") return <button onClick={showIosInstructions}>Install app</button>;

  return <button onClick={() => void promptInstall()}>Install app</button>;
}
```

`state` is one of `checking`, `available` (Chromium has handed over a prompt),
`manual` (iOS Safari), or `unavailable` (already installed, or a browser with no
install path). Chromium's own mini-infobar is suppressed, so the offer appears
where you put it rather than over the page on first load.

### 5. Push notifications

Generate a key pair — either from the command line:

```bash
npx sendstack-pwa vapid mailto:you@example.com
```

or in your app, from a button:

```ts
"use server";
import { generateVapidKeys, normaliseVapidSubject } from "@sendstack/pwa/vapid";

export async function createKeys(contact: string) {
  const keys = generateVapidKeys();
  // Store the private half encrypted; the public half is safe to publish.
  await saveSecret("vapidPrivateKey", keys.privateKey);
  await saveSetting({
    vapidPublicKey: keys.publicKey,
    vapidSubject: normaliseVapidSubject(contact),
  });
}
```

**Generate the pair once.** A browser binds each subscription to the public key
it was created with, so replacing it does not migrate those subscriptions and
does not error — every device that had notifications on silently stops
receiving them. Anything that rotates the pair must delete the subscription
rows too, or the device list becomes a list of addresses nothing can reach.

`@sendstack/pwa/vapid` also exports `isValidVapidPublicKey`,
`isValidVapidPrivateKey`, `isValidVapidSubject` and `keysMatch` — worth running
at the point a key is *saved*, because a malformed one otherwise fails inside
`pushManager.subscribe()` days later on somebody else's device.

Then bind `usePush` to your own server calls:

```ts
"use client";
import { useMemo } from "react";
import { usePush as usePwaPush } from "@sendstack/pwa";
import { pushConfig, savePushSubscription, deletePushSubscription } from "@/actions/push";

export function usePush() {
  // Must be referentially stable, or the mount effect re-runs every render.
  const transport = useMemo(
    () => ({ config: pushConfig, save: savePushSubscription, remove: deletePushSubscription }),
    [],
  );
  return usePwaPush(transport);
}
```

The transport is injected rather than imported because the server half is
necessarily yours: your auth, your table, your Server Actions or route
handlers.

`state` is `checking`, `unsupported`, `unconfigured` (no VAPID keys), `denied`,
`off` or `on`. Call `enable()` **from a click** — Chrome and Firefox suppress
permission prompts not tied to a gesture, Safari refuses them, and a refusal is
permanent from the page's side. `enable()` calls
`Notification.requestPermission()` before any `await` for the same reason:
Safari drops transient activation across one.

Sending is not this package's job. `web-push` on the server takes the
subscription rows and the private key.

## Telling the reader their data is stale

The worker stamps `x-<cachePrefix>-from-cache` and `x-<cachePrefix>-cached-at`
on anything it replayed from Cache Storage. Read it wherever your fetches go
through:

```ts
import { readFreshness } from "@sendstack/pwa";

const response = await fetch(url);
const freshness = readFreshness(response, "myapp");
if (freshness) showStaleNotice(freshness.storedAt);
```

This matters more than it looks. Caching data is only defensible if the reader
is told when it is old; an unlabelled hour-old list is the failure the cache was
supposed to avoid, dressed up as a success.

## Clearing it on sign-out

```ts
import { purgeCachedData } from "@sendstack/pwa";

await signOut();
purgeCachedData(); // fire and forget; it cannot throw
```

Caching pages and responses is what makes the app work offline, and on a shared
device it is also what hands the next person the last screen somebody read —
from disk, with no session, and with no request the server could refuse.
Build output and the offline page are kept; neither says anything about anyone.

## Queueing writes made offline

```ts
import { canQueue, looksOffline, queueRequest, flushQueue } from "@sendstack/pwa";

try {
  await fetch("/api/messages", { method: "POST", body });
} catch (error) {
  if (looksOffline(error) && (await queueRequest({ url: "/api/messages", body }))) {
    showQueuedNotice();
  }
}

// Background Sync replays on its own, but only in Chromium. Elsewhere this
// call from the page's `online` event is the only thing that does.
window.addEventListener("online", () => void flushQueue());
```

Queue a **route**, not a Server Action: action ids are generated per build and
their bodies are opaque, so a queued action is a request that can never be
replayed.

The replay policy: a `4xx` is final (the request itself is wrong, and replaying
it on every reconnect would retry forever), except `408` and `429`, which are
the server asking for a later attempt; those, a `5xx` or a network failure go
back on the front of the queue and stop the drain so ordering survives a bad
connection. Only one drain runs at a time — Background Sync and the page's
`flush-queue` can fire together, and a second drain joins the first rather than
interleaving with it. Either way the page is told, via `postMessage`:

A replay can also *repeat* a request the server already handled: a network
error can hide a response that did arrive. The route being replayed must be
idempotent, so put a client-generated key in the body when you queue it and
have the server collapse duplicates on it.

```ts
navigator.serviceWorker.addEventListener("message", (event) => {
  if (event.data?.type === "queued-request-sent") toast.success("Sent");
  if (event.data?.type === "queued-request-failed") toast.error("Rejected, not retried");
});
```

## Migrating from a hand-written worker

If your previous worker kept a queue in its own IndexedDB database, name it and
it is drained on install:

```js
outbox: { name: "myapp-outbox", legacyDatabase: { name: "old-outbox", store: "requests" } }
```

Without that, upgrading an installed copy while something was queued drops it
silently — the worst available outcome, and the one nobody reports because there
is nothing to see.

## Exports

| Entry | Runs in | Contents |
| --- | --- | --- |
| `@sendstack/pwa` | browser | `useInstallPrompt`, `usePush`, `readFreshness`, `purgeCachedData`, `queueRequest`, `flushQueue`, `canQueue`, `looksOffline` |
| `@sendstack/pwa/sw` | service worker | `createServiceWorker` |
| `@sendstack/pwa/build` | node | `buildServiceWorker`, `buildAndReport` |
| `@sendstack/pwa/vapid` | node | `generateVapidKeys` and the validators |

Kept apart so a client bundle never pulls in esbuild or `node:crypto`.
