## Problem

Your team deploys a web application by SSH-ing into the server, running `git pull` and restarting the service — and every so often a deploy half-fails and the site is down while someone scrambles. You want a deployment script that is **boring**: the same steps every time, an atomic switch to the new version, an automatic health check, instant rollback, and a clear log.

## Requirements

- Layout on the server: `APP_ROOT/releases/<timestamp>/`, `APP_ROOT/shared/` (config, uploads), `APP_ROOT/current -> releases/<timestamp>`.
- `deploy.sh deploy ARTIFACT` installs a build artifact into a new release directory, links shared files, switches `current` atomically, restarts the service and runs a health check; if the check fails it rolls back automatically.
- `deploy.sh rollback` switches to the previous release; `deploy.sh releases` lists releases and marks the current one.
- Keep the newest `KEEP` releases (default 5), never deleting the current or the previous one.
- Preflight before changing anything: artifact exists, enough free space, no other deploy running (lock).
- `-n` dry run prints every action without performing it.
- Every deploy and rollback is appended to `APP_ROOT/deploy.log` with time, user, release and result.
- Exit non-zero on any failure, leaving the previous release serving.

## Steps

### Step 1: Configuration and helpers

Define `APP_ROOT`, `KEEP`, `SERVICE`, `HEALTH_URL` with environment overrides (`: "${APP_ROOT:=/srv/shop}"`). Write `log`, `die`, `run` (dry-run aware) and `audit` (append to deploy.log).

### Step 2: Locking and preflight

Take a lock with `mkdir "$APP_ROOT/.deploy.lock"` (or `flock`) and release it in an EXIT trap. Check the artifact, free space (`df -Pk`), and that `releases/` exists.

### Step 3: Install the release

Create `releases/$(date +%Y%m%d-%H%M%S)`, unpack the artifact into it (`tar -xzf … -C`), and symlink shared paths (`ln -sfn ../../shared/config.env release/.env`).

### Step 4: Atomic switch

Create `current.new` pointing at the release and rename it over `current` with `mv -T`. Remember the previous target first (`readlink current`) for rollback.

### Step 5: Restart and verify

Restart (or reload) the service and poll the health URL with retries and a timeout. On failure, switch back to the previous release, restart again, remove the broken release and exit 1.

### Step 6: Rollback, listing and pruning

Implement `rollback` (switch to the release before current), `releases` (list with a `*` marker) and `prune` (delete old releases beyond KEEP, skipping current and previous).

## Hints

- Timestamps like `20261117-103000` sort correctly as text, so `ls releases | sort` is chronological.
- `ln -sfn` alone isn't atomic (it unlinks first); `ln -s target current.new && mv -T current.new current` is.
- Put the trap on EXIT so the lock is released on errors, Ctrl+C and normal completion.
- A health check needs retries: services take a few seconds to start listening.
- Test the whole flow with a local `APP_ROOT=/tmp/shop` before pointing it at a server.

## Expected output

```text
[10:30:00] preflight ok (artifact build-42.tgz, 18.2G free)
[10:30:00] installing release 20261117-103000
[10:30:00] switched current: 20261116-141500 -> 20261117-103000
[10:30:01] restarting shop
[10:30:03] health check passed (attempt 2)
[10:30:03] pruned 20261110-090000
deploy succeeded: 20261117-103000
```

## Test cases

| Case | Setup | Expect |
|---|---|---|
| first deploy | empty `releases/` | release created, `current` points at it |
| normal deploy | existing releases | switch, health ok, prune beyond KEEP |
| failing health check | health stub fails | automatic rollback, broken release removed, exit 1 |
| rollback | two releases | `current` points at the older one |
| rollback with one release | only one | "nothing to roll back to", exit 1 |
| concurrent deploys | lock held | second run refuses, exit 1 |
| dry run | `-n deploy …` | actions printed, nothing changed |

## Edge cases

- Interruption between switching and the health check — the EXIT trap should log the state, and re-running must be safe.
- Two deploys in the same second (identical timestamp) — the solution appends `-2`, `-3`, … which still sorts after the first.
- `current` exists as a real directory (legacy layout) rather than a symlink.
- Shared files that don't exist yet on first deploy.
- Disk full while unpacking — the half-installed release must be removed.

## Solution

```bash title="deploy.sh" playground
#!/usr/bin/env bash
# deploy.sh — release-directory deployments with atomic switch and rollback.
set -euo pipefail
: "${APP_ROOT:=/tmp/shop}" "${KEEP:=3}" "${SERVICE:=shop}"
DRY_RUN=0
LOCK="$APP_ROOT/.deploy.lock"

log()   { printf '[%s] %s\n' "$(date +%T)" "$*"; }
die()   { log "ERROR: $*" >&2; exit 1; }
run()   { if (( DRY_RUN )); then log "would run: $*"; else "$@"; fi; }
audit() { (( DRY_RUN )) || printf '%s %s %s\n' "$(date '+%F %T')" "${USER:-unknown}" "$*" >> "$APP_ROOT/deploy.log"; }

# --- environment-specific operations (stubbed for the playground) ---
restart_service() { log "restarting $SERVICE"; }                       # sudo systemctl restart "$SERVICE"
health_check()    { grep -q '^ok$' "$APP_ROOT/current/HEALTH" 2>/dev/null; }   # curl -fsS --max-time 3 "$HEALTH_URL"
unpack()          { mkdir -p "$2"; cp -a "$1"/. "$2"/; }              # tar -xzf "$1" -C "$2"

current_release() { local t; t=$(readlink "$APP_ROOT/current" 2>/dev/null) || return 1; echo "${t##*/}"; }
switch_to() {      # switch_to RELEASE — atomic symlink swap
  run ln -sfn "releases/$1" "$APP_ROOT/current.new"
  run mv -T "$APP_ROOT/current.new" "$APP_ROOT/current"
}
lock()   { mkdir "$LOCK" 2>/dev/null || die "another deploy is running (lock: $LOCK)"; trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT; }

wait_healthy() {
  local attempt
  for attempt in 1 2 3 4 5; do
    if health_check; then log "health check passed (attempt $attempt)"; return 0; fi
    sleep 1
  done
  return 1
}

prune() {
  local cur prev r
  cur=$(current_release || true)
  mapfile -t all < <(ls -1 "$APP_ROOT/releases" | sort -r)
  prev=${all[1]:-}
  for r in "${all[@]:KEEP}"; do
    [[ $r == "$cur" || $r == "$prev" ]] && continue
    run rm -rf -- "$APP_ROOT/releases/${r:?}"
    log "pruned $r"
  done
}

cmd_deploy() {
  local artifact=${1:?usage: deploy.sh deploy ARTIFACT} stamp new prev
  [[ -e $artifact ]] || die "artifact not found: $artifact"
  mkdir -p "$APP_ROOT/releases" "$APP_ROOT/shared"
  lock
  log "preflight ok (artifact ${artifact##*/})"
  stamp=$(date +%Y%m%d-%H%M%S)
  local base=$stamp n=1
  while [[ -e $APP_ROOT/releases/$stamp ]]; do stamp="$base-$(( ++n ))"; done   # two deploys in one second
  new="$APP_ROOT/releases/$stamp"
  prev=$(current_release || true)

  log "installing release $stamp"
  run unpack "$artifact" "$new" || { rm -rf -- "$new"; die "unpack failed"; }
  run ln -sfn ../../shared "$new/shared"
  switch_to "$stamp"
  log "switched current: ${prev:-none} -> $stamp"
  restart_service

  if (( DRY_RUN )) || wait_healthy; then
    audit "deploy $stamp ok"
    prune
    echo "deploy succeeded: $stamp"
    return 0
  fi
  log "health check FAILED"
  if [[ -n $prev ]]; then
    switch_to "$prev"; restart_service
    log "rolled back to $prev"
  fi
  run rm -rf -- "$new"
  audit "deploy $stamp FAILED, rolled back to ${prev:-none}"
  return 1
}

cmd_rollback() {
  local cur prev r
  cur=$(current_release) || die "no current release"
  for r in $(ls -1 "$APP_ROOT/releases" | sort); do
    [[ $r == "$cur" ]] && break
    prev=$r
  done
  [[ -n ${prev:-} ]] || die "nothing to roll back to"
  lock
  switch_to "$prev"; restart_service
  audit "rollback $cur -> $prev"
  echo "rolled back: $cur -> $prev"
}

cmd_releases() {
  local cur r; cur=$(current_release || true)
  for r in $(ls -1 "$APP_ROOT/releases" | sort -r); do
    printf '%s %s\n' "$([[ $r == "$cur" ]] && echo '*' || echo ' ')" "$r"
  done
}

main() {
  [[ ${1:-} == -n ]] && { DRY_RUN=1; shift; }
  local cmd=${1:-}; shift || true
  case $cmd in
    deploy) cmd_deploy "$@" ;;
    rollback) cmd_rollback ;;
    releases) cmd_releases ;;
    *) echo "usage: deploy.sh [-n] {deploy ARTIFACT|rollback|releases}" >&2; return 2 ;;
  esac
}

# ---- playground demo: two old releases, a good deploy, a broken deploy, a rollback ----
rm -rf "$APP_ROOT"; mkdir -p "$APP_ROOT/releases"
for r in 20261110-090000 20261112-090000; do mkdir -p "$APP_ROOT/releases/$r"; echo ok > "$APP_ROOT/releases/$r/HEALTH"; done
ln -s releases/20261112-090000 "$APP_ROOT/current"
mkdir -p /tmp/build-good /tmp/build-bad; echo ok > /tmp/build-good/HEALTH; echo broken > /tmp/build-bad/HEALTH

( main deploy /tmp/build-good )
echo "---"
( main deploy /tmp/build-bad ) || echo "(deploy failed as expected, status $?)"
echo "---"
main releases
echo "---"
( main rollback )
main releases
echo "--- audit log:"
cut -d' ' -f3- "$APP_ROOT/deploy.log"
```

## Explanation

- **Release directories + symlink** make the switch a single atomic rename (`mv -T current.new current`) and keep previous versions on disk for instant rollback.
- **Preflight and lock first:** nothing on disk changes until the artifact is checked and the lock is held. The EXIT trap releases the lock on every path, including errors.
- **Health-gated success:** a deploy is only "succeeded" after the health check passes. A failure switches back to the remembered previous release automatically.
- **Pruning never touches current or previous**, so a rollback target always exists.
- **Environment-specific operations are isolated** (`restart_service`, `health_check`, `unpack`), which is what lets the same script run in the playground, in tests, and on a real server with `systemctl` and `curl`.
- **Audit log** answers "who deployed what, when, and did it work?" without digging through shell history.
- Each demo call runs in a `( … )` subshell because `die` and the lock trap use `exit`/`EXIT` — exactly as separate invocations of the script would.

## Extensions

- Deploy to several servers in sequence (rolling) or in parallel, stopping on the first failure.
- Download artifacts from a registry and verify a SHA-256 checksum before unpacking.
- Run database migrations between install and switch, with a separate rollback plan.
- Blue/green mode: two long-lived slots and a load-balancer switch instead of a symlink.
- Send chat notifications on start, success, failure and rollback.
