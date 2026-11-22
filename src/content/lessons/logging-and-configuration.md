---
objectives:
  - Write leveled, timestamped log functions that go to stderr and/or a file
  - Load configuration from defaults, a config file, the environment and flags — in a clear precedence order
  - Parse `key=value` config files safely without `source`-ing untrusted code
  - Integrate with syslog/journald using `logger`
summary:
  - "Log to **stderr** so stdout stays clean for data; include a timestamp and level: `2026-11-17T09:00:00 WARN disk at 91%`."
  - "Control verbosity with a numeric level (`LOG_LEVEL=debug|info|warn|error`)."
  - "Precedence (lowest → highest): built-in defaults → config file → environment variables → command-line flags."
  - "Parse config files with `while IFS='=' read -r key value` and a whitelist of keys — `source` executes any code in the file."
  - "`logger -t mytool \"message\"` sends a line to the system log (journald/syslog)."
related:
  - script-architecture
  - secure-scripting
  - associative-arrays
---

## A logging helper

```bash title="log.sh" playground
LOG_LEVEL=${LOG_LEVEL:-info}
declare -A LEVELS=([debug]=10 [info]=20 [warn]=30 [error]=40)

log() {
  local level=$1; shift
  (( ${LEVELS[$level]} >= ${LEVELS[$LOG_LEVEL]} )) || return 0
  printf '%s %-5s %s\n' "$(date +%Y-%m-%dT%H:%M:%S)" "${level^^}" "$*" >&2
}

log debug "connecting to db.internal"      # hidden at info level
log info  "backup started"
log warn  "disk usage at 91%"
log error "upload failed: timeout"
LOG_LEVEL=debug
log debug "now visible"
```

Why stderr? Because callers do `result=$(your_script)` and pipe your output into other tools. Logs mixed into stdout corrupt that data.

### Logging to a file as well

```bash
LOG_FILE=/var/log/mytool.log
exec 3>> "$LOG_FILE"                    # open once
log() {
  local line
  line=$(printf '%s %-5s %s' "$(date -Is)" "${1^^}" "${*:2}")
  printf '%s\n' "$line" >&2             # to the terminal
  printf '%s\n' "$line" >&3             # and to the file
}
```

Or send *everything* the script prints to a log while still showing it: `exec > >(tee -a "$LOG_FILE") 2>&1`.

### System log

`logger` writes to syslog / the systemd journal, where admins already look:

```bash
logger -t backup -p user.err "backup of /srv failed"
journalctl -t backup --since today
```

## Configuration sources and precedence

A well-behaved tool combines settings from several places. Later sources override earlier ones:

| Priority | Source | Example |
|---|---|---|
| 1 (lowest) | defaults in the script | `port=8080` |
| 2 | system config | `/etc/mytool.conf` |
| 3 | user config | `~/.config/mytool/config` |
| 4 | environment | `MYTOOL_PORT=9090` |
| 5 (highest) | command-line flags | `--port 9999` |

## Parsing key=value files safely

It's tempting to `source config.conf`. But `source` **executes** the file: a line like `port=$(rm -rf ~)` runs. Unless the file is as trusted as the script itself, parse it as data:

```bash title="config.sh" playground
declare -A cfg=([port]=8080 [log_level]=warn [db_host]=localhost)   # defaults
load_config() {
  local file=$1 key value n=0
  [[ -r $file ]] || return 0
  while IFS='=' read -r key value || [[ -n $key ]]; do
    n=$((n + 1))
    key=${key//[[:space:]]/}                          # trim spaces in the key
    [[ -z $key || $key == \#* ]] && continue          # blank lines and comments
    if [[ -v cfg[$key] ]]; then
      cfg[$key]=$value
    else
      echo "warning: $file:$n: unknown key '$key'" >&2
    fi
  done < "$file"
}
load_config ~/.config/app.conf
[[ -n ${APP_PORT:-} ]] && cfg[port]=$APP_PORT          # environment overrides file
for k in $(printf '%s\n' "${!cfg[@]}" | sort); do printf '%-10s %s\n' "$k" "${cfg[$k]}"; done
```

The whitelist (`[[ -v cfg[$key] ]]`) rejects typos and unexpected keys, and values are never executed.

## Environment variable conventions

- Prefix your variables: `MYTOOL_PORT`, not `PORT`.
- Document them in `--help`.
- Treat empty and unset the same unless there's a reason not to (`${MYTOOL_PORT:-}`).
- Never log secrets; mask them: `log info "token=${TOKEN:0:4}…"`.

## Common mistakes

```mistake
title: Sourcing a user-editable config
wrong: |
  source /etc/myapp/settings.conf     # editable by the app's group
right: |
  load_config /etc/myapp/settings.conf   # parse key=value, whitelist keys
why: source executes arbitrary code with the script's privileges — a classic privilege escalation path.
```

```mistake
title: Logging to stdout
wrong: |
  get_ip() { echo "looking up $1"; dig +short "$1"; }
  ip=$(get_ip example.com)     # ip contains the log line too
right: |
  get_ip() { echo "looking up $1" >&2; dig +short "$1"; }
why: Command substitution captures all of stdout; diagnostics must go to stderr.
```

## Practice

```exercise
kind: mcq
difficulty: intermediate
prompt: "Default port 8080, config file says 9000, `MYTOOL_PORT=9100` is exported and the user passes `--port 9200`. Which port should the tool use?"
options:
  - "8080"
  - "9000"
  - "9100"
  - "9200"
answer: 3
explanation: Command-line flags have the highest precedence, then environment, then config files, then defaults.
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print to stdout?
code: |
  log() { echo "[log] $*" >&2; }
  work() { log "working"; echo "result"; }
  out=$(work 2>/dev/null)
  echo "captured: $out"
answer: "captured: result"
explanation: The log line went to stderr (discarded here); only the data was captured.
```

```exercise
kind: command
difficulty: beginner
prompt: "Print the value of `log_level` from `~/.config/app.conf` without sourcing the file."
solution: grep '^log_level=' ~/.config/app.conf | cut -d= -f2
explanation: Treat config files as data and extract the value with text tools.
```

## Challenge

```exercise
kind: script
difficulty: advanced
title: Layered configuration
prompt: "Defaults: `port=80 level=info host=localhost`. Then apply `~/.config/app.conf` (only for known keys: map `log_level` → level, `port` → port, `db_host` → host). Then apply environment overrides `APP_LEVEL` (set it to `debug` in the script before loading). Print the final settings as `host=… port=… level=…`."
starter: |
  #!/usr/bin/env bash
  export APP_LEVEL=debug
solution: |
  #!/usr/bin/env bash
  export APP_LEVEL=debug
  port=80 level=info host=localhost
  while IFS='=' read -r key value; do
    case $key in
      port)      port=$value ;;
      log_level) level=$value ;;
      db_host)   host=$value ;;
    esac
  done < ~/.config/app.conf
  [[ -n ${APP_LEVEL:-} ]] && level=$APP_LEVEL
  echo "host=$host port=$port level=$level"
expectedOutput: host=db.internal port=8080 level=debug
checks:
  - pattern: source|\. ~
    forbid: true
    message: Parse the config file instead of sourcing it.
hints:
  - "A `case` on the key is a natural whitelist."
  - "Apply the environment after the file so it wins."
explanation: "Each layer overrides the previous one; the case statement silently ignores keys you don't recognise (comments included)."
```
