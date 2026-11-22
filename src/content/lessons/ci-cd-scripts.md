---
objectives:
  - Write CI scripts that behave the same locally and in the pipeline
  - Use the CI environment (variables, exit codes, grouping, annotations) correctly
  - Detect what changed to run only the relevant steps
  - Keep secrets safe and output readable in CI logs
summary:
  - "Put logic in versioned scripts (`ci/test.sh`) and keep the pipeline YAML thin: it just calls them."
  - "CI decides success by **exit status**: use `set -euo pipefail` and never swallow failures with `|| true` unless intended."
  - "Detect CI with `${CI:-}` (set by GitHub Actions, GitLab, CircleCI…); read context from provider variables like `GITHUB_SHA`, `GITHUB_REF_NAME`."
  - "Make logs readable: group sections, print the commands you run, and fail with a clear message."
  - "Never echo secrets; mask them, avoid `set -x` around them, and pass them via environment, not arguments."
related:
  - testing-shell-scripts
  - git-automation
  - deployment-scripts
---

## Thin YAML, real scripts

Pipelines written as long inline YAML are hard to test and impossible to run locally. Keep the YAML to wiring, and put the steps in scripts:

```yaml
# .github/workflows/ci.yml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ./ci/lint.sh
      - run: ./ci/test.sh
      - run: ./ci/build.sh
        if: github.ref == 'refs/heads/main'
```

Each script can be run on a laptop with exactly the same result — the most valuable property a CI step can have.

## A CI script template

```bash
#!/usr/bin/env bash
# ci/test.sh — run the test suite (locally or in CI)
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."          # always run from the repo root

trap 'echo "::error::ci/test.sh failed at line $LINENO: $BASH_COMMAND"' ERR

group()    { if [[ -n ${GITHUB_ACTIONS:-} ]]; then echo "::group::$*"; else echo "== $*"; fi; }
endgroup() { if [[ -n ${GITHUB_ACTIONS:-} ]]; then echo "::endgroup::"; fi; }
run()      { printf '+ %s\n' "$*"; "$@"; }

group "Static checks"
run shellcheck scripts/*.sh
run shfmt -d -i 2 scripts/
endgroup

group "Unit tests"
run bats test/
endgroup

echo "all checks passed"
```

## Reading the CI environment

| Variable | GitHub Actions | GitLab CI |
|---|---|---|
| running in CI? | `CI=true`, `GITHUB_ACTIONS=true` | `CI=true`, `GITLAB_CI=true` |
| commit | `GITHUB_SHA` | `CI_COMMIT_SHA` |
| branch / tag | `GITHUB_REF_NAME` | `CI_COMMIT_REF_NAME` |
| PR / MR? | `GITHUB_EVENT_NAME=pull_request` | `CI_MERGE_REQUEST_IID` |
| workspace | `GITHUB_WORKSPACE` | `CI_PROJECT_DIR` |
| step outputs | append to `$GITHUB_OUTPUT` | artifacts / dotenv reports |

```bash title="ci-env.sh" playground
# Pretend we're in GitHub Actions on a pull request
export CI=true GITHUB_ACTIONS=true GITHUB_SHA=4f2a9c1e8d GITHUB_REF_NAME=feature/login GITHUB_EVENT_NAME=pull_request
export GITHUB_OUTPUT=$(mktemp)

ci_context() {
  if [[ ${CI:-} != true ]]; then echo "local run"; return; fi
  local sha=${GITHUB_SHA:-${CI_COMMIT_SHA:-unknown}}
  local ref=${GITHUB_REF_NAME:-${CI_COMMIT_REF_NAME:-unknown}}
  echo "CI run: ref=$ref sha=${sha:0:7} event=${GITHUB_EVENT_NAME:-n/a}"
}
ci_context
version="1.4.0-${GITHUB_SHA:0:7}"
echo "version=$version" >> "$GITHUB_OUTPUT"       # make it available to later steps
cat "$GITHUB_OUTPUT"
[[ $GITHUB_EVENT_NAME == pull_request ]] && echo "skipping deploy for pull requests"
```

## Run only what changed

In monorepos, test only the parts touched by a change:

```bash title="changed.sh" playground
# Real: changed=$(git diff --name-only origin/main...HEAD)
changed='services/api/handlers/orders.go
services/api/go.mod
web/src/Login.tsx
docs/README.md'

declare -A targets
while IFS= read -r path; do
  case $path in
    services/api/*) targets[api]=1 ;;
    services/worker/*) targets[worker]=1 ;;
    web/*) targets[web]=1 ;;
    docs/*|*.md) ;;                       # docs never trigger builds
    *) targets[all]=1 ;;                  # unknown paths: be safe, run everything
  esac
done <<< "$changed"
if [[ -v targets[all] ]]; then echo "run: everything"; else
  for t in $(printf '%s\n' "${!targets[@]}" | sort); do echo "run: $t tests"; done
fi
```

## Secrets in CI

- Secrets arrive as environment variables; reference them only where needed (`TOKEN=$DEPLOY_TOKEN ./deploy.sh`).
- Most platforms mask known secret values in logs — but not transformed ones (base64, substrings). Don't print them at all.
- No `set -x` in scripts that handle secrets (or `set +x` around those lines).
- Prefer short-lived credentials (OIDC federation to your cloud) over long-lived keys.
- Pull requests from forks shouldn't get secrets — platforms restrict this by default; don't work around it.

## Common mistakes

```mistake
title: Hiding failures in pipelines
wrong: |
  npm test | tee test.log          # status of tee (0) — failures pass CI
  ./lint.sh || true                # someone "temporarily" silenced it
right: |
  set -o pipefail
  npm test | tee test.log
  ./lint.sh
why: CI only knows what the exit status tells it.
```

```mistake
title: Scripts that depend on the runner's cwd
wrong: |
  ./scripts/build.sh      # works only if the step starts at the repo root
right: |
  cd "$(dirname "${BASH_SOURCE[0]}")/.."   # inside each script
why: Scripts should locate themselves; CI steps, Makefiles and humans call them from different directories.
```

## Practice

```exercise
kind: mcq
difficulty: beginner
prompt: How does a CI system decide that a script step failed?
options:
  - It searches the log for the word "error"
  - The step's exit status is non-zero
  - Output was written to stderr
  - The step took longer than usual
answer: 1
explanation: Exit status is the contract; stderr output alone doesn't fail a step.
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  unset CI GITHUB_SHA
  echo "${CI:-false} ${GITHUB_SHA:-local}"
  CI=true GITHUB_SHA=abc123456 bash -c 'echo "$CI ${GITHUB_SHA:0:7}"'
answer: |
  false local
  true abc1234
explanation: Defaults apply when unset; the per-command environment is visible only to the child.
```

```exercise
kind: command
difficulty: intermediate
prompt: "Create a temporary file in `GITHUB_OUTPUT`, append `image=shop/api:4f2a9c1` to it in the GitHub Actions output format, and print the file."
solution: GITHUB_OUTPUT=$(mktemp); echo "image=shop/api:4f2a9c1" >> "$GITHUB_OUTPUT"; cat "$GITHUB_OUTPUT"
explanation: "Steps publish outputs by appending `name=value` lines to the file named by `$GITHUB_OUTPUT`."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Pipeline runner with a summary
prompt: "Write `step NAME COMMAND...` that runs a command, records `NAME: passed` or `NAME: FAILED (status N)` without stopping, and at the end prints the summary and exits 1 if any step failed. Run the given steps (one fails on purpose)."
starter: |
  #!/usr/bin/env bash
  results=() failed=0
  step() {
    :
  }
  step lint    grep -q '^port=' ~/.config/app.conf
  step unit    test -s ~/data/sales.csv
  step config  grep -q '^timeout=' ~/.config/app.conf
  step docs    test -r ~/notes.txt
solution: |
  #!/usr/bin/env bash
  results=() failed=0
  step() {
    local name=$1; shift
    if "$@" > /dev/null 2>&1; then
      results+=("$name: passed")
    else
      results+=("$name: FAILED (status $?)")
      failed=1
    fi
  }
  step lint    grep -q '^port=' ~/.config/app.conf
  step unit    test -s ~/data/sales.csv
  step config  grep -q '^timeout=' ~/.config/app.conf
  step docs    test -r ~/notes.txt
  printf '%s\n' "${results[@]}"
  exit "$failed"
expectedOutput: |
  lint: passed
  unit: passed
  config: FAILED (status 1)
  docs: passed
hints:
  - "Run the command with `\"$@\"` inside an if."
  - "`$?` in the else branch is the command's status."
explanation: "Running every step and reporting all failures at once saves a CI round-trip per failure; the final exit status still fails the job."
```
