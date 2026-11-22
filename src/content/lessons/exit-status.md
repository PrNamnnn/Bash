---
objectives:
  - Explain what an exit status is and where it comes from
  - Read `$?` immediately after a command, and know why it changes so quickly
  - Recognise conventional exit codes (0, 1, 2, 126, 127, 128+N)
  - Use `true`, `false` and `!` to reason about success and failure
summary:
  - "Every command ends with an exit status from 0 to 255: 0 means success, anything else failure."
  - "`$?` holds the status of the most recent command — save it immediately (`rc=$?`) if you need it later."
  - "Conventions: 1 general error, 2 misuse, 126 not executable, 127 not found, 128+N killed by signal N (130 = Ctrl+C)."
  - "`if`, `while`, `&&` and `||` all act on exit statuses, not on output."
  - "`!` inverts a status; `true` and `false` do nothing but succeed or fail."
related:
  - command-lists
  - if-statements
  - exit-codes-and-validation
---

## Every command answers "did it work?"

When a program finishes, it hands the operating system a small integer: its **exit status** (or *exit code*). The shell stores it and uses it to make decisions.

| Status | Meaning |
|---|---|
| `0` | Success |
| `1`–`255` | Failure; the number can say *how* it failed |

This is the opposite of many programming languages, where 0 means false. In the shell, **0 is success** — think of it as "zero errors".

## Reading $?

The special parameter `$?` contains the exit status of the last command:

::terminal
$ ls ~/notes.txt
$ echo $?
$ ls /nope
$ echo $?
$ grep -q root /etc/passwd; echo $?
$ grep -q nobody-here /etc/passwd; echo $?
$ nosuchcommand; echo $?
::

`$?` is overwritten by **every** command — including `echo` and `[`. If you need the value later, save it right away:

```bash title="save-status.sh" playground
grep -q 'port=' ~/.config/app.conf
rc=$?
echo "grep finished"            # this changes $? to 0...
echo "grep's status was $rc"    # ...but we saved it
```

## Conventional codes

| Code | Conventional meaning | Example |
|---|---|---|
| 0 | success | `true` |
| 1 | general failure | `false`, `grep` found nothing |
| 2 | incorrect usage / serious error | `ls /nope`, `grep` with a bad regex |
| 126 | found but not executable | `./script.sh` without `chmod +x` |
| 127 | command not found | a typo |
| 128 + N | terminated by signal N | 130 = SIGINT (Ctrl+C), 137 = SIGKILL, 143 = SIGTERM |

Individual programs document their own codes in their man pages: `grep` uses 1 for "no match" and 2 for errors, `diff` uses 1 for "files differ".

## Pipelines and builtins

- The status of a **pipeline** is the status of its **last** command (unless `set -o pipefail`; see Level 3).
- **Builtins** have statuses too: `cd /nope` fails with 1, `[ -f x ]` returns 0 or 1.
- An **assignment** like `x=$(cmd)` takes the status of the command substitution.

```bash title="pipeline-status.sh" playground
false | true
echo "pipeline: $?"
cd /nope 2>/dev/null
echo "cd: $?"
out=$(grep -c ERROR ~/logs/app.log)
echo "assignment: $? (out=$out)"
```

## true, false and !

`true` and `false` exist purely to produce a status — useful as placeholders and in loops (`while true; do …`). `!` before a command inverts its status:

```bash title="negate.sh" playground
! grep -q nobody /etc/passwd && echo "no user called nobody"
if ! command -v jq >/dev/null; then echo "jq missing"; fi
```

## Setting your own exit status

Scripts end with the status of their last command unless you call `exit N`. Functions use `return N`. Choosing meaningful codes is covered in Level 5; the basic rule is: **exit 0 only when everything really worked**.

```bash
if ! cp "$src" "$dst"; then
  echo "copy failed" >&2
  exit 1
fi
```

## Common mistakes

```mistake
title: Checking $? too late
wrong: |
  mkdir /srv/app
  echo "creating directory"
  if [ $? -ne 0 ]; then echo "mkdir failed"; fi   # tests echo, not mkdir
right: |
  if ! mkdir /srv/app; then
    echo "mkdir failed" >&2
  fi
why: Every command overwrites `$?`. Testing the command directly in `if` avoids the problem entirely.
```

```mistake
title: Assuming output means success
wrong: |
  result=$(curl -s https://example.com/health)
  [ -n "$result" ] && echo "service OK"
right: |
  if curl -fsS https://example.com/health > /dev/null; then echo "service OK"; fi
why: Error pages also produce output. Check the exit status — with `-f`, curl fails on HTTP errors.
```

## Practice

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  true; echo $?
  false; echo $?
  ! true; echo $?
answer: |
  0
  1
  1
explanation: "`true` succeeds (0), `false` fails (1), and `!` inverts success into failure."
```

```exercise
kind: mcq
difficulty: beginner
prompt: "A script ends and `echo $?` shows `127`. What happened most likely?"
options:
  - The script was killed with Ctrl+C
  - The last command the script ran was not found
  - The script succeeded
  - A file was not executable
answer: 1
explanation: 127 means "command not found". 126 is "not executable", 130 is Ctrl+C.
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  grep -q ERROR ~/logs/app.log
  echo "first: $?"
  echo "second: $?"
answer: |
  first: 0
  second: 0
hints:
  - The second `$?` refers to the first `echo`.
explanation: "The log contains ERROR, so grep returns 0. The second line shows the status of the previous `echo`, which also succeeded."
```

## Challenge

```exercise
kind: predict
difficulty: intermediate
title: Status of a pipeline
prompt: What does this print?
code: |
  grep nomatch ~/notes.txt | wc -l
  echo "status: $?"
  set -o pipefail
  grep nomatch ~/notes.txt | wc -l
  echo "status: $?"
answer: |
  0
  status: 0
  0
  status: 1
hints:
  - By default a pipeline reports its last command. What changes with pipefail?
explanation: "`wc -l` succeeds, so the pipeline's status is 0 even though grep failed. With `pipefail`, the rightmost failing command (grep, status 1) determines the result."
```
