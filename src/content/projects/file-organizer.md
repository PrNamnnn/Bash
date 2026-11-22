## Problem

Your `~/downloads` folder is a mess: PDFs, archives, music, images and text files all mixed together, some with spaces and parentheses in their names. You want a script that tidies it by moving each file into a subfolder named after its category — `documents/`, `archives/`, `audio/`, `images/`, `text/` and `other/` — without ever overwriting or losing a file.

Because moving files is hard to undo, the script must **preview** by default and only move files when asked.

## Requirements

- Usage: `organize.sh [-x] [DIR]` — DIR defaults to `~/downloads`; without `-x` it only prints what it would do (dry run).
- Classify files by extension, case-insensitively: pdf/doc/docx/odt → documents; zip/tar/gz/tgz/7z → archives; mp3/wav/flac/ogg → audio; jpg/jpeg/png/gif/webp → images; txt/md/csv/log → text; anything else → other.
- Only regular files directly inside DIR are moved — never directories, and never files already in a category folder.
- Never overwrite: if `DIR/category/name` exists, append ` (1)`, ` (2)`, … before the extension.
- Print one line per file (`would move` / `moved`), then a summary with counts per category.
- Exit with status 2 on usage errors and 1 if DIR isn't a directory.

## Steps

### Step 1: Skeleton and arguments

Create the script with strict mode, a `usage` function and `getopts` for `-x`. Default the directory with `${1:-$HOME/downloads}` and validate it with `[[ -d … ]]`. Run it — it should accept the arguments and do nothing else yet.

### Step 2: Classify one file name

Write `category NAME` that lower-cases the extension (`${name##*.}` then `${ext,,}`) and maps it with a `case` statement. Names without a dot go to `other`. Test it on a few names before moving on: `category "Report.PDF"` → `documents`.

### Step 3: Loop over the files safely

Loop with `for f in "$dir"/*`, skip anything that isn't a regular file (`[[ -f $f ]] || continue`), and quote every expansion. Use `nullglob` so an empty folder doesn't produce a literal `*`.

### Step 4: Collision-free destination names

Write `unique_dest DIR NAME` that returns `DIR/NAME` if it's free, otherwise tries `base (1).ext`, `base (2).ext` … Split the name with `${name%.*}` and `${name##*.}`, taking care of names without an extension.

### Step 5: Dry run versus real moves

Print `would move NAME -> category/` in dry-run mode; with `-x`, `mkdir -p` the category and `mv -n --` the file, printing `moved …`. Count files per category in an associative array.

### Step 6: Summary and exit status

After the loop, print the counts in a fixed category order and `N file(s)` in total. Make sure the script exits 0 on success.

## Hints

- `shopt -s nullglob` before the loop makes `"$dir"/*` expand to nothing in an empty directory.
- `${f##*/}` gives the file name; `${name,,}` lower-cases it.
- A name like `README` has no extension: check `[[ $name == *.* ]]` before splitting.
- `mv -n` refuses to overwrite as an extra safety net even after your own collision check.
- Keep the counting in the parent shell — don't pipe into the loop.

## Expected output

Dry run on the sample `~/downloads`:

```text
would move invoice_jan.pdf -> documents/
would move music.mp3 -> audio/
would move notes (copy).txt -> text/
would move report-2026.pdf -> documents/
would move setup.tar.gz -> archives/

documents: 2
archives:  1
audio:     1
text:      1
5 file(s) — dry run, nothing moved (use -x to apply)
```

## Test cases

| Case | Command | Expect |
|---|---|---|
| default dry run | `organize.sh` | 5 "would move" lines, nothing changes on disk |
| apply | `organize.sh -x` then `ls ~/downloads` | only category folders remain |
| idempotent | run `-x` twice | second run reports `0 file(s)` |
| collision | create `documents/report-2026.pdf`, add another `report-2026.pdf`, run `-x` | new file becomes `report-2026 (1).pdf` |
| bad dir | `organize.sh /nope` | message on stderr, status 1 |
| bad option | `organize.sh -z` | usage on stderr, status 2 |

## Edge cases

- File names with spaces, parentheses, leading dashes (`-draft.txt`) and multiple dots (`backup.2026.tar.gz`).
- Upper-case extensions (`.JPG`, `.PDF`).
- Files without any extension (`Makefile`).
- An empty directory, or one containing only subdirectories.
- Hidden files (`.DS_Store`): decide explicitly — this solution leaves them alone.
- A category folder that already exists, or a *file* named like a category.

## Solution

```bash title="organize.sh" playground
#!/usr/bin/env bash
# organize.sh — sort files in a directory into category folders.
# Usage: organize.sh [-x] [DIR]    (dry run unless -x is given)
set -euo pipefail

readonly CATEGORIES=(documents archives audio images text other)

usage() { echo "usage: ${0##*/} [-x] [DIR]" >&2; exit 2; }
die()   { echo "${0##*/}: $*" >&2; exit 1; }

category() {
  local name=${1,,} ext
  [[ $name == *.* ]] || { echo other; return; }
  ext=${name##*.}
  case $ext in
    pdf|doc|docx|odt)        echo documents ;;
    zip|tar|gz|tgz|7z)       echo archives ;;
    mp3|wav|flac|ogg)        echo audio ;;
    jpg|jpeg|png|gif|webp)   echo images ;;
    txt|md|csv|log)          echo text ;;
    *)                       echo other ;;
  esac
}

unique_dest() {               # unique_dest DIR NAME -> prints a path that doesn't exist yet
  local dir=$1 name=$2 base ext="" n=1 candidate
  base=$name
  if [[ $name == ?*.* ]]; then base=${name%.*}; ext=.${name##*.}; fi
  candidate="$dir/$name"
  while [[ -e $candidate ]]; do
    candidate="$dir/$base ($n)$ext"
    (( n++ ))
  done
  printf '%s\n' "$candidate"
}

main() {
  local apply=0 opt OPTIND
  while getopts ':xh' opt; do
    case $opt in
      x) apply=1 ;;
      *) usage ;;
    esac
  done
  shift $((OPTIND - 1))
  (( $# <= 1 )) || usage
  local dir=${1:-$HOME/downloads}
  [[ -d $dir ]] || die "not a directory: $dir"

  shopt -s nullglob
  declare -A count=()
  local f name cat dest total=0
  for f in "$dir"/*; do
    [[ -f $f ]] || continue
    name=${f##*/}
    cat=$(category "$name")
    if (( apply )); then
      mkdir -p -- "$dir/$cat"
      dest=$(unique_dest "$dir/$cat" "$name")
      mv -n -- "$f" "$dest"
      echo "moved $name -> $cat/${dest##*/}"
    else
      echo "would move $name -> $cat/"
    fi
    count[$cat]=$(( ${count[$cat]:-0} + 1 ))
    (( ++total ))
  done

  echo
  for cat in "${CATEGORIES[@]}"; do
    [[ -n ${count[$cat]:-} ]] && printf '%-10s %d\n' "$cat:" "${count[$cat]}"
  done
  if (( apply )); then
    echo "$total file(s) moved"
  else
    echo "$total file(s) — dry run, nothing moved (use -x to apply)"
  fi
}

main "$@"
```

## Explanation

- **Dry run by default.** The dangerous action needs `-x`. Anyone can run the script to see what it *would* do — the single most important safety feature of file-moving tools.
- **`category`** isolates the classification rule. Lower-casing first (`${1,,}`) makes `.JPG` and `.jpg` equivalent, and the `case` statement is easy to extend.
- **`unique_dest`** guarantees no overwrite. The pattern `?*.*` treats `.bashrc`-style names as having no extension, so they become `.bashrc (1)` rather than ` (1).bashrc`.
- **Quoting and `--`** keep names like `notes (copy).txt` or `-n.txt` intact and stop them being read as options.
- **`nullglob`** makes an empty directory a no-op instead of an error about a file literally named `*`.
- **Counting in the main shell.** The loop isn't part of a pipeline, so the associative array survives for the summary.
- Running `-x` twice is safe: the second run finds only directories and reports `0 file(s) moved`.

## Extensions

- Add `-r` to process subdirectories recursively with `find -print0` and a NUL-safe loop.
- Read the extension → category mapping from a config file instead of hard-coding it.
- Add `-u` to undo the last run, using a log of `mv` operations written during `-x`.
- Sort images further into `images/YYYY-MM` folders by modification date (`stat -c %y` / `date -r`).
- Run it from cron every evening with logging to `~/.local/state/organize.log`.
