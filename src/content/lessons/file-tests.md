---
objectives:
  - Use the file test operators to check existence, type, permissions and size
  - Compare file ages with `-nt` and `-ot`
  - Write robust pre-flight checks for scripts that read and write files
  - Understand race conditions between testing and using a file
summary:
  - "`-e` exists, `-f` regular file, `-d` directory, `-L` symbolic link, `-p` pipe, `-S` socket, `-b`/`-c` devices."
  - "`-r`, `-w`, `-x` check permissions for the current user; `-s` means \"exists and is not empty\"."
  - "`a -nt b` / `a -ot b` compare modification times; `-ef` checks whether two names are the same file."
  - "Tests follow symbolic links (except `-L`), and a broken link fails `-e`."
  - "A test only describes the moment it runs — for safety, act and handle failure instead of test-then-act where possible."
related:
  - if-statements
  - conditional-expressions
  - users-groups-permissions
---

## The operators

All of these work in `[ ]` and `[[ ]]`.

| Test | True when the path… |
|---|---|
| `-e PATH` | exists (any type) |
| `-f PATH` | is a regular file |
| `-d PATH` | is a directory |
| `-L PATH` / `-h` | is a symbolic link |
| `-p PATH` | is a named pipe (FIFO) |
| `-S PATH` | is a socket |
| `-b` / `-c` | is a block / character device |
| `-r PATH` | is readable by you |
| `-w PATH` | is writable by you |
| `-x PATH` | is executable (or, for a directory, searchable) by you |
| `-s PATH` | exists and has a size greater than zero |
| `-O PATH` / `-G` | is owned by your user / group |
| `-u` / `-g` / `-k` | has the setuid / setgid / sticky bit |
| `A -nt B` | A is newer than B (or B doesn't exist) |
| `A -ot B` | A is older than B |
| `A -ef B` | A and B are the same file (same device and inode) |

```bash title="file-tests.sh" playground
check() {
  local p=$1
  printf '%-28s' "$p"
  [[ -e $p ]] || { echo "does not exist"; return; }
  [[ -d $p ]] && printf 'dir '
  [[ -f $p ]] && printf 'file '
  [[ -r $p ]] && printf 'r'
  [[ -w $p ]] && printf 'w'
  [[ -x $p ]] && printf 'x'
  [[ -s $p ]] || printf ' (empty)'
  echo
}
check ~/notes.txt
check ~/projects/scripts/deploy.sh
check ~/projects
check /etc/shadow
check /tmp
check ~/missing
```

## Pre-flight checks

Good scripts check their inputs and outputs before doing work:

```bash
[[ -f $input ]]  || die "input not found: $input"
[[ -r $input ]]  || die "cannot read: $input"
[[ -s $input ]]  || die "input is empty: $input"
[[ -d $outdir ]] || mkdir -p -- "$outdir" || die "cannot create $outdir"
[[ -w $outdir ]] || die "cannot write to $outdir"
```

## Freshness: -nt and -ot

Build tools rebuild outputs only when an input is newer. You can do the same:

```bash title="freshness.sh" playground
cd /tmp
echo "data" > source.csv
touch -d '1 hour ago' report.html 2>/dev/null || touch report.html
if [[ source.csv -nt report.html ]]; then
  echo "source changed — regenerating report"
fi
```

## Symbolic links

File tests follow symbolic links: `-f link` is true if the link points to a regular file. `-L` tests the link itself. A **broken** link (pointing at nothing) is `-L` true but `-e` false.

```bash title="links.sh" playground
cd "$(mktemp -d)"
echo data > real.txt
ln -s real.txt good
ln -s /nonexistent dangling
for p in real.txt good dangling; do
  printf '%-9s' "$p"
  [[ -L $p ]] && printf ' link'
  [[ -e $p ]] && printf ' exists' || printf ' target-missing'
  [[ -f $p ]] && printf ' regular-file'
  echo
done
```

## Time-of-check vs time-of-use

A test describes the filesystem at one instant. Between `[[ ! -e $f ]]` and writing `$f`, another process could create it — a **race condition** (TOCTOU). For safety-critical operations, prefer atomic operations that fail cleanly:

| Racy | Atomic alternative |
|---|---|
| `[[ -d $lock ]] \|\| mkdir $lock` | `mkdir "$lock"` (fails if it exists) |
| `[[ -e $f ]] \|\| echo x > $f` | `set -C; echo x > "$f"` (noclobber) |
| check then write a temp file | `mktemp` |

The atomicity lesson in Level 10 explores this.

## Common mistakes

```mistake
title: -e when you mean -f
wrong: |
  [[ -e $config ]] && source "$config"    # a directory named config also passes
right: |
  [[ -f $config && -r $config ]] && source "$config"
why: "`-e` is true for directories, devices and sockets too. Test for the type you actually need."
```

```mistake
title: Testing permissions as root
wrong: |
  # in a script run with sudo
  [[ -w /etc/shadow ]] && echo "writable"   # always true for root
right: |
  # test as the user who will actually use the file:
  sudo -u www-data test -r /var/www/app.env && echo "web user can read it"
why: "`-r`, `-w`, `-x` answer for the current user; root bypasses most permission checks."
```

## Practice

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  [[ -d ~/data ]] && echo A
  [[ -f ~/data ]] && echo B
  [[ -e ~/data/sales.csv ]] && echo C
  [[ -x ~/projects/scripts/deploy.sh ]] || echo D
answer: |
  A
  C
  D
explanation: "`~/data` is a directory, not a regular file; sales.csv exists; deploy.sh lacks the execute bit."
```

```exercise
kind: mcq
difficulty: beginner
prompt: Which test is true for a file that exists but contains zero bytes?
options:
  - "`-s file`"
  - "`-f file`"
  - "`-z file`"
  - "`-n file`"
answer: 1
explanation: "`-f` checks it's a regular file; `-s` would be false because the size is zero. `-z`/`-n` test strings, not files."
```

```exercise
kind: command
difficulty: beginner
prompt: "Print `readable` if `/etc/shadow` is readable by you, otherwise print `protected`."
solution: "[[ -r /etc/shadow ]] && echo readable || echo protected"
explanation: "`/etc/shadow` holds password hashes and is readable only by root (and the shadow group), so you'll see `protected`."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Audit a directory
prompt: "For every entry directly in `~/projects/scripts`, print `NAME: executable` if it is a regular file with execute permission, or `NAME: not executable` otherwise."
starter: |
  #!/usr/bin/env bash
  for f in ~/projects/scripts/*; do
    :
  done
solution: |
  #!/usr/bin/env bash
  for f in ~/projects/scripts/*; do
    name=${f##*/}
    if [[ -f $f && -x $f ]]; then
      echo "$name: executable"
    else
      echo "$name: not executable"
    fi
  done
expectedOutput: |
  backup.sh: executable
  broken.sh: executable
  deploy.sh: not executable
  greet.sh: executable
hints:
  - "`${f##*/}` gives the file name without the directory."
explanation: "Combine `-f` and `-x` with `&&` inside `[[ ]]`. The glob returns entries in sorted order."
```
