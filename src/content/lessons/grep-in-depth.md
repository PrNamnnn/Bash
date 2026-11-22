---
objectives:
  - Choose between `grep`, `grep -E`, `grep -F` and `grep -P` deliberately
  - Extract data with `-o`, show context with `-A/-B/-C` and limit matches with `-m`
  - Use backreferences and (with PCRE) lookarounds
  - Search many patterns at once and search code trees efficiently
summary:
  - "`-E` extended regex, `-F` fixed strings (fastest, no metacharacters), `-P` Perl regex (GNU only)."
  - "`-o` prints only matches; combine with `sort | uniq -c` for frequency tables."
  - "`-A N`, `-B N`, `-C N` show context lines; `-m N` stops after N matches."
  - "`-e PAT` repeats for several patterns; `-f file` reads patterns from a file; `-w`/`-x` match words/lines."
  - "Lookarounds such as `(?<=user=)\\w+` extract values without their labels (PCRE)."
related:
  - grep-basics
  - regular-expressions
  - log-parsing
---

## Choosing the matcher

| Flag | Pattern language | When to use |
|---|---|---|
| (none) | Basic RE | simple searches, portable |
| `-E` | Extended RE | anything with `+ ? \| ( ) {}` — your default |
| `-F` | fixed strings | literal text containing `.`, `*`, `[`; large pattern lists; speed |
| `-P` | Perl-compatible | `\d`, lazy quantifiers, lookarounds (GNU grep only) |

```bash title="matchers.sh" playground
cd ~/logs
grep -c '10.0.0.5' access.log      # . matches any char (works here by luck)
grep -cF '10.0.0.5' access.log     # literal — the right tool
grep -E 'WARN|ERROR' app.log | wc -l
grep -P 'duration_ms=\d{4,}' app.log | cut -c1-60
```

## Extracting data with -o

`-o` prints each match on its own line instead of whole lines — the basis of many data-extraction pipelines:

```bash title="extract.sh" playground
cd ~/logs
grep -oE '"(GET|POST) [^ ]+' access.log | sort | uniq -c | sort -rn | head -5
grep -oE '\[[a-z]+\]' app.log | sort | uniq -c
```

### Lookarounds (PCRE)

A *lookbehind* `(?<=…)` or *lookahead* `(?=…)` requires context to be present without including it in the match. Perfect for pulling values out of `key=value` text:

```bash title="lookaround.sh" playground
grep -oP '(?<=user=)\w+' ~/logs/app.log | sort -u
grep -oP '(?<=amount=)[0-9.]+' ~/logs/app.log
grep -oP '\w+(?==ok)' ~/logs/app.log
```

`\K` is another PCRE trick: everything matched before it is dropped from the output, e.g. `grep -oP 'user=\K\w+'`.

> [!PORTABILITY] -P is GNU-only
> macOS/BSD grep has no `-P`. For portable scripts, use `grep -oE 'user=[a-z]+' | cut -d= -f2`, or `sed -n 's/.*user=\([a-z]*\).*/\1/p'`.

## Context and limits

When you find an error in a log, the lines around it usually explain it:

```bash title="context.sh" playground
cd ~/logs
grep -n -A1 'ERROR \[checkout\]' app.log      # the line after each match
echo ======
grep -m 1 -B2 'ERROR' app.log                 # first error with two lines before
```

Groups of context are separated by `--` lines. `-m N` stops after N matching lines — useful on huge files.

## Many patterns

```bash
grep -e 'timeout' -e 'refused' app.log                 # either pattern
grep -E 'timeout|refused' app.log                      # same with ERE
grep -vFf known-ips.txt access.log                     # exclude any listed IP
grep -wFf blocklist.txt emails.txt                     # whole-word list matching
```

`-f FILE` reads one pattern per line; with `-F` it's very fast even for thousands of patterns.

## Searching code trees

```bash
grep -rnE --include='*.sh' 'set -e(uo)?' .             # only shell scripts
grep -rIl --exclude-dir={.git,node_modules} 'TODO' .   # -I skips binary files
grep -rn -w 'deploy' --color=always . | less -R        # coloured, paged
```

## Backreferences

A backreference `\N` matches the same text that group N matched:

```bash title="backref.sh" playground
printf 'the the cat\na a b\nno dupes\n' | grep -E '\b([a-z]+) \1\b'
printf 'abba\nabcd\nxyyx\n' | grep -E '^(.)(.)\2\1$'
```

## Common mistakes

```mistake
title: Counting matches with -c
wrong: |
  grep -c 'error' app.log        # counts LINES containing error
right: |
  grep -o 'error' app.log | wc -l   # counts every occurrence
why: A line with three matches counts once with `-c`.
```

```mistake
title: grep -P in portable scripts
wrong: |
  #!/bin/sh
  ver=$(grep -oP '(?<=version=)\S+' app.conf)
right: |
  #!/bin/sh
  ver=$(sed -n 's/^version=//p' app.conf)
why: "`-P` only exists in GNU grep. On macOS, Alpine (BusyBox) and BSD the script fails."
```

## Practice

```exercise
kind: command
difficulty: intermediate
prompt: "From `~/logs/app.log`, print just the **values** of `user=` (e.g. `alice`), unique and sorted, using a PCRE lookbehind."
solution: grep -oP '(?<=user=)\w+' ~/logs/app.log | sort -u
explanation: "The lookbehind requires `user=` before the match without including it."
```

```exercise
kind: command
difficulty: intermediate
prompt: "Show each `ERROR` line in `~/logs/app.log` together with the **one line that follows it**."
solution: grep -A1 ERROR ~/logs/app.log
explanation: "`-A1` adds one line of trailing context; groups are separated by `--`."
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  printf 'a.b\naxb\n' | grep -c 'a.b'
  printf 'a.b\naxb\n' | grep -cF 'a.b'
answer: |
  2
  1
explanation: "In a regex `.` matches `x` too; `-F` treats the dot literally."
```

## Challenge

```exercise
kind: command
difficulty: advanced
title: Request methods
prompt: "Count the HTTP methods used in `~/logs/access.log` (the word right after the opening quote, e.g. GET, POST). Print `uniq -c` style counts, most frequent first."
solution: grep -oE '"[A-Z]+ ' ~/logs/access.log | tr -d '" ' | sort | uniq -c | sort -rn
hints:
  - "The method follows a double quote: `\"GET `."
  - Strip the quote and space with `tr -d`, or use `grep -oP '(?<=\")[A-Z]+(?= )'`.
explanation: "Extract `\"GET ` tokens, delete the quote and space, then count. The PCRE version `grep -oP '(?<=\")[A-Z]+(?= )'` avoids the cleanup step."
```
