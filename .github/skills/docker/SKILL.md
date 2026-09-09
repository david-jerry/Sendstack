---
name: docker
description: Docker containerization skill for build, runtime, Compose, and production hardening patterns. Use when creating or reviewing Dockerfiles, docker-compose stacks, image optimization, or container troubleshooting.
---

# Docker Containerization

Use this skill when creating or reviewing Dockerfiles, Compose stacks, image build pipelines, or production runtime hardening.

## When to Use This Skill

- User asks to create or optimize a Dockerfile.
- User needs `docker-compose` setup for local development.
- User reports container runtime issues (startup, networking, permissions, health checks).
- User asks for production-ready container hardening or CI/CD container workflows.

## Quick Start

1. Start from a minimal pinned base image and set a working directory.
2. Copy lockfiles first and install dependencies to maximize layer cache reuse.
3. Copy application source and define startup command.
4. Add `.dockerignore`, healthcheck, and non-root runtime user.

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

## Step-by-Step Workflows

### Build a Production Image

1. Use multi-stage builds to separate build tooling from runtime.
2. Keep dependency install steps before source copy.
3. Drop root privileges in the final stage.
4. Run container smoke tests before publishing.

### Build Local Development Stack

1. Create `docker-compose.yml` services for app and required dependencies.
2. Use bind mounts for fast local iteration.
3. Add `depends_on` and health checks for service ordering.
4. Use env files for local config, never commit secrets.

### Triage Container Failures

1. Inspect logs and exit code.
2. Enter the container for local diagnostics.
3. Validate health check endpoint and network connectivity.
4. Rebuild with plain progress and no cache when needed.

## Gotchas

- **Do not combine** `user-invocable: false` and `disable-model-invocation: true` unless you intentionally want the skill disabled.
- **Do not copy source before dependency install** in Dockerfile if you care about build cache performance.
- **Do not run production containers as root** unless there is a clear runtime requirement.
- **Do not store secrets in image layers** via `ENV` or copied files.

## Troubleshooting

| Issue                              | Solution                                                           |
| ---------------------------------- | ------------------------------------------------------------------ |
| Port already in use                | Map a different host port, or stop the conflicting process.        |
| Container exits immediately        | Check `docker logs`, inspect exit code, and verify entrypoint/CMD. |
| Slow builds                        | Reorder Dockerfile layers, add `.dockerignore`, and use BuildKit.  |
| Permission denied in mounted paths | Align UID/GID, run as non-root, and fix ownership in image.        |
| Cannot connect to Docker daemon    | Ensure daemon is running and user has Docker group permissions.    |

## References

- [Dockerfile and Multi-stage Patterns](./references/dockerfile-and-builds.md)
- [Compose and Local Development](./references/compose-and-dev.md)
- [Production Hardening and Security](./references/production-security.md)
- [CI/CD and Registry Workflows](./references/cicd-and-registry.md)
- [Debugging and Troubleshooting](./references/debugging-and-troubleshooting.md)
- [Quick Command Reference](./references/quick-reference.md)
