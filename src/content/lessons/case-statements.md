---
objectives:
  - Match one value against several glob patterns with `case`
  - Use alternatives, character classes and a default branch
  - Build command dispatchers and menus with `case`
  - Know the fall-through terminators `;&` and `;;&`
summary:
  - "`case WORD in PATTERN) commands ;; … esac` runs the first branch whose pattern matches."
  - "Patterns are globs: `*.txt`, `[yY]*`, `start|run` (alternatives), `*)` as the default."
  - "`;;` ends a branch; `;&` falls through to the next branch's commands; `;;&` continues testing later patterns."
  - "case is ideal for subcommands, option values, file types and yes/no answers — clearer than long if/elif chains."
  - "case is POSIX, so it works in `sh` too."
related:
  - if-statements
  - globbing
  - positional-parameters
---

## Matching against patterns

`case` compares one value with a list of patterns and runs the commands of the **first** match:

```bash
case $value in
  pattern1)
    commands ;;
  pattern2|pattern3)
    commands ;;
  *)
    default commands ;;
esac
```

The patterns are **glob patterns** (the same language as file name matching), not regexes. Matching stops at the first hit, so put specific patterns before general ones.

```bash title="extensions.sh" playground
for f in report.pdf photo.JPG notes.txt archive.tar.gz script.sh README; do
  case $f in
    *.tar.gz|*.tgz)     type="archive" ;;
    *.jpg|*.JPG|*.png)  type="image" ;;
    *.txt|*.md|README)  type="text" ;;
    *.sh)               type="script" ;;
    *.pdf)              type="document" ;;
    *)                  type="unknown" ;;
  esac
  printf '%-16s %s\n' "$f" "$type"
done
```

## Pattern tools

| Pattern | Matches |
|---|---|
| `start` | exactly "start" |
| `start\|begin` | either word |
| `*.log` | anything ending in .log |
| `[yY]` / `[yY]*` | y or Y / anything starting with y or Y |
| `[0-9]` | a single digit |
| `?` | any single character |
| `""` | the empty string |
| `*` | anything (use last, as the default) |

```bash title="answers.sh" playground
for answer in y Yes no N maybe ""; do
  case $answer in
    [yY]|[yY][eE][sS]) result="yes" ;;
    [nN]|[nN][oO])     result="no" ;;
    "")                result="(no answer)" ;;
    *)                 result="unrecognised" ;;
  esac
  printf '%-8s -> %s\n' "'$answer'" "$result"
done
```

`shopt -s nocasematch` makes `case` (and `[[ == ]]`) ignore case, so `[yY][eE][sS]` can simply be `yes`.

## Subcommand dispatch

The most common real-world use: tools with subcommands, like `git commit` or `systemctl restart`.

```bash title="dispatch.sh" playground
cmd_start()  { echo "starting $1"; }
cmd_stop()   { echo "stopping $1"; }
cmd_status() { echo "$1 is running"; }
usage()      { echo "usage: svc {start|stop|restart|status} NAME" >&2; return 64; }

svc() {
  local action=${1:-}; shift || true
  case $action in
    start)        cmd_start "$@" ;;
    stop)         cmd_stop "$@" ;;
    restart)      cmd_stop "$@"; cmd_start "$@" ;;
    status|st)    cmd_status "$@" ;;
    -h|--help|"") usage ;;
    *)            echo "unknown action: $action" >&2; usage ;;
  esac
}
svc restart nginx
svc st api
svc reboot db
echo "status: $?"
```

## Fall-through: ;& and ;;&

| Terminator | After running this branch |
|---|---|
| `;;` | stop (normal) |
| `;&` | run the **next** branch's commands too, without testing its pattern |
| `;;&` | keep testing the **remaining** patterns |

```bash title="fallthrough.sh" playground
level=warn
case $level in
  debug) echo "show debug" ;&
  info)  echo "show info" ;&
  warn)  echo "show warnings" ;&
  error) echo "show errors" ;;
esac
echo ---
n=15
case $n in
  *5) echo "ends in 5" ;;&
  1*) echo "starts with 1" ;;&
  *)  echo "checked all patterns" ;;
esac
```

`;&` and `;;&` are Bash 4 features (not POSIX).

## case vs if

| Use `case` when… | Use `if` when… |
|---|---|
| comparing one value with many fixed strings or patterns | testing different conditions, numbers or files |
| dispatching subcommands or menu choices | combining tests with `&&`/`\|\|` |
| you want portable pattern matching in `sh` | you need regexes (`[[ =~ ]]`) |

## Common mistakes

```mistake
title: Regex syntax in case patterns
wrong: |
  case $n in
    [0-9]+) echo number ;;     # matches one digit followed by a literal +
  esac
right: |
  case $n in
    ''|*[!0-9]*) echo "not a number" ;;
    *)           echo number ;;
  esac
why: case uses globs. "Contains a non-digit or is empty" is the classic glob way to validate integers.
```

```mistake
title: Default branch first
wrong: |
  case $cmd in
    *)     echo "unknown" ;;
    start) echo "starting" ;;   # never reached
  esac
right: |
  case $cmd in
    start) echo "starting" ;;
    *)     echo "unknown" ;;
  esac
why: The first matching pattern wins, and `*` matches everything.
```

## Practice

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  for x in deploy DEPLOY test; do
    case $x in
      deploy) echo "deploying" ;;
      test|check) echo "testing" ;;
      *) echo "unknown: $x" ;;
    esac
  done
answer: |
  deploying
  unknown: DEPLOY
  testing
explanation: Patterns are case-sensitive unless nocasematch is set.
```

```exercise
kind: fill
difficulty: beginner
prompt: Complete the default branch so any unmatched value prints `invalid`.
template: |
  case $choice in
    1) echo one ;;
    2) echo two ;;
    ___) echo invalid ;;
  esac
blanks:
  - ["*"]
explanation: "`*)` matches anything and is conventionally the last branch."
```

```exercise
kind: script
difficulty: intermediate
title: Integer validator
prompt: "Using only `case` (no regex, no `[[ ]]`), complete `is_int` so it returns 0 for non-empty strings made only of digits."
starter: |
  #!/usr/bin/env bash
  is_int() {
    case $1 in
      # your patterns here
    esac
  }
  for v in 42 007 "" 4x2 -3 " 5"; do
    is_int "$v" && echo "'$v' yes" || echo "'$v' no"
  done
solution: |
  #!/usr/bin/env bash
  is_int() {
    case $1 in
      ''|*[!0-9]*) return 1 ;;
      *) return 0 ;;
    esac
  }
  for v in 42 007 "" 4x2 -3 " 5"; do
    is_int "$v" && echo "'$v' yes" || echo "'$v' no"
  done
expectedOutput: |
  '42' yes
  '007' yes
  '' no
  '4x2' no
  '-3' no
  ' 5' no
checks:
  - pattern: \bcase\b
    message: Use a case statement.
  - pattern: =~
    forbid: true
    message: Solve it with glob patterns, not regex.
hints:
  - "Think about what makes a string *invalid*: empty, or containing any non-digit."
  - "`*[!0-9]*` matches a string containing at least one non-digit."
explanation: "Rejecting `''` and `*[!0-9]*` leaves exactly the digit-only strings — a portable POSIX idiom."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Log level filter
prompt: "Read `~/logs/app.log` line by line and count lines per category using `case` on the level field (field 2): ERROR and WARN count as `problems`, INFO as `info`, anything else as `other`. Print `problems=N info=N other=N`."
starter: |
  #!/usr/bin/env bash
  problems=0 info=0 other=0
  while read -r ts level rest; do
    :
  done < ~/logs/app.log
  echo "problems=$problems info=$info other=$other"
solution: |
  #!/usr/bin/env bash
  problems=0 info=0 other=0
  while read -r ts level rest; do
    case $level in
      ERROR|WARN) (( ++problems )) ;;
      INFO)       (( ++info )) ;;
      *)          (( ++other )) ;;
    esac
  done < ~/logs/app.log
  echo "problems=$problems info=$info other=$other"
expectedOutput: problems=6 info=12 other=0
checks:
  - pattern: \bcase\b
    message: Use case for the classification.
hints:
  - "`read -r ts level rest` puts the second field in `level`."
explanation: "case with alternatives (`ERROR|WARN`) classifies each line. Using `(( ++x ))` (pre-increment) avoids the status-1 trap of `(( x++ ))` when x is 0."
```
