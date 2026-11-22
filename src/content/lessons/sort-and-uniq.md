---
objectives:
  - Sort text alphabetically, numerically, by human sizes and by fields
  - Remove and count duplicates with `uniq` — and know why it needs sorted input
  - Build the classic frequency table `sort | uniq -c | sort -rn | head`
  - Avoid locale and field-selection surprises
summary:
  - "`sort -n` numeric, `-r` reverse, `-u` unique, `-k2,2` by field 2, `-t,` field separator, `-h` human sizes."
  - "`uniq` only collapses adjacent duplicates, so sort first. `-c` counts, `-d` shows duplicates, `-u` unique lines."
  - "`sort | uniq -c | sort -rn | head` answers \"what are the most common X?\" for any X."
  - "Use `LC_ALL=C sort` for byte-order sorting that is fast and identical on every machine."
related:
  - cut-paste-tr
  - pipes
  - log-parsing
---

## Sorting

::command sort

### Text order vs numeric order

```bash title="numeric.sh" playground
printf '%s\n' 100 9 25 3 > /tmp/n.txt
echo "text:";    sort /tmp/n.txt | paste -sd' '
echo "numeric:"; sort -n /tmp/n.txt | paste -sd' '
echo "reverse:"; sort -rn /tmp/n.txt | paste -sd' '
```

As text, `100` comes before `25` because `1` < `2`. With `-n`, values are compared as numbers.

### Sorting by a field

Real data has columns. `-k` chooses which one to sort on and `-t` sets the separator:

```bash title="fields.sh" playground
cd ~/data
echo "== by units (field 4), highest first =="
tail -n +2 sales.csv | sort -t, -k4,4nr | head -n 3
echo "== by region, then by units =="
tail -n +2 sales.csv | sort -t, -k2,2 -k4,4n | head -n 4
```

`-k4,4nr` means "the key starts and ends at field 4, compare numerically, reversed". Writing `-k4` without the `,4` makes the key run to the end of the line — usually not what you want.

### Locale matters

The order of letters depends on your locale. In `en_US.UTF-8`, `sort` ignores case and punctuation at first, so `apple`, `Banana`, `cherry` are interleaved. In the `C` locale, it's pure byte order: all uppercase before lowercase. For predictable results in scripts (and a big speed-up on large files):

```bash
LC_ALL=C sort file.txt
```

## Removing duplicates

::command uniq

The key fact about `uniq`: it compares each line only with the **previous** one.

```bash title="adjacent.sh" playground
printf 'a\nb\na\na\n' | uniq          # a b a — the first a isn't adjacent to the others
echo ---
printf 'a\nb\na\na\n' | sort | uniq   # a b
```

## The frequency-table pattern

This four-stage pipeline is one of the most useful things you'll learn:

```bash
… | sort | uniq -c | sort -rn | head
```

1. `sort` groups identical lines together.
2. `uniq -c` collapses each group into one line with a count.
3. `sort -rn` orders by that count, highest first.
4. `head` keeps the top entries.

::viz pipes

::terminal
$ sort data/fruits.txt | uniq -c | sort -rn
$ awk '{print $1}' logs/access.log | sort | uniq -c | sort -rn | head -5
$ awk '{print $9}' logs/access.log | sort | uniq -c
$ cut -d, -f2 data/sales.csv | tail -n +2 | sort -u
::

## Common mistakes

```mistake
title: uniq on unsorted input
wrong: |
  cut -d, -f2 sales.csv | uniq -c
right: |
  cut -d, -f2 sales.csv | sort | uniq -c
why: "`uniq` only merges consecutive duplicates. Without sorting, the same value appears several times with partial counts."
```

```mistake
title: Sorting numbers as text
wrong: |
  du -s * | sort -r      # 900 sorts above 1200
right: |
  du -s * | sort -rn
  du -sh * | sort -rh    # human-readable sizes need -h
why: Without `-n` (or `-h` for sizes like 2K, 15M), sort compares characters, not values.
```

## Practice

```exercise
kind: command
difficulty: beginner
prompt: "Print the numbers in `~/data/numbers.txt` sorted from largest to smallest."
solution: sort -rn ~/data/numbers.txt
explanation: "`-n` compares numerically and `-r` reverses the order."
```

```exercise
kind: command
difficulty: beginner
prompt: "Print each distinct fruit in `~/data/fruits.txt` once, in alphabetical order."
solution: sort -u ~/data/fruits.txt
explanation: "`sort -u` sorts and removes duplicates in one step; `sort | uniq` is equivalent."
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  printf 'b\na\nb\nc\nb\na\n' | sort | uniq -c | sort -rn | head -n 1
answer: "      3 b"
hints:
  - "`uniq -c` pads counts to seven characters."
explanation: "After sorting, `b` appears three times in a row. `uniq -c` prints `      3 b` (count right-aligned in 7 columns), which `sort -rn` puts first."
```

## Challenge

```exercise
kind: command
difficulty: intermediate
title: Busiest client
prompt: "Using `~/logs/access.log`, print the 3 client IP addresses (field 1) with the most requests, as `count ip` lines, most frequent first."
solution: awk '{print $1}' ~/logs/access.log | sort | uniq -c | sort -rn | head -n 3
hints:
  - Extract the first field (with `cut -d' ' -f1` or `awk '{print $1}'`).
  - Then apply the frequency-table pattern.
explanation: "Extract → sort → count → rank → trim. `cut -d' ' -f1` works here too because the IP is followed by a single space."
```
