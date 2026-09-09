---
name: frontend-core-types-data
description: Type and data-contract skill for frontend changes. Use when working with TypeScript strictness, schemas, API payload parsing, and cache invalidation safety.
---

# Frontend Core Types and Data

Use this skill for robust type and data-contract implementation.

## When to Use This Skill

- Hardening API request/response typing.
- Defining runtime validation boundaries.
- Managing cache key correctness and invalidation.
- Preventing state desynchronization from contract drift.

## Quick Start

1. Define authoritative schema/type source.
2. Validate at runtime on boundary crossings.
3. Align query keys and invalidation with payload shape.

## Step-by-Step Workflows

### Add New Contract

1. Define schema and inferred types.
2. Parse inbound/outbound payloads.
3. Add contract tests.

### Fix Contract Mismatch

1. Reproduce mismatch with sample payload.
2. Update schema/types and transforms.
3. Validate caches and consumers.

## Gotchas

- Do not trust external payloads without validation.
- Do not use broad `any` at API boundaries.
- Do not invalidate broad query groups without reason.

## References

- [Full Guide](./references/full-guide.md)
