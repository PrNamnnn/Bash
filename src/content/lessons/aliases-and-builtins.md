---
objectives:
  - Define, list and remove aliases, and make them permanent
  - Know where aliases work and where they don't (scripts)
  - Distinguish keywords, builtins, functions and external commands
  - Choose functions over aliases when you need arguments or logic
summary:
  - "`alias name='command'` creates a shortcut that is substituted for the first word of a command."
  - "Aliases only expand in interactive shells (unless `shopt -s expand_aliases`), so don't rely on them in scripts."
  - "Put permanent aliases in `~/.bashrc`; bypass an alias with `\\name` or `command name`."
  - "Builtins run inside Bash (cd, read, export); keywords are grammar (if, for, [[); external commands are files found via PATH."
  - "Functions are more powerful than aliases: they take arguments, can contain logic and work in scripts."
related:
  - finding-commands
  - functions
  - startup-files
---

## Aliases: personal shortcuts

An **alias** replaces the first word of a command with some text before the command is parsed further.

```bash
alias ll='ls -alF'
alias gs='git status -sb'
alias ..='cd ..'
```

Typing `ll ~/logs` becomes `ls -alF ~/logs`.

::terminal
$ alias
$ alias ports='ss -tulpn'
$ alias gl='git log --oneline -n 10'
$ alias ll
$ type ll
$ unalias gl
$ alias
::

| Task | Command |
|---|---|
| List all aliases | `alias` |
| Show one | `alias ll` |
| Remove one | `unalias ll` (or `unalias -a` for all) |
| Run the real command once | `\ls` or `command ls` |
| Make permanent | add the `alias` line to `~/.bashrc` |

### Aliases don't work in scripts

Non-interactive shells don't expand aliases by default. A script that uses `ll` fails with "command not found" — even though `ll` works at your prompt:

```bash title="alias-in-script.sh" playground
alias ll='ls -alF'
ll ~/data 2>&1 | head -2
echo "---- after shopt -s expand_aliases ----"
shopt -s expand_aliases
alias ll='ls -1'
ll ~/data | head -2
```

Even with `expand_aliases`, an alias defined on the same line where it's used doesn't apply, because aliases are expanded when a line is *read*. In scripts, use functions.

## Aliases vs functions

Aliases are dumb text substitution. They can't take arguments in the middle, can't contain logic, and behave surprisingly with quoting. Functions do all of that:

```bash title="function-vs-alias.sh" playground
# An alias can only put arguments at the end:
alias greet='echo Hello'
# A function can use them anywhere:
mkcd() { mkdir -p -- "$1" && cd -- "$1"; }
mkcd /tmp/demo/deep
pwd
```

**Rule of thumb:** aliases for simple interactive abbreviations; functions for anything else.

## Kinds of command names

When Bash looks up a command name, it can find four different kinds of things:

| Kind | Examples | Lives | Notes |
|---|---|---|---|
| **Keyword** | `if`, `for`, `while`, `case`, `[[`, `{` | Bash's grammar | Parsed specially; not commands at all |
| **Builtin** | `cd`, `echo`, `read`, `export`, `source` | Inside Bash | No new process; can change the shell's state |
| **Function** | anything you define | In the shell's memory | Runs in the current shell |
| **External** | `ls`, `grep`, `git`, `python3` | Files in PATH | Runs in a child process |

Some names exist in more than one form. `echo`, `printf`, `test`, `[`, `pwd`, `kill`, `true` and `false` are builtins **and** programs in `/usr/bin`; Bash runs the builtin. `type -a` shows them all.

::terminal
$ type if for [[ cd echo grep
$ type -a echo
$ type -a test
$ enable -n echo 2>/dev/null; type echo
::

Builtins exist for speed and because some operations — `cd`, `export`, `read` into variables, `exit` — are only possible inside the shell process itself.

## Common mistakes

```mistake
title: Aliasing rm -i and relying on it
wrong: |
  alias rm='rm -i'
  # months later, on a server without the alias:
  rm *          # deletes everything, no prompt
right: |
  # Build safe habits instead: preview with ls/echo, then delete.
  ls *.tmp && rm -- *.tmp
why: Aliases exist only in shells that load your configuration. Habits that depend on them fail on other machines, in scripts and under sudo.
```

```mistake
title: Arguments in the middle of an alias
wrong: |
  alias backup='cp $1 $1.bak'   # $1 is empty when the alias is defined/used
right: |
  backup() { cp -- "$1" "$1.bak"; }
why: Aliases don't have positional parameters. Functions do.
```

## Practice

```exercise
kind: mcq
difficulty: beginner
prompt: Which of these is a shell **keyword** rather than a builtin or external command?
options:
  - "`cd`"
  - "`ls`"
  - "`while`"
  - "`echo`"
answer: 2
explanation: "`while` is part of Bash's grammar. `cd` and `echo` are builtins; `ls` is a program in /usr/bin."
```

```exercise
kind: predict
difficulty: beginner
prompt: In an interactive shell, what does this print?
code: |
  alias hi='echo hello'
  type -t hi
  unalias hi
  type -t hi || echo "gone"
answer: |
  alias
  gone
explanation: "`type -t` prints `alias`. After `unalias`, nothing is found, so type fails and `echo gone` runs. (The checker runs this as an interactive shell.)"
```

```exercise
kind: command
difficulty: beginner
prompt: "Run the real `ls` with the `-1` option on `~/data`, bypassing any alias or function named `ls`, using the `command` builtin."
solution: command ls -1 ~/data
explanation: "`command ls` skips aliases and functions. A leading backslash (`\\ls`) skips aliases only."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Alias to function
prompt: "Replace the broken alias with a function `bak` that copies each file given as an argument to `FILE.bak` and prints `backed up FILE` for each one."
starter: |
  #!/usr/bin/env bash
  alias bak='cp $1 $1.bak'   # broken: aliases don't have $1

  cd /tmp && echo a > a.txt && echo b > b.txt
  bak a.txt b.txt
  ls *.bak
solution: |
  #!/usr/bin/env bash
  bak() {
    for f in "$@"; do
      cp -- "$f" "$f.bak" && echo "backed up $f"
    done
  }

  cd /tmp && echo a > a.txt && echo b > b.txt
  bak a.txt b.txt
  ls *.bak
expectedOutput: |
  backed up a.txt
  backed up b.txt
  a.txt.bak
  b.txt.bak
checks:
  - pattern: ^\s*alias\b
    forbid: true
    message: Remove the alias — define a function instead.
hints:
  - "A function: `bak() { …; }`. Loop with `for f in \"$@\"`."
explanation: Functions receive their arguments as `$1`, `$2`, … and `"$@"`, so they can loop over every file. That's impossible with an alias.
```
