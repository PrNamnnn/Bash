---
objectives:
  - Apply a standard set of defensive idioms to every non-trivial script
  - Handle any file name safely — spaces, newlines, leading dashes
  - Validate dependencies and inputs up front
  - Make scripts safe to re-run and safe to interrupt
summary:
  - "Start with `#!/usr/bin/env bash`, `set -euo pipefail`, and a `main \"$@\"` entry point."
  - "Quote every expansion; use `--` before file arguments; prefer `./*` over `*` so names can't become options."
  - "Use NUL separators for file lists: `find … -print0 | xargs -0` or `while IFS= read -r -d ''`."
  - "Check dependencies with `command -v`, validate arguments early, fail with a usage message and status 2."
  - "Clean up with `trap … EXIT`, write output atomically (temp file + `mv`), and use locks to prevent concurrent runs."
related:
  - error-handling
  - temp-files-and-fds
  - atomicity-and-idempotency
---

## The robust script skeleton

```bash
#!/usr/bin/env bash
#
# rotate-logs — compress logs older than N days.
# Usage: rotate-logs [-n DAYS] DIR
set -euo pipefail

readonly PROG=${0##*/}

usage() { echo "usage: $PROG [-n DAYS] DIR" >&2; exit 2; }
die()   { echo "$PROG: $*" >&2; exit 1; }
log()   { printf '%s %s\n' "$(date '+%F %T')" "$*" >&2; }

require() {
  local cmd
  for cmd; do command -v "$cmd" > /dev/null || die "missing dependency: $cmd"; done
}

main() {
  local days=7 opt
  while getopts ':n:h' opt; do
    case $opt in
      n) days=$OPTARG ;;
      *) usage ;;
    esac
  done
  shift $((OPTIND - 1))
  (( $# == 1 )) || usage
  [[ $days =~ ^[0-9]+$ ]] || die "-n must be a number"
  local dir=$1
  [[ -d $dir ]] || die "not a directory: $dir"
  require find gzip

  log "compressing logs older than $days days in $dir"
  find "$dir" -name '*.log' -mtime +"$days" -print0 | xargs -0 -r gzip --
}

main "$@"
```

Each piece has a job: strict mode catches surprises, `usage`/`die` give clear messages and conventional exit codes, `require` fails early with a helpful message instead of halfway through, and `main` keeps the flow readable.

## File names can contain anything

On Linux a file name can contain any byte except `/` and NUL — spaces, newlines, `*`, and leading `-`. Robust scripts survive all of them.

```bash title="filenames.sh" playground
cd "$(mktemp -d)"
touch "plain.txt" "with space.txt" -- "-n" "star*.txt"
printf 'entries: '; printf '[%s] ' *; echo
for f in ./*; do                  # ./ prefix: "-n" can't be mistaken for an option
  printf 'file: %s\n' "${f#./}"
done
rm -- -n                          # -- ends options
ls
```

| Hazard | Defence |
|---|---|
| spaces, globs | quote: `"$f"` |
| leading `-` | `--` before operands, or `./*` globs |
| newlines in names | NUL-separated lists (`-print0`, `read -d ''`, `mapfile -d ''`) |
| no matches | `shopt -s nullglob` or `[[ -e $f ]] \|\| continue` |

## NUL-separated pipelines

Newlines are legal in file names, so line-based processing of file lists is never fully safe. NUL (`\0`) can't appear in a name:

```bash title="nul.sh" playground
cd ~/downloads
find . -type f -print0 | sort -z | while IFS= read -r -d '' f; do
  printf '%s -> %d bytes\n' "${f#./}" "$(wc -c < "$f")"
done
echo ---
find . -name '*.txt' -print0 | xargs -0 wc -l
```

## Validate early

Check everything you can **before** changing anything: arguments, files, permissions, dependencies, disk space. A script that fails at step 1 is harmless; one that fails at step 7 of 10 leaves a mess.

```bash title="validate.sh" playground
check_inputs() {
  local src=$1 dest=$2
  [[ -n $src && -n $dest ]]   || { echo "usage: copy SRC DEST" >&2; return 2; }
  [[ -r $src ]]               || { echo "cannot read $src" >&2; return 1; }
  [[ -d ${dest%/*} ]]         || { echo "no such directory: ${dest%/*}" >&2; return 1; }
  [[ ! -e $dest ]]            || { echo "refusing to overwrite $dest" >&2; return 1; }
  command -v sort > /dev/null || { echo "sort is required" >&2; return 1; }
}
check_inputs ~/notes.txt /tmp/notes.bak && echo "inputs OK"
check_inputs ~/missing /tmp/x 2>&1; echo "status $?"
check_inputs 2>&1; echo "status $?"
```

## Safe to interrupt, safe to re-run

| Pattern | Idiom |
|---|---|
| cleanup on exit | `trap 'rm -rf -- "$tmpdir"' EXIT` |
| atomic output | write to `"$out.tmp"`, then `mv -- "$out.tmp" "$out"` |
| single instance | `mkdir "$lockdir"` or `flock -n 9` |
| idempotent setup | `mkdir -p`, `ln -sfn`, `grep -q … \|\| echo … >>` |
| dry run | `run() { if (( DRY_RUN )); then echo "would run: $*"; else "$@"; fi; }` |

```bash title="dry-run.sh" playground
DRY_RUN=1
run() {
  if (( DRY_RUN )); then printf 'would run:'; printf ' %q' "$@"; echo
  else "$@"; fi
}
for f in ~/photos/*.JPG; do
  run mv -- "$f" "${f%.JPG}.jpg"
done
```

These patterns are explored further in Level 10's atomicity lesson.

## Common mistakes

```mistake
title: rm -rf with an empty variable
wrong: |
  rm -rf "$build_dir/"*      # if build_dir is empty: rm -rf /*
right: |
  : "${build_dir:?build_dir is not set}"
  rm -rf -- "${build_dir:?}/"*
why: "`${var:?}` aborts if the variable is unset or empty, so the command can never expand to `/`."
```

```mistake
title: Parsing ls
wrong: |
  for f in $(ls *.txt); do …
  ls -l | awk '{print $9}'
right: |
  for f in ./*.txt; do …
  stat -c '%n %s' -- ./*.txt     # GNU; or find -printf
why: ls output is for humans; names with spaces or newlines break any parsing of it.
```

## Practice

```exercise
kind: mcq
difficulty: intermediate
prompt: "A directory contains a file named `-rf`. Which command safely removes all `.log` files without risk of the name being read as options?"
options:
  - "`rm *.log`"
  - "`rm -- *.log`"
  - "`rm \"*.log\"`"
  - "`rm $(ls *.log)`"
answer: 1
explanation: "`--` marks the end of options, so every following word is an operand. `./*.log` works too."
```

```exercise
kind: find-bug
difficulty: intermediate
prompt: Which line can delete far more than intended?
code: |
  #!/usr/bin/env bash
  set -u
  cache_dir=$(get_cache_dir)
  echo "cleaning $cache_dir"
  rm -rf "$cache_dir"/*
answer: 5
fix: |
  rm -rf -- "${cache_dir:?}"/*
hints:
  - "What happens if get_cache_dir prints nothing? set -u doesn't help — the variable is set, just empty."
explanation: "An empty cache_dir turns the command into `rm -rf /*`. `${cache_dir:?}` aborts instead."
```

```exercise
kind: command
difficulty: intermediate
prompt: "Count the regular files under `~/downloads` using a NUL-safe pipeline: `find … -print0` piped into something that counts NUL-terminated records."
solution: find ~/downloads -type f -print0 | tr -cd '\0' | wc -c
explanation: "Each record ends in exactly one NUL, so counting NUL bytes counts files — even if names contain newlines."
```

## Challenge

```exercise
kind: script
difficulty: advanced
title: Harden a fragile script
prompt: "Rewrite the fragile script so it: uses strict mode; exits with `usage: count-ext DIR` on stderr and status 2 when no argument is given; dies with `not a directory: DIR` (status 1) for bad input; and prints a count per extension for files directly in DIR using quoted globs (no ls parsing). Sorted by extension. Test call: `~/downloads`."
starter: |
  #!/usr/bin/env bash
  # fragile version:
  # for f in $(ls $1); do echo ${f##*.}; done | sort | uniq -c
  main() {
    :
  }
  main ~/downloads
solution: |
  #!/usr/bin/env bash
  set -euo pipefail
  main() {
    (( $# == 1 )) || { echo "usage: count-ext DIR" >&2; exit 2; }
    local dir=$1 f name
    [[ -d $dir ]] || { echo "not a directory: $dir" >&2; exit 1; }
    declare -A count=()
    shopt -s nullglob
    for f in "$dir"/*; do
      [[ -f $f ]] || continue
      name=${f##*/}
      if [[ $name == *.* ]]; then (( ++count[${name##*.}] )); else (( ++count[none] )); fi
    done
    for ext in "${!count[@]}"; do
      printf '%s %d\n' "$ext" "${count[$ext]}"
    done | sort
  }
  main ~/downloads
expectedOutput: |
  gz 1
  mp3 1
  pdf 2
  txt 1
checks:
  - pattern: set -euo pipefail
    message: Use strict mode.
  - pattern: \bls\b
    forbid: true
    message: Don't parse ls output — use a glob.
hints:
  - "`${name##*.}` is the last extension."
  - "Use an associative array to count, then sort the printed lines."
explanation: "Validation first, quoted globs instead of ls, an associative array for counting: the same output, but correct for every possible file name."
```
