# Self-hosting Sendstack

**Most of this you no longer need to read up front.** Start the app and the
setup wizard walks you through every credential, with instructions and a live
Test button for each:

```bash
pnpm install
pnpm dev
```

Then open <http://localhost:3005>.

This document is the reference for what the wizard is asking for, plus the
parts it cannot do for you — DNS records, production hosting, and the two
values that must live in your environment.

---

## The two environment values

Everything Sendstack needs is configured in the browser and stored, encrypted,
in your database — except these:

| | Why it cannot be in the database |
|---|---|
| `DATABASE_URL` | Settings stored in Postgres cannot contain the credentials to reach Postgres |
| `AUTH_SECRET` | It is the key those stored secrets are encrypted with |

The wizard collects both, tests the database connection, and writes
`.env.local` when the filesystem is writable — a VPS, Docker, local
development. On a read-only serverless filesystem it detects that and gives you
the exact values to paste into your host's environment settings.

Generate the secret with:

```bash
openssl rand -base64 32
```

Treat it as permanent. Changing it signs everyone out, makes stored API keys
unreadable, and breaks the unsubscribe link in every email you have ever
sent — those must keep working for years.

---

## Where to run the pieces

1. [Managed services](#1-managed-services) — Neon, Upstash, Resend. Fastest.
2. [Fully local](#2-fully-local) — Docker, no accounts except Resend.
3. [Production](#3-production) — Vercel or any Node host.

Everything below assumes Node 22+ and pnpm 10+.

---

## 1. Managed services

### Postgres — Neon

Create a project at [neon.tech], copy the **pooled** connection string, and put
it in `DATABASE_URL`. The pooled host is the one with `-pooler` in it; the app
already disables prepared statements, which is what pooled connections need.

If the wizard reports that the schema is missing, apply it:

```bash
pnpm db:migrate
```

Any Postgres 14+ works — Supabase, RDS, Railway. Only the URL changes.

### Redis (optional)

Two options, and the URL scheme picks between them:

| Scheme | Client | Token | Best for |
|---|---|---|---|
| `redis://`, `rediss://` | Redis wire protocol | Not used — put credentials in the URL | Local dev, a VPS, Redis Cloud, Railway, Fly |
| `https://` | Upstash REST | Required | Serverless, including Vercel |

For local development, `docker compose up -d` and then
`redis://localhost:6379` in the wizard. Nothing else needed — no Upstash
account, and no REST shim in front of it.

On serverless, prefer Upstash. A `redis://` connection must be re-established
on every cold start, whereas the REST API is stateless.

`REDIS_URL` is honoured as an environment seed, which is the variable Railway,
Fly and Redis Cloud set automatically.

Skip it entirely and Sendstack still works correctly — you refresh to see new
replies instead of watching them arrive.

Use the REST credentials, not the `redis://` URL. Realtime updates ride on
Upstash's SSE-based `SUBSCRIBE`, which is a REST-API feature — a TCP client
cannot be used from a serverless function that has no persistent socket.

### Email — Resend

1. **API key** — [resend.com/api-keys]. Give it **sending *and* receiving**
   permissions. A send-only key produces an inbox that is silently always empty.
2. **Domain** — either verify one at [resend.com/domains], or use the
   `<id>.resend.app` subdomain Resend gives every account. The subdomain needs
   no DNS and can receive mail immediately, which makes it the right choice for
   a first run. Put whichever you use in `RESEND_DOMAIN`.
3. **Webhook** — see [Webhooks](#webhooks) below. The wizard shows you the
   exact URL to paste into Resend.

### Jobs — Inngest

Local development needs no keys: `pnpm dev` starts the Inngest dev server and it
discovers the app on its own.

For production, create an app at [app.inngest.com], point it at the URL the
wizard shows, and paste both keys into the Jobs step.

---

## 2. Fully local

Everything except Resend can run on your machine. Resend cannot — you need a
real mail provider to send and receive real mail.

The repository ships a `docker-compose.yml` with exactly this:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: sendstack
      POSTGRES_PASSWORD: sendstack
      POSTGRES_DB: sendstack
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

volumes:
  pgdata:
```

```bash
docker compose up -d
```

Then start the app and give the wizard these:

| Field | Value |
|---|---|
| Postgres connection string | `postgresql://sendstack:sendstack@localhost:5432/sendstack` |
| Redis URL | `redis://localhost:6379` |

```bash
pnpm db:migrate
pnpm dev
```

---

## Webhooks

This is the part that decides whether the inbox works, so it is worth doing
carefully.

### Why a webhook at all

Resend has **no WebSocket and no streaming API**. Every inbound message and
every delivery event arrives as an HTTP POST to a URL you nominate. Sendstack
turns that into live UI itself — webhook, Redis publish, SSE to the browser.

### Local development

Resend cannot reach `localhost`, so expose your dev server:

```bash
npx untun@latest tunnel http://localhost:3000
# or
cloudflared tunnel --url http://localhost:3000
```

Set `NEXT_PUBLIC_APP_URL` to the tunnel URL and restart `pnpm dev`.

### Creating it

In the Resend dashboard, add a webhook pointing at:

```
https://<your-domain-or-tunnel>/api/webhooks/resend
```

Subscribe to:

| Event | Why Sendstack needs it |
|---|---|
| `email.sent` | Confirms hand-off to the provider |
| `email.delivered` | Delivery counters |
| `email.opened` | Open counters |
| `email.clicked` | Click counters |
| `email.bounced` | **Suppression.** Hard bounces suppress immediately |
| `email.complained` | **Suppression.** Spam complaints suppress immediately |
| `email.received` | Inbound mail — the inbox |

Copy the signing secret (`whsec_…`) into `RESEND_WEBHOOK_SECRET`.

Without that secret the endpoint rejects everything, which is deliberate: an
unauthenticated webhook endpoint lets anyone forge a bounce and get an address
suppressed on your instance.

### Receiving at your own domain

Add the MX record Resend shows on the **Receiving** tab of your domain. Until
it resolves, mail to that domain will not arrive. The `<id>.resend.app`
subdomain skips this entirely.

### Checking it works

Send a message to any address at your receiving domain. Within a second or two
the thread should appear in the inbox with the note "Fetching message…", and
the body should fill in immediately after — that gap is the two-phase arrival
described in the README, not a bug.

If nothing appears:

- **Resend dashboard → Webhooks → the endpoint** shows every attempt and its
  response. A 400 means the signature failed — usually a mismatched secret.
- A 500 means the handler threw; check your server logs. Resend will retry at
  5s, 5m, 30m, 2h, 5h and 10h, so a fixed bug recovers on its own.
- If the row appears but the body never does, the API key is probably missing
  *receiving* permission.

---

## 3. Production

### Vercel

This is the primary target, so it is worth being specific.

**Import the repository, do not deploy the root.** At [vercel.com/new], pick the
repository and then set **Root Directory** to `apps/web`. This is the one
setting the import flow cannot infer: the monorepo root has no framework in it,
so a root-directory deploy detects nothing, builds nothing Next understands, and
fails with a message about a missing output directory rather than about the
setting that is actually wrong. Everything else is detected — `apps/web/vercel.json`
declares the framework and build command, and Vercel installs the whole pnpm
workspace from the repository root because the lockfile lives there.

The install command is deliberately *not* pinned in `vercel.json`. Vercel already
installs pnpm workspaces from the repository root with `--frozen-lockfile`; an
explicit `installCommand` runs relative to the Root Directory instead, so pinning
it changes which lockfile is validated — for no gain over the default.

Or from a machine with the CLI, run `vercel` inside `apps/web`.

Set **only** `DATABASE_URL` and `AUTH_SECRET` in the project settings. Deploy,
open the URL, and finish the wizard in the browser — everything else is saved
to your database, so changing a key later needs no redeploy.

**Do not paste your development `.env` in wholesale.** Four of its keys are
actively wrong in production, and each fails quietly:

| Key | Why not |
|---|---|
| `INNGEST_DEV` | Campaigns queue and never send. Nothing errors. |
| `NEXT_PUBLIC_APP_URL` | A `localhost` value puts `localhost` in unsubscribe links and email logos. Set the production URL, no trailing slash — or leave it out and set App URL in Settings. |
| `REDIS_URL` | A `redis://` server cannot be reached from a serverless function that holds no socket. Use `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`, or omit Redis entirely. |
| `NEXT_PUBLIC_ENABLE_SW` | Development-only. The worker registers in production regardless. |

`ALLOWED_DEV_ORIGINS` is ignored in production and harmless either way, and
`DATABASE_URL` should point at a production database rather than your
development one — see below.

**Create the schema first.** Nothing does this for you: the build runs
`next build` and no more, and there is deliberately no migration step in it —
Vercel builds preview and production deployments the same way, so a build hook
would let a preview branch migrate your production database. So against a fresh
database, once, from your machine:

```bash
DATABASE_URL="<your production connection string>" pnpm db:migrate
```

The app is not silent if you forget. It probes for `app_settings` and `user`
with `to_regclass`, which distinguishes "not migrated" from "cannot connect",
and the wizard stops on a `needs-migration` step rather than showing a broken
form. Run the command, reload, and it continues.

**A separate production database is the safe default.** It also means your
development accounts do not exist there — the wizard runs from the beginning
and creates the first admin account, which is what you want. Set
`DATABASE_POOL_MAX=2` while you are in the project settings if the URL points
at a pooler (Neon's `-pooler` host, Supabase port 6543, any PgBouncer): every
warm serverless function is its own process with its own pool, so the default
of 10 becomes 10 × however many instances Vercel has running.

**Do not set `INNGEST_DEV`.** It is `1` in local development and must be absent
in production. With it set, campaigns queue and never send, and nothing errors
— they simply sit there.

**Function duration.** Fluid Compute is enabled by default and gives Hobby up
to 300 seconds and Pro up to 800. The routes here declare `maxDuration = 300`,
which is inside the Hobby ceiling. If you *disable* Fluid Compute, Hobby drops
to 60 seconds and those declarations will fail the build — lower them, or leave
Fluid on.

**The SSE connections end when the function does.** Both `EventSource` clients
reconnect on their own, so a 300-second ceiling only changes how often that
happens, never correctness. The setup stream sends `retry: 1000` precisely
because the thing it is usually waiting through is a restart.

**Long campaigns are not one long function call.** Inngest invokes the endpoint
once per step, so a 200,000-recipient send is thousands of short invocations
rather than anything that could approach a timeout.

**Bootstrap on a read-only filesystem.** The wizard cannot write `.env.local`
on Vercel, detects that, and gives you the exact values to paste into the
project's environment settings. After you redeploy, the open setup page picks
up the change over SSE and moves on by itself.

**Configure Cloudinary.** Strongly recommended here specifically. Your logo is
embedded in every campaign and fetched by every recipient's mail client on
open; served from the app that is one function invocation each. See
[Image hosting](#image-hosting) below.

Once the wizard is done:

- Set the **App URL** in Settings to your production URL, no trailing slash.
  Unsubscribe links and the logo inside your emails resolve against it.
- Point the Inngest app at `https://your-domain.com/api/inngest`.
- Point the Resend webhook at `https://your-domain.com/api/webhooks/resend`.

### Image hosting

Cloudinary is optional but recommended, and free at the volumes this needs.

1. Create an account at [cloudinary.com].
2. The Dashboard shows **Cloud name**, **API key** and **API secret**.
3. Paste all three into the wizard's Branding step and press Test.

Without it, images are stored in Postgres and served by the app. That is fine
locally and for small installs. It becomes expensive exactly when a campaign
does well.

All three values or none — a partial configuration fails at upload with an
opaque signature error rather than falling back.

### Any Node host

```bash
pnpm install
pnpm build
pnpm start
```

Runs anywhere Next.js does — Fly, Railway, Render, a VPS. A long-running host
actually suits the SSE endpoint better than serverless, since connections are
not capped by an execution limit.

### Before you send to real people

- [ ] `pnpm db:migrate` has been run against the **production** database.
- [ ] `INNGEST_DEV` is **not** set in the production environment.
- [ ] The App URL in Settings is the production domain, with no trailing slash.
- [ ] SPF, DKIM and DMARC verified in Resend for the sending domain.
- [ ] Open registration is **off** in Settings → Sign-in.
- [ ] At least two sign-in methods enabled, so losing one is not a lockout.
- [ ] `AUTH_SECRET` is 32+ random characters and **will never be rotated**
      casually — it signs unsubscribe links that must keep working for years,
      and it is the key your stored API keys are encrypted with.
- [ ] The send rate in Settings → Email matches your Resend plan.
- [ ] Cloudinary configured, if you are on Vercel and expect real volume.
- [ ] Send a campaign to a list of one — yourself — first.
- [ ] Confirm the unsubscribe link in that message works.

---

## Troubleshooting

**The setup wizard says "Set an auth secret first", but my `.env` has one.**

Restart the dev server. Environment files are read once at startup, so a value
added while the server was running is not picked up. The `.env` belongs at the
**repository root** — `next.config.ts` loads it from there explicitly, because
`next dev` runs inside `apps/web` and would otherwise never see it.

**Migrations work but the app says nothing is configured.**

Same cause, and it is worth naming because the symptom is confusing:
`pnpm db:migrate` loads the root `.env` itself, so it can succeed while the app
sees nothing. Restart the app.

**I changed an environment variable and nothing happened.**

Expected, after setup. Values resolve database-first — the environment is only
a first-run seed. Change it in Settings, where each field is labelled with
where its value actually came from.

**The setup wizard is stuck on a step I already finished.**

It should not be — the page holds an SSE connection and follows the server
forward. If it is stuck, check that `/api/setup/stream` is reachable; some
corporate proxies buffer `text/event-stream` despite the `X-Accel-Buffering`
header. Reloading always works as a fallback.

**My logo does not appear in emails.**

Check the App URL in Settings. A database-backed logo is served from this app,
so the link inside an email is your App URL plus a path — if that is still
`http://localhost:3000`, no recipient can load it. Cloudinary-hosted logos are
absolute already and are immune to this.

**The inbox is empty but Resend has received mail.**

Press **Sync** in the inbox header. It pulls straight from Resend's API rather
than waiting for a webhook, and will import anything that was missed.

Then fix the cause, because Sync is a repair tool, not the delivery path.
Check in this order — each one produces an empty inbox with no error anywhere:

1. **Is a webhook configured at all?** Resend → Webhooks. A brand-new account
   has none, and without one nothing is ever sent to Sendstack. Subscribe it to
   `email.received` and the delivery events.
2. **Can Resend reach your webhook URL?** It must be a public address. A
   `localhost` app URL cannot receive webhooks — use a tunnel in development
   (`npx untun@latest tunnel http://localhost:3000`) and set the app URL to the
   tunnel address.
3. **Does the sending domain in Settings match a domain verified in Resend?**
   A placeholder like `mail.example.com` left over from `.env.example` looks
   harmless and breaks sending.
4. **Does the API key have receiving permission?** A send-only key produces a
   permanently empty inbox while campaigns go out normally.
5. **Is the MX record verified?** Resend → Domains → your domain → Receiving.

Messages that arrive while any of these is wrong are not lost — Resend keeps
them, and the hourly reconciler (or the Sync button) imports them once the
configuration is right.

**A message shows in the list but has no body.**

Expected for a second or two: Resend's webhook carries metadata only, and the
body arrives from a follow-up API call. If it persists, background jobs are not
running — check Inngest. Sync fetches bodies inline, so it also repairs this.

---

## Upgrading

```bash
git pull
pnpm install
pnpm db:migrate
```

Migrations are additive and versioned in `packages/db/migrations`. Review the
SQL before running it against production data.
