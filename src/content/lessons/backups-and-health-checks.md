---
objectives:
  - Create timestamped backups with `tar` and `rsync`, and verify them
  - Implement retention (keep the newest N, or delete older than D days) safely
  - Write health checks with clear output, conventional exit codes and alerting hooks
  - Apply the 3-2-1 rule and test restores, not just backups
summary:
  - "Timestamped archives: `tar -czf \"backup-$(date +%Y%m%d-%H%M%S).tar.gz\" -C /srv app` — `-C` keeps paths relative."
  - "Verify every backup: `tar -tzf` lists it, checksums (`sha256sum`) detect corruption, and a periodic test restore proves it works."
  - "Retention: `ls -1t | tail -n +8` (keep newest 7) or `find DIR -name '*.tar.gz' -mtime +14 -delete` — preview with `-print` first."
  - "3-2-1: three copies, on two kinds of storage, one off-site. Snapshots on the same disk are not backups."
  - "Health checks print one clear line per check and exit 0 (OK), 1 (WARN) or 2 (CRITICAL) so monitoring systems understand them."
related:
  - cron-and-scheduling
  - disk-memory-cpu
  - atomicity-and-idempotency
---

## What makes a good backup

- **Automatic** — scheduled, not "when someone remembers".
- **Timestamped** — every run creates a new, sortable name.
- **Verified** — a backup you've never restored is a hope, not a backup.
- **Retained** — old ones pruned on a policy, so the disk doesn't fill.
- **Off-site** — at least one copy survives a lost server, datacenter or ransomware.
- **Logged and alerted** — failures are noticed.

## Archives with tar

```bash
stamp=$(date +%Y%m%d-%H%M%S)
tar -czf "/backups/app-$stamp.tar.gz" -C /srv app      # create (gzip)
tar -tzf "/backups/app-$stamp.tar.gz" | head             # list contents
tar -xzf "/backups/app-$stamp.tar.gz" -C /tmp/restore    # extract elsewhere
sha256sum "/backups/app-$stamp.tar.gz" > "/backups/app-$stamp.tar.gz.sha256"
sha256sum -c "/backups/app-$stamp.tar.gz.sha256"         # verify later
```

| Option | Meaning |
|---|---|
| `-c` / `-x` / `-t` | create / extract / list |
| `-z` / `-j` / `-J` / `--zstd` | gzip / bzip2 / xz / zstd compression |
| `-f FILE` | archive file name (must be last in a flag cluster) |
| `-C DIR` | change to DIR first — stores relative paths |
| `--exclude='*.log'` | skip files |
| `-p` | preserve permissions on extract (default for root) |

Databases need a consistent dump (`pg_dump`, `mysqldump --single-transaction`) rather than copying live data files.

## A backup with rotation

The simulator has no `tar`, so this version copies directories — the structure (timestamp, verify, prune, report) is identical:

```bash title="backup-rotate.sh" playground
set -euo pipefail
src=~/projects
dest=/tmp/backups
keep=3
mkdir -p "$dest"

# simulate earlier runs with older timestamps
for d in 20261110-0200 20261111-0200 20261112-0200 20261113-0200; do
  mkdir -p "$dest/projects-$d"
done

stamp=$(date +%Y%m%d-%H%M%S)
target="$dest/projects-$stamp"
cp -a "$src" "$target.partial"           # work on a temporary name…
diff -rq "$src" "$target.partial"        # …verify it…
mv "$target.partial" "$target"           # …then publish atomically
echo "created $(basename "$target")"

# keep only the newest $keep backups (names sort by time)
mapfile -t old < <(ls -1d "$dest"/projects-* | sort -r | tail -n +$((keep + 1)))
for d in "${old[@]}"; do
  rm -rf -- "$d"
  echo "pruned $(basename "$d")"
done
ls -1 "$dest"
```

## Retention policies

| Policy | Command |
|---|---|
| keep the newest N | `ls -1t backup-*.tar.gz \| tail -n +$((N+1)) \| xargs -r rm --` |
| delete older than D days | `find /backups -name 'app-*.tar.gz' -mtime +"$D" -delete` |
| grandfather-father-son | keep 7 dailies, 4 weeklies (e.g. Sundays), 12 monthlies (1st of month) |

Always preview first: replace `-delete` with `-print`, or `rm` with `echo rm`. A wrong glob in a pruning script is a classic way to lose every backup at once.

## Off-site copies

```bash
rsync -az --delete /backups/ backup@offsite.example.com:/srv/backups/web01/
aws s3 cp "/backups/app-$stamp.tar.gz" "s3://acme-backups/web01/" --storage-class STANDARD_IA
restic -r s3:s3.amazonaws.com/acme-backups backup /srv/app     # deduplicated, encrypted
```

Tools like **restic**, **borg** and **rclone** add encryption, deduplication and integrity checks; prefer them over home-grown scripts for important data.

## Health checks

A health check answers "is this OK right now?" quickly, with output a human and a machine can both read:

```bash title="health-check.sh" playground
OK=0 WARN=1 CRIT=2
worst=$OK
report() {   # report STATUS NAME MESSAGE
  local labels=(OK WARN CRIT)
  printf '%-5s %-12s %s\n' "${labels[$1]}" "$2" "$3"
  (( $1 > worst )) && worst=$1
  return 0
}

# 1. disk (simulated figure; real: df -P / | awk 'NR==2 {print $5+0}')
disk=84
if   (( disk >= 90 )); then report $CRIT disk "root at ${disk}%"
elif (( disk >= 80 )); then report $WARN disk "root at ${disk}%"
else report $OK disk "root at ${disk}%"; fi

# 2. errors in the application log during the last run
errors=$(grep -c ' ERROR ' ~/logs/app.log || true)
(( errors > 0 )) && report $WARN app-errors "$errors ERROR lines in app.log" || report $OK app-errors "no errors"

# 3. latest backup age (simulated: 26 hours)
age_h=26
(( age_h > 25 )) && report $CRIT backup "last backup ${age_h}h ago" || report $OK backup "last backup ${age_h}h ago"

# 4. a required file
[[ -r ~/.config/app.conf ]] && report $OK config "app.conf readable" || report $CRIT config "app.conf missing"

echo "overall: $worst"
exit "$worst"
```

Conventions worth following:

- One line per check: `STATUS NAME detail`.
- Exit **0/1/2/3** (OK/WARNING/CRITICAL/UNKNOWN) — the Nagios plugin convention understood by Icinga, Zabbix, Sensu and others.
- Fast and side-effect free: checks run every minute.
- Alert from the *caller* (cron + mail, a monitoring agent, a webhook) so the check stays simple:

```bash
/usr/local/bin/health-check.sh > /tmp/health.txt || \
  curl -fsS -X POST -H 'Content-Type: text/plain' --data-binary @/tmp/health.txt "$ALERT_WEBHOOK"
```

## Test restores

Schedule a restore test (monthly, say): extract the latest backup into a temporary location, check that key files exist and the database dump loads, then remove it. Record the result like any other check.

## Common mistakes

```mistake
title: Pruning with an unchecked variable
wrong: |
  find "$BACKUP_DIR/" -mtime +14 -delete      # BACKUP_DIR empty → find / -mtime +14 -delete
right: |
  : "${BACKUP_DIR:?BACKUP_DIR must be set}"
  find "$BACKUP_DIR" -name 'app-*.tar.gz' -mtime +14 -print -delete
why: Guard the variable and restrict the pattern so the command can only touch backup files.
```

```mistake
title: Backups on the same disk
wrong: |
  tar czf /var/backups/site.tgz /var/www     # same disk, same server
right: |
  tar czf /var/backups/site.tgz /var/www && rsync -a /var/backups/ offsite:/backups/web01/
why: A disk failure, ransomware or a deleted VM takes the data and its backups together.
```

## Practice

```exercise
kind: mcq
difficulty: intermediate
prompt: "Why use `tar -czf out.tgz -C /srv app` instead of `tar -czf out.tgz /srv/app`?"
options:
  - It compresses better
  - It stores relative paths (`app/...`), so extraction doesn't depend on /srv
  - It excludes hidden files
  - It's required for gzip
answer: 1
explanation: "-C changes directory first, so archive members are relative and can be restored anywhere."
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  printf '%s\n' backup-20261101 backup-20261108 backup-20261115 backup-20261117 |
    sort -r | tail -n +3
answer: |
  backup-20261108
  backup-20261101
explanation: "Newest first, then skip the first two lines: what remains is everything except the newest two — the ones to prune."
```

```exercise
kind: command
difficulty: intermediate
prompt: "Print the names of files directly in `/tmp` older than 7 days (create one first with `touch -d '10 days ago' /tmp/old.bak`), without deleting anything."
solution: touch -d '10 days ago' /tmp/old.bak; find /tmp -maxdepth 1 -type f -mtime +7 -print
explanation: "Always run the -print version of a pruning command before adding -delete."
```

## Challenge

```exercise
kind: script
difficulty: advanced
title: Retention planner
prompt: "Given the backup names below (format `db-YYYYMMDD`), keep the newest 3 plus every backup made on the 1st of a month. Print `keep NAME` or `delete NAME` for each, newest first."
starter: |
  #!/usr/bin/env bash
  backups='db-20261101
  db-20261015
  db-20261117
  db-20261001
  db-20261116
  db-20261110
  db-20261115'
solution: |
  #!/usr/bin/env bash
  backups='db-20261101
  db-20261015
  db-20261117
  db-20261001
  db-20261116
  db-20261110
  db-20261115'
  n=0
  while read -r name; do
    (( ++n ))
    day=${name: -2}
    if (( n <= 3 )) || [[ $day == 01 ]]; then
      echo "keep $name"
    else
      echo "delete $name"
    fi
  done < <(sort -r <<< "$backups")
expectedOutput: |
  keep db-20261117
  keep db-20261116
  keep db-20261115
  delete db-20261110
  keep db-20261101
  delete db-20261015
  keep db-20261001
hints:
  - "Sort newest first with `sort -r`; the date format sorts correctly as text."
  - "`${name: -2}` is the day of month."
explanation: "Separating the decision (keep/delete) from the action makes the policy easy to review — pipe the `delete` lines into rm only once the plan looks right."
```
