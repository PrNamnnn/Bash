## Problem

A worker process on a server crashes occasionally — out of memory, a bad message, a lost database connection. Until someone notices, jobs pile up. You want a small supervisor that starts the worker, restarts it when it dies with an increasing delay (so a crash loop doesn't hammer the system), gives up and alerts after too many failures in a short window, and shuts everything down cleanly on SIGTERM.

(On a systemd system you'd normally use `Restart=on-failure` — building this yourself teaches exactly what such supervisors do.)

## Requirements

- Usage: `supervise.sh [-r MAX_RESTARTS] [-w WINDOW] [-b BASE_DELAY] [-m MAX_DELAY] -- COMMAND ARGS...`
- Start COMMAND as a child process and wait for it.
- On a non-zero exit, restart after a delay that doubles each time (`BASE_DELAY`, `2×`, `4×` … capped at `MAX_DELAY`); a clean exit (status 0) stops supervision unless `-a` (always restart) is given.
- If more than MAX_RESTARTS restarts happen within WINDOW seconds, stop and send an alert (call an `alert` function), exiting 1.
- Reset the backoff after the process has stayed up for longer than WINDOW.
- On SIGTERM/SIGINT: forward the signal to the child, wait up to 10 seconds, then SIGKILL; exit 0 after a requested shutdown.
- Log every event with a timestamp: start (with PID), exit (with status and signal name), restart delay, give-up.

## Steps

### Step 1: Start and wait

Start the command in the background (`"$@" &`), save `child=$!`, and `wait "$child"`. Log the exit status; statuses above 128 mean "killed by signal N−128" (`kill -l $((status - 128))` names it).

### Step 2: Restart loop with backoff

Wrap step 1 in `while true`. After each failure, sleep `delay` then double it (`delay=$(( delay * 2 > max ? max : delay * 2 ))`).

### Step 3: Crash-loop detection

Keep the timestamps of recent restarts in an array; drop those older than WINDOW; if the array grows beyond MAX_RESTARTS, give up.

### Step 4: Backoff reset

Record when the child started; if it ran longer than WINDOW before failing, reset `delay` to BASE_DELAY and clear the restart history.

### Step 5: Graceful shutdown

`trap on_term TERM INT` where `on_term` sets `stopping=1`, sends the signal to the child, waits with a deadline, then kills it hard if needed. Make sure `wait` being interrupted by the trap is handled (wait returns >128 when a trapped signal arrives).

### Step 6: Alerting

Implement `alert MESSAGE` (log + `logger`, mail or a webhook) and call it when giving up.

## Hints

- `wait` returns immediately when a trapped signal arrives; loop on `kill -0 "$child"` to know whether the child is really gone.
- `$EPOCHSECONDS` (Bash 5) or `date +%s` gives timestamps for the window arithmetic.
- Run the child in the background even though you wait for it immediately — that's what lets the trap run while waiting.
- Test with a fake worker: `bash -c 'sleep 2; exit 1'` crashes on schedule.
- Exit statuses 126/127 mean the command can't be executed/found: restarting won't help — give up at once.

## Expected output

```text
[10:00:00] started worker (pid 4201)
[10:00:02] worker exited with status 1
[10:00:02] restarting in 1s (restart 1 in window)
[10:00:03] started worker (pid 4210)
[10:00:05] worker exited with status 1
[10:00:05] restarting in 2s (restart 2 in window)
[10:00:07] started worker (pid 4221)
[10:00:09] worker killed by signal KILL (status 137)
[10:00:09] restarting in 4s (restart 3 in window)
[10:00:13] started worker (pid 4232)
[10:00:15] worker exited with status 1
[10:00:15] giving up: 4 restarts within 60s
ALERT: worker is crash-looping on bash-mastery
```

## Test cases

| Case | Worker | Expect |
|---|---|---|
| clean exit | `true` | logged once, supervisor exits 0 |
| crash loop | `false` | backoff 1, 2, 4…; give up after MAX_RESTARTS; exit 1; alert |
| occasional crash | fails after a long uptime | backoff reset each time; never gives up |
| killed | `kill -9` the child | status 137 reported as signal KILL; restarted |
| shutdown | SIGTERM to the supervisor | child receives TERM, supervisor exits 0, no restart |
| stubborn child | child ignores TERM | SIGKILL after 10 s |
| not found | `nonexistent-cmd` | status 127, immediate give-up |

## Edge cases

- The child spawning its own children (signal the process group instead of the PID).
- Signals arriving during the backoff `sleep`.
- Clock changes affecting the window (prefer a monotonic source like `$SECONDS`).
- The child writing a lot of output — redirect to a log with rotation.
- Running two supervisors for the same worker (use a PID/lock file).

## Solution

```bash title="supervise.sh" playground
#!/usr/bin/env bash
# supervise.sh — restart a command with exponential backoff and crash-loop protection.
set -uo pipefail
PROG=${0##*/}
MAX_RESTARTS=3 WINDOW=60 BASE_DELAY=1 MAX_DELAY=30 ALWAYS=0
child="" stopping=0

log()   { printf '[%s] %s\n' "$(date +%T)" "$*"; }
alert() { log "ALERT: $*"; echo "ALERT: $*" >&2; }   # real: logger -t supervise -p user.crit "$*"; curl … webhook

describe_exit() {
  local st=$1
  if (( st > 128 && st < 160 )); then echo "killed by signal $(kill -l $((st - 128))) (status $st)"
  else echo "exited with status $st"; fi
}

on_term() {
  stopping=1
  log "shutdown requested; stopping child ${child:-none}"
  [[ -n $child ]] && kill -TERM "$child" 2>/dev/null
  local i
  for (( i = 0; i < 10; i++ )); do
    [[ -n $child ]] && kill -0 "$child" 2>/dev/null || break
    sleep 1
  done
  [[ -n $child ]] && kill -0 "$child" 2>/dev/null && { log "child ignored TERM; sending KILL"; kill -KILL "$child"; }
}

supervise() {
  local name=${1##*/} delay=$BASE_DELAY started st now
  local -a restarts=()
  trap on_term TERM INT
  while (( ! stopping )); do
    "$@" &
    child=$!
    started=$SECONDS
    log "started $name (pid $child)"
    wait "$child"; st=$?
    while (( ! stopping )) && kill -0 "$child" 2>/dev/null; do wait "$child"; st=$?; done   # wait interrupted by a signal
    child=""
    (( stopping )) && break
    log "$name $(describe_exit "$st")"
    (( st == 0 && ! ALWAYS )) && { log "$name finished cleanly; not restarting"; return 0; }
    (( st == 126 || st == 127 )) && { alert "$name cannot be executed (status $st)"; return 1; }

    now=$SECONDS
    if (( now - started > WINDOW )); then delay=$BASE_DELAY; restarts=(); fi   # it ran fine for a while
    local -a recent=()
    local t
    for t in "${restarts[@]}"; do (( now - t <= WINDOW )) && recent+=("$t"); done
    restarts=("${recent[@]}" "$now")
    if (( ${#restarts[@]} > MAX_RESTARTS )); then
      log "giving up: ${#restarts[@]} restarts within ${WINDOW}s"
      alert "$name is crash-looping on $(hostname)"
      return 1
    fi
    log "restarting in ${delay}s (restart ${#restarts[@]} in window)"
    sleep "$delay"
    delay=$(( delay * 2 > MAX_DELAY ? MAX_DELAY : delay * 2 ))
  done
  log "supervisor stopped"
  return 0
}

main() {
  local opt OPTIND
  while getopts ':r:w:b:m:ah' opt; do
    case $opt in
      r) MAX_RESTARTS=$OPTARG ;; w) WINDOW=$OPTARG ;; b) BASE_DELAY=$OPTARG ;; m) MAX_DELAY=$OPTARG ;; a) ALWAYS=1 ;;
      *) echo "usage: $PROG [-r N] [-w SECS] [-b SECS] [-m SECS] [-a] -- COMMAND..." >&2; exit 2 ;;
    esac
  done
  shift $((OPTIND - 1))
  [[ ${1:-} == -- ]] && shift
  (( $# )) || { echo "$PROG: no command given" >&2; exit 2; }
  supervise "$@"
}

# ---- playground demo: a worker that crashes, gets killed once, then keeps crashing ----
cat > /tmp/worker.sh <<'EOF'
#!/usr/bin/env bash
n=$(( $(cat /tmp/worker.runs 2>/dev/null || echo 0) + 1 ))
echo "$n" > /tmp/worker.runs
echo "  (worker run $n doing some work)"
(( n == 3 )) && exit 137      # pretend the OOM killer struck
exit 1
EOF
chmod +x /tmp/worker.sh; rm -f /tmp/worker.runs
main -r 3 -w 60 -- /tmp/worker.sh
echo "supervisor exit status: $?"
echo "--- a worker that succeeds:"
main -- true
```

## Explanation

- **Background child + `wait`:** running the command with `&` and immediately waiting lets the TERM/INT trap fire while the supervisor is waiting — a foreground child would delay the trap until it exited.
- **Exponential backoff with a cap** prevents a crash loop from burning CPU or flooding logs, while still recovering quickly from a one-off crash.
- **A sliding window of restart times** distinguishes "crashes now and then" (keep going) from "crash-looping" (stop and alert). A long healthy run resets everything.
- **Exit codes are interpreted:** >128 means killed by a signal (`kill -l` names it), 126/127 mean the command can't run — restarting would be pointless.
- **Graceful shutdown:** the signal is forwarded to the child, the supervisor waits with a deadline, then escalates to SIGKILL; `stopping` prevents a restart after a requested stop.
- **`$SECONDS`** is monotonic within the shell, so the window logic isn't confused by clock adjustments.

## Extensions

- Signal the child's whole process group (`setsid` to start it, `kill -- -PGID` to stop it).
- Write a PID file and refuse to start if another supervisor is running.
- Health-check the child periodically (HTTP or a heartbeat file) and restart it if it hangs without exiting.
- Supervise several commands from a config file, each with its own policy.
- Compare your supervisor with an equivalent systemd unit (`Restart=on-failure`, `StartLimitBurst`, `RestartSec`).
