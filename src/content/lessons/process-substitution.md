---
objectives:
  - Use `<(cmd)` to pass a command's output where a file name is expected
  - Use `>(cmd)` to send output to a command as if it were a file
  - Feed loops with process substitution so variables survive
  - Create and use named pipes (FIFOs) with `mkfifo`
summary:
  - "`<(cmd)` runs cmd and expands to a file name such as `/dev/fd/63` from which its output can be read."
  - "`>(cmd)` expands to a file name whose writes go to cmd's stdin."
  - "Typical uses: `diff <(sort a) <(sort b)`, `while read … done < <(cmd)`, `tee >(gzip > log.gz)`."
  - "A FIFO (`mkfifo pipe`) is a named pipe in the filesystem: one process writes, another reads."
  - "Process substitution is Bash/ksh/zsh only — not available in POSIX sh."
related:
  - pipes
  - diff-and-cmp
  - buffering-and-coproc
---

## Commands that want files

Some commands insist on file names: `diff`, `comm`, `join`, `paste`, programs that open two inputs at once. If your data comes from other commands, you'd normally need temporary files:

```bash
sort a.txt > /tmp/a.sorted
sort b.txt > /tmp/b.sorted
diff /tmp/a.sorted /tmp/b.sorted
rm /tmp/a.sorted /tmp/b.sorted
```

**Process substitution** removes the temporary files:

```bash
diff <(sort a.txt) <(sort b.txt)
```

## How it works

Bash runs the command inside `<( )` with its stdout connected to a pipe, and replaces the whole `<(…)` with a **path** that refers to the pipe — on Linux something like `/dev/fd/63`. The outer command just sees a file name and opens it:

```bash title="what-is-it.sh" playground
echo <(true)
cat <(echo "from a process")
wc -l <(ls ~/data) <(ls ~/logs)
```

Note the syntax: no space between `<` and `(`. `< <(cmd)` (with a space) is an ordinary input redirection from a process substitution — the most common way to feed a loop.

## Feeding loops without losing variables

Because `cmd | while read …` runs the loop in a subshell, variables set inside are lost. Redirect from a process substitution instead:

```bash title="loop.sh" playground
declare -A count
while read -r ip _; do
  (( count[$ip]++ ))
done < <(cut -d' ' -f1 ~/logs/access.log)
for ip in "${!count[@]}"; do echo "${count[$ip]} $ip"; done | sort -rn | head -3
```

## Output process substitution

`>(cmd)` works in the other direction: it expands to a file name, and whatever is written to that file goes to `cmd`'s standard input. Combined with `tee`, it splits one stream to several consumers:

```bash title="tee-split.sh" playground
cd /tmp
grep -v health ~/logs/app.log \
  | tee >(grep -c ERROR > errors.count) >(grep -c WARN > warns.count) > /dev/null
sleep 0.1   # on a real system the background consumers may still be finishing
echo "errors: $(cat errors.count) warnings: $(cat warns.count)"
```

On a real system the `>( )` processes run asynchronously, so a script may need to wait for them before reading their results.

## Named pipes (FIFOs)

A **named pipe** is a pipe with a name in the filesystem, created with `mkfifo`. One process opens it for writing, another for reading; data passes through in memory, never touching disk:

```bash
mkfifo /tmp/events
# terminal 1
while read -r line; do echo "got: $line"; done < /tmp/events
# terminal 2
echo "deploy started" > /tmp/events
```

Opening a FIFO blocks until both a reader and a writer are present. FIFOs connect processes that weren't started together — for example, a long-running consumer and occasional producers — and are the mechanism behind process substitution on systems without `/dev/fd`. (The browser simulator can't block waiting for another process, so try FIFOs on a real machine.)

> [!PORTABILITY] Bash-specific
> `<( )` and `>( )` exist in Bash, ksh and zsh, but not in POSIX `sh`/dash. In `#!/bin/sh` scripts use temporary files or FIFOs.

## Common mistakes

```mistake
title: A space in the wrong place
wrong: |
  diff < (sort a) < (sort b)     # syntax error
right: |
  diff <(sort a) <(sort b)
why: "`<(` must be written without a space; `< (` is parsed as a redirection followed by a subshell."
```

```mistake
title: Reading the file twice
wrong: |
  f=<(ls)
  wc -l "$f"; cat "$f"    # the second read finds nothing
right: |
  out=$(ls)
  wc -l <<< "$out"; echo "$out"
why: A process substitution is a pipe, not a regular file. Its data can be read once, and the path is only valid during the command that uses it.
```

## Practice

```exercise
kind: command
difficulty: intermediate
prompt: "Compare the **sorted** contents of `~/data/old.txt` and `~/data/new.txt` with `diff`, using process substitution."
solution: diff <(sort ~/data/old.txt) <(sort ~/data/new.txt)
explanation: "Each `<(sort …)` becomes a /dev/fd path that diff reads like a file."
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  total=0
  while read -r n; do (( total += n )); done < <(seq 4)
  echo "$total"
answer: "10"
explanation: "The loop reads from a redirection, so it runs in the current shell and `total` keeps its value: 1+2+3+4 = 10."
```

```exercise
kind: mcq
difficulty: intermediate
prompt: "What does `echo <(true)` print on Linux?"
options:
  - Nothing
  - A path such as /dev/fd/63
  - "true"
  - The exit status of true
answer: 1
explanation: Process substitution is replaced by a file name; echo prints that name.
```

## Challenge

```exercise
kind: command
difficulty: advanced
title: Users in both lists
prompt: "Print the user names that appear in **both** the first column of `/etc/passwd` (colon-separated) and the list printed by `printf 'deploy\\nalice\\nlearner\\n'` — use `comm -12` with two process substitutions, sorting each side."
solution: comm -12 <(cut -d: -f1 /etc/passwd | sort) <(printf 'deploy\nalice\nlearner\n' | sort)
hints:
  - "`comm -12` prints only lines common to both sorted inputs."
explanation: "Each side is extracted and sorted inside its own process substitution. The intersection is `deploy` and `learner`."
```
