---
name: better-auth-core
description: Better Auth core setup skill for TypeScript apps. Use when configuring auth instance wiring, session APIs, and client/server boundaries.
---

# Better Auth Core

Use this skill for foundational Better Auth setup and architecture decisions.

## When to Use This Skill

- Bootstrapping Better Auth in a new project.
- Structuring auth server/client responsibilities.
- Defining session retrieval and guard patterns.
- Standardizing auth configuration across environments.

## Quick Start

1. Create the server auth instance with stable environment config.
2. Initialize client-side auth helpers.
3. Validate session usage at route and component boundaries.

## Step-by-Step Workflows

### Initial Setup

1. Configure provider keys and core options.
2. Register handlers in framework entry points.
3. Verify sign-in, sign-out, and session lookup.

### Core Hardening

1. Keep secrets server-only.
2. Standardize error handling.
3. Add integration tests for auth boundaries.

## Gotchas

- Do not duplicate auth instance creation across modules.
- Do not read private env vars from client code.
- Do not skip session validation at protected boundaries.

## References

- [Full Guide](./references/full-guide.md)
- [Database setup](./references/setup-database.md)
- [Client/server guide](./references/client-server.md)
- [TypeScript notes](./references/typescript.md)
