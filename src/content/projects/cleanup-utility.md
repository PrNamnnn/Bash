## Problem

Temporary files, old logs and stale caches pile up until a disk fills. A cleanup job is the fix — and also one of the most dangerous scripts you can write: one wrong variable and it deletes the wrong tree.

Build `cleanup.sh`: a configurable, auditable cleaner with layered safety rails.

## Requirements

- Usage: `cleanup.sh [-d DAYS] [-s MINSIZE] [-p PATTERN]... [-x] [-y] DIR...`
  - `-d DAYS` only files not modified for more than DAYS days (default 7)
  - `-s MINSIZE` only files at least this big (`10k`, `5M`, `1G`; default: any size)
  - `-p PATTERN` name globs to match (repeatable; default `*.tmp`, `*.log.*`, `*.bak`)
  - `-x` actually delete (default is a dry run); `-y` skip the confirmation prompt
- Refuse dangerous targets: `/`, `/home`, `/etc`, `/usr`, `$HOME` itself, and anything that isn't an existing directory.
- Never follow symlinks, never cross filesystems, never delete directories (only files).
- Print each candidate with size and age, then a summary: number of files and total size.
- In apply mode without `-y`, ask for confirmation showing the summary; abort on anything but `yes`.
- Log deletions to `~/.local/state/cleanup.log` with a timestamp.

## Steps

### Step 1: Options and size parsing

Parse options with `getopts` (collect `-p` values into an array). Write `to_bytes SIZE` that converts `10k`/`5M`/`1G` to bytes and rejects anything else.

### Step 2: The safety gate

Write `assert_safe DIR` that resolves the directory (`cd DIR && pwd -P`), refuses the protected list and requires the directory to exist. Call it for every argument before doing anything else.

### Step 3: Find candidates safely

Build a `find` command as an **array**: `find "$dir" -xdev -type f -mtime +"$days" \( -name p1 -o -name p2 … \) -print0`. Read results with `while IFS= read -r -d '' f`.

### Step 4: Filter by size and report

For each candidate get the size (`stat -c %s`) and age in days, skip files smaller than MINSIZE, print a line and accumulate totals.

### Step 5: Confirm and delete

In apply mode, show the summary and ask `Type "yes" to delete N files:` (unless `-y`). Delete with `rm -f --` one file at a time, logging each, and count failures.

### Step 6: Exit status

Exit 0 when everything requested succeeded, 1 if any deletion failed, 2 on usage or safety errors.

## Hints

- Build the `-name` alternatives in a loop: `expr+=(-o -name "$p")`, then drop the first `-o`.
- `find -mtime +7` means "more than 7 full days ago".
- `pwd -P` resolves symlinks, so `assert_safe` can't be fooled by a link to `/`.
- Read confirmation from the terminal (`read -r answer < /dev/tty`) so piping a file list in can't auto-confirm.
- Collect candidates first, then delete — so the summary and the actions match exactly.

## Expected output

```text
$ cleanup.sh -d 7 /tmp/demo
     2.0K   10d  /tmp/demo/build/cache.tmp
     1.0K   30d  /tmp/demo/old.bak
     5.0K   12d  /tmp/demo/logs/app.log.3
3 file(s), 8.0K — dry run (use -x to delete)
```

## Test cases

| Case | Command | Expect |
|---|---|---|
| dry run | `cleanup.sh /tmp/demo` | candidates listed, nothing deleted |
| apply | `cleanup.sh -x -y /tmp/demo` | files deleted, logged |
| age filter | recent `.tmp` file | not listed |
| size filter | `-s 2k` | only files ≥ 2 KiB |
| protected | `cleanup.sh /` or `cleanup.sh ~` | refused, status 2 |
| symlink trap | `/tmp/demo/link -> /etc` | not followed |
| empty variable | `cleanup.sh ""` | refused, status 2 |
| no match | clean directory | `0 file(s)` |

## Edge cases

- File names with spaces, newlines or leading dashes.
- Files that disappear between listing and deleting (already removed by another process).
- Files you don't have permission to delete.
- Patterns that should also match hidden files (`.*.swp`).
- Very large result sets — avoid building giant strings; stream with NUL separators.

## Solution

```bash title="cleanup.sh" playground
#!/usr/bin/env bash
# cleanup.sh — age/size/pattern-based file cleanup with safety rails.
set -euo pipefail
PROG=${0##*/}
LOG=${CLEANUP_LOG:-$HOME/.local/state/cleanup.log}
PROTECTED=(/ /bin /boot /dev /etc /home /lib /proc /root /sbin /sys /usr /var "$HOME")

usage() { echo "usage: $PROG [-d DAYS] [-s MINSIZE] [-p PATTERN]... [-x] [-y] DIR..." >&2; exit 2; }
die()   { echo "$PROG: $*" >&2; exit 2; }

to_bytes() {
  local n=${1%[kKmMgG]} unit=${1:${#1}-1}
  [[ $n =~ ^[0-9]+$ ]] || return 1
  case $unit in
    k|K) echo $(( n * 1024 )) ;;
    m|M) echo $(( n * 1024 * 1024 )) ;;
    g|G) echo $(( n * 1024 * 1024 * 1024 )) ;;
    [0-9]) echo "$1" ;;
    *) return 1 ;;
  esac
}
human() { awk -v b="$1" 'BEGIN { split("B K M G T", u); i = 1; while (b >= 1024 && i < 5) { b /= 1024; i++ } printf (i == 1 ? "%d%s" : "%.1f%s"), b, u[i] }'; }

assert_safe() {
  local d=$1 real p
  [[ -n $d ]] || die "empty directory argument"
  [[ -d $d ]] || die "not a directory: $d"
  real=$(cd -- "$d" && pwd -P) || die "cannot enter $d"
  for p in "${PROTECTED[@]}"; do
    [[ $real == "$p" ]] && die "refusing to clean protected directory: $real"
  done
  printf '%s\n' "$real"
}

main() {
  local days=7 minsize=0 apply=0 yes=0 opt OPTIND
  local -a patterns=()
  while getopts ':d:s:p:xyh' opt; do
    case $opt in
      d) [[ $OPTARG =~ ^[0-9]+$ ]] || usage; days=$OPTARG ;;
      s) minsize=$(to_bytes "$OPTARG") || die "bad size: $OPTARG" ;;
      p) patterns+=("$OPTARG") ;;
      x) apply=1 ;;
      y) yes=1 ;;
      *) usage ;;
    esac
  done
  shift $((OPTIND - 1))
  (( $# )) || usage
  (( ${#patterns[@]} )) || patterns=('*.tmp' '*.log.*' '*.bak')

  local -a dirs=() expr=()
  local d p real
  for d in "$@"; do                     # every target is checked before any work
    real=$(assert_safe "$d") || exit 2  # explicit: set -e is ignored when main runs under || or if
    dirs+=("$real")
  done
  for p in "${patterns[@]}"; do expr+=(-o -name "$p"); done
  expr=("${expr[@]:1}")

  local -a files=()
  local f size age total=0 now
  now=$(date +%s)
  for d in "${dirs[@]}"; do
    while IFS= read -r -d '' f; do
      size=$(stat -c %s -- "$f")
      (( size >= minsize )) || continue
      age=$(( (now - $(stat -c %Y -- "$f")) / 86400 ))
      printf '%9s %5sd  %s\n' "$(human "$size")" "$age" "$f"
      files+=("$f")
      total=$(( total + size ))     # not (( total += size )): that is "false" when the sum is 0
    done < <(find "$d" -xdev -type f -mtime +"$days" \( "${expr[@]}" \) -print0 | sort -z)
  done

  local summary="${#files[@]} file(s), $(human "$total")"
  if (( ! apply )); then echo "$summary — dry run (use -x to delete)"; return 0; fi
  (( ${#files[@]} )) || { echo "$summary — nothing to delete"; return 0; }
  if (( ! yes )); then
    local answer
    read -r -p "Type \"yes\" to delete $summary: " answer < /dev/tty || answer=""
    [[ $answer == yes ]] || { echo "aborted"; return 1; }
  fi
  mkdir -p -- "${LOG%/*}"
  local failed=0
  for f in "${files[@]}"; do
    if rm -f -- "$f"; then printf '%s deleted %s\n' "$(date '+%F %T')" "$f" >> "$LOG"
    else (( ++failed )); fi
  done
  echo "deleted $(( ${#files[@]} - failed )) of ${#files[@]} file(s), $(human "$total") freed"
  (( failed == 0 ))
}

# ---- playground demo: build a sample directory, then run a dry run and a real run ----
demo=/tmp/demo; rm -rf "$demo"; mkdir -p "$demo"/{build,logs}
printf '%2048s' '' > "$demo/build/cache.tmp";  touch -d '10 days ago' "$demo/build/cache.tmp"
printf '%1024s' '' > "$demo/old.bak";          touch -d '30 days ago' "$demo/old.bak"
printf '%5120s' '' > "$demo/logs/app.log.3";   touch -d '12 days ago' "$demo/logs/app.log.3"
echo "fresh" > "$demo/new.tmp"
ln -s /etc "$demo/etc-link"
main -d 7 "$demo"
echo ---
main -x -y -s 2k "$demo"
( main / ) 2>&1 || true
ls -R "$demo"
```

## Explanation

- **Explicit failure checks.** `real=$(assert_safe "$d") || exit 2` doesn't rely on `set -e`, which is silently disabled when `main` is called as part of `||`, `&&` or an `if` condition (as the demo's `( main / ) || true` does).
- **Validate everything first.** `assert_safe` runs for every directory before any file is listed, and resolves symlinks with `pwd -P`, so `/tmp/link-to-root` can't sneak past the protected list.
- **`find` arguments as an array** keep patterns like `*.tmp` from being expanded by the shell and make the `-o` chain easy to build.
- **`-xdev -type f`** — never crosses into other filesystems, never matches directories or symlinks, and `find` doesn't follow links by default.
- **NUL-separated results** (`-print0`, `read -d ''`, `sort -z`) handle every possible file name.
- **Plan, then act:** the candidate list is collected first, so the confirmation shows exactly what will be deleted.
- **Confirmation from `/dev/tty`** can't be satisfied accidentally by piped input; `-y` exists for cron.
- **An audit log** records every deletion, which turns "what happened to my file?" into a grep.

## Extensions

- Add `--max-delete N` to stop if more files than expected match (a common sign of a bad pattern).
- Move files to a quarantine directory first and purge it a week later.
- Read cleanup rules (dir, days, patterns) from a config file and process them all.
- Report freed space per directory and per pattern.
- Run from a systemd timer with `Nice=19` and `IOSchedulingClass=idle`.
