---
objectives:
  - Explain line buffering versus block buffering and when each applies
  - Fix "my pipeline shows no output until the end" problems
  - Use named pipes (FIFOs) to connect processes explicitly
  - Run a coprocess and talk to it in both directions
summary:
  - "C programs buffer stdout: line-buffered when writing to a terminal, block-buffered (often 4–64 KiB) when writing to a pipe or file."
  - "That's why `tail -f log | grep x | cut …` can appear stuck: grep is holding output in a buffer."
  - "Fixes: `grep --line-buffered`, `sed -u`, `awk` with `fflush()`, or `stdbuf -oL cmd` for most other programs."
  - "`mkfifo pipe` creates a named pipe — a pipe with a filesystem name that unrelated processes can open."
  - "`coproc NAME { cmd; }` starts cmd with its stdin and stdout connected to the array `NAME` (fds `${NAME[1]}` to write, `${NAME[0]}` to read)."
related:
  - pipes
  - temp-files-and-fds
  - process-substitution
---

## Why output gets "stuck"

Writing to a file or pipe one byte at a time would be slow, so the C library (`stdio`) collects output in a **buffer** and writes it in chunks:

| stdout goes to | stdio buffering | Flushed when |
|---|---|---|
| a terminal | **line** buffered | each newline |
| a pipe or file | **block** buffered | the buffer fills (e.g. 4096 bytes) or the program exits |
| stderr (any) | unbuffered | immediately |

For normal commands this is invisible. With **long-running** producers it isn't:

```bash
tail -f /var/log/app.log | grep ERROR | cut -d' ' -f1-3
# …nothing appears for minutes, then a burst of lines
```

`tail -f` flushes each line, but `grep` is writing into a pipe, so it block-buffers its matches until it has several kilobytes.

## Fixes

| Tool | Option |
|---|---|
| grep | `grep --line-buffered` |
| sed | `sed -u` (GNU) |
| awk | `awk '{ print; fflush() }'` |
| Python | `python -u`, or `PYTHONUNBUFFERED=1` |
| most stdio programs | `stdbuf -oL cmd` (GNU coreutils) |
| programs that ignore stdbuf | `unbuffer cmd` (expect) or `script -q -c cmd /dev/null` |

```bash
tail -f /var/log/app.log | grep --line-buffered ERROR | cut -d' ' -f1-3
```

Only the commands **before** the last one in the pipeline need fixing; the last writes to the terminal and is line-buffered already.

Bash builtins (`echo`, `printf`, `read`) don't use stdio buffering — a `while read` loop's output appears immediately.

```bash title="buffering.sh" playground
# Each line is processed as soon as it arrives; builtins write immediately.
for i in 1 2 3; do echo "event $i"; done |
  while IFS= read -r line; do printf '[%s] %s\n' "$(date +%T)" "$line"; done
```

(The simulator runs pipelines in stages, so you can't observe real-time buffering here; try `tail -f` examples on a real system.)

## Named pipes (FIFOs)

An anonymous pipe (`|`) only connects processes started together. A **named pipe** has a name in the filesystem, so any processes can open it — one for writing, one for reading:

```bash
mkfifo /tmp/events                 # create it (shows as type p in ls -l)
cat /tmp/events &                  # reader blocks until a writer opens it
echo "deploy finished" > /tmp/events
rm /tmp/events
```

Opening a FIFO blocks until the other end is opened too. Uses: feeding a long-running process from several scripts, connecting a producer and consumer without temp files, building simple logging daemons.

## Coprocesses

`coproc` starts a command in the background with **two pipes**: one to its stdin, one from its stdout. The shell gets their file descriptors in an array:

```bash
coproc CALC { bc -l; }             # start bc as a coprocess
echo "scale=4; 22/7" >&"${CALC[1]}" # write to its stdin
read -r answer <&"${CALC[0]}"       # read its reply
echo "bc says: $answer"            # bc says: 3.1428
exec {CALC[1]}>&-                  # close its input; bc exits
wait "$CALC_PID"
```

| Element | Meaning |
|---|---|
| `${NAME[0]}` | fd to **read** the coprocess's stdout |
| `${NAME[1]}` | fd to **write** to its stdin |
| `$NAME_PID` | its PID |

The buffering lesson applies with a vengeance: if the coprocess block-buffers its output, your `read` waits forever. Use programs that flush per line (`bc`, `awk` with `fflush()`, `stdbuf -oL`). Bash supports only one active coprocess at a time reliably.

(The simulator doesn't run coprocesses; these examples are for a real Bash 4+.)

## When to use what

| Need | Use |
|---|---|
| feed one command's output to another | `\|` |
| a command needs a *file name* for another's output | process substitution `<(cmd)` |
| unrelated processes exchange data | named pipe `mkfifo` |
| a long-lived helper you send requests to and read answers from | `coproc` |
| complex bidirectional protocols | a real language (Python, Go) or `expect` |

## Common mistakes

```mistake
title: Fixing buffering on the wrong command
wrong: |
  tail -f app.log | grep ERROR | stdbuf -oL cut -c1-80
right: |
  tail -f app.log | grep --line-buffered ERROR | cut -c1-80
why: The last command writes to the terminal and is already line-buffered; the one buffering is grep in the middle.
```

```mistake
title: Deadlocking on a FIFO
wrong: |
  mkfifo p
  echo hello > p       # blocks forever: no reader yet
  cat p
right: |
  mkfifo p
  cat p &              # start the reader first (in the background)
  echo hello > p
  wait
why: Opening a FIFO for writing blocks until a reader opens it, and vice versa.
```

## Practice

```exercise
kind: mcq
difficulty: intermediate
prompt: "Why does `tail -f log | grep x | wc -l` never print anything?"
options:
  - grep is block-buffering
  - wc only prints when its input ends, and tail -f never ends
  - tail -f doesn't write to pipes
  - wc -l needs a file argument
answer: 1
explanation: "Buffering isn't the issue here: wc counts until EOF. Use something that reports progressively, like `grep --line-buffered x | while read -r _; do …; done`."
```

```exercise
kind: mcq
difficulty: intermediate
prompt: Which command makes grep flush each matching line immediately when writing into a pipe?
options:
  - "`grep -u`"
  - "`grep --line-buffered`"
  - "`grep -l`"
  - "`grep --flush`"
answer: 1
explanation: "GNU and BSD grep both support `--line-buffered`."
```

```exercise
kind: mcq
difficulty: advanced
prompt: "After `coproc W { awk '{print toupper($0); fflush()}'; }`, how do you send a line to the coprocess?"
options:
  - "`echo hi > W`"
  - "`echo hi >&\"${W[1]}\"`"
  - "`echo hi >&\"${W[0]}\"`"
  - "`echo hi | W`"
answer: 1
explanation: "Element 1 is the write end connected to the coprocess's stdin; element 0 reads its output."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Immediate, prefixed log lines
prompt: "Pipe the lines of `~/logs/app.log` that contain `WARN` or `ERROR` through a `while read` loop that prints `!! ` followed by the level and module (fields 2 and 3) — using only builtins inside the loop so nothing is buffered."
starter: |
  #!/usr/bin/env bash
solution: |
  #!/usr/bin/env bash
  grep --line-buffered -E 'WARN|ERROR' ~/logs/app.log |
    while read -r ts level module rest; do
      printf '!! %s %s\n' "$level" "$module"
    done
expectedOutput: |
  !! ERROR [checkout]
  !! WARN [checkout]
  !! WARN [cache]
  !! ERROR [checkout]
  !! WARN [db]
  !! ERROR [mailer]
checks:
  - pattern: line-buffered
    message: Make grep line-buffered.
  - pattern: while
    message: Process lines with a while read loop.
hints:
  - "`read -r ts level module rest` splits the first three fields."
explanation: "With --line-buffered, each match reaches the loop as soon as it's found — essential when the input is `tail -f`."
```
