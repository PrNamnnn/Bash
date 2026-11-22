---
objectives:
  - List directory contents with the right level of detail
  - Read every column of `ls -l` output
  - Move around the tree efficiently with `cd`
  - Visualise directory structure with `tree` (or `find` when tree isn't installed)
summary:
  - "`ls` shows names; `ls -l` adds type, permissions, links, owner, group, size, date; `-a` includes hidden files; `-h` makes sizes readable; `-t` sorts by time."
  - "`cd DIR` moves, `cd` goes home, `cd -` goes back, `cd ..` goes up. Always check `cd` succeeded in scripts."
  - "`tree -L N` draws the hierarchy; `find . -maxdepth N` works where tree isn't installed."
  - Never parse `ls` output in scripts — use globs or `find`.
related:
  - absolute-and-relative-paths
  - creating-and-removing
  - inspecting-files
---

## Seeing what's there

You navigate a filesystem you can't see, so you need a reliable way to look around. `ls` (list) is that way.

::command ls

### Reading `ls -l`

Long format packs a lot into one line. Here is a line from `ls -l ~/projects/scripts`, taken apart:

```text
-rwxr-xr-x 1 learner learner 412 Nov 14 09:12 backup.sh
│└──┬────┘ │ └──┬──┘ └──┬──┘ └┬┘ └─────┬────┘ └───┬───┘
│   │      │    │       │     │        │          └ name
│   │      │    │       │     │        └ last modification time
│   │      │    │       │     └ size in bytes
│   │      │    │       └ group
│   │      │    └ owner
│   │      └ number of hard links
│   └ permissions: user rwx, group r-x, others r-x
└ type: - file, d directory, l symbolic link
```

The first line of the output, `total 16`, is the disk space used by the listed files in 1-KiB blocks — not the number of files.

Explore the sandbox's home directory with different options and compare the results:

::terminal
$ ls
$ ls -l
$ ls -la
$ ls -lh logs
$ ls -lt logs
$ ls -F projects
$ ls -R projects
::

> [!NOTE] Columns vs one per line
> When output goes to the screen, `ls` arranges names in columns. When it goes into a pipe or file, it prints one name per line. That's why `ls | wc -l` counts entries correctly — `ls` checks whether its output is a terminal.

## Moving around

::command cd

A handy pattern is to combine moving and looking:

```bash title="tour.sh" playground
cd ~/projects && ls
cd website && pwd
cd - >/dev/null && pwd
cd && pwd
```

### pushd and popd

When you bounce between several directories, Bash's directory stack helps: `pushd DIR` changes directory and remembers where you were; `popd` returns.

```console
$ pushd /var/log
/var/log ~
$ pushd ~/projects
~/projects /var/log ~
$ popd
/var/log ~
```

## Seeing the structure

::command tree

If `tree` isn't installed, `find` gives you a plain-text equivalent:

```bash
find . -maxdepth 2 -not -path '*/.*' | sort
```

## Why not parse ls?

`ls` output is meant for humans. File names can contain spaces, tabs and even newlines, and `ls` may replace unusual characters with `?`. A loop like this breaks on the first file name with a space:

```mistake
title: Looping over ls output
wrong: |
  for f in $(ls ~/downloads); do
    echo "file: $f"
  done
right: |
  for f in ~/downloads/*; do
    echo "file: $f"
  done
why: "The unquoted `$(ls)` is split on whitespace, so `notes (copy).txt` becomes two items. A glob produces one item per file, whatever the name."
```

```bash title="spaces.sh" playground
cd ~/downloads
echo "--- wrong ---"
for f in $(ls); do echo "[$f]"; done
echo "--- right ---"
for f in *; do echo "[$f]"; done
```

## Common mistakes

```mistake
title: Ignoring cd failures in scripts
wrong: |
  cd /srv/app/releases/old
  rm -rf *
right: |
  cd /srv/app/releases/old || exit 1
  rm -rf -- *
why: If the directory doesn't exist, `cd` fails and the script carries on in its current directory — deleting the wrong files.
```

```mistake
title: Confusing ls -a and ls -A
wrong: |
  for entry in $(ls -a); do ...   # includes . and ..
right: |
  ls -A                           # hidden files, without . and ..
why: "`-a` shows the special `.` and `..` entries; scripts that process them can recurse into the parent directory."
```

## Practice

```exercise
kind: mcq
difficulty: beginner
prompt: "In `drwxr-x--- 2 learner learner 4096 Nov 14 09:12 secrets`, what is `secrets`?"
options:
  - A regular file that only learner can read
  - A directory; the owner has full access, the group can list and enter it, others have no access
  - A symbolic link
  - An executable program
answer: 1
hints:
  - Look at the very first character, then at the three groups of rwx.
explanation: "The leading `d` means directory. `rwx` for the owner, `r-x` for the group (list and enter, but not create or delete), `---` for everyone else."
```

```exercise
kind: command
difficulty: beginner
prompt: List the contents of `~/logs` in long format with human-readable sizes.
solution: ls -lh ~/logs
hints:
  - "Combine `-l` and `-h`."
explanation: "`ls -lh` shows sizes like `2.1K` instead of `2154`. Flags can be written separately (`-l -h`) or combined."
```

```exercise
kind: command
difficulty: beginner
prompt: "Show only the *names* of the entries in `~/projects/scripts`, one per line, sorted with the most recently modified first."
solution: ls -1t ~/projects/scripts
hints:
  - One flag sorts by time, another forces one name per line.
explanation: "`-t` sorts newest first and `-1` prints one per line. In this sandbox all scripts share a timestamp, so the names fall back to alphabetical order — on a real system you'd see the newest at the top."
```

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  cd /var/log
  cd ../..
  pwd
  cd -
answer: |
  /
  /var/log
hints:
  - "`cd -` prints the directory it switches to."
explanation: "Two levels up from `/var/log` is `/`. `cd -` returns to the previous directory and prints it."
```

## Challenge

```exercise
kind: command
difficulty: intermediate
title: Count the directories
prompt: "Print the number of **directories** (not files) directly inside your home directory, excluding hidden ones. Output just the number."
solution: ls -d ~/*/ | wc -l
hints:
  - "A glob ending in `/` matches only directories."
  - "`ls -d` lists the directories themselves rather than their contents; `wc -l` counts lines."
explanation: "`~/*/` matches only directories; `ls -d` prints one per line when piped; `wc -l` counts them. `find ~ -mindepth 1 -maxdepth 1 -type d -not -name '.*' | wc -l` gives the same answer."
```
