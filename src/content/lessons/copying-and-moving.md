---
objectives:
  - Copy files and directory trees with `cp`
  - Rename and move files with `mv`
  - Predict where a copy or move ends up when the destination is (or isn't) a directory
  - Avoid silent overwrites and use atomic renames for safe updates
summary:
  - "`cp SRC DEST` copies; `cp -r` copies directories; `-a` (archive) preserves permissions and times."
  - "`mv` both renames and moves; within one filesystem it is instant and atomic."
  - "If DEST is an existing directory, the source goes *inside* it; otherwise DEST is the new name."
  - "Both overwrite existing files silently — use `-i` interactively and `-n` to never overwrite."
  - "Write to a temporary file and `mv` it into place so readers never see half-written data."
related:
  - creating-and-removing
  - atomicity-and-idempotency
  - networking-and-ssh
---

## Copying

::command cp

### Where does the copy go?

The rule that confuses everyone: the meaning of the last argument depends on whether it already exists as a directory.

| Command | `dest` doesn't exist | `dest` is an existing directory |
|---|---|---|
| `cp file.txt dest` | creates file `dest` | creates `dest/file.txt` |
| `cp -r src dest` | copies `src` *as* `dest` | creates `dest/src` |
| `cp a.txt b.txt dest` | error: target is not a directory | creates `dest/a.txt` and `dest/b.txt` |

Run the same command twice and watch the result change:

```bash title="nesting.sh" playground
cd /tmp
mkdir -p src && touch src/a.txt
cp -r src copy      # copy doesn't exist yet → becomes a copy of src
cp -r src copy      # now copy exists → creates copy/src
find copy | sort
```

To avoid surprises in scripts, make the intent explicit: end directory destinations with `/`, and use `cp -r src/. dest/` to copy the *contents* of src into dest.

## Moving and renaming

::command mv

### Atomic replacement

Because a rename within a filesystem is a single, atomic operation, `mv` is the standard way to replace a file safely:

```bash
generate_report > report.html.tmp && mv report.html.tmp report.html
```

Anyone reading `report.html` sees either the complete old version or the complete new one — never a half-written file. If generation fails, the old report stays untouched. You'll use this pattern in deployments and config management later in the course.

## Overwrites

Neither `cp` nor `mv` asks before replacing an existing file. Interactively, many people alias them:

```bash
alias cp='cp -i'
alias mv='mv -i'
```

In scripts, aliases don't apply (and prompts would hang automation). Use `-n` to never overwrite, or check explicitly:

```bash title="no-clobber.sh" playground
cd /tmp
echo "original" > target.txt
echo "new" > incoming.txt
cp -n incoming.txt target.txt     # skipped: target exists
cat target.txt
[[ -e target.txt ]] && echo "target exists, refusing to overwrite" >&2
```

::terminal
$ cp notes.txt notes.bak
$ ls
$ mv notes.bak backups-notes.txt
$ mkdir -p archive && mv backups-notes.txt archive/
$ ls archive
$ cp -r projects/website /tmp/site && ls /tmp/site
::

## Common mistakes

```mistake
title: Copying a directory without -r
wrong: |
  cp projects backup
  # cp: -r not specified; omitting directory 'projects'
right: |
  cp -r projects backup
  cp -a projects backup     # also keeps permissions and timestamps (GNU)
why: "`cp` copies files by default. Directories need `-r` (recursive)."
```

```mistake
title: Renaming many files with mv and a glob
wrong: |
  mv *.txt *.bak     # does NOT rename each file
right: |
  for f in *.txt; do mv -- "$f" "${f%.txt}.bak"; done
why: "The shell expands both globs first. `mv` receives a list of files and treats the last one as the destination. Renaming many files needs a loop (or a dedicated tool)."
```

## Practice

```exercise
kind: mcq
difficulty: beginner
prompt: "`~/backup` already exists as a directory. Where does `cp -r ~/projects ~/backup` put the copy?"
options:
  - ~/backup (replacing it)
  - ~/backup/projects
  - ~/projects/backup
  - It fails because backup exists
answer: 1
explanation: When the destination is an existing directory, the source is copied **into** it, keeping its own name.
```

```exercise
kind: command
difficulty: beginner
compare: fs
prompt: "Rename `~/todo.txt` to `~/tasks.txt`."
solution: mv ~/todo.txt ~/tasks.txt
explanation: Renaming is just moving to a new name in the same directory.
```

```exercise
kind: command
difficulty: beginner
compare: fs
prompt: "Copy every `.csv` file from `~/data` into a new directory `~/reports` (create it first in the same command line)."
solution: mkdir -p ~/reports && cp ~/data/*.csv ~/reports/
hints:
  - "Use `&&` to run the copy only if creating the directory succeeded."
  - "With several sources, the last argument must be a directory."
explanation: "`mkdir -p ~/reports && cp ~/data/*.csv ~/reports/` creates the folder, then the glob supplies both CSV files to `cp`."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Safe update
prompt: "Complete the function so it writes the new content to a temporary file in the same directory and then atomically replaces `$target` with it. The script prints the final contents."
starter: |
  #!/usr/bin/env bash
  target=/tmp/config.txt
  echo "port=8080" > "$target"

  update_config() {
    local new_content=$1
    # write $new_content to a temp file next to $target, then mv it over $target

  }

  update_config "port=9090"
  cat "$target"
solution: |
  #!/usr/bin/env bash
  target=/tmp/config.txt
  echo "port=8080" > "$target"

  update_config() {
    local new_content=$1
    local tmp="$target.tmp.$$"
    printf '%s\n' "$new_content" > "$tmp" && mv -- "$tmp" "$target"
  }

  update_config "port=9090"
  cat "$target"
expectedOutput: port=9090
checks:
  - pattern: \bmv\b
    message: Use mv to replace the file atomically.
  - pattern: \bcp\b.*\$target
    forbid: true
    message: Copying over the target is not atomic — write a temp file and mv it.
hints:
  - Put the temporary file in the same directory as the target, so the rename stays on one filesystem.
  - "`$$` is the shell's process ID — handy for a unique suffix (mktemp is even better)."
explanation: "Writing to `\"$target.tmp.$$\"` and then `mv` replaces the file in a single atomic step. On a real system, `mktemp \"$target.XXXXXX\"` gives a safer unique name."
```
