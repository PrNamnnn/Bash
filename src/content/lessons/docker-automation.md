---
objectives:
  - Script Docker builds, runs and clean-ups with reproducible tags
  - Query containers with `--format` and `--filter` instead of parsing tables
  - Write correct container entrypoint scripts (`exec "$@"`, signals, configuration from the environment)
  - Wait for containers to become healthy before continuing
summary:
  - "Tag images with something traceable: `app:$(git rev-parse --short HEAD)` plus a moving tag like `latest` or `staging`."
  - "Machine-readable queries: `docker ps --filter name=api --format '{{.Names}} {{.Status}}'`, `docker inspect -f '{{.State.Health.Status}}' api`."
  - "Entrypoint scripts: `set -euo pipefail`, render config from env vars, then `exec \"$@\"` so the app becomes PID 1 and receives SIGTERM."
  - "Wait loops need a timeout: poll health every second, give up after N seconds with a non-zero exit."
  - "Clean up deliberately: `docker image prune -f --filter until=168h`, never blanket `docker system prune -a` on shared hosts."
related:
  - execution-model
  - ci-cd-scripts
  - deployment-scripts
---

## Builds with traceable tags

```bash
#!/usr/bin/env bash
set -euo pipefail
image=registry.example.com/shop/api
sha=$(git rev-parse --short HEAD)
docker build --pull -t "$image:$sha" -t "$image:latest" .
docker push "$image:$sha"
docker push "$image:latest"
echo "$image:$sha" > .last-image      # record exactly what was built
```

A content-addressed tag (commit SHA, or the image digest) lets you answer "what's running?" and roll back precisely. `latest` alone can't do either.

## Query, don't parse tables

`docker ps` output is a human table. Use Go templates and filters:

| Need | Command |
|---|---|
| names of running containers | `docker ps --format '{{.Names}}'` |
| containers from an image | `docker ps -q --filter ancestor=shop/api` |
| one container's state | `docker inspect -f '{{.State.Status}}' api` |
| health status | `docker inspect -f '{{.State.Health.Status}}' api` |
| IP address | `docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' api` |
| image of a container | `docker inspect -f '{{.Config.Image}}' api` |
| exit code | `docker inspect -f '{{.State.ExitCode}}' job` |
| JSON for jq | `docker inspect api \| jq '.[0].State'` |

```bash title="docker-ps.sh" playground
# Saved output of: docker ps --format '{{.Names}}|{{.Image}}|{{.Status}}'
ps_out() { cat <<'EOF'
shop-api-1|shop/api:4f2a9c1|Up 3 hours (healthy)
shop-web-1|shop/web:4f2a9c1|Up 3 hours (healthy)
shop-worker-1|shop/worker:1b7e0d3|Up 2 minutes (health: starting)
shop-db-1|postgres:16|Up 5 days (unhealthy)
EOF
}
while IFS='|' read -r name image status; do
  case $status in
    *'(healthy)'*)   state=OK ;;
    *starting*)      state=WAIT ;;
    *unhealthy*)     state=FAIL ;;
    *)               state=UNKNOWN ;;
  esac
  printf '%-5s %-14s %s\n' "$state" "$name" "${image##*:}"
done < <(ps_out)
```

## Entrypoint scripts

An image's entrypoint script prepares the container and then starts the main process:

```bash
#!/usr/bin/env bash
# docker-entrypoint.sh
set -euo pipefail

: "${APP_PORT:=8080}"
: "${DATABASE_URL:?DATABASE_URL must be set}"

# Render a config file from environment variables
cat > /app/config.json <<EOF
{ "port": $APP_PORT, "database": "$DATABASE_URL", "logLevel": "${LOG_LEVEL:-info}" }
EOF

# Optional one-off tasks
if [[ ${RUN_MIGRATIONS:-0} == 1 ]]; then
  /app/bin/migrate up
fi

exec "$@"          # replace the shell with CMD, e.g. ["node", "server.js"]
```

With `ENTRYPOINT ["/docker-entrypoint.sh"]` and `CMD ["node", "server.js"]`, Docker runs `docker-entrypoint.sh node server.js`. Without `exec`, Bash stays as PID 1, and `docker stop`'s SIGTERM goes to Bash — which doesn't forward it — so the app gets SIGKILLed after 10 seconds instead of shutting down cleanly.

Other rules for container scripts:

- Log to stdout/stderr (Docker collects them), not files.
- Read configuration from environment variables and mounted files.
- Use `#!/bin/sh` and POSIX syntax for Alpine/BusyBox images that don't include Bash.

## Waiting for health

```bash title="wait-healthy.sh" playground
# Simulated `docker inspect -f '{{.State.Health.Status}}' api`: healthy after 3 seconds.
# (It reads the caller's $waited; a counter incremented inside $( ) would be lost in the subshell.)
health_of() { (( waited >= 3 )) && echo healthy || echo starting; }

wait_healthy() {
  local name=$1 timeout=${2:-30} waited=0 status
  while (( waited < timeout )); do
    status=$(health_of "$name")
    case $status in
      healthy)   echo "$name healthy after ${waited}s"; return 0 ;;
      unhealthy) echo "$name unhealthy" >&2; return 1 ;;
    esac
    sleep 1
    (( ++waited ))
  done
  echo "$name not healthy after ${timeout}s" >&2
  return 1
}
wait_healthy api 10
```

`docker compose up --wait` does this for compose services that define healthchecks.

## Cleaning up

```bash
docker container prune -f                           # stopped containers
docker image prune -f                               # dangling images
docker image prune -af --filter "until=168h"        # unused images older than 7 days
docker volume ls -qf dangling=true                  # review before removing volumes!
docker system df                                    # what is using space
```

Volumes hold data — never prune them automatically unless you're certain.

## Common mistakes

```mistake
title: Entrypoint without exec
wrong: |
  #!/bin/sh
  envsubst < /tmpl.conf > /app.conf
  node server.js          # sh is PID 1; SIGTERM never reaches node
right: |
  #!/bin/sh
  envsubst < /tmpl.conf > /app.conf
  exec node server.js
why: exec replaces the shell so the application is PID 1 and receives signals directly.
```

```mistake
title: Fixed sleeps instead of health checks
wrong: |
  docker compose up -d && sleep 30 && ./run-tests.sh
right: |
  docker compose up -d --wait && ./run-tests.sh
why: A fixed sleep is too long when things are fast and too short when they're slow.
```

## Practice

```exercise
kind: mcq
difficulty: intermediate
prompt: "Why should a container entrypoint script end with `exec \"$@\"`?"
options:
  - It makes the image smaller
  - The application replaces the shell as PID 1 and receives signals like SIGTERM directly
  - Docker requires it
  - It runs the command in the background
answer: 1
explanation: Otherwise the shell receives the signals and the app is killed abruptly after the timeout.
```

```exercise
kind: mcq
difficulty: beginner
prompt: How do you print only the names of running containers in a script?
options:
  - "`docker ps | awk '{print $NF}'`"
  - "`docker ps --format '{{.Names}}'`"
  - "`docker ls`"
  - "`docker ps -a`"
answer: 1
explanation: Go templates give exactly the field you ask for, without parsing a table.
```

```exercise
kind: command
difficulty: intermediate
prompt: "Given `img=registry.example.com/shop/api:4f2a9c1`, print the repository part (`registry.example.com/shop/api`) and the tag (`4f2a9c1`) on two lines using parameter expansion."
solution: img=registry.example.com/shop/api:4f2a9c1; echo "${img%:*}"; echo "${img##*:}"
explanation: "`%:*` removes the shortest `:…` suffix; `##*:` keeps what follows the last colon. (Registries with ports, like host:5000/app, need more care.)"
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Image cleanup plan
prompt: "From the saved `docker images --format '{{.Repository}}:{{.Tag}} {{.CreatedSince}}'` output, plan a cleanup: keep the 2 newest tags per repository (lines are already newest-first per repo) and print `remove IMAGE` for the rest, then `N image(s) to remove`."
starter: |
  #!/usr/bin/env bash
  images='shop/api:9c1d2e0 2 hours ago
  shop/api:4f2a9c1 2 days ago
  shop/api:1b7e0d3 9 days ago
  shop/api:0a1b2c3 3 weeks ago
  shop/web:4f2a9c1 2 days ago
  shop/web:1b7e0d3 9 days ago
  postgres:16 5 weeks ago'
solution: |
  #!/usr/bin/env bash
  images='shop/api:9c1d2e0 2 hours ago
  shop/api:4f2a9c1 2 days ago
  shop/api:1b7e0d3 9 days ago
  shop/api:0a1b2c3 3 weeks ago
  shop/web:4f2a9c1 2 days ago
  shop/web:1b7e0d3 9 days ago
  postgres:16 5 weeks ago'
  declare -A seen
  n=0
  while read -r image _; do
    repo=${image%:*}
    (( ++seen[$repo] ))
    if (( seen[$repo] > 2 )); then
      echo "remove $image"
      (( ++n ))
    fi
  done <<< "$images"
  echo "$n image(s) to remove"
expectedOutput: |
  remove shop/api:1b7e0d3
  remove shop/api:0a1b2c3
  2 image(s) to remove
hints:
  - "Count images per repository with an associative array."
  - "`${image%:*}` is the repository."
explanation: "Print a plan first; pipe the `remove` lines into `docker rmi` only after reviewing it."
```
