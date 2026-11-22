---
objectives:
  - Write `if`, `elif` and `else` blocks with correct syntax
  - Explain that `if` tests a command's exit status, not a boolean expression
  - Use `test` / `[ ]` for strings, numbers and files — with correct quoting
  - Use any command (grep, mkdir, curl…) directly as a condition
summary:
  - "`if COMMANDS; then …; elif …; then …; else …; fi` — the condition is any command list; exit status 0 means true."
  - "`[` is a command (also called `test`) and needs spaces: `[ \"$x\" = yes ]`; the last argument must be `]`."
  - "Strings: `=`, `!=`, `-z`, `-n`. Integers: `-eq -ne -lt -le -gt -ge`. Files: `-e -f -d -r -w -x -s`."
  - "Always quote variables inside `[ ]`; inside Bash's `[[ ]]` it's optional (next lesson)."
  - "`if grep -q …`, `if mkdir …`, `if ! command -v …` — test commands directly instead of checking `$?`."
related:
  - exit-status
  - conditional-expressions
  - file-tests
---

## if runs a command

In most languages, `if` evaluates a boolean expression. In the shell, **`if` runs a command and checks its exit status**: 0 means "true", anything else "false".

```bash
if COMMANDS; then
  COMMANDS        # run when the condition's status is 0
elif COMMANDS; then
  COMMANDS
else
  COMMANDS
fi
```

::viz conditionals

Because the condition is just a command, you can use any program:

```bash title="commands-as-conditions.sh" playground
if grep -q '^learner:' /etc/passwd; then
  echo "user exists"
fi
if mkdir /tmp/lockdir 2>/dev/null; then
  echo "acquired the lock"
else
  echo "someone else holds the lock"
fi
if ! command -v jq > /dev/null; then
  echo "jq is not installed"
fi
```

`then` must start a new command — after a newline or a `;`. A one-liner is fine for short tests: `if [ -f x ]; then echo yes; fi`.

## test and [ ]

To compare values you need a command that *evaluates a condition* and sets its exit status. That's `test`, also spelled `[`:

```bash
test -f notes.txt
[ -f notes.txt ]       # identical: [ is a command whose last argument must be ]
```

Since `[` is a command, **spaces are mandatory** around it and around every operator: `[ "$a" = "$b" ]`.

::command test

### Strings

| Test | True when |
|---|---|
| `[ "$a" = "$b" ]` | equal (POSIX uses a single `=`) |
| `[ "$a" != "$b" ]` | not equal |
| `[ -z "$a" ]` | empty |
| `[ -n "$a" ]` | non-empty |

### Integers

| Test | Meaning |
|---|---|
| `-eq` / `-ne` | equal / not equal |
| `-lt` / `-le` | less than / less or equal |
| `-gt` / `-ge` | greater than / greater or equal |

`<` and `>` inside `[ ]` are **redirections**, not comparisons — `[ 5 > 3 ]` creates a file called `3`!

### Files

| Test | True when |
|---|---|
| `-e` | exists |
| `-f` / `-d` | regular file / directory |
| `-r` `-w` `-x` | readable / writable / executable by you |
| `-s` | exists and is not empty |

```bash title="tests.sh" playground
count=12
name=""
if [ "$count" -gt 10 ]; then echo "more than ten"; fi
if [ -z "$name" ]; then echo "name is empty"; fi
if [ -d ~/projects ] && [ -r ~/notes.txt ]; then echo "both exist"; fi
disk=87
if [ "$disk" -ge 90 ]; then
  echo "CRITICAL"
elif [ "$disk" -ge 75 ]; then
  echo "WARNING"
else
  echo "OK"
fi
```

## Why quoting matters inside [ ]

`[` receives its arguments after word splitting. An unquoted empty variable *disappears*, changing the meaning of the test:

```bash title="quote-in-test.sh" playground
answer=""
[ $answer = yes ] 2>&1 && echo "yes"            # becomes [ = yes ] → error
[ "$answer" = yes ] || echo "not yes (correct)"
file="my notes.txt"
[ -f $file ] 2>&1 || true                       # too many arguments
```

Quote every variable inside `[ ]`.

## Combining conditions

Prefer `&&` and `||` between separate tests over the old `-a` / `-o` operators (which are ambiguous and deprecated):

```bash
if [ -f "$cfg" ] && [ -r "$cfg" ]; then …
if [ "$env" = prod ] || [ "$env" = staging ]; then …
```

## Nesting and style

```bash
if [[ -f $config ]]; then
  if grep -q '^debug=true' "$config"; then
    echo "debug mode"
  fi
fi
```

Deep nesting gets hard to read. Often an early exit ("guard clause") is clearer:

```bash
[[ -f $config ]] || die "missing $config"
grep -q '^debug=true' "$config" && echo "debug mode"
```

## Common mistakes

```mistake
title: Missing spaces around [ ]
wrong: |
  if ["$x" = "y"]; then
  # bash: [y: command not found
right: |
  if [ "$x" = "y" ]; then
why: "`[` is a command name; it must be a separate word, and `]` its separate last argument."
```

```mistake
title: Checking $? instead of the command
wrong: |
  grep -q error log.txt
  if [ $? -eq 0 ]; then echo found; fi
right: |
  if grep -q error log.txt; then echo found; fi
why: It's shorter, can't be broken by an intervening command, and reads like English.
```

```mistake
title: Using > to compare numbers in [ ]
wrong: |
  if [ "$size" > 100 ]; then …     # redirects to a file named 100
right: |
  if [ "$size" -gt 100 ]; then …
  if (( size > 100 )); then …      # Bash arithmetic
why: Inside `[ ]`, `>` is a redirection operator. Use `-gt`, or `(( ))` for arithmetic.
```

## Practice

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  n=7
  if [ "$n" -lt 5 ]; then echo small
  elif [ "$n" -lt 10 ]; then echo medium
  else echo large
  fi
answer: medium
explanation: "The first test fails, the `elif` test succeeds."
```

```exercise
kind: find-bug
difficulty: beginner
prompt: Which line has the syntax error?
code: |
  #!/usr/bin/env bash
  status=$1
  if [ "$status" = "ok"]; then
    echo "all good"
  fi
answer: 3
fix: |
  if [ "$status" = "ok" ]; then
hints:
  - Look carefully at the closing bracket.
explanation: "`\"ok\"]` is one word, so `[` never receives a separate `]` argument: \"missing `]'\"."
```

```exercise
kind: script
difficulty: beginner
title: Classify a file
prompt: "Complete the function so it prints `directory`, `file`, or `missing` for its argument. The script tests three paths."
starter: |
  #!/usr/bin/env bash
  kind() {
    local p=$1
    # print directory / file / missing
  }
  kind ~/projects
  kind ~/notes.txt
  kind ~/nope
solution: |
  #!/usr/bin/env bash
  kind() {
    local p=$1
    if [ -d "$p" ]; then
      echo directory
    elif [ -f "$p" ]; then
      echo file
    else
      echo missing
    fi
  }
  kind ~/projects
  kind ~/notes.txt
  kind ~/nope
expectedOutput: |
  directory
  file
  missing
hints:
  - "`-d` tests for a directory, `-f` for a regular file."
explanation: "An if/elif/else chain with file tests. Quoting `\"$p\"` keeps paths with spaces working."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Service gate
prompt: "Write the logic: if `~/.config/app.conf` contains a line `log_level=debug`, print `debug enabled`; otherwise, if the file exists, print the configured level (e.g. `level: info`); if the file doesn't exist print `no config` to stderr and exit 1."
starter: |
  #!/usr/bin/env bash
  cfg=~/.config/app.conf
solution: |
  #!/usr/bin/env bash
  cfg=~/.config/app.conf
  if grep -q '^log_level=debug$' "$cfg" 2>/dev/null; then
    echo "debug enabled"
  elif [ -f "$cfg" ]; then
    echo "level: $(grep '^log_level=' "$cfg" | cut -d= -f2)"
  else
    echo "no config" >&2
    exit 1
  fi
expectedOutput: "level: info"
checks:
  - pattern: \bif\b
    message: Use an if statement.
  - pattern: grep
    message: Use grep to test the file contents.
hints:
  - "`grep -q` makes a perfect condition."
  - Extract the value with `cut -d= -f2`.
explanation: "Commands as conditions (`grep -q`), file tests (`-f`), and errors on stderr with a non-zero exit — the core of shell decision-making."
```
