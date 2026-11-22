---
objectives:
  - Create, read, change and remove variables with correct syntax
  - Choose good variable names and avoid clobbering environment variables
  - Use braces to delimit names and provide defaults
  - Make values constant with `readonly` and inspect variables with `declare -p`
summary:
  - "Assign with `name=value` — no spaces around `=`. Read with `$name` or `${name}`."
  - "Names: letters, digits, underscore; can't start with a digit; case-sensitive. Use lower_case for your own variables, UPPER_CASE for environment/config."
  - "All variables are strings (unless declared otherwise); quote them when you use them."
  - "`${name}` delimits the name (`${file}_backup`); `${name:-default}` provides a fallback."
  - "`unset name` removes a variable; `readonly name=value` / `declare -r` makes it constant; `declare -p name` shows it exactly."
related:
  - your-first-script
  - environment-and-export
  - parameter-expansion
---

## Creating variables

A variable is a name bound to a value. Assignment has a strict syntax:

```bash
name="Ada Lovelace"
count=3
log_dir=/var/log/myapp
empty=
```

**No spaces around `=`.** `name = value` would run a command called `name` with the arguments `=` and `value`.

Quotes are needed when the value contains spaces or special characters; for simple words they're optional. Values are always **strings** — `count=3` stores the character `3`, which arithmetic contexts such as `$(( count + 1 ))` interpret as a number.

## Using variables

Prefix the name with `$` to get its value. Inside double quotes the value is substituted; inside single quotes it isn't:

```bash title="use.sh" playground
user="ada"
dir="/home/$user/projects"
echo "User: $user"
echo 'Literal: $user'
echo "Projects in: $dir"
file="report"
echo "Backup name: ${file}_2026.txt"   # braces end the name
echo "Wrong: $file_2026.txt"           # looks for a variable named file_2026
```

### Braces

`${name}` is the full form of `$name`. You need braces when the name is followed by characters that could be part of a name, and for all the operators you'll learn in the parameter-expansion lesson (`${name:-default}`, `${#name}`, `${name%.txt}`…).

## Naming rules and conventions

- Letters, digits and `_`; must not start with a digit. `my_var2` is fine, `2var` and `my-var` are not.
- Case-sensitive: `name` and `NAME` are different.
- **Convention:** UPPER_CASE for environment variables and constants exported to programs (`PATH`, `HOME`, `LANG`, `EDITOR`), lower_case for your script's own variables.

The convention isn't cosmetic. If you use `PATH` or `USER` or `HOME` as a "temporary" variable, you break commands that depend on them:

```bash title="clobber.sh" playground
PATH="/tmp/my/path"       # oops — this was meant to be "a path"
ls 2>&1 | head -1
echo "status $?"
```

## Changing and removing

```bash title="lifecycle.sh" playground
count=1
count=2                  # reassign
greeting="Hello"
greeting+=", world"      # append (Bash)
echo "$count $greeting"
unset count
echo "count is now: '${count}' (unset)"
echo "${count:-count has no value}"
```

An **unset** variable and an **empty** one both expand to nothing, but they're different. `[[ -v name ]]` tests whether a variable is set; `${name-x}` (no colon) only substitutes for unset variables.

## Constants

```bash title="readonly.sh" playground
readonly APP_NAME="shop"
declare -r MAX_RETRIES=3
echo "$APP_NAME retries up to $MAX_RETRIES times"
APP_NAME="other"
echo "still: $APP_NAME"
```

Read-only variables can't be changed or unset for the rest of the shell's life — useful for configuration that must not be modified by accident.

## Inspecting variables

`declare -p` prints a variable exactly, including attributes — invaluable when debugging whitespace problems:

```bash title="inspect.sh" playground
msg=$'two\nlines  with  spaces'
declare -p msg
declare -i n=5          # integer attribute
n+=10
declare -p n
```

`set` lists all variables and functions; `env` lists only exported ones.

## Variables are strings — with optional attributes

By default every value is a string. `declare` can add attributes:

| Declaration | Effect |
|---|---|
| `declare -i n` | integer: assignments are evaluated arithmetically |
| `declare -r x` | read-only |
| `declare -x x` | exported (same as `export`) |
| `declare -l x` / `-u` | force lower / upper case on assignment |
| `declare -a arr` / `-A map` | indexed / associative array |

## Common mistakes

```mistake
title: Spaces around =
wrong: |
  count = 5
  # bash: count: command not found
right: |
  count=5
why: An assignment must be a single word.
```

```mistake
title: Using $ when assigning
wrong: |
  $name="Ada"
  # bash: =Ada: command not found
right: |
  name="Ada"
why: "The `$` reads a variable. When assigning, write only the name."
```

```mistake
title: Unquoted use
wrong: |
  file="Q1 report.pdf"
  rm $file          # tries to remove "Q1" and "report.pdf"
right: |
  rm -- "$file"
why: Unquoted expansions are split on spaces. Quote every variable use.
```

## Practice

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  a=hello
  b="$a world"
  a=bye
  echo "$b, $a"
answer: hello world, bye
explanation: "`b` was assigned once, using the value `a` had at that moment. Changing `a` later doesn't change `b`."
```

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  v=log
  echo "$v_file ${v}_file"
answer: " log_file"
hints:
  - Which variable name does `$v_file` refer to?
explanation: "`$v_file` is a different (unset) variable, which expands to nothing, leaving a leading space. Braces fix it."
```

```exercise
kind: fill
difficulty: beginner
prompt: Append `.bak` to the value of the variable `file` (Bash).
template: file___".bak"
blanks:
  - ["+="]
explanation: "`file+=\".bak\"` appends; `file=\"${file}.bak\"` is the portable equivalent."
```

## Challenge

```exercise
kind: find-bug
difficulty: intermediate
prompt: This script prints `Deploying to production in ` — the region is missing — and an error about a command. Which line is wrong?
code: |
  #!/usr/bin/env bash
  environment=production
  region = eu-west-1
  version=$1
  echo "Deploying to $environment in $region"
answer: 3
fix: |
  region=eu-west-1
hints:
  - One assignment isn't an assignment at all.
explanation: "Line 3 runs a command called `region` with the arguments `=` and `eu-west-1` (\"region: command not found\") instead of assigning, so `$region` stays empty. Remove the spaces around `=`."
```
