---
objectives:
  - Aggregate data by key with associative arrays (group-by, counts, sums, max)
  - Use control flow, string functions and user-defined functions in awk
  - Produce formatted reports and sort them correctly
  - Process CSV safely and recognise when awk is the wrong tool
summary:
  - "`count[$key]++` and `sum[$key] += $n` are awk's group-by; iterate with `for (k in arr)` (order is unspecified — pipe to `sort`)."
  - "awk has `if/else`, `while`, `for`, `next`, `exit`, and functions like `length`, `substr`, `split`, `sub`, `gsub`, `match`, `tolower`, `sprintf`."
  - "`printf` builds aligned reports; `END` is where summaries are printed."
  - "Simple CSV works with `-F,`; quoted fields containing commas need a real CSV parser (or gawk's `FPAT`)."
  - "Multi-line programs belong in a file: `awk -f report.awk data.csv`."
related:
  - awk-fundamentals
  - associative-arrays
  - while-and-until
---

## Associative arrays: group-by in one line

awk arrays are indexed by **strings**, so they're dictionaries. That makes grouping trivial:

```bash title="groupby.sh" playground
cd ~/data
echo "== units per region =="
awk -F, 'NR > 1 { units[$2] += $4 } END { for (r in units) print r, units[r] }' sales.csv | sort
echo "== orders per product =="
awk -F, 'NR > 1 { n[$3]++ } END { for (p in n) print n[p], p }' sales.csv | sort -rn
echo "== best day per region =="
awk -F, 'NR > 1 && $4 > best[$2] { best[$2] = $4; day[$2] = $1 }
         END { for (r in best) print r, day[r], best[r] }' sales.csv | sort
```

> [!NOTE] Iteration order
> `for (k in arr)` visits keys in an unspecified order (hash order in most awks). Always sort the output, either with `sort` afterwards or gawk's `PROCINFO["sorted_in"]`.

Useful array operations:

| Code | Meaning |
|---|---|
| `arr[k] = v` | set |
| `(k in arr)` | test membership without creating `k` |
| `delete arr[k]` / `delete arr` | remove one / all |
| `n = split(s, arr, ",")` | split a string into arr[1..n] |
| `arr[a, b]` | multi-dimensional key (joined with `SUBSEP`) |

## Control flow

awk's syntax is C-like:

```bash title="control.sh" playground
awk -F, '
  NR == 1 { next }                         # skip header
  {
    revenue = $4 * $5
    if (revenue > 400)      size = "large"
    else if (revenue > 150) size = "medium"
    else                    size = "small"
    tally[size]++
  }
  END { for (s in tally) printf "%-7s %d\n", s, tally[s] }
' ~/data/sales.csv | sort
```

`next` skips to the next record; `exit` stops reading input (the `END` block still runs).

## String functions

| Function | Does |
|---|---|
| `length(s)` | length of s (or of `$0`) |
| `substr(s, i, n)` | n characters from position i (1-based) |
| `index(s, t)` | position of t in s (0 if absent) |
| `split(s, a, sep)` | split into array a, returns count |
| `sub(re, repl, s)` / `gsub(…)` | replace first / all matches in s (default `$0`) |
| `match(s, re)` | sets `RSTART`, `RLENGTH` |
| `tolower(s)`, `toupper(s)` | case conversion |
| `sprintf(fmt, …)` | format to a string |

```bash title="strings.sh" playground
awk '{
  match($0, /duration_ms=[0-9]+/)
  if (RSTART) {
    ms = substr($0, RSTART + 12, RLENGTH - 12)
    split($1, t, "T")
    printf "%s %6.2fs %s\n", substr(t[2], 1, 8), ms / 1000, $3
  }
}' ~/logs/app.log
```

## User-defined functions and script files

Long programs are easier to maintain in a file:

```bash title="report.sh" playground
cat > /tmp/report.awk <<'EOF'
function money(x) { return sprintf("%10.2f", x) }
BEGIN { FS = "," }
NR > 1 {
  rev[$2] += $4 * $5
  total   += $4 * $5
}
END {
  for (r in rev) printf "%-8s %s\n", r, money(rev[r])
  printf "%-8s %s\n", "TOTAL", money(total)
}
EOF
awk -f /tmp/report.awk ~/data/sales.csv | sort -k2 -n
```

## CSV: where awk stops being enough

`-F,` splits on every comma. A field like `"Smith, John"` breaks it. Options:

- Data you control: avoid commas in fields or use TSV.
- GNU awk: `FPAT = "([^,]*)|(\"[^\"]+\")"` describes fields by content.
- Anything serious: a CSV-aware tool (`mlr` Miller, `csvkit`, Python's `csv` module).

## Common mistakes

```mistake
title: Expecting sorted output from for-in
wrong: |
  awk '{ c[$1]++ } END { for (k in c) print k, c[k] }' access.log   # random order
right: |
  awk '{ c[$1]++ } END { for (k in c) print c[k], k }' access.log | sort -rn
why: Array iteration order is undefined. Sort explicitly.
```

```mistake
title: Testing membership creates the key
wrong: |
  if (seen[$1] == "") print "new"   # referencing seen[$1] creates it
right: |
  if (!($1 in seen)) print "new"
  seen[$1] = 1
why: Merely referencing `arr[k]` creates an empty element. `(k in arr)` checks without side effects.
```

## Practice

```exercise
kind: command
difficulty: intermediate
prompt: "Count requests per HTTP status code (field 9) in `~/logs/access.log`; print `code count`, sorted by code."
solution: awk '{ c[$9]++ } END { for (k in c) print k, c[k] }' ~/logs/access.log | sort
explanation: "Group by `$9`, print in END, sort for stable order."
```

```exercise
kind: command
difficulty: intermediate
prompt: "Print each IP from `~/logs/access.log` only the **first** time it appears (keep the original order) — the classic awk de-duplication idiom."
solution: awk '!seen[$1]++ { print $1 }' ~/logs/access.log
hints:
  - "`seen[$1]++` is 0 (false) the first time; negating it makes the pattern true once per key."
explanation: "`!seen[$1]++` is true only for the first occurrence of each key, so you get order-preserving uniqueness without sorting."
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  echo "a,b;c,d" | awk '{ n = split($0, parts, /[,;]/); print n, parts[3] }'
answer: 4 c
explanation: "`split` with a regex separator produces four parts; the third is `c`."
```

## Challenge

```exercise
kind: script
difficulty: advanced
title: Region report
prompt: "Write an awk-based script that prints revenue per region from `~/data/sales.csv` with two decimals, sorted by revenue descending, formatted as `%-6s %8.2f`."
starter: |
  #!/usr/bin/env bash
  # revenue = units * unit_price, grouped by region (field 2)
solution: |
  #!/usr/bin/env bash
  # revenue = units * unit_price, grouped by region (field 2)
  awk -F, 'NR > 1 { rev[$2] += $4 * $5 }
           END { for (r in rev) printf "%-6s %8.2f\n", r, rev[r] }' ~/data/sales.csv |
    sort -k2 -rn
expectedOutput: |
  west    2166.40
  north   1918.40
  east    1798.70
  south   1565.00
checks:
  - pattern: awk
    message: Use awk to aggregate.
hints:
  - "`rev[$2] += $4 * $5` accumulates per region."
  - "Sort numerically on the second column, descending: `sort -k2 -rn`."
explanation: "Aggregate in awk, format with printf, sort the result. Keeping sorting outside awk is portable across awk versions."
```
