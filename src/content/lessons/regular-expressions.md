---
objectives:
  - Read and write regular expressions with anchors, classes, quantifiers and groups
  - Know the differences between POSIX BRE, ERE and PCRE, and which tools use which
  - Use POSIX character classes and escape special characters correctly
  - Test regexes incrementally on real data
summary:
  - "Anchors: `^` start, `$` end, `\\b` / `\\<` `\\>` word boundaries. Any char: `.`. Sets: `[abc]`, `[^abc]`, `[[:digit:]]`."
  - "Quantifiers: `*` 0+, `+` 1+, `?` 0–1, `{n,m}` n to m. In **BRE** (`grep`, `sed`) write `\\+ \\? \\{n\\}` and `\\( \\)`; in **ERE** (`grep -E`, `sed -E`, `awk`) they work unescaped."
  - "Groups `( )` combine and capture; `|` alternates; `\\1` refers back to group 1."
  - "PCRE (`grep -P`) adds `\\d`, lazy quantifiers and lookarounds — GNU grep only, not on macOS."
  - "Regexes aren't globs: `.*` means any string, `*` alone means \"repeat the previous item\"."
related:
  - grep-in-depth
  - sed-stream-editing
  - globbing
---

## What a regular expression is

A **regular expression** (regex) is a pattern that describes a set of strings. Tools like `grep`, `sed`, `awk` and Bash's `[[ =~ ]]` use them to find, validate and transform text. You've already met the shell's *glob* patterns — regexes are a different, more powerful language.

```text
^[0-9]{4}-[0-9]{2}-[0-9]{2}$     a date like 2026-11-17
^[a-z_][a-z0-9_-]*$              a valid Linux user name
\b[0-9]{1,3}(\.[0-9]{1,3}){3}\b  something that looks like an IPv4 address
```

## The building blocks

| Element | Matches | Example | Matches in "log-2026.txt" |
|---|---|---|---|
| `a` | the literal character | `log` | `log` |
| `.` | any one character | `l.g` | `log` |
| `[abc]` | one of the set | `[0-9]` | `2` |
| `[^abc]` | one char **not** in the set | `[^a-z-]` | `2` |
| `^` | start of line | `^log` | yes |
| `$` | end of line | `txt$` | yes |
| `*` | 0 or more of the previous item | `20*` | `20` |
| `+` | 1 or more (ERE) | `[0-9]+` | `2026` |
| `?` | 0 or 1 (ERE) | `logs?` | `log` |
| `{n,m}` | n to m times (ERE) | `[0-9]{4}` | `2026` |
| `( )` | group (ERE) | `(ab)+` | |
| `a\|b` | alternation (ERE) | `txt\|md` | `txt` |
| `\` | escape a special char | `\.txt` | `.txt` |

### POSIX character classes

Inside brackets you can use named classes, which also work correctly with non-English letters:

| Class | Meaning |
|---|---|
| `[[:digit:]]` | 0–9 |
| `[[:alpha:]]` / `[[:alnum:]]` | letters / letters and digits |
| `[[:upper:]]` / `[[:lower:]]` | upper / lower case |
| `[[:space:]]` | space, tab, newline… |
| `[[:punct:]]` | punctuation |

Note the double brackets: the class `[:digit:]` goes *inside* a bracket expression.

## Three dialects

The same idea comes in three syntaxes. This is the most common source of "my regex doesn't work":

| Feature | **BRE** (basic) | **ERE** (extended) | **PCRE** (Perl) |
|---|---|---|---|
| Used by | `grep`, `sed` | `grep -E`, `sed -E`, `awk`, `[[ =~ ]]` | `grep -P`, Perl, Python, JS |
| one or more | `\+` (GNU) | `+` | `+` |
| optional | `\?` (GNU) | `?` | `?` |
| repeat | `\{2,3\}` | `{2,3}` | `{2,3}` |
| group | `\( \)` | `( )` | `( )` |
| alternation | `\|` (GNU) | `\|` | `\|` |
| digit shorthand | `[0-9]` | `[0-9]` | `\d` |
| lazy `*?`, lookaround | — | — | yes |

**Rule of thumb:** use ERE (`grep -E`, `sed -E`). It's readable and portable. Use PCRE only when you need lookarounds or `\d`, and know that macOS grep lacks `-P`.

```bash title="dialects.sh" playground
s="error error warning"
echo "$s" | grep -o 'error\+' | head -1        # BRE: \+ needed
echo "$s" | grep -oE '(error )+'               # ERE: groups and + unescaped
echo "2026-11-17" | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
echo "2026-11-17" | grep -P '^\d{4}-\d{2}-\d{2}$'
```

## Greedy matching

Quantifiers are **greedy**: they match as much as possible while still letting the whole pattern succeed:

```bash title="greedy.sh" playground
line='<b>bold</b> and <i>italic</i>'
echo "$line" | grep -oE '<.*>'          # one match: the whole line!
echo "$line" | grep -oE '<[^>]*>'       # each tag
echo "$line" | grep -oP '<.*?>'         # PCRE lazy quantifier
```

The trick `[^>]*` — "any characters except the closing one" — works in every dialect.

## Groups and backreferences

Parentheses group items so a quantifier applies to all of them, and they **capture** the matched text, which you can reuse with `\1`, `\2`… in the pattern (backreference) or in a replacement (sed):

```bash title="groups.sh" playground
printf 'hello hello world\nno repeat here\n' | grep -E '\b(\w+) \1\b'   # doubled words
echo "Lovelace, Ada" | sed -E 's/^(.*), (.*)$/\2 \1/'
```

## Building a regex step by step

Never write a big regex in one go. Start loose, test on real data, tighten:

```bash title="steps.sh" playground
log=~/logs/app.log
grep -oE 'duration_ms=[0-9]+' "$log"                       # 1. find the field
grep -oE 'duration_ms=[0-9]{4,}' "$log"                    # 2. only 4+ digits (≥ 1s)
grep -E 'ERROR .*duration_ms=[0-9]{4,}' "$log" | wc -l     # 3. slow errors only
```

## Common mistakes

```mistake
title: Treating a regex like a glob
wrong: |
  grep '*.log' files.txt      # * at the start means a literal * in BRE
right: |
  grep '\.log$' files.txt
why: "In a regex, `*` repeats the previous item and `.` is any character. \"Ends in .log\" is `\\.log$`."
```

```mistake
title: ERE syntax in BRE tools
wrong: |
  grep '[0-9]+' data.txt        # matches a digit followed by a literal +
right: |
  grep -E '[0-9]+' data.txt
  grep '[0-9]\+' data.txt       # GNU BRE extension
why: In basic regular expressions `+`, `?`, `{`, `(`, `|` are literal unless escaped.
```

## Practice

```exercise
kind: mcq
difficulty: beginner
prompt: Which ERE matches a line consisting **only** of digits (at least one)?
options:
  - "`[0-9]*`"
  - "`^[0-9]+$`"
  - "`[0-9]+`"
  - "`^[0-9]*`"
answer: 1
explanation: "Anchors make the whole line match. `[0-9]+` alone also matches lines that merely *contain* a digit; `*` allows empty lines."
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  printf 'cat\ncart\ncoat\nct\n' | grep -E '^ca?r?t$'
answer: |
  cat
  cart
  ct
explanation: "`a?` and `r?` are both optional, so `ct`, `cat`, `crt`, `cart` match; `coat` has an `o`."
```

```exercise
kind: command
difficulty: intermediate
prompt: "Extract every `order=NNNN` token from `~/logs/app.log` (only the matching text, one per line)."
solution: grep -oE 'order=[0-9]+' ~/logs/app.log
explanation: "`-o` prints only the matched part; `[0-9]+` requires at least one digit."
```

```exercise
kind: fill
difficulty: intermediate
prompt: Complete the ERE so it matches a time like `08:06:30` (two digits, colon, two digits, colon, two digits).
template: grep -E '___' logs/app.log
blanks:
  - ["[0-9]{2}:[0-9]{2}:[0-9]{2}", "([0-9]{2}:){2}[0-9]{2}", "[[:digit:]]{2}:[[:digit:]]{2}:[[:digit:]]{2}"]
explanation: "`[0-9]{2}:[0-9]{2}:[0-9]{2}` — or with a group: `([0-9]{2}:){2}[0-9]{2}`."
```

## Challenge

```exercise
kind: command
difficulty: advanced
title: Validate addresses
prompt: "Print the email addresses from `~/data/users.csv` that end in `.com` — only the address, one per line. Use a single `grep -oE`."
solution: grep -oE '[a-z]+@[a-z]+\.com\b' ~/data/users.csv
hints:
  - "Local part and domain are lower-case letters here: `[a-z]+@[a-z]+`."
  - "Escape the dot before `com`, and make sure `.com` isn't followed by more letters."
explanation: "`[a-z]+@[a-z]+\\.com\\b` finds `alice@example.com` etc. but not `dan@example.org`. Real-world email validation is notoriously hard — for scripts, a simple sanity check like this is usually enough."
```
