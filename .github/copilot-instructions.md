# Sendstack Copilot Engineering Instruction

## Mission

Deliver production-safe code that matches product intent, preserves architecture boundaries, and avoids regressions.

## Mandatory Preflight (No Exceptions)

1. Read PRODUCT.md before any non-trivial implementation, refactor, or review.
2. Read docs/ARCHITECTURE.md when work touches data flow, sending, webhooks, realtime, jobs, or caching.
3. Read the nearest module contracts before changing code:
    - apps/web/src/actions/\* for UI-to-server boundaries
    - packages/shared/src/\* for payload and schema contracts
    - packages/db/src/schema/\* for data model constraints
    - packages/email/src/\* for provider and webhook behavior
    - packages/redis/src/_ and apps/web/src/app/api/realtime/_ for realtime fan-out
4. If context is missing or contradictory, stop and ask targeted clarification questions before coding.

## Mandatory Clarification Gate

Before implementation, ask concise questions that establish scope and architecture path:

1. Are we extending an existing package or creating a new package?
2. Is this request changing mail send, inbound processing, or realtime response behavior?
3. What compatibility constraints are non-negotiable (API shape, schema, UX flow, event payload)?
4. What scale target should this handle (expected records, events, and request volume)?

Do not proceed with assumptions when answers are required for correctness.

## Anti-Drift Rules

1. Do not invent features not stated in PRODUCT.md, active issues, or accepted requirements.
2. Preserve canonical architecture boundaries:
    - Client components call Server Actions or API routes, never service providers directly.
    - Postgres is the source of truth. Realtime is a latency optimization.
    - Shared schemas from packages/shared are the contract authority.
3. Do not replace existing operational patterns unless explicitly requested and justified.
4. Keep behavior stable unless change is intentional, reviewed, and tested.

## Zero-Duplication Policy

1. Reuse existing utilities and package interfaces before introducing new abstractions.
2. Keep one canonical implementation per responsibility (normalization, dedupe, payload parsing, state transition rules).
3. Do not duplicate schema definitions or contract types across packages.
4. Prevent duplicate processing in critical paths:
    - Outbound sends must preserve idempotency keys and safe claim semantics.
    - Webhook processing must preserve event deduplication and monotonic status transitions.

## Zero N+1 Policy

1. Never issue per-row database queries in loops for list, campaign, contact, or inbox workloads.
2. Use set-based access patterns (JOIN, IN, GROUP BY, batched reads) and bulk writes where possible.
3. For any endpoint/action returning collections, keep DB round-trips effectively constant with respect to list size.
4. Add or update tests for changed data paths to protect against accidental N+1 regressions.

## Realtime Mailer Professionalism Gate

When work touches inbound/outbound/realtime behavior, verify all of the following:

1. Delivery semantics are explicit (at-least-once inbound events, idempotent outbound execution).
2. Dedupe strategy is explicit and enforced at storage and processing boundaries.
3. Event ordering and state transitions are monotonic and safe under retries.
4. Degraded mode is defined (for example when Redis is unavailable).
5. UI truth model is explicit: optimistic update plus authoritative refresh from Postgres.

## Agent Handoff Contract

When handing work to another agent, produce a handoff packet in markdown with:

1. Objective and acceptance criteria.
2. Completed work with changed files and rationale.
3. Decisions made and constraints discovered.
4. Open risks, blockers, and unresolved questions.
5. Exact next implementation steps.
6. Verification evidence (tests run, lint/typecheck status, known gaps).

The receiving agent must continue from this packet, not restart analysis from scratch.

## Azure Well-Architected Framework (WAF) Coding Gate

For non-trivial changes, evaluate design and implementation against all pillars:

1. Reliability: retries, idempotency, safe state transitions, failure recovery.
2. Security: secret handling, input validation, authz/authn boundaries, webhook signature checks.
3. Performance Efficiency: query shape, N+1 prevention, cache and transport efficiency.
4. Cost Optimization: avoid unnecessary provider calls, duplicate jobs, and wasteful background work.
5. Operational Excellence: observability, actionable logs, deterministic runbooks, testability.

If a change weakens a pillar, include mitigation or reject the approach.

## Definition of Done

1. Context loaded (PRODUCT.md plus relevant architecture/module docs).
2. Clarification gate completed for scope and realtime impact.
3. No duplication introduced in logic, schema, or contracts.
4. No N+1 pattern introduced in changed paths.
5. Tests updated for behavior and regression coverage.
6. Handoff packet produced when another agent will continue the work.
7. WAF review completed with explicit tradeoffs if any.
