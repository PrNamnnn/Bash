---
objectives:
  - Capture a command's output with `$( … )` and use it in another command
  - Explain why `$( )` is preferred over backticks
  - Quote command substitutions to avoid word splitting
  - Know that trailing newlines are removed and the command runs in a subshell
summary:
  - "`$(cmd)` runs cmd and replaces itself with cmd's standard output."
  - "Trailing newlines are stripped; other newlines are kept (if quoted)."
  - "Quote it: `\"$(cmd)\"` — unquoted, the output is word-split and globbed."
  - "`$( )` nests cleanly and handles quotes and backslashes sanely; backticks are legacy."
  - "The command runs in a subshell: variables it sets don't survive. Its exit status becomes `$?` of an assignment."
related:
  - quoting
  - expansion-order
  - subshells
---

## Output as a value

**Command substitution** runs a command and inserts its output into the command line:

```bash title="basics.sh" playground
today=$(date +%F)
echo "Report for $today"
echo "There are $(wc -l < ~/logs/access.log) requests and $(ls ~/data | wc -l) data files"
user_count=$(grep -c '' /etc/passwd)
echo "users: $user_count"
```

Bash runs the inner command first, captures everything it writes to **standard output**, removes trailing newlines, and puts the text where `$( … )` was.

## What exactly is captured

- **Only stdout.** Error messages go to stderr and still appear on the screen (or wherever stderr points). Add `2>&1` inside to capture them too.
- **Trailing newlines are removed** — all of them. Internal newlines remain.
- The inner command runs in a **subshell**: `cd` or variable assignments inside it don't affect your shell.

```bash title="details.sh" playground
out=$(printf 'line1\nline2\n\n\n')
printf '[%s]\n' "$out"
err=$(ls /nope 2>&1)
echo "captured: $err"
x=outer
y=$(x=inner; echo "$x")
echo "x=$x y=$y"
```

## Quote it

Unquoted, the output undergoes word splitting and globbing:

```bash title="quote.sh" playground
files=$(ls ~/downloads)
echo "unquoted:"; printf '  <%s>\n' $files | head -4
echo "quoted:";   printf '  <%s>\n' "$files" | head -4
```

In an assignment (`x=$(cmd)`) quotes aren't required — assignments don't split — but in every other context write `"$(cmd)"`.

> [!WARNING] Don't store lists of file names in a string
> `files=$(ls)` then `for f in $files` breaks on spaces. Use globs directly, or arrays: `mapfile -t files < <(find . -name '*.txt')`.

## $( ) vs backticks

The original syntax was `` `cmd` ``. It still works, but it's hard to read, hard to nest and treats backslashes oddly:

```bash
echo "Kernel: `uname -r`"              # legacy
echo "Kernel: $(uname -r)"             # modern
dir=$(dirname "$(readlink -f "$0")")    # nesting is trivial with $( )
```

Nesting backticks requires escaping the inner ones (`` `dirname \`readlink -f "$0"\`` ``) and quotes inside them interact confusingly with the outer ones. Always use `$( )`.

## Exit status of a substitution

An assignment from a command substitution takes the command's exit status, so you can test it:

```bash title="status.sh" playground
if ! version=$(git --version 2>/dev/null); then
  echo "git is not installed"
fi
if lines=$(grep -c ERROR ~/logs/app.log); then
  echo "found $lines errors"
fi
```

But `local x=$(cmd)` and `export x=$(cmd)` return the status of `local`/`export` (always 0), hiding failures. Declare first, then assign: `local x; x=$(cmd)`.

## Performance

Each `$( )` creates a subshell and usually a process. That's negligible once, but in a loop over thousands of items it adds up. Prefer builtins and parameter expansion inside loops (`${path##*/}` instead of `$(basename "$path")`, `printf -v` instead of `x=$(printf …)`).

## Common mistakes

```mistake
title: Losing the exit status with local
wrong: |
  get_config() {
    local value=$(grep '^port=' "$1") || return 1   # never triggers
  }
right: |
  get_config() {
    local value
    value=$(grep '^port=' "$1") || return 1
  }
why: "`local` is itself a command and succeeds, so its status replaces grep's."
```

```mistake
title: Expecting trailing newlines to survive
wrong: |
  content=$(cat file.txt)
  printf '%s' "$content" > copy.txt   # copy lacks the final newline
right: |
  cp file.txt copy.txt
  # or add it back: printf '%s\n' "$content" > copy.txt
why: Command substitution strips every trailing newline from the output.
```

## Practice

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  n=$(printf 'a\nb\nc\n' | wc -l)
  echo "lines: $n"
answer: "lines: 3"
explanation: "`wc -l` prints 3; the substitution captures it without the trailing newline."
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  cd /tmp
  where=$(cd / && pwd)
  echo "$where $(pwd)"
answer: / /tmp
explanation: "The `cd /` happens in the substitution's subshell, so the main shell stays in /tmp."
```

```exercise
kind: command
difficulty: beginner
prompt: "Print the sentence `Today is DAY` where DAY is the full weekday name from `date` (format `%A`), using command substitution inside double quotes."
solution: echo "Today is $(date +%A)"
explanation: "`\"$(date +%A)\"` inserts the weekday. The double quotes keep the sentence one argument."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: A one-line summary
prompt: "Complete the script so it prints exactly: `app.log: 18 lines, 3 errors, 3 warnings` — computed from `~/logs/app.log` with command substitutions (don't hard-code the numbers)."
starter: |
  #!/usr/bin/env bash
  log=~/logs/app.log
  # compute lines, errors (lines containing ERROR) and warnings (lines containing WARN)

  echo "app.log: $lines lines, $errors errors, $warnings warnings"
solution: |
  #!/usr/bin/env bash
  log=~/logs/app.log
  lines=$(wc -l < "$log")
  errors=$(grep -c ERROR "$log")
  warnings=$(grep -c WARN "$log")
  echo "app.log: $lines lines, $errors errors, $warnings warnings"
expectedOutput: "app.log: 18 lines, 3 errors, 3 warnings"
checks:
  - pattern: \$\(
    message: Use command substitution $( ) to compute the values.
  - pattern: =\s*1[0-9]\b|=\s*3\s*$
    flags: m
    forbid: true
    message: Compute the numbers from the file instead of hard-coding them.
hints:
  - "`wc -l < file` prints just a number; `grep -c PATTERN file` counts matching lines."
explanation: "Three substitutions compute the values. Note `wc -l < \"$log\"` rather than `wc -l \"$log\"`, which would include the file name."
```
