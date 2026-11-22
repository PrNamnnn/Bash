---
objectives:
  - Define and call shell functions, and pass them arguments
  - Return status codes with `return` and data with stdout
  - Organise scripts as small functions with a `main` entry point
  - Understand how functions differ from scripts, aliases and subshells
summary:
  - "Define with `name() { …; }` (portable) or `function name { …; }` (Bash). Call like a command: `name arg1 arg2`."
  - "Inside, arguments are `$1`, `$2`, `$@`, `$#` — the script's own arguments are hidden while the function runs."
  - "`return N` sets the exit status (0–255). To return data, print it and capture with `$(name …)`."
  - "Functions run in the current shell: they can change variables and the directory — use `local` to avoid leaks."
  - "A `main \"$@\"` function at the bottom keeps scripts readable and lets you define helpers in any order."
related:
  - variable-scope
  - positional-parameters
  - script-architecture
---

## Defining and calling

```bash
greet() {
  echo "Hello, $1!"
}
greet Ada          # call it like any command
```

A function is a named compound command. Once defined, it behaves like a command: it takes arguments, has an exit status, and can be used in pipelines, `if` conditions and `&&` lists.

::viz functions

```bash title="basics.sh" playground
log() {
  printf '[%s] %s\n' "$1" "${*:2}"
}
is_even() {
  (( $1 % 2 == 0 ))
}
log INFO "starting up"
log WARN "disk at" 87%
if is_even 42; then log INFO "42 is even"; fi
is_even 7 || log INFO "7 is odd"
```

| Syntax | Portability |
|---|---|
| `name() { …; }` | POSIX — works everywhere |
| `function name { …; }` | Bash/ksh/zsh |
| `function name() { …; }` | Bash only — avoid |

The body is usually a `{ }` group (runs in the current shell). Using `( )` instead — `name() ( … )` — runs the body in a subshell, so nothing it changes leaks out.

## Arguments

Inside a function, `$1…$9`, `${10}`, `$@`, `$*` and `$#` refer to **the function's** arguments. `$0` is still the script name; `FUNCNAME[0]` is the function's name.

```bash title="args.sh" playground
show_args() {
  echo "${FUNCNAME[0]} got $# argument(s)"
  local i=1
  for arg in "$@"; do
    echo "  \$$i = '$arg'"
    (( i++ ))
  done
}
show_args one "two words" ""
show_args
```

## Returning values

A function has two output channels:

| Channel | How | Use for |
|---|---|---|
| exit status | `return N` (0–255) | success/failure, yes/no answers |
| stdout | `echo` / `printf` | data: strings, numbers, lists |

```bash title="returning.sh" playground
file_ext() {
  local name=${1##*/}
  [[ $name == *.* ]] || return 1     # no extension: fail
  printf '%s\n' "${name##*.}"
}
ext=$(file_ext ~/data/sales.csv) && echo "extension: $ext"
file_ext README || echo "README has no extension (status $?)"

max() {
  local m=$1; shift
  for n; do (( n > m )) && m=$n; done
  echo "$m"
}
echo "max: $(max 4 19 7 23 11)"
```

Without an explicit `return`, the status is that of the last command run.

## Script structure: main

Bash reads a function definition when it reaches it, so a function must be defined before it is *called* — not before it is *mentioned*. The `main` pattern puts the high-level logic at the top and calls it at the bottom:

```bash title="structure.sh" playground
#!/usr/bin/env bash
set -euo pipefail

main() {
  local dir=${1:-$HOME/data}
  require_dir "$dir"
  summarize "$dir"
}

require_dir() {
  [[ -d $1 ]] || die "not a directory: $1"
}

summarize() {
  local f
  for f in "$1"/*.csv; do
    printf '%-12s %3d rows\n' "${f##*/}" "$(( $(wc -l < "$f") - 1 ))"
  done
}

die() { echo "error: $*" >&2; exit 1; }

main "$@"
```

## Functions vs other commands

When you type a name, Bash checks in this order: alias → keyword → **function** → builtin → `$PATH`. So a function can wrap a command of the same name — use `command` to reach the original:

```bash title="wrapper.sh" playground
ls() {
  echo "(wrapped ls)"
  command ls -1 "$@"
}
ls ~/projects
type ls | head -1
unset -f ls
```

Functions aren't inherited by child scripts unless exported with `export -f name`.

## Common mistakes

```mistake
title: Using return for data
wrong: |
  add() { return $(( $1 + $2 )); }
  add 200 100; echo $?     # 44 — statuses wrap at 256
right: |
  add() { echo $(( $1 + $2 )); }
  sum=$(add 200 100)
why: Exit statuses are 8-bit (0–255) and meant for success/failure. Print data instead.
```

```mistake
title: Variables leaking out of functions
wrong: |
  count_lines() { n=$(wc -l < "$1"); echo "$n"; }
  n=10; count_lines file.txt; echo "$n"   # n was overwritten
right: |
  count_lines() { local n; n=$(wc -l < "$1"); echo "$n"; }
why: Variables in functions are global by default. Declare them `local` (next lesson).
```

```mistake
title: Calling before defining
wrong: |
  #!/usr/bin/env bash
  greet Ada            # command not found
  greet() { echo "hi $1"; }
right: |
  #!/usr/bin/env bash
  greet() { echo "hi $1"; }
  main() { greet Ada; }
  main "$@"
why: Bash executes top to bottom; a definition must have run before the call.
```

## Practice

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  f() { echo "$# $1"; }
  f a "b c" d
  f "$@"
answer: |
  3 a
  0
explanation: "The first call gets three arguments. The script itself has none, so `f \"$@\"` gets zero and `$1` is empty."
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  check() { [[ $1 == ok ]]; }
  check ok && echo A
  check bad || echo B
  check bad; echo $?
answer: |
  A
  B
  1
explanation: Without return, a function's status is that of its last command — here the [[ ]] test.
```

```exercise
kind: fill
difficulty: beginner
prompt: Capture the output of the function `today` into the variable `d`.
template: d=___
blanks:
  - ["$(today)", "\"$(today)\""]
explanation: Command substitution works for functions exactly like for external commands.
```

```exercise
kind: script
difficulty: beginner
title: Repeat a string
prompt: "Write a function `repeat STRING N` that prints STRING N times on one line (no separators), followed by a newline. The script calls it twice."
starter: |
  #!/usr/bin/env bash
  repeat() {
    :
  }
  repeat ab 3
  repeat - 10
solution: |
  #!/usr/bin/env bash
  repeat() {
    local out="" i
    for (( i = 0; i < $2; i++ )); do out+=$1; done
    printf '%s\n' "$out"
  }
  repeat ab 3
  repeat - 10
expectedOutput: |
  ababab
  ----------
hints:
  - "Build the string with `out+=$1` in a C-style loop."
  - "Use `printf '%s\\n'` — `echo -` style strings can be mistaken for options."
explanation: Accumulate into a local variable, then print once.
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: A tiny library
prompt: "Write `trim` (strip leading/trailing spaces from its argument), `upper` (convert its argument to upper case) and `slug` (lower-case, then replace runs of non-alphanumerics with `-`, and strip leading/trailing `-`). Print the results for the test calls."
starter: |
  #!/usr/bin/env bash
  trim()  { :; }
  upper() { :; }
  slug()  { :; }
  echo "[$(trim '   padded value  ')]"
  upper "hello, world"
  slug "  My Great Post: Part 2! "
solution: |
  #!/usr/bin/env bash
  trim() {
    local s=$1
    s=${s#"${s%%[![:space:]]*}"}
    s=${s%"${s##*[![:space:]]}"}
    printf '%s\n' "$s"
  }
  upper() { printf '%s\n' "${1^^}"; }
  slug() {
    local s=${1,,}
    s=$(printf '%s' "$s" | tr -cs 'a-z0-9' '-')
    s=${s#-}; s=${s%-}
    printf '%s\n' "$s"
  }
  echo "[$(trim '   padded value  ')]"
  upper "hello, world"
  slug "  My Great Post: Part 2! "
expectedOutput: |
  [padded value]
  HELLO, WORLD
  my-great-post-part-2
hints:
  - "`${1^^}` upper-cases, `${1,,}` lower-cases (Bash 4+)."
  - "`tr -cs 'a-z0-9' '-'` replaces every run of other characters with a single dash."
  - "For trim, `${s%%[![:space:]]*}` is the leading whitespace."
explanation: "Each helper reads its argument, transforms it with parameter expansion or a filter, and prints the result — reusable building blocks for any script."
```
