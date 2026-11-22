---
objectives:
  - Generate lists and sequences with brace expansion
  - Use zero-padded and stepped sequences
  - Understand exactly when `~` is expanded and what it becomes
  - Know that brace expansion happens before all other expansions
summary:
  - "`{a,b,c}` produces one word per item; `{1..10}`, `{a..z}`, `{01..12}` and `{0..100..10}` produce sequences."
  - "Brace expansion is purely textual and happens first, so `{1..$n}` does **not** work — use `seq` or a C-style loop."
  - "Braces combine with prefixes and suffixes and nest: `file{1,2}.{txt,md}` → four names."
  - "`~` becomes `$HOME`, `~user` that user's home, `~+` `$PWD` and `~-` `$OLDPWD` — only when unquoted at the start of a word (or after `=`/`:` in assignments)."
  - "Brace expansion is a Bash/ksh/zsh feature, not POSIX `sh`."
related:
  - globbing
  - expansion-order
  - creating-and-removing
---

## Brace expansion: generating words

Brace expansion turns a pattern into several words *before* anything else happens — the command never sees the braces:

```bash title="braces.sh" playground
echo file{1,2,3}.txt
echo {mon,tue,wed}day
echo {1..5}
echo {a..e}
echo {01..10}
echo {0..20..5}
echo {5..1}
echo img-{a,b}{1,2}
```

| Form | Expands to |
|---|---|
| `x{a,b,c}y` | `xay xby xcy` |
| `{1..5}` | `1 2 3 4 5` |
| `{5..1}` | `5 4 3 2 1` |
| `{01..03}` | `01 02 03` (zero-padded because an endpoint has a leading zero) |
| `{0..10..5}` | `0 5 10` (step) |
| `{a..e}` | `a b c d e` |
| `{a,b}{1,2}` | `a1 a2 b1 b2` |

## Everyday uses

```bash
mkdir -p project/{src,tests,docs}               # several directories
cp config.yml{,.bak}                            # config.yml → config.yml.bak
mv report.{txt,md}                              # rename extension
touch log-2026-{01..12}.txt                     # twelve monthly files
diff app.conf{.orig,}                           # compare with the original
for i in {1..3}; do echo "attempt $i"; done
```

`cp file{,.bak}` deserves a closer look: the first alternative is *empty*, so it expands to `cp file file.bak`.

```bash title="backup-trick.sh" playground
cd /tmp
echo "port=8080" > app.conf
cp app.conf{,.bak}
ls app.conf*
```

## What braces are not

Brace expansion happens **before** variable expansion, so variables can't be used as range endpoints:

```bash title="no-vars.sh" playground
n=3
echo {1..$n}            # prints {1..3}: braces ran before $n was replaced
seq 1 "$n" | paste -sd' '
for ((i = 1; i <= n; i++)); do printf '%d ' "$i"; done; echo
```

Also, a single item without a comma (`{a}`) or a malformed sequence is left untouched, and quoted braces are literal: `echo "{a,b}"` prints `{a,b}`.

> [!PORTABILITY] Not in POSIX sh
> Brace expansion is a Bash (and ksh/zsh) feature. In `dash` — Ubuntu's `/bin/sh` — `echo {1..3}` prints `{1..3}`. Don't use it in `#!/bin/sh` scripts.

## Tilde expansion

The tilde is expanded to a home directory when it's **unquoted** and at the **start** of a word:

| Tilde | Becomes |
|---|---|
| `~` | `$HOME` |
| `~/docs` | `$HOME/docs` |
| `~alice` | Alice's home directory, e.g. `/home/alice` |
| `~+` | the current directory (`$PWD`) |
| `~-` | the previous directory (`$OLDPWD`) |

In assignments, Bash also expands a tilde right after `=` or `:` — handy for PATH:

```bash title="tilde.sh" playground
echo ~ ~/projects
echo "~ is not expanded in quotes"
echo "$HOME is the quoted alternative"
p=~/bin:~/tools
echo "$p"
cd /tmp && cd ~ && echo ~-
```

## Common mistakes

```mistake
title: Using a variable as a range endpoint
wrong: |
  count=5
  for i in {1..$count}; do echo "$i"; done   # loops once, i="{1..5}"
right: |
  for ((i = 1; i <= count; i++)); do echo "$i"; done
why: Braces are expanded before `$count` is substituted, so Bash sees `{1..$count}` — not a valid sequence — and leaves it alone.
```

```mistake
title: Spaces inside braces
wrong: |
  mkdir {src, tests, docs}    # creates "{src," "tests," "docs}"
right: |
  mkdir {src,tests,docs}
why: Unquoted spaces split the word before brace expansion sees it, so there is no complete brace pattern left.
```

## Practice

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  echo log.{1..3}.gz
answer: log.1.gz log.2.gz log.3.gz
explanation: The sequence produces three words, each with the prefix and suffix attached.
```

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  echo {a,b}{x,y}
answer: ax ay bx by
explanation: Adjacent brace expressions combine like a cross product, left braces varying slowest.
```

```exercise
kind: command
difficulty: beginner
compare: fs
fixture: empty
prompt: "Create the empty files `chapter01.md` through `chapter05.md` in your home directory with one command."
solution: touch ~/chapter{01..05}.md
explanation: "Zero-padded endpoints give `01`…`05`. `touch` receives five file names."
```

```exercise
kind: fill
difficulty: beginner
prompt: Make a backup copy `nginx.conf.orig` of `nginx.conf` using brace expansion.
template: cp nginx.conf___
blanks:
  - ["{,.orig}"]
explanation: "`nginx.conf{,.orig}` expands to `nginx.conf nginx.conf.orig`."
```

## Challenge

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  n=2
  echo {1..$n} "{1..3}" {3..1..2} ~root
answer: "{1..2} {1..3} 3 1 /root"
hints:
  - Brace expansion runs before parameter expansion.
  - Quoted braces are literal.
explanation: "`{1..$n}` isn't a valid sequence at brace-expansion time; afterwards `$n` is replaced, giving `{1..2}`. The quoted braces stay literal, `{3..1..2}` counts down by 2, and `~root` is root's home directory."
```
