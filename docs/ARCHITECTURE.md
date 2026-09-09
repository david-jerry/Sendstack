# Architecture

How Sendstack is put together, and why — particularly the parts where the
obvious implementation is wrong.

---

## The two flows

Everything is one of these.

### Outbound

```
Server Action ──▶ campaigns row (status: scheduled)
       │
       └──▶ Inngest: campaign/queue.requested
                  │
                  ├─ INSERT … SELECT: one campaign_recipients row per list member
                  ├─ UPDATE … : mark suppressed / inactive contacts
                  └──▶ campaign/send.requested
                             │
                             └─ loop, ≤25 batches per run:
                                  claim 100 rows  FOR UPDATE SKIP LOCKED
                                  render          per-recipient merge fields
                                  resend.batch.send(idempotencyKey)
                                  update rows     sent / failed
                                  publish         campaign.progress
                                ── still work left? re-emit with pass+1
```

### Inbound

```
Resend ──webhook──▶ /api/webhooks/resend
                          │
                    verify (Svix)
                    dedupe (Redis claim, then unique index)
                    INSERT inbound_emails   ← metadata only
                          │
                          ├──▶ Redis PUBLISH  ──▶ SSE ──▶ browser
                          └──▶ Inngest: email/inbound.received
                                     │
                                     ├─ resend.emails.receiving.get(id)
                                     ├─ UPDATE row: body, headers, thread key
                                     └──▶ Redis PUBLISH ──▶ SSE ──▶ browser
```

An inbound message therefore arrives **twice** in the UI: once as a header-only
row, once complete. That is not an artefact of this design — it is forced by
Resend, whose `email.received` payload contains no body. The schema names the
gap (`content_fetched_at`) and the UI states it ("Fetching message…") rather
than rendering a convincing empty email.

---

## Bounded contexts

The two flows above are what the product *does*. This is who owns each part of
doing it — written down because the failures this codebase has actually had
were almost all one rule living in two places, and "which module owns this
rule" is the question that stops the second copy being written.

Nothing here is a new package. The contexts are ownership boundaries drawn
across the packages that exist, and the [execution plan](DDD-EXECUTION-PLAN.md)
moves code toward them one sprint at a time.

### Ownership matrix

Every flow-critical file appears in exactly one row. A new Server Action, API
route or job adds itself to a row in the same PR — see the plan's S5-ARC-3 for
the test that will enforce it.

| Context | Owns | Aggregate and its invariants | Proving tests |
|---|---|---|---|
| **Identity & Access** | `packages/auth`; `apps/web/src/app/api/auth/[...all]/route.ts`; `actions/profile.ts`, `actions/push.ts`; the auth half of `actions/settings.ts` | *AuthPolicy* — at least one sign-in method enabled; one send gate, `assertCanSend`, on every send-capable surface; refusals recorded in `policy_decisions` | `auth-schema.test.ts`, `policy.test.ts`, `policy-gate.integration.test.ts` |
| **Contact & Audience** | `actions/contacts.ts`, `actions/templates.ts`; `api/contacts`, `api/templates/preview`; `lib/queries/audience.ts`; the audience half of `packages/db/src/schema` | *Contact, List, Group* — addresses normalised at ingestion; one row per address; slugs unique by index, not by lookup | `contacts.slug.integration.test.ts`, `queries.integration.test.ts` |
| **Suppression & Deliverability** | `packages/db/src/suppression.ts`; `lib/queries/suppressions.ts`; `actions/suppressions.ts`; `api/unsubscribe`; `packages/config/src/deliverability.ts` | *Suppression* — checked on every send path through `isUnsendable`; bounces and complaints irreversible; soft-bounce counter increments and tests in one statement | `suppressions.integration.test.ts`, `campaigns.guards.integration.test.ts` |
| **Campaign Orchestration** | `actions/campaigns.ts`; `api/campaigns`; `packages/jobs/src/functions/queue-campaign.ts`, `scheduler.ts` | *Campaign* — legal transitions only, claimed with `UPDATE … WHERE status = … RETURNING`; materialised once; a cron tick and a manual send in the same minute produce one queue | `pipeline.duplicity.integration.test.ts`, `campaigns.guards.integration.test.ts` |
| **Delivery Execution** | `packages/jobs/src/functions/send-campaign.ts`, `outbound-store.ts`, `delivery-sql.ts`; `packages/email/src/send.ts`; `actions/compose.ts`, `actions/thread.ts` (send halves); `api/compose/send`; `lib/queries/outbound.ts` | *CampaignRecipient, OutboundMessage* — one row per `client_key`; provider idempotency key per send; status **and** event ladders monotonic; `last_event` single-dialect under `outbound_last_event_bare` | `compose.replay.integration.test.ts`, `thread.reply-replay.integration.test.ts`, `reconcile.integration.test.ts`, `delivery-status.test.ts` |
| **Inbound Processing** | `api/webhooks/resend`; `packages/jobs/src/functions/fetch-inbound.ts`, `inbound-store.ts`; `actions/inbox.ts`, `actions/attachments.ts`; `api/attachments/[id]`; `api/inbox/threads`; `lib/queries/thread.ts`, `inbox.ts` | *InboundMessage* — verified signature before any write; deduped by `email_events.provider_event_id` inside the same transaction as the effect; metadata first, body hydrated after; thread status written once, delta derived from the rows moved | `route.integration.test.ts`, `route.release.test.ts`, `thread-status.integration.test.ts`, `unread-count.integration.test.ts` |
| **Realtime Projection** | `packages/redis`; `packages/shared/src/realtime.ts`; `api/realtime/stream`, `api/setup/stream`; `stores/realtime-store.ts`, `hooks/use-realtime.ts` | *Projection* — schema-validated on publish and consume; publishes the row's stored state, never the incoming event; every consumer tolerates duplicates; a fresh server render always reseeds | `realtime-store.test.ts`, `client.test.ts`, the publish assertions in `route.integration.test.ts` |
| **Configuration** | `packages/config`; `actions/setup.ts`; the non-auth half of `actions/settings.ts`; `api/branding/*`, `api/avatars/*`; `api/inngest` | *Settings, Secret* — database before environment; secrets encrypted at rest; one schema per form shared by wizard and Settings; cache invalidated on every write | `config.test.ts`, `sender-config.test.ts`, `settings-defaults.test.ts` |

### Integration rules

- A command is synchronous only inside its owning context's transaction. The
  webhook handler writing `email_events` and updating a recipient in one
  transaction is Inbound Processing acting on a Delivery aggregate *by
  contract* — through `recipientStatusCase`, which Delivery owns — not by
  reaching into its tables freehand.
- Cross-context messages carry schemas from `packages/shared`, parsed by both
  producer and consumer. A stale deploy publishing an old shape must be
  *dropped*, not trusted.
- Realtime is a projection. It says what Postgres now holds; it never decides
  what Postgres should hold.
- Provider SDKs stay inside the owning package: Resend in `email`, Redis in
  `redis`, Inngest in `jobs`, Better Auth in `auth`. A client component never
  reaches one.

### Decision record

**Decided:** codify eight bounded contexts as ownership boundaries across the
existing packages; centralise each flow-critical invariant into one owning
module with one proving test; add a single Identity gate for send-capable
actions, unenforced by policy, with an append-only refusal log.

**Rejected — a rewrite into one package per context.** The dependency graph
(`shared → db → config → email/redis → auth → jobs → web`) already encodes most
of the boundaries, and the defects this project has had were duplicated rules,
not misplaced packages. Moving files does not remove a second copy of a rule;
naming an owner does.

**Rejected — an outbox table for realtime.** Reliable delivery of realtime
events would make the channel a source of truth, which `PRODUCT.md` forbids.
The channel is latency; the debounced refresh against Postgres is correctness.
An outbox would spend a table making the wrong thing reliable.

**Rejected — enforcing verification at sign-in.** `requireEmailVerification:
true` locks out the operator who just configured the sender that would deliver
the verification mail. Gating the *send* instead lets them in to fix it and
refuses only the action that mails strangers. Even that is unenforced today,
by decision; the gate exists so the decision is one value, not four `if`s.

**Consequences.** New surfaces must name an owner. Some rules will cross a
context's line to be enforced — suppression is checked by Delivery on a
Suppression aggregate — and that is done through the owner's exported function,
never a re-implementation. The refusal log is append-only and records only
refusals; recording allows would be an unbounded write on the hottest path.

---

## Why Server-Sent Events

The requirement — "real-time responses each time an email is received" — has an
obvious-looking answer that does not exist: Resend does not offer a WebSocket
or any streaming API. Inbound mail arrives by webhook, full stop.

So the transport is ours to choose, and the traffic has three properties:

1. **Strictly server-to-client.** The upstream half of a duplex connection would
   go unused. Replies are Server Actions, not socket frames.
2. **Bursty and infrequent.** A WebSocket's persistent connection buys nothing.
3. **Deployed to serverless as often as not.** A WebSocket needs a long-lived
   server process; SSE is a plain HTTP response held open.

SSE also reconnects on its own, needs no protocol upgrade at proxies, and
carries a `retry:` hint the browser honours. The whole client is one
`EventSource`.

**Redis sits in the middle** because a webhook lands on whichever instance the
platform routes it to, which is essentially never the one holding a given
browser's stream. Pub/sub bridges them.

**Pub/sub has no replay**, deliberately. A client disconnected when an event
fires never sees it — and does not need to, because on reconnect the UI
refetches from Postgres. Realtime is a latency optimisation. Postgres is the
truth. Getting this backwards is how a "realtime" app ends up with a cache
invalidation problem it cannot debug.

The chain in code:

| Step | File |
|---|---|
| Publish | [`packages/redis/src/realtime.ts`](../packages/redis/src/realtime.ts) |
| Subscribe → SSE | [`apps/web/src/app/api/realtime/stream/route.ts`](../apps/web/src/app/api/realtime/stream/route.ts) |
| Browser | [`apps/web/src/hooks/use-realtime.ts`](../apps/web/src/hooks/use-realtime.ts) |
| Store | [`apps/web/src/stores/realtime-store.ts`](../apps/web/src/stores/realtime-store.ts) |
| Contract | [`packages/shared/src/realtime.ts`](../packages/shared/src/realtime.ts) |

The contract is parsed with Zod on **both** ends. A stale deploy publishing an
old shape gets dropped rather than corrupting a newer client's state.

---

## Not sending twice

For a bulk sender this is the failure that matters. Everything else is a
cosmetic bug; this one emails ten thousand people twice.

Five independent guards, each sufficient on its own for a different failure:

**1. A unique index.** `campaign_recipients (campaign_id, contact_id)`. The
materialisation step is `INSERT … ON CONFLICT DO NOTHING`, so re-running it
after a partial failure converges instead of duplicating.

**2. A queueing claim.** `queueCampaign`'s first step is
`UPDATE campaigns SET status = 'sending', started_at = now() WHERE status IN
('scheduled','sending') AND started_at IS NULL RETURNING *`, and only the run
whose UPDATE matched materialises anything. `started_at IS NULL` is the load-
bearing part: a manual send and a cron tick can both emit for one campaign
inside the same minute, and the second finds the campaign already started.

**3. An atomic claim, inside a transaction.** The worker takes rows with
`UPDATE … WHERE status = 'pending'` inside a `FOR UPDATE SKIP LOCKED`
subquery, so two concurrent workers get disjoint slices. Claim, render, send
and the status write are one `db.transaction`: a failure anywhere rolls the
claim back, so a retry re-claims *the same* rows and builds a byte-identical
payload rather than stranding the first slice in `sending` forever.

**4. A provider idempotency key.** Every batch carries
`campaign:{id}:{runId}:{batch}`. The run id, not the pass number — a resumed
campaign restarts at pass 0, so a pass-based key would be reused against a
different set of recipients, which Resend rejects outright.

**5. A single definition of what an event means.** Delivery events and the
"never move backwards" ladder live in `@sendstack/shared`, and the SQL `CASE`
each consumer runs is generated from it. Three hand-written copies had already
diverged before this.

The same instinct appears in the Server Actions: `sendCampaignNow`,
`pauseCampaign` and `cancelCampaignAction` each transition with a `WHERE
status IN (…) RETURNING id` and only proceed if the UPDATE matched, so a
double-clicked button does nothing the second time and the person clicking
gets an answer rather than silence.

---

## Not sending to the wrong people

`suppressions` is the most important table in the project. Membership is
checked at three points, and nothing bypasses it:

- **At materialisation**, when a campaign's recipients are first written.
- **At every batch claim**, inside the claim's own transaction. A campaign can
  sit scheduled for a week or paused for a day, and anything that happens in
  between has to stop the rest of the send — checking only at materialisation
  meant it did not.
- **On every one-to-one path**, through `assertNotSuppressed` in
  `lib/queries/suppressions.ts`. One helper rather than a copy per action: the
  inbox reply composer had no check at all, which is exactly what a second
  copy of a rule eventually looks like.

All three ask the same question, and they ask it through the same SQL:
`isUnsendable` in `packages/db/src/suppression.ts`. That matters because
"suppressed" is two conditions, not one — a live row in `suppressions`, *or* a
contact whose `status` has left `active`. The campaign paths applied both and
the one-to-one path applied only the first, so a contact recorded as bounced
with no suppression row was refused a campaign and accepted for a reply. The
two campaign copies were kept in step by a docstring promising they were
identical "character-for-character", which is a promise between two copies
rather than one definition. It lives in `packages/db` rather than
`packages/shared` because it needs drizzle's `sql` tag, and shared has to stay
importable from a client component.

The helper normalises the addresses it is handed, and that is not redundant
with invariant 6. Every suppression is stored normalised and Postgres compares
text case-sensitively, so an address that reached a send path as typed rather
than through an ingestion boundary compared unequal to its own suppression —
which is exactly how the reply composer let `Ada@Example.com` through a block
on `ada@example.com`. Normalising at the boundary remains the rule; the helper
is the backstop that makes breaking it loud instead of silent.

| Event | Action |
|---|---|
| `email.bounced`, permanent | Suppress immediately |
| `email.bounced`, transient | Increment counter; suppress at `SOFT_BOUNCE_LIMIT` |
| `email.complained` | Suppress immediately |
| Unsubscribe link | Suppress, mark contact unsubscribed |
| Operator | Suppress, reason `manual` |

Three details that are easy to get wrong:

**Bounce classification fails safe.** Anything not recognisably transient is
treated as permanent. Being wrong in that direction costs one email; being
wrong the other way costs a sending domain.

**The soft-bounce counter increments and tests in one statement.** Read it in
Node, compare, write it back, and two concurrent bounce webhooks both read 2,
both write 3, and the address never reaches the limit.

**Bounces and complaints cannot be un-suppressed.** Only `manual` and
`unsubscribe` entries can be removed. A hard bounce is the receiving server
stating the mailbox does not exist — not a preference to override. The person
who wants to override it is invariably hunting for "missing" recipients.

Suppressed contacts still get a `campaign_recipients` row, marked `suppressed`.
Filtering them out of the SELECT would be cheaper and would leave no trace.

---

## Webhook handling

Four rules, in order of how much trouble ignoring each one causes.

**Verify against the raw body.** `await request.text()`, never
`request.json()` followed by `JSON.stringify` — re-serialising changes bytes
and the signature will never match.

**Assume duplicates.** Delivery is at-least-once, retried at 5s, 5m, 30m, 2h,
5h and 10h. Two guards: a Redis claim on the `svix-id`, then a unique index on
`email_events.provider_event_id`. Redis is the optimisation — it can evict a
key — and the index is the guarantee. The claim is released whenever the
handler fails after winning it, so Redis can never tell a retry "already seen"
about an event Postgres never received; without that, a transient database
error lost the webhook for the claim's 24-hour TTL, and only when Redis was
configured. `route.integration.test.ts` runs the handler twice with Redis
mocked absent and asserts one row.

**Answer quickly.** Anything slow gets retried, which manufactures the
duplicates above. Persist, hand off to a job, return 200. This is why fetching
the inbound body is a job and not an inline `await`.

**Return 200 for anything already handled or unrecognised.** A non-2xx puts the
event back on a ten-hour retry ladder.

Delivery events are correlated by a `recipient_id` **tag** attached at send
time, which Resend echoes back — preferred over the provider message id,
because the tag is our own row id and does not depend on having correctly paired
a batch response to its inputs. The status `UPDATE` uses a `CASE` ladder so
out-of-order events cannot move a recipient backwards: an open arriving after a
bounce must not overwrite the bounce.

---

## Configuration

Sendstack configures itself through a wizard rather than a file, which forces
one structural question: where can configuration live?

### The bootstrapping floor

Two values cannot be stored in the database, for reasons that are not
negotiable:

- **`DATABASE_URL`** — settings kept in Postgres cannot contain the credentials
  needed to reach Postgres.
- **`AUTH_SECRET`** — it is the key the stored secrets are encrypted with, so
  it cannot be one of them.

Everything else moves into Postgres. The wizard collects these two first,
tests the connection live, and writes `.env.local` when the filesystem is
writable — otherwise it detects that and hands over the exact block to paste
into a hosting platform. Detecting rather than assuming matters: writing
blindly on Vercel appears to succeed and silently reverts on the next deploy.

### Three tables, three shapes of value

| Table | Holds | Why separate |
|---|---|---|
| `app_settings` | Names, URLs, colours, toggles | Plain and queryable. A domain name is not a secret and encrypting it only makes debugging harder |
| `app_secrets` | API keys, tokens | Encrypted at rest, one row per key. A careless `SELECT *` on settings cannot spill a key, and adding a secret needs no migration |
| `branding_assets` | Logo and favicon bytes | Reading configuration on every request must not drag a 200KB image along |

`app_settings` has a primary key whose only legal value is `'singleton'`. A
one-row table in Postgres is exactly this: `INSERT … ON CONFLICT (id) DO
UPDATE` then becomes an atomic upsert that cannot race a second row into
existence.

### Encryption

AES-256-GCM, keyed by scrypt from `AUTH_SECRET`, stored as a self-describing
`v1.<iv>.<tag>.<ciphertext>` envelope.

GCM rather than CBC because it is authenticated: a tampered row fails to
decrypt instead of quietly yielding different plaintext. For an API key that is
the difference between a loud error and silently sending mail through an
attacker's account.

The salt is fixed and versioned, which is the right call *here* and would be
wrong for password hashing. This is key derivation from one high-entropy
secret; a per-row salt would force a fresh scrypt — about 100ms — on every
secret read, on every request, buying nothing.

Rotating `AUTH_SECRET` therefore makes every stored secret unreadable.
`decryptSecret` says exactly that rather than surfacing Node's
"unable to authenticate data", and the config loader skips an unreadable secret
rather than failing the whole app — the Settings page has to stay loadable so
the value can be re-entered.

### Precedence: database first

A value resolves from the database if present, otherwise from an environment
variable, otherwise unset. The environment is a **first-run seed**.

The cost of that choice is real and worth stating: an operator who exports a
new `RESEND_API_KEY` on their host *after* setup will find it ignored. Every
field in Settings is therefore labelled with where its value actually came
from — "saved here", "cleared here" or "seeded from environment" — because the
alternative is an afternoon lost to a change that appears to do nothing.

**Clearing is a tombstone, not an absence.** Turning Redis or Cloudinary off in
Settings writes an empty value rather than a null, and the resolver stops there
without consulting the environment. Without that distinction, "off" was
indistinguishable from "never configured" and an instance with `REDIS_URL` in
its environment silently turned the feature back on — which is the opposite of
what this section promises.

### Caching

Configuration is read on nearly every request and decrypting costs an AES pass
per secret, so `getConfig()` caches for 10 seconds per process.

The honest consequence: on a multi-instance deployment a saved setting takes
effect immediately on the instance that handled the write, and within 10
seconds everywhere else. Cross-instance invalidation would need a pub/sub
channel — but the Redis credentials are themselves configuration, so that path
is circular. A few seconds of skew is the right trade.

### Everything is lazy

The Postgres pool, the Resend client, the Redis client and the Better Auth
instance are all built on first use and rebuilt when their inputs change.

This is not an optimisation. The setup wizard exists to *collect*
`DATABASE_URL`, and it transitively imports the database module — so an eager
client would crash the one page capable of fixing the problem. The same
reasoning applies to every other client: the app has to be able to run, and
render a useful screen, before it is configured.

For Better Auth specifically, laziness is what makes "turn passkeys on in
Settings" possible at all: the plugin list is fixed at construction, so
changing it means rebuilding the instance. Registering every plugin always and
gating them at the route would leave live endpoints for methods the operator
believes are off.

### Setup state

`getSetupState()` returns a discriminated union — `no-secret`, `no-database`,
`needs-migration`, `incomplete`, `needs-admin`, `complete` — and **never
throws**. Each branch is reachable on a real machine and needs a different
screen, and a setup wizard that crashes because the database it exists to
configure is unreachable would be useless precisely when it is needed.

---

## Email templates

Four designs — Simple, Announcement, Newsletter, Plain — built with React
Email and rendered server-side to HTML plus a plain-text alternative, and any
number of **uploaded templates**: complete HTML documents an operator adds in
Settings → Email, stored in the `templates` table and rendered by
`renderCustomTemplate()` through the same `renderCampaignEmail()` entry point.
Their contract — which placeholders exist, what is required, the `{{#if}}`
block — is defined once in `packages/shared/src/custom-templates.ts` and
documented in [CUSTOM-TEMPLATES.md](CUSTOM-TEMPLATES.md); the upload validator,
the renderer and the copy-to-clipboard prompts all read that one list.

The split of responsibility: **templates supply the chrome, the campaign
supplies the content**. Merge fields are substituted into the body *first*,
then the body is wrapped. Doing it the other way round would let a contact's
name interpolate into the template's own markup. For an uploaded template the
body is spliced in with a string split rather than through the placeholder
engine, so a literal `{{ … }}` left in a message is never resolved twice.

A message references its design as a `TemplateRef` — a built-in kind or
`custom:<uuid>` — which is one string through React state, the offline outbox
and the preview route, and becomes two columns on a campaign:
`email_template` for a built-in kind, `custom_template_id` as a foreign key
for an uploaded one. The send job loads the uploaded HTML once per run beside
the brand, never per recipient. Uploads are idempotent through a unique index
on the content checksum, and a template cannot be deleted while a draft,
scheduled or sending campaign points at it — the guard is inside the `DELETE`,
so nothing can interleave between the check and the write.

Details that are easy to get wrong and are handled here:

- **Inline styles only.** Gmail strips `<style>` in several contexts, Outlook's
  Word renderer ignores most of it, and no client supports custom properties.
  Sizes are in px because `rem` has no reliable root inside a mail client.
- **A plain-text alternative is always produced.** A message without one scores
  as more spam-like with essentially every filter.
- **The preheader is set explicitly.** Left unset, clients scrape the first
  words of the body — usually a stray merge field. It is the second most-read
  line in any campaign.
- **The logo URL is absolute and content-addressed.** A mail client has no page
  to resolve a relative path against, and providers cache images hard enough
  that a stable URL would pin an old logo in place after a rebrand.
- **Text on the brand colour is chosen by luminance.** Someone will pick pale
  yellow, and white on pale yellow is unreadable.
- **`Plain` is deliberately chrome-free** — no card, no logo, no colour. Heavy
  templates correlate with worse inbox placement, and anything meant to read as
  a message from a person should not arrive wrapped in brand furniture.

Logo and favicon bytes live in Postgres rather than object storage, so that
"clone it and run it" does not require an S3 bucket for the sake of two small
images. They are served behind an immutable, content-addressed URL. If you
outgrow that, `packages/config/src/branding.ts` is the only file that touches
the bytes.

---

## Authentication

Three methods, each independently toggleable, at least one always on.

| Method | Notes |
|---|---|
| Email + password | 12-character minimum |
| Passkeys | `@better-auth/passkey`. Bound to the exact origin; needs HTTPS (localhost exempt) |
| Magic links | Five-minute expiry, single use. Delivered by Resend |

Constraints the code enforces rather than merely documenting:

- **At least one method must stay enabled.** There is no recovery from an
  instance whose every login route is disabled, short of editing the database.
- **Magic links require a working Resend key.** The link arrives by email;
  enabling it without a sender produces an account nobody can sign in to.
- **Passkeys require a secure origin.** And because they are bound to the
  domain, changing the app URL later invalidates them — which is why keeping a
  second method enabled is more than a suggestion.
- **Registration is closed by default**, and the wizard opens it for exactly
  the duration of creating the first account. An instance on a public URL with
  open registration is an open relay with a nice dashboard.

Adding a fourth method means adding a toggle to `app_settings`, a plugin to the
list in `buildAuth`, and a button to the sign-in form. Nothing else changes.

---

## Two realtime channels, on purpose

Sendstack has two independent push mechanisms, and the split is not accidental.

| | `/api/realtime/stream` | `/api/setup/stream` |
|---|---|---|
| Feeds | The inbox, campaign progress | The setup wizard |
| Source | Redis pub/sub | Server-side polling of `getSetupState()` |
| Needs | Redis configured | Nothing |
| Auth | Session required | None — there is no account yet |
| Lifetime | While signed in | Until setup completes, then `410 Gone` |

The app stream uses Redis because a Resend webhook lands on whichever instance
the platform routes it to, essentially never the one holding a given browser's
connection. Redis bridges them.

### Two Redis transports

`packages/redis` supports both a plain Redis server and Upstash's REST API,
behind one interface, chosen by the URL's scheme.

| Scheme | Client | Token | Notes |
|---|---|---|---|
| `redis://`, `rediss://` | `@redis/client` | Not used | Credentials live in the URL, as every Redis tool expects |
| `https://` | `@upstash/redis` | Required | Stateless, so it survives a cold start |

This costs almost nothing because the interface is three operations wide —
`publish`, `setNx`, `subscribe`. That is deliberate: the moment it grows an
`eval` or a `zadd`, the two backends stop being interchangeable and start being
a compatibility project.

Details worth knowing:

- **Pub/sub needs its own connection.** A subscribed Redis connection cannot
  run ordinary commands; that is a protocol rule, not a preference. Both
  backends open a second one for `subscribe`.
- **The TCP client attaches an error handler to every connection.** An
  unhandled `error` event on a Node EventEmitter takes the process down, and a
  Redis outage must degrade the inbox to refresh-on-navigate, not crash the
  server.
- **The wizard's Test button uses a fail-fast probe.** The live client retries
  a refused connection five times; a person watching a spinner should not.
- **`claimOnce` fails open.** If Redis is unreachable it returns true and the
  webhook proceeds — the unique constraint on `email_events.provider_event_id`
  was always the real guarantee, and failing closed would silently drop genuine
  webhooks during an outage.
- **A stale token is ignored, not fatal.** Switching an Upstash URL to a
  `redis://` one leaves the old token in the settings table;
  `parseRedisTarget` disregards it rather than producing a half-configured
  client.

`REDIS_URL` is honoured as an environment seed alongside
`UPSTASH_REDIS_REST_URL`, because it is the variable Railway, Fly and Redis
Cloud set automatically.

The setup stream **cannot** use that, because Redis is one of the things the
wizard configures — and at the bootstrap step there is not even a database. A
stream that depended on either would be unavailable exactly when it is needed.
So it polls server-side every 1.5s and pushes only on change.

Server-side polling is what buys anything here: one held connection instead of
a request every two seconds from every open tab, and the browser hears about a
change within about a second rather than on whatever poll it happens to make
next.

**The comparison key excludes the timestamp.** That sounds trivial and is not:
an earlier version stamped `at` into the same string it compared against, so
every poll looked like a change and the "push only on change" logic pushed
every 1.5 seconds forever — waking every client, and in the bootstrap branch
triggering a `router.refresh()` each time.

### What this buys the user

The bootstrap step writes `.env.local` and the dev server restarts. Without the
stream, the page sits on "restart to continue" until somebody thinks to reload.
With it, the connection drops, `EventSource` reconnects on its own, the new
state arrives, and the wizard moves on. The same holds on Vercel after a
redeploy supplies the variables — which is the case that matters there, since a
read-only filesystem means the wizard can only hand over values to paste.

It also picks up progress made elsewhere: migrations applied in a terminal, or
a step finished in another tab.

The wizard follows the server **forward only**, and suppresses the stream for
eight seconds after a manual Back. `setup_step` never moves backwards, so
without that the next snapshot would immediately drag the user forward again
and the Back button would appear broken.

---

## Image hosting

Logo and favicon have two backends, chosen by whether Cloudinary is configured.
Callers never branch on it: `putBrandingAsset` picks, and `brandingRefs`
returns whichever kind of URL resulted.

**Cloudinary is the recommended path**, for a specific reason rather than
taste. A campaign embeds an *absolute* link to the logo, and every recipient's
mail client fetches it on open. Served from the app that is one serverless
invocation per recipient per open — a 50,000-person campaign turns a single
image into tens of thousands of function calls, and on Vercel that is a real
bill for serving one PNG. A CDN URL costs nothing and loads faster, which also
affects how the email renders.

**The database backend exists so the project stays clonable.** Requiring a
third-party account to see a logo would undo "clone it and run it".

Details worth knowing:

- `public_id` is deterministic — `<folder>/<kind>` — with `overwrite` and
  `invalidate` set. One asset per kind instead of an ever-growing pile of
  orphans, and the CDN edge is purged so a rebrand actually reaches people who
  already fetched the old file.
- Switching backends clears the other side. A Cloudinary-backed row nulls its
  `bytes`, so removing Cloudinary later cannot resurrect a stale logo from the
  fallback route.
- `/api/branding/logo` **redirects** rather than 404s when the asset has moved
  to Cloudinary, so links already sitting in delivered emails keep working.
- SVG uploads are sent with Cloudinary's `sanitize` flag. An SVG is an image to
  us and a script container to a browser.
- All three credentials or none. A partial configuration fails at upload with
  an opaque signature error instead of falling back, so `configured` requires
  the full set.
- `absoluteBrandingUrl` is the seam where a broken logo in every inbox comes
  from, and is unit-tested on its own.

---

## Composing

Replies are written in a small rich-text editor (Tiptap) offering bold, italic,
strikethrough, two heading levels, bulleted and numbered lists, quotes, links
and emoji — and nothing else. Tables, colours, fonts and images either break in
Outlook or need inline-styling gymnastics, and an editor that lets you build
something the recipient cannot see is worse than one that does not.

The editor emits semantic HTML, which `inlineEmailStyles()` converts to inline
`style` attributes before storing. That conversion is not cosmetic: Gmail
strips `<style>` in several contexts, Outlook renders through Word, and no
client supports custom properties. Styles are inlined **on save**, not on send,
so a draft is exactly what would go out.

The composer's own CSS mirrors those declarations closely enough that the
editor previews the message rather than being a different document.

Emoji are native Unicode from a curated set. The obvious library weighs about
40MB unpacked because it ships image assets and the full dataset — an absurd
cost for putting a smiley in a reply.

## Layout at different widths

Three breakpoints, and each one removes something rather than shrinking it.

| Width | Navigation | List + detail | Details sidebar |
|---|---|---|---|
| `< md` (phone) | Off-canvas drawer | **One at a time** | Hidden |
| `md`–`lg` (tablet) | Collapsible rail | Side by side | Hidden |
| `≥ lg` (desktop) | Collapsible rail | Side by side | Side by side |

**The sidebar is removed on a phone, not narrowed.** 57px of icons out of 375
is 15% of the screen spent on navigation you are not currently using. It
becomes a drawer, which is why `NavRail` renders twice — once docked, once
inside the sheet. Two instances of a component with no state of its own is
cheaper than one that has to know which context it is in.

**A phone shows the list or the reader, never both.** 375px split between them
leaves neither usable. `ListColumn` reads `useSelectedLayoutSegment()` and
hides itself once a detail route is open; `BackToList` is the way back and
exists only below `md`, because above it the list never went away. Both are
still rendered on desktop, which is what preserves the list's scroll position
across selections.

`useSelectedLayoutSegment()` reports the index child as `null` in some router
versions and the internal `__PAGE__` marker in others. Both are treated as
"nothing selected", or the list would vanish on its own route after an upgrade.

**Widths are classes, never a `style` attribute.** `Panel` used to take a
`width` number; a pixel value in inline styles cannot carry a breakpoint, so
it was the one thing guaranteeing the layout could not adapt.

### Collapsing

The rail collapses to icons, with the label moving into a tooltip — which is
not a nicety there, it *is* the label. Counts become a dot on the icon, since
the number no longer fits and what matters at a glance is only that there is
something.

The state is read from `localStorage` synchronously in a lazy initialiser, not
in an effect, so a collapsed sidebar does not flash open and snap shut on every
navigation. Writes are wrapped in try/catch: private browsing throws, and
losing the preference is acceptable where a failed click is not.

## Theming

`@sendstack/theme` owns three things: the design tokens, the provider, and the
controls. Adding light and dark to a new surface is an import and a component,
with no palette to copy — copied palettes drift, and two apps disagreeing about
what "muted" means is the kind of thing nobody notices until a screenshot.

```tsx
// The root layout, once.
<html suppressHydrationWarning>
  <body><ThemeProvider>{children}</ThemeProvider></body>
</html>
```

```css
/* The stylesheet, after @import "tailwindcss". */
@import "../../../../packages/theme/src/tokens.css";
@source  "../../../../packages/theme/src";
```

Both CSS lines are load-bearing:

- **The import** brings the tokens *and* the `dark:` variant definition. The
  class the provider sets means nothing without CSS that responds to it.
- **`@source`** is the one that bites. Tailwind v4 finds source files by
  walking out from the stylesheet and skipping `node_modules` — so a workspace
  package's components are never scanned, every class in them is absent from
  the bundle, and the toggle renders as unstyled markup with no error anywhere.

### Why a library rather than `useState`

`next-themes` injects a small blocking script into `<head>` that applies the
stored choice *before first paint*. Without it every load flashes the wrong
theme for a frame, which is far more noticeable than it sounds when the correct
answer is dark. That script is also why the root element carries
`suppressHydrationWarning`: it mutates the class before React hydrates, so
server and client markup genuinely differ on that attribute. This is the
sanctioned use of that prop, not a way to silence a real mismatch.

### The icon problem

The theme is only knowable on the client, so an icon chosen in JavaScript is
either wrong on the server — a hydration mismatch — or hidden behind a
`mounted` guard that leaves an empty square in the first frame.

`ThemeToggle` sidesteps it: **both icons are always rendered**, and the `dark:`
variant decides which is visible. The correct one is present in the very first
frame, from the same class the blocking script already set. The label is
"Toggle theme" for the same reason — true in both directions, so it needs no
client-only value.

`ThemeSelect` *does* use a mount guard, because showing which of three options
is active is genuinely unknowable on the server. It renders the same shape
either way, so nothing shifts when the answer arrives.

### Two states or three

A plain toggle can only express light and dark, so the first click silently
discards "follow the system" — the app stops tracking the OS for good. That is
the right trade in a sidebar, where there is room for one control. Settings
offers all three so the choice is recoverable.

The toggle flips against `resolvedTheme`, not `theme`: with the OS on dark and
nothing stored, one click must produce light. Flipping the stored value instead
would appear to do nothing.

### color-scheme

`:root` and `.dark` each set `color-scheme`. Without it a dark page gets a
bright white scrollbar, a white date picker and a white colour input — the
giveaway that dark mode was painted on rather than declared.

---

## Data model notes

**Addresses are lowercased once, at the edge**, by `normalizeEmail()`. We do
*not* strip Gmail dots or `+tags`: those are different mailboxes to a mail
server, and merging them would let a suppressed address receive mail under an
alias.

**Counters are a cache.** `campaigns.sent_count` and friends are incremented
optimistically and reconciled from `campaign_recipients` every 15 minutes.
Recipient rows are the truth.

**List membership is soft-deleted.** `unsubscribed_at` is set rather than the
row removed, so a re-subscribe keeps its history.

**Threading uses real mail headers.** `thread_key` is the head of `References`,
falling back to `In-Reply-To`, falling back to the message's own id. Replies
carry both headers back out — without them Gmail shows an orphan and the thread
visibly splits.

---

## Security

**Inbound HTML is rendered, inside a sandbox.** It is a designed document and
showing it as source was never good enough — but it is also someone else's
markup, so it renders in an iframe whose containment is the whole defence:

| | Why |
|---|---|
| No `allow-scripts` | The load-bearing rule. Nothing executes: no inline handlers, no `javascript:` URLs, no `<script>` |
| `allow-same-origin`, but only *without* scripts | Lets the parent measure the content and size the frame to it. Safe here because there is no code to use the origin. **Never pair it with `allow-scripts`** — a document granted both can remove its own sandbox |
| No `allow-forms` | A form in an email is a credential-harvesting page waiting to post |
| No `allow-top-navigation` | Otherwise a message can redirect the whole app |
| `default-src 'none'` inside the document | Blocks everything, then permits inline styles only, because email *is* inline styles |
| `img-src 'none'` until asked | A one-pixel image is how a sender learns you opened the message. The CSP does the blocking, so toggling needs no rewriting of the HTML |
| `<base target="_blank">` | Links leave, rather than replacing the app |

The HTML itself is passed through untouched — the iframe is the isolation, so
the email is shown as authored rather than as reinterpreted by a sanitiser.

`html-message.test.tsx` asserts each of these separately, because they are all
attributes on one element and exactly the kind of thing a well-meaning
refactor deletes. Adding `allow-scripts` fails two tests by name.

**Merge fields are HTML-escaped by default.** Contact data comes from CSV
uploads and public forms. `{{ firstName }}` escapes; `{{{ raw }}}` opts out.

**Unsubscribe links are HMAC-signed and never expire.** A link in a two-year-old
email must still work — RFC 8058 and every major mailbox provider expect it.
This is why `AUTH_SECRET` should be treated as permanent.

**The Settings page reports set/missing, never values.** A settings screen that
renders the first six characters of an API key is one that leaks an API key into
a screenshot.

**Sign-up is closed by default.** An instance on a public URL with open
registration is an open relay with a nice dashboard.

---

## Extending it

**Another email provider.** `@sendstack/email` is the only package that imports
`resend`. Implement `sendBatch`, `fetchInboundEmail` and `verifyWebhook`
against the same signatures and nothing else changes.

**Multi-tenancy.** Currently single-workspace. Add a `workspaces` table, a
`workspace_id` on the domain tables, and scope through `requireSession()`.

**Segments.** `campaigns.list_id` is nullable and the materialisation query
already branches on it. A `segments` table holding a serialised predicate slots
into that same SELECT.

**A template editor.** Uploaded templates already live in `templates` and
render through `renderCustomTemplate()`; an editor would write the same rows
against the same contract.
