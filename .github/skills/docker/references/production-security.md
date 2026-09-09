# Production Hardening and Security

## Runtime Hardening Checklist

- Run as non-root user.
- Use pinned base image tags.
- Add health check.
- Set resource limits.
- Keep filesystem read-only where possible.
- Remove build tools from final image.

## Example Runtime Stage

```dockerfile
FROM python:3.11-slim
WORKDIR /app
RUN groupadd -r app && useradd -r -g app app
COPY --chown=app:app . .
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD curl -f http://localhost:8000/health || exit 1
CMD ["python", "run_api_server.py"]
```

## Secrets

- Do not bake secrets into images.
- Prefer runtime environment variables or secret managers.
- Avoid committing `.env.production`.

## Resource Limits

```yaml
services:
    app:
        deploy:
            resources:
                limits:
                    cpus: "1.0"
                    memory: 512M
```
