---
objectives:
  - Structure scripts so their functions can be tested in isolation
  - Write assertion helpers and table-driven tests in plain Bash
  - Use Bats (Bash Automated Testing System) for real test suites
  - Run ShellCheck and tests automatically in CI
summary:
  - "Testable scripts keep logic in functions and guard `main` with `[[ ${BASH_SOURCE[0]} == \"$0\" ]]` so tests can `source` them."
  - "A test checks a function's stdout, stderr and exit status for given inputs — and nothing else."
  - "Isolate tests from the real system: temp directories (`mktemp -d`), stub commands as functions, controlled environment variables."
  - "Bats: `@test \"name\" { run cmd; [ \"$status\" -eq 0 ]; [ \"$output\" = \"…\" ]; }`."
  - "CI pipeline: `shellcheck *.sh`, `shfmt -d .`, `bats test/` on every push."
related:
  - script-architecture
  - debugging-scripts
  - ci-cd-scripts
---

## Why test shell scripts?

Shell scripts run deployments, backups and cleanups — the code where a bug deletes the wrong directory. Yet they are rarely tested, because they're written as one long sequence of side effects. The fix starts with structure.

## Make it testable

1. Put logic in **functions** that take arguments and print results.
2. Keep side effects (deleting, uploading, restarting) in a few small functions you can replace in tests.
3. Guard the entry point so sourcing doesn't run anything:

```bash
# lib under test: semver.sh
semver_bump() {
  local version=$1 part=$2 major minor patch
  IFS=. read -r major minor patch <<< "${version#v}"
  case $part in
    major) echo "$((major + 1)).0.0" ;;
    minor) echo "$major.$((minor + 1)).0" ;;
    patch) echo "$major.$minor.$((patch + 1))" ;;
    *) echo "unknown part: $part" >&2; return 2 ;;
  esac
}
main() { semver_bump "$@"; }
[[ ${BASH_SOURCE[0]} == "$0" ]] && main "$@"
```

## A tiny test harness

You don't need a framework to start:

```bash title="harness.sh" playground
semver_bump() {
  local version=$1 part=$2 major minor patch
  IFS=. read -r major minor patch <<< "${version#v}"
  case $part in
    major) echo "$((major + 1)).0.0" ;;
    minor) echo "$major.$((minor + 1)).0" ;;
    patch) echo "$major.$minor.$((patch + 1))" ;;
    *) echo "unknown part: $part" >&2; return 2 ;;
  esac
}

pass=0 fail=0
assert_eq() {     # assert_eq EXPECTED ACTUAL MESSAGE
  if [[ $1 == "$2" ]]; then (( ++pass )); else (( ++fail )); echo "FAIL: $3: expected '$1', got '$2'"; fi
}
assert_status() { # assert_status EXPECTED MESSAGE -- command...
  local want=$1 msg=$2; shift 3
  "$@" > /dev/null 2>&1; local got=$?
  assert_eq "$want" "$got" "$msg (status)"
}

# table-driven tests: input, part, expected
while read -r input part expected; do
  assert_eq "$expected" "$(semver_bump "$input" "$part")" "bump $input $part"
done <<'EOF'
1.2.3 patch 1.2.4
1.2.3 minor 1.3.0
1.2.3 major 2.0.0
v0.9.9 patch 0.9.10
EOF
assert_status 2 "invalid part" -- semver_bump 1.0.0 huge

echo "$pass passed, $fail failed"
(( fail == 0 ))
```

## Isolating side effects

Tests must not touch real files or services. Techniques:

| Technique | Example |
|---|---|
| temp workspace | `TEST_DIR=$(mktemp -d)`; point the script at it via a variable |
| configurable paths | `: "${BACKUP_ROOT:=/srv/backups}"` → tests set `BACKUP_ROOT=$TEST_DIR` |
| stub commands as functions | `curl() { echo '{"ok":true}'; }` defined before calling the code |
| stub commands on PATH | put fake executables in `$TEST_DIR/bin` and prepend it to PATH |
| fixed time / randomness | inject `NOW=2026-11-17` instead of calling `date` directly |

```bash title="stubs.sh" playground
# Code under test calls an external service via curl.
deploy_status() {
  local body
  body=$(curl -fsS "https://deploy.example.com/api/status") || { echo "unreachable"; return 1; }
  [[ $body == *'"state":"ok"'* ]] && echo "healthy" || echo "degraded"
}

# Test 1: stub curl to return a healthy body
curl() { echo '{"state":"ok"}'; }
[[ $(deploy_status) == healthy ]] && echo "PASS healthy"

# Test 2: stub curl to fail
curl() { return 7; }
[[ $(deploy_status) == unreachable ]] && echo "PASS unreachable"
unset -f curl
```

Because functions take precedence over PATH, defining `curl` as a function replaces the real one for the code under test.

## Bats

[Bats](https://github.com/bats-core/bats-core) is the standard test framework for Bash. A test file:

```bash
#!/usr/bin/env bats
# test/semver.bats

setup() {
  source "$BATS_TEST_DIRNAME/../semver.sh"
}

@test "patch bump" {
  run semver_bump 1.2.3 patch
  [ "$status" -eq 0 ]
  [ "$output" = "1.2.4" ]
}

@test "leading v is accepted" {
  run semver_bump v2.0.0 minor
  [ "$output" = "2.1.0" ]
}

@test "unknown part fails with status 2" {
  run semver_bump 1.0.0 huge
  [ "$status" -eq 2 ]
  [[ "$output" == *"unknown part"* ]]
}
```

```text
$ bats test/
 ✓ patch bump
 ✓ leading v is accepted
 ✓ unknown part fails with status 2

3 tests, 0 failures
```

- `run` executes a command and captures `$status`, `$output` and `${lines[@]}`.
- `setup`/`teardown` run around every test; `setup_file`/`teardown_file` once per file.
- `$BATS_TEST_TMPDIR` is a fresh temp directory per test.
- Helper libraries `bats-assert` and `bats-file` add `assert_output`, `assert_success`, `assert_file_exists`…

## Static checks

| Tool | Catches |
|---|---|
| `bash -n` | syntax errors |
| `shellcheck` | quoting bugs, unsafe patterns, portability issues |
| `shfmt -d` | inconsistent formatting (and parse errors) |

Run them in CI so problems are caught before review:

```yaml
# .github/workflows/shell.yml (excerpt)
- run: shellcheck scripts/*.sh
- run: shfmt -d -i 2 scripts/
- run: bats test/
```

## Common mistakes

```mistake
title: Tests that run against real systems
wrong: |
  @test "cleanup removes old backups" {
    run ./cleanup.sh /srv/backups     # deletes real data on the developer's machine
  }
right: |
  @test "cleanup removes old backups" {
    mkdir -p "$BATS_TEST_TMPDIR/b" && touch -d '40 days ago' "$BATS_TEST_TMPDIR/b/old.tgz"
    run ./cleanup.sh "$BATS_TEST_TMPDIR/b"
    [ ! -e "$BATS_TEST_TMPDIR/b/old.tgz" ]
  }
why: Tests should create the state they need in a throwaway directory.
```

```mistake
title: Only testing the happy path
wrong: |
  # one test: valid input produces output
right: |
  # also: missing argument → usage + status 2; unreadable file → status 1;
  # names with spaces; empty input; existing output file
why: Shell bugs hide in edge cases — empty strings, spaces, missing files, failed commands.
```

## Practice

```exercise
kind: mcq
difficulty: intermediate
prompt: In Bats, what does `run my_func arg` do?
options:
  - Runs my_func and aborts the test if it fails
  - Runs my_func, capturing its exit code in `$status` and its output in `$output`, without failing the test
  - Runs my_func in the background
  - Compiles my_func for faster execution
answer: 1
explanation: "`run` captures results so you can assert on them, including expected failures."
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  date() { echo "2026-01-01"; }
  stamp() { echo "backup-$(date +%F).tgz"; }
  stamp
  unset -f date
  [[ $(stamp) == backup-2026-01-01.tgz ]] && echo same || echo different
answer: |
  backup-2026-01-01.tgz
  different
explanation: "While the stub exists, `date` is the function; after unset, the real date runs and returns today's date."
```

```exercise
kind: command
difficulty: beginner
prompt: "Write a one-line assertion that prints `PASS` if `$(echo hello | tr a-z A-Z)` equals `HELLO`, otherwise `FAIL`."
solution: "[[ $(echo hello | tr a-z A-Z) == HELLO ]] && echo PASS || echo FAIL"
explanation: The smallest possible test: run code, compare, report.
```

## Challenge

```exercise
kind: script
difficulty: advanced
title: Test a slug function
prompt: "Write a table-driven test for the provided `slugify` function. Read cases from the here-document (input|expected, separated by `|`), print `ok: INPUT` or `not ok: INPUT (got X)`, and finish with `N/M passed`. One case is expected to fail, revealing a bug — leave the function as it is."
starter: |
  #!/usr/bin/env bash
  slugify() {
    local s=${1,,}
    s=${s// /-}
    printf '%s\n' "$s"
  }
  # your test runner here, reading:
  # Hello World|hello-world
  # Already-slug|already-slug
  # Two  Spaces|two-spaces
solution: |
  #!/usr/bin/env bash
  slugify() {
    local s=${1,,}
    s=${s// /-}
    printf '%s\n' "$s"
  }
  total=0 passed=0
  while IFS='|' read -r input expected; do
    (( ++total ))
    got=$(slugify "$input")
    if [[ $got == "$expected" ]]; then
      (( ++passed ))
      echo "ok: $input"
    else
      echo "not ok: $input (got $got)"
    fi
  done <<'EOF'
  Hello World|hello-world
  Already-slug|already-slug
  Two  Spaces|two-spaces
  EOF
  echo "$passed/$total passed"
expectedOutput: |
  ok: Hello World
  ok: Already-slug
  not ok: Two  Spaces (got two--spaces)
  2/3 passed
checks:
  - pattern: while
    message: Drive the tests from a loop over the cases.
hints:
  - "`IFS='|' read -r input expected` splits each case."
  - "Count total and passed cases separately."
explanation: "Table-driven tests make adding cases trivial — and the failing case documents the bug (consecutive spaces) for whoever fixes it."
```
