---
name: typescript-core
description: TypeScript core patterns for strict typing and maintainable contracts. Use when applying advanced types, tsconfig hardening, and runtime validation boundaries.
---

# TypeScript Core

Use this skill for type-safe architecture and maintainable type systems.

## When to Use This Skill

- Hardening type safety in shared code.
- Designing advanced generic or utility types.
- Aligning compile-time and runtime contracts.
- Resolving TypeScript inference or config issues.

## Quick Start

1. Enable strict compiler options appropriate for the codebase.
2. Replace unsafe `any` boundaries with explicit contracts.
3. Pair runtime validation with inferred types where needed.

## Step-by-Step Workflows

### Add Types

1. Define domain models and boundary types.
2. Use utility types or generics for reuse.
3. Validate consumers and edge cases.

### Resolve Type Defect

1. Reproduce the failing type scenario.
2. Narrow types and remove ambiguous unions.
3. Confirm no downstream breakages.

## Gotchas

- Do not use `any` as a shortcut across public boundaries.
- Do not rely on inferred behavior without tests in critical paths.
- Do not ignore runtime validation where external payloads are involved.

## References

- [Full Guide](./references/full-guide.md)
