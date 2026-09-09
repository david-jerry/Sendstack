<!--
Keep this short. The point is not paperwork — it is that the four questions
below are the ones a reviewer of a bulk-email system has to ask anyway, and
answering them yourself is faster than a round trip.

Delete any section that genuinely does not apply, and say why in one line.
-->

## What changed, and why

<!-- One paragraph. The why is the part `git log` cannot reconstruct. -->

## Flow touched

<!-- Tick every one the diff reaches. "None" is a legitimate answer for docs,
     tooling or a pure refactor with no behaviour change. -->

- [ ] Outbound — campaigns, one-to-one sends, delivery events
- [ ] Inbound — webhooks, hydration, threading
- [ ] Configuration — settings, secrets, the setup wizard
- [ ] None

## Context owner

<!-- The context from the ownership matrix in docs/ARCHITECTURE.md whose code
     this changes. A new Server Action, API route or job must ALSO add itself
     to that matrix in this PR — `test/architecture.test.ts` fails otherwise. -->

Owner:

## Invariants verified

<!-- Only the ones this diff could plausibly break. Say how you know, not that
     you believe it. `PRODUCT.md` has the full list. -->

- [ ] Postgres remains the source of truth; realtime is latency only
- [ ] Sends stay idempotent — a unique index and `ON CONFLICT`, not app logic
- [ ] Suppression is checked on every send path this diff can reach
- [ ] Addresses are normalised at the ingestion boundary
- [ ] Status transitions stay monotonic
- [ ] Inbound HTML is still untrusted
- [ ] Not applicable, because:

## Proof

<!-- Name the tests. A new guard needs a break-test: invert it, watch the test
     fail, restore it. A test that has never failed has not been shown to test
     anything. -->

Tests added or changed:

Break-tested by:

## Checks

- [ ] `pnpm test`
- [ ] `pnpm typecheck`
- [ ] `pnpm lint` — problem count did not rise
- [ ] `pnpm build`
- [ ] `pnpm changelog:add` run, and the diff is in this PR
