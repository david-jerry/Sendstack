---
name: frontend-core-nextjs
description: Frontend core implementation skill for Next.js App Router. Use when adding or changing routes, layouts, server actions, metadata, and cache behavior.
---

# Frontend Core Next.js

Use this skill for architecture-safe Next.js App Router implementation.

## When to Use This Skill

- Adding routes, layouts, or route groups.
- Splitting server and client responsibilities.
- Implementing server actions and route handlers.
- Adjusting metadata and caching behavior.

## Quick Start

1. Identify route ownership and boundary type.
2. Implement with explicit server/client separation.
3. Validate cache and metadata behavior.

## Step-by-Step Workflows

### Build Route Feature

1. Add route structure and layout boundaries.
2. Implement data flow and mutation boundaries.
3. Validate rendering and navigation behavior.

### Correct Boundary Defect

1. Identify hydration or runtime mismatch.
2. Move code to correct server/client side.
3. Re-test interaction and data lifecycle.

## Gotchas

- Do not call backend services directly from client components.
- Do not blur server and client module boundaries.
- Do not rely on implicit cache behavior for critical paths.

## References

- [Full Guide](./references/full-guide.md)
