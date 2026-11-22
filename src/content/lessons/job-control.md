---
objectives:
  - Run commands in the background with `&` and collect them with `wait`
  - Manage interactive jobs with `jobs`, `fg`, `bg`, Ctrl+Z and `%n`
  - Run tasks in parallel from a script and gather their exit statuses
  - Keep processes alive after logout with `nohup`, `disown`, `setsid` or a terminal multiplexer
summary:
  - "`cmd &` starts cmd in the background; `$!` is its PID. `wait` waits for all jobs, `wait $pid` for one and returns its status."
  - "Interactive: Ctrl+Z suspends the foreground job, `bg` resumes it in the background, `fg %2` brings job 2 forward, `jobs -l` lists them."
  - "In scripts, store each `$!` and `wait` on each PID to collect individual exit statuses."
  - "`wait -n` (Bash 4.3) returns when *any* job finishes — useful for limiting parallelism."
  - "Closing a terminal sends SIGHUP to its jobs; `nohup`, `disown`, `setsid`, tmux or systemd keep work running."
related:
  - signals-and-trap
  - subshells
  - processes-and-services
---

> [!NOTE] Simulator behaviour
> The browser simulator runs background jobs to completion immediately and `sleep` returns at once, so timing differs from a real system. The bookkeeping — `$!`, `jobs`, `wait` statuses — behaves like Bash.

## Foreground and background

Normally the shell waits for a command to finish (the **foreground**). Ending a command with `&` runs it in the **background**: the shell immediately prints a prompt and you can keep working.

::viz jobs

```bash title="background.sh" playground
sleep 3 &
echo "started job with PID $!"
echo "the shell keeps going while it runs"
wait
echo "all background jobs done (status $?)"
```

| Variable / command | Meaning |
|---|---|
| `$!` | PID of the most recent background job |
| `jobs` | list the current shell's jobs |
| `wait` | wait for all background jobs |
| `wait PID` / `wait %1` | wait for one job and return its exit status |
| `wait -n` | wait for the next job to finish (Bash 4.3+) |

## Interactive job control

In an interactive terminal:

| Action | Effect |
|---|---|
| `Ctrl+Z` | suspend (stop) the foreground job — sends SIGTSTP |
| `bg` / `bg %2` | continue a stopped job in the background |
| `fg` / `fg %2` | bring a job to the foreground |
| `jobs -l` | list jobs with PIDs |
| `kill %2` | send SIGTERM to job 2 |
| `%+` / `%-` | the current / previous job |

A typical flow: start a long `tar` command, realise it'll take a while, press **Ctrl+Z**, type **`bg`**, and carry on working.

```text
$ tar czf backup.tgz ~/photos
^Z
[1]+  Stopped                 tar czf backup.tgz ~/photos
$ bg
[1]+ tar czf backup.tgz ~/photos &
$ jobs
[1]+  Running                 tar czf backup.tgz ~/photos &
```

## Parallel work in scripts

Start tasks in the background, remember their PIDs, then wait for each to get its exit status:

```bash title="parallel.sh" playground
check() {                       # pretend health check
  local host=$1
  sleep 1
  [[ $host != cache01 ]]
}
declare -A pid_of
for host in web01 web02 cache01 db01; do
  check "$host" &
  pid_of[$host]=$!
done
failed=0
for host in web01 web02 cache01 db01; do
  if wait "${pid_of[$host]}"; then
    echo "$host: ok"
  else
    echo "$host: FAILED"
    (( ++failed ))
  fi
done
echo "$failed failure(s)"
```

A plain `wait` with no arguments always returns 0 — it can't tell you whether jobs failed. Wait on PIDs individually when results matter.

## Limiting concurrency

Running 500 jobs at once can overwhelm a machine. `wait -n` lets you keep at most N running:

```bash
max=4
for f in *.log; do
  gzip -- "$f" &
  while (( $(jobs -rp | wc -l) >= max )); do
    wait -n
  done
done
wait
```

`xargs -P 4` and GNU `parallel` solve the same problem for simple cases: `printf '%s\0' *.log | xargs -0 -P 4 -n 1 gzip`.

## Surviving logout

When a terminal closes, the kernel sends **SIGHUP** to its session, and Bash forwards it to its jobs, which usually terminates them.

| Tool | How it helps |
|---|---|
| `nohup cmd &` | ignores SIGHUP; output goes to `nohup.out` |
| `disown %1` | removes the job from the shell's table so Bash won't forward SIGHUP |
| `setsid cmd` | starts cmd in a new session with no terminal |
| `tmux` / `screen` | keep a whole terminal session alive; reattach later |
| systemd service / timer | the robust choice for anything long-lived on a server |

## Common mistakes

```mistake
title: Trusting plain wait's status
wrong: |
  task_a & task_b &
  wait && echo "both succeeded"     # always prints
right: |
  task_a & a=$!
  task_b & b=$!
  wait "$a" && wait "$b" && echo "both succeeded"
why: "`wait` with no arguments returns 0 after all jobs finish, regardless of their statuses."
```

```mistake
title: Background jobs writing to the same file
wrong: |
  for h in "${hosts[@]}"; do check "$h" >> results.txt & done
right: |
  for h in "${hosts[@]}"; do check "$h" > "results.$h" & done
  wait
  cat results.* > results.txt
why: Concurrent writers interleave lines unpredictably. Give each job its own output file.
```

## Practice

```exercise
kind: mcq
difficulty: beginner
prompt: You pressed Ctrl+Z on a long-running command. How do you let it keep running while you use the shell?
options:
  - "`fg`"
  - "`bg`"
  - "`kill %1`"
  - "`wait`"
answer: 1
explanation: "Ctrl+Z stops the job; `bg` resumes it in the background."
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  ( exit 3 ) &
  p=$!
  wait "$p"
  echo "status $?"
answer: status 3
explanation: Waiting on a specific PID returns that job's exit status.
```

```exercise
kind: command
difficulty: beginner
prompt: "Start `sleep 1` in the background, then wait for it and print `done`."
solution: sleep 1 & wait; echo done
explanation: "`&` backgrounds the job, `wait` blocks until it finishes."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Parallel checks with a summary
prompt: "Run `probe` (provided) for each of the servers in `~/data/servers.txt` in parallel. Then, in file order, print `NAME up` or `NAME down` based on each job's exit status, and finally `N/M up`."
starter: |
  #!/usr/bin/env bash
  probe() { grep -q "^$1 .* running$" ~/data/servers.txt; }
solution: |
  #!/usr/bin/env bash
  probe() { grep -q "^$1 .* running$" ~/data/servers.txt; }
  names=() pids=()
  while read -r name _; do
    probe "$name" &
    names+=("$name")
    pids+=($!)
  done < ~/data/servers.txt
  up=0
  for i in "${!pids[@]}"; do
    if wait "${pids[i]}"; then
      echo "${names[i]} up"
      (( ++up ))
    else
      echo "${names[i]} down"
    fi
  done
  echo "$up/${#pids[@]} up"
expectedOutput: |
  web01 up
  web02 up
  db01 up
  cache01 down
  mail01 up
  4/5 up
checks:
  - pattern: '&'
    message: Run the probes in the background with &.
  - pattern: wait
    message: Collect results with wait.
hints:
  - "Keep two parallel arrays: names and PIDs."
  - "`wait \"${pids[i]}\"` returns that job's status."
explanation: "Starting everything first and waiting afterwards is what makes it parallel; waiting per PID gives each result."
```
