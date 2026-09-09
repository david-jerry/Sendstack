# Contributors

Thanks to everyone who has contributed to Sendstack. This list is maintained
by [`pnpm changelog:add`](CONTRIBUTING.md#changelog-and-attribution) — run it
alongside your PR rather than editing this table by hand, so the format stays
consistent.

## Architecture flow all contributors must follow

Before opening a PR, confirm your change follows the project architecture flow.

1. Read [PRODUCT.md](PRODUCT.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
2. Keep dependency direction one-way:
   UI -> Server Actions or API routes -> packages/\* -> infrastructure.
3. Do not call providers directly from client code, and keep provider SDK usage
   in the owning packages (`@sendstack/email`, `@sendstack/redis`,
   `@sendstack/jobs`, `@sendstack/auth`).
4. Keep shared and data-model ownership explicit:
   runtime contracts belong in `packages/shared`; schema constraints and
   migrations belong in `packages/db`.
5. Preserve the two core flows:
   outbound send pipeline (materialize -> suppress -> claim -> idempotent send
   -> persist), and inbound webhook pipeline (verify -> dedupe -> persist ->
   publish -> hydrate -> publish).
6. Preserve invariants:
   Postgres is source of truth; realtime is a latency optimization, not a
   correctness dependency; sending is idempotent and duplicate-safe; inbound
   processing tolerates at-least-once delivery and retries; suppression checks
   run on every send path; email addresses are normalized at ingestion
   boundaries; inbound HTML is never treated as trusted app content.
7. For realtime and webhook changes, preserve contract semantics:
   validate event schema, handle duplicates safely, do not assume perfect event
   order, keep monotonic status transitions under out-of-order events, and
   recover from missed events by refreshing from authoritative Postgres state.

If your change modifies the flow, update [README.md](README.md),
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and tests in the same PR.
In the PR description, explicitly state which flow you touched (outbound,
inbound, realtime, auth, setup) and which invariants you verified.

| Name | GitHub | First contribution |
| ---- | ------ | ------------------ |
