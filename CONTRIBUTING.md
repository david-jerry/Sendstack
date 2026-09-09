# Contributing to Sendstack

Thanks for being here. This is a young project and the surface area is
deliberately small, so there is a lot of room to add things.

## How to contribute

1. **Fork the repo and branch from `main`.** Name the branch for what it does
   — `fix/suppression-race`, `feat/segments`, `docs/pwa-walkthrough` — so it
   reads in the branch list without opening the diff.
2. **Keep the change scoped.** One fix or one feature per PR. A drive-by
   rename or reformat bundled into an unrelated fix is the first thing a
   reviewer has to untangle.
3. **Read [PRODUCT.md](PRODUCT.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
   before touching a core flow** — sending, suppression, webhooks, realtime.
   These document invariants a plausible-looking change can quietly break; see
   [Things to be careful about](#things-to-be-careful-about) below for the
   sharp edges.
4. **Write commits that say why, not just what** — `git log` is read far more
   often than it is written. `fix: enforce suppression on the resend path`
   beats `update send.ts`.
5. **Run the checks locally before opening the PR:**

   ```bash
   pnpm typecheck
   pnpm lint
   pnpm test
   pnpm build
   ```

6. **For anything beyond a typo or a one-line fix, run
   `pnpm changelog:add`** — see
   [Changelog and attribution](#changelog-and-attribution) below — and include
   the resulting `CHANGELOG.md`/`CONTRIBUTORS.md` diff in the same PR.
7. **Open the PR against `main`.** The
   [template](.github/pull_request_template.md) asks four things a reviewer of
   a bulk-email system has to establish anyway: which flow you touched, which
   [context](docs/ARCHITECTURE.md#bounded-contexts) owns the code, which
   invariants you verified and how, and which test would fail if the change
   were undone. Answering them yourself is faster than a round trip.

   CI runs `pnpm typecheck lint test build` on every PR; a red check is
   expected to be fixed before review, not explained away.
8. **Break-test any new guard.** Invert the condition, watch the test fail,
   put it back. A test that has never failed has not been shown to test
   anything — a "hydrates without a mismatch" test passed in this repo while
   rendering identically on both sides and proving nothing.

## Getting set up

```bash
pnpm install
cp .env.example .env       # fill it in — every variable is documented
pnpm db:migrate
pnpm dev
```

`pnpm dev` runs the Next.js app and the Inngest dev server together. You need
Postgres and Redis reachable; [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md) has a
Docker Compose file that gives you both locally.

## Where things live

Every package under `packages/` has a README, and it is the right place to
start once this table has pointed you at one. Each says who imports the
package and what they take from it, what its public surface is, which
invariants an edit has to preserve, and how to test it. The
[repository layout](README.md#repository-layout) section indexes them all and
gives the dependency direction.

| Change | Where |
|---|---|
| A screen or component | `apps/web/src/app`, `apps/web/src/components` |
| A mutation | `apps/web/src/actions` — a Server Action, never a client fetch |
| A table or column | `packages/db/src/schema`, then `pnpm db:generate` |
| Anything Resend | `packages/email` — the only package that imports `resend` |
| A background job | `packages/jobs/src/functions`, exported from `src/index.ts` |
| A validation schema | `packages/shared/src/schemas.ts` — used by form *and* action |
| A colour or design token | `packages/theme/src/tokens.css` — define it in **both** `:root` and `.dark` |
| A configurable setting | `packages/config` — plus a field in Settings and, if it needs one, a help topic in `apps/web/src/lib/setup-help.ts` |
| An email design | `packages/email/src/templates` — add it to `COMPONENTS` and `TEMPLATE_META` |
| A sign-in method | `buildAuth()` in `packages/auth`, a toggle in `app_settings`, a button in the sign-in form |

Client components never call a service directly. They call a Server Action,
which calls a package. This is what keeps API keys out of the browser bundle.

## Changelog and attribution

[CHANGELOG.md](CHANGELOG.md) follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/):
an `## [Unreleased]` section with `### Added` / `### Changed` / `### Deprecated`
/ `### Removed` / `### Fixed` / `### Security` sub-headings, which becomes a
dated, versioned section on release. [CONTRIBUTORS.md](CONTRIBUTORS.md) is a
table of everyone who has contributed, with the date of their first PR.

Both are updated by one command instead of by hand, so the format never
drifts:

```bash
pnpm changelog:add
```

It asks four questions — the semver impact of your change (major, minor, or
patch), the Keep a Changelog category, a one-line description, and your name
plus GitHub handle — then:

- appends an entry under the matching category in `CHANGELOG.md`'s
  `[Unreleased]` section, attributed to your GitHub handle;
- adds a row to `CONTRIBUTORS.md` if this is your first contribution, or
  leaves it alone if you are already listed.

**Run it for anything major or minor** — a new feature, a behaviour change, a
bug fix a user would notice. Patch-level changes (typos, comments, internal
refactors with no visible effect) prompt for confirmation before adding an
entry, because a changelog a reader has to wade through to find what actually
changed stops being useful.

Review the diff it produces before committing — it edits real files, not a
staging area.

## Things to be careful about

This is software that sends email to real people in bulk. A few areas where a
plausible-looking change causes real harm:

**Suppression.** Any new send path must go through the same suppression check —
`isUnsendable` in `packages/db/src/suppression.ts` for SQL, or
`assertNotSuppressed` for a one-to-one send. If you add a way to send that does
not consult it, that is a bug even if every test passes. Note that the rule is
*two* conditions, a live suppression row or a contact whose status has left
`active`, and a check that applies only one of them has already shipped here
once.

**Idempotency.** Anything that sends needs a stable idempotency key and a
conditional status transition. "It only runs once" is not true of a job that
can retry.

**Address normalisation.** Every address entering the system goes through
`normalizeEmail()`. Do not add a code path that writes a raw string.

**Inbound HTML.** It is displayed as source, not rendered. If you want to render
it, it goes in a sandboxed iframe with a restrictive CSP — not a
`dangerouslySetInnerHTML`.

**Migrations are additive.** Never edit a migration that has shipped. Generate
a new one.

**Do not hand-edit the Better Auth tables.** Better Auth resolves columns by
their TypeScript property name, so a missing field compiles fine and fails at
runtime — after a `user` row has already been written, leaving an account
nobody can sign in as. `packages/auth/src/auth-schema.test.ts` compares the
Drizzle schema against Better Auth's own `getAuthTables()` with every plugin
enabled; after upgrading Better Auth, run `pnpm test` first and
`pnpm auth:generate` if it complains.

**Never render a secret.** Not in the UI, not truncated, not in a log line. The
Settings page reports set/missing and nothing more — a screen that shows the
first six characters of an API key is a screen that leaks one into a
screenshot.

**Keep clients lazy.** The database, Resend, Redis and auth clients are all
built on first use. An eager `new Client()` at module scope breaks the setup
wizard, which by definition runs before any of them are configured.

**Forms use React Hook Form + Zod, with the schema in `@sendstack/shared`.**
One definition validates the form and the Server Action that receives it, so a
rule like "the from-address must be at your sending domain" is enforced in both
places and shown next to the offending field rather than as a banner after a
round trip.

You will see `Compilation Skipped: Use of incompatible library` warnings on
form components. That is the React Compiler declining to auto-memoise a
component that uses React Hook Form. It is informational, forms are not
render-hot paths, and the components are correct — do not suppress it, or real
warnings will hide behind the suppression.

**Name fields use `NameInput`.** It title-cases as you type, protects words the
user capitalised themselves (`IBM`, `eBay`), and stops transforming once they
delete a capital it added. Server Actions call `normalizeName()` as well,
because a Server Action is a public endpoint and the browser's behaviour is a
convenience rather than a guarantee.

**Every colour needs a dark value.** Tokens live in
`packages/theme/src/tokens.css` and must be defined in both `:root` and
`.dark`. A hard-coded hex in a component looks right in one mode and wrong in
the other, and nothing will catch it.

**Component tests run in jsdom with stubs for two APIs.** jsdom has no
`matchMedia`, and Node 25's experimental Web Storage shadows the DOM's — see
`test/dom-env.ts`. `setPrefersColorScheme()` lets a test pretend the operating
system is set to dark.

**At least one sign-in method must remain enabled.** There is no recovery from
an instance whose every login route is off.

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains the reasoning behind each
of these.

## Style

- TypeScript everywhere, `strict` on. No `any` in new code.
- Comments explain *why*. The code already says what.
- Prefer one SQL statement over a loop of round trips, especially anywhere a
  list could be large.
- Match the surrounding code rather than importing a new convention.

## Ideas worth taking

- A template editor on the existing (unused) `templates` table.
- Segments — `campaigns.list_id` is nullable and the query already branches.
- Per-workspace multi-tenancy.
- Another provider behind the `@sendstack/email` interface (SES, Postmark).
- A/B subject testing.
- Integration tests. The unit tests cover pure logic only — escaping, address
  normalisation, unsubscribe signing, bounce classification. The send pipeline
  and the webhook handler need tests against a real Postgres, and that is where
  they would pay for themselves fastest.

## Reporting a security issue

Please do not open a public issue. Email the maintainers instead, and give us a
reasonable window to ship a fix before disclosing.
