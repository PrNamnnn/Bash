---
objectives:
  - Explain what signals are and name the common ones (INT, TERM, HUP, KILL, EXIT pseudo-signal)
  - Send signals with `kill` and handle them with `trap`
  - Guarantee cleanup with `trap … EXIT`
  - Write graceful shutdown handlers for long-running scripts
summary:
  - "A signal is an asynchronous notification to a process: Ctrl+C sends SIGINT, `kill PID` sends SIGTERM, `kill -9` sends SIGKILL."
  - "`trap 'commands' SIGNALS` runs commands when a signal arrives; `trap - SIG` restores the default; `trap '' SIG` ignores it."
  - "`trap cleanup EXIT` runs on every exit — normal end, `exit`, `set -e` failure or a handled signal — making it the cleanup hook."
  - "SIGKILL and SIGSTOP cannot be trapped; give processes a chance with TERM before KILL."
  - "Exit with 128+N after handling a fatal signal (130 for INT, 143 for TERM) so callers see why you stopped."
related:
  - job-control
  - temp-files-and-fds
  - error-handling
---

## What is a signal?

A **signal** is a small, asynchronous message the kernel delivers to a process: "the user pressed Ctrl+C", "please terminate", "your terminal went away". Each has a number and a default action (usually: terminate).

::viz signals

| Signal | No. | Typical source | Default |
|---|---|---|---|
| SIGHUP | 1 | terminal closed; "reload config" for daemons | terminate |
| SIGINT | 2 | **Ctrl+C** | terminate |
| SIGQUIT | 3 | Ctrl+\\ | terminate + core dump |
| SIGKILL | 9 | `kill -9` | terminate — **cannot be caught** |
| SIGTERM | 15 | `kill PID` (default), shutdown, `docker stop` | terminate |
| SIGSTOP | 19 | `kill -STOP` | stop — **cannot be caught** |
| SIGTSTP | 20 | **Ctrl+Z** | stop |
| SIGCHLD | 17 | a child process exited | ignore |
| SIGUSR1/2 | 10/12 | user-defined | terminate |

(Numbers are for Linux on x86/ARM; use names in scripts.)

## Sending signals

```bash
kill 4242            # SIGTERM — "please exit"
kill -TERM 4242      # same, explicit
kill -INT %1         # like Ctrl+C for job 1
kill -HUP "$(cat /run/nginx.pid)"   # many daemons reload on HUP
kill -0 4242         # signal 0: just test whether the process exists
kill -l              # list signal names
```

Polite shutdown order: **TERM**, wait a few seconds, then **KILL** only if needed. SIGKILL gives the process no chance to clean up (temp files, locks, half-written output).

## trap

`trap 'COMMANDS' SIGNAL…` replaces the default action with your commands:

```bash title="trap-basics.sh" playground
trap 'echo "got SIGUSR1, continuing"' USR1
kill -USR1 $$
echo "still running"
trap 'echo "interrupted — exiting"; exit 130' INT
kill -INT $$
echo "never printed"
```

| Form | Effect |
|---|---|
| `trap 'cmds' INT TERM` | run cmds on INT or TERM |
| `trap '' INT` | ignore INT |
| `trap - INT` | restore default |
| `trap -p` | print the current traps |

Use single quotes so variables in the handler expand when the trap **runs**, not when it is set.

## EXIT: guaranteed cleanup

`EXIT` is a pseudo-signal: its trap runs when the shell exits for any reason — the end of the script, an `exit`, a `set -e` failure, or after a handled signal.

```bash title="cleanup.sh" playground
workdir=$(mktemp -d)
cleanup() {
  rm -rf -- "$workdir"
  echo "cleaned up $workdir"
}
trap cleanup EXIT
echo "working in $workdir"
touch "$workdir/partial-output"
false || exit 1          # fails — cleanup still runs
echo "never reached"
```

This is the standard pattern for temp files, lock files and restoring terminal settings.

## Graceful shutdown

Long-running scripts (workers, loops, deploys) should finish the current unit of work and exit cleanly on TERM or INT:

```bash title="graceful.sh" playground
stop=0
trap 'stop=1; echo "shutdown requested"' TERM INT
for job in 1 2 3 4 5; do
  (( stop )) && break
  echo "processing job $job"
  (( job == 2 )) && kill -TERM $$      # simulate a stop request
done
echo "finished cleanly after current job"
```

Setting a flag in the handler and checking it in the loop avoids exiting halfway through a job.

## ERR, DEBUG and RETURN

Bash adds three more pseudo-signals:

| Trap | Runs |
|---|---|
| `ERR` | after a command fails (non-zero status), under the same rules as `set -e` |
| `DEBUG` | before every simple command |
| `RETURN` | when a function or sourced file returns |

The error-handling and debugging lessons use these.

## Exit statuses for signals

A process killed by signal N reports status **128 + N** — 130 after Ctrl+C, 143 after SIGTERM, 137 after SIGKILL (often seen when the OOM killer strikes). After handling a fatal signal, exit with the same code so callers can tell what happened.

## Common mistakes

```mistake
title: Double quotes in a trap
wrong: |
  tmp=/tmp/a
  trap "rm -f $tmp" EXIT
  tmp=/tmp/b              # trap still removes /tmp/a
right: |
  trap 'rm -f -- "$tmp"' EXIT
why: Double quotes expand variables when the trap is set; single quotes defer expansion until it runs.
```

```mistake
title: Reaching for kill -9 first
wrong: |
  kill -9 "$pid"
right: |
  kill "$pid"
  for _ in 1 2 3 4 5; do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
  kill -0 "$pid" 2>/dev/null && kill -9 "$pid"
why: SIGKILL can't be handled, so the process can't remove locks or flush data. Ask nicely with TERM first.
```

## Practice

```exercise
kind: predict
difficulty: intermediate
prompt: What does this script print?
code: |
  trap 'echo bye' EXIT
  echo hello
  exit 3
answer: |
  hello
  bye
explanation: The EXIT trap runs after exit 3 (and the script's status stays 3).
```

```exercise
kind: mcq
difficulty: beginner
prompt: Which signal can a script NOT trap?
options:
  - SIGINT
  - SIGTERM
  - SIGKILL
  - SIGHUP
answer: 2
explanation: SIGKILL (and SIGSTOP) are handled by the kernel and never reach the process.
```

```exercise
kind: fill
difficulty: beginner
prompt: Make the shell ignore Ctrl+C.
template: trap ___ INT
blanks:
  - ["''", "\"\""]
explanation: An empty string as the action means "ignore this signal".
```

```exercise
kind: command
difficulty: intermediate
prompt: "Set a trap that prints `caught` on SIGUSR1, then send SIGUSR1 to the current shell."
solution: trap 'echo caught' USR1; kill -USR1 $$
explanation: "`$$` is the shell's own PID."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Lock file with guaranteed cleanup
prompt: "Create a lock directory `/tmp/report.lock` with `mkdir` (exit with `already running` on stderr and status 1 if it exists). Register an EXIT trap that removes it and prints `lock released`. Print `working`, then simulate Ctrl+C with `kill -INT $$` — an INT trap should print `interrupted` and exit 130."
starter: |
  #!/usr/bin/env bash
  lock=/tmp/report.lock
solution: |
  #!/usr/bin/env bash
  lock=/tmp/report.lock
  if ! mkdir "$lock" 2>/dev/null; then
    echo "already running" >&2
    exit 1
  fi
  trap 'rmdir "$lock"; echo "lock released"' EXIT
  trap 'echo interrupted; exit 130' INT
  echo working
  kill -INT $$
  echo "not reached"
expectedOutput: |
  working
  interrupted
  lock released
checks:
  - pattern: trap .*EXIT
    message: Register an EXIT trap for cleanup.
  - pattern: trap .*INT
    message: Handle INT.
hints:
  - "`mkdir` is atomic: it fails if the directory exists, so it doubles as a lock."
  - "Calling `exit` inside the INT handler still runs the EXIT trap."
explanation: "The INT handler exits with 130; the EXIT trap then releases the lock. Whatever happens, the lock never outlives the script."
```
