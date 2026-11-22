## Problem

You have folders of camera images (`IMG_0001.JPG`), screenshots and downloads with inconsistent names. You want one tool that renames many files at once — lower-casing, replacing spaces, adding prefixes or sequence numbers, or substituting text — and that **shows a preview, detects collisions and never overwrites anything**.

## Requirements

- Usage: `rename.sh [options] FILE...` with transformations applied in this order:
  - `-s FROM/TO` replace all occurrences of FROM with TO (literal text)
  - `-l` lower-case the name (including the extension)
  - `-u` replace spaces with `_`
  - `-p PREFIX` add a prefix
  - `-n` number files: `001-name`, `002-name`, … in the order given
- Only the file *name* changes, never its directory.
- Without `-x`, print a preview `OLD -> NEW`; with `-x`, perform the renames.
- Before renaming anything, check the whole plan: abort if two files would get the same new name, or if a new name already exists and isn't one of the files being renamed.
- Files whose name doesn't change are reported as `unchanged`.
- Exit 0 on success, 1 on collisions or failures, 2 on usage errors.

## Steps

### Step 1: Parse options

Use `getopts 's:lup:nxh'`. Validate `-s` contains a `/` and split it with `${arg%%/*}` and `${arg#*/}`. Require at least one file.

### Step 2: Compute a new name

Write `new_name INDEX NAME` that applies the transformations in order with parameter expansion only: `${name//"$from"/$to}`, `${name,,}`, `${name// /_}`, the prefix, and `printf -v num '%03d' "$index"`.

### Step 3: Build the plan

Loop over the arguments, skip missing files with a warning, and store pairs in two arrays (`old[i]`, `new[i]`) with the directory preserved (`${f%/*}` — careful when there's no slash).

### Step 4: Detect collisions

Use an associative array keyed by the new path to find duplicates within the plan, then check `[[ -e $new ]]` for names that exist on disk and aren't part of the plan.

### Step 5: Preview or apply

Print the plan. With `-x`, rename using `mv -n --`. To support swaps such as `a -> b, b -> a`, rename in two phases: first to temporary names, then to the final names.

## Hints

- Quote the pattern in `${name//"$from"/$to}` so characters like `*` in FROM are literal.
- `dir=.; [[ $f == */* ]] && dir=${f%/*}` handles files given without a path.
- `printf -v var FORMAT …` assigns formatted output to a variable without a subshell.
- Collisions are cheaper to find *before* any rename than to undo afterwards.

## Expected output

```text
$ rename.sh -l -u -n ~/photos/*
IMG_0001.JPG -> 001-img_0001.jpg
IMG_0002.JPG -> 002-img_0002.jpg
IMG_0003.JPG -> 003-img_0003.jpg
holiday 2025.png -> 004-holiday_2025.png
screenshot.PNG -> 005-screenshot.png
preview only — run again with -x to rename 5 file(s)
```

## Test cases

| Case | Command | Expect |
|---|---|---|
| preview | `rename.sh -l ~/photos/*` | list of changes, no files touched |
| apply | `rename.sh -l -x ~/photos/*` | names lower-cased on disk |
| substitution | `rename.sh -s IMG_/photo- ~/photos/*` | `photo-0001.JPG` … |
| internal collision | two files `A.txt`, `a.txt` with `-l` | abort, status 1, nothing renamed |
| external collision | `b.txt` exists, rename `a.txt` to `b.txt` | abort, status 1 |
| no-op | `rename.sh -l already_lower.txt` | `unchanged` |
| missing file | `rename.sh -l nope.txt` | warning, status 1 |

## Edge cases

- Names with spaces, quotes, `*`, leading dashes or no extension.
- `-s` with an empty TO (`-s " (copy)/"` removes the text).
- The same file given twice on the command line.
- Case-insensitive filesystems (macOS default) where `A.txt` → `a.txt` is a collision with itself.
- Renames that would produce an empty name or a name starting with `-`.

## Solution

```bash title="rename.sh" playground
#!/usr/bin/env bash
# rename.sh — preview-first bulk renamer with collision detection.
set -euo pipefail
PROG=${0##*/}

usage() { echo "usage: $PROG [-s FROM/TO] [-l] [-u] [-p PREFIX] [-n] [-x] FILE..." >&2; exit 2; }

FROM="" TO="" LOWER=0 UNDERSCORE=0 PREFIX="" NUMBER=0 APPLY=0

new_name() {                      # new_name INDEX NAME
  local i=$1 name=$2 num
  [[ -n $FROM ]] && name=${name//"$FROM"/$TO}
  (( LOWER )) && name=${name,,}
  (( UNDERSCORE )) && name=${name// /_}
  name=$PREFIX$name
  if (( NUMBER )); then printf -v num '%03d' "$i"; name="$num-$name"; fi
  printf '%s\n' "$name"
}

main() {
  local opt OPTIND
  FROM="" TO="" LOWER=0 UNDERSCORE=0 PREFIX="" NUMBER=0 APPLY=0   # fresh settings per call
  while getopts ':s:lup:nxh' opt; do
    case $opt in
      s) [[ $OPTARG == */* ]] || usage; FROM=${OPTARG%%/*}; TO=${OPTARG#*/} ;;
      l) LOWER=1 ;;
      u) UNDERSCORE=1 ;;
      p) PREFIX=$OPTARG ;;
      n) NUMBER=1 ;;
      x) APPLY=1 ;;
      *) usage ;;
    esac
  done
  shift $((OPTIND - 1))
  (( $# )) || usage

  local -a old=() new=()
  local f dir name target i=0 status=0
  declare -A seen=() planned=()
  for f in "$@"; do
    [[ -e $f ]] || { echo "$PROG: no such file: $f" >&2; status=1; continue; }
    [[ -v planned[$f] ]] && continue          # same file given twice
    planned[$f]=1
    (( ++i ))
    dir=.; [[ $f == */* ]] && dir=${f%/*}
    name=${f##*/}
    target="$dir/$(new_name "$i" "$name")"
    [[ ${target##*/} == -* || ${target##*/} == "" ]] && { echo "$PROG: refusing unsafe name for $f" >&2; return 1; }
    old+=("$f"); new+=("$target")
  done

  # collisions: inside the plan, and with files that aren't being renamed
  for i in "${!new[@]}"; do
    if [[ -v seen[${new[i]}] ]]; then
      echo "$PROG: collision: ${old[i]} and ${seen[${new[i]}]} would both become ${new[i]##*/}" >&2
      return 1
    fi
    seen[${new[i]}]=${old[i]}
    if [[ ${new[i]} != "${old[i]}" && -e ${new[i]} && ! -v planned[${new[i]}] ]]; then
      echo "$PROG: ${new[i]##*/} already exists" >&2
      return 1
    fi
  done

  local count=0
  for i in "${!old[@]}"; do
    if [[ ${old[i]} == "${new[i]}" ]]; then
      echo "unchanged ${old[i]##*/}"
    else
      echo "${old[i]##*/} -> ${new[i]##*/}"
      (( ++count ))
    fi
  done

  if (( ! APPLY )); then
    echo "preview only — run again with -x to rename $count file(s)"
    return "$status"
  fi
  # two-phase rename so that swaps (a->b, b->a) work
  for i in "${!old[@]}"; do
    [[ ${old[i]} == "${new[i]}" ]] || mv -n -- "${old[i]}" "${old[i]}.renaming.$$"
  done
  for i in "${!old[@]}"; do
    [[ ${old[i]} == "${new[i]}" ]] || mv -n -- "${old[i]}.renaming.$$" "${new[i]}"
  done
  echo "renamed $count file(s)"
  return "$status"
}

# Playground demo (on a real system: main "$@")
cd ~/photos
main -l -u -n ./*
echo ---
main -s IMG_/photo- -x ./IMG_*
ls
```

## Explanation

- **Plan first, act later.** All new names are computed and checked before any file is touched; a collision aborts with nothing half-renamed.
- **Pure parameter expansion** (`//`, `,,`, `printf -v`) means no `sed`/`tr` process per file — fast even for thousands of files — and no surprises from regex metacharacters.
- **Quoted pattern** in `${name//"$FROM"/$TO}` makes FROM literal, so `-s "*"/x` replaces asterisks rather than everything.
- **Two maps:** `seen` finds duplicate targets within the plan; `planned` lets a target that is itself being renamed away count as free.
- **Two-phase renaming** via temporary names handles cycles (`a`↔`b`) that a single pass would break.
- **`./*`** in the demo, `--` before operands, and the "starts with `-`" check keep odd names from becoming options.

## Extensions

- Add `-r REGEX/REPL` using `[[ =~ ]]` and `BASH_REMATCH` for capture groups.
- Write an undo file (`old<TAB>new` per line) during `-x` and add `--undo FILE`.
- Add `-d` to prefix names with the file's modification date (`date -r FILE +%F`).
- Support recursive renaming with `find -print0` while still checking collisions per directory.
- Detect case-insensitive filesystems and handle case-only renames safely.
