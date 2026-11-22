---
objectives:
  - List and filter processes with `ps`, `pgrep` and `top`
  - Stop processes gracefully with `kill`/`pkill` and know when to escalate
  - Manage systemd services with `systemctl` and read logs with `journalctl`
  - Write scripts that check whether a process or service is healthy
summary:
  - "`ps aux` or `ps -ef` lists all processes; `ps -o pid,ppid,user,%cpu,%mem,etime,cmd` chooses columns; `pgrep -a name` finds by name."
  - "`kill PID` sends SIGTERM; wait, then `kill -9` only if needed. `pkill -f pattern` matches full command lines — carefully."
  - "systemd: `systemctl status|start|stop|restart|reload|enable|disable NAME`; `systemctl is-active --quiet NAME` for scripts."
  - "Logs: `journalctl -u NAME --since '1 hour ago' -p err`; `-f` follows; `-o cat` prints only messages."
  - "In scripts, prefer machine-readable queries (`is-active`, `show -p`, `ps -o … --no-headers`) over scraping human output."
related:
  - signals-and-trap
  - job-control
  - production-operations
---

## Listing processes

```text
$ ps aux | head -4
USER     PID %CPU %MEM    VSZ   RSS TTY   STAT START   TIME COMMAND
root       1  0.0  0.1 167700 11532 ?     Ss   Nov10   0:12 /sbin/init
www-data 812  1.2  2.3 245112 94012 ?     S    Nov10  42:07 nginx: worker process
postgres 901  0.4  5.1 412300 210232 ?    Ss   Nov10  12:44 postgres: main
```

| Command | Use |
|---|---|
| `ps aux` | everything, BSD-style columns |
| `ps -ef` | everything, POSIX-style (shows PPID) |
| `ps -o pid,ppid,user,%cpu,%mem,etime,cmd -p 812` | chosen columns for one PID |
| `ps -eo pid,%mem,comm --sort=-%mem \| head` | top memory users (GNU) |
| `ps --ppid 812` | children of a process |
| `pstree -p` | the process tree |
| `pgrep -a nginx` | PIDs + command lines matching a name |
| `top` / `htop` | live view (press `q` to quit) |

STAT letters: `R` running, `S` sleeping, `D` uninterruptible (usually I/O), `Z` zombie, `T` stopped; `s` session leader, `+` foreground.

## Parsing ps in scripts

The simulator can't list a real system's processes, so this example parses saved `ps` output — exactly what you'd do with `ps -eo … --no-headers` on a server:

```bash title="ps-parse.sh" playground
ps_output() { cat <<'EOF'
  812 www-data  1.2  2.3 nginx
  813 www-data  0.9  2.1 nginx
  901 postgres  0.4  5.1 postgres
 1450 deploy   97.5 12.8 node
 1777 learner   0.0  0.1 bash
EOF
}
echo "--- processes above 50% CPU:"
ps_output | awk '$3 > 50 { printf "PID %s (%s) using %s%% CPU\n", $1, $5, $3 }'
echo "--- memory by user:"
ps_output | awk '{ mem[$2] += $4 } END { for (u in mem) printf "%-9s %5.1f%%\n", u, mem[u] }' | sort -k2 -rn
```

## Stopping processes

```bash
kill 1450              # SIGTERM: ask nicely
kill -0 1450           # still alive? (status 0 = yes)
kill -9 1450           # SIGKILL: last resort
pkill -u deploy node   # by user and name
pkill -f 'node server.js --port 3000'   # match the full command line
killall nginx          # by exact name (Linux psmisc)
```

`pkill -f` matches anywhere in the command line — `pkill -f sh` would kill every process with "sh" in its arguments. Test the pattern with `pgrep -af` first.

A reusable graceful stop:

```bash
stop_pid() {
  local pid=$1 timeout=${2:-10}
  kill "$pid" 2>/dev/null || return 0          # already gone
  for (( i = 0; i < timeout; i++ )); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 1
  done
  echo "PID $pid ignored SIGTERM, sending SIGKILL" >&2
  kill -9 "$pid"
}
```

## systemd services

Most Linux distributions manage long-running services (nginx, postgres, your app) with **systemd**:

| Command | Effect |
|---|---|
| `systemctl status nginx` | state, PID, recent log lines |
| `sudo systemctl start\|stop\|restart nginx` | control now |
| `sudo systemctl reload nginx` | re-read config without dropping connections (if supported) |
| `sudo systemctl enable --now nginx` | start at boot, and start now |
| `systemctl is-active nginx` | prints active/inactive; exit status 0 if active |
| `systemctl is-enabled nginx` | enabled/disabled |
| `systemctl --failed` | units that failed |
| `systemctl list-units --type=service --state=running` | running services |
| `systemctl show -p MainPID,ActiveState nginx` | machine-readable properties |
| `sudo systemctl daemon-reload` | after editing unit files |

A minimal unit file for your own script, `/etc/systemd/system/report.service`:

```ini
[Unit]
Description=Nightly report generator
After=network-online.target

[Service]
Type=oneshot
User=deploy
ExecStart=/usr/local/bin/report.sh
Environment=REPORT_DIR=/srv/reports
```

## Logs with journalctl

```bash
journalctl -u nginx                    # all logs for a unit
journalctl -u nginx -f                 # follow live
journalctl -u nginx --since "1 hour ago" -p warning
journalctl -b -p err                   # errors since the last boot
journalctl -u app -o cat -n 50         # last 50 messages, text only
journalctl --disk-usage
```

## Health checks in scripts

```bash title="service-check.sh" playground
# Simulated `systemctl is-active` results for the demo
is_active() { case $1 in nginx|postgres|cron) return 0 ;; *) return 3 ;; esac; }

failed=0
for svc in nginx postgres redis cron; do
  if is_active "$svc"; then
    printf '%-10s ok\n' "$svc"
  else
    printf '%-10s DOWN\n' "$svc"
    (( ++failed ))
  fi
done
echo "$failed service(s) down"
(( failed == 0 ))
```

On a real server the function is simply `systemctl is-active --quiet "$1"` — its exit status is the answer, no output parsing needed.

## Common mistakes

```mistake
title: grep matching itself
wrong: |
  if ps aux | grep -q nginx; then echo running; fi   # always true: matches "grep nginx"
right: |
  if pgrep -x nginx > /dev/null; then echo running; fi
why: The grep process's own command line contains the pattern. pgrep excludes itself.
```

```mistake
title: Restarting when a reload would do
wrong: |
  sudo systemctl restart nginx     # drops in-flight connections
right: |
  sudo nginx -t && sudo systemctl reload nginx
why: Many daemons can reload config gracefully. Validate the config first so a typo doesn't take the service down.
```

## Practice

```exercise
kind: mcq
difficulty: beginner
prompt: In a script, which is the most reliable way to check whether the nginx service is running?
options:
  - "`systemctl status nginx | grep -q running`"
  - "`systemctl is-active --quiet nginx`"
  - "`ps aux | grep nginx`"
  - "`ls /var/run/nginx.pid`"
answer: 1
explanation: is-active is designed for scripts — its exit status is the answer.
```

```exercise
kind: mcq
difficulty: intermediate
prompt: "A process doesn't exit after `kill 4242`. What's the best next step?"
options:
  - Immediately `kill -9 4242`
  - Wait a few seconds checking with `kill -0`, then `kill -9` if it's still alive
  - Reboot the server
  - "`kill -HUP 4242`"
answer: 1
explanation: Give it time to clean up; escalate to SIGKILL only if it ignores SIGTERM.
```

```exercise
kind: command
difficulty: intermediate
prompt: "From the saved process list in `/tmp/ps.txt` (create it with `printf '812 nginx 1.2\\n1450 node 97.5\\n901 postgres 0.4\\n' > /tmp/ps.txt`), print the PID of the process using the most CPU (column 3)."
solution: "printf '812 nginx 1.2\\n1450 node 97.5\\n901 postgres 0.4\\n' > /tmp/ps.txt; sort -k3,3nr /tmp/ps.txt | head -1 | cut -d' ' -f1"
explanation: Sort numerically by the CPU column in reverse and take the first line.
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Process report
prompt: "Given the saved `ps -eo user,pid,%cpu,%mem,comm` output in the here-document, print a summary: the number of processes per user (sorted by user), then `top cpu: COMM (PID) X%`."
starter: |
  #!/usr/bin/env bash
  data=$(cat <<'EOF'
  www-data 812 1.2 2.3 nginx
  www-data 813 0.9 2.1 nginx
  postgres 901 0.4 5.1 postgres
  deploy 1450 97.5 12.8 node
  deploy 1460 3.1 1.0 node
  root 1 0.0 0.1 systemd
  EOF
  )
solution: |
  #!/usr/bin/env bash
  data=$(cat <<'EOF'
  www-data 812 1.2 2.3 nginx
  www-data 813 0.9 2.1 nginx
  postgres 901 0.4 5.1 postgres
  deploy 1450 97.5 12.8 node
  deploy 1460 3.1 1.0 node
  root 1 0.0 0.1 systemd
  EOF
  )
  awk '{ n[$1]++ } END { for (u in n) print u, n[u] }' <<< "$data" | sort
  awk '$3 > max { max = $3; line = $5 " (" $2 ") " $3 "%" } END { print "top cpu: " line }' <<< "$data"
expectedOutput: |
  deploy 2
  postgres 1
  root 1
  www-data 2
  top cpu: node (1450) 97.5%
hints:
  - "An awk array keyed by user counts processes."
  - "Track the maximum CPU value and the line that had it."
explanation: "The same awk would work on live `ps -eo user,pid,%cpu,%mem,comm --no-headers` output."
```
