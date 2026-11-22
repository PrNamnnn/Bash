---
objectives:
  - Identify what a file really is with `file`, regardless of its name
  - Read detailed metadata with `stat`, including exact sizes, permissions and timestamps
  - Split paths into directory and name parts with `dirname` and `basename`
  - Use pure-Bash parameter expansion as a fast alternative inside loops
summary:
  - "`file` inspects content (magic bytes), not extensions — use it to detect scripts, archives, binaries and CRLF line endings."
  - "`stat` shows everything `ls -l` shows and more; `stat -c` (GNU) / `stat -f` (BSD) print chosen fields for scripts."
  - "`basename /a/b/c.txt .txt` → `c`; `dirname /a/b/c.txt` → `/a/b`."
  - "In loops, `${path##*/}` and `${path%/*}` do the same without starting a process."
related:
  - listing-and-navigating
  - parameter-expansion
  - users-groups-permissions
---

## What kind of file is this?

On Windows, the extension decides what a file is. On Unix, an extension is just part of the name — `report.pdf` could be a text file, and a script needs no extension at all. Programs that care look at the **content**. So does `file`:

::command file

::terminal
$ file notes.txt
$ file projects/scripts/*.sh
$ file /usr/bin/ls
$ file downloads/*
::

Notice that `deploy.sh` is reported without "executable" — it lacks the execute permission, which `file` mentions for scripts.

## Everything about a file: stat

::command stat

### The three timestamps

Unix tracks three times per file. They answer different questions:

| Time | Changes when… | Shown by |
|---|---|---|
| **mtime** (modify) | The *contents* change | `ls -l`, `stat`, `find -mtime` |
| **ctime** (change) | The *metadata* changes: permissions, owner, name — or contents | `ls -lc`, `stat` |
| **atime** (access) | The file is read (often updated lazily, `relatime`) | `ls -lu`, `stat` |

`ctime` is *not* "creation time". Linux filesystems may record a birth time, shown by `stat` as `Birth:`, but many tools ignore it.

## Taking paths apart

::command basename dirname

### The fast way inside scripts

Each `$(basename …)` starts a new process. In a loop over thousands of files that adds up. Bash's **parameter expansion** does the same string manipulation in-process:

```bash title="path-parts.sh" playground
path=/var/log/nginx/access.log.2.gz

echo "basename : $(basename "$path")"
echo "           ${path##*/}        # remove everything up to the last /"
echo "dirname  : $(dirname "$path")"
echo "           ${path%/*}        # remove the last / and everything after"
file=${path##*/}
echo "stem     : ${file%%.*}        # remove from the first dot"
echo "extension: ${file##*.}        # keep after the last dot"
```

You'll learn these operators in detail in Level 7. For now, remember the mnemonic: `#` removes from the **front** (it's on the left of `$` on a US keyboard), `%` removes from the **back**.

## Common mistakes

```mistake
title: Trusting extensions
wrong: |
  [[ $f == *.sh ]] && bash "$f"      # anything named .sh is run
right: |
  file "$f" | grep -q 'shell script' && bash "$f"
why: An extension is just part of a name. If the content matters — for security or correctness — inspect the content.
```

```mistake
title: Using GNU stat syntax on macOS
wrong: |
  size=$(stat -c %s file.txt)     # macOS: "illegal option -- c"
right: |
  size=$(wc -c < file.txt)        # portable byte count
why: "`stat` is not POSIX and the flags differ between GNU and BSD. For a portable size, `wc -c < file` works everywhere."
```

## Practice

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  basename /home/learner/data/sales.csv .csv
  dirname /home/learner/data/sales.csv
answer: |
  sales
  /home/learner/data
explanation: "`basename` keeps the last component and strips the optional suffix; `dirname` keeps everything before it."
```

```exercise
kind: command
difficulty: beginner
prompt: "Print only the size in bytes of `~/notes.txt`, using `stat` with a custom format."
solution: stat -c %s ~/notes.txt
hints:
  - "GNU stat takes `-c FORMAT`; `%s` is the size."
explanation: "`stat -c %s file` prints just the number — perfect for scripts. `wc -c < file` is the portable alternative."
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  f=/backups/db-2026-11-17.sql.gz
  name=${f##*/}
  echo "${name%%.*}"
  echo "${name#*.}"
answer: |
  db-2026-11-17
  sql.gz
hints:
  - "`%%` removes the *longest* match from the end; `#` removes the *shortest* match from the start."
explanation: "`${f##*/}` gives `db-2026-11-17.sql.gz`. `%%.*` removes from the first dot to the end; `#*.` removes up to and including the first dot."
```

## Challenge

```exercise
kind: command
difficulty: intermediate
title: Which files are scripts?
prompt: "In `~/projects/scripts`, print the names of the files that `file` identifies as shell scripts — one per line, file name only (no description)."
setup: cd ~/projects/scripts
solution: file * | grep 'shell script' | cut -d: -f1
hints:
  - "`file *` prints `name: description` for each file."
  - Filter with `grep`, then keep the part before the colon with `cut -d: -f1`.
explanation: "`file * | grep 'shell script' | cut -d: -f1` combines three tools: identify, filter, extract. This is your first real pipeline — Level 3 explains exactly how the `|` works."
```
