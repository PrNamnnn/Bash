---
objectives:
  - Find out what a command name actually refers to
  - Distinguish aliases, keywords, functions, builtins and executable files
  - Check whether a tool is installed in a portable way
  - Diagnose "wrong version" problems caused by PATH order
summary:
  - "`type NAME` tells you what Bash will run: alias, keyword, function, builtin or file. `type -a` shows all candidates."
  - "`which` only searches PATH for files — it can't see aliases, functions or builtins."
  - "`command -v NAME` is the portable way to test for a program in scripts."
  - "`whereis` finds binaries and manual pages in standard locations."
related:
  - how-a-command-runs
  - command-lookup
  - aliases-and-builtins
---

## One name, many meanings

When you type `ls`, Bash checks a sequence of places and runs the first match. The same name can exist in several of them — an alias `ls`, a function `ls`, a program `/usr/bin/ls` — so "what is `ls`?" is a real question.

::viz path-lookup

## type: ask Bash directly

::command type

## command: run or check the real thing

::command command

## which and whereis

::command which whereis

### Why `which` can lie

```bash title="which-vs-type.sh" playground
alias ll='ls -alF'
greet() { echo "hi"; }
type ll greet echo
echo "--- which only knows files in PATH ---"
which ll greet echo
echo "which exit status: $?"
```

`which` reports `echo` as `/usr/bin/echo` although Bash would run its builtin, and it has no idea about `ll` or `greet`. Use `type` in Bash and `command -v` in portable scripts.

## Finding "the wrong version"

When `python3 --version` or `node --version` shows an unexpected version, there are usually two copies in different PATH directories:

```console
$ type -a python3
python3 is /usr/local/bin/python3
python3 is /usr/bin/python3
$ echo "$PATH"
/usr/local/bin:/usr/bin:/bin
```

The first directory in PATH wins. Change the order (in `~/.bashrc` or `~/.profile`) or call the one you want by full path. After installing a new program in the middle of a session, `hash -r` makes Bash forget its cache of command locations.

::terminal
$ type cd ls if ll
$ type -a echo
$ command -v grep
$ command -v nosuchtool || echo "not installed"
$ which -a bash
$ whereis ls
::

## Common mistakes

```mistake
title: Checking dependencies with which
wrong: |
  if [ -z "$(which jq)" ]; then echo "install jq"; fi
right: |
  if ! command -v jq >/dev/null 2>&1; then
    echo "jq is required" >&2
    exit 1
  fi
why: "`which` isn't POSIX, prints errors to stdout on some systems, and its exit status isn't consistent. `command -v` is standard everywhere."
```

## Practice

```exercise
kind: mcq
difficulty: beginner
prompt: "`type cd` prints `cd is a shell builtin`. What does that mean?"
options:
  - cd is a program in /usr/bin
  - cd is implemented inside Bash and runs without starting a new process
  - cd is an alias
  - cd is not installed
answer: 1
explanation: Builtins are part of the shell itself. `cd` must be one, because only the shell can change its own working directory.
```

```exercise
kind: command
difficulty: beginner
prompt: Print just the path of the `sort` program, using a POSIX-standard builtin.
solution: command -v sort
explanation: "`command -v sort` prints `/usr/bin/sort`. For builtins it prints the name; for aliases the alias definition."
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print in the simulator?
code: |
  greet() { echo "function"; }
  type -t greet echo ls if
answer: |
  function
  builtin
  file
  keyword
explanation: "`type -t` prints just the kind of each name."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Dependency checker
prompt: "Complete `require` so it prints `missing: NAME` (to stdout) for every argument that is not an available command, and returns 1 if anything was missing. Use `command -v`."
starter: |
  #!/usr/bin/env bash
  require() {
    local status=0
    # loop over all arguments here
    return $status
  }
  require grep sed jq awk terraform
  echo "status: $?"
solution: |
  #!/usr/bin/env bash
  require() {
    local status=0
    for cmd in "$@"; do
      if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "missing: $cmd"
        status=1
      fi
    done
    return $status
  }
  require grep sed jq awk terraform
  echo "status: $?"
expectedOutput: |
  missing: jq
  missing: terraform
  status: 1
checks:
  - pattern: command -v
    message: Use `command -v` to test for each command.
hints:
  - "`for cmd in \"$@\"; do … done` loops over the arguments."
  - "`command -v NAME >/dev/null 2>&1` succeeds only if NAME exists."
explanation: Loop over `"$@"`, test each name with `command -v`, and remember the failure in a local variable so every missing tool is reported — not just the first.
```
