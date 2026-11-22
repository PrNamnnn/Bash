---
objectives:
  - Identify every construct that runs code in a subshell
  - Use `( … )` deliberately to isolate directory, variable and option changes
  - Distinguish `( )` from `{ }` grouping
  - Know the difference between `$$` and `$BASHPID`
summary:
  - "A subshell is a forked copy of the shell: it inherits all variables (exported or not), functions, options and the working directory."
  - "Nothing changed in a subshell flows back: variables, `cd`, `set` options and traps are discarded when it exits."
  - "Subshells come from `( )`, `$( )`, pipelines, `&` background jobs and process substitution."
  - "`{ …; }` groups commands in the *current* shell; `( … )` groups them in a subshell."
  - "`$$` stays the main shell's PID inside subshells; `$BASHPID` is the current process."
related:
  - variable-scope
  - pipes
  - job-control
---

## What is a subshell?

When Bash needs to run shell code in a separate process, it **forks**: it creates a child that is an exact copy of itself — every variable (exported or not), function, alias, option and the current directory. The child runs the code, exits, and its memory disappears with it.

::viz subshell

```bash title="copy.sh" playground
secret="not exported"
greet() { echo "hi from a function"; }
(
  echo "child sees: $secret"
  greet
  secret="changed in child"
  cd /tmp
  echo "child is in $PWD"
)
echo "parent still has: $secret"
echo "parent is in $PWD"
```

A subshell differs from running a *new* `bash` (a child script): a new shell starts fresh and only receives **exported** variables. A subshell starts as a full copy.

## Where subshells appear

| Construct | Example |
|---|---|
| explicit grouping | `( cd build && make )` |
| command substitution | `today=$(date +%F)` |
| every part of a pipeline | `cat f \| while read l; do …; done` |
| background jobs | `long_task &` |
| process substitution | `diff <(sort a) <(sort b)` |
| function with `( )` body | `f() ( set -e; … )` |

## Isolation on purpose

Subshells are a cheap sandbox. Typical uses:

```bash title="isolation.sh" playground
# 1. change directory temporarily
( cd ~/projects && ls )
pwd
# 2. change options or IFS temporarily
list="a,*,c"
( set -f; IFS=,; for x in $list; do echo "[$x]"; done )
# 3. run with a modified environment
( export TZ=UTC LANG=C; echo "TZ in subshell: $TZ" )
echo "TZ outside: ${TZ:-unset}"
```

`(cd dir && make)` is idiomatic: if `cd` fails, `make` doesn't run in the wrong place, and the caller's directory never changes.

## ( ) vs { }

```bash title="groups.sh" playground
x=1
{ x=2; echo "brace group sets x=$x"; }
echo "after { }: x=$x"
( x=3; echo "subshell sets x=$x" )
echo "after ( ): x=$x"
{ echo one; echo two; } > /tmp/both.txt     # one redirection for several commands
cat /tmp/both.txt
```

| | `{ list; }` | `( list )` |
|---|---|---|
| process | current shell | subshell (fork) |
| variable changes | kept | discarded |
| `exit` inside | exits the script | exits only the subshell |
| syntax | needs spaces and a final `;` or newline | no special spacing |
| cost | free | a fork (cheap, but not free) |

## $$ vs $BASHPID

```bash title="pids.sh" playground
echo "main:       \$\$=$$ BASHPID=$BASHPID"
( echo "subshell:   \$\$=$$ BASHPID=$BASHPID" )
echo "level: $BASH_SUBSHELL"; ( echo "level: $BASH_SUBSHELL" )
```

`$$` deliberately keeps the top-level PID (so temp files named `/tmp/x.$$` are consistent). `$BASHPID` (Bash 4) is the actual process, and `$BASH_SUBSHELL` counts nesting depth.

## exit inside a subshell

`exit` in a subshell only ends that subshell; its status becomes the status of the `( )`:

```bash title="exit.sh" playground
( echo "checking..."; exit 3 )
echo "subshell exited with $?"
result=$(echo partial; exit 1) || echo "substitution failed, captured: $result"
```

## Common mistakes

```mistake
title: Expecting a pipeline to set variables
wrong: |
  found=no
  grep -q root /etc/passwd | true
  ls | while read -r f; do found=yes; done
  echo "$found"       # no
right: |
  found=no
  while read -r f; do found=yes; done < <(ls)
  echo "$found"       # yes
why: Each pipeline part is a subshell; use redirection or process substitution so the loop runs in the main shell.
```

```mistake
title: exit in a subshell doesn't stop the script
wrong: |
  check() ( [[ -f config ]] || { echo "missing" >&2; exit 1; } )
  check
  echo "continuing anyway"
right: |
  check() { [[ -f config ]] || { echo "missing" >&2; exit 1; }; }
  # or keep ( ) and test the status:
  check || exit
why: A `( )`-bodied function runs in a subshell, so its exit only ends the subshell.
```

## Practice

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  n=0
  ( n=5 )
  { n=$((n + 1)); }
  echo "$n"
  n=$(n=9; echo $((n * 2)))
  echo "$n"
answer: |
  1
  18
explanation: "The ( ) change is discarded; the { } change is kept. The substitution prints 18, which is then assigned in the parent."
```

```exercise
kind: mcq
difficulty: beginner
prompt: Which construct runs its commands in the current shell?
options:
  - "`( cd /tmp; ls )`"
  - "`x=$(pwd)`"
  - "`{ cd /tmp; ls; }`"
  - "`ls | wc -l`"
answer: 2
explanation: Brace groups don't fork; the others all create subshells.
```

```exercise
kind: command
difficulty: beginner
prompt: "In one line, list `~/data` from inside that directory without changing the current directory of your shell, then print the current directory."
solution: ( cd ~/data && ls ); pwd
explanation: The cd happens in a subshell, so `pwd` still shows where you started.
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Per-directory report without cd side effects
prompt: "For each directory in `~/projects`, print `NAME: N files` where N counts the entries inside it. Use a subshell with `cd` for each, and finally print `back in /home/learner` using `$PWD` to prove the script's directory never changed."
starter: |
  #!/usr/bin/env bash
  cd ~
solution: |
  #!/usr/bin/env bash
  cd ~
  for d in projects/*/; do
    (
      cd "$d" || exit
      set -- *
      [[ -e $1 ]] || set --
      echo "$(basename "$d"): $# files"
    )
  done
  echo "back in $PWD"
expectedOutput: |
  scripts: 4 files
  website: 4 files
  back in /home/learner
checks:
  - pattern: \(\s*$|\(\s*cd
    message: Use a subshell ( … ) around the cd.
hints:
  - "`set -- *` puts the directory's entries into `$@`, so `$#` counts them."
  - "If a directory is empty, `*` stays literal — check `[[ -e $1 ]]`."
explanation: "Each `( cd …; … )` runs in its own copy of the shell, so the parent's directory stays put."
```
