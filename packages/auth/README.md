# @sendstack/auth

Better Auth for [Sendstack](../../README.md), configured from stored settings
rather than from a file. The package is a wrapper, not an implementation: it
builds a Better Auth instance lazily from `getConfig()`, caches it against a
signature of every input that changes its shape, and exposes two session
helpers. Sign-in methods are operator choices made in Settings, so the instance
has to be rebuildable at runtime — that constraint is why nearly everything
here exists.

## Where it is used

| Consumer | What it uses, and which way the dependency runs |
| --- | --- |
| `apps/web/src/actions/*.ts` | `requireSession()` at the top of every Server Action that touches campaigns, contacts, the inbox, templates, attachments, push or settings. `apps/web/src/actions/profile.ts` also uses `getAuth()` directly for password and passkey management, and `settings.ts` and `setup.ts` call `resetAuth()` after saving anything the instance is built from. |
| `apps/web/src/app/api/**/route.ts` | `getSession()` and an explicit 401 — `contacts`, `campaigns`, `outbound`, `compose/send`, `inbox/threads`, `templates/preview`, `avatars/[userId]`, `realtime/stream`. |
| `apps/web/src/app/api/auth/[...all]/route.ts` | Better Auth's own endpoints, mounted through `toNextJsHandler(await getAuth())` per request. `runtime = "nodejs"`, because the Drizzle adapter needs a Postgres connection. |
| `apps/web/src/app/(auth)/sign-in`, `sign-up`, `forgot-password` | `getSession()` to bounce an already-signed-in visitor to `/inbox`; `sign-up` additionally redirects to `/sign-in` when `config.auth.allowSignup` is false. |
| `apps/web/src/components/auth/*`, `apps/web/src/components/shell/*`, `apps/web/src/components/setup/steps-auth.tsx` | `@sendstack/auth/client` — the browser client (`signIn`, `signUp`, `signOut`, `useSession`, `authClient.passkey`, `authClient.signIn.magicLink`, password reset and verification calls). |
| `packages/config` | **This package depends on config, never the reverse.** It reads `appUrl`, `appName`, `auth.{emailPassword,passkey,magicLink,allowSignup}` and `resend.fromEmail` from `getConfig()`. Config owns the guards that constrain what this package may be asked to build — `assertAuthMethods()` and `assertAuthMethodsUsable()` — and cannot import `@sendstack/auth`, which is why `requireSetupInProgress()` returns `hasAdmin` for the caller to act on instead of checking a session itself. |
| `packages/shared` | `MIN_PASSWORD_LENGTH` and `AUTH_SECRET_MIN_LENGTH`. One direction only. |

## The public surface

Everything a consumer may import from `@sendstack/auth` comes from
`src/index.ts`; the browser client is the separate `@sendstack/auth/client`
subpath. Nothing else in the package is a contract.

| Export | When to reach for it |
| --- | --- |
| `getAuth()` | The Better Auth instance itself. For the catch-all route handler, and for the profile actions that call `auth.api.*`. Cheap on repeat: it returns the cached instance unless a setting that shapes it has changed. |
| `resetAuth()` | Drop the cached instance. Call it in the same action that saved an auth setting, the app name or the app URL. |
| `requireSession()` | Inside a Server Action. It **throws** `UNAUTHORIZED`, so forgetting to check the result is a crash rather than a silent authorisation bypass — the failure mode being prevented is `const session = await getSession()` followed by no `if`, which leaks data to an anonymous caller. |
| `getSession()` | Inside a route handler, or anywhere a missing session is an ordinary answer. Returns `null`. A throw here would surface as a 500 and leave the client unable to tell "not signed in" from "server broken". |
| `Auth`, `Session` | The inferred instance and session types. `Session` is `Auth["$Infer"]["Session"]`. |
| `@sendstack/auth/client` → `authClient`, `signIn`, `signUp`, `signOut`, `useSession` | Client components. Plugins are registered here unconditionally: they only add methods, and calling one against a server with that plugin disabled returns 404, which keeps this module free of a round trip to discover configuration. The UI does not render buttons for disabled methods. |

## Configuration from the database

`buildAuth()` reads its whole option object from `getConfig()`:

- **`appUrl`** — `baseURL`, the passkey `origin` and `rpID` (the bare hostname; a
  scheme or port makes the browser reject every registration), and whether
  cookies are marked `Secure` at all, so a plain-HTTP local dev server can still
  hold a session.
- **`appName`** — `appName`, and the subject and heading of all three
  transactional emails.
- **`auth.emailPassword`, `auth.passkey`, `auth.magicLink`, `auth.allowSignup`** —
  which plugins are constructed and whether sign-up is disabled.
- **`resend.fromEmail`** — part of the cache signature, because the magic-link
  closure sends mail and a changed sender must rebuild it.
- **`AUTH_SECRET`** — from the environment, never the database, because it is the
  key the database's own secrets are encrypted with. Minimum
  `AUTH_SECRET_MIN_LENGTH` (32) characters.

Better Auth takes its plugin list at construction, so "let the operator turn
passkeys on in Settings" means building lazily and rebuilding on change. That is
what `signatureOf()` detects and what `resetAuth()` forces for the instance that
handled the save. The rejected alternative — register every plugin always and
gate them at the route — would leave live endpoints for methods the operator
believes are off.

`MIN_PASSWORD_LENGTH` (12, longer than Better Auth's default 8 because this
account can email an entire contact list) comes from `@sendstack/shared`, so the
Zod schema the form validates against and the server's `minPasswordLength`
cannot disagree.

## Sign-in methods

| Method | What it needs to be usable |
| --- | --- |
| Email and password | Nothing beyond the default. `requireEmailVerification` is deliberately `false`: `true` would lock out the operator who has just finished the wizard on an instance where Resend was the thing being configured. The address is confirmed by email instead, and the account works meanwhile. |
| Passkeys | An https origin. `localhost` and `127.0.0.1` are exempt, matching the browser's own rule. |
| Magic links | A working Resend key. Without one, `sendMagicLinkEmail()` throws and the sign-in request fails. |

Both rules are enforced in `packages/config` by `assertAuthMethodsUsable()`,
called by `updateAuthSettings` in `apps/web/src/actions/settings.ts` and by the
wizard step in `apps/web/src/actions/setup.ts` — one wording, two call sites. It
also calls `assertAuthMethods()`, which refuses to leave every method disabled:
there is no recovery path from a running app whose every login route is off
short of editing the database by hand.

**Open registration (`allowSignup`) defaults to false and should stay that way
once the operator is in.** On this product an account is not just a login — it
can send to every contact list in the database. An instance left open to public
sign-up is an instance a stranger can use to email your contacts from your
domain. The sign-up page redirects to `/sign-in` when it is off, and both the
password and magic-link plugins pass `disableSignUp: !allowSignup` so the
endpoints refuse too.

## The schema

The five tables Better Auth owns — `user`, `session`, `account`, `verification`,
`passkey` — live in `packages/db/src/schema/auth.ts` and are **generated, not
written**. Do not hand-edit them.

`src/schema-reference.ts` exists only so the Better Auth CLI has a plain
exported `auth` to introspect; nothing imports it at runtime. Every plugin is
enabled in it unconditionally, because methods are toggled from Settings and the
schema must cover every plugin that could ever be switched on. Regenerating is:

```bash
pnpm auth:generate     # @better-auth/cli generate --config src/schema-reference.ts
```

then reconcile the output into `packages/db/src/schema/auth.ts` and run
`pnpm db:generate` for the migration. Better Auth resolves columns by their
**TypeScript property name**, so a missed or renamed field compiles cleanly and
fails at runtime — as a sign-up that has already written a `user` row, leaving an
orphan nobody can log in as. `src/auth-schema.test.ts` is the guard.

## Page and action gating

A session check belongs at **every point a query starts**, not only in a layout.
Next renders a layout concurrently with the pages and components beneath it, so
a page's queries run — and their results are serialised into the RSC payload —
before the layout's redirect is thrown.

`requireAccess()` in `apps/web/src/lib/setup-gate.ts` is the app-side helper for
that, and it lives there rather than here because it depends on Next's
`redirect()` and on the app's setup cache. It checks `requireSetup()` first (an
unconfigured instance has no database to read a session from), then reads the
session through a per-request `cache()` so a page and its layout share one read.

It redirects rather than calling `requireSession()`. Both the layout and the
page fail on the same request, and two `redirect("/sign-in")` calls agree with
each other; a thrown `UNAUTHORIZED` racing a redirect does not — whichever
surfaces first wins, and half the time that would be an error page instead of
the sign-in form. Server Actions have no such race and use `requireSession()`.

## Invariants — what an edit must preserve

1. **`AUTH_SECRET` is effectively permanent.** It signs sessions, encrypts every
   stored secret in `app_settings` (`packages/config/src/crypto.ts`) and signs
   every unsubscribe link (`packages/email/src/unsubscribe.ts`), which by design
   never expire. Changing it signs everyone out, makes the stored Resend and
   webhook credentials unreadable, and breaks every unsubscribe link already
   delivered. Treat rotation as a migration, not a setting.
2. **At least one sign-in method stays enabled.** Enforced in
   `assertAuthMethods()`, not in the form. Any new path that writes the auth
   settings goes through it.
3. **A method that cannot work is not enabled.** Magic links need a Resend key,
   passkeys need a secure origin; `assertAuthMethodsUsable()` is the one place
   that knows this.
4. **The password rule is declared once**, as `MIN_PASSWORD_LENGTH` in
   `@sendstack/shared`. Never retype the number in a form, a schema or an option.
5. **The generated auth schema is not hand-edited.** Regenerate, reconcile,
   migrate, and let `auth-schema.test.ts` confirm it.
6. **A session check happens wherever a query starts** — `requireAccess()` on
   pages and data components, `requireSession()` in Server Actions, `getSession()`
   plus a 401 in route handlers. A layout alone is not a gate.
7. **The cached instance follows the settings.** Anything that changes
   `appUrl`, `appName`, an enabled method, `allowSignup` or the Resend sender
   calls `resetAuth()` in the same action.
8. **`nextCookies()` stays last in the plugin list.** It wraps the handler to
   flush `Set-Cookie` through Next's cookie API, and any plugin added after it is
   not covered.

## Editing the package

**Adding a sign-in method.** It is four changes in one commit: a boolean column
in `packages/db/src/schema/settings.ts` plus a migration; the field on
`AppConfig` and its default in `packages/config/src/config.ts`, with any
usability rule added to `assertAuthMethodsUsable()`; the plugin appended
conditionally in `buildAuth()` **and** its input added to `signatureOf()`, or the
toggle will not take effect until the process restarts; and the client plugin in
`src/client.ts` with the button in `apps/web/src/components/auth/auth-form.tsx`.
If the plugin owns tables, enable it in `src/schema-reference.ts` and in
`auth-schema.test.ts` too — unconditionally, as the others are.

**Changing a password rule.** Edit `MIN_PASSWORD_LENGTH` in
`packages/shared/src/constants.ts`. `buildAuth()` and the Zod password schema
both read it; nothing else should need touching. Existing passwords are not
re-validated, so raising it only affects new ones and resets.

**Changing an email.** The three transactional templates are
`src/magic-link-email.ts` and `src/auth-emails.ts`. They throw on a delivery
failure on purpose: a "check your email" screen shown after the send failed is a
dead end. Keep the stated expiry in the copy in step with the token expiry in
`server.ts` (5 minutes for a magic link, 1 hour for a reset, 24 hours for
verification).

**Do not** import `@sendstack/auth` from `packages/config`, `packages/db` or
`packages/shared`. Those sit beneath it, and the direction is what keeps the
config guards usable from the setup wizard before any account exists.

## Testing

```bash
npx vitest run packages/auth
```

`src/auth-schema.test.ts` is the only test in the package and needs no database
connection. It builds a Better Auth options object with email/password, magic
link and passkey all enabled, asks `getAuthTables()` what columns Better Auth
will resolve, and compares that against `getTableColumns()` for each Drizzle
table: every expected table is present, every field Better Auth resolves exists
as a column, each table has an `id` Better Auth can write, and — as a named
regression — `account.issuer` is present, whose absence broke sign-up after the
`user` row had already been committed.

The runtime behaviour is covered from the app side, where the callers are:
`apps/web/src/actions/setup.test.ts` asserts the session guard is skipped before
an admin exists and enforced after (including that a rejected `requireSession`
stops the action), and the action integration tests
(`compose.replay.integration.test.ts`, `campaigns.guards.integration.test.ts`)
stub `requireSession` with a fixed user so the rest of an action can be tested
against a real database.

## Files

| File | Holds |
| --- | --- |
| `src/index.ts` | The public surface: `getAuth`, `resetAuth`, `requireSession`, `getSession`, `Auth`, `Session`. |
| `src/server.ts` | `buildAuth()`, the signature-keyed cache, `requireSecret()`, `resetAuth()`. Every Better Auth option lives here. |
| `src/session.ts` | `getSession()` and `requireSession()` over `next/headers`. |
| `src/client.ts` | The browser client, exported as `@sendstack/auth/client`. |
| `src/magic-link-email.ts` | `sendMagicLinkEmail()`. Separate module so `server.ts` does not pull the mail stack in at module scope. |
| `src/auth-emails.ts` | `sendPasswordResetEmail()`, `sendVerificationEmail()`. Imported dynamically for the same reason. |
| `src/schema-reference.ts` | The static, all-plugins-enabled instance the Better Auth CLI reads. Not imported at runtime. |
| `src/auth-schema.test.ts` | The Drizzle/Better Auth schema conformance guard. |
