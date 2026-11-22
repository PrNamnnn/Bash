---
objectives:
  - Use Bash's `[[ ]]` for safer string tests, pattern matching and regex matching
  - Use `(( ))` for integer arithmetic comparisons
  - Choose between `[ ]`, `[[ ]]` and `(( ))` deliberately
  - Combine conditions with `&&`, `||`, `!` and grouping
summary:
  - "`[[ ]]` is a Bash keyword: no word splitting or globbing inside, `&&`/`||`/`( )` work, `<`/`>` compare strings."
  - "`[[ $x == pattern ]]` does glob matching (quote the right side for a literal comparison); `[[ $x =~ regex ]]` does ERE matching with captures in `BASH_REMATCH`."
  - "`(( a > b ))` compares integers with normal operators; variables need no `$`; status is 0 when the result is non-zero."
  - "Use `[[ ]]` for strings and files, `(( ))` for numbers, and `[ ]` only in POSIX `sh` scripts."
  - "Store a regex in a variable and use it unquoted: `[[ $x =~ $re ]]`."
related:
  - if-statements
  - regular-expressions
  - file-tests
---

## [[ ]]: the Bash test

`[[ … ]]` is part of Bash's grammar (a *keyword*), not a command. That gives it advantages over `[ ]`:

| Feature | `[ ]` | `[[ ]]` |
|---|---|---|
| Unquoted empty variables | break the test | safe |
| Word splitting / globbing of variables | yes | no |
| `&&`, `\|\|`, `( )` inside | no (`-a`, `-o`) | yes |
| Pattern matching `==` | no | yes |
| Regex matching `=~` | no | yes |
| `<` / `>` string comparison | must be escaped | yes |
| Portable to POSIX sh | yes | no |

```bash title="double-brackets.sh" playground
name=""
[[ $name == "" ]] && echo "empty, no quotes needed"
file="my notes.txt"
[[ -n $file && $file == *.txt ]] && echo "a text file"
[[ apple < banana ]] && echo "apple sorts first"
```

## Pattern matching with ==

On the right side of `==` (or `!=`), an **unquoted** string is a glob pattern; a **quoted** one is literal:

```bash title="patterns.sh" playground
f="backup-2026.tar.gz"
[[ $f == *.tar.gz ]] && echo "tarball"
[[ $f == backup-*.tar.gz ]] && echo "a backup tarball"
[[ $f == "*.tar.gz" ]] || echo "quoted: compared literally"
case_insensitive=YES
shopt -s nocasematch
[[ $case_insensitive == yes ]] && echo "matched ignoring case"
```

With `shopt -s extglob`, patterns gain extra operators such as `+([0-9])` (one or more digits), `@(a|b)` (one of) and `!(*.log)` (anything except). Bash enables extglob inside `[[ ]]` automatically since 5.2. (The simulator doesn't support extglob, so try these on a real system.)

```bash
[[ $f == backup-+([0-9]).tar.gz ]] && echo "numbered backup"
```

## Regex matching with =~

`=~` matches the left side against an **extended regular expression**. Parenthesised groups are captured into the array `BASH_REMATCH`:

```bash title="regex.sh" playground
line='2026-11-10T08:06:30Z ERROR [checkout] order=1042'
re='^([0-9]{4})-([0-9]{2})-([0-9]{2})T.* (ERROR|WARN) \[([a-z]+)\]'
if [[ $line =~ $re ]]; then
  echo "date:   ${BASH_REMATCH[1]}/${BASH_REMATCH[2]}/${BASH_REMATCH[3]}"
  echo "level:  ${BASH_REMATCH[4]}"
  echo "module: ${BASH_REMATCH[5]}"
fi
version="v2.14.3"
[[ $version =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] && echo "major=${BASH_REMATCH[1]}"
```

> [!TIP] Put regexes in variables
> Quoting the right side of `=~` makes it a literal string. Spaces and special characters in a regex are easiest to manage by storing it in a variable (`re='…'`) and writing `[[ $x =~ $re ]]` unquoted.

## (( )): arithmetic conditions

For numbers, `(( ))` lets you write comparisons the way you would in C or Python. Inside, variable names don't need `$`:

```bash title="arith.sh" playground
cpu=92 threshold=80 retries=0
(( cpu > threshold )) && echo "CPU high"
(( retries == 0 )) && echo "first attempt"
if (( cpu > 90 && retries < 3 )); then echo "alert and retry"; fi
(( 0 )) || echo "(( 0 )) is false"
(( 5 - 5 )) || echo "an expression that evaluates to 0 is false too"
```

`(( expr ))` returns status 0 when the expression is **non-zero**. That's natural for comparisons, but surprising for counters: `(( count++ ))` "fails" when count was 0 — which matters under `set -e` (see the error-handling lesson).

## Which one should I use?

| Testing… | Use |
|---|---|
| numbers | `(( a > b ))` |
| strings, patterns, regexes | `[[ $a == $b ]]`, `[[ $a =~ $re ]]` |
| files | `[[ -f $f ]]` |
| in a `#!/bin/sh` script | `[ "$a" = "$b" ]`, `[ "$n" -gt 3 ]` |

## Logical operators

Inside `[[ ]]`: `&&`, `||`, `!` and parentheses for grouping. Inside `(( ))`: the same, C-style. Between commands: `&&` and `||` as in command lists.

```bash
if [[ -f $cfg && ( $env == prod || $env == staging ) ]]; then …
if (( age >= 18 && age < 65 )); then …
if ! [[ $input =~ ^[0-9]+$ ]]; then …
```

## Common mistakes

```mistake
title: Quoting the regex
wrong: |
  [[ $ip =~ "^[0-9]+\.[0-9]+" ]]    # compares literally — never matches
right: |
  re='^[0-9]+\.[0-9]+'
  [[ $ip =~ $re ]]
why: A quoted right-hand side of `=~` is treated as a literal string, not a regex.
```

```mistake
title: String comparison of numbers
wrong: |
  [[ $size > 100 ]]     # string comparison: "9" > "100" is true!
right: |
  (( size > 100 ))
  [[ $size -gt 100 ]]
why: Inside `[[ ]]`, `<` and `>` compare strings lexicographically. Use `(( ))` or `-gt` for numbers.
```

## Practice

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  f="report.final.pdf"
  [[ $f == *.pdf ]] && echo A
  [[ $f == "*.pdf" ]] && echo B
  [[ $f =~ \.final\. ]] && echo C
answer: |
  A
  C
explanation: "The unquoted pattern matches; the quoted one is literal; the regex finds `.final.`."
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  [[ 9 > 10 ]] && echo "string: 9 > 10"
  (( 9 > 10 )) || echo "number: 9 < 10"
answer: |
  string: 9 > 10
  number: 9 < 10
explanation: "As strings, \"9\" sorts after \"1\"; as numbers, 9 is smaller."
```

```exercise
kind: fill
difficulty: intermediate
prompt: Capture the major version from a string like `v3.12.1` into BASH_REMATCH[1].
template: "[[ $v =~ ___ ]] && echo ${BASH_REMATCH[1]}"
blanks:
  - ["^v([0-9]+)\\.", "^v([0-9]+)", "v([0-9]+)\\.", "^v([0-9]+)\\.[0-9]+\\.[0-9]+$"]
explanation: "A group `([0-9]+)` after the `v` captures the major version."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Parse log lines with =~
prompt: "For each line of `~/logs/app.log` that is an ERROR, print `MODULE: message` using `[[ =~ ]]` and BASH_REMATCH, where MODULE is the bracketed word and message is the text in `error=\"…\"` (lines without error=\"…\" print `MODULE: (no message)`)."
starter: |
  #!/usr/bin/env bash
  while IFS= read -r line; do
    :
  done < ~/logs/app.log
solution: |
  #!/usr/bin/env bash
  re='ERROR +\[([a-z]+)\]'
  msg_re='error="([^"]*)"'
  while IFS= read -r line; do
    if [[ $line =~ $re ]]; then
      module=${BASH_REMATCH[1]}
      if [[ $line =~ $msg_re ]]; then
        echo "$module: ${BASH_REMATCH[1]}"
      else
        echo "$module: (no message)"
      fi
    fi
  done < ~/logs/app.log
expectedOutput: |
  checkout: payment gateway timeout
  checkout: payment gateway timeout
  mailer: (no message)
checks:
  - pattern: =~
    message: Use the =~ operator.
  - pattern: BASH_REMATCH
    message: Read the captures from BASH_REMATCH.
hints:
  - Store each regex in a variable and match unquoted.
  - "BASH_REMATCH is overwritten by each match — copy the module first."
explanation: "Two regexes, two matches: copying `BASH_REMATCH[1]` into `module` before the second match is the important detail."
```
