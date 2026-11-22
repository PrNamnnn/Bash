## Problem

Your web server writes an access log in the standard *combined* format. When something goes wrong — or when someone asks "how much traffic did we get?" — you need answers in seconds: request counts, status code breakdown, top pages, top clients, error hotspots and suspicious requests.

Build `logreport.sh`, which turns a raw access log (or several, including rotated ones) into a clear, sectioned report.

## Requirements

- Usage: `logreport.sh [-n TOP] [-s STATUS_PREFIX] [LOGFILE...]` — reads stdin when no files are given; `-n` sets the size of "top" lists (default 5); `-s 5` restricts the report to 5xx responses, `-s 404` to 404s, etc.
- Report sections: summary (total requests, unique IPs, total bytes in human units, error rate), status codes, top paths, top client IPs, requests per hour, and suspicious requests (paths probing for `.env`, `wp-login`, `phpmyadmin`, backup files).
- Ignore query strings when grouping paths (`/products?page=2` → `/products`).
- Skip malformed lines and report how many were skipped.
- Work on large files: one `awk` pass for the statistics, no per-line Bash loops.

## Steps

### Step 1: Understand the format

A combined log line has: `IP - user [date:time zone] "METHOD path PROTOCOL" status bytes "referer" "agent"`. With default whitespace splitting, awk sees the IP in `$1`, the date in `$4`, the path in `$7`, the status in `$9` and the size in `$10`. Print those fields for a few lines to confirm.

### Step 2: Inputs and options

Parse `-n` and `-s` with `getopts`; if no files remain, read stdin. Validate `-n` as a positive integer.

### Step 3: One awk pass

Write a single awk program that counts totals, unique IPs (an array), bytes, statuses, paths (stripped of `?…`) and hours (`substr($4, 14, 2)`), and skips lines with fewer than 10 fields or a non-numeric status.

### Step 4: Print sections with sorting

Have awk print tagged lines (`status 200 20`, `path /index.html 7`, …) and let `sort` rank them, or sort inside awk's END with a helper. Format numbers with `printf`.

### Step 5: Human-readable sizes and percentages

Write a small awk function `human(bytes)` returning `KB`/`MB`/`GB` with one decimal, and compute the error rate as `(4xx+5xx)/total`.

### Step 6: Suspicious requests

Match paths against a list of patterns and list them with the client IP and status.

## Hints

- `awk -v top="$top" -v filter="$status_prefix" '…'` passes shell values safely into awk.
- `index($9, filter) == 1` tests "status starts with the filter".
- Path without query: `p = $7; sub(/\?.*/, "", p)`.
- For a "top N" inside awk without GNU extensions, pipe from awk to `sort -rn | head` per section.
- `zcat -f` reads both plain and `.gz` files, useful for rotated logs.

## Expected output

For the sample `~/logs/access.log`:

```text
== Summary
requests:     30
unique IPs:   8
bytes sent:   75.3 KB
error rate:   26.7% (8 responses >= 400)

== Status codes
200   20   66.7%
404    5   16.7%
500    2    6.7%
201    1    3.3%
304    1    3.3%
403    1    3.3%

== Top paths
   4  /api/checkout
   4  /health
   3  /products
   2  /
   2  /api/cart

== Top client IPs
   5  192.168.1.22
   5  198.51.100.7
   4  10.0.0.5
   4  192.168.1.10
   4  203.0.113.45

== Requests per hour
08:00   30  ##############################

== Suspicious requests
  198.51.100.7    404  /wp-login.php
  198.51.100.7    404  /.env
  198.51.100.7    404  /phpmyadmin
  198.51.100.7    404  /backup.zip
```

## Test cases

| Case | Command | Expect |
|---|---|---|
| sample log | `logreport.sh ~/logs/access.log` | all sections; 30 requests |
| stdin | `cat ~/logs/access.log \| logreport.sh` | same report |
| several files | `logreport.sh ~/logs/access.log ~/logs/archive/*` | totals include rotated logs |
| filter | `logreport.sh -s 5 ~/logs/access.log` | only the two 500 responses |
| top size | `-n 2` | top lists have 2 entries |
| malformed | append a garbage line | `skipped 1 malformed line(s)` |
| empty input | `logreport.sh < /dev/null` | "no requests" message, status 0 |

## Edge cases

- Requests with no path (`"-"`) or HTTP/2 lines with extra fields.
- Bytes field `-` (no body), which must count as 0.
- IPv6 client addresses (contain colons).
- Paths containing spaces (encoded as `%20` in well-formed logs, but malformed clients exist).
- Logs spanning midnight or multiple days (hours alone become ambiguous).

## Solution

```bash title="logreport.sh" playground
#!/usr/bin/env bash
# logreport.sh — summarise combined-format web access logs.
set -euo pipefail
PROG=${0##*/}

usage() { echo "usage: $PROG [-n TOP] [-s STATUS_PREFIX] [LOGFILE...]" >&2; exit 2; }

analyze() {   # analyze TOP FILTER  (reads the log on stdin, prints tagged records)
  awk -v filter="$2" '
    NF < 10 || $9 !~ /^[0-9][0-9][0-9]$/ { bad++; next }
    filter != "" && index($9, filter) != 1 { next }
    {
      total++
      ips[$1]++
      bytes += ($10 == "-" ? 0 : $10)
      status[$9]++
      if ($9 >= 400) errors++
      p = $7; sub(/\?.*/, "", p); paths[p]++
      hour = substr($4, 14, 2); hours[hour]++
      if (p ~ /(\.env|wp-login|phpmyadmin|\.git|backup|\.zip$|\.sql$)/) sus[++ns] = sprintf("%-15s %s  %s", $1, $9, $7)
    }
    function human(b) {
      if (b >= 1073741824) return sprintf("%.1f GB", b / 1073741824)
      if (b >= 1048576) return sprintf("%.1f MB", b / 1048576)
      if (b >= 1024) return sprintf("%.1f KB", b / 1024)
      return b " B"
    }
    END {
      n = 0; for (ip in ips) n++
      printf "summary|requests:     %d\n", total
      printf "summary|unique IPs:   %d\n", n
      printf "summary|bytes sent:   %s\n", human(bytes)
      if (total) printf "summary|error rate:   %.1f%% (%d responses >= 400)\n", errors * 100 / total, errors
      if (bad) printf "summary|skipped:      %d malformed line(s)\n", bad
      for (s in status) printf "status|%s|%d|%.1f\n", s, status[s], status[s] * 100 / total
      for (p in paths)  printf "path|%s|%d\n", p, paths[p]
      for (ip in ips)   printf "ip|%s|%d\n", ip, ips[ip]
      for (h in hours)  printf "hour|%s|%d\n", h, hours[h]
      for (i = 1; i <= ns; i++) printf "sus|%s\n", sus[i]
    }'
}

section() {   # section TAG TITLE TOP  — read tagged records on stdin
  local tag=$1 title=$2 top=$3
  echo; echo "== $title"
  case $tag in
    summary) grep "^summary|" | cut -d'|' -f2- ;;
    status)  grep "^status|" | sort -t'|' -k3,3nr | awk -F'|' '{ printf "%s  %3d  %5.1f%%\n", $2, $3, $4 }' ;;
    hour)    grep "^hour|"   | sort -t'|' -k2,2   | awk -F'|' '{ printf "%s:00  %3d  ", $2, $3; for (i = 0; i < $3; i++) printf "#"; print "" }' ;;
    sus)     grep "^sus|"    | cut -d'|' -f2- | sed 's/^/  /' ;;
    *)       grep "^$tag|"   | sort -t'|' -k3,3nr -k2,2 | head -n "$top" | awk -F'|' '{ printf "%4d  %s\n", $3, $2 }' ;;
  esac
}

main() {
  local top=5 filter="" opt OPTIND
  while getopts ':n:s:h' opt; do
    case $opt in
      n) top=$OPTARG ;;
      s) filter=$OPTARG ;;
      *) usage ;;
    esac
  done
  shift $((OPTIND - 1))
  [[ $top =~ ^[1-9][0-9]*$ ]] || usage
  local records
  if (( $# )); then records=$(cat -- "$@" | analyze "$top" "$filter")
  else records=$(analyze "$top" "$filter"); fi
  if ! grep -q '^status|' <<< "$records"; then echo "no requests${filter:+ matching status $filter*}"; return 0; fi
  section summary "Summary" "$top" <<< "$records"
  section status "Status codes" "$top" <<< "$records"
  section path "Top paths" "$top" <<< "$records"
  section ip "Top client IPs" "$top" <<< "$records"
  section hour "Requests per hour" "$top" <<< "$records"
  if grep -q '^sus|' <<< "$records"; then section sus "Suspicious requests" "$top" <<< "$records"; fi
}

main ~/logs/access.log      # on a real system: main "$@"
```

## Explanation

- **One pass over the data.** awk reads each line once and updates every counter; the expensive part of the job never runs in a Bash loop.
- **Tagged records** (`status|404|5|16.7`) separate *computing* from *presenting*: awk does the statistics, small `section` functions sort and format each part. Adding a section means adding one tag and one call.
- **Defensive parsing:** lines with too few fields or a non-numeric status are counted as malformed instead of corrupting the numbers; `-` byte counts become 0.
- **Paths are normalised** by stripping query strings so `/products?page=2` and `/products` are grouped together.
- **Filter early** (`-s 5`) inside awk so the whole report — including the summary — describes only the requests of interest.
- **Portable awk:** no `asort` or other GNU-only functions; ranking is done by `sort`, which handles any size.

## Extensions

- Accept `.gz` files transparently with `zcat -f`.
- Add a time window filter (`--from "10/Nov/2026:08:00" --to …`).
- Output JSON (`-j`) for dashboards, using `printf` with proper escaping or `jq -n`.
- Detect bursts: requests per minute per IP above a threshold (possible scraping or attacks).
- Add response-time percentiles if your log format includes `$request_time`.
