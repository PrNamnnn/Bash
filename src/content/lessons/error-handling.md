---
objectives:
  - Understand exactly what `set -e`, `set -u` and `set -o pipefail` do — and where `set -e` does *not* apply
  - Write a `die` helper and check commands explicitly
  - Report failures with context using an ERR trap
  - Choose between "fail fast" and explicit handling for each command
summary:
  - "`set -e` exits when a command fails — except in conditions (`if`, `while`, `&&`, `||`, `!`) and, by default, inside command substitutions."
  - "`set -u` makes expanding an unset variable an error; use `${var:-}` where empty is fine."
  - "`set -o pipefail` makes a pipeline fail if any part fails, not just the last."
  - "`cmd || die \"message\"` is explicit, readable and works with or without set -e."
  - "`trap 'echo \"line $LINENO: $BASH_COMMAND failed\" >&2' ERR` reports where a failure happened."
related:
  - exit-codes-and-validation
  - pipeline-exit-status
  - signals-and-trap
---

## Two strategies

A Bash script keeps going after a command fails unless you tell it otherwise. There are two complementary ways to handle errors:

1. **Explicit checks** — test the commands that can fail: `cd "$dir" || die "cannot cd"`.
2. **Fail fast** — `set -euo pipefail` aborts on unexpected failures, so a bug can't cascade.

Most robust scripts use both: strict mode as a safety net, explicit checks where a good message matters.

## Explicit checks with die

```bash title="die.sh" playground
die() {
  printf '%s: error: %s\n' "${0##*/}" "$*" >&2
  exit "${2:-1}"
}
config=~/.config/app.conf
[[ -r $config ]] || die "cannot read $config"
port=$(grep '^port=' "$config" | cut -d= -f2)
[[ $port =~ ^[0-9]+$ ]] || die "invalid port: '$port'"
echo "port $port OK"
cd /nonexistent 2>/dev/null || die "cannot enter /nonexistent"
echo "unreachable"
```

## set -e (errexit)

With `set -e`, the shell exits as soon as a command returns non-zero — **unless** that command's status is being tested:

```bash title="errexit.sh" playground
set -e
if grep -q nobody /etc/passwd; then echo "found"; else echo "grep in if failed: fine"; fi
grep -q nobody /etc/passwd || echo "grep in ||: fine"
false && echo "never"
echo "false && … did not exit"
! true
echo "! true did not exit"
x=$(false; echo "substitution keeps going")
echo "$x"
grep -q zzz /etc/passwd
echo "never printed — the bare grep failed"
```

| `set -e` is **ignored** for… | Why |
|---|---|
| the condition of `if`, `while`, `until` | the failure is the answer |
| any command but the last in `&&` / `\|\|` lists | the operator handles it |
| commands negated with `!` | you asked for the inverse |
| all but the last command of a pipeline | unless `pipefail` is set |
| commands inside `$( )` | unless `shopt -s inherit_errexit` |
| a function called from any of the above | the whole call counts as "tested" |

That last row is the classic surprise: `if my_function; then` disables errexit for *everything inside* my_function.

## The (( )) and local traps

```bash title="errexit-gotchas.sh" playground
set -e
count=0
(( count++ )) || true     # without "|| true" this would exit: the old value 0 is "false"
echo "count=$count"
(( ++count ))             # pre-increment returns 2 — safe
f() { local v=$(false); echo "local hid the failure"; }
f
```

Use `(( ++n ))` or `n=$((n + 1))` for counters, and split `local v; v=$(cmd)`.

## set -u (nounset)

```bash title="nounset.sh" playground
set -u
name="Ada"
echo "hello $name"
echo "optional: ${maybe:-default}"     # :- is safe
echo "args: ${1:-none}"                # so is this
( echo "$typo_variable" ) 2>&1 || echo "set -u caught a typo (status $?)"
```

`set -u` catches misspelled variable names and missing arguments. `"$@"` and `${arr[@]}` with no elements are fine in Bash 4.4+.

## set -o pipefail

Without pipefail, a pipeline's status is its **last** command's:

```bash title="pipefail.sh" playground
grep ERROR /missing/file | sort
echo "without pipefail: $?"
set -o pipefail
grep ERROR /missing/file 2>/dev/null | sort
echo "with pipefail: $?"
```

Watch out for commands that "fail" by design in pipelines: `grep` returns 1 when nothing matches, and producers can get SIGPIPE (status 141) when `head` stops reading early.

## Reporting where it failed

An ERR trap runs whenever a command fails (under the same rules as `set -e`). Combined with `$LINENO` and `$BASH_COMMAND` it gives useful diagnostics:

```bash title="err-trap.sh" playground
set -Eeuo pipefail          # -E: functions inherit the ERR trap
on_error() {
  local status=$?
  echo "error: '$BASH_COMMAND' failed with status $status at line $1" >&2
}
trap 'on_error $LINENO' ERR
load() { grep -q '^port=' ~/.config/app.conf; cp ~/missing.txt /tmp/; }
echo "loading..."
load
echo "not reached"
```

## Strict mode template

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "${0##*/}: line $LINENO: $BASH_COMMAND failed (status $?)" >&2' ERR

die() { echo "${0##*/}: $*" >&2; exit 1; }
```

Strict mode is a safety net, not a substitute for thinking: it doesn't apply in all contexts and it can't produce good error messages for you.

## Common mistakes

```mistake
title: Relying on set -e inside functions used as conditions
wrong: |
  set -e
  deploy() { build; upload; }   # build fails...
  if deploy; then echo ok; fi  # ...upload still runs, prints ok
right: |
  deploy() { build || return; upload || return; }
  if deploy; then echo ok; fi
why: Calling a function in a condition disables errexit for its whole body. Check inside explicitly.
```

```mistake
title: Error messages on stdout
wrong: |
  echo "error: file not found"; exit 1
right: |
  echo "error: file not found" >&2; exit 1
why: Errors belong on stderr so they're not swallowed by pipes or `$(…)` and still reach the user.
```

## Practice

```exercise
kind: predict
difficulty: intermediate
prompt: What does this script print?
code: |
  set -e
  false || echo A
  if false; then echo B; fi
  echo C
  false
  echo D
answer: |
  A
  C
explanation: "Failures in `||` lists and `if` conditions are handled; the bare `false` exits before D."
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  false | true
  echo "a: $?"
  set -o pipefail
  false | true
  echo "b: $?"
answer: |
  a: 0
  b: 1
explanation: Without pipefail the last command's status wins; with it, any failure does.
```

```exercise
kind: find-bug
difficulty: intermediate
prompt: "Under `set -e`, this counter loop exits after printing nothing. Which line is the problem?"
code: |
  #!/usr/bin/env bash
  set -e
  n=0
  for f in a b c; do
    (( n++ ))
  done
  echo "$n files"
answer: 5
fix: |
  (( ++n ))
hints:
  - "What is the value of the expression `n++` when n is 0?"
explanation: "`(( n++ ))` evaluates to the old value, 0, which counts as failure — set -e exits. Use pre-increment or `n=$((n+1))`."
```

```exercise
kind: command
difficulty: beginner
prompt: "Define `die` to print its arguments to stderr and exit 1, then use it so that `cd /nope` failing calls `die cannot cd`. Redirect cd's own error to /dev/null."
solution: die() { echo "$*" >&2; exit 1; }; cd /nope 2>/dev/null || die cannot cd
compare: stderr
explanation: "`cmd || die …` is the readable explicit-check idiom."
```

## Challenge

```exercise
kind: script
difficulty: advanced
title: Validated config loader
prompt: "Write a script with `set -euo pipefail` that reads `~/.config/app.conf`, and prints `port=N level=L`. It must exit with a clear message on stderr and status 1 if the file is missing or the port isn't numeric. Here, the file is valid."
starter: |
  #!/usr/bin/env bash
  set -euo pipefail
  conf=~/.config/app.conf
solution: |
  #!/usr/bin/env bash
  set -euo pipefail
  conf=~/.config/app.conf
  die() { echo "error: $*" >&2; exit 1; }
  [[ -r $conf ]] || die "cannot read $conf"
  port=$(grep '^port=' "$conf" | cut -d= -f2 || true)
  level=$(grep '^log_level=' "$conf" | cut -d= -f2 || true)
  [[ $port =~ ^[0-9]+$ ]] || die "invalid port: '${port}'"
  echo "port=$port level=${level:-info}"
expectedOutput: port=8080 level=info
checks:
  - pattern: set -euo pipefail
    message: Keep strict mode on.
  - pattern: '>&2'
    message: Send error messages to stderr.
hints:
  - "With pipefail, a grep that finds nothing fails the substitution — add `|| true` and validate afterwards."
  - "Validate with `[[ $port =~ ^[0-9]+$ ]]`."
explanation: "Strict mode catches the unexpected; explicit checks with `die` produce messages a human can act on."
```
