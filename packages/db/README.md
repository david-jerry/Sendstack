# @sendstack/db

The data layer for [Sendstack](../../README.md): a Drizzle schema, the
migrations that have built it, and the one pooled Postgres client every other
package uses. Two places in the repository open a connection of their own, both
deliberately and both for a URL the pool cannot serve: `src/migrate.ts` here,
and the setup wizard's `probeDatabaseUrl`, which tests a connection string
somebody has just typed.

Invariant 1 of [PRODUCT.md](../../PRODUCT.md) is "Postgres is the source of
truth", and boundary 4 is that data model constraints are enforced *here*. So
the constraints in `src/schema/` are not bookkeeping. They are the guarantees
the rest of the app is written against and deliberately does not re-implement:
the send pipeline, the webhook routes and the hydration jobs all read as
though they were idempotent, and they are idempotent because of a unique index
in this package. Remove one and the code above it still compiles, still passes
its unit tests, and starts duplicating rows in silence.

**What is not here.** No business logic and no queries. Application queries
live in `apps/web/src/lib/queries/` and in `packages/jobs`; validation lives in
[`@sendstack/shared`](../shared/README.md). This package exports tables, types,
a client, two error predicates and one SQL helper — and imports nothing from
the repository except `@sendstack/shared`.

## The guarantees, and the constraint that provides each

| Failure it prevents | The constraint |
| --- | --- |
| A retried materialisation sending the same campaign twice to one contact | `campaign_recipients_campaign_contact_key` on `(campaign_id, contact_id)` |
| Two workers claiming the same recipient | `campaign_recipients_claim_idx` on `(campaign_id, status)`, driving a conditional `UPDATE` |
| A replayed webhook running its side effects twice | `email_events_provider_event_key` on `provider_event_id` |
| A replayed `email.received` creating a second conversation row | `inbound_emails_provider_key` on `provider_email_id` |
| Re-hydration duplicating every attachment of a message | `inbound_attachments_email_provider_key` on `(inbound_email_id, provider_attachment_id)` |
| An offline reply, replayed by the service worker, going out twice | `outbound_client_key_key` on `client_key` |
| The same template uploaded twice becoming two rows | `templates_checksum_key` on `checksum` |
| A deleted list turning a campaign into a send to the whole database | `campaigns_list_id_lists_id_fk` with `ON DELETE RESTRICT` |
| Two suppression rows for one address, or a missed suppression | `suppressions_email_key` on `email` |
| Two configuration rows racing into existence | `app_settings.id` primary key, one legal value |

The send pipeline and the webhook dedupe ladder that sit on top of these are
described in [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) —
[Not sending twice](../../docs/ARCHITECTURE.md#not-sending-twice) and
[Webhook handling](../../docs/ARCHITECTURE.md#webhook-handling). This file
covers the schema half only.

## Where it is used

| Consumer | What it takes |
| --- | --- |
| `apps/web` | `db` in every Server Action, API route and query module. `apps/web/src/lib/queries/*` writes raw `sql` through `db.execute`; the actions mix that with the table objects. |
| [`packages/auth`](../auth/README.md) | `db` plus the `schema` namespace, handed to Better Auth's Drizzle adapter: `user`, `session`, `account`, `verification`, `passkey`. Better Auth resolves those columns by **TypeScript property name**, which is why `auth-schema.test.ts` lives beside it. |
| [`packages/config`](../config/README.md) | `appSettings`, `appSecrets`, `brandingAssets` — the runtime configuration, the encrypted secrets, and the logo bytes. |
| [`packages/email`](../email/README.md) | `pushSubscriptions` for web push, and `templates` for rendering an uploaded design. |
| [`packages/jobs`](../jobs/README.md) | The whole send and inbound pipeline: `campaigns`, `campaign_recipients`, `suppressions`, `contacts`, `inbound_emails`, `inbound_attachments`, `outbound_messages`, `email_events`. Also `type Database`, from which it derives its transaction type. |
| [`packages/redis`](../redis/README.md) | **Nothing.** It sits beside the database, not on top of it. |

Two import paths, both legitimate: `@sendstack/db` for the client, the
operators and everything in the schema; `@sendstack/db/schema` when a module
only wants tables.

`src/index.ts` also re-exports the Drizzle operators (`and`, `eq`, `sql`,
`inArray`, `desc` and the rest) so a consumer can build a query without adding
`drizzle-orm` to its own `package.json`. There is exactly one copy of
drizzle-orm in the tree, and that is what keeps table objects from two
packages comparable.

## The client

`db` is the single pooled client, exported from `src/client.ts`.

- **postgres.js, not a Neon-specific driver.** The same code reaches Neon,
  Supabase, RDS or a Postgres in Docker with no change, which is the point of a
  self-hostable project.
- **`prepare: false` is mandatory, not a preference.** Against a
  transaction-mode pooler — Neon's `-pooler` host, Supabase on port 6543, any
  PgBouncer — a connection can be handed to another client between statements,
  and a named prepared statement does not survive that. The symptom is not a
  clear error at connect time; it is queries failing at random under load,
  which is why the flag is set unconditionally rather than sniffed from the
  URL. The cost of leaving it on is a little planning time per query.
- **Pool size is `DATABASE_POOL_MAX`, default 10.** Ten suits one long-running
  server. On serverless every warm instance is its own process with its own
  pool, so behind a pooler set it to 2–5 and let the pooler multiplex. Also
  fixed: `idle_timeout` 20s, `connect_timeout` 15s.
- **It connects on first *use*, not on import.** `db` is a `Proxy` that builds
  the pool the first time a property is read. The laziness is load-bearing: the
  setup wizard exists to collect `DATABASE_URL` and transitively imports this
  module, so an eager connection would crash the one page able to fix a missing
  one. The same applies to any tool importing the schema purely for types.
- **The client is cached on `globalThis`.** Next re-evaluates modules on every
  hot reload; without the cache a long `pnpm dev` session opens hundreds of
  connections and hits the server's limit.
- **`casing: "snake_case"`** is passed to `drizzle()`. Every column in this
  schema is also named explicitly, so the setting is a backstop for a column
  added without one — not a licence to leave names off.

`src/migrate.ts` deliberately does **not** use `db`. It opens its own
`postgres(url, { max: 1, prepare: false })`: migrations take locks, and a
migration competing with application traffic for pool slots is a migration
that can block behind the app it is trying to change. It also loads `.env`
itself, so `pnpm db:migrate` works with no framework around it.

Two more exports worth knowing about:

- `isUniqueViolation(error)` / `isForeignKeyViolation(error)` — SQLSTATE
  `23505` and `23503`, read from the `code` postgres.js puts on the thrown
  error rather than from message text. They exist because the constraint *is*
  the guard: checking "does this already exist?" before the insert only races
  the insert, so the write is attempted and the refusal is interpreted.
- `sqlArray(values, "text" | "uuid")` — a Postgres array literal for
  `= ANY(...)`. Interpolating a JavaScript array looks right and produces
  `ANY(($1, $2))`, which Postgres rejects at runtime. The cast is not optional:
  `ARRAY[]` alone is a syntax error, and `ARRAY[]::uuid[]` is a legal empty
  array that matches nothing, which is the correct answer for a filter with no
  values.

## The schema

Seven files under `src/schema/`, re-exported by `src/schema/index.ts`. What
follows is not a column list — read the files for that, they are annotated.
This is the constraints that carry a guarantee.

### Auth and devices (`auth.ts`)

`user`, `session`, `account`, `verification`, `passkey` are Better Auth's
tables and Better Auth owns their shape. A mismatch is a runtime error the type
system cannot catch ("The field X does not exist in the Y Drizzle schema"),
because the library looks columns up by TypeScript property name — hence
`credentialID` keeping its odd casing, and hence `packages/auth`'s
`auth-schema.test.ts` comparing every table against `getAuthTables()` with
*every* runtime-toggleable plugin enabled. Plugins are switched on from
Settings, so the schema has to cover the ones currently off.

`push_subscriptions` is one row per **browser**, not per person:
`push_subscriptions_endpoint_key` is unique on `endpoint` because that is what
the push service issues, and keying on `user_id` would collapse someone's
laptop and phone into one device. Rows are deleted when a push service answers
404 or 410, rather than flagged dead.

### Audience (`audience.ts`)

Every address in this database is lowercased and trimmed by `normalizeEmail()`
at the ingestion boundary. Postgres compares text case-sensitively, so a
suppression list holding `bob@example.com` simply does not match
`Bob@Example.com` — the normalisation is what makes the unique indexes below
mean what they appear to mean.

- `contacts_email_key` — one row per address.
- `suppressions_email_key` — one row per suppressed address, which is what lets
  every suppression write be an `INSERT … ON CONFLICT (email) DO NOTHING`
  rather than a read-then-write that races another bounce webhook. This is
  the most important table in the project; membership is checked on every send
  path (see
  [Not sending to the wrong people](../../docs/ARCHITECTURE.md#not-sending-to-the-wrong-people)).
  `expires_at IS NULL` means permanent, and every check that reads the table
  honours it.
- `list_members_list_contact_key`, `contact_group_members_group_contact_key` —
  membership is a set, so a double-submitted "add to list" is a no-op.
  Unsubscribing sets `unsubscribed_at` rather than deleting the row, so a
  re-subscribe keeps its history.
- `contacts_created_idx` on `(created_at DESC, id DESC)` — the contacts list's
  keyset order, matched exactly. `listContactPage` seeks on
  `(created_at, id) < (…)` and orders by both, and `created_at` alone cannot
  serve that: a CSV import writes thousands of rows in the same millisecond,
  which is the collision the cursor exists for, and Postgres then sorts the
  whole collision group per page. Measured on 200k rows with 50k sharing a
  timestamp: 49.8ms with a full sort on the single-column `(created_at)` index
  this replaced, 0.133ms and no sort with this one. That narrower index —
  `contacts_created_at_idx`, from `0000` — was dropped in `0017`: a btree
  scans in either direction and this one leads with the same column, so it
  answered every query the other could while costing write throughput and
  storage on top. Do not re-add one.

### Campaigns and templates (`campaigns.ts`)

`campaign_recipients` is one row per `(campaign, contact)`, written up front
when a campaign is queued, then transitioned by the send worker and the webhook
handler. Suppressed and inactive contacts still get a row, marked `suppressed`
— filtering them out of the SELECT would be cheaper and would leave no trace
of why someone was skipped.

- `campaign_recipients_campaign_contact_key` on `(campaign_id, contact_id)` is
  the idempotency guarantee. Materialisation is one
  `INSERT … SELECT … ON CONFLICT (campaign_id, contact_id) DO NOTHING`, so a
  step that retries after a partial failure converges rather than producing a
  second copy of the email. The index, not the job, is the reason.
- `campaign_recipients_claim_idx` on `(campaign_id, status)` serves the claim.
  The worker takes work with `UPDATE … WHERE status = 'pending'` over a
  `SELECT … LIMIT n FOR UPDATE SKIP LOCKED` subquery — never `SELECT` then
  `UPDATE` — so two concurrent workers get disjoint slices and a row can be
  claimed once per attempt. This index answers that subquery directly, which is
  also why the claim carries no `ORDER BY`.
- `campaign_recipients_provider_message_idx` on `provider_message_id` keeps
  webhook correlation off a sequential scan.
- The `*_count` columns on `campaigns` are a **cache** for the dashboard,
  written optimistically by the worker and rebuilt from the recipient rows by
  the `reconcile-campaign-stats` cron. `campaign_recipients` is the truth.
- `campaigns.list_id` is `ON DELETE RESTRICT`. A null `list_id` means "every
  contact" to the materialiser, so allowing a deleted list to leave a null
  would silently turn a targeted campaign into a send to the whole database.
  No delete-list action exists yet; the constraint is there so that whoever
  writes one has to deal with campaigns first.
- `campaigns.custom_template_id` is `ON DELETE SET NULL` — deletion then falls
  back to the default design instead of leaving a dangling reference — and
  deletion is separately refused while an unsent campaign points at the row.
  `campaigns_custom_template_idx` exists for that guard, which otherwise
  scans every campaign ever sent.
- `campaigns_created_idx` on `(created_at DESC, id DESC)` — the Campaigns list
  pages by the same key as contacts, for the same reason.
- `templates` carries two unique indexes and they are its idempotency
  guarantee: `templates_checksum_key` makes the same file uploaded twice a
  no-op that returns the existing row, and `templates_name_key` on
  `lower(name)` stops two templates sharing a name in a picker where the name
  is the only thing distinguishing them. Case-insensitive because "Newsletter"
  and "newsletter" are one choice to a person.

### Events (`events.ts`)

`email_events` is an append-only log of every webhook Resend has sent.
`email_events_provider_event_key` on `provider_event_id` — the `svix-id`
header — is what makes the handler idempotent: the insert happens first, and a
conflict means "already processed, stop", *before* a counter is incremented or
an address is suppressed. Double-counting opens is cosmetic; double-suppressing
is not. The Redis claim in front of it is a latency optimisation that fails
open, so it can never be the guarantee.

### Inbound (`inbound.ts`)

Resend's `email.received` carries metadata only, so a row lands with
`content_fetched_at` NULL and a job fills in the body. The UI tolerates that
gap by design.

- `inbound_emails_provider_key` on `provider_email_id` dedupes webhook
  replays.
- `inbound_attachments_email_provider_key` on
  `(inbound_email_id, provider_attachment_id)` is the idempotency guarantee for
  hydration, and it was added later, in `0015`. A message is hydrated more than
  once as a matter of course — the webhook-triggered job and the hourly sync
  both pick up a row whose body has not landed — and the insert in
  `inbound-store.ts` relies on `ON CONFLICT DO NOTHING`. Before this index
  existed that clause had no unique constraint to conflict against, so it was
  a no-op and **every re-hydrate duplicated every attachment row**, silently.
  `0015` collapses the existing duplicates before creating the index.
- `inbound_emails_status_thread_idx` on `(status, thread_key)` exists for the
  sidebar badges, which are `count(DISTINCT thread_key) WHERE status = …`.
  Without it that is a full scan and a sort of every matching row on every page
  load — fine at a hundred messages, several hundred milliseconds at twenty
  thousand. Ordered this way it is an index-only group aggregate that streams,
  which is also what lets the count stop early and report "20k+".
- `thread_key` is computed in `deriveThreadKey()`, in application code, not by
  the database — so the rule stays testable.

### Threads and outbound (`threads.ts`)

`threads` is per-conversation state keyed by `thread_key`, with the absence of
a row as the default: an inbox of ten thousand untouched threads costs nothing.
Starring is a property of the conversation, so a new reply cannot un-star it.

`outbound_messages` holds replies, forwards and drafts in one table — a draft
is the same row with `status = 'draft'`.

- `outbound_client_key_key` is unique on `client_key`, which is nullable, so it
  constrains only the rows that have one: one row per queued send. The provider
  idempotency key used to be derived from the draft row's id, which the
  *server* mints, so a send queued offline with no draft minted a new row and a
  new key on every replay and a reply the worker never heard back about went
  out twice. The client generates `client_key` once when it queues the request;
  this index and the provider key derived from it collapse every replay onto
  the first attempt.
- `status` is this app's lifecycle (draft → queued → sent) and `last_event` is
  the provider's most recent delivery event. Deliberately two columns: a
  message can be `sent` from our side and `bounced` from the recipient's.
- `outbound_status_activity_idx` on
  `(status, (COALESCE(sent_at, updated_at)) DESC, id DESC)` serves the folder
  lists, and its measurement comes with a caveat worth keeping accurate: for a
  **single** status the index satisfies the ordering outright, with no Sort node
  — which is what Drafts (`status = 'draft'`) does. Sent filters
  `status IN ('sent','queued','failed')`, and no btree index can provide a
  global order across three leading-column values, so Postgres index-scans on
  status and sorts the result. That is inherent to the query shape rather than
  a defect in the index, and it is bounded by the page's `LIMIT`.
- `outbound_provider_idx` on `provider_message_id`: delivery webhooks arrive
  keyed by the provider's id, several per message, and without it each one is a
  full scan of the sent table.
- `outbound_attachments.bytes` is `bytea` in Postgres. The bytes live in the
  database so a self-hosted install needs a database and nothing else; an
  attachment is read twice, so object storage would buy nothing. Rows cascade
  with the message, so discarding a draft cannot leave orphaned blobs.

### Settings (`settings.ts`)

Three tables because the three kinds of value have different requirements:
`app_settings` is plain and queryable, `app_secrets` is encrypted at rest with
one row per key, `branding_assets` is bytes kept out of the row that is read on
every request.

`app_settings.id` is a `text` primary key defaulting to the literal
`'singleton'`. A primary key with one legal value is how you get a one-row
table in Postgres, and it is what makes
`INSERT … ON CONFLICT (id) DO UPDATE` an atomic upsert: two concurrent saves
cannot race a second configuration row into existence, and no code path has to
ask "does the settings row exist yet?" first.

Deliberately **not** here: `DATABASE_URL` and `AUTH_SECRET`. Settings stored in
Postgres cannot contain the credentials needed to reach Postgres, and secrets
encrypted at rest cannot contain their own key.

### Enums

Every status `pgEnum` in this package is built from a tuple in
`packages/shared/src/enums.ts` — `CONTACT_STATUSES`, `SUPPRESSION_REASONS`,
`CAMPAIGN_STATUSES`, `RECIPIENT_STATUSES`, `INBOUND_STATUSES`,
`OUTBOUND_STATUSES` — so the Postgres vocabulary and the Zod vocabulary cannot
drift. They already had: the realtime contract lacked `trash` two migrations
after the database gained it, and a trashed thread was published as `archived`
to paper over the gap. `email_template_kind` works the same way, from
`TEMPLATE_KINDS` in `packages/shared/src/templates.ts`.

Tuple **order** is not decorative. Postgres stores an enum by ordinal, so each
tuple is in the order the migrations created the values, with later
`ADD VALUE`s appended. drizzle-kit diffs the list against its snapshot;
reordering the tuple generates a migration that reorders nothing.

Two enums are declared locally because nothing outside the database validates
them: `attachment_disposition` and `asset_storage`.

## Migrations

Generated by drizzle-kit from the schema files, committed as SQL, applied by
`src/migrate.ts`. All four scripts run from the repository root as well, via
the root `package.json`.

| Command | What it does |
| --- | --- |
| `pnpm db:generate` | Diff `src/schema/index.ts` against `migrations/meta/*_snapshot.json` and write a new SQL file plus a snapshot and a `_journal.json` entry. |
| `pnpm db:migrate` | Apply pending migrations over one dedicated connection. This is the only command that should ever touch a database with data in it. |
| `pnpm db:push` | Diff the schema straight into a database with no migration file. Development only — it produces no artefact for anyone else, and `strict: true` in `drizzle.config.ts` means it asks before running the statements. |
| `pnpm db:studio` | Drizzle Studio against `DATABASE_URL`, for reading rows. |

**`db:generate` is interactive.** drizzle-kit cannot tell a renamed column from
a dropped-and-added pair, so it asks — and it asks about tables too. Answer
carefully: choosing "created" where you meant "renamed" generates a migration
that drops the column and its data. This is also why CI cannot run it, which
has a consequence in the next paragraph.

**The schema files and the committed SQL must never disagree.** The way to
check is to run `pnpm db:generate` and see it report *no schema changes*; if it
writes a file, the difference it found is drift and the file it produced is
your migration. Do that before opening a pull request, because nothing else
will: CI's `migrations` job applies the committed migrations to an **empty**
database in a job of its own — which proves they apply cleanly and in order,
in isolation from the `check` job's own migrate step — but both jobs run the
same committed files, so neither detects a schema change that was never
generated.

**A hand-edited migration keeps its generated statements intact.** Two here
have hand-added SQL, both for the same reason — a generated `ALTER` or
`CREATE UNIQUE INDEX` cannot succeed against existing data:

- `0014_custom_templates.sql` opens with `DELETE FROM "templates"`. The new
  `checksum` column is `NOT NULL` with no default, and the table's old shape
  had never been written to by the app, so hand-placed rows are removed rather
  than left to fail the `ALTER`.
- `0015_dedupe_indexes_client_key.sql` opens with a self-join `DELETE` that
  collapses duplicate `inbound_attachments` onto the earliest row, because the
  unique index created three statements later would otherwise be refused.

Add such a statement *before* the generated block, leave the generated
statements and their `--> statement-breakpoint` separators exactly as written,
and say in a comment why the data change is safe. Re-running `db:generate`
afterwards must still report no changes: drizzle-kit compares against the
snapshot, not against the SQL, so an edit that changes the schema's shape
without updating the snapshot is invisible to it.

## Invariants a contributor must preserve

1. **A guarantee belongs in a constraint, not in application code that races
   itself.** "Check whether it exists, then insert" is two statements with a
   window between them; under two workers, a retried job or a double-clicked
   button, both checks pass. Attempt the write and interpret the refusal —
   `isUniqueViolation` exists for that.
2. **Every write reachable twice needs a unique index *and* an `ON CONFLICT`,
   and the index is the guarantee.** A bare `ON CONFLICT DO NOTHING` targets
   any unique violation, so it is valid SQL against a table with no matching
   index and does nothing at all. That is not hypothetical: it is exactly how
   attachment rows were duplicated on every re-hydrate while the code above
   read as idempotent (see the docstring on
   `inbound_attachments_email_provider_key`). Deleting an index deletes a
   guarantee somewhere else, with no error anywhere.
3. **Claims are arbitrated by the database.** Work is taken with
   `UPDATE … WHERE status = 'pending' … RETURNING`, inside
   `FOR UPDATE SKIP LOCKED` where concurrency is expected. Never `SELECT` then
   `UPDATE` across an `await`.
4. **Status transitions are monotonic.** Out-of-order webhooks are normal, and
   an open arriving after a bounce must not move a row backwards. The `CASE`
   ladder that enforces it is generated from `@sendstack/shared`; a new status
   value goes there.
5. **Enums are built from `@sendstack/shared`.** Never declare a status tuple
   inline here, and never reorder an existing one.
6. **Addresses are stored normalised.** Every unique index on an email column
   depends on it, and Postgres will not do it for you.
7. **This package imports nothing from the repository except
   `@sendstack/shared`.** Not `@sendstack/email`, not `@sendstack/jobs`, not
   `@sendstack/redis`, not `@sendstack/config`. The dependency runs one way:
   everything sits on top of the database, and pulling a provider or the
   optional cache in here would invert that and make the schema unimportable
   by the tools that only want types.
8. **Denormalised counters are never the source of truth.** Add one only with
   the reconciler that rebuilds it, and read the rows when correctness matters.
9. **A new index is justified by a named query and measured.** Say which query
   in the docstring and what `EXPLAIN (ANALYZE, BUFFERS)` said, run through
   the application's own query builder rather than SQL retyped into `psql`.
   Every index costs every write to the table; the ones here that look
   redundant are not, and the docstrings say why.
10. **Application code uses the pool.** One pool, `db`, from this package. The
    only connections outside it are `src/migrate.ts` and the setup wizard's
    `probeDatabaseUrl` in `apps/web/src/actions/setup.ts` — a migration must
    not compete for pool slots, and an untrusted URL that may not resolve must
    not become the process-wide client. A third exception needs the same kind
    of reason written down beside it.

## Editing the package

**Adding a table.** Put it in the schema file for its area rather than a new
one; the seven files are areas, not sizes. Decide four things and write each
into a docstring: what the primary key is, which write path can reach it twice
and therefore which unique index it needs, what every foreign key does on
delete (`cascade` for owned children, `set null` for references that may
outlive their target, `restrict` where a null would change the meaning of a
row — see `campaigns.list_id`), and which query each index serves. Then
`pnpm db:generate`, read the SQL it produced line by line, `pnpm db:migrate`,
and add the table to the Files table below if it introduces a new file.

**Adding a column.** `NOT NULL` needs a default, or a two-step migration, or a
documented reason the table is empty. Nullable-and-backfilled is usually the
honest option; a `NOT NULL DEFAULT` on a large table rewrites nothing on
Postgres 11+ but still takes a brief `ACCESS EXCLUSIVE` lock. If the column
holds a status, its type comes from `@sendstack/shared`. If it holds bytes, use
the shared `bytea` from `src/schema/types.ts` rather than redeclaring a custom
type — two custom types with one name and different definitions surface as a
corrupted download months later.

**Adding an index.** Justify it with a query, name the query in the docstring,
and record the measurement. Match the sort exactly for a keyset paginator:
`(created_at DESC, id DESC)` and `(created_at)` are not interchangeable, as
`contacts_created_idx` documents. If the index is there to make an
`ON CONFLICT` work, it must be `uniqueIndex` (or `unique`), and it should be
in the same commit as the insert that depends on it, with a test that runs the
write twice.

**Adding an enum value.** Add it to the tuple in
`packages/shared/src/enums.ts` (or `templates.ts`, for a template kind),
**appended, never inserted**, because the
`pgEnum` here reads that tuple and Postgres stores enum values by ordinal.
Then `pnpm db:generate` — drizzle-kit emits
`ALTER TYPE … ADD VALUE '…'` — and check every consumer of the union the
compiler now flags: exhaustive `switch`es, the realtime schemas in
`@sendstack/shared`, and any SQL `CASE` ladder over the status. Postgres cannot
remove an enum value, so this is a one-way door.

**Verifying any of the above**, from the repository root:

```bash
pnpm db:generate   # must report no schema changes once you are done
pnpm db:migrate    # applies cleanly, in order
pnpm typecheck     # every package, not just the one you edited
pnpm test          # the integration suites are the only ones that run real SQL
```

## Testing

The unit tests here need no database:

```bash
npx vitest run packages/db
```

That is `src/sql-array.test.ts` — the array literal, the cast, and the fact
that values are parameterised rather than inlined. There is little else in this
package that can be tested without Postgres, because what it mostly contains
*is* Postgres.

The schema's actual guarantees are proven from the packages above it, by suites
that run the SQL the app generates:

| Suite | Proves |
| --- | --- |
| `apps/web/src/lib/queries/queries.integration.test.ts` | Every query module's SQL parses and runs, including the keyset paginators. |
| `apps/web/src/lib/queries/suppressions.integration.test.ts` | The suppression check, including the normalisation it depends on. |
| `apps/web/src/app/api/webhooks/resend/route.integration.test.ts` | The webhook handler run **twice** with Redis mocked absent yields one `email_events` row — the index, not the claim, is the guarantee. |
| `apps/web/src/actions/compose.replay.integration.test.ts` | A replayed offline send yields one `outbound_messages` row and one provider call, however many times the service worker retries. |
| `apps/web/src/actions/campaigns.guards.integration.test.ts` | Pause and cancel are single conditional `UPDATE … RETURNING`s, so an illegal source status is refused by the statement rather than by a check that could interleave with one. |
| `packages/jobs/src/pipeline.duplicity.integration.test.ts` | Materialisation and hydration are idempotent. Dropping either unique index makes this file fail, which is the only way that dependency is visible at all. |

All of them go through `test/database-suite.ts`, which **skips** locally
without `DATABASE_URL` — `git clone && pnpm test` has to pass without
provisioning anything — and **throws** when `CI` is set and the variable is
absent. A suite that silently skips in CI reports green and proves nothing.

For a local database:

```bash
docker compose up -d postgres
```

Then set the two variables that cannot live in the database, in `.env` at the
repository root:

```bash
DATABASE_URL="postgresql://sendstack:sendstack@localhost:5432/sendstack"
AUTH_SECRET="$(openssl rand -base64 32)"
```

and run `pnpm db:migrate` before `pnpm test`. Everything else Sendstack needs
is configured through the setup wizard and stored in the database.

## Files

| File | Holds |
| --- | --- |
| `src/index.ts` | The public surface: `db`, `Database`, `sqlArray`, the two error predicates, the schema as both a namespace and named exports, and the re-exported drizzle-orm operators. |
| `src/client.ts` | The lazy, globally cached pool. Pool sizing, timeouts, `prepare: false`, the `Proxy`. |
| `src/migrate.ts` | The `db:migrate` entry point. Its own single connection, its own `.env` loading. |
| `src/sql-array.ts` | `sqlArray` — a Postgres array literal for `= ANY(...)`. |
| `src/pg-errors.ts` | `isUniqueViolation`, `isForeignKeyViolation`, by SQLSTATE. |
| `src/schema/index.ts` | Re-exports the seven schema files. The single entry drizzle-kit reads. |
| `src/schema/auth.ts` | Better Auth's tables, plus `push_subscriptions`. |
| `src/schema/audience.ts` | `contacts`, `lists`, `list_members`, `contact_groups`, `contact_group_members`, `suppressions`. |
| `src/schema/campaigns.ts` | `templates`, `campaigns`, `campaign_recipients`. |
| `src/schema/events.ts` | `email_events`. |
| `src/schema/inbound.ts` | `inbound_emails`, `inbound_attachments`. |
| `src/schema/threads.ts` | `threads`, `outbound_messages`, `outbound_attachments`. |
| `src/schema/settings.ts` | `app_settings`, `app_secrets`, `branding_assets`. |
| `src/schema/types.ts` | The shared `bytea` custom type. |
| `drizzle.config.ts` | Schema path, output folder, `strict`, `verbose`, and the repo-root `.env` load that lets `db:generate` run from anywhere. |
| `migrations/*.sql` | The committed migrations, applied in journal order. |
| `migrations/meta/_journal.json` | The ordered list drizzle-kit and the migrator both read. Never hand-edit it. |
| `migrations/meta/*_snapshot.json` | What `db:generate` diffs the schema against. Committed alongside each migration; a snapshot without its SQL, or the reverse, makes the next generate wrong. |

### The migrations

| # | Did |
| --- | --- |
| `0000_init` | Auth tables, contacts, lists, list members, suppressions, campaigns, campaign recipients, templates, email events, inbound emails and attachments; the five original enums; the `(campaign_id, contact_id)`, `provider_event_id` and `provider_email_id` unique constraints. |
| `0001_settings_branding_passkey` | `app_settings` (singleton), `app_secrets`, `branding_assets`, `passkey`, and the `email_template_kind` enum. |
| `0002_cloudinary_assets` | Cloudinary columns on `app_settings` and `branding_assets`; the `asset_storage` enum; made `mime_type`, `bytes` and `byte_size` nullable so a Cloudinary-backed row can carry a URL instead. |
| `0003_account_issuer` | `account.issuer`, required by Better Auth. |
| `0004_short_amphibian` | `contacts.company`, `.position`, `.phone`. |
| `0005_threads_and_outbound` | `threads` and `outbound_messages`; the `outbound_status` enum; `trash` appended to `inbound_status`. |
| `0006_outbound_last_event` | `outbound_messages.last_event`, `.last_event_at`. |
| `0007_clear_korvac` | `contact_groups` and `contact_group_members`. |
| `0008_campaign_template` | `campaigns.email_template`. |
| `0009_compose_bcc` | `outbound_messages.bcc_emails`. |
| `0010_outbound_attachments` | `outbound_attachments` and the `attachment_disposition` enum. |
| `0011_postal_address` | `app_settings.postal_address`, for the CAN-SPAM footer. |
| `0012_push_subscriptions` | `push_subscriptions`, and the VAPID public key and subject on `app_settings`. |
| `0013_count_indexes` | `inbound_emails_status_thread_idx` and `outbound_provider_idx` — the sidebar counts and webhook correlation. |
| `0014_custom_templates` | Reshaped `templates` for uploaded designs (`description`, `checksum`, `created_by`; dropped `subject` and `text`), added `campaigns.custom_template_id`, and the checksum and `lower(name)` unique indexes. **Hand-edited**: opens with `DELETE FROM "templates"`. |
| `0015_dedupe_indexes_client_key` | The dedupe pass. `inbound_attachments` unique index, `outbound_messages.client_key` plus its unique index, `campaigns.list_id` re-pointed to `ON DELETE RESTRICT`, `campaigns_created_idx`, `outbound_status_activity_idx`. **Hand-edited**: opens with a `DELETE` collapsing existing duplicate attachments. |
| `0016_contacts_sort_index` | `contacts_created_idx` on `(created_at DESC, id DESC)` — the contacts keyset order. |
| `0017_drop_redundant_contacts_index` | Dropped `contacts_created_at_idx`. `contacts_created_idx` leads with the same column and a btree scans either direction, so it was serving nothing `0016` did not. |
