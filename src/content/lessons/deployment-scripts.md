---
objectives:
  - Structure a deployment as preflight → build/fetch → release → switch → verify → clean up
  - Deploy atomically with release directories and a `current` symlink
  - Roll back automatically when a post-deploy check fails
  - Add safety features: dry runs, confirmations, locks and audit logs
summary:
  - "Each release goes in its own directory (`releases/20261117-103000`); `current` is a symlink switched atomically with `ln -sfn` (or `mv -T`)."
  - "Preflight checks run before anything changes: arguments, target, disk space, dependencies, clean git state, a lock."
  - "After switching, verify (health endpoint, smoke test); on failure, point `current` back to the previous release."
  - "Keep the last N releases for instant rollback; prune older ones."
  - "Make destructive steps visible: `--dry-run`, explicit confirmation for production, and a log of who deployed what, when."
related:
  - atomicity-and-idempotency
  - networking-and-ssh
  - production-operations
---

## The shape of a deployment

```text
preflight ──▶ fetch/build ──▶ install into new release dir ──▶ switch symlink ──▶ verify ──▶ prune
     │                                                              │                │
     └── abort before touching anything                             └─ rollback ◀────┘ on failure
```

Every phase has one job, and nothing user-visible changes until the switch — which is a single atomic rename.

## Release directories and a symlink

```text
/srv/shop/
├── releases/
│   ├── 20261115-090000/
│   ├── 20261116-141500/
│   └── 20261117-103000/     ← newest
├── shared/                  ← config, uploads, logs: survive across releases
└── current -> releases/20261117-103000
```

The web server or service always runs from `/srv/shop/current`. Switching is:

```bash
ln -sfn "releases/$stamp" /srv/shop/current.new && mv -T /srv/shop/current.new /srv/shop/current
```

(`ln -sfn` alone is *nearly* atomic — it unlinks then creates; `mv -T` over the old link is a true atomic rename.)

## A complete, runnable simulation

```bash title="deploy.sh" playground
set -euo pipefail
app=/tmp/shop
mkdir -p "$app/releases" "$app/shared"
log() { printf '[%s] %s\n' "$(date +%T)" "$*"; }

# existing state: two older releases, current points at the newest
for r in 20261115-090000 20261116-141500; do
  mkdir -p "$app/releases/$r"; echo "version $r" > "$app/releases/$r/VERSION"
done
ln -sfn releases/20261116-141500 "$app/current"

health_check() { grep -q 'version' "$app/current/VERSION"; }    # stand-in for curl -fsS /health

deploy() {
  local stamp=$1 healthy=$2
  local new="$app/releases/$stamp"
  local previous; previous=$(readlink "$app/current")

  log "preflight ok; deploying $stamp (previous: ${previous##*/})"
  mkdir -p "$new"
  if [[ $healthy == yes ]]; then echo "version $stamp" > "$new/VERSION"; else echo "broken build" > "$new/VERSION"; fi
  ln -sfn "../shared" "$new/shared"

  ln -sfn "releases/$stamp" "$app/current.new"
  mv -T "$app/current.new" "$app/current"
  log "switched current -> releases/$stamp"

  if health_check; then
    log "health check passed"
  else
    log "health check FAILED — rolling back to ${previous##*/}"
    ln -sfn "$previous" "$app/current.new" && mv -T "$app/current.new" "$app/current"
    rm -rf -- "$new"
    return 1
  fi
}

deploy 20261117-103000 yes
deploy 20261117-120000 no || log "deploy failed, site still on $(readlink "$app/current")"

# keep the newest 2 releases
mapfile -t old < <(ls -1 "$app/releases" | sort -r | tail -n +3)
for r in "${old[@]}"; do rm -rf -- "$app/releases/$r"; log "pruned $r"; done
ls "$app/releases"
```

## Preflight checks

```bash
preflight() {
  [[ $ENVIRONMENT =~ ^(staging|production)$ ]] || die "unknown environment: $ENVIRONMENT"
  command -v rsync > /dev/null                 || die "rsync is required"
  [[ -z $(git status --porcelain) ]]           || die "uncommitted changes"
  ssh -o BatchMode=yes -o ConnectTimeout=5 "$HOST" true || die "cannot reach $HOST"
  local free_mb; free_mb=$(ssh "$HOST" "df -Pm /srv | awk 'NR==2 {print \$4}'")
  (( free_mb > 1024 ))                         || die "less than 1 GiB free on $HOST"
}
```

## Safety features

| Feature | Implementation |
|---|---|
| dry run | `run() { if (( DRY_RUN )); then echo "would: $*"; else "$@"; fi; }` |
| confirmation for production | `read -rp "Deploy $sha to PRODUCTION? [y/N] " a; [[ $a == [yY] ]] \|\| exit 1` (skipped with `--yes` in CI) |
| single deployer at a time | `exec 9>/tmp/deploy.lock; flock -n 9 \|\| die "deploy in progress"` |
| audit log | `echo "$(date -Is) $USER deployed $sha to $ENVIRONMENT" >> /var/log/deploys.log` |
| fast rollback | `deploy.sh rollback` = point `current` at the previous release |
| notifications | post to chat on start, success and failure (from a trap) |

## Zero-downtime restarts

Switching files is atomic, but the running process still has the old code loaded. Options:

- `systemctl reload app` if the app supports graceful reload (nginx, gunicorn with HUP, php-fpm).
- Rolling restarts across servers behind a load balancer: take one out, deploy, verify, put back.
- Blue/green: run the new version alongside the old, switch the load balancer, keep the old for rollback.

## Common mistakes

```mistake
title: Deploying in place
wrong: |
  cd /srv/shop && git pull && npm ci && systemctl restart shop   # half-updated during the build; no rollback
right: |
  # build into a new release directory, then switch the symlink atomically
why: In-place updates expose a mix of old and new files, and there's nothing to roll back to.
```

```mistake
title: No verification after switching
wrong: |
  switch_release && echo "deployed!"
right: |
  switch_release
  if ! curl -fsS --max-time 5 --retry 5 --retry-delay 2 https://shop.example.com/health; then
    rollback; exit 1
  fi
why: A deploy isn't done until the new version is confirmed to be serving correctly.
```

## Practice

```exercise
kind: mcq
difficulty: intermediate
prompt: Why do deployment scripts use a `current` symlink pointing into `releases/`?
options:
  - Symlinks make files load faster
  - Switching (and rolling back) becomes a single atomic operation, and old releases stay available
  - Web servers can't read normal directories
  - It saves disk space
answer: 1
explanation: Nothing changes for users until the link flips, and flipping it back is instant.
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  cd "$(mktemp -d)"
  mkdir -p releases/r1 releases/r2
  ln -sfn releases/r1 current
  ln -sfn releases/r2 current.new && mv -T current.new current
  readlink current
answer: releases/r2
explanation: The new link replaced the old one in a single rename.
```

```exercise
kind: command
difficulty: intermediate
prompt: "In a temp directory, create `releases/a` and `releases/b`, point `current` at `releases/a`, then print the name of the release `current` points to without the `releases/` prefix."
solution: cd "$(mktemp -d)"; mkdir -p releases/a releases/b; ln -sfn releases/a current; t=$(readlink current); echo "${t##*/}"
explanation: "`readlink` prints the link target; parameter expansion strips the directory."
```

## Challenge

```exercise
kind: script
difficulty: advanced
title: Rollback command
prompt: "Set up `/tmp/app/releases/{r1,r2,r3}` with `current -> releases/r3`. Write `rollback` that points `current` at the release immediately before the current one (by sorted name), printing `rolled back r3 -> r2`; if there's no older release print `nothing to roll back to` to stderr and return 1. Call it three times (the third fails), then print the final target."
starter: |
  #!/usr/bin/env bash
  app=/tmp/app
  rm -rf "$app"; mkdir -p "$app"/releases/{r1,r2,r3}
  ln -sfn releases/r3 "$app/current"
  rollback() {
    :
  }
  rollback
  rollback
  rollback 2>&1
  readlink "$app/current"
solution: |
  #!/usr/bin/env bash
  app=/tmp/app
  rm -rf "$app"; mkdir -p "$app"/releases/{r1,r2,r3}
  ln -sfn releases/r3 "$app/current"
  rollback() {
    local cur prev="" r
    cur=$(readlink "$app/current"); cur=${cur##*/}
    for r in $(ls -1 "$app/releases" | sort); do
      [[ $r == "$cur" ]] && break
      prev=$r
    done
    if [[ -z $prev ]]; then
      echo "nothing to roll back to" >&2
      return 1
    fi
    ln -sfn "releases/$prev" "$app/current.new" && mv -T "$app/current.new" "$app/current"
    echo "rolled back $cur -> $prev"
  }
  rollback
  rollback
  rollback 2>&1
  readlink "$app/current"
expectedOutput: |
  rolled back r3 -> r2
  rolled back r2 -> r1
  nothing to roll back to
  releases/r1
checks:
  - pattern: readlink
    message: Read the current target with readlink.
hints:
  - "Walk the sorted release names; the one seen just before the current is the rollback target."
explanation: "Because releases are kept as directories, rolling back is just moving a pointer — seconds, not a rebuild."
```
