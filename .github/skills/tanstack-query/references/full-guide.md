# TanStack Query Full Guide

Use this guide for server-state architecture and cache correctness.

## Scope

- Query key design
- Mutation and optimistic updates
- Invalidation and cache reconciliation
- Error and retry behavior

## Core Playbook

1. Define stable query keys.
2. Implement robust fetch/mutation contracts.
3. Apply precise cache invalidation.
4. Handle optimistic rollback and error paths.
