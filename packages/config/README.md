# @sendstack/config

Runtime configuration for [Sendstack](../../README.md): the settings, the
encrypted credentials, the branding bytes and the two derived reports
(deliverability, setup state) that every other package reads before it can do
anything. Its purpose is that installing Sendstack does not mean editing a file
on a server — the setup wizard collects everything, the Settings page changes
it afterwards, and both write to Postgres rather than to `.env`.

Two values are the exception, and it is a necessity rather than a preference:
settings stored in Postgres cannot contain the credentials needed to reach
Postgres, and secrets encrypted at rest cannot contain their own key. So
`DATABASE_URL` and `AUTH_SECRET` stay in the environment. Everything else lives
in the database.

## Contents

- [Where it is used](#where-it-is-used)
- [Public API](#public-api)
- [The three stores](#the-three-stores)
- [Precedence and provenance](#precedence-and-provenance)
- [Caching](#caching)
- [Secrets](#secrets)
- [Setup state and the wizard](#setup-state-and-the-wizard)
- [Deliverability](#deliverability)
- [Branding and Cloudinary](#branding-and-cloudinary)
- [Invariants — what an edit must preserve](#invariants--what-an-edit-must-preserve)
- [Editing the package](#editing-the-package)
- [Testing](#testing)
- [Files](#files)

## Where it is used

| Consumer | What it takes |
| --- | --- |
| `apps/web` — setup wizard (`src/actions/setup.ts`) | `requireSetupInProgress()` as the first line of every action, then `updateSettings`, `setSecret`, `applyCloudinarySettings`, `cloudinaryFromForm`, `pingCloudinary`, `putBrandingAsset`, `deleteBrandingAsset`, `assertAuthMethodsUsable`, `getConfig({ fresh: true })`. |
| `apps/web` — Settings page (`src/app/(app)/settings/page.tsx`) | `getConfig({ fresh: true })`, `brandingRefs()`, `deliverabilityReport()`, `isSecureOrigin()`. Passes booleans and provenance labels to the client sections, never a credential — see [Secrets](#secrets). |
| `apps/web` — settings actions (`src/actions/settings.ts`) | `updateSettings`, `setSecret`, `clearSecret`, `assertAuthMethodsUsable`, `applyCloudinarySettings`, `SecretKey`. |
| `apps/web` — `src/lib/config-cache.ts` | Wraps `getConfig`, `getSetupState` and `brandingRefs` in React `cache()`, so one render tree reads each of them once regardless of how many components ask. That is per-request deduplication on top of this package's own process cache, not a replacement for it. |
| `apps/web` — routes and metadata | `manifest.ts`, `robots.ts`, `sitemap.ts` (`appName`, `appUrl`), `api/branding/logo` and `api/branding/favicon` (`getBrandingAsset`), `api/avatars/[userId]` (`getUserAvatar`), `api/setup/stream` (`getSetupState({ fresh: true })`), the `(auth)` pages (`auth.*` toggles), `actions/profile.ts` (`putUserAvatar`), `actions/push.ts`, `actions/campaigns.ts` and `actions/compose.ts` (`assertCampaignDeliverability`). |
| `packages/auth` (`src/server.ts`) | `appUrl` as the Better Auth base URL, `appName` for email copy and the passkey relying-party name, `auth.emailPassword` / `auth.passkey` / `auth.magicLink` / `auth.allowSignup` to decide which plugins are constructed at all, and `resend.fromEmail`. `AUTH_SECRET` it reads straight from `process.env` — this package never hands it out. |
| `packages/email` | `client.ts`: `resend.apiKey`, `resend.fromEmail`, `resend.fromName`, `resend.domain`. `templates/index.tsx`: `appName`, `appUrl`, `primaryColor`, `postalAddress`, `emailTemplate`, plus `brandingRefs()` and `absoluteBrandingUrl()` for the logo. `webhooks.ts`: `resend.webhookSecret`. `push.ts`: the resolved `push` credentials. |
| `packages/jobs` | `client.ts` calls `applyInngestConfig()`, which reads `inngest.eventKey` and `inngest.signingKey` and pushes them into the Inngest client with `setEnvVars` just before use — the client is constructed at module load and the keys cannot be read synchronously. `functions/queue-campaign.ts` calls `deliverabilityReport()`. |
| `packages/redis` (`src/client.ts`) | `redis.url` and `redis.token`, and nothing else. |

That last row is the reason this package's cache is process-local and stays
that way. Cross-instance invalidation would want a pub/sub channel; the Redis
credentials for that channel are themselves configuration read from here, so
the dependency is circular. `docs/ARCHITECTURE.md` states the trade in the
[Caching](../../docs/ARCHITECTURE.md#caching) section: a few seconds of skew.

## Public API

Everything a consumer may import comes from `src/index.ts`. Nothing else in the
package is a contract — `push-config.ts` and `CLEARED_SECRET` in particular are
internal, reachable only through `AppConfig["push"]` and through the resolver's
behaviour respectively.

| Export | Purpose |
| --- | --- |
| `getConfig(options?)` | The whole resolved `AppConfig`. Cached per process for 10 seconds; `{ fresh: true }` bypasses the cache. |
| `updateSettings(patch)` | Atomic upsert of the singleton `app_settings` row, then invalidate both caches. The only writer of `setupStep` and `setupCompletedAt`. |
| `setSecret(key, plaintext)` | Encrypt and upsert one `app_secrets` row. A blank value is delegated to `clearSecret`. |
| `clearSecret(key)` | Write a tombstone, not a delete. See [Precedence and provenance](#precedence-and-provenance). |
| `invalidateConfig()` | Drop the process cache. Already called by every writer here; needed at a call site only when something outside this package changes a stored value. |
| `assertAuthMethods(methods)` | Throws unless at least one sign-in method stays enabled. There is no recovery from an instance whose every login route is off, short of editing the database. |
| `assertAuthMethodsUsable(methods, config)` | The same, plus the subtler failure: a magic link with no Resend key is a login nobody can finish, and a passkey on a plain-`http://` origin is a registration the browser rejects with an opaque `SecurityError`. |
| `isSecureOrigin(url)` | Whether the app URL counts as a secure context for WebAuthn — `https:`, or `localhost`/`127.0.0.1`. |
| `getSetupState(options?)` | The installation's stage as a discriminated union. Never throws. `complete` is cached for 30 seconds; nothing else is cached at all. |
| `invalidateSetupState()` | Forget the cached `complete`. |
| `requireSetupInProgress()` | Throws when setup is complete, and returns `hasAdmin` so the caller can additionally demand a session. Always reads fresh. |
| `deliverabilityReport()` | The seven configuration checks behind Settings → Deliverability, with `blocking`, `warnings` and `canSendCampaigns`. |
| `assertCampaignDeliverability()` | Throws, naming the offending settings, unless nothing blocking is outstanding. |
| `putBrandingAsset(kind, file)`, `getBrandingAsset(kind)`, `deleteBrandingAsset(kind)` | The site logo and favicon. `kind` is `"logo"` or `"favicon"`. |
| `putImageAsset(kind, file, limits)`, `getImageAsset(kind)`, `deleteImageAsset(kind)` | The same store addressed by an arbitrary key, with the caller's own format and size limits. |
| `brandingRefs()` | Logo and favicon in one query, each as a `{ href, storage }` ref or `null`. |
| `absoluteBrandingUrl(appUrl, ref)` | The logo URL an email must use. A Cloudinary href passes through; a database-backed one is joined to the app URL. |
| `putUserAvatar(userId, file)`, `getUserAvatar(userId)`, `deleteUserAvatar(userId)`, `avatarKind(userId)` | Per-user profile pictures on the same store, namespaced `avatar:<id>`. |
| `MAX_ASSET_BYTES`, `ALLOWED_LOGO_TYPES`, `ALLOWED_FAVICON_TYPES`, `MAX_AVATAR_BYTES`, `ALLOWED_AVATAR_TYPES` | 512KB for site assets, 1MB for an avatar. Avatars allow no SVG — a logo is uploaded by whoever administers the instance, an avatar by any account holder, and an SVG served from our own origin is a script that runs as us. |
| `applyCloudinarySettings(submitted)`, `reconcileCloudinary(submitted, stored)`, `cloudinaryFromForm(formData)` | One implementation of the Cloudinary form, shared by the wizard and Settings. `reconcileCloudinary` is pure and synchronous so every branch is testable. |
| `pingCloudinary(creds)`, `uploadBrandingImage(kind, file)`, `deleteCloudinaryImage(publicId)` | The Cloudinary calls. `pingCloudinary` is for a Test button; the other two are used through `branding.ts` and are rarely called directly. |
| `encryptSecret(plaintext)`, `decryptSecret(envelope)`, `SecretDecryptionError` | The envelope format. Exported for tests and for scripts, not because a caller should be storing its own ciphertext. |
| `SECRET_KEYS`, `SETTING_ENV_SEEDS` | The two catalogues — which secrets exist, and which environment variable seeds each value. Exported so a UI or a script can label a field with its variable name instead of repeating it; nothing outside this package consumes them yet, and `SecretKey` is the export the settings actions actually use. |
| `AppConfig`, `SettingsPatch`, `SetupState`, `DeliverabilityCheck`, `DeliverabilityReport`, `CheckSeverity`, `BrandingKind`, `StoredAsset`, `BrandingRef`, `PutResult`, `CloudinarySubmission`, `CloudinaryStored`, `CloudinaryDecision`, `CloudinaryUpload`, `SecretKey`, `SeededSetting`, `Provenance` | The types. |

Every module that touches the database or a provider — `config.ts`,
`setup-state.ts`, `deliverability.ts`, `branding.ts`, `avatar.ts`,
`cloudinary.ts`, `cloudinary-settings.ts` — imports `server-only`. A client
component that reaches for one fails at build time, which is the point. The
three that do not (`keys.ts`, `crypto.ts`, `push-config.ts`) are pure and hold
no credential, but nothing in a client component has a reason to import them
either.

## The three stores

Three tables in `packages/db/src/schema/settings.ts`, because the three kinds of
value have genuinely different requirements.

| Table | Holds | Why it is its own table |
| --- | --- | --- |
| `app_settings` | Plain configuration: `appName`, `appUrl`, `primaryColor`, `postalAddress`, `emailTemplate`, the Resend domain/sender/rate, `redisRestUrl`, the Cloudinary cloud name and folder, the public VAPID key and subject, the four auth toggles, `setupStep`, `setupCompletedAt`. | Readable and queryable. A domain name is not a secret, and encrypting it would only make it hard to debug. One row, primary key `'singleton'`, so `INSERT … ON CONFLICT (id) DO UPDATE` is an atomic upsert that cannot race a second row into existence. |
| `app_secrets` | One row per credential: `key` → `ciphertext`. | Encrypted at rest, and separate so a careless `SELECT * FROM app_settings` in a support session cannot spill an API key. One row per key also means **adding a secret never needs a migration**. |
| `branding_assets` | Logo, favicon and avatar bytes, or a Cloudinary URL and public id. | Bytes. Kept out of the settings row so that reading configuration on every request does not drag a 200KB logo along with it. |

## Precedence and provenance

**The database wins.** A value resolves from the database if present, otherwise
from an environment variable, otherwise unset. The environment is a *first-run
seed*, not an override — see
[Precedence: database first](../../docs/ARCHITECTURE.md#precedence-database-first)
and the header comment in [`.env.example`](../../.env.example).

The cost is real and stated rather than hidden: an operator who exports a new
`RESEND_API_KEY` on their host *after* setup will find it ignored. So `resolve()`
records where each value came from, and the Settings page labels every field
with it:

| `Provenance` | Meaning | Rendered as |
| --- | --- | --- |
| `database` | Saved through the UI. Any environment variable behind it is ignored. | "saved here" |
| `environment` | Nothing stored; an environment variable seeded it. | "seeded from environment" |
| `cleared` | Deliberately emptied in the UI. | "cleared here" |
| `unset` | Never configured, and no environment variable set either. | empty |

`cleared` and `unset` both render an empty field, and separating them is the
whole trick. **Clearing writes an empty value, not a null, and the resolver
stops there without consulting the environment.** In `resolve()` the order is
exact: `""` returns `null` with provenance `cleared` *before* the environment
loop is ever reached; `null`/`undefined` means "never set" and falls through to
the candidate variables; anything else is the stored value.

Without that distinction "off" was indistinguishable from "never configured",
and an instance with `REDIS_URL` still exported on the host silently turned the
feature back on the next request — so every clear path in the app was a no-op
on precisely the machines that had seeded the value. `clearSecret` follows the
same rule with `CLEARED_SECRET`: a tombstone row, never a `DELETE`, because a
missing row is "never set". `getConfig` maps that marker to `""` before
`resolve()` sees it, and checks for it before any decryption is attempted, so
it never surfaces as a decryption error. `applyCloudinarySettings`'s clear
branch writes `cloudinaryCloudName: ""` for the same reason.

`SettingsPatch` is where this reaches a caller: for every seeded nullable field,
`null` and `""` are different instructions. `null` returns the field to "never
set" and lets the environment seed it again; `""` clears it and keeps the
environment out.

Seeds are catalogued in `keys.ts` — `SECRET_KEYS` maps each secret to one
variable, `SETTING_ENV_SEEDS` maps each seeded setting to one variable or an
ordered list. `redisRestUrl` lists two: `REDIS_URL`, which every managed Redis
host sets automatically, then `UPSTASH_REDIS_REST_URL`, which is what Upstash's
own documentation tells you to set. Supporting one would strand half the users.

## Caching

`getConfig()` caches the resolved `AppConfig` in module scope for **10 seconds**
(`TTL_MS` in `config.ts`). Configuration is read on essentially every request
and each secret costs an AES pass over a scrypt-derived key, so the read is
worth making cheap; the TTL bounds how stale it can be.

`getConfig({ fresh: true })` skips the cache. Use it when a decision depends on
a value that may have been written moments ago in the same flow:

- the Settings page and the wizard page, which would otherwise render the
  previous values straight after a save;
- `assertAuthMethodsUsable` in the settings and setup actions, which validates
  a submitted combination against just-saved state;
- `applyCloudinarySettings`, which has to know whether a stored key exists
  before deciding that a blank field means "keep it".

Every writer here (`updateSettings`, `setSecret`, `clearSecret`) calls
`invalidateConfig()` itself, so the instance that handled the write is correct
immediately. **On a multi-instance deployment every other instance is up to 10
seconds behind.** That is the honest consequence and it is deliberate; see the
circularity note in [Where it is used](#where-it-is-used).

`getSetupState()` caches separately and only ever caches `complete`, for 30
seconds. Every other stage belongs to an installation that is mid-setup, where
the whole point is that the screen reflects what the operator just did — a
cached `incomplete` would leave the wizard showing a step already finished.

Everything downstream is lazy for a related reason: the wizard exists to collect
`DATABASE_URL` and transitively imports the database module, so an eager client
would crash the one page capable of fixing the problem. See
[Everything is lazy](../../docs/ARCHITECTURE.md#everything-is-lazy).

## Secrets

`crypto.ts` is AES-256-GCM, keyed by scrypt from `AUTH_SECRET`, stored as a
self-describing envelope:

```text
v1.<iv>.<authTag>.<ciphertext>        each part base64url
```

Self-describing so the scheme can be revised without guessing how existing rows
were written: `decryptSecret` splits on `.`, requires exactly four parts, and
rejects an unrecognised version by name. GCM rather than CBC because it is
authenticated — a tampered row fails to decrypt instead of quietly yielding
different plaintext, which for an API key is the difference between a loud error
and silently sending mail through an attacker's account. The salt is fixed and
versioned, which would be wrong for password hashing and is right here: this is
key derivation from one high-entropy secret, and a per-row salt would force a
fresh scrypt — about 100ms — on every secret read, on every request, buying
nothing.

`AUTH_SECRET` must be at least `AUTH_SECRET_MIN_LENGTH` characters, which comes
from `@sendstack/shared` rather than a literal here, because five modules each
checked "at least 32" with their own copy. **Changing `AUTH_SECRET` makes every
stored secret unreadable.** `decryptSecret` says exactly that instead of
surfacing Node's "unable to authenticate data", and `getConfig` logs and skips
an unreadable secret rather than throwing — the Settings page has to stay
loadable so the value can be re-entered.

### Nothing from this package goes to a client component

This is the security baseline in [PRODUCT.md](../../PRODUCT.md) — secrets are
never exposed to client code — and it is what the `server-only` import at the
top of each module enforces. In practice:

- the Settings page passes `hasKey: Boolean(config.resend.apiKey)`,
  `hasWebhookSecret`, `hasToken`, `hasEventKey`, `hasSigningKey`,
  `hasCredentials` — booleans, plus `config.provenance` and the auth toggles;
- non-secret fields (`appName`, `appUrl`, the Resend domain and sender, the
  Cloudinary cloud name and folder, the Redis URL) are passed as values,
  because they are not secrets and the form has to pre-fill;
- a secret input is never pre-filled, which is why a blank secret field means
  "keep the stored one" — see `reconcileCloudinary`.

The one public credential is the VAPID public key: the browser needs it to
create a subscription, so it lives in `app_settings` and not in `app_secrets`.
Its private half is a secret and does not.

## Setup state and the wizard

`getSetupState()` returns a discriminated union rather than a boolean, because
each branch is reachable on a real machine and each needs a different screen:

| Stage | Means |
| --- | --- |
| `no-secret` | `AUTH_SECRET` missing or too short. Nothing can be decrypted, so this is checked before anything touches the database. |
| `no-database` | `DATABASE_URL` missing, or Postgres unreachable. Carries `reason`. |
| `needs-migration` | Connected, but `app_settings` or `user` does not exist. |
| `incomplete` | Schema present, `setup_completed_at` still null. Carries `step` — `branding`, `email`, `realtime`, `jobs`, `auth`, `account`, `done`. |
| `needs-admin` | Configured, but no account exists to sign in with. Reachable if account creation failed, or if the last user was deleted. |
| `complete` | Configured, and at least one account exists. |

It **never throws**: it is called by the gate in both layouts, and a wizard that
crashed because the database it exists to configure is unreachable would be
useless precisely when it is needed. `readSetupState()` costs three round trips
and is shared by the cached reader and the action guard, so the guard learns
whether an account exists without a fourth query and without a second copy of
the stage rules. Two details in it are load-bearing: `to_regclass` returns
`NULL` rather than raising when a table is absent, which is what separates "not
migrated" from "cannot connect" in a single trip; and the user probe is
`SELECT EXISTS (…)`, not `count(*)`, because this runs on every uncached
request and a count visits every row to answer a question the first row
settles.

`requireSetupInProgress()` is the first line of every setup Server Action.
**A Server Action is a public POST endpoint addressed by id** — which page
rendered the form is irrelevant to whether it can be called — so without this
guard an anonymous request to a finished instance could overwrite `.env.local`,
swap the Resend key so magic links routed elsewhere, or point the server at an
arbitrary database URL. It always reads fresh: the cached `complete` exists to
make the layout gate cheap, and a stale positive here is the wrong direction to
be stale in.

It returns `hasAdmin` rather than folding it into the throw because the caller
decides what it means. Once any account exists the remaining steps also demand
a session, and only the action can check for one — this package sits beneath
`@sendstack/auth` and cannot import it. `apps/web/src/actions/setup.ts` wraps
both rules in its own `guard()`.

## Deliverability

`deliverability.ts` produces the report behind Settings → Deliverability, and
`assertCampaignDeliverability()` blocks a campaign launch on it. These are not
style preferences: every failure here is invisible at send time — Resend accepts
the message, the API returns 200, and the mail quietly goes to spam.

| Check | Severity | Catches |
| --- | --- | --- |
| `app-url` | blocking | An unparseable, `http://` or localhost app URL. Every unsubscribe link and `List-Unsubscribe` header is built from it; RFC 8058 requires the one-click URI to be HTTPS, and Gmail and Yahoo both require a working one-click unsubscribe from bulk senders. So the button is not shown and the footer link is dead — and recipients who want out press "report spam" instead. |
| `sending-domain` | blocking | No sending domain, so nothing SPF- or DKIM-signs the mail. |
| `link-alignment` | warning | Mail sent from one domain with links on an unrelated host. Filters score link domains separately, so a fresh app host contributes its own reputation: none. `mail.example.com` and `example.com` count as aligned; `example.com` and `vercel.app` do not. |
| `from-address` | blocking | A from-address off the sending domain, so DKIM will not align and DMARC fails. |
| `from-name` | warning | An empty display name, or a `noreply`/`donotreply` local part. Engagement is most of what a new domain's reputation is built from. |
| `postal-address` | warning | No physical address. CAN-SPAM requires one on commercial mail, and filters read its absence as a signal. |
| `webhook` | warning | A stored webhook secret is not a working webhook. Resend reaches the endpoint over the same app URL, so a secret next to a localhost address is a webhook that can never fire — and reporting that as configured is how an instance mails bounced addresses for a month while the settings screen shows a green tick. Without it, bounces and complaints never reach Sendstack and dead addresses are never suppressed. |

Deliberately a pure function of stored configuration: no DNS lookups, no calls
to Resend. Those are worth doing too, but they are slow, they fail for reasons
unrelated to the answer, and they cannot run inside the send path.
`assertCampaignDeliverability()` is called from the action that launches a
campaign rather than from the send job — by the time the job runs the operator
has moved on, and an error there is a row in a dashboard nobody is looking at.
At launch it is a message on the button they just pressed.

## Branding and Cloudinary

Logo, favicon and avatar bytes go to one of two backends, and callers do not
choose. `putImageAsset` picks based on configuration; `brandingRefs` returns
whichever kind of URL resulted, so the rest of the codebase never branches on
it.

**Cloudinary when it is configured**, which is the recommended path and the one
that matters on Vercel. The reason is specific rather than aesthetic: a campaign
embeds an absolute link to the logo, and every recipient's mail client fetches
it. Serving that from the app is one serverless invocation per recipient per
open — a 50,000-person campaign turns a single logo into tens of thousands of
function calls. A CDN URL costs nothing and loads faster, which also affects how
the email renders.

**The database otherwise**, so `git clone && pnpm dev` works with no third-party
account at all. Those assets are served by `/api/branding/logo`,
`/api/branding/favicon` and `/api/avatars/[userId]`.

Details worth not undoing:

- `configured` is all three Cloudinary credentials or none. A partial
  configuration fails at upload time with an opaque signature error rather than
  falling back.
- The checksum is a content hash, not a timestamp, so re-uploading an identical
  file keeps the same URL and does not needlessly bust caches. It is the `?v=`
  on a database-backed URL; Cloudinary solves the same problem with its own
  versioned URLs.
- `public_id` is deterministic (`<folder>/<kind>`) with `overwrite` and
  `invalidate`, so there is one object per kind instead of a growing pile of
  orphans, and the CDN edge is purged when a rebrand happens. Cleanup only runs
  when the id actually changed, and when switching *back* to the database.
- A Cloudinary-backed row nulls `bytes`, so removing Cloudinary later cannot
  make the fallback route serve a stale logo.
- The SDK keeps credentials in module-level global state, so `cloudinary.ts`
  reconfigures before every call. That is an object assignment, not a
  connection, and it removes the class of bug where an instance keeps using the
  previous account after a settings change. `pingCloudinary` deliberately tests
  unsaved credentials without letting them leak into that state.
- `brandingRefs` filters `kind IN ('logo', 'favicon')`. The table now holds one
  avatar row per person, and without the filter the site's two rows arrive
  behind everyone's.
- `absoluteBrandingUrl` exists because a mail client has no page to resolve a
  relative path against. Forgetting it produces a silently broken image in
  every email.

## Invariants — what an edit must preserve

Breaking one of these does not fail loudly. It produces a bug that reports
nothing, or leaks something.

1. **No secret reaches client code.** Every module that reads the database or
   calls a provider imports `server-only`; a new one does too. A client
   component gets booleans
   (`hasKey`, `hasToken`, `hasCredentials`) and `Provenance` labels. If a new
   panel needs to know something about a credential, add a boolean or a label —
   never the value.
2. **The database always wins over the environment, and a cleared value is a
   tombstone.** `""` in `app_settings` and `CLEARED_SECRET` in `app_secrets`
   both mean "the operator turned this off", and `resolve()` must stop there
   without consulting the environment. Any new clear path writes `""` or the
   tombstone; none of them writes `null` or issues a `DELETE`.
3. **Adding a secret needs no migration; adding a setting does.**
   `app_secrets` is one row per key, so a new `SECRET_KEYS` entry is enough. A
   new plain setting is a column in `packages/db/src/schema/settings.ts` plus a
   migration.
4. **`getConfig` is cached for 10 seconds.** A decision that depends on a value
   written moments ago must use `{ fresh: true }`, and a writer outside this
   package must call `invalidateConfig()`. Do not assume a save is visible on
   another instance.
5. **A new seeded setting is registered in `keys.ts` with `satisfies`.** The
   `satisfies Record<string, string | string[]>` on `SETTING_ENV_SEEDS` is not
   decoration: an annotation widened `SeededSetting` to `string`, which let a
   misspelt key compile and forced `key as string` casts at every call site.
   Same for `SECRET_KEYS` and `as const`.
6. **An unreadable secret degrades; it does not throw.** `getConfig` logs and
   skips it. The Settings page must stay loadable so the value can be
   re-entered, which is the only route out of a rotated `AUTH_SECRET`.
7. **`getSetupState()` never throws, and only `complete` is cached.** A new
   stage check goes inside the existing `try` and returns a stage; it does not
   propagate an error to the layout gate.
8. **Every setup Server Action calls `requireSetupInProgress()` first**, and
   demands a session when `hasAdmin`. A new action in
   `apps/web/src/actions/setup.ts` goes through `guard()`.
9. **At least one sign-in method stays enabled, and the enabled ones can
   actually work.** `assertAuthMethods` and `assertAuthMethodsUsable` are the
   check, not the form, because there is no recovery from a running app whose
   every login route is disabled short of editing the database by hand.
10. **`configured` means present *and* well-formed.** `push.configured` and
    `cloudinary.configured` are the flags the UI uses to decide whether to show
    the panel that fixes them, so reporting a malformed credential as
    configured removes the only route to repairing it from inside the app. That
    is not hypothetical: an ellipsis placeholder in `.env.example` once became
    a "valid" VAPID public key, and the browser reported it as an `atob`
    Latin1 error that mentioned neither VAPID nor the file it came from.
11. **`updateSettings` is the only writer of the singleton row**, and it
    invalidates both caches. Writing `app_settings` directly skips
    `invalidateSetupState()`, and `setupCompletedAt` lives in that row.
12. **`DATABASE_URL` and `AUTH_SECRET` never move into the database.** Not a
    style rule — settings in Postgres cannot hold the credentials to reach
    Postgres, and encrypted secrets cannot hold their own key.

## Editing the package

**Adding a plain setting.** Column in `packages/db/src/schema/settings.ts` plus
a migration (see [`../db/README.md`](../db/README.md)); a field in `AppConfig`;
a line in `getConfig` reading `row?.yourField`; a key in `SettingsPatch`. Decide
whether the default belongs in the schema (`.notNull().default(…)`), which is
where every existing default with a sensible value lives, or in `getConfig`'s
`??` fallback, which is where the ones that depend on another field live. If it
is nullable and clearable, keep `null` and `""` distinct all the way to the
action — see invariant 2.

**Adding a secret.** One entry in `SECRET_KEYS` with its `envVar` and `label`,
one field in `AppConfig`, one `secret("yourKey")` line in `getConfig`. **No
migration** — `app_secrets` is one row per key. Then a boolean on the Settings
page (`hasYourKey`) and a `forgetSecret` path if it can be cleared; never a
field that renders the value.

**Adding a seed environment variable.** An entry in `SETTING_ENV_SEEDS` (a
string, or an array when more than one convention exists), and a commented block
in [`.env.example`](../../.env.example) under the optional section saying what
it is for and that the database wins. If the value is a credential it belongs in
`SECRET_KEYS` instead, which already carries its variable name.

**Adding a deliverability check.** Push a `DeliverabilityCheck` in
`deliverabilityReport` with a stable `id`, a title that reads as the thing that
should be true, and a `detail` present only when it fails. Choose the severity
by consequence: `blocking` means a bulk send would be actively damaging —
filtered mail, dead unsubscribe links — and it will stop campaigns through
`assertCampaignDeliverability`. Anything that merely hurts placement is a
`warning`. Keep it a pure function of `AppConfig`: no DNS, no provider calls, it
runs in the launch path. Add a case to `deliverability.test.ts` for the passing
and the failing shape.

**Adding a setup stage.** A variant of `SetupState`, a branch in
`readSetupState` inside the existing `try`, and a screen in the wizard. Nothing
but `complete` may be cached.

**Do not** import `@sendstack/auth` here — this package sits beneath it, which
is why `requireSetupInProgress` returns `hasAdmin` instead of checking a
session. **Do not** import `@sendstack/redis` or `@sendstack/email` either;
both read *from* here, and reversing that is the circular dependency the
caching section is about.

## Testing

No database, no network, no Redis. From the repository root:

```bash
npx vitest run packages/config
```

| File | Covers |
| --- | --- |
| `config.test.ts` | The resolver, against an in-memory `app_settings` row and `app_secrets` table driven through the three drizzle calls `config.ts` actually makes: seeding from the environment, a stored value beating it, a cleared setting and a cleared secret *not* resurrecting from the environment, a decrypted secret reporting `database`, one unreadable secret not costing the rest, `clearSecret` writing a tombstone rather than deleting, a blank `setSecret` meaning the same, the marker never reaching the cipher, and every branch of `assertAuthMethodsUsable`. |
| `crypto.test.ts` | Round-trip including unicode, fresh ciphertext per call, the four-part `v1.` envelope, a tampered payload rejected rather than yielding wrong plaintext, a changed `AUTH_SECRET` failing with the message that explains it, an unknown version rejected, and a weak `AUTH_SECRET` refused. |
| `setup-state.test.ts` | `complete` answered without re-querying, no other stage cached, setup being seen as finished on the very next call, `{ fresh: true }` and `invalidateSetupState()` both re-querying, stopping before the database when there is no secret, an unreachable database reported rather than thrown, a configured install that lost its last account not being cached, `EXISTS` rather than a count, and `requireSetupInProgress` throwing on a finished instance while ignoring the cached `complete`. |
| `deliverability.test.ts` | Every check in both directions, including a plain-`http://` URL on a real host, an unparseable URL, the app on a subdomain and on the bare sending domain, a domain that merely ends the same way, a no-reply sender, and the webhook not counting as configured when Resend cannot reach it. Plus `assertCampaignDeliverability` refusing on blocking failures and not on warnings alone. |
| `cloudinary-settings.test.ts` | `reconcileCloudinary`, whose one subtlety is that **a blank API key means "keep the stored one"**. Requiring all three fields rejected the most common case — someone who configured Cloudinary in `.env`, opened the wizard and pressed Save — and that bug was written twice, once correctly and once not. Also trimming, a whitespace-only secret treated as blank, the deliberate clear, and when a ping is needed. |
| `push-config.test.ts` | `resolvePushConfig`: a real pair accepted, an unconfigured instance reported quietly rather than logging three lines per request, the ellipsis placeholder refused with a reason, the source named in the log, a half-configured pair refused, standard base64 refused (the usual paste mistake), and a bare email subject refused. |
| `branding.test.ts` | `absoluteBrandingUrl`: a CDN href passed through, a database href joined to the app URL, no doubled slash, `null` for nothing uploaded, and never a relative URL for a present asset. |

`cloudinary.ts`, `avatar.ts` and the storage half of `branding.ts` have no
automated test — they need a real Cloudinary account or a real Postgres. Check
them by hand: upload a logo with Cloudinary configured and confirm the Settings
preview points at `res.cloudinary.com`, clear the cloud name and upload again
and confirm the preview points at `/api/branding/logo?v=…`, then send yourself a
test campaign and confirm the logo renders in the mail client.

## Files

| File | Holds |
| --- | --- |
| `config.ts` | `AppConfig`, `resolve()`, `getConfig`, the 10-second cache, `updateSettings`, `setSecret`, `clearSecret`, and the auth-method assertions. |
| `keys.ts` | `SECRET_KEYS`, `SETTING_ENV_SEEDS`, `envCandidates`, `Provenance`. The catalogue of what can be seeded and from where. |
| `crypto.ts` | AES-256-GCM envelope: `encryptSecret`, `decryptSecret`, `SecretDecryptionError`, `CLEARED_SECRET` (internal). |
| `setup-state.ts` | `SetupState`, `getSetupState`, `invalidateSetupState`, `requireSetupInProgress`, and the shared three-round-trip `readSetupState`. |
| `deliverability.ts` | The seven checks, `deliverabilityReport`, `assertCampaignDeliverability`. |
| `branding.ts` | The two-backend image store: `putImageAsset` and the `logo`/`favicon` wrappers, `brandingRefs`, `absoluteBrandingUrl`, the size and format limits. |
| `avatar.ts` | Per-user avatars on the same store, keyed `avatar:<id>`. No SVG. |
| `cloudinary.ts` | The SDK calls: `pingCloudinary`, `uploadBrandingImage`, `deleteCloudinaryImage`, and the reconfigure-before-every-call wrapper. |
| `cloudinary-settings.ts` | `reconcileCloudinary` (pure), `applyCloudinarySettings`, `cloudinaryFromForm`. |
| `push-config.ts` | `resolvePushConfig` — whether push can be signed, and why not if not. Its own file, and pure, so the bug it fixes has a test: `getConfig` needs a database, and anything inside it can only be tested by mocking drizzle's builder chain, which tests the mock. |
| `index.ts` | The public surface. |
