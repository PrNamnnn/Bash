---
objectives:
  - Choose meaningful exit codes for your scripts and document them
  - Validate argument counts, numbers, files and allowed values before doing any work
  - Write clear usage messages and error helpers that go to stderr
  - Format output reliably with printf
summary:
  - "Exit 0 on success; non-zero on failure. Common choices: 1 general error, 2 or 64 usage error, 65 bad input data, 66 missing input, 69 unavailable dependency, 70 internal error."
  - "Validate early and fail fast: count (`$#`), types (`[[ $x =~ ^[0-9]+$ ]]`), files (`-f`, `-r`, `-d`), allowed values (`case`)."
  - "A `usage()` function and a `die()` function (message to stderr + exit) keep scripts readable."
  - "`exit` without a number uses the last command's status — be explicit."
  - "Use printf for formatted messages; never put data in the format string."
related:
  - exit-status
  - positional-parameters
  - error-handling
---

## Exit codes are your script's API

Whoever runs your script — a person, cron, CI, another script — learns whether it worked only from the exit status. A script that prints "ERROR" but exits 0 is lying to automation.

```bash
exit 0      # success
exit 1      # failure
```

If a script ends without `exit`, its status is that of the last command executed — often not what you intended. Be explicit at the end of important scripts.

### Choosing codes

There's no universal standard, but `sysexits.h` (BSD) offers widely understood conventions:

| Code | Name | Use when |
|---|---|---|
| 0 | OK | everything worked |
| 1 | — | general failure |
| 2 | — | misuse of shell builtins (Bash uses it) / bad usage |
| 64 | EX_USAGE | wrong arguments or options |
| 65 | EX_DATAERR | input data is invalid |
| 66 | EX_NOINPUT | an input file doesn't exist or isn't readable |
| 69 | EX_UNAVAILABLE | a required service or tool is missing |
| 70 | EX_SOFTWARE | internal error (a bug) |
| 73 | EX_CANTCREAT | can't create an output file |
| 75 | EX_TEMPFAIL | temporary failure; retrying may help |

Avoid 126–165: they're used by the shell for "not executable", "not found" and signals. Document your codes in the usage text.

## Helper functions

Two tiny functions make error handling readable everywhere:

```bash title="helpers.sh" playground
usage() {
  cat >&2 <<EOF
Usage: ${0##*/} SOURCE_DIR DAYS
Copies files modified in the last DAYS days from SOURCE_DIR.
Exit codes: 0 ok, 64 usage error, 66 missing source.
EOF
  exit 64
}
die() {
  local code=$1; shift
  printf 'error: %s\n' "$*" >&2
  exit "$code"
}
(( $# == 2 )) || usage
```

Run it with no arguments, then with arguments `/nope 7`.

## Validate before you act

Check everything up front, before the script changes anything. A half-finished run is worse than one that refused to start.

```bash title="validate.sh" playground
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

(( $# == 3 )) || die "expected 3 arguments, got $#"
src=$1 days=$2 mode=$3

[[ -d $src ]]              || die "not a directory: $src"
[[ -r $src ]]              || die "not readable: $src"
[[ $days =~ ^[0-9]+$ ]]    || die "DAYS must be a positive integer: $days"
(( days >= 1 && days <= 365 )) || die "DAYS out of range (1-365): $days"
case $mode in
  copy|move) ;;
  *) die "MODE must be copy or move, got: $mode" ;;
esac

printf 'OK: %s files from %s (last %d days)\n' "$mode" "$src" "$days"
```

Set the arguments to `/home/learner/logs 7 copy`, then try `~/logs 0 copy`, `~/logs seven copy` and `/nope 7 move`.

| Check | Test |
|---|---|
| argument count | `(( $# == 2 ))`, `(( $# >= 1 ))` |
| integer | `[[ $x =~ ^[0-9]+$ ]]` (or `^-?[0-9]+$` for negatives) |
| range | `(( x >= 1 && x <= 100 ))` |
| non-empty | `[[ -n $x ]]` |
| file / directory exists | `[[ -f $f ]]` / `[[ -d $d ]]` |
| readable / writable / executable | `-r`, `-w`, `-x` |
| one of several values | `case $x in a\|b\|c) ;; *) die …;; esac` |
| matches a pattern | `[[ $email == *@*.* ]]` or a regex |

> [!WARNING] Validate before arithmetic
> `(( days > 0 ))` with `days='a[$(rm -rf ~)]'` executes the command substitution inside the array index — arithmetic evaluates its input. Check with a regex *first* when values come from users.

## Formatting output with printf

`printf` gives you control over messages and reports (see the echo/printf lesson):

```bash title="report.sh" playground
printf '%-12s %8s %6s\n' FILE SIZE LINES
for f in ~/data/*.csv; do
  printf '%-12s %8d %6d\n' "${f##*/}" "$(wc -c < "$f")" "$(wc -l < "$f")"
done
```

## Common mistakes

```mistake
title: Error messages with exit 0
wrong: |
  if [[ ! -f $config ]]; then
    echo "config missing"
  fi
  # ...continues, eventually exits 0
right: |
  [[ -f $config ]] || { echo "error: config missing: $config" >&2; exit 66; }
why: Automation only sees the exit status. Report errors on stderr and exit non-zero.
```

```mistake
title: exit codes above 255
wrong: |
  exit 300      # becomes 300 % 256 = 44
right: |
  exit 1
why: Exit statuses are 8-bit. Large or negative values wrap around.
```

## Practice

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  check() { [[ $1 =~ ^[0-9]+$ ]]; }
  check 42 && echo "42 ok"
  check 4x || echo "4x rejected"
  check "" || echo "empty rejected"
answer: |
  42 ok
  4x rejected
  empty rejected
explanation: "`+` requires at least one digit, and the anchors require the whole string to be digits."
```

```exercise
kind: mcq
difficulty: beginner
prompt: A script detects that a required input file is missing. Which response is best?
options:
  - Print a message to stdout and continue
  - Print a message to stderr and exit with a non-zero status (e.g. 66)
  - Exit 0 silently
  - Create an empty file and continue
answer: 1
explanation: Errors go to stderr, and the exit status must tell the caller that the run failed.
```

```exercise
kind: script
difficulty: intermediate
title: Validate a port number
prompt: "Complete `valid_port` so it returns 0 only for integers between 1 and 65535. The script prints the result for several inputs."
starter: |
  #!/usr/bin/env bash
  valid_port() {
    local p=$1
    # return 0 if valid, 1 otherwise
  }
  for p in 80 8080 0 65536 abc "" 443; do
    if valid_port "$p"; then echo "$p ok"; else echo "'$p' invalid"; fi
  done
solution: |
  #!/usr/bin/env bash
  valid_port() {
    local p=$1
    [[ $p =~ ^[0-9]+$ ]] && (( p >= 1 && p <= 65535 ))
  }
  for p in 80 8080 0 65536 abc "" 443; do
    if valid_port "$p"; then echo "$p ok"; else echo "'$p' invalid"; fi
  done
expectedOutput: |
  80 ok
  8080 ok
  '0' invalid
  '65536' invalid
  'abc' invalid
  '' invalid
  443 ok
hints:
  - First check it's all digits with a regex, then check the range with `(( ))`.
  - A function's status is the status of its last command.
explanation: "Checking the regex first guarantees `(( ))` only ever sees digits — both correct and safe."
```

## Challenge

```exercise
kind: find-bug
difficulty: intermediate
prompt: This script is supposed to fail when the copy fails, but CI shows it exiting with 0. Which line causes that?
code: |
  #!/usr/bin/env bash
  src=$1 dest=$2
  if ! cp -- "$src" "$dest"; then
    echo "copy failed" >&2
    exit
  fi
  echo "copied"
answer: 5
fix: |
    exit 1
hints:
  - What status does `exit` use when given no number?
explanation: "A bare `exit` uses the status of the last command — here the successful `echo`, so 0. Give an explicit non-zero code."
```
