---
objectives:
  - Explain awk's record/field model and the `pattern { action }` structure
  - Select and print fields, change separators with `-F`, `FS` and `OFS`
  - Filter records with comparisons and regexes, and use `NR`, `NF`, `$NF`
  - Run code before and after the input with `BEGIN` and `END`, and pass shell values with `-v`
summary:
  - "awk reads input record by record (lines), splits each into fields `$1…$NF` (`$0` is the whole line)."
  - "A program is a list of `pattern { action }` rules; a missing pattern matches every line, a missing action prints the line."
  - "`-F,` or `FS=\",\"` sets the input separator; `OFS` the output separator; `NR` is the record number, `NF` the field count."
  - "`BEGIN { }` runs before input, `END { }` after — the place for headers and totals."
  - "Always single-quote awk programs; pass shell values with `-v name=\"$value\"`."
related:
  - awk-programs
  - cut-paste-tr
  - log-parsing
---

## awk's model

`awk` (named after its authors Aho, Weinberger and Kernighan) is a small programming language built around one idea: **text is a sequence of records, and each record is a sequence of fields.**

By default a record is a line and fields are separated by runs of whitespace:

```text
192.168.1.22 - - [10/Nov/2026:08:06:30 +0000] "POST /api/checkout HTTP/1.1" 500 89 …
$1           $2 $3 $4                    $5     $6     $7            $8        $9  $10
```

::command awk

## Program structure

An awk program is a list of rules:

```text
pattern { action }
pattern { action }
```

For each input line, awk tests every rule's pattern; when it matches, the action runs.

| Rule | Meaning |
|---|---|
| `{ print $1 }` | no pattern: run for every line |
| `/ERROR/` | no action: print matching lines (like grep) |
| `$9 == 500 { print $7 }` | both |
| `NR > 1` | skip the first line (a header) |
| `BEGIN { … }` | before reading input |
| `END { … }` | after all input |

```bash title="rules.sh" playground
cd ~/logs
awk '{ print $1 }' access.log | head -3
echo ---
awk '$9 >= 500 { print $4, $7, $9 }' access.log
echo ---
awk '/kube-probe/ { n++ } END { print n, "health checks" }' access.log
```

## Fields and separators

| Variable | Meaning |
|---|---|
| `$0` | the whole record |
| `$1 … $NF` | fields; `$NF` is the last, `$(NF-1)` the one before |
| `NF` | number of fields in this record |
| `NR` | number of records read so far (line number) |
| `FS` | input field separator (default: runs of blanks) |
| `OFS` | output field separator used by `print a, b` (default: space) |

```bash title="separators.sh" playground
awk -F: '{ print $1, $NF }' /etc/passwd | head -3
awk -F, 'NR > 1 { print $2 " -> " $4 }' ~/data/sales.csv | head -3
awk -F, -v OFS='\t' 'NR > 1 { print $1, $3, $4 }' ~/data/sales.csv | head -3
awk '{ print NR ": " NF " fields" }' ~/data/servers.txt
```

`print a, b` uses `OFS` between items; `print a b` concatenates without a separator. `printf` gives full control: `printf "%-10s %5d\n", $1, $2`.

## Comparisons and regexes

Patterns can be any expression:

```bash title="patterns.sh" playground
cd ~/data
awk -F, '$4 > 10' sales.csv                       # numeric comparison
awk -F, '$2 == "north" && $3 == "lamp"' sales.csv # string equality
awk -F, '$2 ~ /^(east|west)$/' sales.csv | head -3  # regex match on a field
awk '$3 !~ /running/ { print $1 " is " $3 }' servers.txt
```

awk compares as numbers when both sides look numeric, otherwise as strings. Regex literals use ERE syntax (`+`, `?`, `|`, `( )` work unescaped).

## BEGIN and END

```bash title="begin-end.sh" playground
awk -F, '
  BEGIN { print "region   units" }
  NR > 1 { printf "%-8s %5d\n", $2, $4; total += $4 }
  END   { print "total    " total }
' ~/data/sales.csv | head -5
awk 'END { print NR }' ~/logs/access.log
```

Variables need no declaration: an unset variable is `""` as a string and `0` as a number, so `total += $4` just works.

## Getting shell values into awk

The program is in single quotes, so shell variables don't expand inside it — and that's good. Pass values explicitly with `-v`:

```bash title="vars.sh" playground
threshold=15
awk -F, -v min="$threshold" 'NR > 1 && $4 >= min { print $1, $2, $4 }' ~/data/sales.csv
```

## Common mistakes

```mistake
title: Double-quoting the program
wrong: |
  awk "{ print $1 }" file      # the SHELL replaces $1 (probably with nothing)
right: |
  awk '{ print $1 }' file
why: In double quotes the shell expands `$1` before awk starts, so awk receives `{ print  }` and prints every whole line.
```

```mistake
title: Splicing shell variables into the program
wrong: |
  awk '$2 == "'$region'" { print }' sales.csv
right: |
  awk -v r="$region" '$2 == r' sales.csv
why: Gluing quotes together is fragile and breaks (or becomes injectable) when the value contains quotes or spaces. `-v` passes the value as data.
```

## Practice

```exercise
kind: command
difficulty: beginner
prompt: "Print the second field (the IP address) of every line in `~/data/servers.txt`."
solution: awk '{ print $2 }' ~/data/servers.txt
explanation: "Default whitespace splitting makes `$2` the IP column."
```

```exercise
kind: command
difficulty: beginner
prompt: "Print the names (field 1) of servers in `~/data/servers.txt` whose status (field 3) is not `running`."
solution: awk '$3 != "running" { print $1 }' ~/data/servers.txt
explanation: "A comparison pattern selects lines; the action prints the name."
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  printf 'a b c\nd e\n' | awk '{ print NR, NF, $NF }'
answer: |
  1 3 c
  2 2 e
explanation: "`NR` is the line number, `NF` the field count and `$NF` the last field."
```

```exercise
kind: command
difficulty: intermediate
prompt: "Print the total number of units (field 4) sold in `~/data/sales.csv`, skipping the header."
solution: awk -F, 'NR > 1 { sum += $4 } END { print sum }' ~/data/sales.csv
explanation: "Accumulate in a variable, print it in `END`. The answer is 133."
```

## Challenge

```exercise
kind: command
difficulty: intermediate
title: Revenue per line
prompt: "For each data row of `~/data/sales.csv`, print the date and the revenue (units × unit_price) with two decimals, as `2026-10-01 294.00`."
solution: awk -F, 'NR > 1 { printf "%s %.2f\n", $1, $4 * $5 }' ~/data/sales.csv
hints:
  - "`printf` with `%.2f` formats a number with two decimals."
explanation: "awk converts the fields to numbers for multiplication; `printf \"%s %.2f\\n\"` formats each row."
```
