# @sendstack/email

Everything in [Sendstack](../../README.md) that touches Resend, plus the
rendering that turns a message into HTML a mail client will honour. Sending a
batch, verifying a webhook, fetching the body of a received message,
substituting merge fields, wrapping a body in a template, signing an
unsubscribe link, and pushing a notification to a phone.

It is the only package that uses a provider credential, which is what
architecture boundary 5 in [PRODUCT.md](../../PRODUCT.md) requires. Nothing
above it constructs a `Resend`; nothing below it needs to.

**What it is not.** It owns no queue and no schedule. It does not claim
recipients, does not retry, does not decide when a campaign runs and does not
write a delivery status — that is [`@sendstack/jobs`](../jobs/README.md) and
the webhook route. Every function here is a single call that either returns or
throws; the surrounding machinery lives elsewhere on purpose, so that this
package stays testable without a queue and the queue stays testable without a
provider.

It also does not own two things that look like they belong here: the
event → status mapping (`packages/shared/src/delivery-status.ts`) and the
template metadata (`packages/shared/src/templates.ts`). Both are read by code
that must not import this package. See invariant 7.

## What it does, in one picture

```text
outbound
  send job / Server Action
        │  renderCampaignEmail() ──▶ templates/ ──▶ { html, text }
        │  unsubscribeHeaders()  ──▶ List-Unsubscribe pair
        └▶ sendBatch(messages, { idempotencyKey })   ──▶ Resend
                     │                                     │
                     └── tags: recipient_id ───────────────┘

inbound
  Resend ──▶ /api/webhooks/resend
                 │  verifyWebhook(rawBody, headers)     ← raw text, first thing
                 │  webhookEventId(headers)             ← svix-id, the dedupe key
                 │  isDeliveryEvent / isInboundEvent / isHardBounce
                 └──▶ job ──▶ fetchInboundEmail(id)     ← second API call: the body
```

The tag going out and the `svix-id` coming back are what make both directions
survive being run twice. Neither is decoration.

## Where it is used

Every arrow points *into* this package. It reads
[`@sendstack/config`](../config/README.md) for the API key and the brand,
[`@sendstack/db`](../db/README.md) for two narrow things (an uploaded
template's HTML, the push-subscription table) and
[`@sendstack/shared`](../shared/README.md) for contracts. It imports nothing
from `@sendstack/jobs`, `@sendstack/redis` or `apps/web`, and it must stay
that way — a cycle here would put the renderer inside the queue and the queue
inside the renderer.

| Consumer | Takes |
| --- | --- |
| `packages/jobs` — `functions/send-campaign.ts` | `currentBrand`, `customTemplateHtml`, `formatFrom`, `renderCampaignEmail`, `renderTemplate`, `sendBatch`, `unsubscribeHeaders`, `unsubscribeUrl`, and the `Brand` / `OutboundMessage` / `TemplateKind` types. The whole outbound pipeline. |
| `packages/jobs` — `inbound-store.ts` | `fetchInboundEmail`, `broadcastPush`, `resendClient` (for the inbound reconciler's `emails.receiving.list`), `NormalizedInbound`. |
| `packages/jobs` — `outbound-store.ts` | `resendClient`, for the sent-mail reconciler that pulls `emails.list()` when no webhook ever arrived. |
| `packages/auth` — `auth-emails.ts`, `magic-link-email.ts` | `defaultFrom`, `renderAuthEmail`, `sendOne`. Password reset, address verification, magic link. |
| `apps/web` — `actions/compose.ts` | `currentBrand`, `customTemplateHtml`, `defaultFrom`, `formatFrom`, `htmlToText`, `isEmptyHtml`, `renderCampaignEmail`, `sendOne`, `wrapEmailBody`, `RenderCampaignInput`. |
| `apps/web` — `actions/thread.ts` | `defaultFrom`, `htmlToText`, `isEmptyHtml`, `sendOne`, `wrapEmailBody`. The reply path. |
| `apps/web` — `actions/campaigns.ts` | `customTemplateHtml`, `htmlToText`, `isEmptyHtml`, `wrapEmailBody`. |
| `apps/web` — `actions/attachments.ts` | `defaultFrom`. |
| `apps/web` — `actions/push.ts` | `sendPushToUser`, `removePushSubscription`. |
| `apps/web` — `actions/settings.ts`, `actions/setup.ts` | `resetResendClient`, called after a key is saved so the next request does not use the old client. |
| `apps/web` — `api/webhooks/resend/route.ts` | `verifyWebhook`, `webhookEventId`, `isDeliveryEvent`, `isInboundEvent`, `isHardBounce`, `recipientIdFromTags`, `WebhookVerificationError`, `broadcastPush`. |
| `apps/web` — `api/templates/preview/route.ts` | `customTemplateHtml`, `renderTemplatePreview`. |
| `apps/web` — `api/unsubscribe/route.ts`, `app/unsubscribe/page.tsx` | `verifyUnsubscribe`. |

`packages/db` does **not** import this package. A comment in
`src/schema/audience.ts` mentions it; that is prose, not a dependency.

`apps/web/next.config.ts` lists `@sendstack/email` in `transpilePackages`,
because the package ships TypeScript and JSX rather than build output.

## Public surface

Everything a consumer may import comes from `src/index.ts`. Nothing else in
the package is a contract.

| Export | Purpose |
| --- | --- |
| `resendClient()` | The cached `Resend`, built from the stored API key. Throws with a settings-page hint when none is configured. Rebuilds itself when the resolved key changes. |
| `resetResendClient()` | Drop the cached client. Called by the settings and setup actions after a save. |
| `formatFrom(name, email)` | A `From` header. The name is JSON-quoted, so an embedded `"`, `\` or `,` cannot split or terminate the header. |
| `defaultFrom()` | The `Name <address>` for transactional mail, from settings. |
| `sendBatch(messages, { idempotencyKey })` | Up to `SEND_BATCH_SIZE` messages in one API call. Returns `{ sent, failed }`; **throws** on a transport failure. |
| `sendOne(message, { idempotencyKey? })` | One transactional send. Returns `{ id, error }` — it does not throw on a provider rejection. |
| `BatchTransportError` | The whole batch was refused or never reached the provider. `code` carries Resend's error name when there was one. |
| `RECIPIENT_TAG`, `recipientIdFromTags(tags)` | The tag name (`recipient_id`) and the reader that pulls a recipient id back out of a webhook event. |
| `OutboundMessage`, `OutboundAttachment`, `BatchSendResult` | The send types. |
| `verifyWebhook(rawBody, headers)` | Verify a Resend webhook and return its parsed payload. Throws `WebhookVerificationError` on anything wrong. |
| `webhookEventId(headers)` | The `svix-id`, or `null`. The dedupe key. |
| `isDeliveryEvent`, `isInboundEvent` | Type predicates narrowing a `WebhookEventPayload`. |
| `isHardBounce(bounce)` | Whether a bounce is permanent, and so suppresses immediately. |
| `WebhookVerificationError`, `DeliveryEventType`, `WebhookEventPayload` | The error class and the two event types. `WebhookEventPayload` is re-exported from `resend` so callers do not depend on the SDK directly. |
| `fetchInboundEmail(providerEmailId)` | The second call that fetches a received message's body, headers and attachment descriptors. Returns `NormalizedInbound`. |
| `renderTemplate(template, context)` | Merge-field substitution: `{{ field }}` escaped, `{{{ field }}}` raw, `{{#if field}}…{{/if}}` blocks. |
| `htmlToText(html)`, `escapeHtml(value)`, `MergeContext` | The plain-text derivation, the escaper, and the context type. |
| `renderCampaignEmail(input)` | Wrap a body in the chosen design — built-in or uploaded — and return `{ html, text }`. |
| `renderAuthEmail(input)` | The transactional chrome for auth mail. Returns HTML only. |
| `renderTemplatePreview(design, brand?)` | One design rendered with fixed sample copy, for the pickers. Takes a `TemplateKind` or `{ html }`. |
| `renderCustomTemplate(html, props, context?)` | The uploaded-template renderer. Called by `renderCampaignEmail`; exported for tests and for a caller that already holds the HTML. |
| `customTemplateHtml(id)` | An uploaded template's stored HTML, or `null` when the row is gone. |
| `currentBrand()` | The `Brand` block assembled from stored settings, with an absolute logo URL. |
| `TEMPLATE_META`, `TemplateKind` | Re-exported from `@sendstack/shared` so server code has one import. See invariant 7. |
| `Brand`, `RenderCampaignInput` | The render types. |
| `inlineEmailStyles(html)`, `wrapEmailBody(html)`, `isEmptyHtml(html)` | Inline the composer's styles, wrap a fragment in an outer shell, and decide whether a composed document is actually empty. |
| `signUnsubscribe`, `verifyUnsubscribe`, `unsubscribeUrl`, `unsubscribeHeaders` | The signed one-click unsubscribe link and its RFC 8058 headers. |
| `sendPushToUser`, `broadcastPush`, `removePushSubscription` | Web push. `PushPayload` and `PushResult` alongside. Key generation is not here — see [`@sendstack/pwa/vapid`](../pwa/README.md). |

## Sending

`src/send.ts`. Two entry points, and the difference between them is the shape
of the failure, not the number of messages.

**`sendBatch(messages, { idempotencyKey })`** takes at most
`SEND_BATCH_SIZE` — 100, declared once in
`packages/shared/src/constants.ts` because Resend's batch endpoint accepts
that many and an Inngest step is sized to match, so one step is one API call
and a retry replays exactly one batch. More than 100 throws a plain `Error`:
that is a programming mistake, not a runtime condition, and the caller is
expected to have chunked already.

It sends with `batchValidation: "permissive"`. Under the default `"strict"` a
single malformed address rejects the entire batch, so one bad row from a CSV
import would block ninety-nine valid sends and every retry would hit the same
wall. Permissive sends what it can and reports the rest by index — which
creates the one subtlety in the file: the success array contains only the
accepted messages, so its indices no longer line up with the input once
anything fails. The pairing is rebuilt by walking the inputs in order and
skipping the reported failures, which makes a reconstructed
`providerMessageId` best-effort.

**`sendOne(message, { idempotencyKey? })`** is the single transactional send —
a reply, a composed message, a password reset, a test send. It returns
`{ id, error }` rather than throwing on a provider rejection, because its
callers are answering a person who is waiting and need to put the reason on
the screen.

### The idempotency key

Every send that can be reached twice carries one, and the caller supplies it,
because only the caller knows what "the same send" means:

| Caller | Key |
| --- | --- |
| `send-campaign.ts` | `campaign:<campaignId>:<runId>:<batchIndex>` — a replayed Inngest step re-sends the same batch under the same key. |
| `actions/compose.ts` | `compose:<clientKey ?? draftId>`. The browser mints `clientKey`, so it is stable across a replay from the offline outbox where a fresh draft id would not be. |
| `actions/thread.ts` | `outbound:<outboundMessageId>`. |

`sendOne`'s option is optional, and `packages/auth` does not pass one: a
password reset or a verification mail is a one-shot triggered by a person, and
a second one is a second intent rather than a duplicate. Anything that can be
*replayed* — a job, a queued action, a webhook-driven send — must pass a key.

### `RECIPIENT_TAG`

`toResendPayload` attaches `recipient_id: <campaign_recipients.id>` as a tag
on every batched message, and `sendOne` attaches it when the caller supplies a
`recipientId`. Resend echoes tags into every webhook event for a message, so
correlating `email.delivered` back to a recipient row does not depend on the
best-effort message id above. `recipientIdFromTags` is the reader on the
webhook side. Tag values are restricted to ASCII letters, digits, underscores
and dashes; a UUID satisfies that.

### A transport error throws

This is the behaviour to understand before editing the file, and the docstring
in `send.ts` says why at length.

- A **per-item** failure — Resend looked at one message and refused it — is
  final for that recipient and comes back in `failed`.
- A **transport** failure — a 5xx, a 429, a timeout, an auth error — says
  nothing about any individual message, so it is thrown as
  `BatchTransportError`. The send job runs inside a transaction, so the throw
  rolls the recipient claim back and Inngest retries the step with backoff.
  Returning a hundred `failed` entries instead permanently failed a hundred
  recipients over a hiccup a second attempt would have sailed through.

`BatchTransportError` extends `Error` and is deliberately **not** Inngest's
`NonRetriableError` — that class is the one thing that would stop the retry
this design depends on. `send.test.ts` asserts it by name.

## Receiving

`src/webhooks.ts` and `src/inbound.ts`. Both directions of the inbound flow
are described end to end in
[ARCHITECTURE.md § The two flows](../../docs/ARCHITECTURE.md#the-two-flows)
and [§ Webhook handling](../../docs/ARCHITECTURE.md#webhook-handling).

**`verifyWebhook(rawBody, headers)`** is the first thing a webhook route does,
before parsing and before any write. It takes the **raw request text**.
`await request.json()` followed by `JSON.stringify` re-serialises with
different key order and whitespace, and the signature will never match — so
routes call `await request.text()` and pass that string through unchanged.

There is no unverified fallback. When no webhook secret is configured the
function throws rather than trusting the body, because an unauthenticated
webhook endpoint lets anyone forge a bounce and suppress a competitor's
address on your instance. Resend signs with Svix and the SDK wraps the
verification, so no HMAC is hand-rolled here; the function pulls the three
Svix values out of the `Headers` (accepting the `webhook-*` aliases) because
the SDK wants them individually and doing it at each call site would be the
same code three times. Every throw is a `WebhookVerificationError` and should
become a 400.

**`webhookEventId(headers)`** returns the `svix-id`. That header identifies the
*event*, and it is stable across the retry ladder Resend uses — 5s, 5m, 30m,
2h, 5h, 10h — which is exactly what makes it usable as a dedupe key. The route
stores it on `email_events.provider_event_id`, where a unique index is the
real guarantee; the Redis claim in front of it is a pre-filter that fails
open. See [`@sendstack/redis`](../redis/README.md) invariants 3 and 4.

**`isDeliveryEvent`**, **`isInboundEvent`**, **`isHardBounce`.** The first two
are type predicates that narrow a `WebhookEventPayload`. The delivery set is
built from `DELIVERY_EVENT_NAMES` in `@sendstack/shared` with Resend's
`email.` prefix applied, so the list of events the route handles cannot drift
from the status map that consumes them. `isHardBounce` decides whether a
bounce suppresses immediately or counts toward `SOFT_BOUNCE_LIMIT`; it is
loose about casing and wording because the provider's bounce vocabulary is not
a stable contract, and anything not recognisably transient is treated as
permanent. Being wrong that way costs one email; being wrong the other way
costs a sending domain's reputation.

**`fetchInboundEmail(providerEmailId)`.** The `email.received` webhook carries
metadata only — sender, recipients, subject, attachment descriptors — and no
body, no headers, no attachment bytes. Those need a second call to the
Received Emails API, which is why an inbound message is always a two-phase
arrival: the row appears immediately from the webhook, and its content fills
in a moment later. Both the schema (`contentFetchedAt`) and the UI are built
around that gap rather than pretending it does not exist.

The function returns a `NormalizedInbound`, and normalisation is the point of
it: addresses go through `parseAddress` from `@sendstack/shared`, `Message-ID`
is read from the payload or fallen back to a case-insensitive header lookup
(providers do not agree on header casing), `References` is split on
whitespace, the thread key comes from `deriveThreadKey`, and the snippet from
`toSnippet`. The `html` and `text` it returns are **data**, never trusted app
content — see invariant 4.

## Rendering

Three layers, and they are separate on purpose.

### `src/render.ts` — merge fields

`renderTemplate(template, context)` runs three passes in a fixed order:
`{{#if path}}…{{/if}}` blocks first, then `{{{ raw }}}`, then `{{ escaped }}`.
The ordering is load-bearing — sections first so the tokens inside a dropped
block never render, and triple-brace before double-brace so neither pass can
eat the other's delimiters. `render.test.ts` pins both.

Values are HTML-escaped by default. Contact data arrives from CSV uploads and
public sign-up forms, so a first name of `<script>…` or, far more likely, an
innocent `Ben & Jerry's` must not be able to break the markup of an email
going to ten thousand people. `{{{ raw }}}` opts out for the rare field that
genuinely holds markup. A missing field renders as empty rather than as the
literal token. Dotted paths resolve into nested objects, which is how
`{{ attributes.plan }}` works.

The `{{#if}}` block does not nest and has no `else`, deliberately. It exists
for one job: an uploaded template has to hide its unsubscribe footer on
one-to-one mail and its logo when none is uploaded, and the built-in designs
do that with a JSX conditional. A full block language would be a second
template engine to keep correct.

`htmlToText(html)` derives the plain-text alternative. Crude — it strips
`<style>` and `<script>` contents, turns block closers into blank lines and
list and row closers into single newlines, decodes the five common entities.
It is not optional: a message with no plain-text part scores as more spam-like
with essentially every filter, and a text part that arrives as one
undifferentiated wall is exactly the part filters read most closely.

### `src/inline-styles.ts` — surviving a mail client

`inlineEmailStyles(html)` rewrites the small, known set of tags the composer
can produce, giving each an inline `style` attribute. Inline styles are the
only thing every client agrees on: Gmail strips `<style>` in several contexts,
Outlook renders through Word and ignores most of it, and no client supports
custom properties. The defaults matter more than they look — clients apply
their own margins to `h2`, `ul` and `p` and disagree with each other, so each
tag states its own spacing. Lists get left *padding* rather than margin
because Outlook drops list margins and the bullets end up flush against the
text. An existing `style` attribute always wins.

This is not a general HTML transformer and must not become one. Pointing it at
arbitrary markup would make it a sanitiser, which is a different and much
harder job.

`wrapEmailBody(html)` inlines and then wraps in the outer shell a message
needs: a pinned font family, because a bare fragment arrives in Times New
Roman in Outlook, and a 640px maximum width, so a reply does not stretch
across a desktop client.

`isEmptyHtml(html)` answers whether a composed document actually contains
anything. The editor emits `<p></p>` for an empty document, so a length check
would call a blank composer ready to send.

### `src/templates/` — the chrome

Four built-in designs in `designs.tsx`, built with React Email and rendered
server-side: **Simple** (centred card, logo, one button — the safe default),
**Announcement** (full-width brand-coloured hero with the headline reversed
out), **Newsletter** (masthead and hairline rules) and **Plain** (no card, no
logo, no colour, deliberately the plainest possible markup, because heavy
templates correlate with worse inbox placement). `AuthTemplate` is the fifth
component and is not a campaign design — it is the transactional chrome for
magic links and password resets, and it shows the link both as a button and as
raw text because some clients strip buttons.

All of them share a `Shell` that sets `<Preview>`. Left unset, clients scrape
the first words of the body for the line beside the subject — usually "View
this email in your browser" or a stray merge field — and it is the second
most-read line in any campaign.

`parts.tsx` holds the three shared blocks: `Logo` (height fixed, width auto,
`alt` falling back to the app name for the large minority with images
blocked), `Footer` (the visible unsubscribe link and the postal address below
it) and `BodyHtml` (the campaign body, injected with
`dangerouslySetInnerHTML`). `theme.ts` holds the `Brand` type and the style
tokens, all as inline style objects with px sizes — `rem` has no reliable root
to resolve against inside a mail client — plus `readableOn`, which picks black
or white text over an arbitrary brand colour by sRGB luma, because someone will
choose pale yellow and white on pale yellow is unreadable.

`templates/index.tsx` is the entry point. `renderCampaignEmail(input)` picks a
component by kind and returns `{ html, text }`, deferring to
`renderCustomTemplate` when `customTemplateHtml` is present. It only consults
settings for what the caller did not supply: the send job resolves the brand
once per run and passes it for every message, so this path never forces a
settings read per recipient — and the renderer stays usable, and testable,
with no database at all. `currentBrand()` is where the settings read happens
when nobody supplied one, and it always produces an **absolute** logo URL,
because a mail client has no page to resolve a relative path against.

### The split of responsibility

**Templates supply the chrome; the campaign supplies the content.** Merge
fields are substituted into the body *first*, and the body is wrapped
afterwards. Doing it the other way round would let a contact's name
interpolate into the template's own markup. `send-campaign.ts` is written that
way and the comment there says so.

For an uploaded template `custom.ts` splices the body in with a **string
split** on the `{{{ body }}}` token rather than through the placeholder
engine, and that ordering is the whole point of the function: the body has
already had its merge fields resolved, so a literal `{{ something }}` left in
it — a code sample, a tag the sender chose to keep — must arrive as written
rather than being resolved a second time against the template's context.
Every other slot is text, is escaped by the `{{ }}` pass, and goes through the
same `renderTemplate` the body did, so there is one engine and one escaping
rule. Recipient fields are passed in as `context` so an uploaded template can
personalise its own heading; on one-to-one mail they are simply absent and the
`{{#if}}` blocks take over.

The placeholder contract — which slots exist, which are required, what the
validator refuses — is defined once in
`packages/shared/src/custom-templates.ts` and documented in
[CUSTOM-TEMPLATES.md](../../docs/CUSTOM-TEMPLATES.md). Do not restate the
table anywhere; the validator, this renderer and the copy-to-clipboard prompts
all read that one list.

Further reading:
[ARCHITECTURE.md § Email templates](../../docs/ARCHITECTURE.md#email-templates).

## Unsubscribe

`src/unsubscribe.ts`. The link carries the address and an HMAC of it rather
than a database row, so unsubscribing costs no storage and still works for a
contact deleted in the meantime. It is signed because an unauthenticated
`?email=` parameter lets anyone unsubscribe anyone; `unsubscribe.test.ts`
covers exactly that case.

`AUTH_SECRET` is the signing key, read from the environment and required to be
at least `AUTH_SECRET_MIN_LENGTH` characters. Note the omission: **there is no
expiry.** An unsubscribe link found in a two-year-old email has to work, both
because it is the right thing to do and because RFC 8058 and every major
mailbox provider expect it. The consequence is that rotating `AUTH_SECRET`
invalidates every outstanding link ever sent — treat it as a key that must
keep working for years, not as a session secret.

The address is put through `normalizeEmail` on both signing and verification,
because the address in a mail client's one-click request may differ in case
from the one that was signed. `verifyUnsubscribe` compares with
`timingSafeEqual` after a length check, since that function throws on a length
mismatch rather than returning false.

`unsubscribeHeaders(email, appUrl?)` returns the RFC 8058 pair —
`List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
Without them Gmail and Yahoo show a "report spam" button where they would
otherwise show "unsubscribe", and a spam complaint costs a sender far more
than an unsubscribe does. Both bulk-sender programmes require them. Every
campaign message gets these headers *and* the visible footer link; the two
together are what keep recipients off the spam button.

## Push

`src/push.ts`, marked `server-only`. It lives beside the email code rather
than in its own package because it is the same job in a different channel:
something landed in the inbox and somebody should know. The realtime SSE
stream covers an open tab; push covers a phone in a pocket.

`sendPushToUser(userId, payload)` notifies every device one person
registered. `broadcastPush(payload)` notifies everyone with a subscription,
because inbound mail is addressed to the instance rather than to a person —
there is one shared mailbox. Both return early with zeroes when push is not
configured, so no caller needs to check first.

Both funnel into one `deliver`, and its shape is deliberate. Sends are issued
together rather than in sequence, because a laptop and a phone are two
independent HTTP requests to two different push services. The bookkeeping
afterwards is exactly two statements whatever the size of the set — one
`DELETE` for the endpoints the push service reported as gone (`404` or `410`,
a permanent condition, so the row goes rather than being retried forever) and
one `UPDATE` of `lastUsedAt` for the live ones. `broadcastPush` used to route
every user through the per-user path, which made it three statements per
subscriber; on an instance with forty subscribers that was a hundred and
twenty round trips to say "new mail".

The pair itself is generated elsewhere. **A browser binds its subscription to
the public key it was created with**, so replacing the pair does not fail
loudly — it silently stops delivering to every existing subscription, and
nothing reports it. Keys are generated once, stored encrypted, and left alone.

This package used to export a `generateVapidKeys` of its own that nothing
imported, which is how two implementations of one rule start drifting. It is
gone. `apps/web/src/actions/push.ts` and the `pnpm push:keys` CLI both use
`generateVapidKeys` from [`@sendstack/pwa/vapid`](../pwa/README.md), which
also validates the shape of a pair and the subject. See
[PWA.md](../../docs/PWA.md) for the key formats, the subject rules and the
subscription lifecycle.

## Invariants — what an edit must preserve

These are the rules the rest of the app is written against. Breaking one
rarely fails a test loudly; it produces a bug that reports nothing, or an
email that went to ten thousand people looking wrong.

1. **Every replayable send carries an idempotency key, supplied by the
   caller.** `sendBatch` requires one. `sendOne`'s is optional only because a
   person-triggered one-shot has no replay to protect against; any job, queued
   action or webhook-driven send must pass one, and it must be derived from
   something stable across the replay (see the table above — `clientKey`, not
   a freshly minted row id).
2. **A transport error throws; only a per-item rejection is reported as a
   failure.** Never convert a 5xx, a 429 or a timeout into `failed` entries,
   and never throw a `NonRetriableError` from this package. The caller's
   transaction rollback and the queue's retry are the correct response, and
   both depend on an ordinary `Error` escaping.
3. **Addresses are normalised at every boundary, through
   `@sendstack/shared`.** `parseAddress` on the way in (`inbound.ts`),
   `normalizeEmail` on both sides of an unsubscribe token. Never compare or
   store an address that has not been through them, and never add a second
   normaliser here.
4. **Inbound HTML is never rendered as trusted app content.** This package
   fetches and returns it as data. It is displayed by
   `apps/web/src/components/mail/html-message.tsx` in a sandboxed iframe with
   no `allow-scripts` and a restrictive CSP. `BodyHtml` in `parts.tsx` uses
   `dangerouslySetInnerHTML` and that is safe *only* because its input is
   campaign content authored inside Sendstack by an authenticated operator,
   with merge fields already escaped. Do not route inbound HTML through it,
   and do not add a second `dangerouslySetInnerHTML`.
5. **Webhook verification happens against the raw body, before anything
   else.** `await request.text()`, then `verifyWebhook`, then parse. No
   unverified fallback when the secret is missing, and no processing of a body
   that failed verification.
6. **Every template produces both an HTML and a plain-text part.**
   `renderCampaignEmail` and `renderCustomTemplate` both return `{ html, text
   }`, and the text is derived from the *full wrapped document* rather than
   the body alone — so it carries the unsubscribe link and the postal address,
   which the text part of bulk mail legally has to carry. A new design that
   returns HTML only is not finished.
7. **Template metadata lives in `@sendstack/shared`, not here.**
   `TEMPLATE_KINDS`, `TEMPLATE_META` and the custom-template contract are in
   `packages/shared` because a client component needs them to offer a choice,
   and importing this package into the browser would pull the renderer — and
   through it Postgres and Cloudinary — into the client bundle. The docstring
   at the top of `packages/shared/src/templates.ts` says exactly this. The
   re-export from `templates/index.tsx` is a convenience for *server* code
   only; it is not permission to define anything new here.
8. **The event → status mapping is not this package's business.**
   `packages/shared/src/delivery-status.ts` owns it. `webhooks.ts` builds its
   delivery-event set from `DELIVERY_EVENT_NAMES` so the two cannot drift, and
   decides nothing about what a bounce means to a row.
9. **A batch is at most `SEND_BATCH_SIZE`, and the constant lives in
   `@sendstack/shared`.** The number has to agree with the queue's step size
   and Resend's endpoint limit. Do not re-declare 100 anywhere.
10. **`RECIPIENT_TAG` is the correlation key, not the message id.** The id
    returned by a permissive batch is best-effort by construction. Anything
    that ties a later provider event back to a row goes through the tag.
11. **Suppression is not checked here.** It is checked on every send path by
    the caller — `assertNotSuppressed` in the composer, `suppressLateArrivals`
    inside the send transaction. Adding a send path means adding the check
    there; do not add a half-check here that a caller might then trust.
12. **No provider credential leaves this package.** `resendClient()` is the
    only constructor, and it is only ever awaited on a server path. Callers
    that need a client for something this package does not wrap (the two
    reconcilers) take `resendClient` rather than the key.

## Editing the package

**Adding a template design.** Three places, in one change. Add the kind to
`TEMPLATE_KINDS` and its copy to `TEMPLATE_META` in
`packages/shared/src/templates.ts`; add the component to
`templates/designs.tsx` and register it in the `COMPONENTS` map in
`templates/index.tsx`; and write a migration extending the
`email_template_kind` enum in `packages/db`, because a campaign stores its
choice in that column. Reuse `Shell`, `Logo` and `Footer` from `parts.tsx` —
a design that renders its own footer is a design whose unsubscribe link will
eventually go missing. The `describe.each` in `templates/render.test.ts` picks
up a new kind as soon as you add it to its `KINDS` list, which is the cheapest
way to find out that the postal address or the preheader was forgotten.

**Changing the send batching.** `SEND_BATCH_SIZE` in
`packages/shared/src/constants.ts` and nowhere else. It has to stay at or
below Resend's per-call limit, and the Inngest step in
`packages/jobs/src/functions/send-campaign.ts` is sized against it so that one
step is one API call — raising it raises how much work a single retry replays.
`MAX_BATCHES_PER_RUN` in that file bounds the run; the two multiply.

**Adding a webhook event type.** Add the name to `DELIVERY_EVENT_NAMES` in
`packages/shared/src/delivery-status.ts` and give it entries in the recipient
and outbound status maps beside it. `isDeliveryEvent` and `DeliveryEventType`
here pick it up with no edit. Nothing in this package decides what an event
means to a row — if you find yourself writing a `switch` on `event.type` in
`webhooks.ts`, the logic belongs in shared. A genuinely new *category* of
event (something that is neither a delivery state nor `email.received`) gets a
new predicate here and a handler in the route.

**Changing rendered markup.** Assume nothing about CSS support. Inline styles
only, px sizes, tables and `@react-email/components` rather than flexbox or
grid, and no custom properties. The unit tests assert the rendered string,
which catches a missing link or a dropped brand colour but says nothing about
what a client does with it — so anything visual gets checked in a real inbox:
render it through the preview route
(`/api/templates/preview?template=<kind>`), send yourself a test, and open it
in Gmail web, the Gmail app, Outlook on Windows and Apple Mail. Outlook and
the Gmail app are where it breaks.

**Adding a dependency.** `@sendstack/config`, `@sendstack/db` and
`@sendstack/shared` are the only workspace packages this one may import. Do
not import `@sendstack/jobs` or `@sendstack/redis`; publishing a realtime
event or enqueuing work is the caller's job, and either import would create a
cycle. Keep the `@sendstack/db` use as narrow as it is — one column of
`templates`, and the `push_subscriptions` table.

## Testing

Unit tests need no Resend, no database and no network:

```bash
npx vitest run packages/email
```

| File | Covers |
| --- | --- |
| `src/send.test.ts` | `sendBatch` against a stubbed client: a refused batch throws `BatchTransportError` with the provider's code and is not a `NonRetriableError`; a missing body throws; a per-item rejection is reported as `failed` while the surviving messages stay correctly paired with their ids; the idempotency key and `batchValidation: "permissive"` reach the SDK; an empty batch never calls the provider. |
| `src/webhooks.test.ts` | `isHardBounce` only — permanent, transient, full mailbox, casing, and the fail-safe on an unrecognised or missing bounce. `verifyWebhook` has no unit test; it is exercised through the webhook route's tests in `apps/web`. |
| `src/render.test.ts` | `renderTemplate` escaping (script tags and `Ben & Jerry's`), the triple-brace opt-out, dotted paths, missing fields, the pass-ordering, and the `{{#if}}` blocks including that a dropped block's inner tokens never render. Plus `htmlToText` block spacing and `escapeHtml`. |
| `src/inline-styles.test.ts` | Every tag the editor can produce gets a style; existing attributes and a deliberate `style` survive; lists get padding not margin; `wrapEmailBody` pins a font and caps the width; the `isEmptyHtml` cases including `<p></p>` and `<p>&nbsp;</p>`. |
| `src/unsubscribe.test.ts` | A token verifies, survives a case difference in the address, and fails for a forgery, an empty string or a different address. The RFC 8058 header pair and the link's contents. |
| `src/templates/render.test.ts` | All four designs, through `describe.each`: a complete document containing the body, the unsubscribe link, a non-trivial text part, the preheader, inline styles, the postal address present and absent. Then the branded three for the absolute cache-busted logo URL and the brand colour, `plain` for the absence of a logo, and `renderAuthEmail` for showing the link twice. |
| `src/templates/custom.test.ts` | `renderCustomTemplate`: the body inserted as markup exactly once and *not* re-run through the placeholder engine; every text slot escaped; brand slots filled; the unsubscribe link escaped for an attribute and dropped entirely on one-to-one mail; logo and address blocks dropped; chrome personalised from the recipient context; a text part emitted. Plus `renderCampaignEmail` preferring uploaded HTML over a built-in kind and falling back when it is `null`. |
| `src/templates/theme.test.ts` | `readableOn` on dark, pale, shorthand and unparseable colours. |

`push.ts`, `client.ts` and `inbound.ts` have no automated tests. They are the
three files that are mostly provider surface, and they are checked by hand
against a real Resend account and a real browser subscription.

**The render tests assert the rendered output, not what a mail client does
with it.** They will happily pass on markup Outlook mangles. They are a
regression net for "the footer disappeared" and "the brand colour stopped
being applied"; they are not evidence that a design works. That evidence comes
from a test send, as described above.

## Files

| File | Holds |
| --- | --- |
| `src/client.ts` | `resendClient` (cached per resolved API key), `resetResendClient`, `formatFrom`, `defaultFrom`. The only place a provider credential is read. |
| `src/send.ts` | `sendBatch`, `sendOne`, `BatchTransportError`, `RECIPIENT_TAG`, `recipientIdFromTags`, and the outbound message types. |
| `src/webhooks.ts` | `verifyWebhook`, `webhookEventId`, `isDeliveryEvent`, `isInboundEvent`, `isHardBounce`, `WebhookVerificationError`, `DeliveryEventType`. |
| `src/inbound.ts` | `fetchInboundEmail` and the `NormalizedInbound` shape, plus the case-insensitive header lookup and `References` parsing it needs. |
| `src/render.ts` | `renderTemplate`, `htmlToText`, `escapeHtml`, `MergeContext`. The one placeholder engine. |
| `src/inline-styles.ts` | `inlineEmailStyles`, `wrapEmailBody`, `isEmptyHtml`, and the per-tag style table. |
| `src/unsubscribe.ts` | `signUnsubscribe`, `verifyUnsubscribe`, `unsubscribeUrl`, `unsubscribeHeaders`. |
| `src/push.ts` | `sendPushToUser`, `broadcastPush`, `removePushSubscription`, and the shared `deliver` that prunes dead endpoints in two statements. |
| `src/index.ts` | The public surface. |
| `src/templates/index.tsx` | `renderCampaignEmail`, `renderAuthEmail`, `renderTemplatePreview`, `currentBrand`, `customTemplateHtml`, the `COMPONENTS` map, and the `TEMPLATE_META` re-export. |
| `src/templates/designs.tsx` | `Shell` and the five components: `SimpleTemplate`, `AnnouncementTemplate`, `NewsletterTemplate`, `PlainTemplate`, `AuthTemplate`. `TemplateProps`. |
| `src/templates/parts.tsx` | `Logo`, `Footer`, `BodyHtml` — the blocks every design shares. |
| `src/templates/theme.ts` | The `Brand` type, the colour and typography tokens, the `button` factory, `readableOn`. |
| `src/templates/custom.ts` | `renderCustomTemplate` — the uploaded-template renderer and the body-splice ordering. |
