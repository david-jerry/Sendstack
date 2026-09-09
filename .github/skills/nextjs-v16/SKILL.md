---
name: nextjs-v16
description: Next.js 16 migration and implementation skill. Use when updating async request APIs, cache behavior, route boundaries, and metadata patterns.
---

# Next.js v16

Use this skill when implementing or migrating Next.js 16 behavior safely.

## When to Use This Skill

- Migrating to async request API usage.
- Updating cache and revalidation patterns.
- Adjusting route metadata and app-router conventions.
- Resolving version-upgrade regressions.

## Quick Start

1. Identify APIs and patterns changed by v16.
2. Update route, cache, and metadata behavior.
3. Validate app-router behavior and performance.

## Step-by-Step Workflows

### Migration Pass

1. Update request APIs and route code paths.
2. Update caching and invalidation semantics.
3. Validate rendering and navigation outputs.

### Regression Pass

1. Test critical routes and actions.
2. Verify metadata and SEO output.
3. Verify hydration and runtime boundaries.

## Gotchas

- Do not keep sync assumptions where async behavior is required.
- Do not migrate cache behavior without revalidation checks.
- Do not skip route-level regression testing after upgrade.

## References

- [Full Guide](./references/full-guide.md)
- [Migration checklist](./references/migration-checklist.md)
- [Cache components](./references/cache-components.md)
- [Turbopack notes](./references/turbopack.md)
