---
name: playwright
description: Playwright E2E testing skill for browser workflows. Use when validating route-level behavior, UI interactions, and integration flows.
---

# Playwright

Use this skill for browser-level test automation and regression coverage.

## When to Use This Skill

- Adding E2E coverage for user journeys.
- Reproducing UI regressions in real browser context.
- Validating critical navigation and form flows.

## Quick Start

1. Define scenario from user perspective.
2. Use resilient role-based locators.
3. Assert deterministic outcomes and URLs.

## Step-by-Step Workflows

### Create New Flow Test

1. Set up route and fixture state.
2. Perform user interactions in clear steps.
3. Assert visible outcomes and transitions.

### Stabilize Failing Test

1. Remove fixed delays.
2. Use web-first assertions.
3. Isolate flaky dependencies and test data.

## Gotchas

- Do not use brittle selectors tied to implementation internals.
- Do not depend on static waits for async UI state.
- Do not bundle too many independent assertions in one long scenario.

## References

- [Full Guide](./references/full-guide.md)
