---
objectives:
  - Read script arguments with `$1`, `$2`, … `${10}` and count them with `$#`
  - Explain the difference between `"$@"`, `"$*"`, `$@` and `$*`
  - Consume arguments with `shift` and loop over them
  - Use `$0`, `set --` and defaults for optional arguments
summary:
  - "`$1`…`$9` are the first nine arguments; `${10}` and beyond need braces. `$0` is the script name; `$#` the count."
  - "`\"$@\"` expands to every argument as a separate, intact word — almost always what you want."
  - "`\"$*\"` joins all arguments into one string with the first character of IFS between them."
  - "`shift` drops `$1` and renumbers; `shift N` drops N. Process arguments in a `while (( $# ))` loop."
  - "`set -- a b c` replaces the positional parameters; functions get their own set while they run."
related:
  - reading-input
  - exit-codes-and-validation
  - getopts
---

## Arguments to a script

When you run `./backup.sh /var/www /backups 7`, the words after the script name become **positional parameters**:

| Parameter | Value |
|---|---|
| `$0` | `./backup.sh` (how the script was called) |
| `$1` | `/var/www` |
| `$2` | `/backups` |
| `$3` | `7` |
| `$#` | `3` (the number of arguments) |
| `"$@"` | `/var/www` `/backups` `7` (all, as separate words) |

```bash title="args.sh" playground
echo "script: $0"
echo "count:  $#"
echo "first:  $1"
echo "second: $2"
echo "all:    $*"
for a in "$@"; do echo "  arg: [$a]"; done
```

Open **Arguments & standard input** under the editor and run it with `one "two words" three`.

From the tenth argument on, braces are required: `${10}`. Without them, `$10` means `$1` followed by a literal `0`.

## "$@" vs "$*"

This is one of the most important details in Bash:

| Form | Expands to | Use |
|---|---|---|
| `"$@"` | each argument as its own word, preserved exactly | passing arguments on, looping |
| `"$*"` | one word: all arguments joined by the first char of IFS (a space) | messages, logging |
| `$@` / `$*` (unquoted) | all arguments, re-split on whitespace and globbed | almost never |

```bash title="at-vs-star.sh" playground
set -- "one" "two words" "*"
echo '--- "$@"'; printf '[%s]\n' "$@"
echo '--- "$*"'; printf '[%s]\n' "$*"
echo '--- $@ (unquoted)'; cd ~/data; printf '[%s]\n' $@ | head -5
```

The unquoted form splits `two words` and turns `*` into file names. Write `"$@"` whenever you forward arguments: `exec java -jar app.jar "$@"`, `grep "$@" file`.

## shift

`shift` removes the first parameter and renumbers the rest; `shift 2` removes two. It's the classic way to process arguments one by one:

```bash title="shift.sh" playground
set -- -v --name "Ada Lovelace" input.txt
while (( $# > 0 )); do
  case $1 in
    -v)     echo "verbose on" ;;
    --name) echo "name = $2"; shift ;;   # consume the value too
    *)      echo "file = $1" ;;
  esac
  shift
done
```

For real option parsing, Level 8's `getopts` lesson builds on this pattern.

## Defaults and required arguments

Combine positional parameters with parameter expansion:

```bash title="defaults.sh" playground
set -- /var/www
src=${1:?usage: backup.sh SRC [DEST] [DAYS]}   # required: abort with a message if missing
dest=${2:-/backups}                              # optional with default
days=${3:-7}
echo "backing up $src to $dest, keeping $days days"
```

`${1:?message}` prints the message and exits a script if `$1` is unset or empty.

## set -- and functions

`set -- ARGS` replaces the current positional parameters — handy for splitting a string or for testing:

```bash
set -- $(date '+%Y %m %d')     # deliberate word splitting
echo "year=$1 month=$2 day=$3"
```

Functions have their **own** positional parameters while they run; the script's are restored afterwards:

```bash title="function-args.sh" playground
greet() { echo "function got $# args: $*"; }
set -- a b c
greet x y
echo "script still has $# args: $*"
```

## $0

`$0` is the script name as invoked (`./tool.sh`, `/usr/local/bin/tool`, or `bash` when interactive). Use it in usage messages:

```bash
usage() { echo "usage: ${0##*/} SOURCE DEST" >&2; exit 64; }
```

`${0##*/}` strips the directory so the message shows just `tool.sh`.

## Common mistakes

```mistake
title: Unquoted $@ when forwarding arguments
wrong: |
  #!/usr/bin/env bash
  exec /opt/app/bin/server $@
right: |
  #!/usr/bin/env bash
  exec /opt/app/bin/server "$@"
why: Unquoted, an argument like `--title "Q1 report"` is split into two words and globbed.
```

```mistake
title: $10 instead of ${10}
wrong: |
  echo "tenth: $10"    # prints the first argument followed by 0
right: |
  echo "tenth: ${10}"
why: Only single digits follow `$` directly; longer numbers need braces.
```

## Practice

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  set -- alpha "beta gamma" delta
  echo "$#"
  echo "$2"
answer: |
  3
  beta gamma
explanation: Quotes made `beta gamma` a single argument, so there are three.
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  set -- a b c d
  shift 2
  echo "$# $1 $*"
answer: 2 c c d
explanation: "Two parameters were removed; `c` is now `$1`."
```

```exercise
kind: script
difficulty: beginner
title: Argument counter
prompt: "Complete the script so it prints `N arguments` followed by each argument on its own line, prefixed with `- `. It's run with the arguments `one \"two words\" three`."
args: one "two words" three
starter: |
  #!/usr/bin/env bash
solution: |
  #!/usr/bin/env bash
  echo "$# arguments"
  for arg in "$@"; do
    echo "- $arg"
  done
expectedOutput: |
  3 arguments
  - one
  - two words
  - three
checks:
  - pattern: \"\$@\"
    message: Loop over "$@" (quoted) so arguments with spaces stay intact.
hints:
  - "`$#` is the count; `for arg in \"$@\"` loops over the arguments."
explanation: "`\"$@\"` keeps `two words` together. Unquoted `$@` would produce four items."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Join with a separator
prompt: "Write a function `join_by` whose first argument is a separator and the rest are items; it prints the items joined by the separator. `join_by , a b c` prints `a,b,c`; `join_by ' - ' x y` prints `x - y`."
starter: |
  #!/usr/bin/env bash
  join_by() {
    # your code here
  }
  join_by , a b c
  join_by ' - ' x y
  join_by / single
solution: |
  #!/usr/bin/env bash
  join_by() {
    local sep=$1
    shift
    local out=$1
    shift
    for item in "$@"; do
      out+="$sep$item"
    done
    echo "$out"
  }
  join_by , a b c
  join_by ' - ' x y
  join_by / single
expectedOutput: |
  a,b,c
  x - y
  single
hints:
  - Save `$1` as the separator, then `shift` it away.
  - Start the result with the first remaining item, then append separator + item for the rest.
explanation: "`shift` removes the separator so `\"$@\"` holds just the items. (Using `\"$*\"` with a custom IFS only works for single-character separators.)"
```
