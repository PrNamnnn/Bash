## Problem

You've written many scripts by now. The capstone is to build one tool the way a professional would ship it: `nb`, a command-line notebook for quick notes. It has subcommands, follows platform conventions for config and data locations, logs at configurable levels, handles errors with meaningful exit codes, ships with help text, shell completion and tests, and installs with one command.

The features are deliberately modest — the point is the engineering around them.

## Requirements

- Subcommands: `add TEXT…` (or text from stdin), `list [-n N]`, `show ID`, `search PATTERN`, `rm ID`, `tags`, `export [--format md|json]`, `version`, `help [COMMAND]`.
- Notes support `#tags` inside the text; `list -t TAG` filters by tag.
- Storage: one file per note in `${XDG_DATA_HOME:-~/.local/share}/nb/notes/ID.txt`; IDs are increasing integers.
- Config: `${XDG_CONFIG_HOME:-~/.config}/nb/config` with `key=value` lines (`editor`, `log_level`, `date_format`); environment variables `NB_LOG_LEVEL` etc. override it; flags override both.
- Logging to stderr with levels `debug|info|warn|error`; `-v` raises verbosity, `-q` silences everything but errors.
- Exit codes: 0 success, 1 runtime error (e.g. note not found), 2 usage error.
- `nb help` and `nb help COMMAND` print accurate usage; unknown commands suggest `nb help`.
- Bash completion script for subcommands and note IDs.
- Tests that source the script without running it, plus ShellCheck-clean code.
- `make install PREFIX=~/.local` installs the script and completion.

## Steps

### Step 1: Skeleton and dispatcher

Create `nb` with strict mode, constants (`VERSION`, data and config paths), and a `main` that parses global flags (`-v`, `-q`, `-h`) and dispatches `cmd_<name>` functions with `declare -F` checking. Guard `main` with the `BASH_SOURCE` check.

### Step 2: Configuration and logging

Load defaults → config file (parsed, never sourced) → environment → flags. Implement `log LEVEL MESSAGE` with numeric levels and `die` with an explicit exit code.

### Step 3: Storage

Implement `next_id` (highest existing ID + 1), `note_path ID`, and `write_note` that writes atomically. Validate IDs as positive integers before using them in paths.

### Step 4: Commands

Implement each subcommand as a small function: `add` (arguments or stdin), `list` (newest first, first line only, with date), `show`, `search` (case-insensitive `grep -il`), `rm` (with confirmation unless `-f`), `tags` (count `#tag` occurrences), `export` (Markdown or JSON with proper escaping).

### Step 5: Help, version and completion

Write per-command help in a `case` so `nb help add` works. Generate the completion with `complete -F _nb nb`, completing subcommands first and note IDs for `show`/`rm`.

### Step 6: Tests, lint and packaging

Write tests that `source nb`, set `XDG_DATA_HOME` to a temp directory and call functions directly. Add a `Makefile` with `test`, `lint` (`shellcheck nb`) and `install` targets.

## Hints

- `declare -F "cmd_$1" > /dev/null` checks a subcommand exists before calling it.
- Read stdin only when it isn't a terminal: `[[ -t 0 ]] || text=$(cat)`.
- Tags: `grep -oh '#[A-Za-z0-9_-]\+' notes/*.txt | sort | uniq -c | sort -rn`.
- JSON escaping order matters: backslashes first, then quotes, then control characters (`\n`, `\t`).
- Keep side effects (file writes, prompts) in a few functions so tests can redirect them.

## Expected output

```text
$ nb add "Rotate the API keys before Friday #ops #security"
added note 1
$ nb add "Draft the Q4 roadmap #planning"
added note 2
$ echo "Postgres upgrade checklist #ops" | nb add
added note 3
$ nb list
  3  2026-11-17  Postgres upgrade checklist #ops
  2  2026-11-17  Draft the Q4 roadmap #planning
  1  2026-11-17  Rotate the API keys before Friday #ops #security
$ nb tags
   2 #ops
   1 #planning
   1 #security
$ nb show 9
nb: no note with id 9            (stderr, exit 1)
$ nb frobnicate
nb: unknown command 'frobnicate' — see 'nb help'   (stderr, exit 2)
```

## Test cases

| Case | Command | Expect |
|---|---|---|
| add / list | `add "x"; list` | note listed with today's date |
| stdin | `echo text \| nb add` | note created from stdin |
| empty | `nb add ""` | usage error, exit 2 |
| show missing | `nb show 99` | exit 1 |
| bad id | `nb show ../etc/passwd` | rejected as invalid id, exit 2 |
| tag filter | `nb list -t ops` | only notes with `#ops` |
| export JSON | `nb export --format json \| jq .` | valid JSON array |
| config precedence | config `log_level=warn`, `NB_LOG_LEVEL=debug`, `-q` | errors only |
| unknown command | `nb frobnicate` | message + exit 2 |
| sourced | `source nb` in a test | nothing runs; functions available |

## Edge cases

- Notes containing quotes, backslashes, `$`, tabs or very long lines (export must escape them).
- An empty notebook for every command.
- Gaps in IDs after `rm` (never reuse an ID).
- A missing or unreadable config file (use defaults, warn only with `-v`).
- `XDG_DATA_HOME` pointing at a path with spaces.

## Solution

```bash title="nb" playground
#!/usr/bin/env bash
# nb — a small, well-behaved command-line notebook.
set -euo pipefail

readonly VERSION=1.0.0
readonly PROG=nb
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/nb/notes"
CONFIG_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/nb/config"
declare -A CFG=([log_level]=info [date_format]=%F [editor]=${EDITOR:-vi})
declare -A LEVELS=([debug]=10 [info]=20 [warn]=30 [error]=40)

# ---------- infrastructure ----------
log() {
  local level=$1; shift
  (( ${LEVELS[$level]} >= ${LEVELS[${CFG[log_level]}]} )) || return 0
  printf '%s: %s%s\n' "$PROG" "$([[ $level == info ]] || echo "$level: ")" "$*" >&2
}
die()   { local code=$1; shift; printf '%s: %s\n' "$PROG" "$*" >&2; exit "$code"; }
usage_error() { die 2 "$*"; }

load_config() {
  local key value
  if [[ -r $CONFIG_FILE ]]; then
    while IFS='=' read -r key value || [[ -n $key ]]; do
      key=${key//[[:space:]]/}
      [[ -z $key || $key == \#* ]] && continue
      if [[ -v CFG[$key] ]]; then CFG[$key]=$value; else log warn "unknown config key '$key'"; fi
    done < "$CONFIG_FILE"
  fi
  [[ -n ${NB_LOG_LEVEL:-} ]] && CFG[log_level]=$NB_LOG_LEVEL
  [[ -v LEVELS[${CFG[log_level]}] ]] || { CFG[log_level]=info; log warn "invalid log level; using info"; }
}

# ---------- storage ----------
valid_id()  { [[ $1 =~ ^[1-9][0-9]*$ ]] || usage_error "invalid note id: '$1'"; }
note_path() { printf '%s/%s.txt\n' "$DATA_DIR" "$1"; }
note_ids()  { local f; shopt -s nullglob; for f in "$DATA_DIR"/*.txt; do f=${f##*/}; echo "${f%.txt}"; done | sort -n; }
next_id() {        # a persistent counter, so deleted IDs are never handed out again
  local last=""
  [[ -r $DATA_DIR/.last_id ]] && read -r last < "$DATA_DIR/.last_id"
  [[ $last =~ ^[0-9]+$ ]] || last=$(note_ids | tail -n 1)
  echo $(( ${last:-0} + 1 ))
}
write_note() {      # write_note ID TEXT — atomic
  local tmp; tmp=$(mktemp "$DATA_DIR/.tmp.XXXXXX")
  printf '%s\n' "$2" > "$tmp" && mv -f -- "$tmp" "$(note_path "$1")"
}
require_note() { valid_id "$1"; [[ -f $(note_path "$1") ]] || die 1 "no note with id $1"; }

# ---------- commands ----------
cmd_add() {
  local text="$*"
  if [[ -z $text && ! -t 0 ]]; then text=$(cat); fi
  [[ -n ${text//[[:space:]]/} ]] || usage_error "add: note text is empty (usage: $PROG add TEXT...)"
  mkdir -p -- "$DATA_DIR"
  local id; id=$(next_id)
  write_note "$id" "$text"
  echo "$id" > "$DATA_DIR/.last_id"
  log debug "wrote $(note_path "$id")"
  echo "added note $id"
}
cmd_list() {
  local n=0 tag="" opt OPTIND id first date shown=0
  while getopts ':n:t:' opt; do
    case $opt in
      n) [[ $OPTARG =~ ^[1-9][0-9]*$ ]] || usage_error "list: -n needs a positive integer"; n=$OPTARG ;;
      t) tag=${OPTARG#\#} ;;
      *) usage_error "list: unknown option -$OPTARG" ;;
    esac
  done
  while read -r id; do
    [[ -n $id ]] || continue
    if [[ -n $tag ]] && ! grep -qiw -- "#$tag" "$(note_path "$id")"; then continue; fi
    IFS= read -r first < "$(note_path "$id")" || true
    date=$(date -r "$(note_path "$id")" +"${CFG[date_format]}")
    printf '%3s  %s  %s\n' "$id" "$date" "${first:0:70}"
    (( ++shown ))
    (( n && shown >= n )) && break
  done < <(note_ids | sort -rn)
  (( shown )) || echo "(no notes${tag:+ tagged #$tag})"
}
cmd_show()   { (( $# == 1 )) || usage_error "usage: $PROG show ID"; require_note "$1"; cat -- "$(note_path "$1")"; }
cmd_search() {
  (( $# == 1 )) || usage_error "usage: $PROG search PATTERN"
  local id hits=0
  while read -r id; do
    [[ -n $id ]] || continue
    if grep -qiF -- "$1" "$(note_path "$id")"; then
      printf '%3s  %s\n' "$id" "$(grep -iF -m1 -- "$1" "$(note_path "$id")")"; (( ++hits ))
    fi
  done < <(note_ids)
  (( hits )) || { log info "no notes match '$1'"; return 1; }
}
cmd_rm() {
  local force=0; [[ ${1:-} == -f ]] && { force=1; shift; }
  (( $# == 1 )) || usage_error "usage: $PROG rm [-f] ID"
  require_note "$1"
  if (( ! force )); then
    local answer=""
    read -r -p "delete note $1? [y/N] " answer < /dev/tty 2>/dev/null || true
    [[ $answer == [yY] ]] || die 1 "not deleted"
  fi
  rm -f -- "$(note_path "$1")"
  echo "deleted note $1"
}
cmd_tags() {
  local -a files=("$DATA_DIR"/*.txt)
  [[ -e ${files[0]:-} ]] || { echo "(no tags)"; return 0; }
  grep -oh -- '#[A-Za-z0-9_-]*' "${files[@]}" | tr 'A-Z' 'a-z' | sort | uniq -c | sort -k1,1nr -k2,2 || echo "(no tags)"
}
json_string() {
  local s=$1
  s=${s//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\t'/\\t}; s=${s//$'\n'/\\n}
  printf '"%s"' "$s"
}
cmd_export() {
  local format=md
  case ${1:-} in --format) format=${2:-};; --format=*) format=${1#*=};; "") ;; *) usage_error "usage: $PROG export [--format md|json]";; esac
  local id sep="" text
  case $format in
    md)   while read -r id; do [[ -n $id ]] || continue; printf '## Note %s\n\n%s\n\n' "$id" "$(cat "$(note_path "$id")")"; done < <(note_ids) ;;
    json) printf '['
          while read -r id; do
            [[ -n $id ]] || continue
            text=$(cat "$(note_path "$id")")
            printf '%s{"id":%s,"text":%s}' "$sep" "$id" "$(json_string "$text")"; sep=,
          done < <(note_ids)
          echo ']' ;;
    *) usage_error "export: unknown format '$format'" ;;
  esac
}
cmd_version() { echo "$PROG $VERSION"; }
cmd_help() {
  case ${1:-} in
    add)    echo "usage: $PROG add TEXT...    (or pipe text on stdin)" ;;
    list)   echo "usage: $PROG list [-n N] [-t TAG]" ;;
    show)   echo "usage: $PROG show ID" ;;
    search) echo "usage: $PROG search PATTERN" ;;
    rm)     echo "usage: $PROG rm [-f] ID" ;;
    export) echo "usage: $PROG export [--format md|json]" ;;
    "")     cat <<EOF
usage: $PROG [-v|-q] COMMAND [ARGS]
commands: add list show search rm tags export version help
Run '$PROG help COMMAND' for details. Data: $DATA_DIR
EOF
            ;;
    *) usage_error "no help for '$1'" ;;
  esac
}

# ---------- completion (install with: nb completion > /etc/bash_completion.d/nb) ----------
cmd_completion() {
  cat <<'EOF'
_nb() {
  local cur=${COMP_WORDS[COMP_CWORD]}
  if (( COMP_CWORD == 1 )); then
    COMPREPLY=($(compgen -W "add list show search rm tags export version help" -- "$cur"))
  elif [[ ${COMP_WORDS[1]} == @(show|rm) ]]; then
    local dir=${XDG_DATA_HOME:-$HOME/.local/share}/nb/notes
    COMPREPLY=($(compgen -W "$(ls "$dir" 2>/dev/null | sed 's/\.txt$//')" -- "$cur"))
  fi
}
complete -F _nb nb
EOF
}

main() {
  while [[ ${1:-} == -* ]]; do
    case $1 in
      -v) CFG[log_level]=debug ;;
      -q) CFG[log_level]=error ;;
      -h|--help) set -- help; break ;;
      --version) set -- version; break ;;
      *) usage_error "unknown option '$1' — see '$PROG help'" ;;
    esac
    shift
  done
  local saved_level=${CFG[log_level]}
  load_config
  [[ $saved_level != info ]] && CFG[log_level]=$saved_level      # flags beat config and environment
  local cmd=${1:-help}; shift || true
  declare -F "cmd_$cmd" > /dev/null || usage_error "unknown command '$cmd' — see '$PROG help'"
  "cmd_$cmd" "$@"
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  # ---- playground demo (a real install just calls: main "$@") ----
  export XDG_DATA_HOME=/tmp/nb-demo; rm -rf "$XDG_DATA_HOME"
  main add "Rotate the API keys before Friday #ops #security"
  main add 'Draft the Q4 roadmap #planning — "quotes" and \backslashes\ survive'
  echo "Postgres upgrade checklist #ops" | main add
  main list
  echo "-- tagged ops:"; main list -t ops
  echo "-- tags:"; main tags
  echo "-- search:"; main search roadmap
  echo "-- json:"; main export --format json
  main rm -f 3
  main add "Renew TLS certificates #ops"      # gets id 4, not 3
  main list -n 2
  ( main show 9 ) || echo "(exit $?)"
  ( main show ../etc/passwd ) || echo "(exit $?)"
  ( main frobnicate ) || echo "(exit $?)"
  main version
fi
```

A matching `Makefile` and test file:

```makefile
PREFIX ?= /usr/local
test:      ; bats test/
lint:      ; shellcheck nb
install:
	install -Dm755 nb $(DESTDIR)$(PREFIX)/bin/nb
	./nb completion | install -Dm644 /dev/stdin $(DESTDIR)$(PREFIX)/share/bash-completion/completions/nb
```

```bash
#!/usr/bin/env bats
# test/nb.bats
setup() {
  export XDG_DATA_HOME=$BATS_TEST_TMPDIR XDG_CONFIG_HOME=$BATS_TEST_TMPDIR/cfg
  source "$BATS_TEST_DIRNAME/../nb"
}
@test "add then show"          { run main add "hello #t"; [ "$output" = "added note 1" ]; run main show 1; [ "$output" = "hello #t" ]; }
@test "ids are never reused"   { main add a; main add b; main rm -f 2; run main add c; [ "$output" = "added note 3" ]; }
@test "invalid id is a usage error" { run main show ../x; [ "$status" -eq 2 ]; }
@test "unknown command"        { run main nope; [ "$status" -eq 2 ]; [[ $output == *"nb help"* ]]; }
@test "json export escapes quotes" { main add 'say "hi"'; run main export --format json; [[ $output == *'say \"hi\"'* ]]; }
```

## Explanation

- **One dispatcher, many small commands:** `main` handles global flags and `declare -F` checks, then each `cmd_*` function does one thing. Adding a subcommand means adding a function and a help line.
- **Conventions users expect:** XDG directories for data and config, `help`/`--help`/`--version`, errors on stderr prefixed with the program name, exit 2 for usage errors and 1 for runtime failures.
- **Layered configuration** (defaults → config file → environment → flags) is parsed as data; nothing from a config file is ever executed.
- **Input validation at the boundary:** IDs must match `^[1-9][0-9]*$` before they are used in a path, which makes `nb show ../etc/passwd` impossible.
- **Atomic writes and never-reused IDs** keep the data consistent even if the tool is interrupted: a `.last_id` counter means deleting note 3 and adding another yields 4, so an old reference to "note 3" can never silently point at different content.
- **Correct JSON** comes from escaping backslashes first, then quotes and control characters.
- **Testability:** the `BASH_SOURCE` guard lets Bats `source` the script and call `main` or any function with a temporary `XDG_DATA_HOME` — no real data is touched.
- **Packaging:** `make install` puts the tool and its completion in standard locations; `make lint test` belongs in CI.

## Extensions

- `nb edit ID` opening `$EDITOR` on a temp copy and saving atomically.
- Full-text search with ranking and highlighted matches (`grep --color=always`).
- Sync notes to a Git repository automatically after each change.
- A `man` page generated from Markdown with `pandoc`, installed by `make install`.
- Portability: make it run under macOS's Bash 3.2 (no associative arrays) or POSIX `sh`, with CI on Linux and macOS.
