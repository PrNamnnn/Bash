## Problem

You keep important work in a few directories and want reliable, automatic backups. Each run should create a new timestamped backup, verify it, record what happened, and delete old backups according to a retention policy — while making it impossible to fill the disk or delete the wrong thing.

You'll build `backup.sh`, suitable for running by hand or from cron.

## Requirements

- Usage: `backup.sh [-n] [-k KEEP] [-d DEST] SOURCE...` — `-n` dry run, `-k` number of backups to keep per source (default 5), `-d` destination (default `$BACKUP_DIR` or `~/backups`).
- Each source produces `DEST/NAME-YYYYMMDD-HHMMSS.tar.gz` (on a real system) — in the simulator, a copied directory with the same name pattern.
- Write to a temporary name first and rename only after the copy is verified, so a crash never leaves a "valid-looking" partial backup.
- After a successful backup, keep only the newest KEEP backups of that source.
- Log every action with a timestamp to stderr; print a final summary line to stdout.
- Exit 0 if all sources succeeded, 1 if any failed (continue with the remaining sources), 2 on usage errors.

## Steps

### Step 1: Options and validation

Parse `-n`, `-k` and `-d` with `getopts`. Validate that KEEP is a positive integer and that at least one source was given. Default the destination with `${BACKUP_DIR:-$HOME/backups}`.

### Step 2: Logging helpers

Write `log` (timestamped, to stderr) and `die`. Wrap side-effecting commands in `run`, which prints instead of executing in dry-run mode.

### Step 3: Back up one source

Write `backup_one SRC` that checks the source is a readable directory, builds the timestamped name, copies to `NAME.partial`, verifies the copy, then renames it. On a real system the copy step is `tar -czf "$tmp" -C "$(dirname "$src")" "$(basename "$src")"` and verification is `tar -tzf "$tmp" > /dev/null`.

### Step 4: Retention

Write `prune NAME` that lists existing backups for that source newest-first (`ls -1d DEST/NAME-* | sort -r`) and removes everything after the first KEEP. Guard against an empty `DEST` with `${DEST:?}`.

### Step 5: Loop over sources and summarise

Call `backup_one` for each source without stopping on failure (`if backup_one "$src"; then … else failed=1; fi`), count successes and failures, and print the summary.

### Step 6: Schedule it

Add the cron line and test it under a cron-like environment (`env -i HOME=$HOME PATH=/usr/bin:/bin bash backup.sh …`).

## Hints

- `date +%Y%m%d-%H%M%S` produces names that sort chronologically as plain text.
- Clean up a leftover `.partial` with a trap: `trap 'rm -rf -- "$partial"' EXIT` (reset it after the rename).
- `mapfile -t old < <(… | tail -n +$((keep + 1)))` gives you the list to delete.
- Validate KEEP with `[[ $keep =~ ^[1-9][0-9]*$ ]]`.
- In cron, `%` must be escaped as `\%`.

## Expected output

```text
[2026-11-17 02:30:00] backing up /home/learner/projects -> /tmp/backups/projects-20261117-023000
[2026-11-17 02:30:00] verified projects-20261117-023000
[2026-11-17 02:30:00] pruned projects-20261111-0200
[2026-11-17 02:30:00] backing up /home/learner/data -> /tmp/backups/data-20261117-023000
[2026-11-17 02:30:00] verified data-20261117-023000
[2026-11-17 02:30:00] skipping /home/learner/nope: not a readable directory
backups: 2 ok, 1 failed
```

(Log lines go to stderr, the summary to stdout.)

## Test cases

| Case | Command | Expect |
|---|---|---|
| normal run | `backup.sh ~/projects` | one new backup, status 0 |
| retention | run 7 times with `-k 3` | exactly 3 backups remain |
| dry run | `backup.sh -n ~/projects` | "would run" lines, nothing created |
| missing source | `backup.sh ~/projects ~/nope` | first succeeds, second logged, status 1 |
| bad keep | `backup.sh -k 0 ~/projects` | usage error, status 2 |
| interrupted | kill during copy | no `.partial` left; previous backups intact |

## Edge cases

- Source paths with spaces or trailing slashes (`~/my docs/`).
- Two sources with the same base name (`/srv/app` and `/home/app`) — decide on a naming scheme.
- DEST inside SOURCE (backing up into itself).
- Running twice within the same second (names collide).
- The destination disk is full or not writable.
- `KEEP` larger than the number of existing backups.

## Solution

```bash title="backup.sh" playground
#!/usr/bin/env bash
# backup.sh — timestamped backups with verification and retention.
# Usage: backup.sh [-n] [-k KEEP] [-d DEST] SOURCE...
set -euo pipefail

PROG=${0##*/}
DRY_RUN=0 KEEP=5 DEST=${BACKUP_DIR:-$HOME/backups}

log()   { printf '[%s] %s\n' "$(date '+%F %T')" "$*" >&2; }
usage() { echo "usage: $PROG [-n] [-k KEEP] [-d DEST] SOURCE..." >&2; exit 2; }
run()   { if (( DRY_RUN )); then log "would run: $*"; else "$@"; fi; }

backup_one() {
  local src=${1%/} name stamp target partial
  [[ -d $src && -r $src ]] || { log "skipping $src: not a readable directory"; return 1; }
  name=${src##*/}
  stamp=$(date +%Y%m%d-%H%M%S)
  target="$DEST/$name-$stamp"
  partial="$target.partial"
  [[ ! -e $target ]] || { log "skipping $src: $target already exists"; return 1; }

  log "backing up $src -> $target"
  # Real system: tar -czf "$partial.tar.gz" -C "$(dirname "$src")" "$name" && tar -tzf "$partial.tar.gz" >/dev/null
  run cp -a -- "$src" "$partial"
  if (( ! DRY_RUN )); then
    diff -rq -- "$src" "$partial" > /dev/null || { log "verification failed for $name"; rm -rf -- "$partial"; return 1; }
    mv -- "$partial" "$target"
    log "verified ${target##*/}"
  fi
  prune "$name"
}

prune() {
  local name=$1 old
  mapfile -t old < <(ls -1d "${DEST:?}/$name"-* 2>/dev/null | grep -v '\.partial$' | sort -r | tail -n +$((KEEP + 1)))
  for old in "${old[@]}"; do
    run rm -rf -- "$old"
    log "pruned ${old##*/}"
  done
}

main() {
  local opt OPTIND
  while getopts ':nk:d:h' opt; do
    case $opt in
      n) DRY_RUN=1 ;;
      k) KEEP=$OPTARG ;;
      d) DEST=$OPTARG ;;
      *) usage ;;
    esac
  done
  shift $((OPTIND - 1))
  [[ $KEEP =~ ^[1-9][0-9]*$ ]] || { echo "$PROG: -k needs a positive integer" >&2; exit 2; }
  (( $# > 0 )) || set -- "$HOME/projects" "$HOME/data" "$HOME/nope"   # demo defaults for the playground
  run mkdir -p -- "$DEST"

  local src ok=0 failed=0
  for src in "$@"; do
    if backup_one "$src"; then (( ++ok )); else (( ++failed )); fi
  done
  echo "backups: $ok ok, $failed failed"
  (( failed == 0 ))
}

# Playground demo: pretend two older backups of ~/projects exist and keep 2.
BACKUP_DIR=/tmp/backups; DEST=$BACKUP_DIR
mkdir -p "$DEST/projects-20261110-0200" "$DEST/projects-20261111-0200"
main -k 2 "$@" || true
ls -1 "$DEST"
```

On a real server, remove the last four demo lines and call `main "$@"`.

## Explanation

- **Partial-then-rename.** The copy goes to `NAME.partial`; only a verified copy is renamed to its final name. Anything named `NAME-TIMESTAMP` is therefore complete — a property the retention step relies on.
- **Verification** with `diff -rq` (or `tar -tzf` for archives) catches truncated or failed copies before old backups are pruned.
- **Retention after success only.** If today's backup fails, `prune` never runs, so you never delete old backups while having no new one.
- **`${DEST:?}`** in the prune path makes an empty variable abort instead of expanding to `/-…`.
- **Failure isolation.** Each source is attempted; failures are counted, logged and reflected in the exit status, which cron or a monitoring system can act on.
- **Dry run** goes through the same code path with `run` printing instead of executing, so the preview is faithful.

## Extensions

- Switch to real compressed archives with `tar --zstd` and write a `.sha256` file next to each.
- Add `-e PATTERN` exclusions (`--exclude` for tar, `--exclude` for rsync).
- Copy each finished backup off-site with `rsync` or to object storage, and verify the remote copy.
- Implement grandfather-father-son retention (7 daily, 4 weekly, 12 monthly).
- Add a `restore` subcommand that lists backups and extracts one to a chosen directory.
