---
objectives:
  - Identify the command name, options, option arguments and operands in any command line
  - Understand short, combined and long options, and the `--` end-of-options marker
  - Explain how whitespace separates words and why that matters
  - Read a command's usage synopsis in documentation
summary:
  - "A simple command is: optional variable assignments, a command name, then arguments."
  - "By convention, options start with `-` (short, combinable: `-la`) or `--` (long: `--all`); operands are everything else."
  - "Unquoted spaces and tabs separate words; how many spaces doesn't matter. Quotes make spaces part of a word."
  - "`--` ends option parsing, so operands that start with `-` are treated as names."
  - "Usage synopses use `[ ]` for optional parts and `...` for repeatable parts."
related:
  - how-a-command-runs
  - quoting
  - getopts
---

## The shape of a simple command

Almost everything you type is a **simple command**:

```text
  LANG=C   sort   -t ,   -k 2   -r   data.csv   other.csv
  └──┬──┘  └┬─┘   └─┬─┘  └─┬─┘  └┬┘  └──────┬────────────┘
 assignment name  option   option flag   operands (arguments)
            with argument
```

| Part | What it is |
|---|---|
| **Assignments** (optional) | `NAME=value` words before the command; they set environment variables for this command only |
| **Command name** | The first remaining word: a builtin, function, alias or program |
| **Arguments** | Every other word; the program decides what each means |

Bash itself doesn't know which arguments are options. It just splits the line into words and passes them to the program as a list. *Conventions* tell programs how to interpret them.

## Options and operands

**Options** (also called flags or switches) modify behaviour. **Operands** are what the command works on — usually files.

| Style | Example | Notes |
|---|---|---|
| Short option | `ls -l` | One dash, one letter |
| Combined short options | `ls -la` = `ls -l -a` | Letters after one dash |
| Short option with argument | `head -n 5`, `head -n5` | The argument may be attached |
| Long option | `ls --all` | Two dashes, a word (GNU convention) |
| Long option with argument | `sort --key=2`, `sort --key 2` | `=` or a space |
| End of options | `rm -- -file.txt` | Everything after `--` is an operand |

Most GNU tools allow options after operands (`ls notes.txt -l`), but POSIX tools — and `find`, `xargs` and many others — expect options first. Writing options first is always safe.

### The `--` marker

What if a file is named `-rf`? `rm -rf` would read it as options. `--` says "options are over":

```bash title="dashdash.sh" playground
cd /tmp
touch -- -n
ls
echo "removing it safely:"
rm -- -n
ls -- -n 2>&1
```

In scripts, put `--` before variables that hold file names: `rm -- "$file"`, `cp -- "$src" "$dst"`. A file name from user input or a directory listing could start with a dash.

## Whitespace splits words

The shell splits the line on unquoted spaces, tabs and newlines. The *number* of spaces doesn't matter:

```bash title="words.sh" playground
printf '<%s>\n' one   two      three
printf '<%s>\n' "one   two"   three
printf '<%s>\n' one\ two three
```

This is why file names with spaces must be quoted, and it's the root of the most common shell bug — which the next lesson, **Quoting**, is all about.

## Reading a synopsis

Manual pages and `--help` output describe commands with a compact notation:

```text
cp [OPTION]... [-T] SOURCE DEST
grep [OPTION...] PATTERNS [FILE...]
tar {-c|-x|-t} [-f ARCHIVE] [FILE]...
```

| Notation | Means |
|---|---|
| `[X]` | X is optional |
| `X...` | X can be repeated |
| `{a\|b}` or `a\|b` | choose one of the alternatives |
| UPPERCASE | replace with your own value |

## Common mistakes

```mistake
title: Missing space between command and argument
wrong: |
  ls-la
  cd..
right: |
  ls -la
  cd ..
why: Without a space the whole thing is one word, so Bash looks for a command literally named `ls-la`. (Some shells accept `cd..`; Bash does not.)
```

```mistake
title: Spaces around = in an assignment
wrong: |
  name = "Ada"     # runs a command called "name" with args "=" and "Ada"
right: |
  name="Ada"
why: "An assignment must be a single word: `NAME=value` with no spaces. Otherwise the shell sees a command name followed by arguments."
```

## Practice

```exercise
kind: mcq
difficulty: beginner
prompt: "In `tar -czf backup.tgz -C /home learner`, which word is the *argument of an option* rather than an operand?"
options:
  - "`tar`"
  - "`backup.tgz`"
  - "`learner`"
  - "`-czf`"
answer: 1
hints:
  - "`f` is the last letter in the combined options and needs a value."
explanation: "`-czf` combines `-c`, `-z` and `-f`; `-f` takes the archive name `backup.tgz` as its argument. `/home` is the argument of `-C`, and `learner` is the operand."
```

```exercise
kind: predict
difficulty: beginner
prompt: How many arguments does printf receive after the format, and what is printed?
code: |
  printf '[%s]\n' a   "b  c"   d\ e
answer: |
  [a]
  [b  c]
  [d e]
explanation: "Three arguments: `a`, `b  c` (quotes keep both spaces) and `d e` (the backslash escapes the space)."
```

```exercise
kind: command
difficulty: beginner
compare: fs
setup: touch ~/-v
prompt: "Someone created a file called `-v` in your home directory. Delete it."
solution: rm -- ~/-v
hints:
  - "`rm -v` would be read as an option."
explanation: "`rm -- -v` or `rm ./-v` both work: `--` ends option parsing, and `./-v` doesn't start with a dash."
```

## Challenge

```exercise
kind: mcq
difficulty: intermediate
prompt: "A script runs `grep $pattern file.txt`. A user passes the pattern `-v`. What happens?"
options:
  - grep searches for the text "-v"
  - "grep treats `-v` as the invert option and then uses `file.txt` as the PATTERN, reading stdin"
  - Bash refuses to run the command
  - The pattern is ignored
answer: 1
hints:
  - The value starts with a dash and isn't protected.
explanation: "After expansion grep sees `-v file.txt`: an option and a pattern, with no file, so it waits on stdin. Write `grep -e \"$pattern\" -- file.txt` (or `grep -- \"$pattern\" file.txt`): `-e` marks the pattern explicitly and quotes keep it one word."
```
