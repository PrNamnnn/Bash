---
objectives:
  - Describe the steps Bash performs for every command line, from reading to waiting
  - Explain fork, exec and wait and how they create new processes
  - Know which commands run inside the shell and which need a new process
  - Use this model to predict and debug surprising behaviour
summary:
  - "For each line Bash: reads → tokenizes → parses → expands → applies redirections → runs → waits → sets `$?`."
  - "External programs are started with fork (copy the shell) + exec (replace the copy with the program); the parent then waits."
  - "Builtins and functions run inside the shell process — that's why `cd`, `export` and `read` must be builtins."
  - "Redirections are set up in the child after fork, so they affect only that command."
  - "`exec cmd` replaces the shell itself; nothing after it runs."
related:
  - how-a-command-runs
  - command-lookup
  - environment-inheritance
---

## From text to running program

Every time you press Enter (or Bash reads the next line of a script), the same pipeline runs:

::viz command-execution

| Step | What happens | Example (`echo "$HOME"/*.txt > list`) |
|---|---|---|
| 1. Read | read a line (more if it's incomplete, e.g. an open quote or `if`) | the raw text |
| 2. Tokenize | split into words and operators, honouring quotes | `echo`, `"$HOME"/*.txt`, `>`, `list` |
| 3. Parse | build the command structure: simple commands, pipelines, lists, compound commands | simple command + 1 redirection |
| 4. Expand | brace → tilde → parameter/arith/command substitution → word splitting → globbing → quote removal | `echo /home/learner/notes.txt /home/learner/todo.txt` |
| 5. Redirect | open files and wire up file descriptors | fd 1 → `list` |
| 6. Execute | builtin? function? otherwise find the program via PATH and start it | `echo` builtin |
| 7. Wait | wait for the command (unless `&`), record its exit status | `$?` = 0 |

Most "why does Bash do *that*?" questions are answered by knowing which step does what. Quoting matters in step 2 and 4; `$?` is set in step 7; aliases are expanded during step 2, which is why they don't work in scripts by default.

## fork, exec, wait

Unix creates processes in two steps:

1. **fork** — the shell duplicates itself. The child is an identical copy (same variables, same open files, same directory).
2. **exec** — the child replaces its own program with the new one (`/usr/bin/grep`), keeping its PID, open file descriptors and environment.
3. **wait** — the parent shell sleeps until the child exits, then collects its exit status.

```text
bash (PID 3004)
 ├─ fork ──▶ bash copy (PID 4201)
 │            └─ apply redirections, then exec /usr/bin/grep ──▶ grep (PID 4201)
 └─ wait(4201) ◀──────────────────────────────────── exit status 0
```

Why two steps? Between fork and exec, the child can set up redirections, change directory or environment — affecting only itself. That's how `grep x file > out` redirects grep's output without touching the shell's own stdout.

## Builtins run inside the shell

Some commands **must** change the shell's own state, so they can't be separate programs:

| Builtin | Why it can't be external |
|---|---|
| `cd` | a child changing *its* directory doesn't affect the parent |
| `export`, `unset`, variable assignment | modify the shell's variables |
| `read` | sets variables in the shell |
| `exit`, `return` | control the shell itself |
| `source` / `.` | runs a file in the current shell |
| `set`, `shopt`, `trap`, `alias` | change shell settings |

Others (`echo`, `printf`, `test`, `pwd`) are builtins purely for speed — they also exist as programs in `/usr/bin`.

```bash title="builtins.sh" playground
type cd echo printf ls
cd /tmp
echo "builtin cd changed the shell's directory: $PWD"
( cd /etc; echo "subshell in $PWD" )
echo "back: $PWD"
```

## The cost of processes

Forking is cheap but not free — roughly a millisecond. In a loop over 10,000 lines, calling an external command per line adds up to seconds, while builtins and parameter expansion run in microseconds:

```bash
# slow: two processes per line
while read -r line; do n=$(echo "$line" | cut -d, -f2); done < big.csv
# fast: no processes
while IFS=, read -r _ n _; do :; done < big.csv
# fastest for bulk work: one awk process for the whole file
awk -F, '{ print $2 }' big.csv
```

## exec: replace the shell

`exec cmd` performs only the **exec** step: the shell is replaced by cmd, keeping its PID. Nothing after it runs.

```bash title="exec.sh" playground
echo "before exec, PID $$"
exec echo "echo has replaced the shell"
echo "this line never runs"
```

Uses: wrapper scripts that set up an environment and then `exec "$@"` (so signals reach the real program directly — common in Docker entrypoints), and `exec >log 2>&1` (with no command) to redirect the rest of the script.

## Common mistakes

```mistake
title: Expecting a script to change your shell
wrong: |
  ./set-env.sh        # exports variables and cd's — then nothing changed?
right: |
  source ./set-env.sh   # or:  . ./set-env.sh
why: "`./script` runs in a child process; its changes vanish when it exits. `source` runs it in your current shell."
```

```mistake
title: Entrypoint scripts that don't exec
wrong: |
  #!/bin/sh
  setup_config
  node server.js       # sh stays as PID 1; SIGTERM never reaches node
right: |
  #!/bin/sh
  setup_config
  exec node server.js
why: With exec, the server replaces the shell and receives signals (like `docker stop`'s SIGTERM) directly.
```

## Practice

```exercise
kind: mcq
difficulty: intermediate
prompt: Why must `cd` be a shell builtin?
options:
  - It's faster than an external program
  - A child process can't change its parent's working directory
  - POSIX forbids a /usr/bin/cd program
  - External programs can't take directory arguments
answer: 1
explanation: Each process has its own working directory; only the shell itself can change the shell's.
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  echo start
  (exec echo replaced)
  echo end
answer: |
  start
  replaced
  end
explanation: "exec replaces only the subshell; the main script continues."
```

```exercise
kind: mcq
difficulty: advanced
prompt: "In `grep x f > out`, when is `out` opened?"
options:
  - Before the line is tokenized
  - By grep, when it starts
  - In the forked child, after expansion and before exec
  - After grep finishes
answer: 2
explanation: "Redirections are performed in the child between fork and exec, so grep inherits fd 1 already pointing at `out`."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Builtin or external?
prompt: "For each of `cd echo grep read printf awk test` print `NAME: builtin` or `NAME: external (PATH)` using `type -t` and `type -P`, where PATH is the first location found."
starter: |
  #!/usr/bin/env bash
  for c in cd echo grep read printf awk test; do
    :
  done
solution: |
  #!/usr/bin/env bash
  for c in cd echo grep read printf awk test; do
    if [[ $(type -t "$c") == builtin ]]; then
      echo "$c: builtin"
    else
      echo "$c: external ($(type -P "$c"))"
    fi
  done
expectedOutput: |
  cd: builtin
  echo: builtin
  grep: external (/usr/bin/grep)
  read: builtin
  printf: builtin
  awk: external (/usr/bin/awk)
  test: builtin
checks:
  - pattern: type -t
    message: Use type -t to classify each command.
hints:
  - "`type -t` prints builtin, file, keyword, function or alias."
  - "`type -P` prints the path of the program even if a builtin exists."
explanation: "type answers exactly the question Bash asks in step 6: what will this name run?"
```
