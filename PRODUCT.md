# PRODUCT

## Product Summary

Sendstack is an open-source bulk email platform for sending campaigns and handling inbound replies in the same app with realtime updates.

## Primary Outcomes

1. Send campaigns safely at scale with no duplicate sends.
2. Enforce suppressions and unsubscribe behavior consistently.
3. Show inbound activity quickly through realtime updates while keeping database state authoritative.
4. Keep setup and operations practical for self-hosting.

## Core Flows

### Outbound Campaign Flow

1. User creates or schedules a campaign.
2. System materializes recipient rows.
3. Suppressed and inactive contacts are marked, not silently dropped.
4. Worker claims pending recipients in safe batches.
5. Provider send uses idempotency keys.
6. Recipient statuses and campaign counters are updated.

### Inbound Reply Flow

1. Provider posts webhook events.
2. System verifies signatures and deduplicates events.
3. Metadata row is persisted immediately.
4. Realtime event is published.
5. Full message content is fetched asynchronously and persisted.
6. UI refreshes to authoritative state from Postgres.

## Non-Negotiable Invariants

1. Postgres is the source of truth.
2. Realtime is a latency optimization, not a correctness dependency.
3. Sending must remain idempotent and duplicate-safe.
4. Webhook handling must tolerate at-least-once delivery and retries.
5. Suppression checks must be enforced on every send path.
6. Email addresses are normalized at ingestion boundaries.
7. Inbound HTML is not rendered as trusted app content.

## Architecture Boundaries

1. Client components do not call providers directly.
2. Client behavior routes through Server Actions or API endpoints.
3. Shared runtime contracts live in packages/shared.
4. Data model constraints are enforced in packages/db schema and migrations.
5. Provider integrations remain encapsulated in packages/email, packages/redis, packages/jobs, and packages/auth.

## Realtime Contract Expectations

1. Events are schema-validated.
2. Event consumers handle duplicates safely.
3. Event order is not assumed to be perfect.
4. Missing events must recover through authoritative data refresh.

## Performance and Correctness Rules

1. Avoid N+1 query patterns in all list and batch workflows.
2. Prefer set-based DB operations for materialization and state updates.
3. Keep status transitions monotonic when events arrive out of order.
4. Maintain observability for retries, failures, and dedupe outcomes.

## Security and Compliance Baseline

1. Secrets are never exposed to client code.
2. Stored secrets must remain encrypted at rest.
3. Webhook verification is mandatory before processing.
4. Input validation is required at all public boundaries.

## Current Product Scope

1. Campaigns, contacts/lists, suppressions, scheduling, unsubscribe.
2. Realtime inbox updates via SSE and Redis pub/sub.
3. Resend for outbound and inbound webhook-driven processing.
4. Self-hosted setup flow with runtime configuration.

## Out of Scope Unless Explicitly Requested

1. Silent architecture rewrites.
2. Replacing source-of-truth semantics with event-only state.
3. Direct client-to-provider credential usage.
4. New package creation where an existing package can be extended safely.
