---
objectives:
  - Investigate incidents quickly with a repeatable triage checklist
  - Slice large logs by time, status and frequency with standard tools
  - Write runbook scripts that are safe to run under pressure
  - Manage log growth with rotation, and change production systems carefully
summary:
  - "Triage order: what changed? → is it up (health, errors)? → resources (disk, memory, CPU, connections) → logs around the start time."
  - "Log analysis toolkit: `grep -c`, `awk` field filters, `sort | uniq -c | sort -rn | head`, time windows with `awk '$4 >= \"[17/Nov/2026:10:00\"'`."
  - "Runbook scripts are read-only by default, print what they check, and require an explicit flag for any action."
  - "Rotate logs with logrotate (`size`, `rotate`, `compress`, `copytruncate` or a reload)."
  - "Change safely: one change at a time, a backup or rollback plan, announce it, verify, and record what you did."
related:
  - log-parsing
  - processes-and-services
  - backups-and-health-checks
---

## The triage checklist

When something is wrong in production, a calm, fixed routine beats inspiration:

| Step | Questions | Typical commands |
|---|---|---|
| 1. Scope | What exactly is broken, for whom, since when? | alerts, dashboards, user reports |
| 2. Changes | Was anything deployed, configured or migrated recently? | deploy log, `git log -5`, `journalctl --since` |
| 3. Health | Are services up? Error rate? | `systemctl --failed`, `curl -fsS …/health` |
| 4. Resources | Disk, memory, CPU, file descriptors, connections | `df -h`, `free -h`, `uptime`, `ss -s` |
| 5. Logs | What happened just before it started? | `journalctl -u app --since "10:00"`, `tail -f` |
| 6. Mitigate | Roll back, restart, scale, block bad traffic | prepared runbook commands |
| 7. Follow up | Root cause, prevention, timeline | post-incident review |

Mitigation first, diagnosis second: rolling back a bad deploy restores service while you investigate.

## Slicing logs

The access log in the simulator uses the standard combined format:

```bash title="log-triage.sh" playground
log=~/logs/access.log
echo "== requests: $(wc -l < "$log")"
echo "== status codes"
awk '{ print $9 }' "$log" | sort | uniq -c | sort -rn
echo "== top client IPs"
awk '{ print $1 }' "$log" | sort | uniq -c | sort -rn | head -3
echo "== 5xx errors"
awk '$9 >= 500 { print $4, $7, $9 }' "$log" | tr -d '['
echo "== suspicious paths (404s)"
awk '$9 == 404 { print $7 }' "$log" | sort | uniq -c | sort -rn
```

| Need | Pattern |
|---|---|
| count matches | `grep -c PATTERN file` |
| per-minute rate | `awk '{ print substr($4, 2, 17) }' access.log \| uniq -c` |
| time window | `awk '$4 >= "[17/Nov/2026:10:00" && $4 < "[17/Nov/2026:10:15"'` |
| slowest requests (if logged) | `sort -k11,11nr access.log \| head` |
| follow + filter live | `tail -F app.log \| grep --line-buffered ERROR` |
| compressed rotations | `zgrep`, `zcat app.log.*.gz \| grep …` |
| journald, structured | `journalctl -u app -o json \| jq -r 'select(.PRIORITY=="3") .MESSAGE'` |

`tail -F` (capital F) keeps following when the file is rotated; `-f` stops at the old file.

## Runbook scripts

A runbook script turns a page of instructions into one command that anyone on call can run at 3 a.m.:

```bash title="runbook.sh" playground
#!/usr/bin/env bash
# runbook: diagnose "checkout errors" — read-only unless --fix is given
set -euo pipefail
FIX=0; [[ ${1:-} == --fix ]] && FIX=1
section() { printf '\n== %s\n' "$*"; }

section "recent checkout errors"
grep 'ERROR \[checkout\]' ~/logs/app.log | tail -3

section "error count by module"
awk '$2 == "ERROR" { gsub(/[][]/, "", $3); n[$3]++ } END { for (m in n) print n[m], m }' ~/logs/app.log | sort -rn

section "gateway timeouts in the last log"
timeouts=$(grep -c 'gateway timeout' ~/logs/app.log || true)
echo "$timeouts timeout(s)"

section "suggested action"
if (( timeouts >= 2 )); then
  if (( FIX )); then
    echo "would run: systemctl restart payment-proxy   (simulated)"
  else
    echo "payment gateway timeouts detected — rerun with --fix to restart payment-proxy"
  fi
else
  echo "no action needed"
fi
```

Principles:

- **Read-only by default**; actions need an explicit flag (`--fix`, `--yes`).
- **Explain** each check in its output, so the reader learns the system.
- **Idempotent** actions — safe to run twice.
- **Fast**: no long scans without warning; timeouts on network calls.
- **Versioned** with the service, reviewed like code.

## Log rotation

Logs grow until the disk fills. `logrotate` (run daily by cron or a systemd timer) renames, compresses and deletes old logs:

```text
# /etc/logrotate.d/myapp
/var/log/myapp/*.log {
    daily
    rotate 14            # keep 14 old files
    compress             # gzip them
    delaycompress        # keep yesterday's uncompressed for easy reading
    missingok
    notifempty
    maxsize 500M         # rotate early if it grows fast
    postrotate
        systemctl reload myapp > /dev/null 2>&1 || true
    endscript
}
```

The app must reopen its log file after rotation — via the `postrotate` reload, or `copytruncate` (copies then truncates in place; may lose a few lines). Test with `logrotate -d /etc/logrotate.d/myapp` (dry run).

Emergency: if a disk is full because of a huge log that a process still has open, **truncate** it (`: > /var/log/myapp/app.log`) rather than deleting it — deleting doesn't free space until the process closes the file.

## Changing production safely

1. **One change at a time**, so you know what caused any effect.
2. **Have a way back**: backup the file (`cp -a nginx.conf nginx.conf.$(date +%F-%H%M)`), or a rollback command.
3. **Validate before applying**: `nginx -t`, `visudo -c`, `sshd -t`, `systemd-analyze verify`, `jq . config.json`.
4. **Apply gently**: `reload` rather than `restart`; one server before all.
5. **Verify** the result and watch metrics for a few minutes.
6. **Record** what you did and when (ticket, chat, change log).

Never edit remote SSH or firewall settings without a second session open — a mistake can lock you out.

## Common mistakes

```mistake
title: Deleting an open log to free space
wrong: |
  rm /var/log/myapp/app.log       # df still shows the disk full
right: |
  : > /var/log/myapp/app.log      # truncate in place; space is freed immediately
why: A deleted file's space is released only when the last process closes it.
```

```mistake
title: Restarting before capturing evidence
wrong: |
  systemctl restart app    # the broken state — and its clues — are gone
right: |
  journalctl -u app --since "-15min" > /tmp/incident-app.log
  ss -tanp > /tmp/incident-sockets.txt
  systemctl restart app
why: Mitigation matters, but a minute spent saving logs and state makes the root cause findable later.
```

## Practice

```exercise
kind: mcq
difficulty: intermediate
prompt: "The site is down right after a deploy. What should you usually do first?"
options:
  - Read the new code to find the bug
  - Roll back to the previous release, then investigate
  - Reboot the server
  - Increase the server size
answer: 1
explanation: Restore service with the fastest known-good path; debug afterwards.
```

```exercise
kind: command
difficulty: intermediate
prompt: "Print the three most frequent HTTP status codes in `~/logs/access.log` with their counts, most frequent first (`uniq -c` format)."
solution: awk '{ print $9 }' ~/logs/access.log | sort | uniq -c | sort -rn | head -3
explanation: "Extract the field, count with sort | uniq -c, rank with sort -rn."
```

```exercise
kind: mcq
difficulty: intermediate
prompt: "Why use `tail -F` rather than `tail -f` to watch a log in production?"
options:
  - It's faster
  - It keeps following the file by name after log rotation replaces it
  - It shows full lines only
  - It filters errors
answer: 1
explanation: "-F = --follow=name --retry: when the file is rotated, tail reopens the new file."
```

## Challenge

```exercise
kind: script
difficulty: advanced
title: Incident summary
prompt: "Write an incident summary for `~/logs/access.log`: print `total: N`, `errors: N (P%)` where errors are status ≥ 400 and P is rounded to the nearest integer, then `worst path: PATH (N errors)` for the path with most error responses (ties: alphabetical)."
starter: |
  #!/usr/bin/env bash
  log=~/logs/access.log
solution: |
  #!/usr/bin/env bash
  log=~/logs/access.log
  read -r total errors < <(awk '{ t++ } $9 >= 400 { e++ } END { print t, e + 0 }' "$log")
  echo "total: $total"
  echo "errors: $errors ($(( (errors * 100 + total / 2) / total ))%)"
  read -r n path < <(awk '$9 >= 400 { print $7 }' "$log" | sort | uniq -c | sort -k1,1nr -k2,2 | head -1)
  echo "worst path: $path ($n errors)"
expectedOutput: |
  total: 30
  errors: 8 (27%)
  worst path: /api/checkout (2 errors)
hints:
  - "One awk pass can count the total and the errors; print both and `read` them."
  - "Rounded integer percentage in Bash: `(errors * 100 + total / 2) / total`."
  - "For the worst path: error paths → `sort | uniq -c` → rank with `sort -k1,1nr -k2,2`."
explanation: "awk does the counting in one pass, Bash does the formatting, and the classic `sort | uniq -c | sort -rn` pipeline finds the hotspot."
```
