# Debugging and Troubleshooting

## First-response Commands

```bash
docker ps -a
docker logs <container>
docker inspect <container>
docker stats --no-stream
```

## Common Failures

### Container exits on startup

- Check entrypoint/CMD and startup command arguments.
- Verify required environment variables are set.
- Inspect exit code:

```bash
docker inspect -f '{{.State.ExitCode}}' <container>
```

### Port conflicts

```bash
lsof -i :3000
# or
ss -lntp | grep 3000
```

### Build failures

- Rebuild with plain logs.
- Test intermediate stage.

```bash
docker build --progress=plain --target builder .
```

### Permission denied

- Verify runtime UID/GID and ownership of mounted paths.
- Use `--user` or fix `chown` in image build.

### No space left on device

```bash
docker system prune -a --volumes
docker system df
```
