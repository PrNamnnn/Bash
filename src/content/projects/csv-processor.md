## Problem

Every week someone exports sales data as CSV and asks for the same things: is the file valid, what were the totals per region and product, which were the biggest sales, and can I get a filtered copy? Doing this by hand in a spreadsheet takes an hour and introduces mistakes.

Build `csvtool.sh`, a small command-line CSV toolkit with subcommands for validation, filtering, aggregation and transformation.

## Requirements

- Subcommands:
  - `validate FILE` — check every row has the header's number of fields, numeric columns are numeric and dates are `YYYY-MM-DD`; report problems as `line N: reason` and exit 1 if any.
  - `filter FILE COLUMN=VALUE…` — print the header plus rows matching all conditions.
  - `sum FILE GROUP_COLUMN VALUE_EXPR` — group by a column and sum a value; `VALUE_EXPR` is a column name or `colA*colB`.
  - `top FILE N VALUE_EXPR` — the N rows with the largest value.
  - `select FILE COL1,COL2…` — output only those columns, in that order.
- Refer to columns by **header name**, not number.
- Handle CRLF line endings and a trailing newline-less last line.
- Simple CSV only (no quoted fields containing commas) — but detect quotes and warn that they aren't supported.
- Output is CSV (or aligned columns with `-t` for humans).

## Steps

### Step 1: Header lookup

Write `col_index FILE NAME` that reads the header line, splits it on commas and prints the 1-based index of NAME (or fails with `unknown column`). Every subcommand builds on this.

### Step 2: Validate

Use awk with `-F,`: compare `NF` with the header's field count, check numeric columns with a regex (`/^-?[0-9]+(\.[0-9]+)?$/`) and the date column with `/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/`. Strip `\r` first.

### Step 3: Filter and select

Translate `region=north` into an index and a value, pass them to awk with `-v`, and print matching rows. For `select`, map names to indexes and print `$i` fields joined with commas.

### Step 4: Aggregate

For `sum`, accept `units` or `units*unit_price`: split on `*`, look up both columns, and accumulate per group in an awk associative array. Print groups sorted by total, descending, with two decimals.

### Step 5: Dispatcher and pretty output

Add the `case` dispatcher, usage text and a `-t` option that pipes output through `column -t -s,` for humans.

## Hints

- Read just the header with `IFS= read -r header < "$file"` and remove `\r` with `${header%$'\r'}`.
- `IFS=, read -ra cols <<< "$header"` splits the header into an array.
- In awk, `sub(/\r$/, "")` at the start of every record normalises CRLF files.
- Pass column indexes into awk with `-v c="$idx"` and use `$c`.
- `sort -t, -k2,2nr` sorts CSV output by the second column numerically.

## Expected output

```text
$ csvtool.sh sum ~/data/sales.csv region 'units*unit_price'
region,total
west,2166.40
north,1918.40
east,1798.70
south,1565.00

$ csvtool.sh -t top ~/data/sales.csv 3 'units*unit_price'
date        region  product  units  unit_price  value
2026-10-05  north   chair    11     79.90       878.90
2026-10-08  east    chair    10     79.90       799.00
2026-10-04  west    desk     4      189.00      756.00

$ csvtool.sh validate bad.csv
line 2: units is not a number: twelve
line 3: expected 5 fields, got 2
```

## Test cases

| Case | Command | Expect |
|---|---|---|
| valid file | `validate ~/data/sales.csv` | `ok: 16 rows`, exit 0 |
| broken row | add `2026-10-09,north,lamp` | `line 18: expected 5 fields, got 3`, exit 1 |
| bad number | units `twelve` | `line N: units is not a number` |
| filter | `filter sales.csv region=north product=desk` | header + matching rows |
| unknown column | `sum sales.csv colour units` | `unknown column: colour`, exit 2 |
| CRLF | convert with `sed 's/$/\r/'` | same results as LF |
| select | `select users.csv name,email` | two columns |

## Edge cases

- Empty files, header-only files and files without a trailing newline.
- Column names with spaces, or duplicate column names.
- Quoted fields (`"Smith, John"`) — detect and refuse rather than silently mis-split.
- Very large files: everything streams through awk; nothing is loaded into Bash arrays.
- Locale-dependent decimal separators (`LC_ALL=C`).

## Solution

```bash title="csvtool.sh" playground
#!/usr/bin/env bash
# csvtool.sh — validate, filter, aggregate and reshape simple CSV files.
set -euo pipefail
export LC_ALL=C
PROG=${0##*/}
PRETTY=0

usage() {
  cat >&2 <<EOF
usage: $PROG [-t] COMMAND FILE ARGS...
  validate FILE                     check field counts, numbers and dates
  filter   FILE COL=VALUE...        rows matching all conditions
  sum      FILE GROUP_COL EXPR      total of EXPR (COL or COL*COL) per group
  top      FILE N EXPR              N rows with the largest EXPR
  select   FILE COL,COL...          only these columns
EOF
  exit 2
}
die() { echo "$PROG: $*" >&2; exit 2; }
out() { if (( PRETTY )); then column -t -s,; else cat; fi; }

header() { local h; IFS= read -r h < "$1" || true; printf '%s\n' "${h%$'\r'}"; }
col_index() {         # col_index FILE NAME
  local -a cols; local i
  IFS=, read -ra cols <<< "$(header "$1")"
  for i in "${!cols[@]}"; do [[ ${cols[i]} == "$2" ]] && { echo $((i + 1)); return 0; }; done
  die "unknown column: $2"
}
expr_cols() {         # expr_cols FILE EXPR -> "i j" (j=0 when there's no multiplication)
  local a=${2%%\**} b=0
  [[ $2 == *\** ]] && b=$(col_index "$1" "${2#*\*}")
  echo "$(col_index "$1" "$a") $b"
}

cmd_validate() {
  local file=$1 n
  n=$(header "$file" | awk -F, '{ print NF }')
  awk -F, -v n="$n" '
    { sub(/\r$/, "") }
    NR == 1 { for (i = 1; i <= NF; i++) name[i] = $i; next }
    /"/ { printf "line %d: quoted fields are not supported\n", NR; bad++; next }
    NF != n { printf "line %d: expected %d fields, got %d\n", NR, n, NF; bad++; next }
    {
      for (i = 1; i <= NF; i++) {
        if (name[i] ~ /^(units|unit_price|price|amount|qty|id)$/ && $i !~ /^-?[0-9]+(\.[0-9]+)?$/) { printf "line %d: %s is not a number: %s\n", NR, name[i], $i; bad++ }
        if (name[i] == "date" && $i !~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]$/) { printf "line %d: bad date: %s\n", NR, $i; bad++ }
      }
      rows++
    }
    END { if (bad) exit 1; printf "ok: %d rows\n", rows }' "$file"
}

cmd_filter() {
  local file=$1; shift
  local conds="" c
  for c in "$@"; do
    [[ $c == *=* ]] || die "condition must be COL=VALUE: $c"
    conds+="$(col_index "$file" "${c%%=*}")=${c#*=};"
  done
  awk -F, -v conds="$conds" '
    BEGIN { n = split(conds, parts, ";"); for (i = 1; i < n; i++) { split(parts[i], kv, "="); col[i] = kv[1]; val[i] = kv[2] }; m = n - 1 }
    { sub(/\r$/, "") }
    NR == 1 { print; next }
    { for (i = 1; i <= m; i++) if ($col[i] != val[i]) next; print }' "$file" | out
}

cmd_sum() {
  local file=$1 group=$2 expr=$3 g a b
  g=$(col_index "$file" "$group"); read -r a b <<< "$(expr_cols "$file" "$expr")"
  { echo "$group,total"
    awk -F, -v g="$g" -v a="$a" -v b="$b" '
      { sub(/\r$/, "") } NR > 1 { t[$g] += (b ? $a * $b : $a) }
      END { for (k in t) printf "%s,%.2f\n", k, t[k] }' "$file" | sort -t, -k2,2nr
  } | out
}

cmd_top() {
  local file=$1 n=$2 expr=$3 a b
  [[ $n =~ ^[1-9][0-9]*$ ]] || die "N must be a positive integer"
  read -r a b <<< "$(expr_cols "$file" "$expr")"
  { echo "$(header "$file"),value"
    awk -F, -v a="$a" -v b="$b" '{ sub(/\r$/, "") } NR > 1 { printf "%s,%.2f\n", $0, (b ? $a * $b : $a) }' "$file" |
      sort -t, -k"$(( $(header "$file" | awk -F, '{print NF}') + 1 ))",999nr | head -n "$n"
  } | out
}

cmd_select() {
  local file=$1 list=$2 idx="" c
  IFS=, read -ra wanted <<< "$list"
  for c in "${wanted[@]}"; do idx+="$(col_index "$file" "$c") "; done
  awk -F, -v idx="$idx" 'BEGIN { n = split(idx, ix, " ") } { sub(/\r$/, ""); line = ""; for (i = 1; i <= n; i++) line = line (i > 1 ? "," : "") $ix[i]; print line }' "$file" | out
}

main() {
  PRETTY=0
  [[ ${1:-} == -t ]] && { PRETTY=1; shift; }
  local cmd=${1:-}; shift || usage
  [[ -n ${1:-} && -r $1 ]] || { [[ -n $cmd ]] && die "cannot read file: ${1:-}"; usage; }
  case $cmd in
    validate) cmd_validate "$1" ;;
    filter)   (( $# >= 2 )) || usage; cmd_filter "$@" ;;
    sum)      (( $# == 3 )) || usage; cmd_sum "$@" ;;
    top)      (( $# == 3 )) || usage; cmd_top "$@" ;;
    select)   (( $# == 2 )) || usage; cmd_select "$@" ;;
    *) usage ;;
  esac
}

# Playground demo (real use: main "$@")
cd ~/data
main validate sales.csv
main sum sales.csv region 'units*unit_price'
main -t top sales.csv 3 'units*unit_price'
main filter sales.csv region=north product=desk
main -t select users.csv name,role,active
printf 'date,region,product,units,unit_price\n2026-10-01,north,lamp,twelve,24.50\n2026-10-02,east\n' > /tmp/bad.csv
main validate /tmp/bad.csv || echo "(validation failed: status $?)"
```

## Explanation

- **Names, not numbers:** `col_index` maps header names to field numbers once, so commands read naturally (`sum region units*unit_price`) and survive column reordering.
- **awk does the heavy lifting:** each command is one streaming awk pass, so a million-row file is processed in seconds and memory stays flat. Bash only parses arguments and wires the pipeline.
- **Values enter awk through `-v`**, never by splicing shell strings into the awk program — so a filter value like `x"; system("rm …")` is just data.
- **CRLF tolerance:** `sub(/\r$/, "")` on every record (and `${h%$'\r'}` for the header) makes Windows exports behave like Unix files.
- **Validation reports every problem**, not just the first, with line numbers you can jump to; quoted fields are detected and refused instead of being mis-split.
- **Output stays CSV** so commands compose (`csvtool filter … > north.csv`); `-t` formats for humans with `column`.

## Extensions

- Real CSV parsing with quoted fields using GNU awk's `FPAT='([^,]*)|("[^"]+")'`, or delegate to `mlr` / `csvkit` and compare.
- Add `avg`, `min`, `max` and `count` aggregations, and multiple group columns.
- Join two CSV files on a key column (like SQL `JOIN`) with `join` or awk.
- Output JSON lines for loading into other tools.
- Add a schema file (`column:type`) so validation isn't based on hard-coded column names.
