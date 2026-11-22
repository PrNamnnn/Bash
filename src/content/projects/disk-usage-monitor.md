## Problem

Servers fill up — usually at 3 a.m., usually because of logs, caches or forgotten backups. You want a script that (a) checks every filesystem against warning and critical thresholds, and (b) when a filesystem is in trouble, shows what is using the space so the person on call can act immediately.

## Requirements

- Usage: `diskmon.sh [-w WARN] [-c CRIT] [-t TOP] [-e FSTYPES] [PATH...]` — defaults: warn 80%, critical 90%, top 5; exclude `tmpfs,devtmpfs,squashfs,overlay` by default.
- Parse `df -P` output (one line per filesystem); skip excluded types and pseudo filesystems.
- Print one line per filesystem: `STATE  USE%  AVAIL  MOUNT`, where STATE is `OK`, `WARN` or `CRIT`.
- For every WARN/CRIT filesystem, list the TOP largest directories directly under the mount point (`du -x -d1` style), largest first, in human units.
- With PATH arguments, report only the filesystems containing those paths.
- Exit with 0 (all OK), 1 (any WARN), 2 (any CRIT) — the monitoring-plugin convention.

## Steps

### Step 1: Read filesystem data

On a real system `df -P -T` gives `Filesystem Type 1024-blocks Used Available Capacity Mounted-on`. Write `fs_data` that prints those lines without the header. (In the playground, `fs_data` returns sample output so the script runs anywhere.)

### Step 2: Classify each line

Read the fields with `while read -r dev type blocks used avail pct mount`, strip the `%`, compare with `(( ))` against the thresholds and track the worst state seen.

### Step 3: Human-readable sizes

Write `human KB` that prints K, M, G or T with one decimal using awk (Bash has no floating point).

### Step 4: Find the space hogs

For filesystems in WARN or CRIT, run `du -x -k -d 1 MOUNT 2>/dev/null | sort -rn | head -n $((TOP + 1))` — the first line is the mount total; skip it.

### Step 5: Options, filters and exit code

Parse options with `getopts`, validate that `WARN < CRIT` and both are 1–100, turn `-e` into a lookup (associative array), and `exit "$worst"`.

### Step 6: Schedule and alert

Run it every 15 minutes from cron and mail or post the output when the status is non-zero.

## Hints

- `df -P` avoids line wrapping for long device names, which breaks naïve parsing.
- `-x` (GNU `du`) stays on one filesystem so `/` doesn't include `/home` or network mounts.
- Collect `du` errors (permission denied) to `/dev/null` or a count — partial results are still useful.
- `IFS=, read -ra types <<< "$exclude"` turns a comma list into an array.
- Compare decimals in awk; percentages from `df` are already integers.

## Expected output

With `-t 3` on the sample data:

```text
WARN    84%     6.2G  /
       ├─    9.8G  /var
       ├─    6.1G  /usr
       └─    2.0G  /opt
CRIT    94%    30.7G  /srv
       ├─  412.0G  /srv/backups
       ├─   38.2G  /srv/www
       └─    1.1G  /srv/tmp
OK      10%   921.6M  /boot
status: CRITICAL (exit 2)
```

## Test cases

| Case | Command | Expect |
|---|---|---|
| defaults | `diskmon.sh` | three lines, hogs for / and /srv, exit 2 |
| thresholds | `diskmon.sh -w 95 -c 98` | everything OK, exit 0 |
| invalid | `diskmon.sh -w 95 -c 90` | usage error, exit 3 |
| path filter | `diskmon.sh /boot` | only `/boot` |
| exclusions | `diskmon.sh -e ''` | tmpfs lines included |
| top size | `diskmon.sh -t 1` | one hog line per problem filesystem |

## Edge cases

- Mount points containing spaces (`df -P` prints them unescaped as the last field — read the rest of the line into one variable).
- Filesystems at 100% with 0 available.
- Read-only or permission-restricted directories in `du`.
- A filesystem that disappears (unmounted) between `df` and `du`.
- Inode exhaustion (`df -i`) — space looks fine but nothing can be created.

## Solution

```bash title="diskmon.sh" playground
#!/usr/bin/env bash
# diskmon.sh — filesystem usage check with space-hog breakdown.
# Exit: 0 OK, 1 WARNING, 2 CRITICAL, 3 UNKNOWN (usage)
set -uo pipefail
PROG=${0##*/}

# Sample data so the script runs in the playground. Real system:
#   fs_data() { df -P -T -k | tail -n +2; }
#   du_top()  { du -x -k -d 1 -- "$1" 2>/dev/null | sort -rn | tail -n +2 | head -n "$2"; }
fs_data() { cat <<'EOF'
/dev/sda1  ext4      41152736  32505640   6533612  84% /
/dev/sdb1  xfs      515928320 483712000  32216320  94% /srv
/dev/sda2  ext4       1048576    104857    943719  10% /boot
tmpfs      tmpfs      2097152         0   2097152   0% /dev/shm
EOF
}
du_top() {
  case $1 in
    /)    printf '%s\t%s\n' 10276045 /var 6396313 /usr 2097152 /opt 812000 /home ;;
    /srv) printf '%s\t%s\n' 432013312 /srv/backups 40055603 /srv/www 1153433 /srv/tmp ;;
  esac | head -n "$2"
}

human() { awk -v k="$1" 'BEGIN { split("K M G T", u); i = 1; while (k >= 1024 && i < 4) { k /= 1024; i++ } printf "%.1f%s", k, u[i] }'; }
usage() { echo "usage: $PROG [-w WARN] [-c CRIT] [-t TOP] [-e FSTYPES] [PATH...]" >&2; exit 3; }

main() {
  local warn=80 crit=90 top=5 exclude="tmpfs,devtmpfs,squashfs,overlay" opt OPTIND
  while getopts ':w:c:t:e:h' opt; do
    case $opt in
      w) warn=$OPTARG ;; c) crit=$OPTARG ;; t) top=$OPTARG ;; e) exclude=$OPTARG ;;
      *) usage ;;
    esac
  done
  shift $((OPTIND - 1))
  [[ $warn =~ ^[0-9]+$ && $crit =~ ^[0-9]+$ && $top =~ ^[1-9][0-9]*$ ]] || usage
  (( warn < crit && crit <= 100 )) || { echo "$PROG: need WARN < CRIT <= 100" >&2; exit 3; }

  declare -A skip=() want=()
  local t p
  IFS=, read -ra types <<< "$exclude"
  for t in "${types[@]}"; do skip[$t]=1; done
  for p in "$@"; do want[$p]=1; done      # simplified: PATH must be a mount point

  local worst=0 dev type blocks used avail pct mount state hogs i n
  while read -r dev type blocks used avail pct mount; do
    [[ -v skip[$type] ]] && continue
    (( $# == 0 )) || [[ -v want[$mount] ]] || continue
    pct=${pct%\%}
    if   (( pct >= crit )); then state=CRIT; (( worst < 2 )) && worst=2
    elif (( pct >= warn )); then state=WARN; (( worst < 1 )) && worst=1
    else state=OK; fi
    printf '%-5s %4s%%  %7s  %s\n' "$state" "$pct" "$(human "$avail")" "$mount"
    [[ $state == OK ]] && continue
    mapfile -t hogs < <(du_top "$mount" "$top")
    n=${#hogs[@]}
    for i in "${!hogs[@]}"; do
      IFS=$'\t' read -r kb path <<< "${hogs[i]}"
      printf '       %s %7s  %s\n' "$( (( i == n - 1 )) && echo '└─' || echo '├─')" "$(human "$kb")" "$path"
    done
  done < <(fs_data)

  local names=(OK WARNING CRITICAL)
  echo "status: ${names[worst]} (exit $worst)"
  return "$worst"
}

main -t 3 "$@"
```

## Explanation

- **`df -P`** guarantees one line per filesystem with fixed columns; `read -r … mount` puts the remainder of the line (even with spaces) into the last variable.
- **Thresholds as integers** — `df` reports whole percentages, so `(( pct >= crit ))` is exact; human-readable sizes use awk because Bash arithmetic is integer-only.
- **Worst-state tracking** turns many checks into one exit status that Nagios, Icinga, Zabbix or a cron wrapper can act on.
- **Breakdown only when needed:** `du` can be slow on big trees, so it runs only for filesystems in trouble, and `-x` keeps it on one filesystem.
- **Data functions are swappable:** `fs_data` and `du_top` isolate the system commands, so the logic can be tested with fixed input — the playground version is exactly that.
- `set -uo pipefail` without `-e`: a monitoring script should report as much as it can rather than die on the first failing `du`.

## Extensions

- Add inode checks (`df -P -i`) with their own thresholds.
- Predict "full in N hours" by storing the previous run's usage in a state file.
- Output in Prometheus textfile format (`node_filesystem_…`) for node_exporter.
- Map each path argument to its filesystem with `df -P PATH` instead of requiring exact mount points.
- Show the largest *files* (`find MOUNT -xdev -type f -size +100M`) as well as directories.
