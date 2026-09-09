---
name: tanstack-query
description: TanStack Query server-state skill. Use when defining query keys, mutations, cache invalidation, optimistic updates, and async request lifecycle behavior.
---

# TanStack Query

Use this skill for predictable server-state fetching and mutation workflows.

## When to Use This Skill

- Building query hooks and cache strategies.
- Implementing mutations and optimistic updates.
- Resolving stale or inconsistent server-state behavior.

## Quick Start

1. Define stable query keys with relevant params.
2. Centralize fetch/mutation boundaries.
3. Invalidate or update cache deliberately after mutations.

## Step-by-Step Workflows

### Add Query

1. Define query key and fetcher contract.
2. Configure stale and retry behavior.
3. Validate loading, success, and error states.

### Add Mutation

1. Define mutation input/output contract.
2. Apply optimistic UI if safe.
3. Invalidate and reconcile related queries.

## Gotchas

- Do not use unstable query keys.
- Do not over-invalidate unrelated cache branches.
- Do not skip error and rollback handling for optimistic updates.

## References

- [Full Guide](./references/full-guide.md)
