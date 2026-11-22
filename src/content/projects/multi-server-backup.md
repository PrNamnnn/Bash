## Problem

You manage a fleet of servers listed in an inventory file. Each night, selected directories on every server must be pulled to a central backup host over SSH — in parallel so the job finishes in time, with per-host logs, timeouts so one dead host can't stall the run, and a summary that says exactly which hosts failed and why.

## Requirements

- Inventory: `NAME ADDRESS STATE [PATHS]` per line (like `~/data/servers.txt`); skip comments, blank lines and hosts whose state isn't `running`.
- Usage: `fleet-backup.sh [-j JOBS] [-t TIMEOUT] [-n] [-i INVENTORY] [DEST]` — default 4 parallel jobs, 300 s timeout per host, destination `/srv/backups`.
- For each host: test connectivity (`ssh -o BatchMode=yes -o ConnectTimeout=5 HOST true`), then `rsync -az --delete --link-dest=PREVIOUS HOST:PATH DEST/HOST/TIMESTAMP/` for each path.
- Run at most JOBS hosts at once; each host's output goes to `DEST/logs/HOST.log`, never interleaved on the terminal.
- Each host ends with one status: `ok`, `unreachable`, `timeout` or `failed (exit N)`.
- Print a summary table sorted by host name, and exit 0 only if every host succeeded.
- `-n` dry run: show what would run for each host.

## Steps

### Step 1: Parse the inventory

Read the inventory with `while read -r name addr state paths`, skipping comments and non-running hosts; default PATHS to `/etc /srv`. Store hosts in arrays.

### Step 2: Back up one host

Write `backup_host NAME ADDR PATHS…` that checks reachability (exit status 255 from ssh means a connection problem), then runs rsync for each path with `timeout "$TIMEOUT"`, writing everything to the host's log file. Its exit status encodes the result.

### Step 3: Run hosts in parallel with a limit

Start each `backup_host` in the background, record `pid → host` in an associative array, and when JOBS are running, `wait -n` for one to finish. Write each result to `RESULT_DIR/HOST` so the parent can read it later (variables don't come back from background jobs).

### Step 4: Map exit codes to statuses

`timeout` exits 124 when it kills the command; ssh exits 255 on connection failures; rsync has its own codes (23 = partial transfer). Translate them into readable statuses.

### Step 5: Summary and exit code

After `wait`, read every result file, print the table, count failures and exit accordingly. Clean up the result directory with an EXIT trap.

### Step 6: Incremental snapshots

Use `--link-dest=../PREVIOUS` so unchanged files are hard links to the previous snapshot: every snapshot looks complete but only changed files take space.

## Hints

- Background jobs can't set variables in the parent; communicate through files (one per host) or the exit status from `wait PID`.
- `wait -n` needs Bash 4.3+; a portable alternative is polling `jobs -rp | wc -l`.
- Redirect each job's whole output: `backup_host … > "$LOG_DIR/$name.log" 2>&1 &`.
- `ssh -n` (or `< /dev/null`) stops ssh from eating the inventory being read by the loop.
- Test the concurrency logic with stub functions that `sleep` random amounts before you point it at real servers.

## Expected output

```text
$ fleet-backup.sh -j 2 /srv/backups
started web01 (pid 4201)
started web02 (pid 4202)
started db01 (pid 4205)
started mail01 (pid 4207)

HOST     STATUS            DURATION  LOG
db01     ok                41s       /srv/backups/logs/db01.log
mail01   unreachable       5s        /srv/backups/logs/mail01.log
web01    ok                12s       /srv/backups/logs/web01.log
web02    timeout           300s      /srv/backups/logs/web02.log
2/4 hosts backed up (skipped: cache01: stopped)
```

(Durations are from a real run; in the simulator background jobs finish instantly, so they show `0s`.)

## Test cases

| Case | Setup | Expect |
|---|---|---|
| all reachable | stubs succeed | all `ok`, exit 0 |
| unreachable host | ssh stub returns 255 | `unreachable`, other hosts unaffected, exit 1 |
| slow host | rsync stub exceeds timeout | `timeout` |
| concurrency | `-j 2` with 5 hosts | never more than 2 running (log timestamps) |
| dry run | `-n` | commands listed per host, nothing transferred |
| comments/stopped | inventory with `#` lines and a stopped host | skipped and reported |
| no hosts | empty inventory | "no hosts to back up", exit 0 |

## Edge cases

- Host names that are not valid file names (sanitise before using them in paths).
- The first backup of a host (no previous snapshot for `--link-dest`).
- The destination filling up mid-run — later hosts fail; the summary must say so.
- Hosts that appear twice in the inventory.
- Interrupting the run with Ctrl+C: kill all running jobs and print a partial summary.

## Solution

```bash title="fleet-backup.sh" playground
#!/usr/bin/env bash
# fleet-backup.sh — parallel SSH/rsync backups of every running host in an inventory.
set -uo pipefail
PROG=${0##*/}
JOBS=4 TIMEOUT=300 DRY_RUN=0 INVENTORY=$HOME/data/servers.txt DEST=/tmp/fleet-backups

# --- remote operations (stubbed for the playground). Real versions:
#   reachable()  { ssh -n -o BatchMode=yes -o ConnectTimeout=5 "$1" true; }
#   pull_path()  { timeout "$TIMEOUT" rsync -az --delete ${3:+--link-dest="$3"} "$1:$2" "$4/"; }
reachable() { [[ $1 != 10.0.2.21 ]]; }                          # mail01 is down in this demo
pull_path() {                                                     # pull_path ADDR PATH LINKDEST TARGET
  case $1 in
    10.0.1.12) return 124 ;;                                      # web02 times out
    *) mkdir -p "$4${2}"; echo "copied $1:$2" ;;
  esac
}

backup_host() {   # backup_host NAME ADDR PATHS... — exit 0 ok, 2 unreachable, 124 timeout, other failed
  local name=$1 addr=$2; shift 2
  local stamp target prev path rc=0
  stamp=$(date +%Y%m%d-%H%M%S)
  target="$DEST/$name/$stamp"
  prev=$(ls -1d "$DEST/$name"/*/ 2>/dev/null | sort | tail -n 1)
  echo "[$(date +%T)] $name ($addr): starting"
  if (( DRY_RUN )); then
    for path in "$@"; do echo "would run: rsync -az --delete ${prev:+--link-dest=$prev} $addr:$path $target/"; done
    return 0
  fi
  reachable "$addr" || { echo "cannot connect to $addr"; return 2; }
  mkdir -p "$target"
  for path in "$@"; do
    pull_path "$addr" "$path" "$prev" "$target" || { rc=$?; echo "rsync of $path failed with $rc"; break; }
  done
  (( rc == 0 )) && echo "[$(date +%T)] $name: done" || rm -rf -- "$target"
  return "$rc"
}

describe() {
  case $1 in
    0) echo ok ;; 2) echo unreachable ;; 124) echo timeout ;; *) echo "failed (exit $1)" ;;
  esac
}

main() {
  local opt OPTIND
  while getopts ':j:t:ni:h' opt; do
    case $opt in
      j) JOBS=$OPTARG ;; t) TIMEOUT=$OPTARG ;; n) DRY_RUN=1 ;; i) INVENTORY=$OPTARG ;;
      *) echo "usage: $PROG [-j JOBS] [-t TIMEOUT] [-n] [-i INVENTORY] [DEST]" >&2; exit 2 ;;
    esac
  done
  shift $((OPTIND - 1))
  DEST=${1:-$DEST}
  [[ $JOBS =~ ^[1-9][0-9]*$ && $TIMEOUT =~ ^[1-9][0-9]*$ ]] || { echo "$PROG: -j and -t need positive integers" >&2; exit 2; }
  [[ -r $INVENTORY ]] || { echo "$PROG: cannot read $INVENTORY" >&2; exit 2; }

  RESULTS=$(mktemp -d)                      # global: the EXIT trap runs after main has returned
  trap 'rm -rf -- "$RESULTS"' EXIT
  mkdir -p "$DEST/logs"

  local name addr state paths skipped=() pid
  declare -A host_of=() started=()
  while read -r name addr state paths; do
    [[ -z $name || $name == \#* ]] && continue
    [[ $state == running ]] || { skipped+=("$name: $state"); continue; }
    [[ -v started[$name] ]] && continue
    read -ra path_list <<< "${paths:-/etc /srv}"
    started[$name]=$(date +%s)
    (
      begin=$(date +%s)
      backup_host "$name" "$addr" "${path_list[@]}" > "$DEST/logs/$name.log" 2>&1
      rc=$?
      echo "$rc $(( $(date +%s) - begin ))" > "$RESULTS/$name"
      exit "$rc"
    ) &
    pid=$!
    host_of[$pid]=$name
    echo "started $name (pid $pid)"
    while (( $(jobs -rp | wc -l) >= JOBS )); do wait -n; done
  done < "$INVENTORY"
  wait

  (( ${#started[@]} )) || { echo "no hosts to back up"; return 0; }
  local ok=0 total=0 rc secs
  printf '\n%-8s %-17s %-9s %s\n' HOST STATUS DURATION LOG
  for name in $(printf '%s\n' "${!started[@]}" | sort); do
    read -r rc secs < "$RESULTS/$name" || { rc=99 secs=0; }
    (( ++total )); (( rc == 0 )) && (( ++ok ))
    printf '%-8s %-17s %-9s %s\n' "$name" "$(describe "$rc")" "${secs}s" "$DEST/logs/$name.log"
  done
  local note=""; (( ${#skipped[@]} )) && note=" (skipped: ${skipped[*]})"
  echo "$ok/$total hosts backed up$note"
  (( ok == total ))
}

main -j 2 "$@"
echo "--- web01 log:"; cat /tmp/fleet-backups/logs/web01.log
echo "--- mail01 log:"; cat /tmp/fleet-backups/logs/mail01.log
```

## Explanation

- **Bounded parallelism:** each host runs in a background subshell; `while (( $(jobs -rp | wc -l) >= JOBS )); do wait -n; done` keeps at most JOBS running and starts the next host as soon as one finishes.
- **Results through files:** background jobs can't set the parent's variables, so each writes `exit-code duration` to `results/HOST`. The parent reads them after `wait`.
- **Per-host logs** keep the terminal readable and give whoever investigates a failure the full rsync output for that host only.
- **Exit codes carry meaning:** 255 from ssh (connection), 124 from `timeout`, rsync's own codes — `describe` turns them into words.
- **`--link-dest` snapshots:** every snapshot directory is a complete tree, but unchanged files are hard links to the previous snapshot, so a nightly backup costs only the changed data.
- **Failed snapshots are removed** so the next run's `--link-dest` never points at an incomplete tree.
- `set -uo pipefail` without `-e`: one host failing must not abort the others.
- **The EXIT trap uses a global** (`RESULTS`): a `local` variable would be out of scope by the time the trap runs at script exit, and `set -u` would report it as unbound.

## Extensions

- Handle Ctrl+C: trap INT/TERM, kill running jobs (`kill $(jobs -p)`), print a partial summary.
- Retention per host (keep 14 dailies, 8 weeklies) using the snapshot timestamps.
- Push a metric per host (`backup_last_success_timestamp`) for alerting.
- Pre-backup hooks: run `pg_dump` remotely before rsync for database hosts.
- Read the inventory from your cloud provider's API or an Ansible inventory.
