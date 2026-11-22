---
objectives:
  - Structure a script as header, settings, helpers, commands and a `main` entry point
  - Split large tools into sourced library files
  - Build subcommand-style CLIs (`tool start|stop|status`)
  - Make scripts safe to source for testing
summary:
  - "Order: shebang → description/usage comment → strict mode → constants/defaults → helper functions → command functions → `main \"$@\"`."
  - "Keep functions small and single-purpose; pass data as arguments and return it on stdout or via exit status."
  - "Libraries: `source \"$(dirname \"${BASH_SOURCE[0]}\")/lib/log.sh\"` — resolve paths relative to the script, not the caller's directory."
  - "Guard `main` with `[[ ${BASH_SOURCE[0]} == \"$0\" ]] && main \"$@\"` so tests can source the file without running it."
  - "Subcommands: dispatch with `case` to `cmd_<name>` functions; unknown commands print usage and exit 2."
related:
  - functions
  - getopts
  - testing-shell-scripts
---

## When a script stops being a script

A ten-line script can be a straight list of commands. Past ~50 lines, or once it has options, multiple modes or error handling, structure pays off: you can read it top-down, test pieces, and change one part without breaking another.

## The canonical layout

```bash
#!/usr/bin/env bash
#
# backupctl — create, list and prune backups.
#
# Usage: backupctl [-v] <command> [args]
#   create DIR     back up DIR
#   list           list backups
#   prune [N]      keep the newest N backups (default 7)
#
set -euo pipefail

# ---- constants and defaults (overridable from the environment) ----
readonly PROG=${0##*/}
readonly VERSION=1.4.0
: "${BACKUP_ROOT:=$HOME/backups}"
VERBOSE=0

# ---- generic helpers ----
log()  { (( VERBOSE )) && printf '%s\n' "$*" >&2; return 0; }
die()  { printf '%s: %s\n' "$PROG" "$*" >&2; exit 1; }
usage() { sed -n '3,9s/^# \{0,1\}//p' "$0"; }

# ---- commands ----
cmd_create() { …; }
cmd_list()   { …; }
cmd_prune()  { …; }

# ---- entry point ----
main() {
  while getopts ':vh' opt; do
    case $opt in
      v) VERBOSE=1 ;;
      h) usage; exit 0 ;;
      *) usage >&2; exit 2 ;;
    esac
  done
  shift $((OPTIND - 1))
  local cmd=${1:-}; shift || true
  case $cmd in
    create|list|prune) "cmd_$cmd" "$@" ;;
    version) echo "$PROG $VERSION" ;;
    *) usage >&2; exit 2 ;;
  esac
}

[[ ${BASH_SOURCE[0]} == "$0" ]] && main "$@"
```

Every block has one job, and `main` reads like a table of contents.

## A runnable miniature

```bash title="taskctl.sh" playground
#!/usr/bin/env bash
set -euo pipefail
readonly TASKS=/tmp/tasks.txt
touch "$TASKS"

die() { echo "taskctl: $*" >&2; exit 1; }

cmd_add()  { [[ $# -gt 0 ]] || die "add: missing text"; printf '%s\n' "$*" >> "$TASKS"; echo "added: $*"; }
cmd_list() { [[ -s $TASKS ]] || { echo "(no tasks)"; return 0; }; nl -w2 -s'. ' "$TASKS"; }
cmd_done() {
  local n=${1:?done: which task number?}
  [[ $n =~ ^[0-9]+$ ]] || die "done: not a number: $n"
  sed -i "${n}d" "$TASKS"
  echo "completed task $n"
}

main() {
  local cmd=${1:-list}; shift || true
  case $cmd in
    add|list|done) "cmd_$cmd" "$@" ;;
    *) echo "usage: taskctl {add TEXT|list|done N}" >&2; return 2 ;;
  esac
}

main add "write the report"
main add "review pull request"
main list
main done 1
main list
```

## Design guidelines

| Guideline | Why |
|---|---|
| Functions do one thing; ~5–30 lines each | easy to name, read and test |
| Input via arguments, output via stdout/status | no hidden coupling through globals |
| `local` for every function variable | no accidental leaks |
| Constants `readonly`, UPPER_CASE | intent is explicit |
| Defaults with `: "${VAR:=default}"` | users can override via environment |
| Errors to stderr, data to stdout | composable in pipelines |
| Conventional exit codes: 0 ok, 1 error, 2 usage | callers and CI can react |
| `--help` / `-h` always works | self-documenting |

## Libraries and sourcing

When several scripts share helpers, move them into a library and `source` it. Resolve the path relative to the **script file**, not the current directory, or the script breaks when run from elsewhere:

```bash
#!/usr/bin/env bash
set -euo pipefail
readonly SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/lib/log.sh"
source "$SCRIPT_DIR/lib/config.sh"
```

Library files should only **define** things (functions, defaults) and not run commands on load. Prefix their functions (`log::info`, `cfg_get`) to avoid name clashes.

## The sourcing guard

```bash
[[ ${BASH_SOURCE[0]} == "$0" ]] && main "$@"
```

When the file is executed, `BASH_SOURCE[0]` equals `$0`, so `main` runs. When it's **sourced** (by a test or another script), they differ, so only the function definitions load. The testing lesson uses this.

```bash title="guard.sh" playground
cat > /tmp/greet-lib.sh <<'EOF'
greet() { echo "hello, ${1:-world}"; }
main() { greet "$@"; }
[[ ${BASH_SOURCE[0]} == "$0" ]] && main "$@"
EOF
echo "-- executed:"; bash /tmp/greet-lib.sh Ada
echo "-- sourced:";  source /tmp/greet-lib.sh; greet "from the caller"
```

## When to stop using Bash

Bash is excellent glue: running programs, moving files, piping text. Consider Python, Go or similar when you need complex data structures (nested maps, JSON manipulation beyond `jq`), heavy arithmetic, concurrency with shared state, a long-lived service, or more than a few hundred lines of logic.

## Common mistakes

```mistake
title: Sourcing relative to the current directory
wrong: |
  source lib/log.sh          # works only when run from the repo root
right: |
  source "$(dirname "${BASH_SOURCE[0]}")/lib/log.sh"
why: Relative paths resolve against the caller's working directory, not the script's location.
```

```mistake
title: Top-level code everywhere
wrong: |
  helper() { …; }
  do_step_one
  other_helper() { …; }   # defined after it was needed
  do_step_two
right: |
  helper() { …; }
  other_helper() { …; }
  main() { do_step_one; do_step_two; }
  main "$@"
why: Interleaving definitions and actions makes order bugs likely and the flow hard to follow.
```

## Practice

```exercise
kind: mcq
difficulty: intermediate
prompt: "What does `[[ ${BASH_SOURCE[0]} == \"$0\" ]] && main \"$@\"` achieve?"
options:
  - It runs main twice
  - It runs main only when the file is executed, not when it is sourced
  - It prevents the script from running as root
  - It checks that the script has arguments
answer: 1
explanation: "Sourcing keeps the caller's $0, while BASH_SOURCE[0] names the sourced file."
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  cmd_hi()  { echo "hi $1"; }
  cmd_bye() { echo "bye $1"; }
  run() {
    local c=$1; shift
    if declare -F "cmd_$c" > /dev/null; then "cmd_$c" "$@"; else echo "unknown: $c"; fi
  }
  run hi Ada; run bye Bob; run fly Cy
answer: |
  hi Ada
  bye Bob
  unknown: fly
explanation: "`declare -F name` succeeds only if a function of that name exists — a safe way to dispatch."
```

```exercise
kind: command
difficulty: intermediate
prompt: "Print the absolute directory of the running script, using BASH_SOURCE (in the playground it runs from the home directory as `script.sh`)."
solution: cd "$(dirname "${BASH_SOURCE[0]}")" && pwd
explanation: "`dirname` of the script path, then `cd … && pwd` makes it absolute."
```

## Challenge

```exercise
kind: script
difficulty: advanced
title: A dispatching CLI
prompt: "Build `kv`, a tiny key-value store in `/tmp/kv.db` (lines `key=value`) with subcommands `set KEY VALUE`, `get KEY` (prints value or errors `kv: no such key: KEY` to stderr, status 1) and `keys` (sorted). Unknown subcommands print `usage: kv {set|get|keys}` to stderr and return 2. The test calls are given."
starter: |
  #!/usr/bin/env bash
  DB=/tmp/kv.db
  : > "$DB"
  kv() {
    :
  }
  kv set color blue
  kv set size large
  kv set color green
  kv get color
  kv keys
  kv get shape 2>&1
  kv drop 2>&1; echo "status $?"
solution: |
  #!/usr/bin/env bash
  DB=/tmp/kv.db
  : > "$DB"
  kv_set() {
    local key=$1 value=$2
    grep -v "^$key=" "$DB" > "$DB.tmp" || true
    printf '%s=%s\n' "$key" "$value" >> "$DB.tmp"
    mv -- "$DB.tmp" "$DB"
  }
  kv_get() {
    local line
    line=$(grep "^$1=" "$DB") || { echo "kv: no such key: $1" >&2; return 1; }
    printf '%s\n' "${line#*=}"
  }
  kv_keys() { cut -d= -f1 "$DB" | sort; }
  kv() {
    local cmd=${1:-}; shift || true
    case $cmd in
      set|get|keys) "kv_$cmd" "$@" ;;
      *) echo "usage: kv {set|get|keys}" >&2; return 2 ;;
    esac
  }
  kv set color blue
  kv set size large
  kv set color green
  kv get color
  kv keys
  kv get shape 2>&1
  kv drop 2>&1; echo "status $?"
expectedOutput: |
  green
  color
  size
  kv: no such key: shape
  usage: kv {set|get|keys}
  status 2
checks:
  - pattern: case
    message: Dispatch subcommands with case.
hints:
  - "For set: copy every other line to a temp file, append the new pair, then mv it over the DB."
  - "`${line#*=}` strips the key."
explanation: "One function per subcommand, a `case` dispatcher, errors on stderr with meaningful statuses — the same architecture scales to real tools."
```
