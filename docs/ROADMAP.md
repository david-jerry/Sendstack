# Roadmap

What is planned but not built. Nothing here exists yet — if you are writing
code that assumes any of it, stop and read this first.

## Sustaining the project

Sendstack is MIT-licensed and free to self-host, and the intention is to keep
it that way while funding the work. Two directions are planned.

### Subscriptions

A hosted version, with self-hosting unchanged and unrestricted.

Nothing in the codebase blocks this today, but two things would need doing
first, and both are real work rather than plumbing:

- **Multi-tenancy.** Currently one workspace per deployment. A hosted version
  needs a `workspaces` table, a `workspace_id` on every domain table, and
  scoping enforced at `requireSession()` rather than at each call site. Doing
  it at the call sites is how one tenant eventually reads another's contacts.
- **Per-workspace credentials.** Configuration is already in the database
  rather than the environment, which is most of the way there — `app_settings`
  and `app_secrets` would gain a workspace key. The encryption layer needs no
  change.

An open question worth settling before starting: whether a hosted tenant brings
their own Resend account or sends through a shared one. Shared sending means
one tenant's spam complaints damage every other tenant's deliverability, which
is a hard problem and not one to discover late.

### Advertising and affiliate income

Also planned. One decision to make deliberately rather than by default:

**Whose deployment shows the ads?** Sendstack is software other people install
on their own infrastructure. Ads that render inside a self-hosted install are
shown to *that operator's* users, in an app carrying *their* branding, funded by
this project. That is a defensible choice if it is explicit and documented, and
a reputational problem if people discover it after deploying. The alternatives —
ads only on the hosted version, or only on the marketing site and docs — avoid
the question entirely.

Affiliate links are more straightforward: the setup wizard already recommends
Neon, Upstash, Resend and Cloudinary by name, and referral links there are
honest as long as they are disclosed. The recommendations should not change
because of them — the reasoning for each is written down in
[ARCHITECTURE.md](ARCHITECTURE.md) and should stay the actual reasoning.

If ads do ship into the self-hosted build, an off switch that is genuinely off
belongs in the same release, not a later one.

## Product

- **A visual template editor.** Uploaded HTML templates live in the `templates`
  table and are rendered by `renderCustomTemplate()`; an editor would write the
  same rows. See [CUSTOM-TEMPLATES.md](CUSTOM-TEMPLATES.md) for the contract.
- **Segments.** `campaigns.list_id` is nullable and the materialisation query
  already branches on it — a `segments` table holding a serialised predicate
  slots into the same `INSERT … SELECT`.
- **A/B subject testing.** Needs a variant column on `campaign_recipients` and
  a split at materialisation time.
- **More sign-in methods.** The auth layer takes them: a toggle in
  `app_settings`, a plugin in `buildAuth()`, a button in the sign-in form.
- **Another email provider** behind the `@sendstack/email` interface. It is the
  only package that imports `resend`.

## Engineering

- **Integration tests.** The unit tests cover pure logic. The send pipeline and
  the webhook handler need tests against a real Postgres, and that is where
  they would pay for themselves fastest.
- **Inbound HTML rendering** in a sandboxed iframe with a restrictive CSP.
  Today it is shown as source, because rendering a stranger's markup into the
  app would hand them the session.
- **Cross-instance rate limiting.** There is none. Better Auth applies a
  per-instance limit on sign-in, which is real but not shared across instances.
  A cross-instance limiter was scaffolded once and removed when nothing called
  it — dead code that claims to protect you is worse than none. Rebuilding it
  means a sliding window on the `RedisBackend` interface, implemented for both
  transports, and actually wiring it into the auth and send paths.
- **Cross-instance config invalidation.** `getConfig()` caches for 10 seconds
  per process, so a saved setting takes up to that long to reach other
  instances. Fixing it properly needs a channel that does not depend on Redis,
  since the Redis credentials are themselves configuration.
