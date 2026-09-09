# Quick Command Reference

## Build and Run

```bash
docker build -t app:local .
docker run --rm -p 3000:3000 app:local
```

## Containers

```bash
docker ps
docker stop <container>
docker rm <container>
docker exec -it <container> sh
```

## Images

```bash
docker images
docker rmi <image>
docker pull <image>
docker push <image>
```

## Compose

```bash
docker compose up -d
docker compose logs -f
docker compose down
```

## Cleanup

```bash
docker image prune
docker container prune
docker volume prune
docker system prune -a
```
