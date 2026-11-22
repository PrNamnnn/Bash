---
objectives:
  - Iterate over lists, arguments, globs and brace ranges with `for … in`
  - Write C-style `for (( ; ; ))` loops for counters
  - Loop over files safely, including names with spaces and no matches
  - Choose the right loop source and avoid iterating over command output with word splitting
summary:
  - "`for var in LIST; do …; done` runs the body once per word of LIST; `for var; do` loops over `\"$@\"`."
  - "Sources: literal words, `\"$@\"`, globs (`*.log`), brace ranges (`{1..10}`), `\"${array[@]}\"`."
  - "`for (( i = 0; i < n; i++ ))` counts with arithmetic and works with variable bounds."
  - "Loop over globs, not `$(ls)`; quote `\"$f\"` inside; use `nullglob` or `[[ -e $f ]]` for the no-match case."
  - "To iterate over lines, use `while read`, not `for`."
related:
  - while-and-until
  - loop-control
  - globbing
---

## Iterating over a list

```bash
for VARIABLE in WORD1 WORD2 WORD3; do
  COMMANDS using "$VARIABLE"
done
```

The list undergoes the usual expansions first; the loop then runs once per resulting word.

::viz loops

```bash title="lists.sh" playground
for env in dev staging prod; do
  echo "deploying to $env"
done
for i in {1..5}; do printf '%d ' "$i"; done; echo
for f in ~/data/*.csv; do
  echo "$(basename "$f"): $(wc -l < "$f") lines"
done
```

## Common loop sources

| Source | Example | Notes |
|---|---|---|
| fixed words | `for s in web01 web02 db01` | simplest |
| arguments | `for arg in "$@"` (or just `for arg`) | keep the quotes |
| glob | `for f in *.log` | safe with any file name |
| brace range | `for i in {1..10}` | literal bounds only |
| array | `for x in "${list[@]}"` | Level 7 |
| command output | `for u in $(cut -d: -f1 /etc/passwd)` | only for single-word items without globs |

## C-style loops

When you need a counter, especially with variable bounds, use arithmetic `for`:

```bash title="cstyle.sh" playground
n=4
for (( i = 1; i <= n; i++ )); do
  echo "attempt $i of $n"
done
for (( i = 10; i > 0; i -= 3 )); do printf '%d ' "$i"; done; echo
```

The three parts — initialisation, condition, update — work like in C. Variables need no `$` inside `(( ))`.

## Looping over files safely

```bash title="files.sh" playground
cd ~/downloads
for f in *; do
  printf '[%s] ' "$f"
  [[ -f $f ]] && printf '%s bytes\n' "$(wc -c < "$f")"
done
echo ---
shopt -s nullglob
for f in *.xlsx; do echo "never printed: no .xlsx files"; done
echo "done"
```

- Use the glob directly — `for f in *` — never `for f in $(ls)`.
- Quote `"$f"` everywhere inside the loop.
- Without `nullglob`, a pattern that matches nothing runs the loop once with the literal pattern; either set `nullglob` or skip with `[[ -e $f ]] || continue`.

## Doing real work

```bash title="rename.sh" playground
cd ~/photos
for f in IMG_*.JPG; do
  new="photo-${f#IMG_}"           # strip the prefix
  new="${new%.JPG}.jpg"           # lower-case extension
  echo "mv -- '$f' '$new'"        # dry run: print the command first
done
```

Printing commands before running them (a *dry run*) is a great habit for anything that moves or deletes files.

## Common mistakes

```mistake
title: Iterating over ls or find output with for
wrong: |
  for f in $(find . -name '*.txt'); do wc -l "$f"; done
right: |
  find . -name '*.txt' -exec wc -l {} +
  # or, to do more per file:
  while IFS= read -r -d '' f; do wc -l "$f"; done < <(find . -name '*.txt' -print0)
why: Command substitution output is split on whitespace and globbed, breaking names with spaces.
```

```mistake
title: Variable range in braces
wrong: |
  for i in {1..$n}; do …    # runs once with i="{1..5}"
right: |
  for (( i = 1; i <= n; i++ )); do …
why: Brace expansion happens before variable expansion.
```

```mistake
title: Looping over lines with for
wrong: |
  for line in $(cat servers.txt); do echo "$line"; done   # one iteration per WORD
right: |
  while IFS= read -r line; do echo "$line"; done < servers.txt
why: "`for` splits on all whitespace, so `web01 10.0.1.11 running` becomes three iterations."
```

## Practice

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  for x in a "b c" d; do echo "<$x>"; done
answer: |
  <a>
  <b c>
  <d>
explanation: The quoted words stay together; the loop runs three times.
```

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  total=0
  for (( i = 1; i <= 5; i++ )); do (( total += i )); done
  echo "$total"
answer: "15"
explanation: 1 + 2 + 3 + 4 + 5 = 15.
```

```exercise
kind: command
difficulty: beginner
prompt: "Using a `for` loop over a glob, print the name (without directory) of every `.sh` file in `~/projects/scripts`, one per line."
solution: for f in ~/projects/scripts/*.sh; do echo "${f##*/}"; done
explanation: "`${f##*/}` strips the directory. `basename \"$f\"` also works."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Multiplication table
prompt: "Print a 4×4 multiplication table with each number right-aligned in 4 columns, using nested C-style loops."
starter: |
  #!/usr/bin/env bash
solution: |
  #!/usr/bin/env bash
  for (( r = 1; r <= 4; r++ )); do
    for (( c = 1; c <= 4; c++ )); do
      printf '%4d' $(( r * c ))
    done
    echo
  done
expectedOutput: |2
     1   2   3   4
     2   4   6   8
     3   6   9  12
     4   8  12  16
hints:
  - "`printf '%4d'` pads to four columns without a newline; `echo` ends each row."
explanation: "Nested loops: the outer one per row, the inner one per column."
```
