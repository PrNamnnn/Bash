---
objectives:
  - Explain what quoting is for and which characters the shell treats specially
  - Use single quotes, double quotes, backslashes and `$'…'` correctly
  - Predict the arguments a command receives from any quoted word
  - Adopt the rule "quote every expansion" and know its few exceptions
summary:
  - "Quoting tells the shell to treat special characters as ordinary text."
  - "Single quotes `'…'` make everything literal — no expansion at all, and no way to include a `'` inside."
  - "Double quotes `\"…\"` keep spaces and glob characters literal but still expand `$var`, `$(cmd)`, `$((…))` and backslash-escaped `$ ` \\ \"`."
  - "A backslash quotes the next single character; `$'…'` interprets escapes like `\\n` and `\\t`."
  - "Always write `\"$var\"`, `\"$@\"`, `\"$(cmd)\"` unless you deliberately want word splitting and globbing."
related:
  - anatomy-of-a-command
  - expansion-order
  - variables
---

## Why quoting exists

The shell gives special meaning to many characters before a command ever runs:

```text
space tab newline   separate words
$  `                expansions          *  ?  [ ]   filename patterns
|  &  ;  ( )  < >   operators           \  '  "     quoting itself
~  #  !  { }        tilde, comments, history, braces
```

**Quoting** switches that meaning off, so the characters reach the command as ordinary text. Getting it right is the single most important Bash skill — most real-world shell bugs and security holes are quoting bugs.

::viz quoting

## The four quoting mechanisms

### Single quotes: everything literal

Inside `'…'` nothing is special — not `$`, not `*`, not `\`. What you see is exactly what the command gets.

```bash
echo 'Total: $5 * 3 = $15; path C:\temp'
```

The one limitation: a single quote can't appear inside single quotes, even escaped. End the quoted part, add an escaped quote, and start again: `'it'\''s'` → `it's`.

### Double quotes: literal, except for expansions

Inside `"…"`, spaces, `*`, `?`, `|`, `;`, `'` and friends are literal, but `$` and backticks still work, so variables and command substitutions are expanded — as **one** word:

```bash title="double.sh" playground
file="monthly report.txt"
echo "Processing $file at $(date +%H:%M) — cost: \$5"
printf '[%s]\n' "$file"     # one argument
printf '[%s]\n' $file       # two arguments!
```

Inside double quotes, the backslash only escapes the four characters that are still special: `$`, `` ` ``, `"` and `\` (plus a newline). Elsewhere it is kept as-is.

### Backslash: quote one character

An unquoted `\` makes the next character literal: `echo \$HOME` prints `$HOME`, `touch my\ file` creates `my file`. At the end of a line, `\` joins the next line (line continuation):

```bash
docker run --rm \
  -v "$PWD:/work" \
  alpine ls /work
```

There must be **nothing** after that backslash — a trailing space breaks the continuation.

### ANSI-C quotes: $'…'

`$'…'` is like single quotes but interprets backslash escapes: `\n`, `\t`, `\e`, `\'`, `\xHH`. It's the easiest way to put a real newline or tab into a string:

```bash title="ansi-c.sh" playground
IFS=$'\n'
tab=$'\t'
printf 'a%sb\n' "$tab"
echo $'it\'s easy'
```

`$'…'` is a Bash/ksh/zsh feature (and in POSIX since 2024, but not in older `sh`).

## Comparing them

| You write | Command receives | Why |
|---|---|---|
| `echo $HOME` | `/home/learner` | expanded |
| `echo "$HOME"` | `/home/learner` | expanded, one word |
| `echo '$HOME'` | `$HOME` | single quotes: literal |
| `echo \$HOME` | `$HOME` | backslash escapes `$` |
| `echo "a   b"` | `a   b` (1 arg) | spaces kept |
| `echo a   b` | `a`, `b` (2 args) | spaces split |
| `echo "*.csv"` | `*.csv` | no globbing in quotes |
| `echo *.csv` | `sales.csv users.csv` | globbing |
| `echo "it's"` | `it's` | `'` is literal in `"…"` |
| `echo 'say "hi"'` | `say "hi"` | `"` is literal in `'…'` |

## Mixing quotes in one word

A word can be built from several quoted and unquoted pieces glued together. The shell removes the quotes and joins the pieces:

```bash title="mixed.sh" playground
name=Ada
printf '[%s]\n' 'Hello, '"$name"'! Your home is '~
printf '[%s]\n' "$name"'s files'
printf '[%s]\n' "${name}_backup"
```

Notice `"${name}_backup"`: braces mark where the variable name ends. Without them, Bash would look for a variable called `name_backup`.

## The rule: quote your expansions

When a `$var`, `$(cmd)` or `$@` is **unquoted**, Bash performs two extra steps on the result:

1. **Word splitting** — the value is split on spaces, tabs and newlines.
2. **Pathname expansion** — each piece containing `*`, `?` or `[` is treated as a glob.

This silently breaks file names with spaces and turns `*` in data into lists of files:

```bash title="unquoted.sh" playground
cd ~/data
msg="Warning: * check all files *"
echo $msg       # the asterisks become file names!
echo "$msg"
empty=""
[ -n $empty ] && echo "BUG: unquoted empty variable passed the test"
[ -n "$empty" ] || echo "quoted: correctly empty"
```

The few places where quotes are unnecessary — right side of an assignment (`x=$y`), inside `[[ … ]]` (except the right side of `==`/`=~`), `case $x in` — are safe to quote anyway. When in doubt, quote.

## Common mistakes

```mistake
title: Variables inside single quotes
wrong: |
  echo 'Hello, $USER'      # prints: Hello, $USER
right: |
  echo "Hello, $USER"
why: Single quotes disable all expansion. Use double quotes when you want variables expanded.
```

```mistake
title: Unquoted "$@" or $*
wrong: |
  for arg in $*; do echo "$arg"; done
right: |
  for arg in "$@"; do echo "$arg"; done
why: '`"$@"` expands to each original argument as a separate word, preserving spaces. Unquoted `$*` and `$@` re-split everything.'
```

```mistake
title: Quoting a glob you want expanded
wrong: |
  rm "*.tmp"        # removes a file literally named *.tmp (or fails)
right: |
  rm -- *.tmp
  rm -- "$dir"/*.tmp   # quote the variable, not the pattern
why: Quotes disable globbing. Quote the parts that are data, leave the pattern characters outside.
```

## Practice

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  x=5
  echo '$x' "$x" \$x "\$x"
answer: $x 5 $x $x
explanation: "Single quotes are literal; double quotes expand; a backslash escapes `$` both outside and inside double quotes."
```

```exercise
kind: predict
difficulty: beginner
prompt: How many lines does this print?
code: |
  f="my file.txt"
  printf '%s\n' $f
  printf '%s\n' "$f"
answer: |
  my
  file.txt
  my file.txt
explanation: "Unquoted, `$f` is split into two words; quoted, it stays one."
```

```exercise
kind: command
difficulty: beginner
prompt: |
  Use `echo` to print exactly ``It's $5 "today"`` — with the apostrophe, the dollar sign and the double quotes.
solution: echo "It's \$5 \"today\""
hints:
  - Inside double quotes, escape `$` and `"` with a backslash.
explanation: "One solution: `\"It's \\$5 \\\"today\\\"\"`. Another: `'It'\\''s $5 \"today\"'` — leave single quotes, add an escaped quote, re-enter."
```

```exercise
kind: command
difficulty: beginner
prompt: "Show the contents of the file `~/downloads/notes (copy).txt`."
solution: cat ~/downloads/"notes (copy).txt"
hints:
  - The name contains a space and parentheses, all special to the shell.
explanation: "`cat ~/downloads/\"notes (copy).txt\"` keeps the tilde unquoted (so it expands) and quotes the rest. Backslashes also work: `notes\\ \\(copy\\).txt`."
```

## Challenge

```exercise
kind: find-bug
difficulty: intermediate
prompt: This backup function breaks when a source directory has a space in its name. Which line is the bug?
code: |
  backup() {
    local src="$1"
    local name="${src##*/}"
    local dest="/backups/$name-$(date +%F).tar.gz"
    tar -czf "$dest" -C $src .
    echo "Saved $dest"
  }
answer: 5
fix: |
    tar -czf "$dest" -C "$src" .
hints:
  - Look for an expansion without double quotes.
explanation: "On line 5, `$src` is unquoted, so `/home/me/My Documents` becomes two arguments. Quote it: `-C \"$src\"`."
```
