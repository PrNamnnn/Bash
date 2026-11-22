---
objectives:
  - Create temporary files and directories safely with `mktemp`
  - Clean them up reliably with an EXIT trap
  - Open, use and close extra file descriptors with `exec`
  - Use `{var}` automatic descriptors and `/dev/fd/N`
summary:
  - "`tmp=$(mktemp)` creates a unique file (mode 600); `mktemp -d` a directory; add a template like `mktemp /tmp/app.XXXXXX`."
  - "Never use predictable names like `/tmp/myscript.tmp` — other users can pre-create or symlink them."
  - "Pair every mktemp with `trap 'rm -rf -- \"$tmp\"' EXIT`."
  - "`exec 3> file` opens fd 3 for the rest of the script; `cmd >&3` writes to it; `exec 3>&-` closes it."
  - "`exec {fd}< file` lets Bash pick a free descriptor number and stores it in `$fd`."
related:
  - redirection
  - signals-and-trap
  - secure-scripting
---

## Why mktemp?

Scripts often need scratch space: intermediate results, sorted copies, downloaded files. The tempting `/tmp/data.tmp` has two problems:

1. **Collisions** — two copies of the script running at once overwrite each other's data.
2. **Security** — `/tmp` is shared. Another user can create `/tmp/data.tmp` as a symlink to one of *your* files before your script runs; your script then overwrites it.

`mktemp` creates a file with a random, unused name, readable only by you, atomically.

```bash title="mktemp.sh" playground
tmp=$(mktemp)
echo "file: $tmp"
ls -l "$tmp"
dir=$(mktemp -d)
echo "dir:  $dir"
named=$(mktemp /tmp/report.XXXXXX.csv)
echo "templated: $named"
rm -f -- "$tmp" "$named"; rmdir -- "$dir"
```

| Command | Creates |
|---|---|
| `mktemp` | file in `$TMPDIR` or `/tmp` |
| `mktemp -d` | directory |
| `mktemp -t app.XXXXXX` | file in the temp dir with a prefix (GNU) |
| `mktemp /path/name.XXXXXX` | file from a template (X's become random characters) |

## Always clean up

```bash title="workspace.sh" playground
work=$(mktemp -d) || exit 1
trap 'rm -rf -- "$work"' EXIT

sort -t, -k5,5nr ~/data/sales.csv > "$work/sorted.csv"
head -3 "$work/sorted.csv" | cut -d, -f2,3,5
ls "$work"
```

One temp **directory** per run is often simpler than many temp files: a single `rm -rf` cleans everything.

## File descriptors beyond 0, 1, 2

Every process has numbered file descriptors. You already know 0 (stdin), 1 (stdout), 2 (stderr). You can open more — 3 to 9 freely, higher with care.

| Syntax | Effect |
|---|---|
| `exec 3> file` | open file for writing on fd 3 (truncate) |
| `exec 3>> file` | open for appending |
| `exec 3< file` | open for reading |
| `exec 3<> file` | open for reading and writing |
| `cmd >&3` | send cmd's stdout to fd 3 |
| `read -r line <&3` / `read -u 3 line` | read from fd 3 |
| `exec 3>&-` | close fd 3 |

`exec` with only redirections (no command) applies them to the **current shell**, for the rest of the script.

```bash title="fds.sh" playground
log=$(mktemp)
exec 3>> "$log"                  # open once
echo "step 1 done" >&3
echo "step 2 done" >&3
echo "this goes to the terminal"
exec 3>&-                        # close
cat "$log"
```

Opening a file once and writing many times is faster than `>> file` on every line, and keeps a log separate from normal output.

## Reading two files in step

```bash title="two-files.sh" playground
exec 3< ~/data/old.txt 4< ~/data/new.txt
while read -r a <&3 && read -r b <&4; do
  [[ $a == "$b" ]] && echo "same:    $a" || echo "changed: $a -> $b"
done
exec 3<&- 4<&-
```

## Automatic descriptors

Hard-coding numbers can clash with descriptors a caller already uses. `{name}` asks Bash for a free one (10 or above) and stores it in `$name`:

```bash title="auto-fd.sh" playground
exec {in}< ~/todo.txt
read -r first <&"$in"
read -r second <&"$in"
echo "fd $in gave: $first / $second"
exec {in}<&-
```

## Saving and restoring stdout

```bash
exec 5>&1                 # save the current stdout as fd 5
exec > build.log 2>&1     # everything now goes to the log
make
exec 1>&5 5>&-            # restore stdout, close the copy
```

Many scripts use `exec > >(tee -a "$logfile") 2>&1` to log everything while still showing it on the terminal.

## Common mistakes

```mistake
title: Predictable temp file names
wrong: |
  tmp=/tmp/myscript.$$
  sort data > "$tmp"
right: |
  tmp=$(mktemp) || exit 1
  trap 'rm -f -- "$tmp"' EXIT
  sort data > "$tmp"
why: "`$$` is easy to guess, so the name can be pre-created by an attacker; it also leaks files if the script dies."
```

```mistake
title: Forgetting exec
wrong: |
  3> out.log          # opens fd 3 for an empty command, then closes it
  echo hi >&3         # Bad file descriptor
right: |
  exec 3> out.log
  echo hi >&3
why: Without exec, a redirection applies only to the (empty) command it's attached to.
```

## Practice

```exercise
kind: mcq
difficulty: beginner
prompt: Which is the safest way to get a scratch file?
options:
  - "`tmp=/tmp/work.txt`"
  - "`tmp=/tmp/work.$RANDOM`"
  - "`tmp=$(mktemp)`"
  - "`tmp=$HOME/.work`"
answer: 2
explanation: mktemp creates a unique file atomically with private permissions.
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  f=$(mktemp)
  exec 3> "$f"
  echo one >&3
  echo two
  echo three >&3
  exec 3>&-
  cat "$f"
answer: |
  two
  one
  three
explanation: "`two` goes to the terminal immediately; the others go to the file, which is printed at the end."
```

```exercise
kind: command
difficulty: intermediate
prompt: "Create a temporary directory with mktemp, store its path in `d`, create `$d/a.txt`, and list the directory's contents."
solution: d=$(mktemp -d); touch "$d/a.txt"; ls "$d"
explanation: "`mktemp -d` makes a private, unique directory."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Split output streams
prompt: "Using fd 3 opened on a temp file, print each line of `~/data/numbers.txt` that is above 20 to stdout and each other line to fd 3. Afterwards print `small: ` followed by the small numbers joined with spaces (read them back from the temp file). Clean up with a trap."
starter: |
  #!/usr/bin/env bash
solution: |
  #!/usr/bin/env bash
  tmp=$(mktemp) || exit 1
  trap 'rm -f -- "$tmp"' EXIT
  exec 3> "$tmp"
  while read -r n; do
    if (( n > 20 )); then echo "$n"; else echo "$n" >&3; fi
  done < ~/data/numbers.txt
  exec 3>&-
  echo "small: $(tr '\n' ' ' < "$tmp" | sed 's/ $//')"
expectedOutput: |
  42
  100
  58
  23
  small: 7 19 3 7
checks:
  - pattern: mktemp
    message: Create the temp file with mktemp.
  - pattern: exec 3
    message: Open fd 3 with exec.
  - pattern: trap
    message: Clean up with a trap.
hints:
  - "`exec 3> \"$tmp\"` opens the file; `echo … >&3` writes to it."
  - "Close fd 3 before reading the file back."
explanation: "An extra descriptor gives a script a second output channel without reopening files."
```
