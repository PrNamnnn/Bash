---
objectives:
  - Explain which command determines a pipeline's exit status
  - Inspect every stage's status with `PIPESTATUS`
  - Use `set -o pipefail` and understand its trade-offs
  - Negate pipelines with `!` and avoid false failures from SIGPIPE
summary:
  - "By default, a pipeline's status is the status of its **last** command; earlier failures are invisible."
  - "`${PIPESTATUS[@]}` holds the status of each stage of the most recent pipeline — read it immediately."
  - "`set -o pipefail` makes the pipeline fail with the rightmost non-zero status."
  - "With pipefail, commands killed by SIGPIPE (e.g. `yes | head`, `grep | head`) can make healthy pipelines \"fail\"."
  - "`! pipeline` inverts the final status."
related:
  - pipes
  - exit-status
  - error-handling
---

## The last command wins

A pipeline is a single command as far as `$?` is concerned, and by default its status is that of the **last** stage:

```bash title="last-wins.sh" playground
false | true;  echo "false | true  -> $?"
true | false;  echo "true | false  -> $?"
grep nomatch ~/notes.txt | sort; echo "grep(no match) | sort -> $?"
cat /nope 2>/dev/null | wc -l;   echo "cat(missing) | wc   -> $?"
```

That last example is a real problem: the input file doesn't exist, `cat` fails, but `wc` happily counts zero lines and the pipeline reports success. A backup script built like this — `mysqldump … | gzip > backup.gz` — can produce empty "successful" backups for months.

## PIPESTATUS

Bash records each stage's status in the array `PIPESTATUS`:

```bash title="pipestatus.sh" playground
cat /nope 2>/dev/null | sort | wc -l
echo "statuses: ${PIPESTATUS[*]}"
true | false | true
codes=("${PIPESTATUS[@]}")       # copy it right away
echo "first=${codes[0]} second=${codes[1]} third=${codes[2]}"
```

Like `$?`, `PIPESTATUS` is overwritten by the next command, so copy it immediately.

## pipefail

With `set -o pipefail`, a pipeline's status is the status of the **rightmost command that failed**, or 0 if all succeeded:

```bash title="pipefail.sh" playground
set -o pipefail
cat /nope 2>/dev/null | wc -l
echo "status: $?"
if ! mysqldump_simulation=$(false | gzip 2>/dev/null); then
  echo "the dump failed — don't trust the backup"
fi
```

This is why many scripts start with `set -o pipefail` (usually as part of `set -euo pipefail`). It makes failures in the middle of pipelines visible.

## The SIGPIPE caveat

When a reader exits early, the writer receives **SIGPIPE** on its next write and dies with status 141 (128 + 13). Without pipefail nobody notices. With pipefail, the whole pipeline now "fails":

```bash
set -o pipefail
yes | head -n 1          # status 141 on a real system
grep pattern huge.log | head -n 5   # may return 141 if grep is still writing
```

Usually that's harmless, but under `set -e` the script dies. Options:

- Avoid early-exiting readers when the writer is critical (`grep -m 5` instead of `| head -n 5`).
- Accept the status explicitly: `{ grep pattern huge.log || true; } | head -n 5`.
- Inspect `PIPESTATUS` and treat 141 as success where appropriate.

The simulator doesn't model SIGPIPE (stages run one after another), so try this on a real system.

## Negation

`!` before a pipeline inverts its final status — handy in `if` and in `set -e` scripts:

```bash
if ! grep -q "^$user:" /etc/passwd; then
  echo "unknown user" >&2
fi
```

Under `set -e`, a negated pipeline never triggers an exit, even when it "fails".

## Common mistakes

```mistake
title: Trusting a backup pipeline
wrong: |
  pg_dump shop | gzip > shop.sql.gz && echo "backup ok"
right: |
  set -o pipefail
  if pg_dump shop | gzip > shop.sql.gz; then
    echo "backup ok"
  else
    echo "backup FAILED" >&2
    exit 1
  fi
why: Without pipefail, the status is gzip's — which succeeds even when pg_dump fails, leaving an empty or truncated archive.
```

```mistake
title: Reading PIPESTATUS too late
wrong: |
  make | tee build.log
  echo "build finished"
  [[ ${PIPESTATUS[0]} -eq 0 ]] || exit 1   # refers to echo, not make
right: |
  make | tee build.log
  status=${PIPESTATUS[0]}
  [[ $status -eq 0 ]] || exit "$status"
why: "`PIPESTATUS` is replaced after every command, including the `echo`."
```

## Practice

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  false | true | true
  echo "$?"
answer: "0"
explanation: Without pipefail only the last command counts, and `true` succeeds.
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  true | false | true
  echo "${PIPESTATUS[@]}"
  set -o pipefail
  true | false | true
  echo "$?"
answer: |
  0 1 0
  1
explanation: "PIPESTATUS lists each stage. With pipefail, the rightmost non-zero status (1, from false) becomes the pipeline's status."
```

```exercise
kind: fill
difficulty: beginner
prompt: Make the script fail when any stage of a pipeline fails.
template: set -o ___
blanks:
  - ["pipefail"]
explanation: "`set -o pipefail` — usually combined as `set -euo pipefail`."
```

## Challenge

```exercise
kind: script
difficulty: advanced
title: Report every failing stage
prompt: "Complete the script: after running the pipeline, print `stage N failed with S` for every stage (counting from 1) whose status is non-zero, using `PIPESTATUS`."
starter: |
  #!/usr/bin/env bash
  cat /nope 2>/dev/null | grep x | sort
  # inspect PIPESTATUS here
solution: |
  #!/usr/bin/env bash
  cat /nope 2>/dev/null | grep x | sort
  codes=("${PIPESTATUS[@]}")
  for i in "${!codes[@]}"; do
    if (( codes[i] != 0 )); then
      echo "stage $((i + 1)) failed with ${codes[i]}"
    fi
  done
expectedOutput: |
  stage 1 failed with 1
  stage 2 failed with 1
checks:
  - pattern: PIPESTATUS
    message: Use the PIPESTATUS array.
hints:
  - Copy PIPESTATUS into your own array on the very next line.
  - "`${!codes[@]}` gives the indices of the array."
explanation: "Copying `PIPESTATUS` first protects it from being overwritten by the loop's own commands. `cat` fails (missing file) and `grep` fails (no input, no match); `sort` succeeds."
```
