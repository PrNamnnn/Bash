---
objectives:
  - Search files and command output for lines matching a pattern
  - Use the essential flags `-i`, `-v`, `-n`, `-c`, `-r`, `-l`, `-w`, `-o`, `-q`
  - Search whole project trees, including only certain file types
  - Use grep's exit status in conditions
summary:
  - "`grep PATTERN FILE…` prints matching lines; with no file it reads stdin, so it fits anywhere in a pipeline."
  - "`-i` ignore case, `-v` invert, `-n` line numbers, `-c` count, `-r` recurse, `-l` file names only, `-w` whole words, `-o` only the match."
  - "`grep -q` prints nothing and is ideal in `if` statements: exit status 0 = found, 1 = not found, 2 = error."
  - "Quote patterns; remember `.` matches any character; use `-F` for literal strings."
related:
  - regular-expressions
  - grep-in-depth
  - finding-files
---

## What grep does

`grep` reads input line by line and prints the lines that match a pattern. The name comes from the old `ed` editor command `g/re/p` — *globally* search for a *regular expression* and *print*.

::command grep

## Hands-on with real logs

The sandbox has a web server access log and an application log. Each line of `access.log` looks like this:

```text
192.168.1.22 - - [10/Nov/2026:08:06:30 +0000] "POST /api/checkout HTTP/1.1" 500 89 "..." "Mozilla/5.0 ..."
```

::terminal
$ grep checkout logs/access.log
$ grep -c ' 500 ' logs/access.log
$ grep -v health logs/app.log
$ grep -n -i 'TIMEOUT' logs/*.log
$ grep -l ERROR logs/*
$ grep -o 'user=[a-z]*' logs/app.log
$ grep -r 'TODO' projects
::

## The flags you'll use every day

```bash title="flags.sh" playground
cd ~/logs
echo "== lines with ERROR =="
grep ERROR app.log
echo "== how many? =="
grep -c ERROR app.log
echo "== everything except health checks =="
grep -v '\[health\]' app.log | head -n 3
echo "== which users appear? =="
grep -o 'user=[a-z]*' app.log | sort -u
```

## Searching code trees

```bash
grep -rn 'set -e' ~/projects                  # recursive, with line numbers
grep -rn --include='*.sh' 'mktemp' .          # only shell scripts
grep -rl 'api_key' --exclude-dir=.git .       # just the file names
grep -rnw 'main' src/                         # 'main' as a whole word
```

> [!TIP] ripgrep
> On large repositories, [`rg` (ripgrep)](https://github.com/BurntSushi/ripgrep) is a faster, `.gitignore`-aware alternative with similar flags. It's not installed by default, so scripts should still use `grep`.

## grep in conditions

The exit status makes `grep -q` the natural way to test text:

```bash title="conditions.sh" playground
if grep -q '^learner:' /etc/passwd; then
  echo "user learner exists"
fi
grep -q 'port=9090' ~/.config/app.conf || echo "port is not 9090"
```

| Exit status | Meaning |
|---|---|
| 0 | At least one line matched |
| 1 | No line matched |
| 2 | An error occurred (e.g. file not found) |

## Patterns are regular expressions

The pattern is a **regular expression**, not plain text. A few characters are special:

| Pattern | Matches |
|---|---|
| `^ERROR` | ERROR at the start of a line |
| `\.log$` | .log at the end of a line |
| `.` | any single character |
| `[0-9]` | one digit |
| `a*` | zero or more `a` |

Level 4 covers regular expressions in depth. For now: if you want to search for text containing `.`, `*`, `[` or `$` literally, use `grep -F` (fixed strings).

## Common mistakes

```mistake
title: Forgetting that . is special
wrong: |
  grep '10.0.1.1' servers.txt   # also matches 10a0b1c1, 1001011...
right: |
  grep -F '10.0.1.1' servers.txt
  grep '10\.0\.1\.1' servers.txt
why: In a regular expression `.` matches any character. Escape it or search for a fixed string.
```

```mistake
title: grep matching itself in ps output
wrong: |
  ps aux | grep nginx         # also shows the "grep nginx" process
right: |
  ps aux | grep '[n]ginx'      # the pattern no longer matches its own command line
  pgrep -a nginx               # better: a tool made for this
why: "`grep nginx` appears in the process list and contains the word nginx. `[n]ginx` matches \"nginx\" but the literal text `[n]ginx` doesn't."
```

## Practice

```exercise
kind: command
difficulty: beginner
prompt: "Print the lines of `~/logs/app.log` that contain `WARN`."
solution: grep WARN ~/logs/app.log
explanation: "`grep WARN file` prints every matching line."
```

```exercise
kind: command
difficulty: beginner
prompt: "Count how many requests in `~/logs/access.log` received a `404` status. (Hint: the status is surrounded by spaces.)"
solution: grep -c ' 404 ' ~/logs/access.log
hints:
  - Searching for just 404 might match a byte count or path. Include the spaces.
  - "`-c` counts matching lines."
explanation: "`grep -c ' 404 '` counts lines with the status code. A more precise version extracts the status field with awk — Level 4."
```

```exercise
kind: command
difficulty: beginner
prompt: "Show lines of `~/logs/app.log` that mention `checkout`, ignoring case, with line numbers."
solution: grep -in checkout ~/logs/app.log
explanation: "`-i` ignores case and `-n` prefixes line numbers; flags combine as `-in`."
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  printf 'cat\ncatalog\nconcat\nCat\n' | grep -wi cat
answer: |
  cat
  Cat
hints:
  - "`-w` requires the match to be a whole word; `-i` ignores case."
explanation: "`catalog` and `concat` contain `cat` but not as a whole word. `-i` lets `Cat` match."
```

## Challenge

```exercise
kind: command
difficulty: intermediate
title: Files that mention the database
prompt: "List the names of all files under your home directory (recursively) whose contents mention `db.internal`. Print file paths only."
solution: grep -rl 'db.internal' ~
hints:
  - "`-r` recurses, `-l` prints only file names."
explanation: "`grep -rl db.internal ~` finds the config file and the app log. Strictly, `-F 'db.internal'` would avoid the `.` matching any character."
```
