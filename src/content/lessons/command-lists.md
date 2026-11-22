---
objectives:
  - Run commands in sequence with `;` and newlines
  - Run commands conditionally with `&&` and `||`
  - Group commands with `{ …; }` and `( … )`
  - Explain why `a && b || c` is not a real if/else
summary:
  - "`a; b` runs both regardless; `a && b` runs b only if a succeeded; `a || b` runs b only if a failed."
  - "`&&` and `||` have equal precedence and associate left to right."
  - "`{ a; b; }` groups commands in the current shell; `( a; b )` runs them in a subshell."
  - "`a && b || c` runs c when a fails **or** when b fails — use `if` when that matters."
  - "`cmd || exit 1` and `cd dir || return` are idiomatic one-line error handlers."
related:
  - exit-status
  - if-statements
  - subshells
---

## Sequences: ; and newlines

A semicolon ends a command just like a newline does. Both run each command in order, ignoring whether the previous one succeeded:

```bash
cd /tmp; ls; echo done
```

is the same as

```bash
cd /tmp
ls
echo done
```

## Conditional execution: && and ||

These operators look at the exit status of the command on their left:

| Operator | Runs the right side when… | Reads as |
|---|---|---|
| `a && b` | `a` succeeded (status 0) | "a, and then if it worked, b" |
| `a \|\| b` | `a` failed (non-zero) | "a, or else b" |

```bash title="andor.sh" playground
mkdir -p /tmp/work && cd /tmp/work && echo "now in $PWD"
ls /nope 2>/dev/null || echo "ls failed, carrying on"
grep -q ERROR ~/logs/app.log && echo "there are errors"
```

Common idioms:

```bash
cd "$dir" || exit 1                       # stop the script if cd fails
command -v jq >/dev/null || { echo "need jq" >&2; exit 1; }
make && ./run-tests && echo "all good"    # each step gates the next
```

The status of the whole list is the status of the last command that actually ran.

## Precedence: && and || are equal

Unlike in C or Python, `&&` and `||` have the **same** precedence in the shell and are evaluated left to right. `a || b && c` means `(a || b) && c`.

### The a && b || c trap

It's tempting to use `cond && yes || no` as a compact if/else:

```bash title="trap.sh" playground
check() { return 0; }
announce() { echo "check passed"; return 1; }   # imagine this command fails

check && announce || echo "check FAILED"        # prints both lines!
echo "---"
if check; then announce; else echo "check FAILED"; fi
```

`|| no` runs whenever **anything** before it failed — including the "yes" branch. It's fine when the middle command can't fail (`echo`), but use `if` whenever correctness matters.

## Grouping commands

Two kinds of brackets group commands so that operators and redirections apply to all of them:

| Syntax | Runs in | Notes |
|---|---|---|
| `{ a; b; }` | the current shell | Needs spaces after `{` and a `;` (or newline) before `}` |
| `( a; b )` | a subshell (a copy) | Variable changes and `cd` don't escape |

```bash title="groups.sh" playground
{ echo "header"; date +%F; } > /tmp/report.txt
cat /tmp/report.txt
grep -q nobody /etc/passwd || { echo "no such user" >&2; false; }
echo "status: $?"
(cd /tmp && pwd)
pwd
```

The subshell form is great for temporary directory changes; the brace form for redirecting the output of several commands at once, or for running several commands after `||`.

## Background lists

An `&` at the end runs a command in the background without waiting — you'll explore that in the job control lesson. For now: `a & b` starts `a` and immediately runs `b`.

## Common mistakes

```mistake
title: Error handling that hides failures
wrong: |
  backup && echo "backup ok" || echo "backup failed"
right: |
  if backup; then
    echo "backup ok"
  else
    echo "backup failed" >&2
    exit 1
  fi
why: The one-liner prints "backup failed" if `echo` fails (rare) and, worse, never exits non-zero — so cron or CI think everything worked.
```

```mistake
title: Malformed brace groups
wrong: |
  { echo a; echo b }       # syntax error: unexpected end of file
right: |
  { echo a; echo b; }
why: "`}` is only recognised at the start of a command, so the last command inside must be terminated with `;` or a newline."
```

## Practice

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  false && echo A
  false || echo B
  true && echo C || echo D
answer: |
  B
  C
explanation: "`A` is skipped because false failed; `B` runs because it failed; `C` runs and succeeds, so `D` is skipped."
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  x=1
  ( x=2; echo "inside: $x" )
  echo "after (): $x"
  { x=3; echo "inside: $x"; }
  echo "after {}: $x"
answer: |
  inside: 2
  after (): 1
  inside: 3
  after {}: 3
explanation: "The parentheses run in a subshell, so `x=2` disappears. Braces run in the current shell."
```

```exercise
kind: command
difficulty: beginner
compare: both
fixture: empty
prompt: "Create the directory `~/build` and, only if that succeeds, create an empty file `~/build/ok` and print `ready`."
solution: mkdir ~/build && touch ~/build/ok && echo ready
explanation: "Chaining with `&&` makes each step depend on the previous one."
```

## Challenge

```exercise
kind: find-bug
difficulty: intermediate
prompt: In CI, this deploy step reports success even when the upload fails. Which line is responsible?
code: |
  #!/usr/bin/env bash
  build_artifact
  upload_artifact && echo "uploaded" || echo "upload failed"
  notify_team "deploy finished"
answer: 3
fix: |
  upload_artifact || { echo "upload failed" >&2; exit 1; }
  echo "uploaded"
hints:
  - What is the exit status of the line when upload_artifact fails?
explanation: "When the upload fails, `echo \"upload failed\"` runs and succeeds, so the list's status is 0, and the script continues and exits 0. Exit explicitly with a non-zero status."
```
