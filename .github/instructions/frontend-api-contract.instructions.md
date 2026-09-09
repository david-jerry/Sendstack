---
name: Frontend API Contract Rules
description: Keep API usage centralized and contracts synchronized with backend schemas.
applyTo: "lib/api.ts,types/api.ts,hooks/**/*.ts,actions/**/*.ts,components/**/*.tsx"
---

# Frontend API Contract Rules

- Ask clarifying question(s) before implementation if contract details are incomplete.
- Keep application API calls centralized through existing API client helpers.
- Do not introduce direct API fetch paths when helper abstractions already exist.
- Keep `types/api.ts` aligned with backend field and payload contracts.
- Keep query key structure stable and include relevant filter/pagination parameters.
- Keep mutation flows in server actions when server context/cookies are required.
- Place server actions per feature at `actions/<domain>/server.ts`.
- Keep backend network calls out of client components and client hooks; call server actions instead.
