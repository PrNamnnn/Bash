---
objectives:
  - Read user input with prompts, defaults, timeouts and hidden typing
  - Explain why `read -r` and `IFS=` matter and use them correctly
  - Split lines into fields with a custom IFS or into arrays with `read -a`
  - Process files and command output line by line without losing the last line
summary:
  - "`read -r var` reads one line into var; without `-r` backslashes are eaten."
  - "`IFS= read -r line` preserves leading/trailing whitespace exactly."
  - "With several names, read splits on IFS and the last name receives the rest of the line."
  - "`-p` prompt, `-s` silent, `-t` timeout, `-n N` N characters, `-a arr` into an array, `-d ''` until NUL."
  - "`read` returns non-zero at end of input — but the last, unterminated line is still assigned; use `|| [[ -n $line ]]`."
related:
  - positional-parameters
  - while-and-until
  - here-documents
---

## Reading a line

`read` is a builtin that reads one line from standard input and stores it in variables:

```bash
read -r -p "Project name: " project
echo "Creating $project..."
```

In this course's playground and checker, stdin comes from the **standard input** box or a here-string, because the simulator can't pause for your keyboard. On a real terminal, `read` waits for you to type a line and press Enter.

```bash title="read.sh" playground
read -r name
read -r city country
echo "Hello $name from $city ($country)"
```

Set the standard input of this example to two lines, e.g. `Ada` and `London United Kingdom`, and run it. Notice that `country` receives *everything* after the first word on the second line: the last variable gets the remainder.

## Always use -r

Without `-r`, `read` treats backslashes as escape characters and removes them; a backslash at the end of a line even joins the next line. That silently corrupts Windows paths, regexes and any data containing `\`:

```bash title="minus-r.sh" playground
read path <<< 'C:\new\table'
echo "without -r: $path"
read -r path <<< 'C:\new\table'
echo "with -r:    $path"
```

## IFS and whitespace

`read` splits the line using `IFS` and strips leading and trailing IFS whitespace. To keep a line **exactly** as it is, empty IFS for that one command:

```bash title="ifs.sh" playground
line='   indented   text   '
read -r v <<< "$line";        echo "[$v]"
IFS= read -r v <<< "$line";   echo "[$v]"
IFS=: read -r user _ uid gid _ home shell <<< "learner:x:1000:1000:Learner:/home/learner:/bin/bash"
echo "user=$user uid=$uid home=$home shell=$shell"
```

`IFS=: read …` sets IFS only for that `read`; `_` is a conventional throwaway variable for fields you don't need.

## Useful options

| Option | Effect |
|---|---|
| `-p "Prompt: "` | show a prompt (on stderr, only for terminals) |
| `-s` | silent — don't echo typed characters (passwords) |
| `-t SECS` | time out; status > 128 on timeout |
| `-n N` | return after N characters (single-key menus) |
| `-a ARR` | split into an indexed array |
| `-d DELIM` | read up to DELIM instead of newline; `-d ''` reads up to a NUL |
| `-u FD` | read from file descriptor FD |
| `-e` | use readline editing (interactive) |

```bash
read -r -s -p "Password: " pw; echo        # newline after hidden input
read -r -t 10 -p "Continue? [y/N] " answer || answer=n
read -r -n 1 -p "Press any key..." _
read -r -a words <<< "the quick brown fox"; echo "${#words[@]} words"
```

## Reading files and command output line by line

The standard, robust loop:

```bash title="loop.sh" playground
while IFS= read -r line; do
  printf '>> %s\n' "$line"
done < ~/todo.txt
```

- `IFS=` keeps whitespace; `-r` keeps backslashes.
- `< file` at the end feeds the loop and keeps it in the current shell (unlike `cat file | while …`).
- For command output, use process substitution: `done < <(find … -print)`.

### The missing last line

If the input's final line has no trailing newline, `read` assigns it but returns failure, so the loop body never runs for it. Add a second test:

```bash title="last-line.sh" playground
printf 'first\nsecond\nno-newline' > /tmp/f.txt
echo "--- naive:"
while IFS= read -r l; do echo "$l"; done < /tmp/f.txt
echo "--- robust:"
while IFS= read -r l || [[ -n $l ]]; do echo "$l"; done < /tmp/f.txt
```

## Validating what you read

User input is untrusted. Validate it before use — the next lesson covers this in detail:

```bash title="validate.sh" playground
read -r age <<< "4x2"
if [[ $age =~ ^[0-9]+$ ]]; then
  echo "age: $age"
else
  echo "error: '$age' is not a number" >&2
fi
```

## Common mistakes

```mistake
title: Piping into read
wrong: |
  echo "ada 36" | read -r name age
  echo "$name is $age"        # empty: read ran in a subshell
right: |
  read -r name age <<< "ada 36"
  echo "$name is $age"
why: Each part of a pipeline runs in a subshell, so variables assigned there are lost. Use a here string or redirection.
```

```mistake
title: Reading lines with for
wrong: |
  for line in $(cat hosts.txt); do ssh "$line" uptime; done   # splits on spaces too
right: |
  while IFS= read -r line; do ssh -n "$line" uptime; done < hosts.txt
why: "`for` iterates over words, not lines. (Also note `ssh -n`: otherwise ssh would read the rest of hosts.txt from stdin!)"
```

## Practice

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  read -r a b c <<< "one two three four"
  echo "$c"
answer: three four
explanation: The last variable receives the rest of the line.
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  IFS=, read -r x y <<< "1,2,3"
  echo "x=$x y=$y"
answer: x=1 y=2,3
explanation: "With IFS set to a comma, `y` gets the remainder, including the second comma."
```

```exercise
kind: script
difficulty: intermediate
title: Sum from stdin
prompt: "Read numbers from standard input, one per line (the last line may lack a newline), and print their sum. Standard input is `5`, `10`, `27`."
stdin: "5\n10\n27"
starter: |
  #!/usr/bin/env bash
  sum=0
  # read lines from stdin here
  echo "$sum"
solution: |
  #!/usr/bin/env bash
  sum=0
  while IFS= read -r n || [[ -n $n ]]; do
    (( sum += n ))
  done
  echo "$sum"
expectedOutput: "42"
checks:
  - pattern: read -r
    message: Use read -r to read lines.
hints:
  - "A `while IFS= read -r n` loop reads stdin line by line."
  - The last line has no newline — add `|| [[ -n $n ]]`.
explanation: "Without the `|| [[ -n $n ]]` guard, 27 would be skipped and the sum would be 15."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Parse key=value input
prompt: "Standard input contains `key=value` lines (some with spaces around `=`, plus a comment line starting with `#`). Print `KEY -> value` for each setting, keys in upper case, skipping comments and blank lines."
stdin: "# settings\nhost = db.internal\n\nport=5432\nuser = app"
starter: |
  #!/usr/bin/env bash
solution: |
  #!/usr/bin/env bash
  while IFS='=' read -r key value || [[ -n $key ]]; do
    key=${key// /}
    value=${value# }
    [[ -z $key || $key == \#* ]] && continue
    echo "${key^^} -> $value"
  done
expectedOutput: |
  HOST -> db.internal
  PORT -> 5432
  USER -> app
hints:
  - "`IFS='=' read -r key value` splits at the first `=`."
  - "Strip spaces with `${key// /}` and `${value# }`; skip comments with `[[ $key == \\#* ]]`."
  - "`${key^^}` upper-cases a value (Bash 4+)."
explanation: "Splitting on `=` with IFS, trimming with parameter expansion, and skipping comments with a pattern test gives a tiny, dependency-free config parser."
```
