---
objectives:
  - Supply defaults and enforce required values with `:-`, `:=`, `:?` and `:+`
  - Strip prefixes and suffixes with `#`, `##`, `%`, `%%`
  - Replace text, change case, measure length and take substrings
  - Replace many small `sed`/`basename`/`cut` calls with fast built-in expansions
summary:
  - "Defaults: `${v:-def}` use default, `${v:=def}` assign default, `${v:?msg}` fail if unset/empty, `${v:+alt}` alternate if set."
  - "Trim: `${v#pat}` shortest prefix, `${v##pat}` longest prefix, `${v%pat}` shortest suffix, `${v%%pat}` longest suffix."
  - "Replace: `${v/old/new}` first, `${v//old/new}` all, `${v/#old/new}` at start, `${v/%old/new}` at end."
  - "Case: `${v^^}` upper, `${v,,}` lower, `${v^}` capitalise. Length: `${#v}`. Substring: `${v:offset:length}`."
  - "Without the colon (`${v-def}`), only *unset* triggers the default; with it, *empty* does too."
related:
  - variables
  - globbing
  - indexed-arrays
---

## Defaults and required values

| Expansion | If `v` is unset or empty | Otherwise |
|---|---|---|
| `${v:-word}` | expands to word | `$v` |
| `${v:=word}` | assigns word to v, then expands to it | `$v` |
| `${v:?message}` | prints message to stderr and exits (non-interactive) | `$v` |
| `${v:+word}` | nothing | word |

```bash title="defaults.sh" playground
unset name; empty=""
echo "hello, ${name:-stranger}"
echo "empty with colon:    [${empty:-default}]"
echo "empty without colon: [${empty-default}]"
: "${port:=8080}"                    # assign a default once
echo "port is $port"
tags="a b"
echo "flags: ${tags:+--tags \"$tags\"}"
( : "${API_KEY:?API_KEY must be set}" ) 2>&1
```

The `: "${var:=default}"` idiom (the `:` command does nothing) is the classic way to give a script's settings overridable defaults:

```bash
: "${LOG_DIR:=/var/log/myapp}"     # environment can override
: "${RETRIES:=3}"
```

## Removing prefixes and suffixes

`#` removes from the **front**, `%` from the **back**. Doubling makes the match **greedy** (longest). The patterns are globs.

```bash title="trimming.sh" playground
path=/var/log/nginx/access.log.gz
echo "${path##*/}"      # basename: access.log.gz
echo "${path%/*}"       # dirname:  /var/log/nginx
echo "${path%.*}"       # drop last extension: /var/log/nginx/access.log
echo "${path%%.*}"      # drop all extensions: /var/log/nginx/access
file=${path##*/}
echo "${file#*.}"       # all extensions: log.gz
echo "${file##*.}"      # last extension: gz
```

Memory aid: on a US keyboard `#` is left of `$` (front) and `%` is right of it (back).

## Search and replace

```bash title="replace.sh" playground
s="the cat sat on the mat"
echo "${s/at/og}"        # first match
echo "${s//at/og}"       # all matches
echo "${s/#the/a}"       # only at the start
echo "${s/%mat/rug}"     # only at the end
echo "${s// /_}"         # spaces to underscores
echo "${s//[aeiou]/}"    # delete vowels (glob class)
```

## Case, length and substrings

```bash title="case-length.sh" playground
name="ada lovelace"
echo "${name^}"          # Ada lovelace
echo "${name^^}"         # ADA LOVELACE
up="SHOUTING"; echo "${up,,}"
echo "length: ${#name}"
echo "${name:4}"         # from offset 4: lovelace
echo "${name:0:3}"       # 3 chars from 0: ada
echo "${name: -4}"       # last 4 (note the space): lace
```

## On arrays

Most expansions apply to every element when used with `[@]`:

```bash title="array-ops.sh" playground
files=(report.txt data.csv notes.txt)
echo "${files[@]%.txt}"            # strip .txt from each
echo "${files[@]/#/backup/}"       # prefix each
echo "${files[@]^^}"
```

## Performance

Each `$(basename "$f")` or `$(echo "$s" | sed …)` starts a new process. In a loop over thousands of files, that's thousands of processes; parameter expansion does the same work inside Bash, often 100× faster.

| External | Built-in |
|---|---|
| `$(basename "$p")` | `${p##*/}` |
| `$(dirname "$p")` | `${p%/*}` |
| `$(echo "$s" \| tr a-z A-Z)` | `${s^^}` |
| `$(echo "$s" \| sed 's/x/y/g')` | `${s//x/y}` |
| `$(echo "$s" \| wc -c)` | `${#s}` |

(`${p%/*}` differs from `dirname` for paths without a slash or with a trailing slash — handle those cases if they can occur.)

## Portability

POSIX `sh` supports the defaults (`:-` `:=` `:?` `:+`), trimming (`# ## % %%`) and length (`${#v}`). Replacement, case conversion and substrings are Bash (and ksh/zsh) extensions. Case conversion needs Bash 4.

## Common mistakes

```mistake
title: Mixing up # and %
wrong: |
  file=photo.jpg
  echo "${file#.jpg}"     # photo.jpg — # trims from the front
right: |
  echo "${file%.jpg}"     # photo
why: "`#` matches at the start, `%` at the end."
```

```mistake
title: Negative offset without a space
wrong: |
  echo "${name:-4}"      # this is the :- default operator!
right: |
  echo "${name: -4}"
  echo "${name:(-4)}"
why: "`:-` is parsed as the default-value operator; a space or parentheses make it an offset."
```

## Practice

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  f=archive.tar.gz
  echo "${f%.*} ${f%%.*} ${f#*.} ${f##*.}"
answer: archive.tar archive tar.gz gz
explanation: "Single = shortest match, double = longest; % from the end, # from the start."
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  unset a; b=""; c=x
  echo "[${a:-1}] [${b:-2}] [${b-3}] [${c:+4}] [${a:+5}]"
answer: "[1] [2] [] [4] []"
explanation: "b is set but empty: `:-` treats it as missing, `-` doesn't. `:+` gives the alternate only when set and non-empty."
```

```exercise
kind: fill
difficulty: beginner
prompt: "Replace every `-` in `$date` (e.g. `2026-11-17`) with `/`."
template: echo "___"
blanks:
  - ["${date//-//}", "${date//-/\\/}"]
explanation: "`//` replaces all occurrences; the replacement here is a single slash."
```

```exercise
kind: command
difficulty: intermediate
prompt: "Set `p=/home/learner/data/sales.csv` and print just `sales` (no directory, no extension) using two parameter expansions."
solution: p=/home/learner/data/sales.csv; f=${p##*/}; echo "${f%.*}"
explanation: "`##*/` strips the directory, `%.*` the extension."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Rename plan
prompt: "For each file in `~/photos`, print the planned new name: lower-case, spaces replaced by `-`, and a `.JPG`/`.PNG` style extension lower-cased. Print `OLD -> NEW` only for files whose name would change. Use parameter expansion only (no sed/tr)."
starter: |
  #!/usr/bin/env bash
  for f in ~/photos/*; do
    :
  done
solution: |
  #!/usr/bin/env bash
  for f in ~/photos/*; do
    old=${f##*/}
    new=${old,,}
    new=${new// /-}
    [[ $new != "$old" ]] && echo "$old -> $new"
  done
expectedOutput: |
  IMG_0001.JPG -> img_0001.jpg
  IMG_0002.JPG -> img_0002.jpg
  IMG_0003.JPG -> img_0003.jpg
  holiday 2025.png -> holiday-2025.png
  screenshot.PNG -> screenshot.png
checks:
  - pattern: sed|\btr\b
    forbid: true
    message: Use parameter expansion instead of sed or tr.
hints:
  - "`${old,,}` lower-cases the whole name, extension included."
  - "`${new// /-}` replaces every space."
explanation: "Three expansions per file — no extra processes at all."
```
