# @sendstack/shared

The contract layer for [Sendstack](../../README.md). Every value, vocabulary,
shape and rule that has to mean the same thing in two places is declared here
once and imported everywhere else. [PRODUCT.md](../../PRODUCT.md) states it as
an architecture boundary — "shared runtime contracts live in packages/shared" —
and this package is where that boundary is kept.

It is **not** a utility bin, and it is not a place for anything that only runs
on a server. `package.json` lists exactly one runtime dependency, `zod`; the dev
dependencies are `typescript` and `@types/node`. There is no drizzle, no
Postgres driver, no Resend client, no React, no `server-only`. That is a
constraint, not an accident: this is the only workspace package that both server
code and browser code import freely, so anything server-only added here would be
pulled into a client bundle by the next component that imports a constant.
`crypto.randomUUID()` and `TextEncoder` are the only globals used, and both exist
in Node and in the browser.

The package is also entirely pure. No module reads configuration, opens a
connection or performs I/O, which is what makes the rules in it testable without
a database — see [Testing](#testing).

## Where it is used

| Consumer | What it takes from here |
| --- | --- |
| [`packages/db`](../db/README.md) | The six enum tuples in `enums.ts`, passed straight to `pgEnum` — `INBOUND_STATUSES` in `schema/inbound.ts`, `CONTACT_STATUSES` and `SUPPRESSION_REASONS` in `schema/audience.ts`, `OUTBOUND_STATUSES` in `schema/threads.ts`, `CAMPAIGN_STATUSES` and `RECIPIENT_STATUSES` in `schema/campaigns.ts` — plus `TEMPLATE_KINDS` for `email_template_kind` in `schema/settings.ts`. The database's enum vocabulary *is* this file. |
| `packages/config` | `AUTH_SECRET_MIN_LENGTH` in `crypto.ts` (the gate before a key is derived from the secret) and in `setup-state.ts` (whether the instance is configured); the `TemplateKind` type in `config.ts` for the stored default design. |
| `packages/auth` | `AUTH_SECRET_MIN_LENGTH` and `MIN_PASSWORD_LENGTH` in `src/server.ts`. The second is what Better Auth's `minPasswordLength` is set from, so the server cannot reject a password the form accepted. |
| [`packages/email`](../email/README.md) | `SEND_BATCH_SIZE` in `send.ts`; `DELIVERY_EVENT_NAMES` and `DeliveryEventName` in `webhooks.ts`; `deriveThreadKey`, `parseAddress` and `toSnippet` in `inbound.ts`; `TEMPLATE_META` and `TemplateKind` in `templates/index.tsx` (re-exported from the package's own index); `BODY_SLOT` in `templates/custom.ts`, which builds the splice regex from it; `normalizeEmail` and `AUTH_SECRET_MIN_LENGTH` in `unsubscribe.ts`. |
| [`packages/jobs`](../jobs/README.md) | `SEND_BATCH_SIZE` sizes an Inngest step in `functions/send-campaign.ts`; `delivery-sql.ts` enumerates `RECIPIENT_STATUSES`/`OUTBOUND_STATUSES` through `nextRecipientStatus`/`nextOutboundStatus` to generate the SQL `CASE`; `outbound-store.ts` uses `recipientStatusForEvent`, `outboundStatusForEvent` and `normalizeEmail`; `inbound-store.ts` uses `deriveThreadKey` and `parseAddress`. |
| [`packages/redis`](../redis/README.md) | `REALTIME_CHANNEL`, `RealtimeEvent` and `parseRealtimeEvent` in `src/realtime.ts` — the publisher validates against the union and the subscriber parses against it. |
| `apps/web` | The widest consumer, on both sides of the network. `schemas.ts` supplies every `zodResolver` (`auth-form.tsx`, `create-campaign-modal.tsx`, `compose-dialog.tsx`, `branding-section.tsx`, the four `steps-infra.tsx` forms, `security-tab.tsx`, `create-list-modal.tsx`, `add-contact-modal.tsx` via `contactInputSchema.pick`) *and* the Server Action that receives each of those forms in `src/actions/`. `parseRealtimeEvent` runs in `hooks/use-realtime.ts` and `RealtimeEvent` types `stores/realtime-store.ts`. The page-size constants set the `LIMIT` in `lib/queries/{inbox,audience,outbound,templates}.ts`; `SSE_HEARTBEAT_MS` sets the keepalive in both SSE routes; `SOFT_BOUNCE_LIMIT` is the suppression threshold in the Resend webhook route; the attachment limits and `formatBytes` are read by `actions/attachments.ts` and by the attachment UI. |

`packages/theme` and `packages/pwa` are the two workspace packages that do *not*
depend on this one — both are presentation-only and neither touches a domain
rule.

## The modules

`src/index.ts` is the public surface, and it re-exports most modules wholesale
with `export *`. The one exception is documented under
[`delivery-status.ts`](#delivery-statusts).

### `constants.ts`

Every number that two places have to agree about.

- `SEND_BATCH_SIZE` (100) — Resend's batch endpoint limit. An Inngest step is
  sized to match so that one step is one API call and a retry replays exactly
  one batch.
- `SOFT_BOUNCE_LIMIT` (3) — consecutive soft bounces before an address is
  suppressed.
- `REALTIME_CHANNEL`, `SSE_HEARTBEAT_MS` — the pub/sub channel name and the
  keepalive interval that keeps a proxy from cutting an idle SSE stream.
- `INBOX_PAGE_SIZE`, `CONTACTS_PAGE_SIZE`, `OUTBOUND_PAGE_SIZE`,
  `CAMPAIGNS_PAGE_SIZE` — the default `LIMIT` for each list query.
- `MIN_PASSWORD_LENGTH` (12) — read by Better Auth's `minPasswordLength` *and*
  by every Zod password field here. It lived in four places before this
  constant, which meant a form could accept a password the server then rejected
  in worse words.
- `AUTH_SECRET_MIN_LENGTH` (32) — five modules each checked "at least 32" with
  their own literal.
- `MAX_ATTACHMENT_BYTES` (4MB), `MAX_ATTACHMENTS_TOTAL_BYTES` (20MB),
  `MAX_ATTACHMENTS_PER_MESSAGE` (20), `INLINE_IMAGE_TYPES`. The per-file cap is
  deliberately far below what Resend accepts, because Vercel caps a function
  request body at 4.5MB whatever the framework says — a 20MB attachment would
  fail at the platform with an error nobody in the app can explain.
- `formatBytes(bytes)` — the one human-readable size formatter, so the error
  message and the file list use the same words.

Read by: `apps/web` throughout, `packages/auth`, `packages/config`,
`packages/email`, `packages/jobs`, `packages/redis`.

### `enums.ts`

The six database status vocabularies as `as const` tuples:
`INBOUND_STATUSES`, `SUPPRESSION_REASONS`, `OUTBOUND_STATUSES`,
`CAMPAIGN_STATUSES`, `RECIPIENT_STATUSES`, `CONTACT_STATUSES`, each with its
derived union type.

The one rule it makes single is *what the valid values are*. `packages/db`
builds its `pgEnum` from these tuples and `schemas.ts` builds its `z.enum` from
them, so the database, the validator and the TypeScript union cannot drift. They
had: the realtime contract lacked `trash` for two migrations after the database
gained it in `0005_threads_and_outbound.sql`, and a trashed thread was published
as `archived` to paper over the gap.

**Order is load-bearing.** Postgres stores an enum by ordinal, so each tuple is
in the order the migrations created the values with later `ADD VALUE`s appended.
drizzle-kit diffs the list against its snapshot, and reordering here would
generate a migration that reorders nothing.

Read by: `packages/db` (as `pgEnum` arguments), `schemas.ts`, `realtime.ts`,
`delivery-status.ts`, `packages/jobs`, `apps/web`.

### `email-address.ts`

Address handling, and the two other pieces of inbound-mail derivation that sit
beside it.

`normalizeEmail(input)` trims and lowercases. That is all, deliberately: it does
**not** strip Gmail dots or `+tags`, because `a.b@e.com` and `ab@e.com`, or
`a+promo@e.com` and `a@e.com`, are genuinely different mailboxes as far as a mail
server is concerned. Merging them would let a suppressed address receive mail
under an alias — a correctness bug wearing the costume of a convenience. The
tests assert the non-merging explicitly.

Also here:

- `isLikelyValidEmail(input)` — a cheap syntactic gate (one `@`, a dot in the
  domain, length bounds, no whitespace) that keeps obvious CSV garbage away from
  the provider. It cannot tell you an address exists; nothing can, short of
  sending to it.
- `parseAddress(input)` — splits `"Ada Lovelace" <ada@example.com>` into name
  and normalised address.
- `deriveThreadKey({ messageId, inReplyTo, references })` — the conversation
  key. Prefers the head of `References` because clients append to that header as
  a reply chain grows, so its first entry is stable across the whole thread.
- `toSnippet(body, limit)` — a list-row preview from HTML. The pass order is
  deliberate and commented: comments and `<style>`/`<script>` blocks go first,
  whole, because stripping `<[^>]+>` first would eat the opening half of an
  Outlook conditional comment and leave `<![endif]-->` behind as visible
  punctuation.

Read by: `schemas.ts` and `merge-fields.ts` inside this package;
`packages/email` (`inbound.ts`, `unsubscribe.ts`), `packages/jobs`
(`inbound-store.ts`, `outbound-store.ts`), `apps/web`.

### `schemas.ts`

One Zod schema per shape, used by the React Hook Form resolver *and* by the
Server Action that receives the result. The client copy is a convenience; the
server copy is the one that matters, and it never trusts the client's.

Grouped by surface: contacts and lists (`contactInputSchema`,
`contactGroupInputSchema`, `listInputSchema`, `addToListSchema`,
`importRowSchema`), campaigns (`campaignInputSchema`, `campaignFormSchema`,
`scheduleCampaignSchema`), templates (`templateRefSchema`,
`customTemplateInputSchema`), composing (`composeSingleSchema`,
`composeSendSchema`, `composeBulkSchema`, `replySchema`, `splitAddressList`),
suppressions (`suppressionInputSchema`), auth (`signUpSchema`, `signInSchema`,
`forgotPasswordSchema`, `resetPasswordSchema`, `changePasswordSchema`,
`newPasswordField`) and the setup wizard (`bootstrapSchema`,
`brandingFormSchema`, `emailConfigSchema`, `realtimeConfigSchema`,
`jobsConfigSchema`, `adminAccountSchema`, `nameField`).

Two habits worth copying when you add one:

- **Compose, never re-list.** `emailField` is the one address field;
  `newPasswordField` is the one password rule; `templateRefSchema` refines
  through `parseTemplateRef` rather than repeating the four built-in kinds;
  `campaignInputSchema` takes its `emailTemplate` values from `TEMPLATE_KINDS`
  and its suppression reasons from `SUPPRESSION_REASONS`. `apps/web`'s
  add-contact form does the same thing one level up — `contactInputSchema.pick(…)`
  rather than a fresh object.
- **Put the cross-field rule in the schema.** "The from-address must be at your
  sending domain" and "an `https://` Redis URL needs a token" were server-only
  checks, so the first time anyone learned about them was a round trip and an
  error banner. They are `superRefine`s now and the form catches them.

`composeSendSchema` deserves a note. It is the shape a single send travels over
`fetch` in, and it is declared here rather than in the route because two sides
read it: the route validates an incoming body against it, and the browser's
offline outbox builds the body it stores in IndexedDB from it. `QueueableSend`
is deliberately `z.input<…>` — it describes what the browser hands over *before*
parsing. `clientKey` is the idempotency identity of a queued send: the browser
mints it once so that however many times a worker replays the body, every
attempt lands on the same `outbound_messages` row and the same provider key.

Read by: `apps/web` — every form resolver and the matching Server Action or
route handler.

### `realtime.ts`

`realtimeEventSchema` is a Zod discriminated union on `type`, and it is the only
description of a realtime event's shape anywhere in the repo. Five variants:
`inbound.received`, `inbound.updated`, `outbound.updated`, `campaign.progress`,
`suppression.added`. `RealtimeEvent` and `RealtimeEventType` are inferred from
it; `parseRealtimeEvent(raw)` accepts a string or an object and returns `null`
instead of throwing.

It is parsed on **both** ends. The publisher (`publishRealtime` in
`packages/redis`) sends a typed `RealtimeEvent`; the subscriber and the browser
hook run `parseRealtimeEvent` and drop anything that does not match, so a stale
deploy publishing an old shape cannot corrupt a newer client's state. That is
also why the union imports its vocabularies rather than restating them:
`inbound.updated.status` is `z.enum(INBOUND_STATUSES)` and
`outbound.updated.event` is `z.enum(DELIVERY_EVENT_NAMES)`. Both were written
out by hand once, and both drifted.

Read by: `packages/redis` (`src/realtime.ts`), `apps/web`
(`hooks/use-realtime.ts`, `stores/realtime-store.ts`), and every publisher in
`packages/jobs` and the webhook route.

### `merge-fields.ts`

`MERGE_FIELDS` is the list of fields a bulk send can personalise with —
`firstName`, `lastName`, `email`, `company`, `position`, `phone` — each with a
label, an example for the palette, and the header spellings it answers to.

Three things read it and they have to agree or personalisation breaks silently:
the CSV importer deciding which column is which, the editor's tag palette
(`apps/web/src/components/compose/merge-tags.tsx`), and the send job building
the context it substitutes into. A tag offered in the UI that the sender does
not populate renders as an empty string in someone's inbox — "Hi ," — and
nothing anywhere reports it.

Also here:

- `fieldForHeader(header)` — which merge field a CSV header refers to, matching
  case- and separator-insensitively, so `First Name`, `first_name` and
  `FIRSTNAME` are one column.
- `parseRecipients(input)` → `ParseResult` — turns pasted text into recipients.
  It accepts both shapes people actually have (a bare address list, or a CSV
  with headers) and decides which by looking for a recognisable `email` header.
  It splits CSV lines itself rather than on commas, because a `company` column
  holding `Acme, Inc.` would otherwise shift every later column and produce an
  import that looks like it worked. Bad rows land in `skipped` with a reason and
  duplicates are counted, never silently dropped: an import that reports "400
  added" while discarding 100 is how a campaign goes to two-thirds of its
  audience with nobody noticing. `available` reports the tags the data can
  actually fill — a column present but blank throughout does not count.
- `unresolvableTags(html, available)` — the merge tags a body references that
  the recipients cannot fill. It counts `{{#if field}}` as a use of that field,
  because a block gated on a column the list lacks vanishes silently, which is
  the same defect as "Hi ,". `unsubscribeUrl` and `attributes.*` are exempt:
  the sender supplies the first and the second is open-ended.

Read by: `apps/web` (`actions/compose.ts`, the merge-tag palette),
`custom-templates.ts` in this package (both the placeholder allow-list and the
generated prompts).

### `templates.ts`

`TEMPLATE_KINDS` — `simple`, `announcement`, `newsletter`, `plain` — and
`TEMPLATE_META`, the name, description and "best for" copy each design shows in
a picker. `isTemplateKind(value)` is the narrowing guard.

The list lives here rather than beside the components in `packages/email`
because both sides need it: the renderer picks a component by kind, and the
browser needs the names to offer a choice. Importing `packages/email` from a
client component would pull the renderer — and through it Postgres and
Cloudinary — into the browser bundle. This file exists to prevent that build
failure. The tuple is also the `email_template_kind` enum in the database
(created in `0001_settings_branding_passkey.sql`), built as a `pgEnum` in
`packages/db/src/schema/settings.ts`.

Read by: `packages/db`, `packages/config`, `packages/email`,
`schemas.ts` and `custom-templates.ts` here, `apps/web` (both template pickers,
`actions/settings.ts`, the marketing screens).

### `custom-templates.ts`

The opposite of `templates.ts`: not the closed list of shipped designs, but the
contract an operator's *own* uploaded HTML must meet to be rendered by the same
pipeline.

- `CUSTOM_TEMPLATE_SLOTS` and `BODY_SLOT` — the placeholders the renderer fills,
  with the author-facing description of each. `body` is the only slot inserted
  raw, with three braces; everything else is HTML-escaped text.
- `validateCustomTemplate(html)` → `CustomTemplateCheck` — every rule the
  renderer actually enforces, reported all at once with the offending token
  named rather than the rule. Pure, and here rather than in a route, so the form
  runs it before the round trip and the Server Action runs the identical check
  before writing. Neither trusts the other.
- `parseTemplateRef`, `customTemplateRef`, `templateColumns`, `TemplateRef` —
  a design reference is a single string (`newsletter`, or `custom:<uuid>`)
  because it travels as one: React state, a JSON field in the offline outbox, a
  query parameter on the preview route, a column pair on a campaign.
  `templateColumns` is the only place that decides which of those two columns a
  reference lands in.
- `CUSTOM_TEMPLATE_PROMPTS` — the `generate` and `adapt` prompts an author can
  hand to an LLM, built from `CUSTOM_TEMPLATE_SLOTS` and `MERGE_FIELDS` at
  module load so adding a slot updates both prompts without anyone remembering
  to. A test pins that.
- `MAX_CUSTOM_TEMPLATE_BYTES`, `CUSTOM_TEMPLATE_NAME_MAX`,
  `CUSTOM_TEMPLATE_DESCRIPTION_MAX`, `CUSTOM_TEMPLATE_LIST_LIMIT`,
  `CustomTemplateSummary`, `isKnownTemplatePlaceholder`.

[docs/CUSTOM-TEMPLATES.md](../../docs/CUSTOM-TEMPLATES.md) is the authoring
guide and covers the contract in full — slot by slot, with the reasoning behind
each rule. Do not restate it here or in a docstring; extend it.

Read by: `packages/email` (`templates/custom.ts` builds its splice regex from
`BODY_SLOT`), `schemas.ts` here, `apps/web`
(`components/settings/custom-templates-section.tsx`,
`components/compose/template-picker.tsx`, `lib/queries/templates.ts`,
`actions/compose.ts`, `actions/campaigns.ts`, the preview route).

### `delivery-status.ts`

The one place a provider delivery event becomes one of our statuses, and the one
place the monotonic ladder is defined.

- `DELIVERY_EVENT_NAMES` — the eight events Resend posts by webhook, minus the
  `email.` prefix. `emails.list()` reports a wider `last_event` vocabulary
  (`queued`, `scheduled`, `canceled`, `suppressed`) which the maps below also
  cover, but only these eight arrive by webhook.
- `recipientStatusForEvent(event)` / `outboundStatusForEvent(event)` — the
  status an event asserts, before the ladder. Both accept the prefixed and bare
  forms. An unknown event maps to `sent`, because the message did leave and a
  later event corrects the row; marking it `failed` would lie on the dashboard.
- `nextRecipientStatus(current, incoming)` / `nextOutboundStatus(current,
  incoming)` — the ladder. A row only moves forward, and a terminal state is
  never overwritten. Opens and clicks routinely arrive after a bounce and a
  click must never erase the bounce that says the address is dead.

Three consumers apply these events — the webhook route, the sent-mail
reconciler, and the send worker's post-send write — and each carried its own
copy before this file. They had already drifted: the route dropped
`delivery_delayed` on the floor, and a complaint became `sent` in one place and
`failed` in another. The resolutions are deliberate and documented in the
docstrings: `delivery_delayed` is `sent` (transient — calling it a failure would
suppress a healthy address), a complaint is `failed` for an outbound message (a
thread showing the reply as cleanly sent hides the one fact the sender needs).

The SQL `CASE` those consumers run is **generated** from these functions, not
written beside them. Because this package has no drizzle, the generator lives in
`packages/jobs/src/delivery-sql.ts`, which enumerates `RECIPIENT_STATUSES` and
`OUTBOUND_STATUSES` through the two `next*` functions. What lives here is the
rule, testable without a database.

**`index.ts` exports this module by name, not with `export *`.** It re-exports
`OUTBOUND_STATUSES`, `RECIPIENT_STATUSES`, `OutboundStatus` and `RecipientStatus`
from `enums.ts` as a convenience for its own consumers, and two `export *`
sources carrying the same four names would be an ambiguous re-export. So the
index names the five delivery-specific exports plus `DeliveryEventName`, and the
enum tuples reach consumers through `export * from "./enums"` — one binding, one
origin.

### `text.ts`

Word capitalisation for name fields: `toTitleCase`, `capitalizeTypedInput`,
`normalizeName`.

The rule it makes single is *how a name is cased*, and it is narrower than it
looks. It never lowercases anything and only touches a word that is entirely
lowercase, because the naive `replace(/\b\w/g, …)` turns `IBM` into `Ibm`,
`eBay` into `EBay` and `iPhone` into `IPhone`, and people notice when software
mangles their own name. `capitalizeTypedInput(previous, next)` only transforms
when the value grew, which is what stops the transform fighting an edit —
someone who wants `basecamp` can backspace over the `B` and it stays lowercase.
The remaining trade-off is stated plainly in the docstring: a deliberately
lowercase name becomes capitalised on first typing.

Read by: `apps/web` (`components/ui/name-input.tsx`,
`components/ui/inline-text.tsx`, `actions/settings.ts`).

## Invariants — what an edit must preserve

These are the rules the rest of the app is written against. Breaking one rarely
fails a test loudly; it produces a bug that reports nothing.

1. **No server-only dependency may be added to this package.** No drizzle, no
   `pg`, no Resend, no React, no `server-only`, no `node:` import. `zod` is the
   only runtime dependency and adding a second is a decision, not a chore. A
   client component importing one constant from here must not drag a database
   driver into the browser bundle — that is the build failure `templates.ts`
   exists to prevent, and it will happen again the first time this rule slips.
2. **Everything here stays pure.** No I/O, no configuration read, no clock or
   randomness that a caller cannot supply. Purity is what lets the delivery
   ladder be proved without a database and the template contract be checked in a
   browser before a round trip.
3. **A value that must agree across packages is declared here and imported,
   never re-listed.** A second copy is the defect, and it is where the drift
   starts. Every constant in `constants.ts` and every tuple in `enums.ts`
   carries the history of the copies it replaced; treat those docstrings as the
   evidence.
4. **`enums.ts` is the database's enum vocabulary, in migration order.**
   `packages/db` builds `pgEnum` from these tuples. Adding a value here without
   a migration produces a Zod schema that accepts what Postgres will reject;
   reordering produces a drizzle-kit diff that reorders nothing.
5. **The realtime union is the only description of an event's shape.** New event
   types are added to `realtime.ts`, never described ad hoc at a publish site,
   and every payload is validated at both ends. Consumers must stay
   duplicate-safe and order-tolerant: realtime is latency, Postgres is truth.
6. **`normalizeEmail` runs at ingestion boundaries, exactly once, and the shape
   it produces is what every comparison assumes.** Suppression lookups, contact
   uniqueness and dedupe all compare normalised addresses. Making
   `normalizeEmail` cleverer — stripping dots or `+tags` — would let a
   suppressed address receive mail under an alias. Making it lazier would let
   `Ada@Example.com` and `ada@example.com` become two contacts.
7. **A Zod schema's client and server use are the same schema.** The resolver
   and the Server Action import one object. A schema that exists only on the
   server teaches the user its rules through a round trip and an error banner;
   a schema that exists only on the client is not validation at all. The server
   parse is still the one that matters and never trusts the client's result.
8. **Status transitions stay monotonic, and the SQL is generated from the
   function.** `nextRecipientStatus` and `nextOutboundStatus` are total over
   their enums — the tests assert that for every pair — because
   `packages/jobs/src/delivery-sql.ts` renders one `CASE` arm per enum value. A
   hole in the function is a hole in the `UPDATE`.
9. **A merge tag the UI offers is a merge tag the sender populates.** `MERGE_FIELDS`
   is read by the importer, the palette and the send context. An entry the
   context does not fill renders as an empty string in every recipient's inbox
   and nothing logs it.
10. **`index.ts` is the surface.** Consumers import from `@sendstack/shared`,
    not from a deep path. If a new module needs to avoid `export *` for the
    reason `delivery-status.ts` does, name its exports and write down why.

## Editing the package

**Adding a realtime event type.** Add the variant to the discriminated union in
`src/realtime.ts`, and reference existing vocabularies (`INBOUND_STATUSES`,
`DELIVERY_EVENT_NAMES`) rather than writing a `z.enum([...])` by hand. Publish it
with `publishRealtime` from `packages/redis`; nothing in that package changes,
because it validates through `parseRealtimeEvent`. Then handle it in
`apps/web/src/stores/realtime-store.ts` and `hooks/use-realtime.ts` — an event
no consumer handles is a publish that costs a Redis round trip and does nothing.
Consumers must tolerate a duplicate and a missing event; the authoritative
refresh is the backstop, not the event.

**Adding a database enum value.** Add it to the tuple in `src/enums.ts`,
**appended, never inserted**, then generate and commit the migration in
`packages/db` in the same commit — `ALTER TYPE … ADD VALUE`. The tuple and the
migration are two halves of one change: the tuple alone gives you a schema that
accepts a value Postgres rejects, and the migration alone gives you a value no
schema will pass. Check whether the value needs a ladder entry
(`RECIPIENT_RANK`/`OUTBOUND_RANK` in `delivery-status.ts`, which are exhaustive
`Record`s and will fail typecheck if it does) and whether anything renders the
status to a user in `apps/web`.

**Adding a merge field.** Add the entry to `MERGE_FIELDS` in `src/merge-fields.ts`
with its aliases, and in the same commit:

- add the column to `contacts` in `packages/db/src/schema/audience.ts` plus its
  migration;
- add it to `ClaimedRecipient` and to the `RETURNING` list of the claim query in
  `packages/jobs/src/functions/send-campaign.ts`, and to the `context` object
  that `renderTemplate` substitutes from;
- extend `contactInputSchema` in `src/schemas.ts` if a person should be able to
  edit it;
- add it to `ParsedRecipient` in `merge-fields.ts` so the CSV importer can carry
  it.

Skip the send-job step and the tag appears in the palette, passes
`unresolvableTags`, and renders as an empty string in every recipient's inbox.
Nothing reports that. The palette and `CUSTOM_TEMPLATE_PROMPTS` need no change —
both are built from the list.

**Adding a shared constant.** Put it in `src/constants.ts` with a docstring that
says where the number came from — the provider limit, the platform cap, the
measurement — and then **delete the literals it replaces** in the same commit.
A constant added beside the copies it was meant to retire has made the problem
worse. If it must agree with a third-party setting (as `MIN_PASSWORD_LENGTH`
does with Better Auth's `minPasswordLength`), wire that up now, and consider a
test that asserts the relationship rather than the value.

**Adding a Zod schema.** Compose it from `emailField`, `newPasswordField`,
`nameField`, `templateRefSchema` and the enum tuples rather than restating any of
them. Export the schema *and* its inferred type. Use it in both places — the
`zodResolver` in the component and the parse at the top of the Server Action or
route handler — and put any cross-field rule in a `superRefine` so the form can
show it before a round trip. Prefer `.pick()`/`.extend()` on an existing schema
over a new object with overlapping fields. If the schema has a Zod `.default()`,
remember that input and output types diverge and React Hook Form's single type
parameter cannot express that; `emailConfigSchema.hasStoredKey` is required
rather than defaulted for exactly this reason.

**Do not** add a helper here because it had nowhere else to go. This package is
a contract layer, and its value is that importing it is always safe. Something
used in one place, on one side of the network, belongs beside its caller.

## Testing

No fixtures, no database, no network:

```bash
npx vitest run packages/shared
```

Seven of the ten modules have tests beside them:

| Suite | Covers |
| --- | --- |
| `constants.test.ts` | `formatBytes` output, and the two attachment limits as *relationships* rather than values — a per-file cap inside the platform's 4.5MB request cap, a total inside what mailboxes accept and above the per-file cap. The assertion survives someone changing the number. |
| `email-address.test.ts` | `normalizeEmail` lowercasing and trimming, and explicitly keeping `+tag` and dotted local parts distinct; the `isLikelyValidEmail` accept/reject table; `parseAddress`; `deriveThreadKey`'s three-level fallback; `toSnippet` against conditional comments, `<style>`/`<script>` blocks, entities and truncation. |
| `text.test.ts` | `toTitleCase` against `IBM`, `eBay`, `iPhone`, `McDonald`, apostrophes, hyphens, digits and exact spacing; `capitalizeTypedInput` not fighting a deletion or a same-length replacement; `normalizeName`. |
| `merge-fields.test.ts` | `fieldForHeader` across spellings and separators; `parseRecipients` on headered CSV in any column order, quoted commas, doubled quotes, bare lists, `Name <addr>` lines, reported skips, counted duplicates, and `available` excluding a column that is blank throughout; `unresolvableTags` including the `{{#if}}` case. |
| `schemas.test.ts` | E.164 phone validation; `composeSingleSchema` naming *which* address is wrong and keeping the field a string; `splitAddressList`; `campaignFormSchema` requiring a list and deliberately not asking for a sender; `campaignInputSchema` defaulting the template to `null` rather than `simple`; `templateRefSchema` accepting `custom:<uuid>` and refusing `fancy`; `customTemplateInputSchema` surfacing the validator's first finding on the `html` path. |
| `custom-templates.test.ts` | `validateCustomTemplate` with one rule broken per case — missing body, doubled body, two-brace body, raw non-body slot, missing unsubscribe, unknown placeholder, `<script>` (including self-closing), oversize upload, a stray `{{ first name }}`, and the four block failures a naive open/close count would pass (nested, close-before-open, a block wrapping the body, `{{#if body}}`); that it reports every problem at once; reference parsing and `templateColumns`; and that both prompts name every slot and merge field, and that markup following the prompt literally validates. |
| `delivery-status.test.ts` | Both event maps including the deliberate `delivery_delayed → sent` and `complained → failed` resolutions and the unknown-event fallback; the ladder refusing to let an open or click overwrite a bounce, a late `sent` overwrite a `delivered`, or a reconciler's `queued` drag a `sent` row back; and **totality over both enums** — every `(current, incoming)` pair yields a valid status, which is what `packages/jobs/src/delivery-sql.ts` relies on when it generates one `CASE` arm per value. |

`enums.ts`, `templates.ts`, `realtime.ts` and `index.ts` have no suite of their
own. The first two are data, and their agreement with the database is checked by
`packages/db` typechecking against the same tuples; the realtime union is
exercised through `packages/redis`'s `client.test.ts`, which asserts that an
invalid payload is dropped rather than trusted. If you add behaviour to any of
them, add a suite here.

Adding a guard? **Break it on purpose and watch the test fail.** Several suites
here exist because a hand-written check passed while proving nothing — the
open/close count that accepted four broken template blocks is the clearest
example.

Whole-repo verification is unchanged and runs from the root: `pnpm test`,
`pnpm typecheck`, `pnpm lint`, `pnpm build`. A change to `enums.ts` or
`schemas.ts` needs `pnpm typecheck` across every package, not just this one —
that is how a tuple change reaches `packages/db`.

## Files

| File | Holds |
| --- | --- |
| `src/constants.ts` | Batch size, page sizes, the realtime channel and SSE heartbeat, `MIN_PASSWORD_LENGTH`, `AUTH_SECRET_MIN_LENGTH`, the attachment limits, `formatBytes`. |
| `src/enums.ts` | The six database status vocabularies as `as const` tuples, in migration order, with their union types. |
| `src/email-address.ts` | `normalizeEmail`, `isLikelyValidEmail`, `parseAddress`, `deriveThreadKey`, `toSnippet`. |
| `src/realtime.ts` | `realtimeEventSchema`, `RealtimeEvent`, `RealtimeEventType`, `parseRealtimeEvent`. |
| `src/text.ts` | `toTitleCase`, `capitalizeTypedInput`, `normalizeName`. |
| `src/merge-fields.ts` | `MERGE_FIELDS`, `fieldForHeader`, `parseRecipients`, `unresolvableTags`, and the CSV line splitter behind them. |
| `src/schemas.ts` | Every Zod schema and inferred input type, plus `emailField`, `newPasswordField`, `nameField`, `splitAddressList`. |
| `src/templates.ts` | `TEMPLATE_KINDS`, `TEMPLATE_META`, `isTemplateKind`. |
| `src/custom-templates.ts` | The uploaded-template contract: slots, `validateCustomTemplate`, reference parsing, the size and list limits, the two authoring prompts. |
| `src/delivery-status.ts` | `DELIVERY_EVENT_NAMES`, the two provider-event maps, and the monotonic ladder `nextRecipientStatus`/`nextOutboundStatus`. |
| `src/index.ts` | The public surface: `export *` from every module except `delivery-status`, whose exports are named to avoid an ambiguous re-export with `enums`. |
| `package.json` | One runtime dependency, `zod`. Entry point is `src/index.ts` — no build step. |
| `tsconfig.json` | Extends `tsconfig.base.json`; includes `src/**/*.ts` only. |
