---
objectives:
  - Search directory trees by name, type, size, age and permissions with `find`
  - Combine tests with AND, OR and NOT, and skip directories with `-prune`
  - Act on results safely with `-exec … {} +`, `-delete` and `-print0 | xargs -0`
  - Know when `locate` is faster and why its results can be stale
summary:
  - "`find PATH TESTS ACTIONS` — tests filter (`-name`, `-type`, `-size`, `-mtime`), actions act (`-print` default, `-exec`, `-delete`)."
  - "Always quote patterns: `find . -name '*.log'`."
  - "Tests are ANDed by default; use `-o` for OR, `!` for NOT and `\\( … \\)` to group."
  - "`-exec cmd {} +` batches many paths into one command; `{} \\;` runs once per file."
  - "`locate` searches a prebuilt database: instant, but it doesn't know about files created since the last `updatedb`."
related:
  - listing-and-navigating
  - tee-and-xargs
  - grep-basics
---

## Why find?

Globs like `*.log` only look in one directory and only match names. Real questions are richer:

- *Which log files under /var/log are older than 30 days?*
- *Which files over 100 MB are filling the disk?*
- *Which scripts in this repo aren't executable?*

`find` walks a whole tree and evaluates an **expression** for every file it meets.

::command find

## How the expression works

`find` processes each path through the expression from left to right, like a little program:

```text
find ~/logs  -type f  -name '*.log'  -size +1k  -print
             └ test ┘ └─── test ───┘ └─ test ─┘ └action┘
```

- **Tests** are true or false for each file (`-type f`, `-name`, `-mtime +7`).
- **Actions** do something (`-print`, `-delete`, `-exec`).
- Juxtaposed items are combined with **AND**: the action runs only when all tests before it are true. If you give no action, `-print` is assumed.

### OR, NOT and grouping

```bash title="logic.sh" playground
cd ~
# images OR documents
find . \( -name '*.JPG' -o -name '*.pdf' \) -type f | sort
echo ---
# everything in projects that is NOT a shell script
find projects -type f ! -name '*.sh' | sort
```

The parentheses must be escaped (or quoted) because they are special to the shell.

### Skipping directories with -prune

To search a project but ignore `.git` or `node_modules`, prune them — `find` won't even descend into them:

```bash
find . -name .git -prune -o -type f -name '*.sh' -print
```

Read it as: "if it's named .git, prune it; otherwise, if it's a file named *.sh, print it." The explicit `-print` matters: without it, the pruned directories would be printed too.

## Acting on results

```bash title="act.sh" playground
cd ~/projects
# one command per file
find . -name '*.sh' -exec echo "found:" {} \;
# many files per command (faster)
find . -name '*.sh' -exec ls -l {} +
```

| Form | Behaviour | Use when |
|---|---|---|
| `-exec cmd {} \;` | Runs `cmd` once per file | The command takes exactly one file |
| `-exec cmd {} +` | Runs `cmd` with as many files as fit | Almost always — much faster |
| `-delete` | Deletes matches (implies depth-first) | Cleanup jobs; test with `-print` first |
| `-print0 \| xargs -0 cmd` | NUL-separated hand-off | You need xargs features like `-P` |

> [!WARNING] Order matters with -delete
> `find . -delete -name '*.tmp'` deletes **everything**, because `-delete` comes before the test and always runs. Put actions last, and run the command with `-print` instead of `-delete` first.

## Practical recipes

```bash
# old compressed logs
find /var/log -type f -name '*.gz' -mtime +30
# biggest files under the current directory (GNU -printf)
find . -type f -printf '%s\t%p\n' | sort -nr | head
# files changed in the last 60 minutes
find ~/projects -type f -mmin -60
# world-writable files (a security smell)
find / -xdev -type f -perm -0002 2>/dev/null
# empty directories
find . -type d -empty
# scripts that are not executable
find . -name '*.sh' ! -perm -u+x
```

::terminal
$ find ~ -name '*.csv'
$ find ~/logs -type f -size +1k
$ find ~ -type d -name '.*'
$ find ~/projects -name '*.sh' ! -perm -u+x
$ find / -name shadow
::

The last command shows `Permission denied` errors for directories you can't read. Add `2>/dev/null` to hide them — Level 3 explains why that works.

## locate

::command locate

## Common mistakes

```mistake
title: Unquoted pattern
wrong: |
  find . -name *.sh
right: |
  find . -name '*.sh'
why: "If the current directory contains `deploy.sh`, the shell expands `*.sh` before find runs, and find searches only for files named exactly `deploy.sh`. With two matches you get \"paths must precede expression\"."
```

```mistake
title: Piping find into xargs with spaces in names
wrong: |
  find . -name '*.txt' | xargs rm
right: |
  find . -name '*.txt' -print0 | xargs -0 rm --
  find . -name '*.txt' -exec rm -- {} +
why: "`xargs` splits on whitespace by default, so `notes (copy).txt` becomes three bogus arguments."
```

## Practice

```exercise
kind: command
difficulty: beginner
prompt: "Find every file ending in `.log` anywhere under your home directory."
solution: find ~ -name '*.log'
hints:
  - Start path, then `-name` with a quoted glob.
explanation: "`find ~ -name '*.log'` searches recursively. Add `-type f` to exclude directories that happen to match."
```

```exercise
kind: command
difficulty: beginner
prompt: "List all **directories** (only directories) inside `~/projects`, including `~/projects` itself."
solution: find ~/projects -type d
explanation: "`-type d` keeps directories, `-type f` regular files."
```

```exercise
kind: command
difficulty: intermediate
prompt: "Find files in `~/projects` that are **not** shell scripts (names not ending in `.sh`). Only regular files."
solution: find ~/projects -type f ! -name '*.sh'
hints:
  - "`!` (or `-not`) negates the test that follows."
explanation: "`! -name '*.sh'` inverts the name test. Tests are ANDed: regular file AND not named *.sh."
```

```exercise
kind: mcq
difficulty: intermediate
prompt: You want to make every `.sh` file in a large repository executable as fast as possible. Which is best?
options:
  - "`find . -name '*.sh' -exec chmod +x {} \\;`"
  - "`find . -name '*.sh' -exec chmod +x {} +`"
  - "`chmod +x $(find . -name '*.sh')`"
  - "`for f in $(find . -name '*.sh'); do chmod +x $f; done`"
answer: 1
hints:
  - Which form starts the fewest processes and handles any file name?
explanation: "`{} +` passes many paths to each `chmod`, starting very few processes, and handles spaces correctly. Options 3 and 4 break on spaces and can hit argument-length limits."
```

## Challenge

```exercise
kind: command
difficulty: advanced
title: Archive cleanup preview
prompt: "Under `~/logs`, list the **regular files** whose names start with `access.log.` (rotated logs) — but skip anything inside a directory named `tmp`. Print the paths."
solution: find ~/logs -name tmp -prune -o -type f -name 'access.log.*' -print
hints:
  - Use `-prune` for the directory to skip, `-o` for "otherwise", and an explicit `-print`.
explanation: "`-name tmp -prune -o … -print` is the standard skip pattern. There's no `tmp` folder in the sandbox, so the result is the two archived logs — but the command stays correct when one appears."
```
