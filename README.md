# Sendstack

[![CI](https://github.com/david-jerry/Sendstack/actions/workflows/ci.yml/badge.svg)](https://github.com/david-jerry/Sendstack/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Open Source](https://img.shields.io/badge/Open%20Source-%E2%9D%A4-blueviolet)](https://github.com/david-jerry/Sendstack)
[![GitHub stars](https://img.shields.io/github/stars/david-jerry/Sendstack?style=flat&color=blue)](https://github.com/david-jerry/Sendstack/stargazers)

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-149eca?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Drizzle_ORM-4169E1?logo=postgresql&logoColor=white)](https://orm.drizzle.team)
[![Resend](https://img.shields.io/badge/Email-Resend-000000?logo=resend&logoColor=white)](https://resend.com)
[![Inngest](https://img.shields.io/badge/Jobs-Inngest-6366f1)](https://www.inngest.com)
[![Redis](https://img.shields.io/badge/Cache-Redis%20%7C%20Upstash-DC382D?logo=redis&logoColor=white)](https://redis.io)
[![Better Auth](https://img.shields.io/badge/Auth-Better%20Auth-000000)](https://www.better-auth.com)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38bdf8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Zod](https://img.shields.io/badge/Validation-Zod-3E67B1?logo=zod&logoColor=white)](https://zod.dev)
[![pnpm](https://img.shields.io/badge/pnpm-10-f69220?logo=pnpm&logoColor=white)](https://pnpm.io)
[![Node](https://img.shields.io/badge/Node-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org)

**Resend gives you the sending API. Sendstack gives you the app around it** —
campaigns, contacts, suppression, scheduling and a live two-way inbox for
replies, wired directly into your own Resend account. Free and open source,
so any company can run it on its own infrastructure without paying per-seat
for what is otherwise a thin layer over an email API.

Send campaigns to a list, and read the replies in the same app — in real
time.

Built on Next.js, Postgres, Resend and Inngest. Self-hostable in about ten
minutes, MIT licensed, and designed so that the parts people usually get wrong
are hard to get wrong here.

---

## What it does

- **Compose from anywhere** — New mail sits above the folders and opens one
  editor for both jobs: a single message with Cc and Bcc, or a personalised
  send to a pasted list or an imported CSV. Bulk mail runs through the campaign
  pipeline, so it is batched, suppression-checked and tracked per recipient.
- **Attachments and inline images** — files travel with the message; images
  dropped into the body are hosted and linked, because Gmail and Outlook both
  strip `data:` URIs.
- **Campaigns** — create one from the campaigns page: name it, pick the list,
  pick the design, write the message. It is created as a draft; sending,
  scheduling, pausing and cancelling are guarded transitions on its own page.
  Merged per recipient and sent in batches with per-message idempotency, so a
  retry can never send twice.
- **Lists** — create one, and add existing contacts to it by searching name,
  email or company. Someone already on the list is shown as such rather than
  silently re-added.
- **Contacts and lists** — CSV import that _reports_ the rows it rejected
  instead of silently dropping them.
- **A suppression list that is actually enforced** — hard bounces and spam
  complaints are recorded automatically and checked on every send. Bounces
  cannot be manually removed, because the receiving server's verdict is not a
  preference.
- **A live inbox** — replies appear as they arrive, over SSE. No polling.
- **Scheduling** — queue a campaign for later; a cron claims it at the minute.
- **One-click unsubscribe** — RFC 8058 headers, signed links, no login.
- **Four styled HTML email designs** — Simple, Announcement, Newsletter and
  Plain, built with React Email. Pick one while composing a single message or
  a campaign, or set an instance-wide default in Settings so every send starts
  there. Your logo and brand colour flow into whichever design is chosen.
- **Setup in the browser** — a wizard collects every credential, with
  instructions for getting each one and a Test button that makes a real call
  before saving. It updates itself over SSE, so restarting the server or adding
  an environment variable moves it on without a reload.
- **Images on a CDN** — logo and favicon go to Cloudinary when configured, and
  to your database when it is not.
- **Sign in your way** — email and password, passkeys, magic links. Toggle them
  in Settings; at least one must stay on.
- **Light and dark** — follows your operating system by default, with a toggle
  in the sidebar and a three-way choice in Settings.

## The stack

| Concern            | Choice                                                                         |
| ------------------ | ------------------------------------------------------------------------------ |
| Framework          | Next.js 16, App Router, React 19, Server Actions                               |
| Database           | Postgres via Drizzle ORM                                                       |
| Cache / pub-sub    | Redis — wire protocol or Upstash REST, picked by URL scheme                    |
| Email              | Resend — sending, receiving, webhooks                                          |
| Background jobs    | Inngest — batching, retries, cron                                              |
| Auth               | Better Auth — password, passkeys, magic links                                  |
| Email design       | React Email — four built-in templates plus your own uploaded HTML, brand-aware |
| Configuration      | Stored in Postgres, secrets encrypted with AES-256-GCM                         |
| Image hosting      | Cloudinary CDN, falling back to Postgres                                       |
| Forms / validation | React Hook Form + Zod (one schema, both sides)                                 |
| Client state       | Zustand                                                                        |
| UI                 | Tailwind CSS v4 + shadcn/ui conventions                                        |
| Theming            | next-themes — light, dark, or follow the system                                |
| Tests              | Vitest — `pnpm test`                                                           |

---

## Contributor architecture contract

If you are contributing code, this is the required architecture flow. Treat it
as a contract, not a suggestion.

### 1) Dependency direction (one-way)

```text
UI (apps/web/src/components, app routes)
  -> Server Actions / API routes (apps/web/src/actions, apps/web/src/app/api)
  -> Domain packages (packages/*)
  -> Postgres / Redis / Resend / Inngest
```

Client components do not call providers directly. Provider SDK usage stays in
the owning package (`@sendstack/email`, `@sendstack/redis`, `@sendstack/jobs`,
`@sendstack/auth`).

### 2) Exact outbound flow

1. UI submits through a Server Action.
2. Campaign state is persisted in Postgres.
3. Background jobs materialize recipient rows.
4. Suppressed or inactive contacts are marked, not silently dropped.
5. Worker claims pending rows in transactional batches.
6. Provider send uses stable idempotency keys.
7. Recipient state and campaign counters are updated in Postgres.
8. Realtime progress is published as a latency optimization.

### 3) Exact inbound flow

1. Resend posts a webhook to the API route.
2. Signature is verified and the event is deduplicated.
3. Metadata row is persisted immediately in Postgres.
4. Realtime event is published.
5. Background job fetches the full message body.
6. The same row is updated with authoritative content.
7. Realtime update is published again; UI refresh converges to Postgres.

### 4) Invariants every PR must preserve

1. Postgres is the source of truth.
2. Realtime (SSE + Redis pub/sub) is never a correctness dependency.
3. Sending remains idempotent and duplicate-safe.
4. Inbound processing tolerates at-least-once delivery and retries.
5. Suppression checks run on every send path.
6. Email addresses are normalized at ingestion boundaries.
7. Inbound HTML is never treated as trusted app content.

### 5) Context ownership

Every Server Action, API route and background job belongs to exactly one
bounded context, listed with its aggregate and its proving tests in
[docs/ARCHITECTURE.md § Bounded contexts](docs/ARCHITECTURE.md#bounded-contexts).

**A new one of those must add its own row to that matrix in the same PR.**
This is not a convention — `test/architecture.test.ts` reads the matrix and
fails when it finds a surface nobody owns. A new API route is a new place a
send can happen or a new writer of a monotonic column, and the review question
is always "whose rule governs this".

Rules may cross a context line to be enforced — Delivery Execution checks
suppression, which Suppression & Deliverability owns — but always by calling
the owner's exported function, never by re-implementing it.

### 6) Required pre-PR architecture checks

1. Read [PRODUCT.md](PRODUCT.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
2. State in your PR which flow you touched (outbound, inbound, realtime,
   auth, setup) and which invariants you verified. The
   [pull request template](.github/pull_request_template.md) asks for exactly
   this.
3. Add or update tests for changed flow behavior, and break-test any new guard.
4. Update architecture docs in the same PR when behavior changes.

## Quick start

You need **Node 22+** and **pnpm 10+**. That is genuinely all — every account
(Neon, Upstash, Resend, Cloudinary) is set up from inside the app, with
instructions. Prefer to run everything locally? `docker compose up -d` gives
you Postgres and Redis, and only Resend needs an account.

```bash
git clone https://github.com/david-jerry/Sendstack.git
cd Sendstack
pnpm install
pnpm dev
```

Open <http://localhost:3005>. You will land on the setup wizard, which walks
through seven steps:

> Port 3005, not 3000, because 3000 is the most contested port on a developer's
> machine and `next dev` responds to a busy port by quietly moving to the next
> free one — while the Cloudflare tunnel keeps forwarding to the port it
> assumed, and serves whatever else is listening there. Override both halves
> together with a shell variable, `PORT=3010 pnpm dev`; it is deliberately not
> a `.env` key, because `next dev` does not read one.

1. **Database** — paste a Postgres URL, press Test. It writes `.env.local` for
   you when it can, or hands you the values to paste into your host when it
   cannot. Then it _notices the restart by itself_ and moves on.
2. **Branding** — name, logo, favicon, brand colour, and where images are
   hosted (Cloudinary, or your database).
3. **Email** — your Resend key, tested live before it is saved.
4. **Realtime** — `redis://localhost:6379`, an Upstash REST URL, or skip it.
5. **Jobs** — Inngest keys, or skip them in development.
6. **Sign-in** — password, passkeys, magic links.
7. **Account** — your admin account. Registration closes again immediately.

Every credential field has a **?** beside it explaining exactly where to get
that value, what the common mistake is, and a link straight to the right page.

Already have credentials? Put them in `.env` before first run
(`cp .env.example .env`) and the wizard pre-fills those fields.

### What lives where

Only two values are mandatory from day one and never move into database
settings:

|                 | Where it lives      | Why                                                                          |
| --------------- | ------------------- | ---------------------------------------------------------------------------- |
| `DATABASE_URL`  | `.env.local`        | Settings stored in Postgres cannot contain the credentials to reach Postgres |
| `AUTH_SECRET`   | `.env.local`        | Secrets encrypted at rest cannot contain their own key                       |
| Everything else | Postgres, encrypted | Editable in Settings, no redeploy                                            |

If you set an environment variable _and_ save a value in the UI, **the saved
value wins** — the environment is a first-run seed. Every field in Settings is
labelled with where its value actually came from, so this is never a mystery.

Optional local-development values can still live in `.env.local` (for example
`NEXT_PUBLIC_APP_URL` and `ALLOWED_DEV_ORIGINS` when running with a tunnel).

### Common commands

Every script below is a root `package.json` script, run from the repository
root with `pnpm <script>`.

| Command                             | What it does                                                               |
| ----------------------------------- | -------------------------------------------------------------------------- |
| `pnpm dev`                          | Web app + Inngest dev server + Cloudflare tunnel, together                 |
| `pnpm dev:local`                    | Same, without the tunnel                                                   |
| `pnpm build`                        | Production build of the web app                                            |
| `pnpm start`                        | Runs the production build                                                  |
| `pnpm test`                         | Vitest, the whole suite                                                    |
| `pnpm test:watch`                   | Vitest in watch mode                                                       |
| `pnpm typecheck`                    | `tsc --noEmit` across every package                                        |
| `pnpm lint`                         | ESLint across every package                                                |
| `pnpm db:generate`                  | Generates a Drizzle migration from schema changes                          |
| `pnpm db:migrate`                   | Applies pending migrations                                                 |
| `pnpm db:studio`                    | Opens Drizzle Studio against your database                                 |
| `pnpm auth:generate`                | Regenerates Better Auth's schema after a plugin change                     |
| `pnpm tunnel` / `pnpm tunnel:quick` | Named or throwaway Cloudflare tunnel — see below                           |
| `pnpm changelog:add`                | Interactive helper: adds a CHANGELOG.md entry and your CONTRIBUTORS.md row |

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contributor workflow —
branching, commit conventions, what to run before opening a PR, and the areas
of the codebase where a plausible-looking change causes real harm.

### Running on a public HTTPS origin

Several things need one, and every one of them fails silently without it:
inbound webhooks (so bounces are never suppressed), RFC 8058 one-click
unsubscribe, passkeys, and service workers — which means a PWA cannot be
installed or tested from a phone, because a phone is not `localhost`.

```bash
pnpm tunnel         # named Cloudflare tunnel on a hostname you own
pnpm tunnel:quick   # throwaway *.trycloudflare.com URL, no account needed
```

Either one prints the two values to set — `NEXT_PUBLIC_APP_URL` and
`ALLOWED_DEV_ORIGINS` in `.env.local`, plus the App URL in Settings. Add
`--apply` to have the first written for you.

Prefer the named tunnel. The app URL is the passkey relying-party id and the
domain every unsubscribe link points at, so a hostname that changes each run
invalidates both.

Then point the Resend webhook at `https://<your-host>/api/webhooks/resend`,
subscribe to `email.received` plus the delivery events, and paste the
`whsec_…` secret into Settings → Email.

`pnpm dev` starts the tunnel alongside the web and Inngest processes;
`pnpm dev:local` skips it. A missing or unconfigured `cloudflared` costs you
the tunnel, not the dev server.

Full walkthrough: [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md). Installing as an
app, offline behaviour and push notifications: [docs/PWA.md](docs/PWA.md).
MX records and production hosting:
[docs/SELF-HOSTING.md](docs/SELF-HOSTING.md).

---

## Deploy to Vercel

Vercel is the primary deployment target, and the whole configuration is two
settings and two environment variables.

### 1. Import the repository

At [vercel.com/new](https://vercel.com/new), import your fork and then set:

| Setting | Value |
| --- | --- |
| **Root Directory** | `apps/web` |
| Framework | Next.js — detected |
| Build command | `pnpm build` — declared in `apps/web/vercel.json` |
| Install command | leave empty |

**Root Directory is the one setting that must be changed by hand.** The
monorepo root contains no framework, so a root deploy detects nothing and
fails complaining about a missing output directory rather than about the
setting that is actually wrong. Everything else is either detected or declared
in [apps/web/vercel.json](apps/web/vercel.json); the install command is
deliberately left to Vercel, which installs the whole pnpm workspace from the
repository root, where the lockfile is.

### 2. Create the schema, once, from your machine

Nothing in the build does this, on purpose: Vercel builds preview and
production deployments identically, so a migration step in the build would let
a preview branch migrate your production database.

```bash
DATABASE_URL="<your production connection string>" pnpm db:migrate
```

Forgetting is not fatal, or even confusing — the app probes for its tables with
`to_regclass`, which tells "not migrated" apart from "cannot connect", and the
wizard stops on a `needs-migration` step instead of showing a broken form.

### 3. Set two environment variables

`DATABASE_URL` and `AUTH_SECRET`, and nothing else is required. Deploy, open
the URL, and finish the wizard in the browser — Resend, Redis, Inngest and
branding are all saved to your database, so changing any of them later needs no
redeploy.

Four keys from a development `.env` are actively wrong in production, and each
one fails quietly:

| Key | Why not |
| --- | --- |
| `INNGEST_DEV` | Campaigns queue and never send. Nothing errors. |
| `NEXT_PUBLIC_APP_URL` | A `localhost` value puts `localhost` in every unsubscribe link and email logo. |
| `REDIS_URL` | A `redis://` socket cannot be held by a serverless function. Use `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`, or omit Redis. |
| `NEXT_PUBLIC_ENABLE_SW` | Development-only. The service worker registers in production regardless. |

Set `DATABASE_POOL_MAX=2` as well if the URL points at a pooler (Neon's
`-pooler` host, Supabase port 6543, any PgBouncer). Every warm function is its
own process with its own pool, so the default of 10 becomes 10 × however many
instances are running.

### 4. Point the two webhooks at the deployment

- Inngest app → `https://your-domain.com/api/inngest`
- Resend webhook → `https://your-domain.com/api/webhooks/resend`

Then set the App URL in Settings to the production domain, no trailing slash.

### Function limits

Fluid Compute is on by default and allows 300 seconds on Hobby. The three
streaming and job routes declare `maxDuration = 300`, which sits exactly at
that ceiling — if you *disable* Fluid Compute, Hobby drops to 60 seconds and
those declarations fail the build.

Neither limit threatens correctness. Both `EventSource` clients reconnect on
their own, so the cap only changes how often that happens, and a long campaign
is not one long call: Inngest invokes the endpoint once per step, so a
200,000-recipient send is thousands of short invocations.

The full walkthrough, including any other Node host, a VPS and Docker:
[docs/SELF-HOSTING.md](docs/SELF-HOSTING.md).

---

## How the real-time part works

**Resend has no WebSocket or streaming API.** Inbound mail and delivery events
arrive as ordinary HTTP webhooks. Anything that claims otherwise is guessing.

So the live updates are ours, end to end:

```text
  Resend  ──webhook──▶  /api/webhooks/resend
                              │
                     verify (Svix) → dedupe → persist
                              │
                        Redis PUBLISH
                              │
   browser ◀──SSE──  /api/realtime/stream  ──SUBSCRIBE──▶ Redis
```

Redis is in the middle because a webhook lands on whichever serverless instance
the platform picks, which is almost never the one holding the browser's
connection. Server-Sent Events rather than WebSockets because the traffic is
strictly one-way, SSE reconnects on its own, and it needs no long-lived server
process.

Redis is **optional**. Without it, publishing is a no-op and the inbox updates
on navigation instead of instantly — everything else is unaffected, because
Postgres was always the source of truth.

The client nudges its local state immediately, then triggers a debounced
`router.refresh()`. Postgres stays the source of truth; realtime is a latency
optimisation and never a correctness mechanism. Missing an event costs you a
few hundred milliseconds, not a message.

Two more consequences of the webhook design worth knowing:

- `email.received` carries **metadata only** — no body, no headers, no
  attachments. An inbound message therefore lands in two phases: the row and
  its notification first, the content a moment later once a job has fetched it.
  The UI says "Fetching message…" rather than pretending the email is empty.
- Delivery is **at-least-once** with retries at 5s, 5m, 30m, 2h, 5h and 10h.
  Every handler assumes duplicates and dedupes on the `svix-id`.

---

## How the service worker works

Sendstack is an installable PWA, and the worker is a real one rather than a
manifest and a hope. The implementation is
[`@sendstack/pwa`](packages/pwa/README.md) — a package this app consumes the
same way any other Next.js project can — and
[docs/PWA.md](docs/PWA.md) is the operator's guide. This section is the
architecture, for anyone extending it.

```text
  apps/web/src/sw/sw.js              the entry: __WB_MANIFEST + this app's policy
            │  imports
            ▼
  @sendstack/pwa/sw  createServiceWorker(options)
            │
  apps/web/scripts/build-sw.mjs  ──▶  esbuild bundle  ──▶  injectManifest
            │  (reads pwa.config.mjs)                            │
            ▼                                                    ▼
      pnpm dev / pnpm build                             apps/web/public/sw.js
                                                        (generated, gitignored)
```

`public/sw.js` is **generated**. Editing it does nothing; edit
`src/sw/sw.js` and run `pnpm --filter @sendstack/web build:sw`.

### The caching position

The two obvious designs are both wrong for a mail client. Caching nothing but
build output is honest and produces an installed app that shows a dead end
with no connection — which, on a phone, is most of the time. Caching the API
wholesale gives an app that cheerfully shows a week-old inbox as though it were
mail.

So: **serve what has already been seen, and say how old it is.**

| Request                                              | Strategy                                                          | Cache              |
| ---------------------------------------------------- | ----------------------------------------------------------------- | ------------------ |
| `/_next/static/*`                                    | cache-first — the URL is content-hashed, so a hit cannot be stale | `sendstack-static` |
| Document navigations                                 | network-first, 4s timeout, `/offline` as the catch handler        | `sendstack-pages`  |
| RSC payloads (`?_rsc=`)                              | network-first, prefetches excluded                                | `sendstack-rsc`    |
| The four cursor-paginated list endpoints             | network-first, 5s timeout                                         | `sendstack-data`   |
| Avatars, branding, attachments                       | network-first                                                     | `sendstack-media`  |
| `/api/auth/*`, `/api/compose/send`, both SSE streams | **never touched**                                                 | —                  |

Every strategy is network-first, so a working connection always wins and
nothing is served stale while the network can answer. Four properties follow
from that, and each is load-bearing:

1. **Cacheable API routes are an allowlist**, in `src/sw/sw.js`. A route added
   next month is uncached until somebody decides otherwise, which is the only
   version of this that stays correct. `src/sw/sw.test.ts` fails if a listed
   path does not exist, if a credential or mutation route appears in it, or if
   an SSE route is not in the exclusion predicate.
2. **Stale responses are labelled.** The worker stamps
   `x-sendstack-from-cache` and `x-sendstack-cached-at` on anything it replays;
   `noteFreshness` reads them in the fetch layer and the connection banner
   turns them into _"Offline — showing mail as it was 12 minutes ago"_,
   reporting the oldest panel on screen. Caching mail is only defensible if
   the reader is told when it is old.
3. **Sign-out purges it.** Four of the five caches hold somebody's mail, so
   `purgeCachedMail()` deletes them — otherwise a shared laptop hands the next
   person the last inbox somebody read, from disk, with no session and no
   request the server could refuse.
4. **The server says `no-store` and the worker stores it anyway.** Not an
   oversight: `Cache-Control` governs the browser's HTTP cache, which is
   shared, opaque and unpurgeable, and refusing it there is still right. Cache
   Storage is none of those things — the worker decides what goes in, for how
   long, and sign-out empties it.

Two limitations stated plainly: an offline search only finds what was searched
online (the query string is part of the cache key), and following a link
offline works for journeys already taken — Next keys a client navigation on the
router state it started from.

What that adds up to, offline: launching the installed app works, reopening a
thread you had opened works, scrolling a list you had loaded works, and inline
images in a cached thread work. Tapping through to a thread you have never
opened gives you `/offline`, honestly. [docs/PWA.md](docs/PWA.md) has the full
table, and `packages/pwa/src/sw/create.test.ts` asserts every one of those
routing decisions — the strategies are Workbox's job and tested upstream; which
request gets which strategy, and which gets none, is ours.

### The offline outbox

A reply written with no connection is not refused. `queueSend()` hands the
worker a `POST /api/compose/send`, which `workbox-background-sync` holds in
IndexedDB, and Background Sync replays it. A **route**, not a Server Action:
action ids are generated per build and their bodies are opaque, so a queued
action is a request that can never be replayed.

The replay policy is the reason `createServiceWorker` writes its own `onSync`
rather than using Workbox's default:

- a **4xx** is final — the request itself is wrong, and replaying it on every
  reconnect would retry forever;
- a **5xx or network failure** goes back on the _front_ of the queue and stops
  the drain, so ordering survives a bad connection;
- either way the page is told by `postMessage`, because the send may have gone
  out while the tab was closed.

Only Chromium implements Background Sync. On Safari and Firefox the page's own
`online` event calls `flushQueue()`, which means the tab has to be open — a
platform limit, not a setting.

### Push notifications

One notification per inbound conversation: the sender as the title, `subject —
snippet` truncated on a word boundary as the preview, the thread key as the tag
so ten replies replace each other rather than stacking, and
`/inbox/<id>` as the destination.

Fired from `hydrateInboundEmail` rather than from the webhook, because the
webhook payload is metadata only — a notification sent from there would say
"New message" and open a thread with nothing in it.

`notificationclick` tries four things in order: focus a window already showing
that thread (navigating to the URL it is already on would reload it and lose
the reader's place), else focus and navigate an existing window, else open a
new one if `navigate()` refused — it rejects for a client the worker does not
control, which is any tab opened before the worker activated, and doing nothing
there was a real bug — else open a window because the app was closed. All four
are covered by tests.

Signing needs a VAPID pair. **Settings → Notifications → Generate keys**
creates one, stores the public half and contact as settings and the private
half encrypted, and takes effect without a restart;
`npx sendstack-pwa vapid` prints one for the environment instead. Generate it
**once** — a browser binds each subscription to the public key it was created
with, so rotating silently stops notifications on every subscribed device,
which is why rotation deletes those rows and asks first.

Both halves are validated on read, and a malformed one reports the instance as
_unconfigured_ rather than reaching the browser. That is not defensive
programming for its own sake: `.env.example` once documented these with an
ellipsis placeholder, `VAPID_PUBLIC_KEY="…"`, and uncommenting it made the key
the single character U+2026. It is a non-empty string, so the instance called
itself configured, the value reached `atob`, and the browser said _"The string
to be decoded contains characters outside of the Latin1 range"_ — which
mentions neither VAPID nor the file it came from. Worse, reporting
`configured: true` hid the panel that would have generated a real pair, so the
state could not be escaped from inside the app.

### Registration, and why it is off by default

`ServiceWorkerBridge` registers `/sw.js` on `load`, and only when
`NODE_ENV === "production"` or `NEXT_PUBLIC_ENABLE_SW=1`. A worker caching
build output that changes on every keystroke is a morning spent wondering why
an edit did not apply.

`pnpm dev` writes that flag into `.env.local` alongside the tunnel hostname,
because a tunnel exists _for_ installing the app on a phone. Without it the
worker is built, served over HTTPS and reachable — and nothing registers it,
which looks identical to a broken PWA. The bridge now logs why it did nothing,
warns on an insecure origin, and logs a failed registration rather than
swallowing it.

A development worker caches **nothing that was rendered** — only the precache,
push and the outbox. Caching rendered content there served stale HTML to a
freshly-compiled client and produced a hydration mismatch, and it needed no
network failure to do it: `NetworkFirst` gives four seconds, which a dev server
compiling a route behind a tunnel routinely exceeds. Offline reading therefore
needs `pnpm build && pnpm start` to test. See [docs/PWA.md](docs/PWA.md).

A service worker needs a secure context. `localhost` counts; a LAN address
does not, which is why testing on a phone needs the tunnel.

**Installability** is a fixed checklist, not a matter of taste: Chromium gates
`beforeinstallprompt` on HTTPS, a manifest with a name, a `start_url`, a
`display` of `standalone`/`fullscreen`/`minimal-ui`, 192px and 512px icons, and
a registered worker with a fetch handler. Miss one and the Install row never
appears with nothing said anywhere — so `apps/web/src/app/manifest.test.ts`
checks each criterion, including that the icon files the manifest names exist
in `public/`.

---

## Repository layout

```text
apps/
  web/               Next.js app — UI, Server Actions, API routes
packages/
  shared/            Zod schemas, enums, email normalisation, realtime contract
  db/                Drizzle schema, migrations, client
  config/            Settings store, secret encryption, setup state
  auth/              Better Auth server + client
  email/             Resend: send, receive, webhook verification, rendering
  jobs/              Inngest functions — send pipeline, scheduler, reconcilers
  redis/             Optional pub/sub and webhook dedupe, two transports
  pwa/               Service worker, offline outbox, install + push hooks
  theme/             Design tokens, light/dark provider and its controls
```

**Every package has its own README**, and that is the place to start before
changing one. Each covers the same ground: what the package is for, who
imports it and what they take, its public surface, the invariants an edit must
preserve, and how to test it.

| Package                               | What it owns                                                                                                                                          | Read its README before                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| [`shared`](packages/shared/README.md) | Contracts both the server and the browser use: Zod schemas, database enum vocabularies, address normalisation, merge fields, the realtime event union | Adding a constant, an enum value, an event type or a schema |
| [`db`](packages/db/README.md)         | The schema, the migrations and the one Postgres client. The constraints here _are_ the duplicate-safety guarantees                                    | Any schema change, or adding an index                       |
| [`config`](packages/config/README.md) | Runtime settings in Postgres, secrets encrypted at rest, setup state, the deliverability report                                                       | Adding a setting or a secret                                |
| [`auth`](packages/auth/README.md)     | Better Auth, configured from stored settings; `requireSession` and `getSession`                                                                       | Touching sign-in methods or session handling                |
| [`email`](packages/email/README.md)   | Everything that touches Resend, plus template rendering and unsubscribe signing                                                                       | Changing a send path, a webhook, or rendered markup         |
| [`jobs`](packages/jobs/README.md)     | Every Inngest function: the send pipeline, the crons, the reconcilers                                                                                 | Touching the send pipeline or adding a job                  |
| [`redis`](packages/redis/README.md)   | Optional realtime fan-out and the webhook dedupe pre-filter                                                                                           | Changing realtime behaviour                                 |
| [`pwa`](packages/pwa/README.md)       | The service worker, its caching policy, the offline outbox, install and push hooks                                                                    | Changing offline behaviour or the worker                    |
| [`theme`](packages/theme/README.md)   | The design tokens in `tokens.css`, the light/dark provider and its controls                                                                           | Changing a colour, or adding a theme or control             |

The dependency graph is acyclic, and worth checking before you add an import:

```text
shared, pwa, theme   no workspace dependencies at all
db                   shared
config               shared, db, pwa (VAPID key shape only)
redis                shared, config
email                shared, db, config
auth                 shared, db, config, email (it sends its own mail)
jobs                 shared, db, config, email, redis
apps/web             all of the above
```

Nothing reaches back up. `shared` in particular imports nothing from the
workspace and must not start: it is the one package a client component can
import freely, so a dependency on `db` or `email` there would pull Postgres or
the renderer into the browser bundle. `config` cannot import `auth` even
though `auth` reads its settings — the comment in `setup-state.ts` says so,
because the wizard has to run before any of it is configured.

Client components never call a service directly — they call a Server Action or
an API route, which calls a package.

---

## Design decisions worth knowing before you contribute

**Every address is normalised once, at the edge.** `normalizeEmail()` lowercases
and trims, and nothing writes an address that has not been through it. A
suppression list that misses `Bob@Example.com` because it stored
`bob@example.com` is worse than no suppression list.

**Sending twice is the failure that matters.** Three independent guards:
`campaign_recipients` is unique on `(campaign_id, contact_id)`; the worker
claims rows with a conditional `UPDATE … WHERE status = 'pending'` under
`FOR UPDATE SKIP LOCKED`; and every Resend call carries an idempotency key.

**Suppressed contacts still get a row.** They are inserted and then marked
`suppressed`, so a campaign carries a complete audit of who was considered and
why they were skipped. "Why didn't Dana get this?" is a question that gets asked.

**Inbound HTML is rendered, but never in the app's document.** It goes into an
iframe whose sandbox omits `allow-scripts`, under a CSP of `default-src 'none'`
with remote images blocked until asked for. `allow-same-origin` is present and
safe _only_ in that company — it is what lets the parent measure the content
and size the frame to it. The pairing never to write is `allow-same-origin
allow-scripts`, which lets a document remove its own sandbox.

**The formatted message is the default view.** A designed email's layout and
emphasis carry meaning the text alternative flattens away, so the rendered
version is what opens and the plain part sits behind "View plain text". A text
part that is really markup — some senders put the HTML body in both MIME parts
— is ignored rather than printed, which is where a preview full of visible tags
comes from.

**An attachment belongs to the draft, not to the form.** Files upload the
moment they are chosen and are stored against the draft row, so a closed tab
does not lose them, a retry does not re-upload 4MB, and the draft in the list
is not a lie about what would be sent. The bytes go in Postgres for the same
reason the logo does — a self-hosted install should need a database and nothing
else. Per-file size is capped at 4MB because Vercel caps a function request
body at 4.5MB whatever the framework config says.

**Inline images are linked, never embedded.** Gmail and Outlook strip `data:`
URIs, so an embedded image looks right in the composer and arrives as a broken
box. They are served from `/api/attachments/<id>` with an immutable cache and
`Content-Disposition: inline`; real attachments come back from the same route
as downloads with `nosniff`, so an uploaded SVG or HTML file cannot execute on
this origin. Both answer without a session, like the branding routes — a
recipient's mail client has no cookies here — and the random id is the
capability.

**Bulk sends carry no attachments.** A file repeated across ten thousand
messages is ten thousand copies over the wire, and it reads as spam. Link to it
in the body instead.

**Drafts live in the database, because Resend has no drafts.** The only
`draft` in its API is `Broadcast.status`, which describes an audience-wide
marketing send tied to a Resend segment — not a per-message draft. So a draft
is an `outbound_messages` row with `status = 'draft'`: the same table Sent
uses, which is what lets a draft _become_ a sent message by changing one
column rather than handing off between two tables at the exact moment a send
is most likely to fail.

**One composer, two send paths.** A message to one person is a single provider
call. A message to many becomes a campaign — because the campaign pipeline
already materialises recipients, checks suppressions, claims rows atomically,
batches under an idempotency key and tracks delivery per person. A second
sending path beside it would be a second path with one set of safeguards.

**A merge tag the list cannot fill blocks the send.** `{{ company }}` against a
CSV with no company column renders as nothing — "Hi Ada at ," — five hundred
times, and the first anyone hears of it is a reply. `unresolvableTags()` is
checked before anything is queued.

**Template metadata lives in `@sendstack/shared`, not `@sendstack/email`.** The
picker is a client component; importing the renderer to read four names and
descriptions would pull Postgres and Cloudinary into the browser bundle. It is
the sort of thing that fails at build time with a stack of `Can't resolve 'fs'`
and no obvious cause.

**A JavaScript array never goes straight into a raw query.** `= ANY(${ids})`
looks correct and is not: Drizzle spreads it into one placeholder per element,
producing `ANY(($1, $2))`, which Postgres rejects — at runtime, on the query
rather than at the call site. `sqlArray()` in `@sendstack/db` builds the array
literal with its cast, empty case included, and every raw query goes through
it.

**A campaign dialog creates a draft and stops.** Sending is a separate,
confirmed step on the campaign's own page, where the recipient count is
visible. A dialog that both writes a message and fires it at four thousand
people is one mis-click from being the worst button in the product.

**Counters are a cache.** `campaigns.sent_count` and friends are maintained
optimistically and reconciled from `campaign_recipients` every 15 minutes.
The recipient rows are the truth.

**Your logo is on a CDN, not in a function.** Every recipient who opens a
campaign fetches the logo embedded in it. Served from the app that is one
serverless invocation each; Cloudinary makes it free and faster. The database
fallback exists so `git clone && pnpm dev` needs no third-party account.

**The setup wizard is push, not poll.** It holds one SSE connection that the
server updates when setup state changes — deliberately independent of the Redis
pub/sub everything else uses, because Redis is one of the things being
configured and does not exist yet.

**Redis speaks two protocols, chosen by URL scheme.** `redis://` uses the wire
protocol, so a plain local Redis needs no account and no REST shim; `https://`
uses Upstash's REST API, which is what survives a serverless cold start. Three
operations are all the app needs from Redis, which is why supporting both costs
so little.

**Dark mode ships as a package, not a stylesheet.** `@sendstack/theme` owns the
palette, the provider and the toggle, so a new surface gets light and dark from
one import plus one component. The toggle renders _both_ icons and lets CSS
choose between them — a JavaScript-driven icon would either mismatch on
hydration or leave an empty square on first paint.

**Stored credentials are encrypted with AES-256-GCM**, keyed from
`AUTH_SECRET`. Authenticated encryption, so a tampered row fails loudly instead
of silently decrypting to something else. Nothing in the UI ever renders a
secret back — not even truncated.

**Clients are built lazily, from settings.** Resend, Redis, the Postgres pool
and the Better Auth instance are all constructed on first use and rebuilt when
their configuration changes. That is what lets the setup wizard run _before_
any of them are configured, and what lets a settings change take effect without
a restart.

---

## Roadmap

[docs/ROADMAP.md](docs/ROADMAP.md) covers what is planned and not built —
multi-tenancy, a hosted subscription tier, segments, a template editor — and is
explicit that none of it exists yet.

## Contributing

Issues and pull requests are welcome. The short version:

1. Fork the repo, branch from `main` (`fix/…`, `feat/…`, `docs/…`).
2. `pnpm install`, make your change, keep it scoped to one fix or feature.
3. Run `pnpm typecheck lint test build` — all four, not just the package you
   touched.
4. For anything beyond a typo, run `pnpm changelog:add` and include the
   `CHANGELOG.md`/`CONTRIBUTORS.md` diff in your PR.
5. Open the PR against `main` and describe what changed and why.

[CONTRIBUTING.md](CONTRIBUTING.md) has the full workflow, a table of where
each kind of change lives in the codebase (`packages/db` for schema,
`packages/email` for anything Resend, `apps/web/src/actions` for mutations,
and so on), and the invariants — suppression, idempotency, address
normalisation — that a plausible-looking change can break without a test
noticing. [CHANGELOG.md](CHANGELOG.md) tracks what shipped and
[CONTRIBUTORS.md](CONTRIBUTORS.md) tracks who shipped it.

Good first areas: a visual template editor, segments and filters, per-workspace
multi-tenancy, more sign-in methods (the auth layer is built to take them),
additional email providers behind the `@sendstack/email` interface, and A/B
subject testing.

## Licence

MIT. See [LICENSE](LICENSE).
