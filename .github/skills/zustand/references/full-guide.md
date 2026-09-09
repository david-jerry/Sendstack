# Zustand Full Guide

Use this guide for predictable client-state architecture.

## Scope

- Store shape and action design
- Selector and subscription performance
- Hydration and persistence concerns
- State bug debugging patterns

## Core Playbook

1. Model minimal store and actions.
2. Use narrow selectors to reduce re-renders.
3. Separate local state from server-state cache.
4. Verify transitions with targeted tests.
