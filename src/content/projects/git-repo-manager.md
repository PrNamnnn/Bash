## Problem

You work across dozens of Git repositories in `~/code`. Every morning you want to know which have uncommitted work, which are behind their remote, and which are on unexpected branches — and you want to fast-forward the clean ones safely in one command, without ever touching repositories that have local changes.

Build `repos.sh` with `status`, `pull` and `each` subcommands.

## Requirements

- Discover repositories under a root (default `~/code`, depth 3) by looking for `.git` directories; allow an explicit list of paths.
- `repos.sh status` prints a table: repo, branch, ahead/behind counts, number of changed and untracked files, and a state label (`clean`, `dirty`, `behind`, `ahead`, `diverged`, `detached`, `no-upstream`).
- `repos.sh pull` runs `git pull --ff-only` only in repositories that are clean, on a branch, with an upstream; it skips the rest with a reason and summarises.
- `repos.sh each -- CMD…` runs a command in every repository and reports which failed.
- `-f` fetches before reporting status; fetches run in parallel with a limit (default 4).
- Use machine-readable Git output only (`rev-parse`, `status --porcelain`, `rev-list --count`).
- Exit non-zero if any repository failed during `pull` or `each`.

## Steps

### Step 1: Find repositories

Use `find "$root" -maxdepth 3 -type d -name .git -prune -print0` and strip the `/.git` suffix. Store them in an array, sorted.

### Step 2: Inspect one repository

Write `repo_info DIR` that prints one tab-separated line: branch (`git -C DIR rev-parse --abbrev-ref HEAD`), upstream (`@{u}` or empty), ahead/behind (`rev-list --left-right --count @{u}...HEAD`), changed and untracked counts (from `status --porcelain`).

### Step 3: Classify

Turn the numbers into a state label in a single function with clear precedence: detached → dirty → no-upstream → diverged → behind → ahead → clean.

### Step 4: The status table

Print a header and one aligned row per repository, colouring states when stdout is a terminal (`[[ -t 1 ]]`).

### Step 5: Safe bulk pull

For each repo, compute the state and only pull when it's `behind` (or `clean`, to pick up new commits after a fetch). Never use `git pull` without `--ff-only` in automation.

### Step 6: Parallel fetch and `each`

Fetch in the background with a concurrency limit (`wait -n`), collecting failures. Implement `each` with `( cd "$repo" && "$@" )` and per-repo status.

## Hints

- `git -C DIR …` avoids `cd` and keeps paths simple.
- `git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null` fails when there's no upstream — use that to detect it.
- Count porcelain lines with `grep -c '^??'` (untracked) and `grep -vc '^??'` (changed); remember grep returns 1 on zero matches.
- Keep the Git calls in small functions so you can stub them for testing.
- `printf '%-20s %-15s …'` aligns columns without `column`.

## Expected output

```text
REPO            BRANCH          UP/DOWN  CHANGES  STATE
api             main            0/0      0        clean
billing         main            0/3      0        behind
web             feature/login   2/0      2+1?     dirty
worker          HEAD            -        0        detached
docs            main            -        0        no-upstream

$ repos.sh pull
api: up to date
billing: fast-forwarded 3 commit(s)
web: skipped (dirty)
worker: skipped (detached)
docs: skipped (no-upstream)
pull: 2 ok, 3 skipped, 0 failed
```

## Test cases

| Case | Setup | Expect |
|---|---|---|
| clean repo | fresh clone | `clean`, pull is a no-op |
| dirty | modify a tracked file | `dirty`, pull skips it |
| untracked only | new file | counted as `1?`, still dirty |
| behind | remote has new commits, `-f` | `behind`, pull fast-forwards |
| diverged | local and remote commits | `diverged`, pull skips (`--ff-only` would fail) |
| detached | `git checkout <sha>` | `detached`, skipped |
| `each` failure | `each -- false` | every repo listed as failed, exit 1 |

## Edge cases

- Repository paths with spaces.
- Submodules and nested repositories (prune at the first `.git`).
- Bare repositories (no work tree) — skip them.
- Repositories with a stash, rebase or merge in progress (`.git/rebase-merge`, `MERGE_HEAD`).
- Remotes requiring credentials: never prompt (`GIT_TERMINAL_PROMPT=0`).

## Solution

```bash title="repos.sh" playground
#!/usr/bin/env bash
# repos.sh — status and safe bulk operations across many Git repositories.
set -uo pipefail
PROG=${0##*/}
export GIT_TERMINAL_PROMPT=0

# ---- Git access layer. Real implementation:
#   branch_of()   { git -C "$1" rev-parse --abbrev-ref HEAD; }
#   upstream_of() { git -C "$1" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null; }
#   counts_of()   { git -C "$1" rev-list --left-right --count '@{u}...HEAD'; }   # "behind ahead"
#   porcelain()   { git -C "$1" status --porcelain; }
#   ff_pull()     { git -C "$1" pull --ff-only --quiet; }
# ---- Playground stand-ins describing five sample repositories:
declare -A B=([api]=main [billing]=main [web]=feature/login [worker]=HEAD [docs]=main)
declare -A U=([api]=origin/main [billing]=origin/main [web]=origin/feature/login [worker]="" [docs]="")
declare -A C=([api]="0 0" [billing]="3 0" [web]="0 2" [worker]="0 0" [docs]="0 0")
declare -A P=([web]=$' M src/login.js\n M src/app.js\n?? notes.txt')
branch_of()   { echo "${B[${1##*/}]}"; }
upstream_of() { [[ -n ${U[${1##*/}]} ]] && echo "${U[${1##*/}]}"; }
counts_of()   { echo "${C[${1##*/}]}"; }
porcelain()   { [[ -n ${P[${1##*/}]:-} ]] && printf '%s\n' "${P[${1##*/}]}"; return 0; }
ff_pull()     { C[${1##*/}]="0 0"; }
find_repos()  { printf '%s\n' ~/code/api ~/code/billing ~/code/web ~/code/worker ~/code/docs; }
# Real: find_repos() { find "${1:-$HOME/code}" -maxdepth 3 -type d -name .git -prune -print | sed 's#/\.git$##' | sort; }

# ---- logic ----
info() {      # info DIR -> branch upstream behind ahead changed untracked
  local d=$1 br up behind=0 ahead=0 st changed untracked
  br=$(branch_of "$d")
  up=$(upstream_of "$d") || up=""
  [[ -n $up ]] && read -r behind ahead <<< "$(counts_of "$d")"
  st=$(porcelain "$d")
  untracked=$(grep -c '^??' <<< "$st" || true)
  changed=$(grep -c . <<< "$st" || true); changed=$(( changed - untracked ))
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$br" "${up:--}" "$behind" "$ahead" "$changed" "$untracked"
}
classify() {  # classify BRANCH UPSTREAM BEHIND AHEAD CHANGED UNTRACKED
  if [[ $1 == HEAD ]]; then echo detached
  elif (( $5 + $6 > 0 )); then echo dirty
  elif [[ $2 == - ]]; then echo no-upstream
  elif (( $3 > 0 && $4 > 0 )); then echo diverged
  elif (( $3 > 0 )); then echo behind
  elif (( $4 > 0 )); then echo ahead
  else echo clean; fi
}

cmd_status() {
  local repo br up behind ahead changed untracked state updown changes
  printf '%-15s %-15s %-8s %-8s %s\n' REPO BRANCH UP/DOWN CHANGES STATE
  while IFS= read -r repo; do
    IFS=$'\t' read -r br up behind ahead changed untracked < <(info "$repo")
    state=$(classify "$br" "$up" "$behind" "$ahead" "$changed" "$untracked")
    updown="$ahead/$behind"; [[ $up == - ]] && updown=-
    changes=$changed; (( untracked )) && changes+="+${untracked}?"
    printf '%-15s %-15s %-8s %-8s %s\n' "${repo##*/}" "$br" "$updown" "$changes" "$state"
  done < <(find_repos)
}

cmd_pull() {
  local repo ok=0 skipped=0 failed=0 state behind
  while IFS= read -r repo; do
    IFS=$'\t' read -r br up behind ahead changed untracked < <(info "$repo")
    state=$(classify "$br" "$up" "$behind" "$ahead" "$changed" "$untracked")
    case $state in
      clean)  echo "${repo##*/}: up to date"; (( ++ok )) ;;
      behind) if ff_pull "$repo"; then echo "${repo##*/}: fast-forwarded $behind commit(s)"; (( ++ok ))
              else echo "${repo##*/}: pull FAILED"; (( ++failed )); fi ;;
      *)      echo "${repo##*/}: skipped ($state)"; (( ++skipped )) ;;
    esac
  done < <(find_repos)
  echo "pull: $ok ok, $skipped skipped, $failed failed"
  (( failed == 0 ))
}

cmd_each() {
  [[ ${1:-} == -- ]] && shift
  (( $# )) || { echo "usage: $PROG each -- COMMAND..." >&2; return 2; }
  local repo failed=0
  while IFS= read -r repo; do
    if ( cd -- "$repo" 2>/dev/null && "$@" ) > /dev/null 2>&1; then echo "${repo##*/}: ok"
    else echo "${repo##*/}: FAILED"; (( ++failed )); fi
  done < <(find_repos)
  (( failed == 0 ))
}

main() {
  local cmd=${1:-status}; shift || true
  case $cmd in
    status) cmd_status ;;
    pull)   cmd_pull ;;
    each)   cmd_each "$@" ;;
    *) echo "usage: $PROG {status|pull|each -- CMD...}" >&2; return 2 ;;
  esac
}

main status
echo
main pull
echo
main status
```

## Explanation

- **A thin Git access layer** (`branch_of`, `counts_of`, `porcelain`, …) is the only place that talks to Git. The playground replaces it with sample data; tests can do the same. The logic above it doesn't change.
- **Porcelain and plumbing only:** `rev-parse`, `rev-list --count` and `status --porcelain` have stable output across Git versions and user configurations.
- **One classification function** with explicit precedence makes the table and the `pull` safety decision agree by construction.
- **Pull is conservative:** only repositories that are clean, attached and tracking an upstream are touched, and `--ff-only` refuses to create merge commits. Everything else is reported with the reason.
- **Process substitution** (`while … done < <(find_repos)`) keeps counters in the main shell for the summary.
- **`GIT_TERMINAL_PROMPT=0`** ensures a repository needing credentials fails fast instead of hanging the whole run.

## Extensions

- Parallel `fetch` with a concurrency limit and a per-repo timeout (`timeout 30 git fetch`).
- Detect in-progress merges/rebases and stashes and show them in the table.
- A `prune` subcommand listing local branches already merged into `main`.
- Read the repository list from a file and clone any that are missing.
- JSON output for dashboards (`-j`).
