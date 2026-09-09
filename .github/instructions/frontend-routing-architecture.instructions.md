---
name: Frontend Routing Architecture
description: Enforce App Router route-group structure and component placement conventions.
applyTo: "app/**/*.ts,app/**/*.tsx,components/**/*.ts,components/**/*.tsx"
---

# Frontend Routing Architecture

- Respect route groups and layout boundaries under `app/`.
- Keep marketing sections in `components/sections/` unless reused across route groups.
- Keep shared cross-group components in `components/common/`.
- Avoid moving components across layers without a clear reuse reason.
