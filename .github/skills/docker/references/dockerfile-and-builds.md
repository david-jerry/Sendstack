# Dockerfile and Multi-stage Patterns

## Build Cache Ordering

Place stable steps before frequently changing steps:

1. Base image and system dependencies
2. Package manager lockfiles
3. Dependency install
4. Application source code

```dockerfile
FROM node:22-alpine AS base
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
```

## Multi-stage Build Pattern

Use a build stage and a runtime stage to reduce image size and attack surface.

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

## .dockerignore Essentials

```text
node_modules/
.git/
.env*
dist/
build/
coverage/
.next/cache/
```

## Build Diagnostics

```bash
docker build --progress=plain -t app:debug .
docker build --no-cache -t app:clean .
docker history app:debug
```
