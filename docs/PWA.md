# Installing Sendstack as an app

Sendstack is a progressive web app: installable on a phone or desktop, usable
with the network gone, and able to notify you about mail while it is closed.

The implementation is [`@sendstack/pwa`](../packages/pwa/README.md), a package
this app consumes like any other project would. Its README is the integration
guide; this page is about *this* instance.

Everything here needs a **public HTTPS origin**. Service workers and the Push
API refuse to run otherwise, and `localhost` only counts for the machine
running it — a phone on the same network is not `localhost`. That is why the
tunnel is part of `pnpm dev`:

```bash
pnpm dev          # tunnel + web + inngest
pnpm dev:local    # web + inngest only, no tunnel
```

See [docs/CLOUDFLARE.md](CLOUDFLARE.md) for the tunnel itself.

## If the worker is not being found

Almost always one of three things, in this order.

**1. It was never registered.** The worker is deliberately not registered in
development unless `NEXT_PUBLIC_ENABLE_SW=1` — a worker caching build output
that changes on every keystroke is a morning lost. Without the flag `/sw.js` is
built, served over HTTPS, and reachable from the phone, and *nothing registers
it*, which looks exactly like a broken PWA.

`pnpm dev` now writes the flag into `.env.local` along with the tunnel
hostname, and the console says so when the flag is missing. If you set the
hostname by hand, set this too:

```ini
NEXT_PUBLIC_ENABLE_SW="1"
```

Then **restart the dev server** — `NEXT_PUBLIC_*` variables are inlined at
build time, so an already-running server will not pick it up.

**2. It was not built.** `public/sw.js` is generated from `src/sw/sw.js` and is
gitignored. `pnpm dev` and `pnpm build` both run the build first; a fresh clone
that starts Next some other way has no worker to serve. Check:

```bash
curl -sI https://your-tunnel-host/sw.js | head -3
pnpm --filter @sendstack/web build:sw
```

**3. The origin is not secure.** `window.isSecureContext` must be true. A LAN
address (`192.168.x.x`) is not a secure context however convenient it looks,
and the console now says so instead of failing silently.

Everything after that shows up in the browser's own tooling: DevTools →
Application → Service Workers, which on Android can be reached over USB from
`chrome://inspect` on the desktop.

## Installing it

The sidebar grows an **Install app** row when installation is actually
possible, and shows nothing otherwise. Three cases, because the platforms
differ and a button that cannot act is worse than no button:

| | What happens |
| --- | --- |
| Chromium (desktop, Android) | The row appears once the browser offers a prompt, and clicking it opens that prompt. |
| Safari on iOS and iPadOS | No prompt exists; the row explains Share → Add to Home Screen, which is the only route. |
| Firefox, Chrome on iOS, an already-installed copy | No row. |

**Why a browser might not offer it.** Chromium gates
`beforeinstallprompt` on a fixed checklist: HTTPS, a manifest with a `name` or
`short_name`, a `start_url`, a `display` of `standalone`/`fullscreen`/
`minimal-ui`, at least a 192px and a 512px icon, and a registered service
worker with a fetch handler. Miss one and the row simply never appears, with
nothing said anywhere — so `apps/web/src/app/manifest.test.ts` checks every
one of them, including that the icon files it names actually exist in
`public/`. If the row is missing, the two things to check by hand are that the
worker registered (see above) and that the origin is HTTPS.

DevTools → Application → Manifest shows the same checklist with a pass or fail
beside each item, which on Android can be reached over USB from
`chrome://inspect`.

Chromium's own mini-infobar is suppressed on purpose — an install offer over
the page on first load interrupts somebody who came to read their mail, and
gets dismissed on reflex. The offer lives in the app's chrome instead, where it
waits.

## What works offline

The worker is built from `apps/web/src/sw/sw.js` with Workbox — bundled by
`scripts/build-sw.mjs`, which `pnpm dev` and `pnpm build` both run before Next.
The file in `public/sw.js` is generated; editing it does nothing.

| | Behaviour |
| --- | --- |
| Launching with no network | The last rendered copy of the page, then the offline page if there is none. |
| Following a link offline | The last payload for that navigation, so the sidebar keeps working. |
| Mailbox lists | The last page fetched for that exact query. Network-first, so a connection always wins. |
| Images and attachments | The last copy fetched. |
| Static assets | Cache-first. Content-hashed, so a hit is always correct. |
| Sending with no network | Queued and replayed on reconnect. |
| Sessions, search that was never run, live streams | **Never cached.** Always the network. |

**Everything is network-first.** Nothing is served from the cache while the
network can answer, so a working connection never shows you an old mailbox.
The cache is reached only when the request fails or times out.

**Stale data says so.** A response the worker replays carries
`x-sendstack-from-cache` and the time it was stored, and the connection banner
turns that into a sentence: *"Offline — showing mail as it was 12 minutes
ago."* When several lists are on screen it reports the oldest, because
understating the age is the one thing the notice exists to prevent.

**Signing out empties it.** Rendered pages, list responses, RSC payloads and
attachments all hold somebody's mail, so `purgeCachedMail()` deletes those four
caches on sign-out — otherwise the next person to open a shared laptop gets the
last inbox somebody read, served from disk, with no request the server could
refuse. Build output and the offline page stay; neither says anything about
anyone. Everything expires within a day regardless (seven days for images).

### Reading mail offline, precisely

What the caching above adds up to, stated as behaviour rather than as strategy
names:

| Offline, you… | Works? |
| --- | --- |
| Launch the installed app | **Yes** — `start_url` is `/inbox`, a document navigation, served from `sendstack-pages` |
| Reopen a thread you had already opened | **Yes** — its page is in the same cache |
| Scroll the mailbox list | **Yes** — the last page fetched for that query comes from `sendstack-data` |
| See inline images and attachments in a cached thread | **Yes** — `sendstack-media` |
| Follow a sidebar link you had used before | **Yes** — `sendstack-rsc` holds that navigation's payload |
| Tap through to a thread you have *never* opened | **No** — nothing was cached for it, so you get `/offline` |
| Search for something you have not searched before | **No** — the query string is part of the cache key |
| Send a reply | **Queued** — replayed on reconnect; see below |

Every "yes" row is labelled with its age in the banner, and every one of these
routing decisions is asserted in `packages/pwa/src/sw/create.test.ts` rather
than only described here — including the ones that must *not* be cached.

Two limitations worth stating plainly. An offline search only finds what has
already been searched for online, and a filtered list that silently isn't
filtered would be worse than an empty one. And following a link offline works
for journeys already taken rather than for every route reachable from where you
are: Next keys a client navigation on the router state it started from, so
`/inbox → /sent` and `/drafts → /sent` are two different cache entries.

## Sending offline

With no connection the Send button becomes **Queue to send**. The message goes
into the service worker's outbox — `workbox-background-sync`, backed by
IndexedDB, so it survives the tab closing and the phone locking — and is
replayed when the browser reports a network again. A copy stays in Drafts as
well: if the replay never happens, the message is still there rather than
gone.

Replay uses `POST /api/compose/send` rather than the Server Action the composer
normally calls. Action ids are generated per build and their bodies are opaque,
so a queued action is a message that can never be replayed. Both paths call the
same send function.

A queued send that comes back `4xx` is **dropped, not retried** — the request
itself is wrong, and replaying it on every reconnect would retry forever. A
`5xx` or a network failure goes back on the *front* of the queue and stops the
drain, so ordering survives a bad connection. Either way the page is told, so
it can say what happened.

Upgrading from a build older than the Workbox worker migrates anything left in
the previous outbox on install, rather than orphaning it in a database nothing
reads any more.

Chromium replays through Background Sync. Safari and Firefox do not implement
it, so there the replay is triggered by the page's own `online` event — which
means the tab has to be open. That is a platform limit, not a setting.

## Push notifications

### The keys, and where they come from

Push messages are signed with a key pair this instance owns, so a push service
can tell that a notification really came from here. Three values, and **two
ways to get them.**

#### One click, in the app

**Settings → Notifications → Generate keys.** It creates the pair, saves the
public half and the contact address as settings, encrypts the private half at
rest, and takes effect immediately — no file to edit and no restart.

This is the route to use. The other one is fine for whoever deployed the
instance and impossible for anyone who did not, which for a self-hosted product
is most of the people who will ever need it.

Once keys exist the same panel shows the public key, offers to copy it, and puts
rotation behind a confirmation that says how many devices it will unsubscribe.
The private key is never displayed — a UI that prints one invites it into a
screenshot.

#### Or from the command line

```bash
pnpm push:keys mailto:you@yourdomain.com
# or, from any project using the package:
npx sendstack-pwa vapid mailto:you@yourdomain.com
```

Add the three printed values to `.env.local` (or your host's dashboard). Note
the precedence: **the database wins.** Every setting resolves database first,
environment second — the environment seeds an instance that has never been
configured, it does not override one that has. So generating a pair in Settings
replaces whatever is in the environment, and not the other way round:

```ini
VAPID_PUBLIC_KEY="…"
VAPID_PRIVATE_KEY="…"
VAPID_SUBJECT="mailto:you@yourdomain.com"
```

| Variable | What it is |
| --- | --- |
| `VAPID_PUBLIC_KEY` | The uncompressed P-256 point, 65 bytes base64url — 87 characters, always starting `B`. Handed to every browser that subscribes, so it is public. |
| `VAPID_PRIVATE_KEY` | The raw 32-byte scalar, base64url — 43 characters. A secret. |
| `VAPID_SUBJECT` | A `mailto:` address or `https:` URL a push service can use to reach whoever runs this instance. Required by RFC 8292; a bare email address is rejected. Never shown to anyone receiving a notification. |

Base64**url**, unpadded — `-` and `_`, no `=`. Standard base64 is the usual
paste mistake and fails inside `pushManager.subscribe()` as an
`InvalidCharacterError` that reads like a bad key.

Both halves are validated on read, so a malformed value reports the instance as
**unconfigured** — which puts the Generate panel back — and logs which value is
wrong and how. If you see this in the server log:

```
[config] Push notifications are disabled: The VAPID public key "…" contains
non-ASCII characters — it looks like a documentation placeholder rather than a
real key.
```

then a placeholder was uncommented in `.env`. Delete the three lines and
generate a pair in Settings; earlier versions of `.env.example` used `…` as the
example value, which is a real character and became a real key.

The private key is encrypted at rest once stored. **Keep a copy** — browsers
bind a subscription to the public key it was created with, so rotating the pair
silently stops notifications on every installed copy until each one
re-subscribes.

### Turning it on

Three ways in, all of which end at the same `usePush().enable()`:

- an **Enable notifications** row in the sidebar, present only while
  notifications *can* be turned on and gone the moment they are;
- a **single dismissible prompt** a few seconds after first use, offered once
  per browser and remembered in `localStorage`;
- **Settings → Notifications**, which is where the device list, the test
  button and the recovery path for a refusal live.

The browser's permission dialog is only ever opened from a click. Chrome and
Firefox suppress prompts not tied to a gesture, Safari refuses them, and — the
part that matters — a refusal is permanent from the page's side. Asking in the
app's own UI first means "not now" costs nothing, where "block" in the
browser's dialog cannot be undone from here at all.

`Notification.requestPermission()` is also the *first* thing `enable()` does,
before any `await`. A browser only honours the request while the click still
counts as transient activation, and Safari drops that across an await — so
fetching the VAPID key first, as this once did, made the prompt silently fail
to appear on exactly the platform where it is hardest to debug.

Subscriptions are **per browser**, not per account:
enabling it on a laptop does nothing for a phone, and the device list on that
screen is the only place to see what is actually subscribed. There is a test
button, because there are five links between a granted permission and a
notification on a lock screen — VAPID keys, the subscription row, the push
service, the service worker, the OS — and every one of them fails silently.

### What gets sent, and what happens when it is tapped

One notification per inbound conversation:

```
  title   Ada Lovelace                        the sender's name, or their address
  body    Q3 numbers — Here are the figures…  subject — snippet, 140 chars, cut on a word
  tag     <thread key>                        so ten replies replace each other
  url     /inbox/<id>                         the thread reader for this message
```

Fired from `hydrateInboundEmail`, **not** from the webhook. The webhook payload
is metadata only — no body, no snippet — so a notification sent from there
would say "New message" and open a thread with nothing in it. By the time the
body has been fetched there is something worth reading, and something worth
previewing.

The send is wrapped in a `try`/`catch` and never fails the job: the mail is
already stored, the realtime event has already gone out, and a push service
being slow is not a reason to retry a write that succeeded.

**Tapping it lands on the message.** `notificationclick` in the service worker
tries four things in order, because the obvious implementation gets three of
them wrong:

1. a window **already showing that thread** — focus it and stop, because
   navigating a window to the URL it is already on reloads it and throws away
   whatever the reader had scrolled to or typed;
2. a window **on this origin** — focus it, then navigate, so a tap does not
   leave somebody with two copies of the app;
3. `navigate()` **refused** — it rejects for a client the worker does not
   control, which is the normal state of a tab opened before the worker
   activated. Doing nothing there was the bug: the notification closed and
   nothing happened. Falls back to a new window;
4. **no window at all** — the usual case, since the point of push is that the
   app was closed.

All four are covered in `packages/pwa/src/sw/create.test.ts`.

## Testing on a device

1. `pnpm dev`, and note the tunnel URL it prints.
2. Set Settings → Workspace → App URL to that URL.
3. Open it on the phone. Add to Home Screen.
4. Settings → Notifications → on, then **Send a test notification**.
5. Turn on airplane mode, write a reply, press **Queue to send**, turn it off
   again.

The service worker is **not registered in development by default** — a worker
caching build output that changes on every keystroke is a morning spent
wondering why an edit did not apply. Two ways round it:

```bash
# Opt in, so `pnpm dev` + a tunnel can install the app on a phone.
# Expect to hard-reload after a change.
NEXT_PUBLIC_ENABLE_SW=1

# Or exercise the real thing.
pnpm build && pnpm start
```

**A development worker caches nothing that was rendered.** Not the documents,
not the navigation payloads, not the API responses, not the media — only the
precache, push and the outbox are live. Installability and push are what the
flag is for, and those work.

That is a fix rather than a limitation. The worker used to cache rendered
content in development too, and it produced this:

```
Hydration failed because the server rendered HTML didn't match the client.
```

The chain: edit a component; request the page from a phone over the tunnel;
`NetworkFirst` gives the dev server four seconds, which is not enough for Next
to compile a route on demand behind a tunnel; the worker serves the *previous*
HTML from its `pages` cache; the freshly-compiled client JS hydrates against
it. No network failure is needed — a slow dev server is enough, which is why
it appeared on a phone and never on a laptop.

Turning content caching off also deletes whatever a previous worker cached, on
every activation. Without that, an already-installed copy keeps serving stale
HTML for a day and keeps the disk indefinitely.

**To test offline reading you need a production build:**

```bash
pnpm build && pnpm start   # behind the same tunnel
```

`/_next/static/` is separately excluded in development for the original
reason: it is content-hashed in a production build and rebuilt in place in
development, so a cache hit serves yesterday's code with no way to tell.

`pnpm dev` rebuilds the worker once at startup, so a change to
`src/sw/sw.js` needs a restart (or `pnpm --filter @sendstack/web build:sw`) to
reach the browser — and then a hard reload, because the browser has to notice
the new worker.
