---
name: Frontend Next Boundaries
description: Enforce explicit client/server boundaries and quality checks in Next.js.
applyTo: "src/**/*.ts,src/**/*.tsx"
---

# Frontend Next Boundaries

- Keep Server and Client Component boundaries explicit and intentional.
- Avoid browser-only APIs in server paths.
- Keep server-side mutation logic in server actions when cookies/secrets are involved.
- Validate changes with `pnpm lint` and `pnpm build` before completion.
- Avoid adding dependencies unless explicitly needed.
