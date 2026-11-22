---
objectives:
  - Print text and variable values with `echo`
  - Explain why `echo` behaves differently across shells
  - Use `printf` format strings for reliable, aligned output
  - Choose the right tool for messages, data and formatted reports
summary:
  - "`echo` prints its arguments separated by single spaces plus a newline; `-n` omits the newline, `-e` interprets escapes in Bash."
  - "`echo`'s handling of options and backslashes differs between shells and systems, so it is unreliable for arbitrary data."
  - "`printf FORMAT ARGS…` fills `%s`, `%d`, `%f` placeholders, never adds a newline unless you write `\\n`, and reuses the format for extra arguments."
  - "Always pass data as arguments (`printf '%s\\n' \"$x\"`), never inside the format string."
related:
  - first-commands
  - quoting
  - exit-codes-and-validation
---

## Printing with echo

`echo` is the first command most people learn: it prints its arguments, separated by single spaces, followed by a newline.

```console
$ echo Hello world
Hello world
$ echo Hello      world
Hello world
```

The second example surprises beginners: the extra spaces vanished. That's not `echo` — the **shell** split the line into words before `echo` ever saw it, so `echo` received just two arguments. To keep spacing, quote the text so it becomes one argument:

```console
$ echo "Hello      world"
Hello      world
```

::command echo

## Why echo is unreliable for data

`echo` looks simple, but there are three traps:

1. **Options** — if the data you print happens to be `-n` or `-e`, Bash's `echo` treats it as an option, not text.
2. **Backslashes** — Bash's `echo` leaves `\n` alone by default, but `sh` (dash) and `echo` with `xpg_echo` enabled turn it into a newline.
3. **Inconsistency** — POSIX explicitly leaves `echo`'s behaviour with `-n` and backslashes up to the implementation.

```bash title="echo-traps.sh" playground
var="-n"
echo "$var"          # prints nothing: treated as the -n option!
path='C:\new\table'
echo "$path"         # fine in Bash...
echo -e "$path"      # ...but -e turns \n and \t into a newline and a tab
printf '%s\n' "$var" "$path"   # printf prints both exactly
```

For fixed messages written by you, `echo` is perfectly fine. For **data you don't control** — file names, user input, command output — use `printf`.

## printf: format strings

`printf` takes a **format string** followed by arguments. Placeholders in the format are replaced, in order, by the arguments:

::command printf

The most useful placeholders:

| Placeholder | Meaning | Example | Output |
|---|---|---|---|
| `%s` | string | `printf '%s!' hi` | `hi!` |
| `%d` | integer | `printf '%d' 42` | `42` |
| `%5d` | right-aligned in 5 columns | `printf '[%5d]' 42` | `[   42]` |
| `%-8s` | left-aligned in 8 columns | `printf '[%-8s]' ok` | `[ok      ]` |
| `%05d` | zero-padded | `printf '%05d' 42` | `00042` |
| `%.2f` | 2 decimal places | `printf '%.2f' 3.14159` | `3.14` |
| `%x` / `%o` | hexadecimal / octal | `printf '%x' 255` | `ff` |
| `%%` | a literal percent sign | `printf '100%%'` | `100%` |
| `\n`, `\t` | newline, tab (in the format) | | |

### The format is reused

If there are more arguments than placeholders, `printf` starts the format again. This makes one-line loops:

```bash title="table.sh" playground
printf '%-10s %8s\n' ITEM PRICE
printf '%-10s %8.2f\n' lamp 24.5 desk 189 chair 79.9
printf '%s\n' ---- "${HOSTNAME}"
```

```output
ITEM          PRICE
lamp          24.50
desk         189.00
chair         79.90
----
bash-mastery
```

### Escapes in arguments: %b

Escapes like `\n` are interpreted in the *format*, not in `%s` arguments. If an argument contains escapes you want expanded, use `%b`:

```bash
printf '%s\n' 'a\tb'   # a\tb
printf '%b\n' 'a\tb'   # a<TAB>b
```

## printf -v: formatting into a variable

In Bash, `printf -v name FORMAT ARGS` stores the result in a variable instead of printing it — faster than `name=$(printf ...)` because no subshell is created:

```bash title="pad.sh" playground
for i in 1 2 10; do
  printf -v file 'report-%03d.txt' "$i"
  echo "$file"
done
```

## Choosing between them

| Situation | Use |
|---|---|
| A fixed message: `echo "Backup finished"` | `echo` is fine |
| Printing a variable whose value you don't control | `printf '%s\n' "$value"` |
| No trailing newline (prompts, progress) | `printf 'Continue? '` |
| Columns, padding, decimals | `printf` |
| Portable `#!/bin/sh` scripts | `printf` |

## Common mistakes

```mistake
title: Data in the format string
wrong: |
  msg="Disk at 95% capacity"
  printf "$msg\n"
  # Disk at 95apacity  (the %c ate the next characters)
right: |
  printf '%s\n' "$msg"
why: The first argument is a format; `%` sequences in your data are interpreted. Always put data in the arguments.
```

```mistake
title: Forgetting printf's newline
wrong: |
  printf 'done'
  # done$   ← the prompt appears on the same line
right: |
  printf 'done\n'
why: Unlike echo, printf never adds a newline automatically.
```

## Practice

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  echo one    two   "three   four"
answer: one two three   four
hints:
  - Unquoted spaces only separate arguments; quoted spaces are kept.
explanation: "`echo` receives three arguments — `one`, `two`, `three   four` — and joins them with single spaces."
```

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  printf '%s-%s\n' a b c d
answer: |
  a-b
  c-d
hints:
  - The format has two placeholders and there are four arguments.
explanation: The format is reused until all arguments are consumed, producing two lines.
```

```exercise
kind: fill
difficulty: beginner
prompt: Print the number in `$n` zero-padded to 4 digits (so `7` becomes `0007`).
template: printf '___\n' "$n"
blanks:
  - ["%04d"]
hints:
  - "`%d` prints an integer; a width and a `0` flag go between `%` and `d`."
explanation: "`%04d` means: integer, at least 4 wide, padded with zeros."
```

```exercise
kind: command
difficulty: intermediate
prompt: "Using one `printf` command, print `lamp`, `desk` and `chair` each on its own line, every line prefixed with `- ` (dash and space)."
solution: printf -- '- %s\n' lamp desk chair
hints:
  - One placeholder in the format, three arguments — the format will be reused.
  - "If your format starts with `-`, printf may think it's an option. Put `--` before it."
explanation: "`printf -- '- %s\\n' lamp desk chair` reuses the format three times. The `--` tells printf the options are over, so a format that starts with `-` is not misread."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: An aligned report
prompt: "Complete the script so it prints a two-column table: names left-aligned in 8 characters, then the score right-aligned in 3 characters. The expected output is shown when you check."
starter: |
  #!/usr/bin/env bash
  # name score pairs
  set -- ada 97 linus 8 grace 100
  # print one line per pair using a single printf
solution: |
  #!/usr/bin/env bash
  # name score pairs
  set -- ada 97 linus 8 grace 100
  printf '%-8s%3d\n' "$@"
expectedOutput: |
  ada      97
  linus     8
  grace   100
checks:
  - pattern: printf
    message: Use printf for aligned output.
hints:
  - "`$@` expands to all six values; printf reuses the format for each pair."
  - "`%-8s` left-aligns a string in 8 columns; `%3d` right-aligns a number in 3."
explanation: "`printf '%-8s%3d\\n' \"$@\"` consumes two arguments per pass. Width specifiers keep columns aligned no matter how long each value is."
```
