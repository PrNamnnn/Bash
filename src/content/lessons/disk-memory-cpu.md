---
objectives:
  - Check filesystem usage with `df` and find what's using space with `du` and `find`
  - Read memory figures from `free` and `/proc/meminfo` correctly ("available", not "free")
  - Interpret load average and CPU usage with `uptime`, `nproc`, `top` and `vmstat`
  - Write threshold-based monitoring checks that parse these tools' output safely
summary:
  - "`df -h` shows filesystem usage; `df -P` gives one stable line per filesystem for scripts; `df -i` shows inodes."
  - "`du -sh dir/*  | sort -h` finds big directories; `du -x` stays on one filesystem; `find / -xdev -size +500M` finds big files."
  - "`free -h`: look at **available** — Linux uses spare RAM as cache, so \"free\" is normally small."
  - "Load average (1/5/15 min) counts runnable + uninterruptible tasks; compare it to `nproc`."
  - "Monitoring scripts: parse POSIX/stable output formats, compare numbers with `(( ))`, and exit non-zero on breach."
related:
  - processes-and-services
  - backups-and-health-checks
  - awk-programs
---

## Disk space: df

```text
$ df -h
Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1        40G   31G  7.2G  82% /
/dev/sdb1       500G  461G   39G  93% /srv
tmpfs           2.0G     0  2.0G   0% /dev/shm
```

| Option | Purpose |
|---|---|
| `-h` | human-readable sizes |
| `-P` | POSIX format: one line per filesystem, fixed columns — use in scripts |
| `-T` | show filesystem type |
| `-i` | inode usage (a disk can be "full" with free space if it runs out of inodes) |
| `df /path` | the filesystem containing that path |
| `--output=pcent,target` | GNU: only the columns you want |

```bash title="df-check.sh" playground
df_output() { cat <<'EOF'
Filesystem     1024-blocks      Used Available Capacity Mounted on
/dev/sda1         41152736  32505640   6533612      84% /
/dev/sdb1        515928320 483712000  32216320      94% /srv
tmpfs              2097152         0   2097152       0% /dev/shm
EOF
}
threshold=90
df_output | awk -v t="$threshold" 'NR > 1 { pct = $5; sub(/%/, "", pct)
  if (pct + 0 >= t) printf "CRITICAL %s at %s%%\n", $6, pct
  else              printf "ok       %s at %s%%\n", $6, pct }'
```

## What is using the space: du

```bash
du -sh /var/log                      # total for one directory
du -h --max-depth=1 /srv | sort -h   # per subdirectory, smallest → largest
du -xh / 2>/dev/null | sort -h | tail -20      # biggest dirs on the root filesystem
find /srv -xdev -type f -size +500M -exec ls -lh {} +   # big files
```

```bash title="du.sh" playground
du -sh ~/logs ~/data ~/projects
du -a ~/logs | sort -n | tail -3
```

Deleted-but-open files still use space until the process closes them — if `df` and `du` disagree, check `lsof +L1`.

## Memory: free

```text
$ free -h
               total        used        free      shared  buff/cache   available
Mem:           7.7Gi       2.1Gi       312Mi        64Mi       5.3Gi       5.2Gi
Swap:          2.0Gi          0B       2.0Gi
```

Linux keeps recently used file data in RAM (**buff/cache**) and releases it when programs need memory. So:

- **free** is small on a healthy machine — that's good, not bad.
- **available** is what new programs can get. Alert on that.
- Steady **swap** use with low available memory means real memory pressure; the OOM killer (status 137 for victims) may follow.

```bash title="meminfo.sh" playground
meminfo() { cat <<'EOF'
MemTotal:        8048576 kB
MemFree:          319488 kB
MemAvailable:    5452595 kB
Buffers:          204800 kB
Cached:          5341184 kB
SwapTotal:       2097148 kB
SwapFree:        2097148 kB
EOF
}
meminfo | awk '/^MemTotal/ { t = $2 } /^MemAvailable/ { a = $2 }
  END { printf "available: %.1f GiB of %.1f GiB (%.0f%%)\n", a/1048576, t/1048576, a*100/t }'
```

On a real system, read `/proc/meminfo` directly instead of the function.

## CPU and load

```text
$ uptime
 10:42:01 up 7 days,  3:12,  2 users,  load average: 3.84, 2.10, 1.05
$ nproc
4
```

**Load average** = average number of tasks running or waiting (for CPU or uninterruptible I/O) over 1, 5 and 15 minutes. Divide by the number of CPUs: on 4 cores, 3.84 is busy but OK; 12 would mean heavy queuing. A rising 1-minute value with low 15-minute value means load just started.

| Tool | Shows |
|---|---|
| `top` / `htop` | live per-process CPU and memory |
| `vmstat 1 5` | CPU split (us/sy/id/wa), run queue, swap activity, every second |
| `iostat -x 1` | per-disk utilisation (sysstat package) |
| `mpstat -P ALL 1` | per-CPU usage |
| `/proc/loadavg` | load figures for scripts |

High `wa` (iowait) in vmstat means CPUs are idle waiting for disk — the bottleneck is storage, not compute.

```bash title="load.sh" playground
cores=$(nproc)
read -r one five fifteen _ <<< "3.84 2.10 1.05 2/311 4242"    # contents of /proc/loadavg
per_core=$(awk -v l="$one" -v c="$cores" 'BEGIN { printf "%.2f", l / c }')
echo "load $one on $cores cores = $per_core per core"
awk -v p="$per_core" 'BEGIN { exit !(p > 1.5) }' && echo "ALERT: overloaded" || echo "load ok"
```

Bash arithmetic is integer-only, so compare decimals in awk (or multiply by 100 first).

## Common mistakes

```mistake
title: Parsing df -h output
wrong: |
  df -h | grep /srv | awk '{print $5}'   # long device names wrap onto two lines; units vary
right: |
  df -P /srv | awk 'NR == 2 { sub(/%/, "", $5); print $5 }'
why: "`-P` guarantees one line per filesystem, and asking about a specific path avoids grep matching other mounts."
```

```mistake
title: Alerting on "free" memory
wrong: |
  free_mb=$(free -m | awk '/Mem:/ {print $4}')
  (( free_mb < 500 )) && alert "low memory"    # fires constantly on healthy servers
right: |
  avail_mb=$(free -m | awk '/Mem:/ {print $7}')
  (( avail_mb < 500 )) && alert "low memory"
why: Linux uses free RAM as cache; "available" accounts for cache that can be reclaimed.
```

## Practice

```exercise
kind: mcq
difficulty: intermediate
prompt: "`free` shows 300 MiB free and 5 GiB available on an 8 GiB server. What does that mean?"
options:
  - The server is almost out of memory
  - Most RAM is used as reclaimable cache; about 5 GiB can still be given to programs
  - Swap is broken
  - A memory leak is certain
answer: 1
explanation: "Available includes cache the kernel will release on demand."
```

```exercise
kind: mcq
difficulty: intermediate
prompt: "Which command lists the sizes of the subdirectories of /var, sorted from largest to smallest?"
options:
  - "`ls -lS /var`"
  - "`du -sh /var/* | sort -rh`"
  - "`df -h /var`"
  - "`find /var -size +1M`"
answer: 1
explanation: "`du -s` per entry, `sort -h` understands K/M/G suffixes, `-r` reverses."
```

```exercise
kind: command
difficulty: intermediate
prompt: "Given `line='/dev/sdb1 515928320 483712000 32216320 94% /srv'`, print just the number `94` using parameter expansion or awk."
solution: line='/dev/sdb1 515928320 483712000 32216320 94% /srv'; awk '{ sub(/%/, "", $5); print $5 }' <<< "$line"
explanation: "Field 5 holds the percentage; strip the `%` before using it as a number."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Resource check with exit codes
prompt: "Using the provided sample data, print `disk /srv 94% CRITICAL` style lines (WARN at ≥80, CRITICAL at ≥90, otherwise OK) for each filesystem, then exit with status 2 if any is CRITICAL, 1 if any WARN, else 0 (print `exit N` before exiting so it's visible)."
starter: |
  #!/usr/bin/env bash
  sample='/dev/sda1 41152736 32505640 6533612 84% /
  /dev/sdb1 515928320 483712000 32216320 94% /srv
  /dev/sdc1 1048576 104857 943719 10% /backup'
solution: |
  #!/usr/bin/env bash
  sample='/dev/sda1 41152736 32505640 6533612 84% /
  /dev/sdb1 515928320 483712000 32216320 94% /srv
  /dev/sdc1 1048576 104857 943719 10% /backup'
  worst=0
  while read -r _ _ _ _ pct mount; do
    pct=${pct%\%}
    if (( pct >= 90 )); then state=CRITICAL; (( worst < 2 )) && worst=2
    elif (( pct >= 80 )); then state=WARN; (( worst < 1 )) && worst=1
    else state=OK
    fi
    echo "disk $mount $pct% $state"
  done <<< "$sample"
  echo "exit $worst"
  exit "$worst"
expectedOutput: |
  disk / 84% WARN
  disk /srv 94% CRITICAL
  disk /backup 10% OK
  exit 2
hints:
  - "`${pct%\\%}` removes the trailing percent sign."
  - "Track the worst state seen as a number: 0 OK, 1 WARN, 2 CRITICAL."
explanation: "Exit codes 0/1/2 match the Nagios/Icinga plugin convention, so the same script can feed a monitoring system."
```
