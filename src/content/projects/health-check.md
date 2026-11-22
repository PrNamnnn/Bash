## Problem

On-call engineers need one command that answers "is this server healthy?" in a few seconds. It should check load, memory, disk, required services, HTTP endpoints and recent errors, print one readable line per check, and return a single exit status that monitoring tools understand.

## Requirements

- Usage: `healthcheck.sh [-c CONFIG] [-q] [-j]` — `-c` reads thresholds and lists from a `key=value` file, `-q` prints only problems, `-j` prints JSON.
- Checks: load per CPU, available memory %, every filesystem's usage, required services running, HTTP endpoints responding with 2xx within a timeout, error lines in the application log during the last N lines.
- Every check produces `STATUS NAME DETAIL` where STATUS is OK, WARN, CRIT or UNKNOWN (UNKNOWN when the check itself couldn't run).
- The overall exit status is the worst check: 0 OK, 1 WARN, 2 CRIT, 3 UNKNOWN.
- Config keys: `load_warn`, `load_crit`, `mem_warn`, `mem_crit`, `disk_warn`, `disk_crit`, `services` (comma list), `urls` (comma list), `log_file`, `log_errors_warn`. Unknown keys produce a warning; the file is parsed, never sourced.
- Each check must finish quickly: network calls use timeouts.

## Steps

### Step 1: A result collector

Write `report STATUS NAME DETAIL` that stores results in arrays and updates the worst status, plus `print_text` and `print_json` to output them at the end.

### Step 2: Configuration

Set defaults in an associative array, then load the config file with a `while IFS='=' read -r key value` loop that trims spaces, skips comments and rejects unknown keys.

### Step 3: System checks

Implement `check_load`, `check_memory` and `check_disk`. Read `/proc/loadavg` and `/proc/meminfo` (or call `nproc`, `df -P`). Compare decimals with awk.

### Step 4: Service and endpoint checks

`check_services` loops over the comma list with `systemctl is-active --quiet`; `check_urls` uses `curl -fsS -o /dev/null --max-time 5 -w '%{http_code} %{time_total}'`.

### Step 5: Log check

Count lines matching ` ERROR ` in the last 500 lines of the log; warn above the configured number. Report UNKNOWN if the log is unreadable.

### Step 6: Output modes and exit status

Implement `-q` (skip OK lines) and `-j` (a JSON array with escaped strings), then `exit "$worst"`.

## Hints

- Store severities as numbers (0–3) and names in an array: `names=(OK WARN CRIT UNKNOWN)`.
- UNKNOWN (3) should rank above CRIT for the exit code only if no CRIT exists — or simply treat it as the worst; document your choice.
- A function per check keeps each one testable and lets you skip checks easily.
- JSON-escape with `${s//\\/\\\\}` then `${s//\"/\\\"}`.
- Stub `systemctl` and `curl` as functions to test the script anywhere.

## Expected output

```text
OK    load        0.96 per CPU (3.84 on 4 cores)
OK    memory      68% available
WARN  disk:/      84% used
CRIT  disk:/srv   94% used
OK    service     nginx active
CRIT  service     redis inactive
OK    url         https://shop.example.com/health 200 in 0.12s
WARN  app-log     3 ERROR line(s) in last 500
overall: CRIT (exit 2)
```

## Test cases

| Case | Setup | Expect |
|---|---|---|
| all healthy | stubs return good values | only OK lines, exit 0 |
| quiet | `-q` | only WARN/CRIT lines and the overall line |
| JSON | `-j` | valid JSON (`… \| jq .` succeeds) |
| config override | `disk_crit=99` | /srv becomes WARN |
| unknown key | config contains `foo=1` | warning on stderr, checks still run |
| unreadable log | `log_file=/nope` | `UNKNOWN app-log …`, exit 3 |
| slow endpoint | URL that hangs | CRIT after the timeout, not a hang |

## Edge cases

- Machines without systemd (containers): report UNKNOWN for services rather than CRIT.
- Values with spaces or `=` inside the config file.
- A URL list that's empty (skip the check, don't fail).
- Locales that print decimals with commas (`LC_ALL=C` for numeric tools).
- Running as a non-root user that can't read some logs.

## Solution

```bash title="healthcheck.sh" playground
#!/usr/bin/env bash
# healthcheck.sh — one-shot server health summary (exit 0/1/2/3).
set -uo pipefail
export LC_ALL=C
PROG=${0##*/}

# ---- system access (stubbed for the playground; real commands in comments) ----
loadavg()   { echo "3.84 2.10 1.05"; }                         # cut -d' ' -f1-3 /proc/loadavg
cpus()      { echo 4; }                                         # nproc
mem_avail() { echo 68; }                                        # awk '/MemTotal/{t=$2}/MemAvailable/{a=$2}END{print int(a*100/t)}' /proc/meminfo
disks()     { printf '%s\n' "84 /" "94 /srv" "10 /boot"; }     # df -P -x tmpfs | awk 'NR>1{sub(/%/,"",$5); print $5, $6}'
svc_active(){ [[ $1 != redis ]]; }                              # systemctl is-active --quiet "$1"
http_probe(){ echo "200 0.12"; }                                # curl -fsS -o /dev/null --max-time 5 -w '%{http_code} %{time_total}' "$1"

# ---- results ----
NAMES=(OK WARN CRIT UNKNOWN)
declare -a R_STATUS=() R_NAME=() R_DETAIL=()
WORST=0
report() {
  R_STATUS+=("$1"); R_NAME+=("$2"); R_DETAIL+=("$3")
  (( $1 > WORST )) && WORST=$1
  return 0
}
level() {    # level VALUE WARN CRIT [lower-is-worse]
  if [[ ${4:-} == low ]]; then
    awk -v v="$1" -v w="$2" -v c="$3" 'BEGIN { print (v <= c) ? 2 : (v <= w) ? 1 : 0 }'
  else
    awk -v v="$1" -v w="$2" -v c="$3" 'BEGIN { print (v >= c) ? 2 : (v >= w) ? 1 : 0 }'
  fi
}

# ---- configuration ----
declare -A CFG=([load_warn]=1.5 [load_crit]=3 [mem_warn]=20 [mem_crit]=10 [disk_warn]=80 [disk_crit]=90
                [services]="nginx,redis" [urls]="https://shop.example.com/health" [log_file]="$HOME/logs/app.log" [log_errors_warn]=0)
load_config() {
  local key value
  [[ -r $1 ]] || { echo "$PROG: cannot read config $1" >&2; exit 3; }
  while IFS='=' read -r key value || [[ -n $key ]]; do
    key=${key//[[:space:]]/}
    [[ -z $key || $key == \#* ]] && continue
    if [[ -v CFG[$key] ]]; then CFG[$key]=${value#"${value%%[![:space:]]*}"}
    else echo "$PROG: warning: unknown config key '$key'" >&2; fi
  done < "$1"
}

# ---- checks ----
check_load() {
  local one n per
  read -r one _ <<< "$(loadavg)"; n=$(cpus)
  per=$(awk -v l="$one" -v n="$n" 'BEGIN { printf "%.2f", l / n }')
  report "$(level "$per" "${CFG[load_warn]}" "${CFG[load_crit]}")" load "$per per CPU ($one on $n cores)"
}
check_memory() {
  local avail; avail=$(mem_avail)
  report "$(level "$avail" "${CFG[mem_warn]}" "${CFG[mem_crit]}" low)" memory "$avail% available"
}
check_disk() {
  local pct mount
  while read -r pct mount; do
    report "$(level "$pct" "${CFG[disk_warn]}" "${CFG[disk_crit]}")" "disk:$mount" "$pct% used"
  done < <(disks)
}
check_services() {
  local svc
  IFS=, read -ra list <<< "${CFG[services]}"
  for svc in "${list[@]}"; do
    if svc_active "$svc"; then report 0 service "$svc active"; else report 2 service "$svc inactive"; fi
  done
}
check_urls() {
  local url code time
  IFS=, read -ra list <<< "${CFG[urls]}"
  for url in "${list[@]}"; do
    if read -r code time < <(http_probe "$url") && [[ $code == 2?? ]]; then
      report 0 url "$url $code in ${time}s"
    else
      report 2 url "$url failed (${code:-no response})"
    fi
  done
}
check_log() {
  local f=${CFG[log_file]} n
  [[ -r $f ]] || { report 3 app-log "cannot read $f"; return; }
  n=$(tail -n 500 -- "$f" | grep -c ' ERROR ' || true)
  if (( n > ${CFG[log_errors_warn]} )); then report 1 app-log "$n ERROR line(s) in last 500"
  else report 0 app-log "no errors in last 500 lines"; fi
}

# ---- output ----
json_escape() { local s=${1//\\/\\\\}; s=${s//\"/\\\"}; printf '%s' "$s"; }
print_text() {
  local i quiet=$1
  for i in "${!R_STATUS[@]}"; do
    (( quiet && R_STATUS[i] == 0 )) && continue
    printf '%-5s %-11s %s\n' "${NAMES[R_STATUS[i]]}" "${R_NAME[i]}" "${R_DETAIL[i]}"
  done
  echo "overall: ${NAMES[WORST]} (exit $WORST)"
}
print_json() {
  local i sep=""
  printf '{"status":"%s","checks":[' "${NAMES[WORST]}"
  for i in "${!R_STATUS[@]}"; do
    printf '%s{"status":"%s","name":"%s","detail":"%s"}' "$sep" "${NAMES[R_STATUS[i]]}" "$(json_escape "${R_NAME[i]}")" "$(json_escape "${R_DETAIL[i]}")"
    sep=,
  done
  echo ']}'
}

main() {
  local quiet=0 json=0 opt OPTIND
  while getopts ':c:qjh' opt; do
    case $opt in
      c) load_config "$OPTARG" ;;
      q) quiet=1 ;;
      j) json=1 ;;
      *) echo "usage: $PROG [-c CONFIG] [-q] [-j]" >&2; exit 3 ;;
    esac
  done
  check_load; check_memory; check_disk; check_services; check_urls; check_log
  if (( json )); then print_json; else print_text "$quiet"; fi
  return "$WORST"
}

main "$@"
```

## Explanation

- **Collect, then print.** Checks call `report`; nothing is printed until the end, so the same results can be rendered as text, quiet text or JSON.
- **Numeric severities** make "worst status" a simple comparison and map directly onto the 0/1/2/3 monitoring-plugin convention.
- **`level`** centralises threshold logic (including "lower is worse" for free memory) and uses awk for decimal comparisons.
- **Config is data:** a whitelist of keys in an associative array, parsed line by line — never `source`d, so a config file can't run commands.
- **Isolated system access** (`loadavg`, `svc_active`, `http_probe` …) makes the script testable: swap the stubs for real commands, or override them in tests.
- `set -uo pipefail` *without* `-e`: a failing probe should become a CRIT/UNKNOWN line, not abort the whole health check.

## Extensions

- Add certificate expiry checks (`openssl s_client … | openssl x509 -noout -enddate`).
- Run checks in parallel with background jobs and per-check timeouts (`timeout 5 check_urls`).
- Send a webhook or email only when the overall state *changes* (store the last state in a file).
- Export results as Prometheus metrics or Nagios performance data (`| load=3.84;6;12`).
- Add a `--fix` mode with safe, idempotent remediations (restart a failed service once).
