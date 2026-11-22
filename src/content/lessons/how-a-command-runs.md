---
objectives:
  - Trace a command line from keystrokes to exit status
  - Explain tokenising, expansion, redirection, lookup, fork, exec and wait
  - Understand what environment variables are and how programs receive them
  - Use the `PATH` variable to explain "command not found"
summary:
  - "Bash reads a line, splits it into words and operators, expands each word, sets up redirections, looks up the command, runs it and waits for its exit status."
  - "Builtins run inside the shell; external programs run in a child created with `fork()` and replaced with `execve()`."
  - "Programs receive arguments (argv) and environment variables; they never see your quotes, `$VAR` or `*` — only the expanded results."
  - "`PATH` is a colon-separated list of directories searched, in order, for external commands."
  - "Every command finishes with an exit status, 0 for success, stored in `$?`."
related:
  - execution-model
  - command-lookup
  - environment-and-export
---

## The journey of a command

When you press <kbd>Enter</kbd>, Bash performs the same sequence of steps for every command line. Knowing them explains nearly every "why did Bash do that?" moment in this course.

::viz command-execution

1. **Read** — Bash reads a complete line (or several lines, if the command isn't finished yet).
2. **Tokenise and parse** — the line is split into *words* and *operators* (`|`, `>`, `&&`, `;`…). Quotes are noted, and the structure (pipelines, lists, loops) is built.
3. **Expand** — each word is expanded: `~` becomes your home directory, `$VAR` its value, `$(cmd)` the command's output, `*.txt` the matching file names; then quotes are removed.
4. **Redirect** — `>`, `<`, `2>` and friends connect the command's input and output to files.
5. **Look up** — Bash decides what the first word refers to: an alias, keyword, function, builtin, or a program found via `PATH`.
6. **Execute** — builtins run inside Bash. For programs, Bash calls `fork()` to create a child process, and the child calls `execve()` to become the program.
7. **Wait** — Bash waits for the child to finish and records its **exit status** in `$?`.

## Programs see the result, not your typing

Because expansion happens *before* the program runs, the program only receives the final list of strings — its **argument vector** (argv). It never sees quotes, variables or wildcards:

```bash title="argv.sh" playground
cd ~/data
name="sales"
printf '[%s]\n' ls -l "$name".csv *.txt ~
```

`printf '[%s]\n'` prints each argument in brackets — a trick you'll use throughout the course to see exactly what a command receives. Notice that `"$name".csv` became `sales.csv`, `*.txt` became several file names, and `~` became `/home/learner`.

> [!TIP] The two-question debugging habit
> When a command misbehaves, ask: (1) *what arguments did the program actually receive?* and (2) *which program actually ran?* `printf '[%s]\n' …` answers the first; `type name` answers the second.

## Builtins and external programs

Some commands are part of Bash itself — **builtins** such as `cd`, `echo`, `export` and `read`. Others are separate **programs** stored as files, such as `/usr/bin/ls` and `/usr/bin/grep`.

::terminal
$ type cd
$ type ls
$ type echo
$ type -a echo
::

Builtins exist for two reasons:

- **They must affect the shell itself.** `cd` changes Bash's working directory; a child process could only change its own. `export` modifies Bash's variables.
- **Speed.** Starting a process costs time; `echo`, `printf` and `test` are builtins so scripts don't fork thousands of times.

## Environment variables

Every process carries a set of **environment variables**: name/value pairs such as `HOME=/home/learner` or `LANG=C.UTF-8`. When Bash starts a program, it passes a copy of its exported variables to the child. Programs read them to configure themselves — `EDITOR` chooses your editor, `LANG` the language, `TZ` the time zone.

::terminal
$ echo $HOME
$ echo $USER
$ env | head -5
$ printenv PATH
::

You can set a variable for just one command by writing the assignment before it:

```console
$ TZ=Asia/Tokyo date
$ LANG=C sort names.txt
```

The next levels go much deeper into variables, `export` and scope. For now, remember: **the environment flows from parent to child, never back.**

## PATH: where commands are found

When the command name contains no slash, Bash searches the directories listed in the `PATH` variable, left to right, and runs the first executable file with that name.

```console
$ echo $PATH
/usr/local/bin:/usr/bin:/bin
```

::viz path-lookup

If no directory contains it, you get `command not found` and exit status 127. If the file exists but isn't executable, you get `Permission denied` and status 126.

```bash title="path.sh" playground
type -P ls grep          # where each program lives
PATH=/nowhere
ls                       # now Bash can't find it
echo "status: $?"
```

## Exit status

Every command reports success or failure with a number from 0 to 255:

- `0` means success.
- Anything else means failure; the specific number may say why (`1` general error, `2` misuse, `126` not executable, `127` not found, `128+N` killed by signal N).

```console
$ ls /etc/hostname
/etc/hostname
$ echo $?
0
$ ls /nope
ls: cannot access '/nope': No such file or directory
$ echo $?
2
```

The whole logic of shell scripting — `if`, `&&`, `||`, `while` — is built on exit statuses, as you'll see in Level 2.

## Common mistakes

```mistake
title: Expecting a program to understand shell syntax
wrong: |
  find . -name *.txt     # the shell expands *.txt first!
right: |
  find . -name '*.txt'   # find receives the pattern itself
why: Unquoted wildcards are expanded by the shell before `find` starts. If the current directory contains `a.txt`, find receives `-name a.txt` instead of a pattern.
```

```mistake
title: Breaking PATH
wrong: |
  PATH=~/bin             # replaces the whole search path
right: |
  PATH="$HOME/bin:$PATH" # prepends, keeping the system directories
why: Overwriting PATH makes every external command "not found". Always prepend or append to the existing value.
```

## Practice

```exercise
kind: mcq
difficulty: beginner
prompt: Why must `cd` be a shell builtin rather than a separate program?
options:
  - Because it is used very often
  - Because a separate program runs in a child process and can only change its own working directory, not the shell's
  - Because programs cannot read directories
  - It isn't — `cd` is /usr/bin/cd
answer: 1
hints:
  - Think about what fork() creates and what happens to it when it exits.
explanation: A child process has its own working directory. When it exits, its changes disappear. Only code running *inside* Bash can change Bash's directory.
```

```exercise
kind: predict
difficulty: beginner
prompt: In `~/data`, which arguments does `printf` receive here? Predict the output exactly.
code: |
  cd ~/data
  printf '<%s>\n' *.csv "*.csv"
answer: |
  <sales.csv>
  <users.csv>
  <*.csv>
hints:
  - Unquoted globs are expanded by the shell; quoted ones are not.
explanation: The unquoted `*.csv` became two file names. The quoted one stayed literal, so printf received three arguments.
```

```exercise
kind: mcq
difficulty: beginner
prompt: A command prints `bash: deploy: command not found` and `echo $?` shows `127`. What does Bash know at this point?
options:
  - "`deploy` exists but has a bug"
  - No alias, function or builtin is called `deploy`, and no executable named `deploy` exists in any PATH directory
  - The disk is full
  - "`deploy` is not executable"
answer: 1
hints:
  - Remember the lookup order and what 126 means.
explanation: 127 means the name couldn't be resolved at all. A file that exists but lacks execute permission gives 126 and "Permission denied".
```

```exercise
kind: command
difficulty: intermediate
prompt: Show where the `grep` program lives using a Bash builtin (not `which`).
solution: type -P grep
accept: []
hints:
  - "The builtin that explains what a name refers to is `type`. One flag forces a PATH search and prints just the path."
explanation: "`type -P grep` prints `/usr/bin/grep`. `command -v grep` gives the same here. Plain `type grep` prints `grep is /usr/bin/grep` — the checker compares output, so the exact form matters."
```

## Challenge

```exercise
kind: predict
difficulty: intermediate
title: Who sees the variable?
prompt: Predict the output.
code: |
  greeting=hello
  bash -c 'echo "child sees: [$greeting]"'
  export greeting
  bash -c 'echo "child sees: [$greeting]"'
answer: |
  child sees: []
  child sees: [hello]
hints:
  - "`bash -c` starts a new child process. Which variables does a child receive?"
explanation: A plain shell variable stays inside the current shell. After `export`, it becomes part of the environment passed to children, so the second child sees it.
```
