# DDD execution plan

Sprint-sequenced tickets for the bounded-context refactor. Read
[ARCHITECTURE.md § Bounded contexts](ARCHITECTURE.md#bounded-contexts) first —
it holds the ownership matrix and the decision record this plan executes.
Nothing here is a rewrite: every ticket lands inside the current package
boundaries, and `PRODUCT.md`'s invariants are walls.

Policy decisions taken 2026-09-08, which several tickets depend on:

| Decision | Value | Consequence |
|---|---|---|
| Verification gate | **Exists, always allows** | `assertCanSend` runs on every send-capable surface; its policy constant is `"unenforced"`. Flipping it is one line plus S3-IDN-1. |
| Additive schema | **Allowed, one table** | `policy_decisions` records refusals. No outbox — the realtime channel is a projection by contract and must never become a source of truth. |
| Scope now | **Plan, then Sprint 1** | Later sprints wait for a go. |

Ticket ids are `S<sprint>-<CTX>-<n>`. Contexts: `IDN` Identity & Access,
`AUD` Contact & Audience, `SUP` Suppression & Deliverability, `CMP` Campaign
Orchestration, `DLV` Delivery Execution, `INB` Inbound Processing, `RLT`
Realtime Projection, `CFG` Configuration, `ARC` cross-cutting architecture.

Every ticket carries a **proof**: the test that fails if the change is undone.
"I looked at it" is not one (CLAUDE.md §7).

---

## Already true, and not re-ticketed

These were landed in the passes preceding this plan. They are listed so nobody
re-opens them, and because later tickets build on them.

- One definition of the suppression rule: `isUnsendable` in
  `packages/db/src/suppression.ts`, called by materialisation, the batch claim,
  and `assertNotSuppressed`.
- Monotonic delivery state: status ladders generated from
  `packages/shared/src/delivery-status.ts`, plus the event ladder
  `eventAdvances` ANDed with them. `outbound_messages.last_event` is single-
  dialect under `outbound_last_event_bare`.
- Idempotent sends on both one-to-one paths through `upsertKeyedDraft` in
  `apps/web/src/lib/queries/outbound.ts`, arbitrated by the unique index on
  `client_key`.
- Thread mutations resolve their key inside the write; `getThread` is three
  round trips.

---

## Sprint 1 — Context codification and the Identity gate

Exit criteria: every send-capable surface calls one policy gate; every
flow-critical route, action and job has a named context owner in
`ARCHITECTURE.md`; refusals are queryable.

### S1-ARC-1 · Bounded contexts section and ADR
**Files:** `docs/ARCHITECTURE.md` (new section before "Why Server-Sent Events").
**Do:** Ownership matrix — context → owning code → aggregate → invariants →
proving tests — for all eight contexts. ADR: what was decided, the three
alternatives rejected (rewrite, one package per context, outbox), consequences.
**Accept:** Every file in `apps/web/src/actions/`, `apps/web/src/app/api/**/route.ts`
and `packages/jobs/src/functions/` appears in exactly one row.
**Proof:** Documentation; reviewed against the inventory in this ticket.

### S1-IDN-1 · `policy_decisions` table
**Files:** `packages/db/src/schema/policy.ts` (new), `packages/db/src/schema/index.ts`,
migration `0020_policy_decisions.sql` (generated).
**Do:** Append-only record of **refusals** only — `policy`, `surface`,
`subject_user_id` (`ON DELETE SET NULL`), `reason`, `created_at`. Indexes on
`created_at` and `subject_user_id`.
**Why refusals only:** allows are every send; recording them is an unbounded
write on the hot path for no question anyone asks.
**Accept:** `pnpm db:generate` reports no further changes after the migration
is committed.
**Proof:** S1-TST-1 asserts one row per refusal and zero per allow.

### S1-IDN-2 · `assertCanSend` policy gate
**Files:** `packages/auth/src/policy.ts` (new), `packages/auth/src/index.ts`.
**Do:** `assertCanSend(session, surface)` returns `null` when allowed and
`{ ok: false, error }` when refused — the same shape as
`blockedFromSending()` in `actions/campaigns.ts`, so the two compose with `??`
rather than stacking a second `if`. The policy value is the exported constant
`SEND_VERIFICATION_POLICY = "unenforced"`. A refusal writes one
`policy_decisions` row before returning.
**Accept:** The gate is the *only* place `user.emailVerified` is read for a
send decision.
**Proof:** S1-TST-1.

### S1-IDN-3 · Gate every send-capable surface
**Files:** `apps/web/src/actions/compose.ts` (`sendSingleEmail`),
`apps/web/src/actions/thread.ts` (`sendMessage`),
`apps/web/src/actions/campaigns.ts` (`sendCampaignNow`, `scheduleCampaign`).
**Do:** Call the gate immediately after `requireSession()`. The compose API
route delegates to `sendSingleEmail`, so it is covered without a fifth call.
**Accept:** `grep -rn "assertCanSend"` lists exactly these four call sites plus
the definition.
**Proof:** S1-TST-1's refusal test exercises the gate through `sendMessage`.

### S1-TST-1 · Gate tests
**Files:** `packages/auth/src/policy.test.ts` (new),
`apps/web/src/actions/policy-gate.integration.test.ts` (new).
**Do:** Unit: under `"unenforced"` every session passes; under `"enforced"` an
unverified session is refused and a verified one passes. Integration: a refusal
through `sendMessage` writes exactly one `policy_decisions` row and calls the
provider zero times; an allow writes none. Break-test by inverting the policy
comparison.
**Proof:** This is the proof.

---

## Sprint 2 — Invariant centralisation (Phase 2)

Exit criteria: no invariant has two implementations across actions and jobs.

### S2-DLV-1 · One send pipeline
**Files:** `apps/web/src/actions/compose.ts`, `apps/web/src/actions/thread.ts`,
new `apps/web/src/lib/send/one-to-one.ts`.
**Do:** Message build, suppression check, sender parse, claim, provider send,
record — once. Both actions become thin callers. Declined once as too risky in
isolation; it is Sprint 2's centrepiece *because* S1 has landed the shared upsert
and both replay tests, which are the regression net.
**Accept:** `compose.replay.integration.test.ts` and
`thread.reply-replay.integration.test.ts` pass unchanged.
**Proof:** Those two suites.

### S2-SUP-1 · Suppression service façade
**Files:** `apps/web/src/lib/queries/suppressions.ts`, `packages/jobs/src/functions/queue-campaign.ts`,
`packages/jobs/src/functions/send-campaign.ts`.
**Do:** The three call sites of `isUnsendable` and `assertNotSuppressed` go
through one exported service (`Suppression.assertSendable`) so the *policy*
(normalise, check, explain) is one function and `isUnsendable` stays the SQL.
**Proof:** `suppressions.integration.test.ts` capitalisation case, unchanged.

### S2-AUD-1 · Attachment-before-typing writes the wrong kind
**Files:** `apps/web/src/actions/attachments.ts`.
**Do:** A draft created by attaching inside a reply thread is `kind: 'compose'`
with no `in_reply_to_id`; attach-then-close leaves it detached in Drafts. Take
the thread's kind and parent at creation.
**Proof:** New integration test: attach in a reply thread, close, assert the
draft row carries `kind = 'reply'` and the parent id.

### S2-CFG-1 · `nameField` docstring disagrees with the code
**Files:** `packages/shared/src/schemas.ts`, `apps/web/src/actions/setup.ts`,
`apps/web/src/actions/settings.ts`.
**Do:** `nameField` claims title-casing it does not do; `normalizeName` is
applied in the actions. Fold it into the field or correct the claim — one rule.
**Proof:** `sender-config.test.ts` gains a case-normalisation assertion.

### S2-CFG-2 · One `absoluteUrl`
**Files:** `apps/web/src/actions/attachments.ts`, `packages/email/src/unsubscribe.ts`,
anywhere else `appUrl.replace(/\/$/, "")` appears.
**Proof:** Unit test over trailing-slash variants.

---

## Sprint 3 — Auth policy unification (Phase 3)

Blocked on a product decision: the gate is unenforced by choice. These tickets
make enforcement a settings toggle rather than a code edit, when wanted.

### S3-IDN-1 · Settings-backed verification policy
**Files:** `packages/db/src/schema/settings.ts` (+ migration), `packages/config/src/config.ts`,
`packages/auth/src/policy.ts`, `apps/web/src/components/settings/sections.tsx`.
**Do:** `app_settings.require_verified_sender` replaces the constant. Default
`false`, so upgrading changes nothing.
**Proof:** S1-TST-1 extended to read the policy from config.

### S3-IDN-2 · Verification resend from the refusal
**Files:** `apps/web/src/components/compose/compose-dialog.tsx`,
`apps/web/src/components/inbox/composer.tsx`.
**Do:** A refusal's toast offers "Resend verification email". Without it the
enforced policy is a dead end.
**Proof:** Component test on the toast action.

---

## Sprint 4 — Event boundary hardening (Phase 4)

### S4-RLT-1 · Contract tests for the realtime schema
**Files:** `packages/shared/src/realtime.contract.test.ts` (new).
**Do:** Every publisher payload in `apps/web` and `packages/jobs` is parsed by
`realtimeEventSchema` at test time; a fixture per event type.
**Proof:** Removing a field from a publisher fails the test.

### S4-INB-1 · Jobs event payload schemas
**Files:** `packages/jobs/src/client.ts`, `packages/shared/src/jobs.ts` (new).
**Do:** Inngest event payloads validated with Zod at send *and* receive, from
one schema in `shared`.
**Proof:** Replay test with a malformed payload is rejected at receive.

### S4-RLT-2 · `clearFresh` has no caller
**Files:** `apps/web/src/stores/realtime-store.ts`, `apps/web/src/components/inbox/thread-list.tsx`.
**Do:** Either wire it when the list has rendered arrivals, or delete it.
**Proof:** Store test updated to whichever is chosen.

---

## Sprint 5 — Architecture release gate (Phase 5)

### S5-ARC-1 · PR checklist
**Files:** `CONTRIBUTING.md`, `.github/pull_request_template.md` (new).
**Do:** Required fields: flow touched (outbound / inbound / config), context
owner from the matrix, invariants verified, proof tests named.

### S5-ARC-2 · Contract cross-links
**Files:** `README.md` § Contributor architecture contract, `CONTRIBUTORS.md`.
**Do:** Link the ownership matrix; state that a new flow-critical file must add
a matrix row in the same PR.

### S5-ARC-3 · Architecture test
**Files:** `test/architecture.test.ts` (new).
**Do:** Static check that every file under `apps/web/src/actions`,
`apps/web/src/app/api/**/route.ts` and `packages/jobs/src/functions` is named
in the matrix. A new surface without an owner fails CI.
**Proof:** Add a file, watch it fail.
