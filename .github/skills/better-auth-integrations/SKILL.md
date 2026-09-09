---
name: better-auth-integrations
description: Better Auth integration patterns across frameworks. Use when wiring Better Auth into Next.js and related framework routes, handlers, and middleware.
---

# Better Auth Integrations

Use this skill when integrating Better Auth into framework-specific request/response lifecycles.

## When to Use This Skill

- Connecting Better Auth to Next.js route handlers.
- Aligning auth middleware/proxy behavior.
- Integrating auth in server actions and API routes.
- Resolving integration edge cases between framework and auth runtime.

## Quick Start

1. Register Better Auth handlers at framework boundary points.
2. Ensure cookies/session behavior matches framework runtime.
3. Validate redirects and protected route behavior.

## Step-by-Step Workflows

### Add Integration

1. Wire auth handlers.
2. Protect routes consistently.
3. Test callback and logout flows.

### Fix Integration Defect

1. Reproduce issue with minimal flow.
2. Inspect request context and cookie propagation.
3. Apply framework-specific correction and retest.

## Gotchas

- Do not mix incompatible runtime assumptions across edge/node contexts.
- Do not bypass framework-native redirect/error handling.
- Do not duplicate auth wrappers around the same route.

## References

- [Full Guide](./references/full-guide.md)
- [Next.js integration](./references/nextjs.md)
- [Framework integrations](./references/frameworks.md)
