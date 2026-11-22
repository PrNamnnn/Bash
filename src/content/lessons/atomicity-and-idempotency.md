---
objectives:
  - Write files atomically so readers never see half-written content
  - Prevent concurrent runs with `mkdir` locks and `flock`
  - Make scripts idempotent — safe to run twice with the same result
  - Design operations that recover cleanly after interruption
summary:
  - "`mv` within one filesystem is atomic: write to a temp file in the *same directory*, then `mv -f tmp final`."
  - "`mkdir lockdir` is an atomic test-and-set lock; `flock -n 9` (with `exec 9>lockfile`) is a robust lock that the kernel releases on exit."
  - "Idempotent operations: `mkdir -p`, `ln -sfn`, `cp -n`, `grep -qxF line file || echo line >> file`, `useradd` only if `id -u` fails."
  - "Check-then-act (`[[ -e $f ]] || create`) is a race; prefer operations that fail safely when the condition already holds."
  - "Design for re-runs: a crashed script should be safe to start again."
related:
  - temp-files-and-fds
  - robust-patterns
  - deployment-scripts
---

## Atomic file updates

If a script writes directly to `config.json` and crashes — or another process reads the file mid-write — readers see a truncated, broken file. The fix: write elsewhere, then **rename**.

On the same filesystem, `rename()` (what `mv` uses) is **atomic**: other processes see either the old file or the new one, never a mixture.

```bash title="atomic-write.sh" playground
target=/tmp/settings.conf
printf 'version=1\n' > "$target"

write_atomic() {
  local dest=$1 tmp
  tmp=$(mktemp "${dest}.XXXXXX") || return 1     # same directory → same filesystem
  if cat > "$tmp" && mv -f -- "$tmp" "$dest"; then
    return 0
  fi
  rm -f -- "$tmp"
  return 1
}

printf 'version=2\nupdated=yes\n' | write_atomic "$target"
cat "$target"
ls /tmp | grep -c 'settings.conf\.' || true     # no temp files left behind
```

Create the temp file next to the destination: `mv` across filesystems (e.g. `/tmp` → `/srv`) is a copy + delete — not atomic.

The same trick deploys code atomically: build into `releases/2026-11-17_1030/`, then switch a symlink with `ln -sfn releases/2026-11-17_1030 current` (or `mv -T` a new symlink over the old one).

## Locks: only one instance at a time

Two cron runs of a backup overlapping can corrupt the archive. Use a lock.

### mkdir lock

`mkdir` either creates the directory or fails — atomically.

```bash title="mkdir-lock.sh" playground
lock=/tmp/backup.lock
acquire() {
  if mkdir "$lock" 2>/dev/null; then
    trap 'rmdir "$lock"' EXIT
    return 0
  fi
  echo "another instance is running" >&2
  return 1
}
acquire && echo "got the lock, working…"
( acquire ) 2>&1 || echo "second attempt refused"
```

Drawback: if the process is killed with SIGKILL, the trap never runs and the stale lock stays. Store the PID inside and check it with `kill -0` if that matters.

### flock

`flock` (util-linux) uses kernel file locks that are released automatically when the process exits — no stale locks:

```bash
exec 9> /var/lock/backup.lock
flock -n 9 || { echo "already running" >&2; exit 1; }
# … critical section: the lock is held until the script exits …
```

Or wrap a single command: `flock -n /var/lock/backup.lock backup.sh`. In crontab: `*/5 * * * * flock -n /tmp/sync.lock /usr/local/bin/sync.sh`.

## Idempotency

An operation is **idempotent** if doing it twice has the same effect as doing it once. Provisioning, deployment and setup scripts should be idempotent so they can be re-run after a failure or on every deploy.

| Not idempotent | Idempotent |
|---|---|
| `mkdir dir` | `mkdir -p dir` |
| `ln -s target link` | `ln -sfn target link` |
| `echo 'line' >> file` | `grep -qxF 'line' file \|\| echo 'line' >> file` |
| `useradd app` | `id -u app &>/dev/null \|\| useradd app` |
| `cp new.conf /etc/app.conf` (always) | `cmp -s new.conf /etc/app.conf \|\| install -m 644 new.conf /etc/app.conf` |
| `sed -i 's/a/aa/' f` | `sed -i 's/^a$/aa/' f` (anchored to the final state) |

```bash title="idempotent.sh" playground
cfg=/tmp/app.rc
ensure_line() { grep -qxF -- "$1" "$2" 2>/dev/null || printf '%s\n' "$1" >> "$2"; }
for run in 1 2 3; do
  mkdir -p /tmp/app/data
  ensure_line 'export APP_HOME=/tmp/app' "$cfg"
  ensure_line 'alias app=/tmp/app/bin/app' "$cfg"
done
echo "after three runs:"
cat "$cfg"
```

## Check-then-act races

```bash
[[ -e $f ]] || echo data > "$f"        # another process can create $f in between
```

Prefer operations that combine the check and the action:

| Racy | Atomic |
|---|---|
| test, then create file | `set -C; > "$f"` (noclobber fails if it exists) |
| test, then mkdir | `mkdir "$d"` and check its status |
| test, then write config | write temp file + `mv` |
| check process, then start | `flock` |

## Designing for interruption

Assume the script can die at any line. Ask: if it stops *here*, what state is left, and does re-running fix it?

- Do work in a staging location; publish with one atomic step at the end.
- Record progress (a "done" marker per item) so a restart skips completed items.
- Use `trap … EXIT` to remove partial outputs.
- Make each step idempotent so repeating it is harmless.

## Common mistakes

```mistake
title: Temp file on another filesystem
wrong: |
  tmp=$(mktemp)                  # /tmp is often a separate tmpfs
  generate > "$tmp" && mv "$tmp" /srv/www/index.html
right: |
  tmp=$(mktemp /srv/www/.index.html.XXXXXX)
  generate > "$tmp" && mv -f "$tmp" /srv/www/index.html
why: Across filesystems mv copies then deletes, so readers can observe a partial file.
```

```mistake
title: Appending on every run
wrong: |
  echo 'export PATH=$HOME/bin:$PATH' >> ~/.bashrc    # one more copy per run
right: |
  line='export PATH=$HOME/bin:$PATH'
  grep -qxF -- "$line" ~/.bashrc || printf '%s\n' "$line" >> ~/.bashrc
why: Setup scripts are re-run; blind appends pile up duplicates.
```

## Practice

```exercise
kind: mcq
difficulty: intermediate
prompt: Why is `mv tmpfile final` used to publish a new version of a file?
options:
  - mv is faster than cp
  - Within a filesystem, rename is atomic — readers see the old or the new file, never a partial one
  - mv preserves the file's timestamp
  - mv automatically creates a backup
answer: 1
explanation: Atomic rename is the foundation of safe updates.
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  f=/tmp/hosts.list
  : > "$f"
  add() { grep -qxF "$1" "$f" || echo "$1" >> "$f"; }
  add web01; add web02; add web01
  wc -l < "$f"
answer: "2"
explanation: The second `add web01` finds the line and does nothing.
```

```exercise
kind: command
difficulty: beginner
prompt: "Create the directory `/tmp/a/b/c` in a way that succeeds even if it already exists, twice in a row, then print `ok`."
solution: mkdir -p /tmp/a/b/c && mkdir -p /tmp/a/b/c && echo ok
explanation: "`mkdir -p` is idempotent: an existing directory is not an error."
```

## Challenge

```exercise
kind: script
difficulty: advanced
title: Resumable batch job
prompt: "Process each server name in `~/data/servers.txt`: print `processing NAME`, then record NAME in `/tmp/done.list`. Skip names already in the done list (print `skip NAME`). To prove it's resumable, pre-populate the list with `web01` and `web02` before the loop, and after the loop print `done: N` (lines in the list)."
starter: |
  #!/usr/bin/env bash
  done_list=/tmp/done.list
  printf 'web01\nweb02\n' > "$done_list"
solution: |
  #!/usr/bin/env bash
  done_list=/tmp/done.list
  printf 'web01\nweb02\n' > "$done_list"
  while read -r name _; do
    if grep -qxF -- "$name" "$done_list"; then
      echo "skip $name"
      continue
    fi
    echo "processing $name"
    echo "$name" >> "$done_list"
  done < ~/data/servers.txt
  echo "done: $(wc -l < "$done_list")"
expectedOutput: |
  skip web01
  skip web02
  processing db01
  processing cache01
  processing mail01
  done: 5
checks:
  - pattern: grep -q
    message: Check the done list with grep -q.
hints:
  - "`grep -qxF -- \"$name\" file` matches the whole line literally."
  - "Append to the done list only after the work succeeds."
explanation: "A progress marker per item turns a long job that may crash into one that can always be resumed."
```
