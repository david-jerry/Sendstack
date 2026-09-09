---
name: frontend-qa-suite
description: Frontend QA skill for unit, integration, and E2E validation. Use when adding tests for behavior changes and preventing regressions.
---

# Frontend QA Suite

Use this skill to design and implement test coverage for frontend changes.

## When to Use This Skill

- Adding tests for new features.
- Strengthening regression protection after bug fixes.
- Defining acceptance checks for route-level behavior.
- Balancing unit/integration/E2E coverage.

## Quick Start

1. Define expected user-visible behavior.
2. Choose test layer based on risk and scope.
3. Implement deterministic assertions.

## Step-by-Step Workflows

### Add Coverage

1. Write tests around changed behavior and edges.
2. Validate selectors and async waiting strategy.
3. Confirm local and CI consistency.

### Investigate Flakes

1. Reproduce under repeated runs.
2. Remove timing and shared-state coupling.
3. Add stable waits and deterministic fixtures.

## Gotchas

- Do not rely on arbitrary sleeps.
- Do not assert implementation details over user behavior.
- Do not overuse E2E when unit/integration tests are sufficient.

## References

- [Full Guide](./references/full-guide.md)
