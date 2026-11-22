---
objectives:
  - Substitute text with `s///`, including flags, groups and alternative delimiters
  - Select lines with numbers, ranges and regex addresses, and negate them
  - Delete, print, insert and append lines; run several commands
  - Edit files in place safely on GNU and BSD/macOS
summary:
  - "`sed 's/old/new/'` replaces the first match per line; `g` replaces all; `I` ignores case; `&` is the whole match; `\\1` a group."
  - "Addresses pick lines: `3`, `$`, `/re/`, `10,20`, `/start/,/end/`, `1~2` (GNU); `!` negates."
  - "Commands: `d` delete, `p` print (with `-n`), `i\\`/`a\\` insert/append, `c\\` change, `q` quit, `y` transliterate."
  - "`-E` enables extended regex; `-n` suppresses automatic printing; `-e` adds scripts; `;` separates commands."
  - "In-place: GNU `sed -i 's/…/…/' f`, BSD `sed -i '' 's/…/…/' f`; portable: `sed -i.bak … && rm f.bak`."
related:
  - regular-expressions
  - awk-fundamentals
  - robust-patterns
---

## A stream editor

`sed` reads input **line by line**, applies a small editing program to each line (the *pattern space*), and prints the result. It never loads the whole file and never asks questions — perfect for automation.

::command sed

## Substitution in depth

```text
s/REGEX/REPLACEMENT/FLAGS
```

| Flag | Effect |
|---|---|
| (none) | replace the first match on each line |
| `g` | replace all matches |
| `2` | replace only the 2nd match |
| `I` | ignore case (GNU) |
| `p` | print the line if a substitution happened (with `-n`) |

In the replacement, `&` stands for the whole match and `\1`…`\9` for captured groups (GNU also offers `\U`, `\L` for case conversion):

```bash title="substitute.sh" playground
echo "one two two three" | sed 's/two/2/'
echo "one two two three" | sed 's/two/2/g'
echo "price: 42" | sed -E 's/[0-9]+/[&]/'
echo "2026-11-17" | sed -E 's/([0-9]{4})-([0-9]{2})-([0-9]{2})/\3.\2.\1/'
echo "make me loud" | sed -E 's/\w+/\u&/g'
```

### Choose your delimiter

Any character can follow `s`. When the text contains slashes, pick another one:

```bash
sed 's|/usr/local/bin|/opt/bin|g' paths.txt
sed 's#^Include /etc/old#Include /etc/new#' httpd.conf
```

## Addresses: choosing lines

Put an address before a command to apply it only to some lines:

| Address | Lines |
|---|---|
| `5` | line 5 |
| `$` | the last line |
| `/ERROR/` | lines matching the regex |
| `3,7` | lines 3 to 7 |
| `/BEGIN/,/END/` | from a matching line to the next matching line |
| `5,+2` | line 5 and the two after it (GNU) |
| `1~2` | every other line starting at 1 (GNU) |
| `addr!` | lines NOT matching addr |

```bash title="addresses.sh" playground
cd ~/data
sed -n '2,4p' config.ini                    # print a range
sed '/^#/d; /^$/d' config.ini               # drop comments and blank lines
sed -n '/\[database\]/,/^$/p' config.ini    # one INI section
sed '/^\[/!s/ = /=/' config.ini             # tidy only non-header lines
sed -n '$p' ~/logs/app.log                  # last line
```

## Other commands

| Command | Does |
|---|---|
| `d` | delete the line (and start the next cycle) |
| `p` | print the line (use with `-n`) |
| `i\ text` | insert a line before |
| `a\ text` | append a line after |
| `c\ text` | replace the line |
| `q` | print and quit (fast "head") |
| `=` | print the line number |
| `y/abc/xyz/` | transliterate characters (like tr) |

```bash title="commands.sh" playground
printf 'alpha\nbeta\ngamma\n' | sed '2i\inserted before beta'
printf 'alpha\nbeta\ngamma\n' | sed '$a\the end'
printf 'alpha\nbeta\ngamma\n' | sed '/beta/c\BETA REPLACED'
seq 1000 | sed '3q'
printf 'a\nb\n' | sed -n '='
```

## Editing files in place

`-i` rewrites the file. GNU and BSD disagree on the syntax:

| Platform | No backup | With backup |
|---|---|---|
| GNU (Linux) | `sed -i 's/a/b/' f` | `sed -i.bak 's/a/b/' f` |
| BSD (macOS) | `sed -i '' 's/a/b/' f` | `sed -i .bak 's/a/b/' f` |
| Portable | `sed -i.bak 's/a/b/' f && rm f.bak` | `sed -i.bak 's/a/b/' f` |

```bash title="inplace.sh" playground
cp ~/.config/app.conf /tmp/app.conf
sed -i 's/^log_level=.*/log_level=debug/' /tmp/app.conf
grep log_level /tmp/app.conf
```

> [!WARNING] Test before you -i
> Run the expression without `-i` first and check the output (or `diff <(sed '…' f) f`). In-place edits with a wrong regex are a common way to corrupt configuration on many servers at once.

## Common mistakes

```mistake
title: Variables in single-quoted sed scripts
wrong: |
  sed 's/PORT/$port/' template.conf       # inserts the literal text $port
right: |
  sed "s/PORT/$port/" template.conf
why: "Single quotes prevent expansion. Use double quotes — and beware: if the value contains `/`, `&` or `\\`, it breaks the command (escape it or choose a different delimiter)."
```

```mistake
title: Greedy .* eating too much
wrong: |
  echo 'key="a" other="b"' | sed 's/key=".*"/key="X"/'   # key="X"
right: |
  echo 'key="a" other="b"' | sed 's/key="[^"]*"/key="X"/'
why: "`.*` matches as much as possible, up to the last quote. `[^\"]*` stops at the first closing quote."
```

## Practice

```exercise
kind: command
difficulty: beginner
prompt: "Print `~/notes.txt` with every occurrence of `shell` replaced by `SHELL`."
solution: sed 's/shell/SHELL/g' ~/notes.txt
explanation: "The `g` flag replaces every occurrence on each line, not just the first."
```

```exercise
kind: command
difficulty: beginner
prompt: "Print only lines 2 to 3 of `~/todo.txt` using sed."
solution: sed -n '2,3p' ~/todo.txt
explanation: "`-n` turns off automatic printing; `2,3p` prints the range."
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  echo "John Smith, 42" | sed -E 's/^(\w+) (\w+), ([0-9]+)$/\2 (\3)/'
answer: Smith (42)
explanation: "Three groups capture first name, last name and age; the replacement reorders them."
```

```exercise
kind: command
difficulty: intermediate
compare: fs
prompt: "In `~/.config/app.conf`, change the line `port=8080` to `port=9090` in place."
solution: sed -i 's/^port=8080$/port=9090/' ~/.config/app.conf
explanation: "Anchoring with `^` and `$` makes sure you change exactly that setting. The checker compares the resulting file."
```

## Challenge

```exercise
kind: command
difficulty: advanced
title: Extract an INI section
prompt: "Print the key lines (not the header, not blank lines) of the `[database]` section of `~/data/config.ini`."
solution: sed -n '/^\[database\]/,/^\[/{/^\[/d;/^$/d;p}' ~/data/config.ini
hints:
  - "A range from `/^\\[database\\]/` to the next header `/^\\[/` selects the section."
  - "Inside braces `{ … }` you can apply several commands only to that range: delete headers and blanks, print the rest."
explanation: "The range selects the section; inside the block, header and blank lines are deleted and the rest printed. Because `[database]` is the last section here, the range runs to the end of the file."
```
