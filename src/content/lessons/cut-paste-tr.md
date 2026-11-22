---
objectives:
  - Extract fields and character ranges with `cut`
  - Merge lines side by side and join lists with `paste`
  - Translate, delete and squeeze characters with `tr`
  - Know when to switch to awk because cut is too simple
summary:
  - "`cut -d, -f2,4` picks fields from delimited text; `cut -c1-10` picks characters. The delimiter is a single character."
  - "`paste -d, a b` joins files line by line; `paste -sd,` turns a list into one comma-separated line."
  - "`tr` works on characters: `tr a-z A-Z`, `tr -d '\\r'`, `tr -s ' '`. It only reads stdin."
  - "If fields are separated by runs of spaces, use `awk '{print $2}'` instead of cut."
related:
  - sort-and-uniq
  - awk-fundamentals
  - sed-stream-editing
---

## Cutting columns

::command cut

### cut vs whitespace

`cut` treats **every** delimiter character as a field boundary. With text aligned by multiple spaces, fields shift:

```bash title="cut-spaces.sh" playground
printf 'web01   running\ndb01    stopped\n' > /tmp/s.txt
echo "cut sees:"; cut -d' ' -f2 /tmp/s.txt     # empty fields!
echo "awk sees:"; awk '{print $2}' /tmp/s.txt   # runs of spaces = one separator
echo "or squeeze first:"; tr -s ' ' < /tmp/s.txt | cut -d' ' -f2
```

Use `cut` for files with a single-character delimiter (CSV without quotes, `/etc/passwd`, TSV) and `awk` for whitespace-aligned text.

## Pasting columns together

::command paste

```bash title="paste.sh" playground
cd /tmp
printf '%s\n' web01 web02 db01 > hosts.txt
printf '%s\n' 10.0.1.11 10.0.1.12 10.0.2.20 > ips.txt
paste -d' ' hosts.txt ips.txt
paste -sd, hosts.txt
seq 5 | paste -sd+
```

## Translating characters

::command tr

`tr` maps characters one-to-one; `SET2` is padded with its last character if shorter. Character classes like `[:upper:]`, `[:digit:]` and `[:space:]` work in `tr` too.

```bash title="tr.sh" playground
echo "Hello, World 2026" | tr '[:upper:]' '[:lower:]'
echo "Hello, World 2026" | tr -d '[:digit:]'
echo "a,b;;c" | tr ',;' '\n\n' | grep -v '^$'
echo "too    many     spaces" | tr -s ' '
echo "path/to/file" | tr / _
```

::terminal
$ cut -d: -f1,7 /etc/passwd
$ cut -d, -f2,3 data/users.csv
$ cut -c1-19 logs/app.log | head -3
$ paste -sd, data/fruits.txt
$ tr ',' '\t' < data/sales.csv | head -3
$ echo 'hello world' | tr a-z A-Z
::

## Common mistakes

```mistake
title: Passing a file name to tr
wrong: |
  tr a-z A-Z notes.txt   # tr: extra operand 'notes.txt'
right: |
  tr a-z A-Z < notes.txt
why: "`tr` reads only standard input. Use input redirection or a pipe."
```

```mistake
title: Using tr to replace words
wrong: |
  echo "cat hat" | tr cat dog   # "dog hdg" — characters, not words!
right: |
  echo "cat hat" | sed 's/cat/dog/g'
why: "`tr cat dog` maps c→d, a→o, t→g everywhere. Use sed for strings."
```

## Practice

```exercise
kind: command
difficulty: beginner
prompt: "Print the `email` column (the 3rd field) of `~/data/users.csv`, without the header line."
solution: cut -d, -f3 ~/data/users.csv | tail -n +2
explanation: "`cut -d, -f3` selects the third comma-separated field; `tail -n +2` drops the header."
```

```exercise
kind: command
difficulty: beginner
prompt: "Print the contents of `~/notes.txt` in UPPER CASE."
solution: tr a-z A-Z < ~/notes.txt
hints:
  - tr only reads standard input.
explanation: "`tr 'a-z' 'A-Z' < file` or `tr '[:lower:]' '[:upper:]'` — the class version also works in other locales."
```

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  echo "2026-11-17" | cut -d- -f2,3
answer: 11-17
explanation: "Fields 2 and 3 are printed, joined by the same delimiter `-`."
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  printf 'a\nb\nc\n' | paste -sd'|'
answer: a|b|c
explanation: "`paste -s` joins all lines into one, using `|` as the separator."
```

## Challenge

```exercise
kind: command
difficulty: intermediate
title: Active developers
prompt: "From `~/data/users.csv`, print the names (field 2) of users whose role is `developer` and whose `active` field is `yes`, one per line."
solution: grep ',developer,yes$' ~/data/users.csv | cut -d, -f2
hints:
  - The role and active fields are the last two columns.
  - "Filter rows with grep (anchor with `$`), then cut the name column."
explanation: "`grep ',developer,yes$'` matches only rows ending with those two values; `cut -d, -f2` extracts the name. For anything more complex — compare numbers, handle quotes — reach for awk."
```
