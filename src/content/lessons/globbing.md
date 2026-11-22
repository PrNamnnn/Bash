---
objectives:
  - Match file names with `*`, `?` and `[…]` patterns
  - Use character classes like `[[:digit:]]` and negated sets `[!…]`
  - Predict what happens when a pattern matches nothing, and control it with `nullglob` and `failglob`
  - Match hidden files and whole trees with `dotglob` and `globstar`
summary:
  - "`*` matches any string (including empty), `?` exactly one character, `[abc]`/`[a-z]`/`[[:digit:]]` one character from a set, `[!x]` anything but x."
  - "Globs match file names in the shell before the command runs; quoted globs are literal."
  - "Globs don't match names starting with `.` unless the pattern starts with `.` or `dotglob` is on; `*` never matches `/`."
  - "With no match, the pattern is left as-is; `shopt -s nullglob` makes it vanish, `failglob` makes it an error."
  - "`shopt -s globstar` enables `**` to match across directory levels."
related:
  - brace-and-tilde-expansion
  - expansion-order
  - case-statements
---

## Patterns for file names

**Globbing** (pathname expansion) lets you name many files at once with a pattern. The shell expands the pattern into the sorted list of matching names *before* running the command:

```bash title="basic-globs.sh" playground
cd ~/data
echo *.csv
echo *.t?t
echo [nu]*
echo *[0-9]*
cd ~/photos && echo IMG_000?.JPG
```

| Pattern | Matches |
|---|---|
| `*` | any string, including the empty string |
| `?` | exactly one character |
| `[abc]` | one of a, b, c |
| `[a-z]` | one character in the range |
| `[!abc]` or `[^abc]` | one character **not** in the set |
| `[[:digit:]]`, `[[:alpha:]]`, `[[:upper:]]`, `[[:space:]]` | POSIX character classes |

Globs are anchored: `*.txt` must match the **whole** name — it doesn't find `notes.txt.bak`.

::terminal
$ ls ~/photos/*.{JPG,PNG}
$ ls ~/photos/[[:upper:]]*
$ ls ~/logs/archive/access.log.[0-9]
$ echo ~/data/[!a-m]*
$ echo ~/*/
::

The last one shows a useful trick: a pattern ending in `/` matches only directories.

## Rules that surprise people

### Hidden files

`*` doesn't match names beginning with `.`. You must write the dot explicitly (`.*`) or enable `dotglob`:

```bash title="hidden.sh" playground
cd ~
echo *
echo .[!.]*
shopt -s dotglob
echo * | tr ' ' '\n' | head -n 4
```

### No match

By default, a pattern that matches nothing is passed to the command **unchanged** — so commands see a literal `*.log`:

```bash title="nomatch.sh" playground
cd /tmp
for f in *.nothing; do echo "processing: $f"; done     # runs once with the pattern!
shopt -s nullglob
for f in *.nothing; do echo "processing: $f"; done     # runs zero times
```

| Option | No match means… |
|---|---|
| default | the pattern itself is kept |
| `shopt -s nullglob` | the word disappears |
| `shopt -s failglob` | the command fails with "no match" |

In scripts that loop over globs, either set `nullglob` or test `[[ -e $f ]]` inside the loop.

> [!WARNING] nullglob and commands
> With `nullglob`, `ls *.log` runs plain `ls` when there are no logs — listing everything. Enable it for loops, not globally in interactive shells.

### `*` never crosses `/`

`*` matches within one directory level. `*/*.sh` looks exactly one level down. To search all levels, use `find` or enable `globstar`:

```bash title="globstar.sh" playground
cd ~
shopt -s globstar
printf '%s\n' **/*.sh
```

## Globs vs regular expressions

Globs look similar to regular expressions but are a different language:

| Meaning | Glob | Regex |
|---|---|---|
| any string | `*` | `.*` |
| one character | `?` | `.` |
| one of a set | `[abc]` | `[abc]` |
| literal dot | `.` | `\.` |

Globs are used by the shell for file names, `case` patterns and `[[ $x == pattern ]]`. Regexes are used by `grep`, `sed`, `awk` and `[[ $x =~ regex ]]`.

## Common mistakes

```mistake
title: Quoting a glob
wrong: |
  rm "*.tmp"
right: |
  rm -- *.tmp
why: Quotes make `*` literal, so rm looks for a file actually named `*.tmp`.
```

```mistake
title: Forgetting the unmatched case in loops
wrong: |
  for f in /var/backups/*.tar.gz; do
    gzip -t "$f"     # fails on a file literally named "*.tar.gz"
  done
right: |
  shopt -s nullglob
  for f in /var/backups/*.tar.gz; do
    gzip -t "$f"
  done
why: With no matching files the loop body runs once with the unexpanded pattern.
```

## Practice

```exercise
kind: predict
difficulty: beginner
prompt: In `~/photos` (files `IMG_0001.JPG`, `IMG_0002.JPG`, `IMG_0003.JPG`, `holiday 2025.png`, `screenshot.PNG`), what does this print?
code: |
  cd ~/photos
  echo *.PNG IMG_000[13].JPG
answer: screenshot.PNG IMG_0001.JPG IMG_0003.JPG
explanation: "Globs are case-sensitive, so `*.PNG` doesn't match `holiday 2025.png`. `[13]` matches the character 1 or 3."
```

```exercise
kind: command
difficulty: beginner
prompt: "List (with `ls`) all files in `~/data` whose names end in `.txt` and start with a letter from `n` to `s`."
solution: ls ~/data/[n-s]*.txt
explanation: "`[n-s]` matches one character in that range; `*.txt` the rest of the name. Result: `new.txt numbers.txt old.txt servers.txt`."
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  cd /tmp
  for f in *.csv; do echo "got: $f"; done
  shopt -s nullglob
  for f in *.csv; do echo "got: $f"; done
  echo end
answer: |
  got: *.csv
  end
explanation: "/tmp has no CSV files. Without nullglob the loop runs once with the literal pattern; with nullglob it doesn't run at all."
```

## Challenge

```exercise
kind: command
difficulty: intermediate
title: Every script in the tree
prompt: "Using `globstar` (no `find`), print the path of every `.sh` file under `~/projects`, one per line."
solution: shopt -s globstar; printf '%s\n' ~/projects/**/*.sh
hints:
  - "`shopt -s globstar` enables `**`."
  - "`printf '%s\\n'` prints one argument per line."
explanation: "`**/` matches zero or more directory levels once globstar is on. `printf '%s\\n' …` turns the expanded list into lines."
```
