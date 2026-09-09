---
name: Backend Monorepo Placement Rules
description: Enforce creating backend services inside this monorepo and reusing established architecture boundaries.
applyTo: "**/*.py,**/pyproject.toml,**/requirements*.txt,**/Dockerfile,**/Dockerfile.*,**/*.dockerfile"
---

# Backend Monorepo Placement Rules

## Mandatory Placement

- Create all new backend projects inside this repository.
- Do not create backend source in external directories.
- Place backend apps under apps, for example apps/backend-wallet.

## Boundary Rules

- Keep domain logic in service layer.
- Keep persistence in repository layer.
- Keep transport validation in route/schema layer.

## Frontend Integration Rules

- Next.js client components must not call backend endpoints directly.
- Backend-bound UI flows must go through Server Actions.

## Reuse Rules

- Reuse existing shared packages for contracts and data shapes.
- Prefer extending current apps and packages over creating parallel external repos.

## Quality Rules

- Add tests in top-level tests folders by level:
    - tests/unit
    - tests/integration
    - tests/contract
    - tests/e2e
- Add or update API contract documentation when backend APIs change.
