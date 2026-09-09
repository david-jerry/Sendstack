# @sendstack/jobs

Every background function [Sendstack](../../README.md) runs: the campaign send
pipeline, four cron schedules, and the reconcilers that repair what webhooks
lost. It is the only place in the repository where a long-running or retried
operation lives, which makes it the place where almost all of the correctness
argument lives too — the guards against sending twice, against sending to a
suppressed address, and against two workers claiming the same recipient are all
here.

It is not a provider client and not a renderer. It talks to Resend only through
`@sendstack/email` (`sendBatch`, `fetchInboundEmail`, `resendClient`) and
renders only through `renderCampaignEmail`; it holds no API key, no template and
no HTML of its own. It has no UI surface at all — everything it produces it
writes to Postgres, and the browser learns about it through a realtime publish
or its next fetch.

## Where it is used

Everything a consumer may import comes from `src/index.ts`. Nothing else in the
package is a contract.

| Importer | Takes |
| --- | --- |
| `apps/web/src/app/api/inngest/route.ts` | `inngest`, `functions`, `applyInngestConfig`. `serve({ client, functions })` mounts all ten functions at **`/api/inngest`** — the one URL an Inngest app or the dev server needs. Declares `runtime = "nodejs"`, `dynamic = "force-dynamic"` and `maxDuration = 300`, and calls `applyInngestConfig()` per request rather than at import, because module scope is evaluated during `next build` when no database exists. |
| `apps/web/src/actions/campaigns.ts` | `campaignQueueRequested`, `campaignSendRequested`, `campaignCancelRequested`, `sendEvent`. `sendCampaignNow` claims `draft → scheduled` then emits queue; `resumeCampaign` claims `paused → sending` then emits send at `pass: 0`; `cancelCampaignAction` claims `→ cancelled` then emits cancel. |
| `apps/web/src/actions/compose.ts` | `campaignQueueRequested`, `sendEvent`. `sendBulkEmail` writes an ad-hoc campaign row, claims it, and hands it to the same pipeline as a designed campaign. |
| `apps/web/src/actions/inbox.ts` | `syncInboundEmails`. The inbox Sync button calls it with `{ max: 200, hydrate: 25 }` — inline hydration, so it works on an install where Inngest has never been configured. |
| `apps/web/src/actions/thread.ts` | `syncSentEmails`. The Sent Sync button, `{ max: 200 }`. |
| `apps/web/src/app/api/webhooks/resend/route.ts` | `recordInboundEmail` (passed the route's own `tx`), `announceInboundEmail` (queued as a post-commit effect), `recipientStatusCase` and `outboundStatusCase` (the delivery UPDATEs), and the `DbExecutor` type. |
| `apps/web/next.config.ts` | Listed in `transpilePackages`; the package ships TypeScript source, not a build. |

The direction is worth noting: `apps/web` imports the event definitions and
emits them, and imports the stores to run inline. It never imports a function
to call it directly — a function only ever runs because Inngest invoked
`/api/inngest`.

## The functions

`functions` in `src/index.ts` is the array the route serves. Each entry is also
exported by name for tests.

### `queueCampaign` — materialise the audience

Trigger: **`campaign/queue.requested`** (`{ campaignId }`). Inngest id
`queue-campaign`; `concurrency: { key: "event.data.campaignId", limit: 1 }`;
`retries: 3`.

Claims the campaign, inserts one recipient row per audience member, marks the
ones that must not be mailed, writes the totals, and emits
`campaign/send.requested` at `pass: 0`.

**The guard is the claim.** `claimCampaignForQueue` is a single
`UPDATE campaigns SET status = 'sending', started_at = now() WHERE id = … AND
status IN ('scheduled','sending') AND started_at IS NULL RETURNING *`. Only the
run whose UPDATE matched a row goes on to materialise anything; every other
delivery of the event gets `null` and raises a `NonRetriableError`. Three things
routinely deliver the event twice for one campaign — `sendCampaignNow` emits and
then the every-minute cron finds the same `scheduled_at = now()` row and emits
again, a double-clicked button, a replayed event — and all three are the same
shape to this claim. `sending` is accepted alongside `scheduled` on purpose: the
cron's own flip can land between the action's UPDATE and this claim, and
refusing that state is what once made every scheduled campaign fail with
"already sending".

**Materialisation is one statement.** `materialiseRecipients` is a single
`INSERT INTO campaign_recipients … SELECT … ON CONFLICT (campaign_id,
contact_id) DO NOTHING`, with two arms — a join through `list_members` where the
campaign has a list, or all of `contacts` where `list_id` is null (an
announcement). A 200k-contact list never crosses the wire. The unique index is
what makes a retry converge rather than duplicate.

**Every list member gets a row, including the suppressed ones.** They are
inserted and then relabelled `suppressed` by `applyQueueSuppressions`, which
touches only `pending` rows and so converges to zero on a second pass. Filtering
them out of the SELECT would have been cheaper and would have left no trace —
and "why didn't Dana get this?" is a question that gets asked. The recipient
table is the audit answer to it.

The claim step also re-runs `deliverabilityReport()` before a single row is
written, because a campaign scheduled last week runs against this week's
settings. When it fails, the campaign is put back to `draft` with `started_at`
cleared — a `scheduled` row would be picked up again in sixty seconds and fail
identically, and a `draft` that kept `started_at` could never be claimed again.

### `sendCampaign` — send the batches

Trigger: **`campaign/send.requested`** (`{ campaignId, pass }`). Inngest id
`send-campaign`; `concurrency: { key: "event.data.campaignId", limit: 1 }`;
`throttle: { limit: 10, period: "1s" }`; `retries: 4`.

Loads the campaign, the brand block and any uploaded template once per run, then
loops up to `MAX_BATCHES_PER_RUN` (25) batches of `SEND_BATCH_SIZE` (100) —
2,500 messages per run. Each batch is one `step.run` named
`batch-{pass}-{batch}`, so a retry replays exactly one batch.

**The transaction is the guard.** `sendNextBatch` wraps suppression sweep →
claim → render → `sendBatch` → status writes → counter increment in one
`db.transaction`. Before that, the claim committed the moment it ran, and a
failure anywhere after it left rows in `sending` forever while the retry claimed
a *different* hundred rows under the *same* idempotency key — which Resend
rejects, so the retry failed too, and the stranded rows were later released back
to `pending` by a pause and sent a second time. Rolling the claim back means the
retry re-claims the same rows (nothing else can have taken them; they were never
visibly `sending`), sorts them by id, renders identical content and sends under
the same key.

**`FOR UPDATE SKIP LOCKED`** inside the claim subquery gives two workers
disjoint slices instead of a block or a double send. There is deliberately no
`ORDER BY` — under `SKIP LOCKED` the order a worker sees rows in is not the
order it gets them in — so the returned rows are sorted by `id` in Node, which
is what makes a retried batch payload byte-identical. `contacts` is joined once
in `FROM` rather than read per row as correlated subselects in `RETURNING`.

**The pause check is inside the claim**, as an
`EXISTS (SELECT 1 FROM campaigns WHERE id = … AND status = 'sending')` in the
picking subquery. The campaign row is loaded once per run, so without this a
pause would take effect only when the next run started — up to 25 batches later.
With it, a pause stops the very next batch: the subquery matches nothing and the
run winds down.

**Suppression is re-checked at claim time.** `suppressLateArrivals` runs in the
same transaction, immediately before the claim, and marks any `pending`
recipient that has since acquired a suppression. A campaign can sit `scheduled`
for a week or `paused` for a day, and a bounce or complaint in between has to
stop the rest of the send.

**The idempotency key is `campaign:{campaignId}:{runId}:{batch}`.** A run id is
unique per Inngest run and stable across the retries of a step within it, which
is exactly the shape the key needs: retries collapse onto the first attempt, and
a *resumed* campaign — a new run — gets fresh keys rather than reusing pass 0's
keys against a different set of recipients.

**Continuation.** Hitting the ceiling with work remaining emits
`campaign/send.requested` at `pass + 1` and returns, so no single execution
outlives its platform's timeout. A short batch (`claimed < SEND_BATCH_SIZE`)
instead runs the completion UPDATE, itself guarded by `status = 'sending' AND
NOT EXISTS (… status IN ('pending','sending'))` so a paused or cancelled
campaign is never relabelled `sent`.

The status writes are conditional in both directions: `CASE WHEN cr.status =
'sending' THEN 'sent' ELSE cr.status END` with `COALESCE` on the timestamps,
because the provider can post `email.delivered` for a message in this batch
before the batch's own UPDATE runs.

### `scheduleDueCampaigns` — the minute tick

Trigger: **`cron("* * * * *")`**. Inngest id `schedule-due-campaigns`.

`UPDATE campaigns SET status = 'sending' WHERE status = 'scheduled' AND
scheduled_at <= now() RETURNING id`, then one `step.sendEvent` carrying the
whole array of `campaign/queue.requested` events. The UPDATE *is* the claim, so
two overlapping ticks — or two instances during a deploy — cannot both emit for
one campaign. This dedupes *emits*, not materialisation; `queueCampaign`'s
`started_at IS NULL` claim is what makes a second event a no-op.

### `reconcileCampaignStats` — repair the counters

Trigger: **`cron("*/15 * * * *")`**. Inngest id `reconcile-campaign-stats`.

One `UPDATE … FROM (SELECT … GROUP BY campaign_id)` that rebuilds every
denormalised counter from `campaign_recipients`, which is the source of truth.
The send job and the webhook handler increment optimistically and either can
miss a beat; this converges instead of drifting forever. Scoped to campaigns
that are `sending` or `paused` plus anything completed in the last two days, and
skipping rows touched in the last minute so it does not fight a live send. Safe
to run twice because it is a recomputation, not an increment. `sent` is
`count(*) FILTER (WHERE sent_at IS NOT NULL)` rather than a status list, so a
recipient that was sent and then bounced still counts as sent and the two
numbers agree.

### `reconcileSent` — ask Resend what happened to sent mail

Trigger: **`cron("42 * * * *")`**. Inngest id `reconcile-sent`;
`concurrency: { limit: 1 }`.

`syncSentEmails({ max: 500 })`. Delivery webhooks are the fast path and not a
guarantee: an endpoint that was unreachable, or a webhook that was never
configured, leaves every message stuck at whatever status it had when it left,
because nothing re-delivers those events. Offset from the inbound reconciler's
minute so the two do not contend for the same rate limit. Safe twice because
every status write goes through the monotonic ladder and is guarded by
`status <> next`; an "email not configured" error is caught and logged rather
than failing the schedule, which is the normal state of a fresh install.

### `cancelCampaign` — relabel the pending rows

Trigger: **`campaign/cancel.requested`** (`{ campaignId }`). Inngest id
`cancel-campaign`.

**The Server Action claims the status first, and this job requires it.**
`cancelCampaignAction` runs `UPDATE campaigns SET status = 'cancelled' WHERE
status IN ('draft','scheduled','sending','paused') RETURNING id` and only emits
the event if that matched — so the person clicking gets "already finished"
rather than an event vanishing into a queue. This job's own
`EXISTS (… status = 'cancelled')` guard depends on that having happened;
emitting the event without claiming first made cancelling a silent no-op. What
is left for the job is the part that can be large: relabelling up to 200k
`pending` rows, which no request should wait on.

Only `pending` rows, never `sending`. A row is `sending` solely while a batch
transaction is in flight, and that transaction will write `sent` or `failed` on
commit. The claim's `EXISTS` check is what stops the *next* batch.

### `fetchInbound` — phase two of an inbound message

Trigger: **`email/inbound.received`** (`{ providerEmailId, receivedAt? }`).
Inngest id `fetch-inbound-email`; `concurrency: { key:
"event.data.providerEmailId", limit: 1 }`; `retries: 5`.

Calls `hydrateInboundEmail(providerEmailId)` — fetch the body, headers and
attachment descriptors Resend does not put in the webhook, and fill the row in.
A missing row raises a `NonRetriableError`, because no amount of waiting
conjures one.

It is a job rather than inline work in the route handler for one reason: the
webhook must be acknowledged fast. Resend retries anything slow or failed on a
5s / 5m / 30m / 2h / 5h / 10h ladder, so a second API round trip before
responding turns a transient hiccup into a duplicate delivery. Safe twice
because the UPDATE is naturally idempotent and the attachment insert is
`ON CONFLICT DO NOTHING` against the unique
`(inbound_email_id, provider_attachment_id)` index.

### `reconcileInbound` — ask Resend what arrived

Trigger: **`cron("17 * * * *")`**. Inngest id `reconcile-inbound`;
`concurrency: { limit: 1 }`.

`syncInboundEmails({ max: 500 })` — no inline hydration, so the job queue
absorbs the volume. Hourly rather than every few minutes: it exists to catch
outages and misconfiguration, not to deliver mail. Safe twice through the unique
`inbound_emails.provider_email_id` index; the single-run concurrency limit only
saves the wasted work.

### `wakeSnoozedThreads` — return snoozed threads to unread

Trigger: **`cron("*/5 * * * *")`**. Inngest id `wake-snoozed-threads`.

Clears `threads.snoozed_until` where it has passed, then marks the `read`
messages of those threads `unread` — skipping muted threads, which is what mute
means. The threads are not actually hidden by anything but the inbox query's
`snoozed_until > now()` filter, so they resurface whether this runs or not; the
job exists to make them unread again. Both statements are conditional on the
state they change, so a second run finds nothing.

### `expireAttachmentUrls` — drop dead download links

Trigger: **`cron("0 * * * *")`**. Inngest id `expire-attachment-urls`.

Nulls `download_url` and `url_expires_at` on `inbound_attachments` past their
expiry, so nothing in the UI offers a link that will 403 when clicked.
Idempotent by its `WHERE`.

## The stores

The parts of the pipeline that are not Inngest functions, because two callers
need them and only one of those callers is a job.

### `inbound-store.ts`

| Export | Purpose |
| --- | --- |
| `recordInboundEmail(meta, executor = db)` | Insert an inbound message if it is new; the write only, no publish and no job. `ON CONFLICT DO NOTHING` on the unique `provider_email_id` makes it safe to call repeatedly from both the webhook and the sync. Returns `null` when the row already existed — which is how the caller knows *not* to announce it again. The optional `executor` is the reason it takes one at all: the webhook route passes its own `tx`, so the inbound row lands in the same commit as the `email_events` dedupe row and a handler failure rolls both back, leaving the retry genuinely first. |
| `announceInboundEmail(record, meta)` | The two side effects, split out and run **after** the commit: `publishRealtime` and `sendEvent(inboundReceived)`. Both are safe to repeat. What is not safe is running them inside the transaction — a realtime event published from in there has the browser fetch a row it cannot see yet, and a job enqueued from in there finds nothing to hydrate and fails as non-retriable. That split is the whole reason these are two functions. |
| `hydrateInboundEmail(providerEmailId)` | Fetch the body from Resend and store it. Package-internal (not re-exported by `index.ts`); used by `fetchInbound` and by `syncInboundEmails`' inline repair. |
| `storeInboundContent(content)` | Write a fetched body onto its row, insert its attachments, publish realtime, and fire a push notification (swallowing a push failure — the mail is already stored). Separated from the provider fetch so that what a test runs twice is exactly what production runs twice. The UPDATE is naturally idempotent; the attachment insert is idempotent **only** because of the unique index its `ON CONFLICT` names. |
| `notificationPreview(subject, snippet)` | The one line somebody reads on a lock screen: both parts where both exist, whitespace collapsed, truncated on a word boundary at 140 characters. Pure, and the only thing in the file testable without a database. |
| `syncInboundEmails(options?)` | Page through Resend's received mail, import anything missing, then repair rows whose body never arrived. `max` bounds a first sync; `hydrate` is how many of the stalled rows to fetch inline. The remainder go to Inngest in **one** `sendEvent` call with an array — a hundred stalled rows used to be a hundred HTTP requests. |

### `outbound-store.ts`

`syncSentEmails(options?)` folds Resend's view of sent mail into ours, and its
shape is the N+1 lesson written down. Per page of up to a hundred messages it
runs a bounded handful of statements — one `UPDATE … FROM (VALUES …)` per
distinct status on the page for `campaign_recipients` and one for
`outbound_messages`, one SELECT for the ids already known, one thread lookup
using a single `LATERAL` join, one multi-row INSERT — where it once ran two to
six statements *per message*. On a 500-message sync that is roughly a dozen
round trips instead of two thousand.

Recipients are advanced first and then every id belonging to a campaign is
excluded from the import: importing a campaign message into `outbound_messages`
as well would double-count it in Sent and detach it from the campaign whose
numbers it belongs to. `rejoined` counts the recovered messages a `LATERAL`
lookup matched back into an existing conversation — a deliberately narrow
heuristic (same correspondent **and** same base subject, newest thread wins),
because `emails.list()` returns no `In-Reply-To`.

One honest limit, stated in the code: `outbound_messages.provider_message_id`
has a plain index, not a unique one, so `ON CONFLICT DO NOTHING` cannot dedupe
on it. Duplicates are prevented by the known-ids SELECT within the page. Two
syncs running concurrently could still both import a message; only a unique
index closes that, and the `concurrency: { limit: 1 }` on `reconcileSent` is the
current mitigation.

### `delivery-sql.ts`

`recipientStatusCase(column, incoming)` and `outboundStatusCase(column,
incoming)` render the monotonic status ladder as a SQL `CASE`, generated by
enumerating the status enum through `nextRecipientStatus` / `nextOutboundStatus`
from `@sendstack/shared`. Three consumers apply "advance this row, never
backwards" in an UPDATE — the webhook route, the sent-mail reconciler and the
send worker — and writing the `CASE` by hand in each is how three copies came to
disagree. Generated, the SQL cannot say anything the function does not.

It lives here rather than in `@sendstack/shared` because **shared has no
drizzle**. The rule is pure and stays there, tested without a database; only its
SQL rendering needs the `sql` tag, and that is what this file is.

## Why the pipeline is safe

The argument a reviewer can check, in order. Five guards, each sufficient on its
own for a different failure; three of them are in this package.

1. **A unique index** — `campaign_recipients (campaign_id, contact_id)`, in
   `packages/db`. Materialisation is `INSERT … ON CONFLICT DO NOTHING`, so
   re-running it after a partial failure converges instead of duplicating.
2. **A queueing claim** — `claimCampaignForQueue`. `started_at IS NULL` is the
   load-bearing part: only one run per campaign ever materialises, however many
   times the event is delivered.
3. **An atomic claim inside a transaction** — `sendNextBatch`. `FOR UPDATE SKIP
   LOCKED` gives disjoint slices; the surrounding transaction means a failure
   rolls the claim back and the retry re-claims *the same* rows and rebuilds a
   byte-identical payload rather than stranding a slice in `sending`.
4. **A provider idempotency key** — `campaign:{id}:{runId}:{batch}`, so an
   identical retry collapses onto the first attempt at Resend.
5. **A single definition of what an event means** — the ladder in
   `@sendstack/shared`, rendered as SQL by `delivery-sql.ts`, so no consumer can
   move a row backwards or interpret a bounce differently from its neighbour.

The one failure mode none of this covers is documented rather than hidden: a
process killed between Resend accepting a batch and the transaction committing.
Postgres rolls the claim back but the mail went, and the resume re-sends under a
new run's key. See [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md#not-sending-twice)
for the full version of this argument, including the Server Actions' matching
claim-then-proceed pattern.

## Invariants a contributor must preserve

Breaking one of these does not fail loudly. It produces a bug that emails
somebody twice, or silently stops emailing somebody at all.

1. **Claim work with a conditional `UPDATE … RETURNING`, never `SELECT` then
   `UPDATE`.** Every claim in this package is the UPDATE itself — the campaign
   claim, the cron's due-campaign claim, the batch claim, the cancel relabel.
   A read followed by a write across an `await` is a race with no arbiter, and
   the second reader wins it too.
2. **A claim and the side effect it guards belong in one transaction.** So that
   a retry re-claims the same rows. Splitting `sendNextBatch`'s claim from its
   send — for a "cleaner" step boundary, say — reintroduces exactly the bug the
   transaction was added to fix: rows stuck in `sending` and a retry sending to
   a different hundred people under a key the provider will reject.
3. **An idempotency key must be stable across a step's retries and unique
   across runs.** `runId` satisfies both. A pass number does not: a resumed
   campaign restarts at pass 0 and would reuse pass 0's keys against a different
   set of recipients. Do not put a timestamp or a random value in a key either —
   that makes every retry a fresh send.
4. **Status transitions are monotonic under out-of-order events, through the
   shared ladder.** Use `recipientStatusCase` / `outboundStatusCase`, or
   `nextRecipientStatus` directly. Never hand-write a `CASE`, and never write an
   unconditional `SET status = …` on a row a webhook can also touch — a
   `delivered` row must not be dragged back to `sending` because the reconciler
   reported `queued`.
5. **Every batch path is a bounded number of queries, never one per row.**
   `INSERT … SELECT` for materialisation, `UPDATE … FROM (VALUES …)` for status
   writes, `= ANY(…)` for lookups, one `sendEvent` with an array rather than one
   per event. If a new path needs a loop, the loop bound must be the number of
   distinct *statuses* or *pages*, not the number of rows. Prove it with
   `EXPLAIN (ANALYZE, BUFFERS)` through the app's own query builder.
6. **Suppression is re-checked at claim time, not only at materialisation.**
   `suppressLateArrivals` runs inside the claim transaction on every batch. A
   new send path that skips it is a path that mails an address which bounced an
   hour ago.
7. **A step that has committed must not be assumed to have committed on
   retry — and vice versa.** Inngest memoises completed steps and replays failed
   ones from the top, so any step that writes must be safe to run twice: guarded
   by a unique index, conditional on the state it changes, or wrapped in a
   transaction that undoes it. "This step already ran" is never a thing a later
   step can rely on.
8. **Realtime publishes and job enqueues happen after the commit.** They tell
   somebody else to go and look at a row. Run inside the transaction, they point
   at data that is not visible yet and may never become visible — which is why
   `recordInboundEmail` and `announceInboundEmail` are two functions.
9. **Postgres arbitrates; Redis is optional.** `publishRealtime` here is
   fire-and-forget and a failure never fails a job. Nothing in this package may
   depend on Redis being present for correctness.

## Editing the package

**Adding a function.** Write it in `src/functions/`, export it, and add it to
**both** the `functions` array and the named re-export block in `src/index.ts`
in the same change — the array is what `apps/web/src/app/api/inngest/route.ts`
serves, so a function missing from it simply never runs and nothing reports
that. Give it a stable `id`; changing an id later orphans the run history. If it
writes, decide its answer to invariant 7 before you write it, and say so in the
docblock.

**Adding an event.** Define it in `src/client.ts` with `eventType(name, {
schema })` and re-export it from `src/index.ts` so the emitting Server Action
can import it. No `.default()`, `.transform()` or anything else that rewrites
the input: Inngest's `AssertNoTransform` rejects it, because a trigger schema has
to describe one fixed wire shape. Every field is therefore required and passed
explicitly at the call site. Add the trigger to the receiving function's
`triggers` array in the same commit.

**Changing the batch size.** `SEND_BATCH_SIZE` lives in
`packages/shared/src/constants.ts` and is imported by both the claim's `LIMIT`
here and `sendBatch` in [`@sendstack/email`](../email/README.md), which throws if
handed more. **It must match Resend's own batch limit, which is 100** — raising
it does not raise the provider's ceiling, it just makes every send fail. If you
change it, re-check `MAX_BATCHES_PER_RUN` in `send-campaign.ts`: the two
multiply into the per-run message count that keeps a run inside
`maxDuration = 300` on the serve route.

**Changing a cron.** Change it in the function's `triggers` array. Keep the
reconcilers on offset minutes (`17` inbound, `42` sent) so they do not contend
for the same provider rate limit, and keep `scheduleDueCampaigns` at one minute
or accept that a scheduled campaign is late by whatever you widen it to. A cron
change needs no deploy step beyond the usual one — Inngest reads the schedule
from the served function list — but it does need the corresponding line in
[docs/SELF-HOSTING.md](../../docs/SELF-HOSTING.md) updated if the timing is
something an operator would notice.

**Do not** import `@sendstack/db` into `@sendstack/shared` to move the ladder's
SQL there, and do not add a second copy of a status `CASE`. The split — pure
rule in shared, SQL rendering here — is deliberate.

## Running it locally

**Nothing in this package runs unless the Inngest dev server is running.** From
the repository root:

```bash
pnpm dev          # tunnel + Next.js + Inngest dev server, via concurrently
pnpm dev:local    # the same without the tunnel
pnpm inngest:dev  # just the Inngest dev server (npx inngest-cli@latest dev)
```

Local development needs no keys at all — the dev server discovers
`/api/inngest`, and `applyInngestConfig()` falls back to `INNGEST_*` environment
variables and then to nothing.

**What happens without it, and why this is worth reading twice:** the Server
Action's `sendEvent` succeeds, the campaign flips to `scheduled` or `sending`,
and then *nothing else happens*. No error in the browser, no error in the
server log, no failed request. The campaign sits there, `total_recipients` stays
0, and there is no clue anywhere that the thing which was supposed to pick the
event up does not exist. This is the single most confusing local-development
failure in the project. If a campaign queues and never sends, check the Inngest
dev server before you check anything else — its UI at `http://localhost:8288`
lists every event received and every run, which is also where a failed step's
error actually appears.

The inbox has a deliberate escape hatch from the same problem: the Sync button
calls `syncInboundEmails({ hydrate: 25 })`, which fetches bodies inline, so an
inbox left full of headerless stubs by a missing job server can be repaired
without one. The Sent page's Sync button does the same through `syncSentEmails`.
There is no equivalent for outbound campaigns, on purpose — sending is not
something a request should do.

## Testing

```bash
npx vitest run packages/jobs
```

`src/notification-preview.test.ts` is the only pure unit test: seven cases over
`notificationPreview`, covering the subject/snippet fallbacks, whitespace
collapse, word-boundary truncation and the hard cut for a token with no spaces.
It needs no database and no mocks.

`src/pipeline.duplicity.integration.test.ts` is the CLAUDE.md §7 proof
obligation for this package, and it discharges it by running the pipeline stages
twice against a **real Postgres**, with `@sendstack/redis` mocked away. Four
cases:

- `claimCampaignForQueue` succeeds once and returns `null` the second time, and
  `materialiseRecipients` run twice leaves one recipient row;
- `storeInboundContent` run three times leaves two attachment rows;
- `recordInboundEmail` for a webhook delivered twice leaves one inbound row;
- the scheduler's exact `UPDATE` followed by `claimCampaignForQueue` — the
  regression where the queue job refused the `sending` state the scheduler had
  just left behind, which stopped every scheduled campaign from sending.

Both duplicity guarantees live in the *schema*, which is precisely why the test
exists: a schema-level guarantee is invisible in the application code that
depends on it. Dropping the unique index on
`(inbound_email_id, provider_attachment_id)` makes this file fail, and that is
the only way that dependency is visible at all — before the index existed, the
code read as idempotent, there was no conflict for `ON CONFLICT` to catch, every
re-hydrate duplicated every attachment, and nothing anywhere reported it.

The suite is gated by `databaseSuite` from
[`test/database-suite.ts`](../../test/database-suite.ts): it **skips** on a
clone with no `DATABASE_URL`, so `git clone && pnpm test` passes without
provisioning anything, and it **throws during collection** when `CI` is set
without a database, because a suite that silently skips in CI reports green and
proves nothing.

There is no automated test for the functions' Inngest wiring — triggers, crons,
concurrency keys and the continuation handoff are checked by hand against the
dev server. `apps/web/src/actions/campaigns.guards.integration.test.ts` covers
the Server Action side of the claim-then-emit pattern with this package's
`sendEvent` mocked.

## Files

| File | Holds |
| --- | --- |
| `src/client.ts` | The Inngest client, the four typed event definitions (`campaignQueueRequested`, `campaignSendRequested`, `campaignCancelRequested`, `inboundReceived`), `applyInngestConfig` and `sendEvent`. |
| `src/index.ts` | The public surface: the `functions` array the route serves, every function by name, the stores, the SQL ladder helpers and their types. |
| `src/functions/queue-campaign.ts` | `queueCampaign`, plus `claimCampaignForQueue`, `materialiseRecipients` and `applyQueueSuppressions`. |
| `src/functions/send-campaign.ts` | `sendCampaign`, `sendNextBatch`, `MAX_BATCHES_PER_RUN`, and the claim and late-suppression statements. |
| `src/functions/scheduler.ts` | `scheduleDueCampaigns`, `reconcileCampaignStats`, `cancelCampaign`, `reconcileSent`. |
| `src/functions/fetch-inbound.ts` | `fetchInbound`, `expireAttachmentUrls`, `reconcileInbound`, `wakeSnoozedThreads`. |
| `src/inbound-store.ts` | `recordInboundEmail`, `announceInboundEmail`, `hydrateInboundEmail`, `storeInboundContent`, `notificationPreview`, `syncInboundEmails`. |
| `src/outbound-store.ts` | `syncSentEmails` and its page-level thread matching, grouping and status advancement. |
| `src/delivery-sql.ts` | `recipientStatusCase`, `outboundStatusCase` — the shared ladder rendered as SQL. |
| `src/notification-preview.test.ts` | Unit tests for `notificationPreview`. |
| `src/pipeline.duplicity.integration.test.ts` | The run-it-twice proof, against a real Postgres. |
