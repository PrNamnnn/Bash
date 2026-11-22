---
objectives:
  - Read and write the five-field cron schedule syntax
  - Install jobs with `crontab -e`, and know about `/etc/cron.d` and the cron.daily-style directories
  - Make cron jobs reliable: PATH, logging, locking, absolute paths and exit codes
  - Use systemd timers as a modern alternative, and `at` for one-off jobs
summary:
  - "`m h dom mon dow command` — minute (0–59), hour (0–23), day of month (1–31), month (1–12), day of week (0–7, 0 and 7 = Sunday)."
  - "`*` any, `,` list, `-` range, `/` step: `*/15 * * * *` every 15 minutes; `0 2 * * 1-5` 02:00 on weekdays."
  - "Cron runs with a minimal environment: tiny PATH, `/bin/sh`, no `~/.bashrc`, cwd = home. Use absolute paths and set PATH."
  - "Always redirect output to a log (`>> /var/log/job.log 2>&1`) and use `flock -n` to prevent overlapping runs."
  - "`%` is special in crontab lines (it means newline) — escape it as `\\%`, e.g. in `date +\\%F`."
related:
  - environment-inheritance
  - atomicity-and-idempotency
  - backups-and-health-checks
---

## The schedule format

::viz cron

```text
┌───────────── minute (0–59)
│ ┌─────────── hour (0–23)
│ │ ┌───────── day of month (1–31)
│ │ │ ┌─────── month (1–12 or jan–dec)
│ │ │ │ ┌───── day of week (0–7 or sun–sat; 0 and 7 = Sunday)
│ │ │ │ │
* * * * *  command to run
```

| Schedule | Meaning |
|---|---|
| `*/5 * * * *` | every 5 minutes |
| `0 * * * *` | at minute 0 of every hour |
| `30 2 * * *` | 02:30 every day |
| `0 9 * * 1-5` | 09:00 Monday–Friday |
| `0 0 1 * *` | midnight on the 1st of each month |
| `15 3 * * 0` | 03:15 every Sunday |
| `0 8,12,18 * * *` | 08:00, 12:00 and 18:00 |
| `@reboot` | once at startup |
| `@daily` / `@hourly` / `@weekly` | shorthands |

When both day-of-month and day-of-week are restricted, cron runs when **either** matches — `0 0 13 * 5` runs on every 13th *and* every Friday.

## A cron expression explainer

```bash title="explain-cron.sh" playground
explain_field() {          # explain_field VALUE UNIT
  local v=$1 unit=$2
  case $v in
    '*')    echo "every $unit" ;;
    '*/'*)  echo "every ${v#*/} ${unit}s" ;;
    *-*)    echo "${unit}s ${v%-*} to ${v#*-}" ;;
    *,*)    echo "${unit}s ${v//,/, }" ;;
    *)      echo "$unit $v" ;;
  esac
}
explain() {
  local m h dom mon dow
  read -r m h dom mon dow _ <<< "$1"
  echo "$1"
  printf '  minute: %s\n  hour:   %s\n  day:    %s\n  month:  %s\n  weekday: %s\n' \
    "$(explain_field "$m" minute)" "$(explain_field "$h" hour)" \
    "$(explain_field "$dom" day)" "$(explain_field "$mon" month)" "$(explain_field "$dow" weekday)"
}
explain '*/15 * * * *'
explain '30 2 * * 1-5'
```

## Installing jobs

| Where | Format | Who |
|---|---|---|
| `crontab -e` (per user) | 5 fields + command | runs as that user |
| `crontab -l` | list your jobs | |
| `/etc/crontab`, `/etc/cron.d/NAME` | 5 fields + **user** + command | system jobs |
| `/etc/cron.daily/`, `.hourly/`, `.weekly/`, `.monthly/` | executable scripts (no extension on Debian — run-parts ignores names with dots) | root |

A good crontab:

```text
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
MAILTO=ops@example.com

# m  h  dom mon dow  command
*/10 *  *   *   *    flock -n /tmp/sync.lock /usr/local/bin/sync-data.sh >> /var/log/sync-data.log 2>&1
30   2  *   *   *    /usr/local/bin/backup.sh --prune 14 >> /var/log/backup.log 2>&1
0    6  *   *   1    /usr/local/bin/weekly-report.sh "$(date +\%F)" > /dev/null 2>&1
```

## Why jobs work in the terminal but fail in cron

| Cause | Fix |
|---|---|
| minimal `PATH` (`/usr/bin:/bin`) | set `PATH=` in the crontab or the script; use absolute paths |
| runs with `/bin/sh` | `SHELL=/bin/bash`, or a `#!/usr/bin/env bash` script |
| no `~/.bashrc`, no `~/.profile` | put needed variables in the script or crontab |
| working directory is `$HOME` | `cd` explicitly (`cd /srv/app \|\| exit 1`) |
| `%` in the command | escape as `\%` |
| output is mailed or lost | redirect to a log file |
| no terminal, no ssh-agent | use key files explicitly, no interactive prompts |

A quick way to reproduce the cron environment: `env -i HOME=$HOME PATH=/usr/bin:/bin SHELL=/bin/sh /bin/sh -c '/path/to/job.sh'`.

## A cron-ready script

```bash title="cron-ready.sh" playground
#!/usr/bin/env bash
set -euo pipefail
PATH=/usr/local/bin:/usr/bin:/bin          # don't rely on cron's PATH
cd "$HOME"                                 # known working directory
log() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }

lock=/tmp/report-job.lock
if ! mkdir "$lock" 2>/dev/null; then       # flock -n is the robust choice on Linux
  log "previous run still active, skipping"
  exit 0
fi
trap 'rmdir "$lock"' EXIT

log "start"
lines=$(wc -l < logs/access.log)
log "access.log has $lines lines"
log "done"
```

## systemd timers

On systemd systems, timers are a more observable alternative: logs go to the journal, missed runs can catch up (`Persistent=true`), and runs never overlap.

```ini
# /etc/systemd/system/backup.service
[Service]
Type=oneshot
ExecStart=/usr/local/bin/backup.sh

# /etc/systemd/system/backup.timer
[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true
RandomizedDelaySec=10m

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl enable --now backup.timer
systemctl list-timers
journalctl -u backup.service
```

## One-off jobs: at

```bash
echo '/usr/local/bin/restart-app.sh' | at 23:30
at now + 2 hours < job.sh
atq; atrm 7
```

## Common mistakes

```mistake
title: Unescaped % in crontab
wrong: |
  0 1 * * * tar czf /backup/home-$(date +%F).tgz /home
right: |
  0 1 * * * tar czf /backup/home-$(date +\%F).tgz /home
why: Cron turns unescaped % into newlines; everything after the first % becomes stdin of the command.
```

```mistake
title: Overlapping runs
wrong: |
  */5 * * * * /usr/local/bin/sync.sh     # if a run takes 7 minutes, two overlap
right: |
  */5 * * * * flock -n /tmp/sync.lock /usr/local/bin/sync.sh
why: Cron starts jobs on schedule regardless of whether the previous one finished.
```

## Practice

```exercise
kind: mcq
difficulty: beginner
prompt: "What does `0 */6 * * *` mean?"
options:
  - Every 6 minutes
  - At minute 0 every 6 hours (00:00, 06:00, 12:00, 18:00)
  - At 06:00 every day
  - Every 6 days
answer: 1
explanation: "Minute 0; hour field `*/6` = every 6th hour."
```

```exercise
kind: fill
difficulty: intermediate
prompt: "Write the schedule for 07:45 every Monday to Friday."
template: "___ /usr/local/bin/morning-report.sh"
blanks:
  - ["45 7 * * 1-5", "45 07 * * 1-5", "45 7 * * mon-fri", "45 7 * * MON-FRI"]
explanation: "minute 45, hour 7, any day of month, any month, weekdays 1–5."
```

```exercise
kind: mcq
difficulty: intermediate
prompt: "A job runs `backup.sh` fine in your terminal but in cron fails with `aws: command not found`. Most likely cause?"
options:
  - Cron doesn't support aws
  - Cron's PATH doesn't include /usr/local/bin
  - The script lacks a shebang
  - Cron runs jobs as root
answer: 1
explanation: Cron's default PATH is minimal; set PATH or use absolute paths.
```

## Challenge

```exercise
kind: script
difficulty: advanced
title: Does this schedule match?
prompt: "Write `field_matches VALUE FIELD` supporting `*`, a number, `a-b` ranges, `*/n` steps and comma lists, then `cron_matches 'm h dom mon dow' MIN HOUR DOM MON DOW` (assume day-of-month and day-of-week are both ANDed for simplicity). Print `yes`/`no` for each test."
starter: |
  #!/usr/bin/env bash
  field_matches() {
    :
  }
  cron_matches() {
    :
  }
  cron_matches '*/15 * * * *'    30 10 17 11 2 && echo yes || echo no
  cron_matches '*/15 * * * *'    31 10 17 11 2 && echo yes || echo no
  cron_matches '30 2 * * 1-5'    30 2 17 11 2  && echo yes || echo no
  cron_matches '30 2 * * 1-5'    30 2 22 11 6  && echo yes || echo no
  cron_matches '0 8,12,18 * * *' 0 12 1 1 0    && echo yes || echo no
solution: |
  #!/usr/bin/env bash
  field_matches() {
    local spec=$1 v=$2 part
    IFS=, read -ra parts <<< "$spec"
    for part in "${parts[@]}"; do
      case $part in
        '*') return 0 ;;
        '*/'*) (( v % ${part#*/} == 0 )) && return 0 ;;
        *-*) (( v >= ${part%-*} && v <= ${part#*-} )) && return 0 ;;
        *) (( v == part )) && return 0 ;;
      esac
    done
    return 1
  }
  cron_matches() {
    local -a f
    read -ra f <<< "$1"
    shift
    local i
    for i in 0 1 2 3 4; do
      field_matches "${f[i]}" "${@:i+1:1}" || return 1
    done
  }
  cron_matches '*/15 * * * *'    30 10 17 11 2 && echo yes || echo no
  cron_matches '*/15 * * * *'    31 10 17 11 2 && echo yes || echo no
  cron_matches '30 2 * * 1-5'    30 2 17 11 2  && echo yes || echo no
  cron_matches '30 2 * * 1-5'    30 2 22 11 6  && echo yes || echo no
  cron_matches '0 8,12,18 * * *' 0 12 1 1 0    && echo yes || echo no
expectedOutput: |
  yes
  no
  yes
  no
  yes
hints:
  - "Split the spec on commas; the field matches if any part matches."
  - "`${@:i+1:1}` is the (i+1)-th remaining argument."
explanation: "A tiny cron evaluator: each field is a set described by `*`, steps, ranges and lists — exactly how cron itself checks every minute."
```
