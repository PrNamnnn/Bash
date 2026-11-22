---
objectives:
  - Redirect output to files with `>` and `>>`, and input from files with `<`
  - Redirect stderr separately or together with stdout
  - Explain why `> file 2>&1` and `2>&1 > file` behave differently
  - Discard output with `/dev/null` and protect files with `noclobber`
summary:
  - "`> f` writes stdout to f (truncating it), `>> f` appends, `< f` reads stdin from f."
  - "`2> f` redirects stderr; `2>&1` makes fd 2 a copy of fd 1; `&> f` sends both (Bash)."
  - "Redirections are processed left to right, and `n>&m` copies where m points *at that moment*."
  - "`/dev/null` discards writes and returns end-of-file on reads."
  - "The file is opened (and truncated) before the command runs — never redirect a file onto itself."
related:
  - standard-streams
  - pipes
  - here-documents
---

## Redirecting output

| Operator | Meaning |
|---|---|
| `cmd > file` | stdout → file (create, or **truncate** if it exists) |
| `cmd >> file` | stdout → file (append) |
| `cmd 2> file` | stderr → file |
| `cmd 2>> file` | stderr → file, appending |
| `cmd &> file` | stdout and stderr → file (Bash; POSIX: `> file 2>&1`) |
| `cmd > /dev/null` | discard stdout |
| `cmd < file` | stdin ← file |
| `cmd >\| file` | overwrite even if `noclobber` is set |

```bash title="redirect.sh" playground
cd /tmp
echo "first"  > log.txt
echo "second" >> log.txt
cat log.txt
ls /etc/hostname /nope > ok.txt 2> err.txt
echo "--- ok.txt:";  cat ok.txt
echo "--- err.txt:"; cat err.txt
wc -l < log.txt
```

Redirections can appear anywhere in a simple command — `> out.txt echo hi` works — but by convention they go at the end.

## Combining stdout and stderr

`2>&1` reads as "make file descriptor 2 point wherever file descriptor 1 points **right now**". Order is everything:

::viz fd-flow

```bash title="order.sh" playground
cd /tmp
ls /etc/hostname /nope > both.txt 2>&1
echo "--- both.txt (> then 2>&1):"; cat both.txt
ls /etc/hostname /nope 2>&1 > only-out.txt
echo "--- only-out.txt (2>&1 then >):"; cat only-out.txt
```

In the second command, `2>&1` copied fd 1 while it still pointed at the terminal, so the error went to the screen and only stdout landed in the file.

For pipes there's a shorthand: `cmd |& next` is `cmd 2>&1 | next` (Bash 4+).

## /dev/null

`/dev/null` is a special file that discards everything written to it and is always empty when read.

```bash
command -v jq > /dev/null 2>&1 || echo "jq missing"   # only care about the status
grep -r 'secret' / 2>/dev/null                        # hide permission errors
cp file /backup/ < /dev/null                           # guarantee no interactive prompts
```

Silence errors deliberately. `2>/dev/null` on every command hides the problems you'll later spend hours debugging.

## Truncation happens first

The shell opens the output file — truncating it — **before** the command starts. Reading and writing the same file in one command destroys it:

```bash title="truncate.sh" playground
cd /tmp
printf 'b\na\nc\n' > data.txt
sort data.txt > data.txt        # data.txt is emptied before sort reads it
wc -l < data.txt
printf 'b\na\nc\n' > data.txt
sort data.txt > data.tmp && mv data.tmp data.txt
cat data.txt
```

`sort -o file file` and `sponge` (from moreutils) are other safe approaches.

## noclobber

`set -o noclobber` (or `set -C`) makes `>` refuse to overwrite existing files — a seatbelt for interactive shells. Use `>|` to override deliberately:

```bash title="noclobber.sh" playground
cd /tmp
echo v1 > important.txt
set -o noclobber
echo v2 > important.txt
echo v3 >| important.txt
cat important.txt
```

## Redirecting a whole block

Redirections can apply to a `{ …; }` group, a loop or a function, so one file receives everything:

```bash
{
  echo "Report generated $(date)"
  df -h
  free -h
} > report.txt 2>&1

while read -r host; do
  ssh "$host" uptime
done < hosts.txt > uptimes.txt
```

## Common mistakes

```mistake
title: Wrong order with 2>&1
wrong: |
  ./backup.sh 2>&1 > backup.log    # errors still on screen, not in the log
right: |
  ./backup.sh > backup.log 2>&1
  ./backup.sh &> backup.log          # Bash shorthand
why: Redirections are applied left to right; `2>&1` copies fd 1's target at that moment.
```

```mistake
title: sudo and redirection
wrong: |
  sudo echo "line" >> /etc/motd   # Permission denied
right: |
  echo "line" | sudo tee -a /etc/motd > /dev/null
why: Your unprivileged shell opens `/etc/motd` before sudo runs.
```

## Practice

```exercise
kind: command
difficulty: beginner
compare: fs
prompt: "Save the list of files in `~/data` into `~/listing.txt` (overwrite if it exists)."
solution: ls ~/data > ~/listing.txt
explanation: "`>` sends stdout to the file. Because the output is a file, `ls` writes one name per line."
```

```exercise
kind: command
difficulty: beginner
compare: fs
prompt: "Append the line `checked` to the end of `~/todo.txt`."
solution: echo checked >> ~/todo.txt
explanation: "`>>` appends. A single `>` would replace the whole to-do list."
```

```exercise
kind: predict
difficulty: intermediate
prompt: This checker only shows stdout. What appears?
code: |
  cd /tmp
  ls /etc/hostname /nope > out.txt 2>&1
  wc -l < out.txt
  ls /etc/hostname /nope 2>/dev/null
answer: |
  2
  /etc/hostname
explanation: "The first ls writes both its result and its error into out.txt (2 lines). The second shows only the existing file; the error is discarded."
```

```exercise
kind: fill
difficulty: beginner
prompt: Run `./build.sh`, sending normal output to `build.log` and errors to `errors.log`.
template: ./build.sh ___ build.log ___ errors.log
blanks:
  - [">", "1>"]
  - ["2>"]
explanation: "`> build.log` (or `1>`) redirects fd 1, `2> errors.log` redirects fd 2."
```

## Challenge

```exercise
kind: find-bug
difficulty: intermediate
prompt: This cron job's log never contains the error messages that the script prints. Which line is wrong?
code: |
  #!/usr/bin/env bash
  log=/var/log/nightly.log
  echo "=== $(date) ===" >> "$log"
  /usr/local/bin/nightly-job 2>&1 >> "$log"
  echo "exit status: $?" >> "$log"
answer: 4
fix: |
  /usr/local/bin/nightly-job >> "$log" 2>&1
hints:
  - In which order are the two redirections on that line applied?
explanation: "`2>&1` is applied first, while fd 1 still points at cron's stdout (usually mailed or discarded), and only then is fd 1 redirected to the log. Swap them so stderr copies the log destination."
```
