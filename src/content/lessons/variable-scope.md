---
objectives:
  - Explain Bash's default global scope and dynamic scoping
  - Use `local` (and `declare` inside functions) to keep variables private
  - Avoid the `local var=$(cmd)` status-masking trap
  - Know which constructs create subshells and therefore isolate variables
summary:
  - "Variables are global by default — even when first assigned inside a function."
  - "`local name=value` makes a variable visible only in this function *and the functions it calls* (dynamic scope)."
  - "`local x=$(cmd)` hides cmd's exit status; declare first, then assign: `local x; x=$(cmd)`."
  - "Subshells — `( )`, `$( )`, pipelines, `&` — get a copy of every variable; changes never flow back."
  - "Use `readonly`/`declare -r` for constants and UPPER_CASE only for exported or constant names."
related:
  - functions
  - subshells
  - environment-and-export
---

## Global by default

```bash title="global.sh" playground
set_name() { name="Ada"; }
echo "before: '${name-unset}'"
set_name
echo "after: '$name'"           # the function created a global
```

In small scripts that's convenient; in larger ones, helpers that silently overwrite each other's variables cause baffling bugs.

## local

`local` declares a variable that exists only while the function runs:

```bash title="local.sh" playground
i=100
count_to() {
  local i
  for (( i = 1; i <= $1; i++ )); do printf '%d ' "$i"; done
  echo
}
count_to 3
echo "global i is still $i"
```

`local` accepts the same flags as `declare`: `local -i n` (integer), `local -a arr`, `local -A map`, `local -r CONST`. Any `declare` inside a function is also local unless you add `-g`.

## Dynamic scoping

Bash uses **dynamic** scope: a function can see the locals of whoever called it. Most languages use lexical scope, so this surprises people:

```bash title="dynamic.sh" playground
show() { echo "show sees x=$x"; }
outer() {
  local x="outer's local"
  show                     # sees outer's local x
}
x="global"
outer
show
```

It's occasionally useful (a helper can read the caller's settings), but don't rely on it for clarity — pass values as arguments instead.

## The local + command substitution trap

`local` is itself a command, and its exit status replaces that of the substitution:

```bash title="masking.sh" playground
fetch() { return 3; }
bad() {
  local out=$(fetch)
  echo "bad sees status $?"       # 0 — status of `local`
}
good() {
  local out
  out=$(fetch)
  echo "good sees status $?"      # 3
}
bad; good
```

The same applies to `export x=$(cmd)` and `readonly x=$(cmd)`. ShellCheck warns about it (SC2155).

## Subshells copy everything

A subshell starts as a copy of the current shell. Changes inside it vanish when it exits:

```bash title="subshell-scope.sh" playground
n=1
( n=2; echo "inside ( ): $n" )
echo "after ( ): $n"
v=$(n=3; echo "$n")
echo "substitution printed $v, n is $n"
echo 4 | read -r n
echo "after pipe: $n"
```

| Creates a subshell | Runs in the current shell |
|---|---|
| `( … )` | `{ …; }` |
| `$( … )`, `` `…` `` | functions with a `{ }` body |
| each part of a pipeline (except last with `lastpipe`) | `while … done < file` |
| `cmd &` | `source file` |

## Constants

```bash
readonly CONFIG_DIR=/etc/myapp
declare -r MAX_RETRIES=5
CONFIG_DIR=/tmp       # bash: CONFIG_DIR: readonly variable
```

Naming convention: `UPPER_CASE` for environment variables and constants, `lower_case` for everything else — that way you never clobber `PATH`, `HOME` or `USER` by accident.

## Common mistakes

```mistake
title: Clobbering a caller's loop variable
wrong: |
  helper() { for i in a b; do :; done; }
  for i in 1 2 3; do helper; echo "$i"; done   # prints b b b
right: |
  helper() { local i; for i in a b; do :; done; }
why: Without local, the helper's loop overwrites the caller's i.
```

```mistake
title: Lower-case names that shadow important variables
wrong: |
  PATH=./bin      # meant "path to bin" — now no command can be found
right: |
  bin_path=./bin
why: Keep UPPER_CASE for the environment; use lower_case for your own variables.
```

## Practice

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  x=1
  f() { local x=2; g; }
  g() { echo "$x"; x=3; }
  f
  echo "$x"
answer: |
  2
  1
explanation: "g sees and modifies f's local x (dynamic scope); the global x is untouched."
```

```exercise
kind: mcq
difficulty: intermediate
prompt: "Why does `local out=$(cmd); if (( $? != 0 ))` never detect a failure of cmd?"
options:
  - "Command substitution always returns 0"
  - "`$?` holds the status of `local`, which succeeded"
  - "`local` runs cmd in the background"
  - "Functions can't see `$?`"
answer: 1
explanation: Declare and assign separately so `$?` reflects cmd.
```

```exercise
kind: command
difficulty: beginner
prompt: "Define `f` so it sets a *local* variable `v=inner` and prints it, then call `f` and print `$v` (which is `outer`). Start with `v=outer`."
solution: v=outer; f() { local v=inner; echo "$v"; }; f; echo "$v"
explanation: local keeps the function's v separate from the global one.
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Fix the leaky helpers
prompt: "This script should print the totals for two files, then `files processed: 2`. The helpers leak variables into each other. Add `local` declarations (and nothing else) so it works."
starter: |
  #!/usr/bin/env bash
  count=0
  lines_in() {
    count=$(wc -l < "$1")
    echo "$count"
  }
  report() {
    for f in "$@"; do
      echo "${f##*/}: $(lines_in "$f")"
      count=$(( count + 1 ))
    done
  }
  report ~/data/fruits.txt ~/data/numbers.txt
  echo "files processed: $count"
solution: |
  #!/usr/bin/env bash
  count=0
  lines_in() {
    local count
    count=$(wc -l < "$1")
    echo "$count"
  }
  report() {
    local f
    for f in "$@"; do
      echo "${f##*/}: $(lines_in "$f")"
      count=$(( count + 1 ))
    done
  }
  report ~/data/fruits.txt ~/data/numbers.txt
  echo "files processed: $count"
expectedOutput: |
  fruits.txt: 10
  numbers.txt: 8
  files processed: 2
checks:
  - pattern: local
    message: Use local declarations.
hints:
  - "Which function should *not* touch the global `count`?"
  - "Should the loop variable `f` exist after report returns?"
explanation: "`lines_in` must use its own `count`. (Here it runs inside `$( )`, so it can't actually leak — but declaring it local makes the intent explicit and keeps it correct if someone later calls it directly.) `local f` keeps the loop variable private."
```
