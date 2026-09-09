---
name: zustand
description: Zustand state management skill for frontend client state boundaries. Use when designing stores, selectors, and predictable local/global state flows.
---

# Zustand

Use this skill for lightweight, explicit client-state management.

## When to Use This Skill

- Creating shared client-state stores.
- Refactoring prop drilling into store selectors.
- Debugging stale or inconsistent local state behavior.

## Quick Start

1. Define minimal store shape and actions.
2. Use selectors to avoid broad re-renders.
3. Keep server-state in query/cache tools, not local store.

## Step-by-Step Workflows

### Add Store

1. Define state, actions, and reset behavior.
2. Use typed selectors in components.
3. Validate update and hydration behavior.

### Fix State Defect

1. Reproduce stale or racing updates.
2. Isolate action logic and subscription scope.
3. Apply targeted state transition fixes.

## Gotchas

- Do not put server-state cache data in Zustand by default.
- Do not subscribe whole components to entire store when selector suffices.
- Do not mutate state objects directly.

## References

- [Full Guide](./references/full-guide.md)
