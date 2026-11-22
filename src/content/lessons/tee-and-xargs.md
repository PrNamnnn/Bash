---
objectives:
  - Save a stream to a file while it continues down a pipeline with `tee`
  - Write to root-owned files with `sudo tee`
  - Turn lines of input into command arguments with `xargs`
  - Process any file name safely with `-print0` / `-0`, and run work in parallel with `-P`
summary:
  - "`tee FILE` copies stdin to stdout and to FILE; `-a` appends."
  - "`echo line | sudo tee -a /etc/file` works where `sudo echo line >> /etc/file` fails — the redirection would run as you."
  - "`xargs CMD` reads items from stdin and runs CMD with them as arguments, batching to avoid length limits."
  - "Use `find … -print0 | xargs -0` for names with spaces; `-n N` limits args per call; `-I {}` substitutes; `-P N` parallelises; `-r` skips empty input."
related:
  - finding-files
  - pipes
  - performance
---

## tee: a T-junction for data

A pipeline is a one-way street: each command's output flows into the next. `tee` (named after the T-shaped plumbing fitting) lets you branch off a copy.

::command tee

```bash title="tee.sh" playground
cd ~/logs
grep ERROR app.log | tee /tmp/errors.txt | wc -l
echo "saved:"
cat /tmp/errors.txt
```

### Writing protected files

The `>` redirection is performed by *your* shell, before `sudo` even starts — so `sudo echo x >> /etc/hosts` fails with "Permission denied". `tee` opens the file itself, so running `tee` under sudo works:

```bash
echo '10.0.2.20 db.internal' | sudo tee -a /etc/hosts > /dev/null
```

The final `> /dev/null` hides tee's copy on standard output.

## xargs: from lines to arguments

Many commands want file names **as arguments**, not on standard input. `rm`, `chmod`, `cp` and `grep -l` don't read file names from stdin. `xargs` builds the command lines for them.

::command xargs

```bash title="xargs.sh" playground
cd ~/projects
find . -name '*.sh' | xargs wc -l
echo ---
printf '%s\n' web01 web02 db01 | xargs -I {} echo "checking {}..."
echo ---
seq 7 | xargs -n 3 echo
```

### Names with spaces

By default `xargs` splits input on any whitespace and interprets quotes. A file called `notes (copy).txt` becomes several bogus arguments. Use NUL characters as separators — the only byte that can't appear in a file name:

```bash title="nul.sh" playground
cd ~/downloads
echo "== broken =="
find . -name '*.txt' | xargs ls -l
echo "== safe =="
find . -name '*.txt' -print0 | xargs -0 ls -l
```

### Parallel work

`xargs -P N` runs up to N commands at once — a simple way to speed up independent tasks:

```bash
find photos -name '*.jpg' -print0 | xargs -0 -P 4 -n 20 jpegoptim --strip-all
cat hosts.txt | xargs -P 8 -I {} ssh {} 'uptime'
```

The simulator runs them one after another, but on a real system this can cut runtimes dramatically. Level 10 covers parallelism and its pitfalls.

## xargs vs find -exec

| Need | Use |
|---|---|
| Run a command on files found by `find` | `find … -exec cmd {} +` (simplest, safe) |
| Items come from something other than find | `… \| xargs cmd` |
| Parallel execution | `xargs -P` |
| One command per item, item in the middle | `xargs -I {}` or `-exec … {} \;` |

## Common mistakes

```mistake
title: xargs with empty input
wrong: |
  grep -l TODO *.py | xargs rm      # with no matches, GNU xargs runs "rm" once
right: |
  grep -lZ TODO *.py | xargs -0 -r rm --
why: "With empty input, GNU xargs runs the command once with no arguments. `-r` (`--no-run-if-empty`) prevents it. BSD xargs behaves like `-r` by default."
```

```mistake
title: sudo with redirection
wrong: |
  sudo echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf
right: |
  echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swap.conf > /dev/null
why: The redirection is set up by your unprivileged shell before sudo runs. `tee` opens the file with root privileges.
```

## Practice

```exercise
kind: command
difficulty: beginner
compare: both
prompt: "Print the lines of `~/logs/app.log` that contain `ERROR` **and** save them to `~/errors.txt` at the same time."
solution: grep ERROR ~/logs/app.log | tee ~/errors.txt
explanation: "`tee ~/errors.txt` writes the stream to the file and passes it on to the terminal. The checker compares both the output and the resulting file."
```

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  printf '%s\n' a b c d e | xargs -n 2 echo
answer: |
  a b
  c d
  e
explanation: "`-n 2` gives each `echo` at most two arguments."
```

```exercise
kind: command
difficulty: intermediate
prompt: "Count the lines of every `.sh` file under `~/projects`, using `find` and `xargs` safely (NUL-separated)."
solution: find ~/projects -name '*.sh' -print0 | xargs -0 wc -l
explanation: "`-print0` and `xargs -0` agree on NUL separators, so every possible file name is handled. `wc -l` prints a count per file and a total."
```

## Challenge

```exercise
kind: command
difficulty: intermediate
title: Placeholders
prompt: "For each server name in the first column of `~/data/servers.txt`, print a line `ping <name>` — using `cut` and `xargs -I`."
solution: cut -d' ' -f1 ~/data/servers.txt | xargs -I {} echo ping {}
hints:
  - "`-I {}` runs the command once per input line, replacing `{}`."
explanation: "`xargs -I {}` is ideal when the item must appear in the middle of the command. On a real network you'd replace `echo ping` with `ping -c1`."
```
