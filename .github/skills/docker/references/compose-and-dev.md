# Compose and Local Development

## Baseline Compose Stack

```yaml
services:
    app:
        build: .
        ports:
            - "3000:3000"
        volumes:
            - ./:/app
            - /app/node_modules
        environment:
            - NODE_ENV=development
        depends_on:
            db:
                condition: service_healthy

    db:
        image: postgres:16-alpine
        environment:
            POSTGRES_DB: app
            POSTGRES_PASSWORD: postgres
        healthcheck:
            test: ["CMD-SHELL", "pg_isready -U postgres"]
            interval: 10s
            timeout: 5s
            retries: 5
```

## Commands

```bash
docker compose up --build
docker compose up -d
docker compose logs -f app
docker compose exec app sh
docker compose down
```

## Dev Workflow Tips

- Use bind mounts for source during development.
- Keep dependency directories in container-managed volumes.
- Add health checks for databases and queues to reduce startup race conditions.
- Keep local secrets in `.env.local` and `.env.docker.local` (gitignored).
