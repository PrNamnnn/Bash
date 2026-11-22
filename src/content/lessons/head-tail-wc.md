---
objectives:
  - Show the first or last N lines of a file or stream
  - Skip headers and select line ranges by combining head and tail
  - Follow growing log files in real time
  - Count lines, words and bytes, and get a bare number for scripts
summary:
  - "`head -n N` = first N lines; `head -n -N` = all but the last N (GNU). `tail -n N` = last N; `tail -n +N` = from line N on."
  - "`sed -n '5,10p'` or `head -n 10 | tail -n 6` select a range of lines."
  - "`tail -f` follows a file as it grows; `tail -F` survives log rotation."
  - "`wc -l < file` prints just the line count; `wc -l file` includes the name."
related:
  - reading-files
  - pipes
  - log-parsing
---

## The first and the last

When a file has a million lines, you rarely want all of them. `head` and `tail` give you the edges.

::command head tail

### Selecting a range

There is no `middle` command, but combining the two gets any range. Lines 5–8 of a file:

```bash title="range.sh" playground
seq 100 > /tmp/n.txt
head -n 8 /tmp/n.txt | tail -n 4     # lines 5..8
sed -n '5,8p' /tmp/n.txt              # same, with sed
```

### Skipping a header

`tail -n +2` starts at line 2 — the standard way to drop a CSV header:

```bash title="header.sh" playground
head -n 3 ~/data/sales.csv
echo "---"
tail -n +2 ~/data/sales.csv | head -n 3
```

### Following logs

On a real server, `tail -f` is how you watch an application while you reproduce a bug:

```bash
tail -f /var/log/nginx/access.log
tail -F /var/log/app/app.log | grep --line-buffered ERROR
```

Use `-F` for logs that get rotated (renamed and recreated): plain `-f` keeps following the old, renamed file. Press <kbd>Ctrl</kbd>+<kbd>C</kbd> to stop.

## Counting

::command wc

The difference between `wc -l file` and `wc -l < file` matters as soon as you put the result in a variable:

```bash title="count.sh" playground
cd ~/logs
wc -l access.log
wc -l < access.log
requests=$(wc -l < access.log)
echo "We served $requests requests"
wc -l *.log
```

## Putting them together

Small tools combine into quick answers:

::terminal
$ head -n 1 data/sales.csv
$ tail -n +2 data/sales.csv | wc -l
$ tail -n 3 logs/app.log
$ grep -c ERROR logs/app.log
$ ls ~/data | wc -l
::

## Common mistakes

```mistake
title: "Off by one with tail -n +N"
wrong: |
  tail -n +1 data.csv    # still includes the header (starts AT line 1)
right: |
  tail -n +2 data.csv    # starts at line 2
why: "`+N` means \"starting at line N\", not \"skip N lines\"."
```

```mistake
title: Counting a file without a trailing newline
wrong: |
  printf 'a\nb' | wc -l    # prints 1, not 2
right: |
  printf 'a\nb\n' | wc -l  # well-formed text files end with a newline
why: "`wc -l` counts newline characters. A final line without `\\n` isn't counted — another reason to always end files with a newline."
```

## Practice

```exercise
kind: command
difficulty: beginner
prompt: "Show the first 5 lines of `~/logs/access.log`."
solution: head -n 5 ~/logs/access.log
explanation: "`head -n 5` (or the older `head -5`) prints the first five lines."
```

```exercise
kind: command
difficulty: beginner
prompt: "Print just the **number** of lines in `~/data/users.csv` — no file name in the output."
solution: wc -l < ~/data/users.csv
hints:
  - When wc reads from standard input, it doesn't know a file name to print.
explanation: "Redirecting with `<` hides the name: `wc -l < file` prints only `8`."
```

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  seq 10 | tail -n 3 | head -n 1
answer: "8"
hints:
  - "`seq 10` prints 1 to 10, one per line."
explanation: "`tail -n 3` keeps 8, 9, 10; `head -n 1` keeps 8."
```

```exercise
kind: fill
difficulty: beginner
prompt: Count the data rows of a CSV file, excluding its header line.
template: tail -n ___ data.csv | wc -l
blanks:
  - ["+2"]
explanation: "`tail -n +2` starts at the second line, skipping the header."
```

## Challenge

```exercise
kind: command
difficulty: intermediate
title: The middle of the log
prompt: "Print lines 10 through 12 (inclusive) of `~/logs/access.log`, without using sed or awk."
solution: head -n 12 ~/logs/access.log | tail -n 3
hints:
  - Take the first 12 lines, then the last few of those.
explanation: "`head -n 12 | tail -n 3` gives lines 10, 11, 12. With sed it would be `sed -n '10,12p'`."
```
