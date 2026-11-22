---
objectives:
  - Distinguish absolute paths from relative paths
  - Use `.`, `..`, `~` and `-` to navigate efficiently
  - Predict where a relative path points, given the current directory
  - Explain why scripts should be careful with relative paths
summary:
  - An **absolute path** starts with `/` and means the same thing everywhere.
  - A **relative path** is resolved against the current working directory, so its meaning depends on where you are.
  - "`.` is the current directory, `..` the parent, `~` your home, and `cd -` the previous directory."
  - Paths are normalised by the kernel; `a/./b/../c` is the same as `a/c` (if `b` exists).
  - Scripts that rely on the caller's current directory break when run from elsewhere — resolve paths against the script's own location or use absolute paths.
related:
  - linux-filesystem
  - listing-and-navigating
  - inspecting-files
---

## Two ways to name a location

Every file has exactly one position in the tree, but there are two ways to describe it.

An **absolute path** starts at the root `/` and lists every directory on the way down:

```text
/home/learner/projects/website/index.html
```

It works no matter where you currently are — like a full postal address.

A **relative path** does *not* start with `/`. It is interpreted starting from the **current working directory** (the directory `pwd` prints):

```text
projects/website/index.html      # if you are in /home/learner
website/index.html               # if you are in /home/learner/projects
index.html                       # if you are in /home/learner/projects/website
```

It's like saying "two doors down from here" — correct only if everyone agrees where "here" is.

## The special names

| Name | Means | Example |
|---|---|---|
| `.` | The current directory | `./deploy.sh` runs a script in this directory |
| `..` | The parent directory | `cd ..` goes up one level |
| `~` | Your home directory (expanded by the shell) | `cd ~/projects` |
| `-` | (with `cd`) the previous directory | `cd -` toggles between two places |
| `/` | The root directory, or the separator between names | `cd /` |

`.` and `..` are real directory entries present in every directory. `~` and `-` are features of the shell.

## How a relative path is resolved

The kernel starts from the current directory and processes the path one component at a time: a name moves down, `..` moves up, `.` stays put.

Suppose `pwd` prints `/home/learner/projects/scripts`:

| Path | Resolves to |
|---|---|
| `backup.sh` | `/home/learner/projects/scripts/backup.sh` |
| `../website` | `/home/learner/projects/website` |
| `../../logs/app.log` | `/home/learner/logs/app.log` |
| `./greet.sh` | `/home/learner/projects/scripts/greet.sh` |
| `../../../..` | `/` (you can't go above the root; extra `..` at `/` stays at `/`) |

Try it — and use `pwd` constantly to check where you are:

::terminal
$ pwd
$ cd projects/scripts
$ pwd
$ ls ../website
$ cat ../../notes.txt
$ cd ../..
$ cd -
$ cd
::

```bash title="resolve.sh" playground
cd ~/projects/scripts
echo "I am in: $PWD"
cd ../website && echo "now in: $PWD"
cd ~ && echo "home is: $PWD"
cd - >/dev/null && echo "back to: $PWD"
realpath ../../logs/app.log
```

## Why `./script.sh` needs the `./`

When you type a command name without a slash, Bash looks for it only in the directories listed in `$PATH` — not in the current directory (a security decision: otherwise a malicious file named `ls` in a shared directory could run instead of the real `ls`). Adding `./` turns the name into a **path**, so Bash runs exactly that file:

```console
$ deploy.sh
bash: deploy.sh: command not found
$ ./deploy.sh
Deploying version latest...
```

## Paths in scripts

A script inherits the current directory of whoever runs it. A script that uses relative paths works when run from its own folder and fails from anywhere else:

```bash
#!/usr/bin/env bash
cat config/settings.ini   # relative to the CALLER's directory, not the script's!
```

Robust scripts resolve paths against their own location:

```bash
#!/usr/bin/env bash
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cat "$script_dir/config/settings.ini"
```

## Common mistakes

```mistake
title: Adding a leading slash to a relative path
wrong: |
  cd /projects        # "No such file or directory"
right: |
  cd projects         # relative to where you are
  cd ~/projects       # or absolute, via your home directory
why: A leading `/` makes the path absolute — it starts at the root of the whole system, not your home directory.
```

```mistake
title: Quoting the tilde
wrong: |
  cd "~/projects"     # No such file or directory
right: |
  cd ~/projects
  cd "$HOME/projects" # quoted, still expands
why: Tilde expansion only happens when `~` is unquoted at the start of a word. Inside quotes, use `$HOME`.
```

## Practice

```exercise
kind: mcq
difficulty: beginner
prompt: "Your current directory is `/home/learner/logs/archive`. Where does `../../data/sales.csv` point?"
options:
  - /home/learner/logs/data/sales.csv
  - /home/learner/data/sales.csv
  - /data/sales.csv
  - /home/data/sales.csv
answer: 1
hints:
  - Each `..` removes one directory from the end of the current path.
explanation: "From `/home/learner/logs/archive`, the first `..` gives `/home/learner/logs`, the second gives `/home/learner`; then `data/sales.csv` → **/home/learner/data/sales.csv**."
```

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  cd ~/projects/website
  cd ../scripts
  pwd
answer: /home/learner/projects/scripts
hints:
  - "`..` from website is projects."
explanation: "`..` takes you from `website` to `projects`, then into `scripts`: `/home/learner/projects/scripts`."
```

```exercise
kind: command
difficulty: beginner
fixture: default
setup: cd ~/projects/scripts
prompt: "You are in `~/projects/scripts`. Using a **relative** path, print the contents of `~/notes.txt`."
solution: cat ../../notes.txt
hints:
  - How many levels up is your home directory from `~/projects/scripts`?
explanation: "`../../notes.txt` climbs two levels to `/home/learner`. An absolute path would also work, but practising `..` makes navigation fast."
```

## Challenge

```exercise
kind: find-bug
difficulty: intermediate
prompt: This script is meant to be runnable from any directory, but it fails with "No such file or directory" unless you `cd` into its folder first. Which line causes the problem?
code: |
  #!/usr/bin/env bash
  set -u
  script_dir=$(dirname "$0")
  config="config/app.conf"
  source "$script_dir/lib.sh"
  grep '^port=' "$config"
answer: 4
fix: |
  config="$script_dir/config/app.conf"
hints:
  - Which path is still interpreted relative to the *caller's* current directory?
explanation: "Line 4 builds a relative path. `lib.sh` is found via `$script_dir`, but the config is looked up in whatever directory the user happens to be in. Prefix it with `$script_dir` too."
```
