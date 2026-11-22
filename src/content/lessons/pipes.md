---
objectives:
  - Connect commands with `|` so one's output becomes the next one's input
  - Explain how pipelines run concurrently and why each stage is a subshell
  - Build multi-stage text-processing pipelines step by step
  - Pipe stderr, save intermediate results with tee, and recognise SIGPIPE
summary:
  - "`a | b` connects a's stdout to b's stdin through a kernel pipe buffer."
  - "All stages start at the same time and run concurrently; data streams through as it is produced."
  - "Each stage runs in a subshell, so variables set inside a pipeline stage are lost."
  - "Only stdout is piped; use `2>&1 |` or `|&` to include stderr."
  - "Build pipelines incrementally: add one stage, inspect the output, add the next."
related:
  - redirection
  - pipeline-exit-status
  - sort-and-uniq
---

## Connecting programs

The pipe `|` is the shell's most powerful feature. It connects the **standard output** of the command on its left to the **standard input** of the command on its right:

```bash
grep ' 404 ' ~/logs/access.log | awk '{print $7}' | sort | uniq -c | sort -rn
```

Five small tools, none of which knows about the others, combine into "which missing pages are requested most often?". This is the Unix philosophy at work: **small programs that do one thing, connected by text streams**.

::viz pipes

## How a pipeline runs

When Bash sees `a | b | c`, it:

1. Creates a **pipe** (a small in-kernel buffer, typically 64 KiB on Linux) between each pair of commands.
2. Starts **all** the commands at once, each in its own process.
3. Connects `a`'s fd 1 to the first pipe's write end, `b`'s fd 0 to its read end, and so on.
4. Waits for all of them to finish.

Data flows as it's produced. If the reader is slower, the writer blocks when the buffer fills; if the writer is slower, the reader waits. That's why `tail -f log | grep ERROR` shows matches live, and why `yes | head -3` finishes instantly even though `yes` never stops on its own: when `head` exits, the next write by `yes` gets the **SIGPIPE** signal and `yes` terminates.

> [!NOTE] The simulator runs stages one after another
> In this browser simulator, each stage runs to completion before the next starts. Results are the same for ordinary text processing, but timing-dependent behaviour (live streaming, SIGPIPE) can only be observed on a real system.

## Building a pipeline step by step

Never write a long pipeline in one go. Add one stage at a time and look at the result:

```bash title="build-up.sh" playground
log=~/logs/access.log
echo "== step 1: requests that got a 404 =="
grep ' 404 ' "$log" | head -n 2
echo "== step 2: just the path (field 7) =="
grep ' 404 ' "$log" | awk '{print $7}'
echo "== step 3: count each path =="
grep ' 404 ' "$log" | awk '{print $7}' | sort | uniq -c | sort -rn
```

## Pipes and stderr

Only stdout enters the pipe. Errors bypass it and go straight to the terminal:

```bash title="pipe-stderr.sh" playground
ls ~/notes.txt /nope | wc -l           # error shown, count is 1
ls ~/notes.txt /nope 2>&1 | wc -l      # both lines counted: 2
ls ~/notes.txt /nope |& grep -c No     # |& is shorthand for 2>&1 |
```

## Each stage is a subshell

Because each pipeline stage runs in its own process, variable assignments inside a stage don't survive:

::viz subshell

```bash title="lost-var.sh" playground
total=0
printf '3\n4\n5\n' | while read -r n; do total=$((total + n)); done
echo "total after pipe: $total"         # 0!
total=0
while read -r n; do total=$((total + n)); done < <(printf '3\n4\n5\n')
echo "total with redirect: $total"      # 12
```

The second version feeds the loop with a redirection and process substitution, so the loop runs in the current shell. (`shopt -s lastpipe` is another option in scripts.)

## Saving intermediate results

`tee` copies the stream to a file while passing it on — useful for logs and for debugging long pipelines:

```bash
grep ERROR app.log | tee errors.txt | wc -l
```

## Useless use of cat

`cat file | grep x` works, but `grep x file` (or `grep x < file`) does the same with one process fewer. It's a minor style point — readability matters more than one process — but you'll see it mentioned in code reviews.

::terminal
$ cat logs/app.log | grep ERROR | wc -l
$ grep -o 'user=[a-z]*' logs/app.log | sort | uniq -c
$ cut -d, -f2 data/sales.csv | tail -n +2 | sort | uniq -c
$ ls -l ~ | grep '^d' | wc -l
$ awk '{print $9}' logs/access.log | sort | uniq -c | sort -rn
::

## Common mistakes

```mistake
title: Expecting a pipeline stage to change variables
wrong: |
  count=0
  grep ERROR app.log | while read -r line; do ((count++)); done
  echo "$count errors"      # always 0
right: |
  count=$(grep -c ERROR app.log)
  echo "$count errors"
why: The while loop runs in a subshell. Either compute the value with a command substitution or feed the loop with `< <(…)`.
```

```mistake
title: Forgetting that grep stops the pipeline's "success"
wrong: |
  set -e
  matches=$(grep pattern file | sort)   # no match: grep fails, but the pipeline succeeds
right: |
  set -o pipefail
  if ! matches=$(grep pattern file | sort); then echo "no matches"; fi
why: A pipeline's exit status is that of its last command unless `pipefail` is set — see the pipeline exit status lesson.
```

## Practice

```exercise
kind: command
difficulty: beginner
prompt: "Count how many entries (files and directories, not hidden) are in `~/projects/website`, using `ls` and `wc` in a pipeline."
solution: ls ~/projects/website | wc -l
explanation: "When piped, `ls` prints one name per line, so `wc -l` counts entries."
```

```exercise
kind: command
difficulty: beginner
prompt: "Print the distinct regions (field 2) in `~/data/sales.csv`, sorted, without the header."
solution: tail -n +2 ~/data/sales.csv | cut -d, -f2 | sort -u
explanation: "Skip the header, extract the column, sort and deduplicate."
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  n=1
  echo 5 | read n
  echo "n=$n"
answer: n=1
hints:
  - Which process runs `read`?
explanation: "`read` runs in a subshell created for the pipeline stage. It sets `n=5` there, and that subshell exits immediately."
```

## Challenge

```exercise
kind: command
difficulty: intermediate
title: Busiest endpoint
prompt: "From `~/logs/access.log`, print the single most requested path (field 7) with its count, in `uniq -c` format."
solution: awk '{print $7}' ~/logs/access.log | sort | uniq -c | sort -rn | head -n 1
hints:
  - Extract → sort → count → rank → keep one.
explanation: "The frequency-table pattern again. `/health` and `/api/checkout` tie with 4 requests each; `sort -rn` breaks the tie by comparing whole lines (in reverse), so `/health` comes first. Health checks often dominate request counts, which is why real analyses filter them out."
```
