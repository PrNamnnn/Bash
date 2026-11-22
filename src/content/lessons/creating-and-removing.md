---
objectives:
  - Create directories, including whole paths, with `mkdir -p`
  - Create empty files and update timestamps with `touch`
  - Remove files and directories safely with `rm` and `rmdir`
  - Build habits that prevent catastrophic deletions
summary:
  - "`mkdir -p` creates nested directories and doesn't fail if they exist — use it in scripts."
  - "`touch` creates empty files or refreshes modification times."
  - "`rmdir` only removes empty directories; `rm -r` removes trees. There is no recycle bin."
  - "Preview globs with `echo` or `ls` before deleting; quote variables; use `--`; guard against empty variables with `${var:?}`."
related:
  - listing-and-navigating
  - copying-and-moving
  - brace-and-tilde-expansion
---

## Creating directories

::command mkdir

Brace expansion (covered properly in Level 2) makes `mkdir -p` especially powerful:

```bash title="scaffold.sh" playground
cd /tmp
mkdir -p myapp/{src,tests,docs/{api,guides}}
find myapp | sort
```

## Creating files

::command touch

Most files are created by programs writing to them, or by redirection: `echo "hello" > greeting.txt` creates (or overwrites!) a file. `touch` is for when you need a file to *exist*, or need to change its timestamp.

## Removing things

Deleting is where beginners — and experienced engineers — get hurt. Unlike a desktop's trash can, `rm` removes the name from the directory immediately. Recovery tools exist but are unreliable.

::command rmdir rm

### A safe-deletion checklist

1. **Look before you delete.** Replace `rm` with `ls` or `echo` to see exactly what a glob matches (see below).
2. **Quote variables** so spaces don't split names into several targets.
3. **Use `--`** so a file named `-rf` isn't read as options.
4. **Guard against empty variables** in scripts: `${dir:?}` aborts if `dir` is unset or empty.
5. **Prefer specific paths** to broad globs, and `find … -delete` with tests you've checked using `-print` first.

```bash
echo rm -- *.log     # prints the command instead of running it
```

```bash title="guard.sh" playground
dir=""
# Without a guard this would be: rm -rf /  (refused by GNU rm, but don't rely on it)
rm -rf -- "${dir:?dir is empty, refusing to delete}"/
echo "not reached"
```

> [!DANGER] The most expensive typo in computing
> `rm -rf / home/user/tmp` (note the space) deletes from the root. `rm -rf "$DIR"/*` with an unset `DIR` becomes `rm -rf /*`. Real companies have lost production systems to both. Use `set -u`, `${var:?}`, quotes and dry runs.

Experiment freely — the sandbox can always be reset:

::terminal
$ mkdir -p sandbox/a/b/c
$ touch sandbox/a/file.txt
$ rmdir sandbox/a/b
$ rm sandbox
$ rm -rv sandbox
$ rm -i notes.txt
::

Notice how `rm -i` asks a question: in this sandbox the answer comes from standard input, which is empty, so nothing is deleted. In a real terminal you would type `y` or `n`.

## Common mistakes

```mistake
title: Forgetting -p in scripts that run more than once
wrong: |
  mkdir /var/backups/app      # second run: "File exists" — script fails under set -e
right: |
  mkdir -p /var/backups/app
why: "`mkdir -p` succeeds whether or not the directory already exists, making scripts idempotent."
```

```mistake
title: Deleting with an unquoted variable
wrong: |
  rm -rf $build_dir
right: |
  rm -rf -- "${build_dir:?}"
why: If `build_dir` is `my build`, the unquoted version deletes `my` and `build`. If it's empty, quoting plus `:?` makes the script stop instead of deleting something else.
```

## Practice

```exercise
kind: command
difficulty: beginner
compare: fs
fixture: empty
prompt: "Create the directories `project/src` and `project/tests` in your home directory with a single command."
solution: mkdir -p project/src project/tests
hints:
  - You need parent directories created automatically.
  - "`mkdir` accepts several paths at once — or use braces: `project/{src,tests}`."
explanation: "`mkdir -p project/{src,tests}` (or listing both paths) creates `project` and both children. The checker compares the resulting directory tree."
```

```exercise
kind: mcq
difficulty: beginner
prompt: What happens when you run `rmdir logs` and `logs` contains files?
options:
  - It deletes the directory and the files
  - It fails with "Directory not empty" and changes nothing
  - It asks for confirmation
  - It moves the files to the parent directory
answer: 1
explanation: "`rmdir` only removes empty directories — that's what makes it safe. Use `rm -r` when you really mean to delete contents."
```

```exercise
kind: command
difficulty: beginner
compare: fs
prompt: "Delete every `.jpg`/`.JPG` image in `~/photos` but keep the `.png` and `.PNG` files."
solution: rm ~/photos/*.JPG
hints:
  - Preview first with `ls ~/photos/*.JPG`.
  - Globs are case-sensitive.
explanation: "The images are named `IMG_000N.JPG` in upper case, so `*.JPG` matches them and `*.jpg` matches nothing. Always preview a glob before using it with `rm`."
```

```exercise
kind: find-bug
difficulty: intermediate
prompt: This cleanup script deleted far more than intended when `CACHE_DIR` was not set. Which line is the bug?
code: |
  #!/usr/bin/env bash
  echo "Cleaning cache..."
  rm -rf "$CACHE_DIR"/*
  echo "Done."
answer: 3
fix: |
  rm -rf -- "${CACHE_DIR:?CACHE_DIR is not set}"/*
hints:
  - What does `"$CACHE_DIR"/*` become when the variable is empty?
explanation: "With an empty variable, line 3 becomes `rm -rf /*`. `${CACHE_DIR:?message}` aborts the script instead. `set -u` would also catch an *unset* variable, but not one set to an empty string."
```

## Challenge

```exercise
kind: command
difficulty: intermediate
compare: fs
fixture: empty
title: Dated folders
prompt: "Create a directory structure `archive/2026/01` through `archive/2026/12` (twelve month folders, zero-padded) with one command."
solution: mkdir -p archive/2026/{01..12}
hints:
  - "Brace expansion can generate sequences: `{1..5}`."
  - "Zero-padding: if either end of the sequence has a leading zero, all numbers are padded."
explanation: "`mkdir -p archive/2026/{01..12}` expands to twelve paths before mkdir runs. `-p` creates `archive` and `2026` along the way."
```
