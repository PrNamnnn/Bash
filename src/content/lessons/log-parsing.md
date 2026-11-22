---
objectives:
  - Understand the structure of common log formats (combined access logs, key=value app logs)
  - Answer operational questions with pipelines: top clients, error rates, slow requests, time windows
  - Process rotated and compressed logs across many files
  - Turn ad-hoc pipelines into a reusable report script
summary:
  - "Know your format first: in the combined log format, `$1` is the client, `$4` the time, `$7` the path, `$9` the status, `$10` the bytes."
  - "Filter → extract → aggregate → sort → trim is the shape of almost every log query."
  - "Use awk for numeric conditions and aggregation, grep for fast pre-filtering, sort/uniq for frequency tables."
  - "`zcat`/`zgrep` read `.gz` files; `cat access.log.2 access.log.1 access.log` processes rotated logs in order."
  - "Save useful pipelines as scripts with parameters, headers and sensible defaults."
related:
  - awk-programs
  - grep-in-depth
  - sort-and-uniq
---

## Know the format

Before analysing a log, look at a few lines and name the fields. The sandbox's web server uses the **combined log format** (the default for nginx and Apache):

```text
192.168.1.22 - - [10/Nov/2026:08:06:30 +0000] "POST /api/checkout HTTP/1.1" 500 89 "https://shop.example.com/cart" "Mozilla/5.0 …"
```

| awk field | Content |
|---|---|
| `$1` | client IP |
| `$4` | `[day/month/year:hh:mm:ss` |
| `$6` | `"METHOD` (with the quote) |
| `$7` | request path |
| `$9` | HTTP status |
| `$10` | response size in bytes |

Quoted fields with spaces (user agent, referrer) break whitespace splitting further right, so stick to fields 1–10 or split on `"` with `-F'"'`.

The application log uses **key=value** pairs after a timestamp and level:

```text
2026-11-10T08:06:30Z ERROR [checkout] user=alice order=1042 error="payment gateway timeout" duration_ms=30012
```

## The shape of a log query

Almost every question becomes the same pipeline:

```text
filter      →  extract   →  aggregate        →  sort      →  trim
grep / awk     awk / cut     sort|uniq -c / awk  sort -rn     head
```

## Questions and answers

```bash title="questions.sh" playground
log=~/logs/access.log

echo "## Requests, unique clients"
wc -l < "$log"
awk '{ print $1 }' "$log" | sort -u | wc -l

echo "## Status code distribution"
awk '{ print $9 }' "$log" | sort | uniq -c | sort -rn

echo "## Error rate (5xx)"
awk '{ total++ } $9 >= 500 { err++ } END { printf "%.1f%%\n", 100 * err / total }' "$log"

echo "## Most requested paths, excluding health checks"
awk '$7 != "/health" { print $7 }' "$log" | sort | uniq -c | sort -rn | head -3

echo "## Suspicious scanners (many 404s)"
awk '$9 == 404 { print $1 }' "$log" | sort | uniq -c | awk '$1 >= 3'
```

### Time windows

Timestamps in field 4 can be filtered as text because they're fixed-width — compare the `hh:mm` part:

```bash title="window.sh" playground
log=~/logs/access.log
# requests between 08:15 and 08:25
awk '{ t = substr($4, 14, 5) } t >= "08:15" && t < "08:25"' "$log" | wc -l
# requests per 10-minute bucket
awk '{ print substr($4, 14, 4) "0" }' "$log" | sort | uniq -c
```

### Key=value logs

```bash title="kv.sh" playground
log=~/logs/app.log
echo "## errors by module"
awk '$2 == "ERROR" { print $3 }' "$log" | sort | uniq -c
echo "## slow operations (>= 1s)"
grep -oE '\[[a-z]+\].*duration_ms=[0-9]+' "$log" \
  | awk -F'duration_ms=' '$2 >= 1000 { print $2 "ms", $1 }' | cut -c1-60
echo "## revenue from paid orders"
grep -o 'amount=[0-9.]*' "$log" | cut -d= -f2 | paste -sd+ | awk '{ print "sum of " $0 }'
awk -F'amount=' 'NF > 1 { s += $2 } END { printf "%.2f\n", s }' "$log"
```

## Many files, rotated and compressed

Logs are usually rotated: `access.log`, `access.log.1`, `access.log.2.gz`… Process them oldest first:

```bash title="multi.sh" playground
cd ~/logs
cat archive/access.log.2 archive/access.log.1 access.log | wc -l
grep -c ' 404 ' archive/access.log.* access.log         # per-file counts
awk '{ print FILENAME }' archive/* access.log | uniq -c # awk knows the file name
```

On real systems add compressed files with `zcat` (or `zgrep` directly):

```bash
{ zcat access.log.*.gz; cat access.log.1 access.log; } | awk '$9 >= 500' | wc -l
zgrep -h ' 500 ' access.log*.gz | awk '{ print $7 }' | sort | uniq -c
```

## From pipeline to tool

Once a query proves useful, turn it into a small script with arguments and defaults:

```bash title="top-paths.sh" playground
#!/usr/bin/env bash
# Usage: top-paths.sh [LOG] [N]
log=${1:-$HOME/logs/access.log}
n=${2:-5}
[[ -r $log ]] || { echo "cannot read $log" >&2; exit 1; }
printf '%6s  %s\n' COUNT PATH
awk '$7 != "/health" { print $7 }' "$log" | sort | uniq -c | sort -rn | head -n "$n" |
  awk '{ printf "%6d  %s\n", $1, $2 }'
```

Project 4 (*Log analyzer*) builds a complete report tool from these pieces.

## Common mistakes

```mistake
title: Counting status codes with grep
wrong: |
  grep -c 500 access.log        # also matches sizes, timestamps, paths…
right: |
  awk '$9 == 500' access.log | wc -l
why: The number 500 can appear anywhere in a line. Compare the specific field.
```

```mistake
title: Forgetting rotated files
wrong: |
  grep -c ERROR /var/log/app.log      # only since the last rotation
right: |
  zgrep -c ERROR /var/log/app.log*    # current and rotated, compressed or not
why: Rotation moves older entries into numbered and gzipped files; a question about "yesterday" may need several of them.
```

## Practice

```exercise
kind: command
difficulty: intermediate
prompt: "List the distinct request paths (field 7) that returned status 404 in `~/logs/access.log`, sorted."
solution: awk '$9 == 404 { print $7 }' ~/logs/access.log | sort -u
explanation: "Filter on the status field, extract the path, deduplicate."
```

```exercise
kind: command
difficulty: intermediate
prompt: "Print the total number of bytes sent (field 10) for all requests in `~/logs/access.log`."
solution: awk '{ s += $10 } END { print s }' ~/logs/access.log
explanation: "A one-line aggregation: sum in the main rule, print in END."
```

```exercise
kind: command
difficulty: intermediate
prompt: "From `~/logs/app.log`, print how many log lines each **level** (field 2: INFO, WARN, ERROR) has, as `count level`, highest first."
solution: awk '{ print $2 }' ~/logs/app.log | sort | uniq -c | sort -rn
explanation: "The frequency-table pattern applied to the level field."
```

## Challenge

```exercise
kind: command
difficulty: advanced
title: Checkout failure rate
prompt: "In `~/logs/access.log`, consider only requests to `/api/checkout`. Print the percentage that failed with a status >= 500, formatted with one decimal and a `%` sign (e.g. `50.0%`)."
solution: awk '$7 == "/api/checkout" { n++; if ($9 >= 500) f++ } END { printf "%.1f%%\n", 100 * f / n }' ~/logs/access.log
hints:
  - Count matching requests and failures in two variables.
  - "In printf, `%%` prints a literal percent sign."
explanation: "Two of the four checkout requests failed, giving `50.0%`. Combining a filter, a condition and a computed ratio in one awk program is the bread and butter of operational log analysis."
```
