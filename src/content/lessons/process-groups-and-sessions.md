---
objectives:
  - Explain process groups, sessions and the controlling terminal
  - Understand how Ctrl+C reaches every process in a pipeline at once
  - Signal an entire process group, and know when to use `setsid`
  - Read PID, PPID, PGID and SID columns in `ps`
summary:
  - "A **process group** is a set of processes treated as one job — typically all commands of a pipeline. Its ID (PGID) is the PID of its leader."
  - "A **session** is a set of process groups sharing a controlling terminal; the login shell is the session leader."
  - "The terminal has one **foreground** process group; Ctrl+C / Ctrl+Z / Ctrl+\\ send signals to that whole group."
  - "`kill -TERM -1234` (negative PID) signals every process in group 1234."
  - "`setsid cmd` starts cmd in a new session with no controlling terminal — it won't receive the terminal's SIGHUP."
related:
  - job-control
  - signals-and-trap
  - processes-and-services
---

## Three levels of grouping

```text
session (SID 3000) ── controlling terminal /dev/pts/0
 ├─ process group 3000:  bash (session leader)
 ├─ process group 4201:  grep ERROR app.log | sort | uniq -c    ← foreground job
 └─ process group 4300:  tar czf backup.tgz ~/photos &          ← background job
```

| Concept | What it is | ID |
|---|---|---|
| process | one running program | PID |
| process group | one **job**: all processes of a pipeline | PGID = leader's PID |
| session | everything started from one login/terminal | SID = session leader's PID |

An interactive Bash with job control puts each pipeline in its **own process group** — that's what lets it treat `grep | sort | uniq` as a single job that can be stopped, resumed, or brought to the foreground.

## The controlling terminal

The terminal driver (in the kernel) knows which process group is in the **foreground**. Special keys become signals sent to that entire group:

| Key | Signal | Typical effect |
|---|---|---|
| Ctrl+C | SIGINT | interrupt every process of the foreground job |
| Ctrl+Z | SIGTSTP | stop the foreground job |
| Ctrl+\\ | SIGQUIT | quit with a core dump |

That's why one Ctrl+C stops all three commands of `grep | sort | uniq` at once. Background groups that try to read the terminal receive SIGTTIN and are stopped.

When the terminal closes, the session leader (your shell) gets **SIGHUP**, and Bash forwards it to its jobs.

## Seeing the IDs

On a real Linux system:

```text
$ sleep 100 | cat &
$ ps -o pid,ppid,pgid,sid,tty,comm
    PID    PPID    PGID     SID TT       COMMAND
   3000    2990    3000    3000 pts/0    bash
   4201    3000    4201    3000 pts/0    sleep
   4202    3000    4201    3000 pts/0    cat
   4250    3000    4250    3000 pts/0    ps
```

`sleep` and `cat` share PGID 4201 — one job. Everything shares SID 3000 — one session.

In the simulator, `$$`, `$BASHPID` and `$PPID` show the shell's own IDs:

```bash title="ids.sh" playground
echo "shell PID:  $$"
echo "parent:     $PPID"
( echo "subshell BASHPID: $BASHPID" )
```

## Signalling a whole group

A negative PID means "the process group":

```bash
kill -TERM -4201          # every process in group 4201
kill -- -4201             # same; -- prevents -4201 from looking like an option
kill -TERM 0              # every process in *my* process group
```

This matters for scripts that start helpers: killing only the script's PID leaves its children running as orphans.

```bash
# in a script: on exit, terminate everything we started
trap 'kill -- -$$ 2>/dev/null' EXIT     # only valid when the script leads its own group
trap 'jobs -p | xargs -r kill' EXIT      # portable alternative: kill our background jobs
```

## Escaping the session: setsid

`setsid cmd` runs cmd as the leader of a **new session** with no controlling terminal: closing your terminal doesn't send it SIGHUP, and Ctrl+C can't reach it.

| Tool | Protects against SIGHUP by |
|---|---|
| `nohup cmd &` | setting SIGHUP to ignored |
| `disown` | removing the job from Bash's table |
| `setsid cmd` | moving cmd to a new session entirely |
| daemons / systemd | running outside any login session |

## Scripts and job control

Job control (`set -m`) is **off** in non-interactive shells. So in a script, background jobs stay in the script's process group, and Ctrl+C at the terminal reaches the script *and* its background jobs together — usually what you want.

## Common mistakes

```mistake
title: Killing only the parent
wrong: |
  ./run-workers.sh &
  kill $!                 # the script dies, its worker children keep running
right: |
  setsid ./run-workers.sh &      # new group/session, leader PID == $!
  kill -- -"$!"                  # signal the whole group
why: Signals go to one process unless you address the process group.
```

```mistake
title: Background job reading from the terminal
wrong: |
  ./interactive-setup.sh &     # gets stopped (SIGTTIN) when it asks a question
right: |
  ./interactive-setup.sh       # run it in the foreground
  ./batch-job.sh < /dev/null & # or give background jobs no terminal input
why: Only the foreground process group may read from the terminal.
```

## Practice

```exercise
kind: mcq
difficulty: intermediate
prompt: You press Ctrl+C while `find / -name x | sort` runs. Which processes receive SIGINT?
options:
  - Only find
  - Only sort
  - Both — they are in the same foreground process group
  - Only the shell, which then kills them
answer: 2
explanation: The terminal sends SIGINT to the entire foreground process group.
```

```exercise
kind: mcq
difficulty: intermediate
prompt: "What does `kill -TERM -500` do?"
options:
  - Sends SIGTERM to PID 500
  - Sends SIGTERM to every process in process group 500
  - Sends signal 500
  - It's a syntax error
answer: 1
explanation: A negative number addresses a process group.
```

```exercise
kind: mcq
difficulty: advanced
prompt: Which is true of a process started with `setsid`?
options:
  - It runs with root privileges
  - It becomes a session leader without a controlling terminal
  - It is automatically restarted on failure
  - It shares the terminal's foreground group
answer: 1
explanation: setsid creates a new session (and process group) with no terminal attached.
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Clean up background helpers
prompt: "Start three background `sleep` helpers, collect their PIDs in an array, print `started N helpers`, and register an EXIT trap that kills them (ignore errors) and prints `stopped N helpers`. Then print `main work done`."
starter: |
  #!/usr/bin/env bash
  helpers=()
solution: |
  #!/usr/bin/env bash
  helpers=()
  for i in 1 2 3; do
    sleep 30 &
    helpers+=($!)
  done
  echo "started ${#helpers[@]} helpers"
  cleanup() {
    kill "${helpers[@]}" 2>/dev/null
    echo "stopped ${#helpers[@]} helpers"
  }
  trap cleanup EXIT
  echo "main work done"
expectedOutput: |
  started 3 helpers
  main work done
  stopped 3 helpers
checks:
  - pattern: trap
    message: Register an EXIT trap.
  - pattern: '\$!'
    message: Record each helper's PID with $!.
hints:
  - "Append `$!` to an array after each `&`."
  - "`kill \"${helpers[@]}\" 2>/dev/null` signals them all."
explanation: "Tracking child PIDs and killing them in an EXIT trap means a script never leaves orphaned helpers behind."
```
