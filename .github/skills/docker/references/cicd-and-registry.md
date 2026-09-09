# CI/CD and Registry Workflows

## Pipeline Stages

1. Build image
2. Run tests (inside image or ephemeral container)
3. Scan image
4. Push to registry
5. Deploy by immutable tag

## GitHub Actions Pattern

```yaml
name: docker-build
on: [push, pull_request]

jobs:
    build:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@<pin>
            - uses: docker/setup-buildx-action@<pin>
            - uses: docker/login-action@<pin>
            - uses: docker/build-push-action@<pin>
              with:
                  context: .
                  push: false
```

## Tagging Strategy

- Use immutable tags for deployment: commit SHA or release version.
- Keep `latest` only as a convenience tag.
- Avoid deploying mutable tags in production.

## Registry Notes

- GHCR: `ghcr.io/<org>/<repo>:<tag>`
- Artifact Registry: `<region>-docker.pkg.dev/<project>/<repo>/<image>:<tag>`
