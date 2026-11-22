---
objectives:
  - Query Git from scripts using stable, machine-readable output (`--porcelain`, `rev-parse`, format strings)
  - Write safe automation: check for a clean tree, the right branch and upstream state before acting
  - Loop over many repositories and summarise their state
  - Use Git hooks to run checks automatically
summary:
  - "Use plumbing/porcelain-v1 output in scripts: `git status --porcelain`, `git rev-parse --abbrev-ref HEAD`, `git log --format='%h %s'`."
  - "Clean tree test: `[[ -z $(git status --porcelain) ]]`; inside a repo: `git rev-parse --is-inside-work-tree`."
  - "Ahead/behind: `git rev-list --left-right --count @{upstream}...HEAD`."
  - "`git -C DIR cmd` runs Git in another directory without `cd`."
  - "Hooks live in `.git/hooks/` (or `core.hooksPath`); a non-zero exit from `pre-commit` aborts the commit."
related:
  - script-architecture
  - ci-cd-scripts
  - deployment-scripts
---

## Script against stable output

Git's normal output is for humans and can change between versions or with the user's config (colours, language, pager). For scripts, use options designed for machines:

| Question | Command |
|---|---|
| Am I in a repo? | `git rev-parse --is-inside-work-tree` |
| Repo root | `git rev-parse --show-toplevel` |
| Current branch | `git rev-parse --abbrev-ref HEAD` (prints `HEAD` when detached) |
| Current commit | `git rev-parse --short HEAD` |
| Uncommitted changes? | `git status --porcelain` (empty = clean) |
| Ahead/behind upstream | `git rev-list --left-right --count @{u}...HEAD` |
| Latest tag | `git describe --tags --abbrev=0` |
| Commits since a tag | `git log --format='%h %an %s' v1.4.0..HEAD` |
| Files changed in last commit | `git diff --name-only HEAD~1 HEAD` |
| Does a branch exist? | `git show-ref --verify --quiet refs/heads/NAME` |

Format placeholders for `git log --format`: `%H` hash, `%h` short hash, `%an` author, `%ae` email, `%ad`/`%ar` date (absolute/relative), `%s` subject, `%d` refs.

## Parsing porcelain status

`git status --porcelain` prints two status columns and a path:

```text
 M src/app.js        modified, not staged
M  README.md         modified and staged
A  docs/new.md       added
?? notes.txt         untracked
R  old.js -> new.js  renamed
```

```bash title="porcelain.sh" playground
status_output() { cat <<'EOF'
 M src/app.js
M  README.md
A  docs/new.md
?? notes.txt
?? tmp/debug.log
 D old/legacy.sh
EOF
}
declare -A count
while IFS= read -r line; do
  code=${line:0:2}
  case $code in
    '??') kind=untracked ;;
    ' M'|'M '|'MM') kind=modified ;;
    'A '*) kind=added ;;
    *D*) kind=deleted ;;
    *) kind=other ;;
  esac
  (( ++count[$kind] ))
done < <(status_output)
for k in added deleted modified untracked; do printf '%-10s %d\n' "$k" "${count[$k]:-0}"; done
```

## Safety checks before acting

Automation that commits, tags, pushes or deploys should refuse to run in an unexpected state:

```bash
require_clean_main() {
  git rev-parse --is-inside-work-tree > /dev/null 2>&1 || die "not a git repository"
  [[ $(git rev-parse --abbrev-ref HEAD) == main ]]  || die "not on main"
  [[ -z $(git status --porcelain) ]]               || die "working tree has uncommitted changes"
  git fetch --quiet origin
  local behind ahead
  read -r behind ahead < <(git rev-list --left-right --count origin/main...HEAD)
  (( behind == 0 )) || die "main is $behind commit(s) behind origin — pull first"
  (( ahead == 0 ))  || die "main has $ahead unpushed commit(s)"
}
```

## A release helper

```bash
#!/usr/bin/env bash
set -euo pipefail
die() { echo "release: $*" >&2; exit 1; }

version=${1:?usage: release.sh X.Y.Z}
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "version must look like 1.2.3"
git show-ref --tags --verify --quiet "refs/tags/v$version" && die "tag v$version already exists"
require_clean_main

prev=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
{
  echo "## v$version ($(date +%F))"
  git log --format='- %s (%h)' ${prev:+"$prev"..}HEAD
} > /tmp/release-notes.md

git tag -a "v$version" -F /tmp/release-notes.md
git push origin "v$version"
echo "released v$version"
```

## Many repositories

```bash title="multi-repo.sh" playground
# Stand-in for `git -C "$repo" …` so the demo runs without Git:
fake_git() {
  local repo=$1; shift
  case "$repo:$*" in
    api:rev-parse*)      echo main ;;
    web:rev-parse*)      echo feature/login ;;
    worker:rev-parse*)   echo main ;;
    web:status*)         printf ' M src/login.js\n?? notes.txt\n' ;;
    *:status*)           ;;
  esac
}
printf '%-8s %-15s %s\n' REPO BRANCH STATE
for repo in api web worker; do
  branch=$(fake_git "$repo" rev-parse --abbrev-ref HEAD)
  changes=$(fake_git "$repo" status --porcelain | grep -c . || true)
  state=$([[ $changes -eq 0 ]] && echo clean || echo "$changes change(s)")
  printf '%-8s %-15s %s\n' "$repo" "$branch" "$state"
done
```

On a real machine, replace `fake_git "$repo"` with `git -C "$repo"` and find repositories with `find ~/code -maxdepth 2 -name .git -type d -printf '%h\n'`.

## Hooks

Git runs scripts in `.git/hooks/` at key moments. A non-zero exit from `pre-commit`, `commit-msg` or `pre-push` aborts the operation.

```bash
#!/usr/bin/env bash
# .git/hooks/pre-commit — lint staged shell scripts
set -euo pipefail
mapfile -t files < <(git diff --cached --name-only --diff-filter=ACM -- '*.sh')
(( ${#files[@]} )) || exit 0
shellcheck -- "${files[@]}"
```

Hooks in `.git/hooks` aren't committed; share them with `git config core.hooksPath .githooks` (a directory in the repo) or a tool like pre-commit.

## Common mistakes

```mistake
title: Parsing human-readable git output
wrong: |
  branch=$(git branch | grep '\*' | cut -d' ' -f2)    # breaks on detached HEAD, colours, i18n
right: |
  branch=$(git rev-parse --abbrev-ref HEAD)
why: Porcelain and plumbing commands have stable, documented output; human output doesn't.
```

```mistake
title: Automating on a dirty tree
wrong: |
  git add -A && git commit -m "automated update" && git push   # commits whatever is lying around
right: |
  [[ -z $(git status --porcelain) ]] || die "unexpected local changes"
  ./generate-docs.sh
  git add docs/ && git commit -m "docs: regenerate" && git push
why: Check the starting state, then stage only the paths your script produced.
```

## Practice

```exercise
kind: mcq
difficulty: beginner
prompt: Which command is best for checking in a script whether a working tree has uncommitted changes?
options:
  - "`git status | grep 'nothing to commit'`"
  - "`[[ -z $(git status --porcelain) ]]`"
  - "`git diff | wc -l`"
  - "`git log -1`"
answer: 1
explanation: "Porcelain output is empty exactly when the tree is clean (including untracked files)."
```

```exercise
kind: predict
difficulty: intermediate
prompt: "Given porcelain lines, what does this print?"
code: |
  printf ' M a.js\n?? b.txt\n?? c.txt\nA  d.md\n' | awk '{ n[$1]++ } END { print n["??"], n["M"], n["A"] }'
answer: 2 1 1
explanation: "awk splits on whitespace, so ` M` becomes `M`; two untracked, one modified, one added."
```

```exercise
kind: command
difficulty: intermediate
prompt: "A variable holds `out='3	5'` (behind, then ahead, tab-separated, as from `git rev-list --left-right --count`). Print `behind=3 ahead=5`."
solution: "out=$'3\\t5'; read -r behind ahead <<< \"$out\"; echo \"behind=$behind ahead=$ahead\""
explanation: "read splits on whitespace, including tabs."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Changelog from commit subjects
prompt: "Group the conventional-commit subjects below into sections: `### Features` (feat:), `### Fixes` (fix:) and `### Other` (anything else), listing each subject without its prefix as `- text`. Omit empty sections; keep input order within sections."
starter: |
  #!/usr/bin/env bash
  log='feat: add CSV export
  fix: handle empty input
  docs: update README
  feat(api): paginate results
  fix: correct timezone in reports
  chore: bump dependencies'
solution: |
  #!/usr/bin/env bash
  log='feat: add CSV export
  fix: handle empty input
  docs: update README
  feat(api): paginate results
  fix: correct timezone in reports
  chore: bump dependencies'
  feats=() fixes=() other=()
  while IFS= read -r line; do
    case $line in
      feat:*|feat\(*) feats+=("${line#*: }") ;;
      fix:*|fix\(*)   fixes+=("${line#*: }") ;;
      *)              other+=("${line#*: }") ;;
    esac
  done <<< "$log"
  section() {
    local title=$1; shift
    (( $# )) || return 0
    echo "### $title"
    printf -- '- %s\n' "$@"
  }
  section Features "${feats[@]}"
  section Fixes "${fixes[@]}"
  section Other "${other[@]}"
expectedOutput: |
  ### Features
  - add CSV export
  - paginate results
  ### Fixes
  - handle empty input
  - correct timezone in reports
  ### Other
  - update README
  - bump dependencies
hints:
  - "`case` patterns `feat:*|feat\\(*` cover both `feat:` and `feat(scope):`."
  - "`${line#*: }` removes everything up to the first `: `."
explanation: "In real use the input would be `git log --format=%s v1.2.0..HEAD` — the classification logic is the same."
```
