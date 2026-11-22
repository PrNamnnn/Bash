---
objectives:
  - Turn a vague problem statement into concrete requirements and test cases
  - Design a script's interface (arguments, options, output, exit codes) before writing it
  - Build incrementally: walking skeleton first, then features, then hardening
  - Know when a project is "done": tested edge cases, help text, and a review checklist
summary:
  - "Start from examples: write down concrete inputs and the exact output you expect — they become your tests."
  - "Design the interface first: usage line, options, what goes to stdout vs stderr, and exit codes."
  - "Build a walking skeleton (argument parsing + `main` + one happy path), run it, then grow it feature by feature."
  - "Harden last but always: strict mode, validation, quoting, temp files with traps, dry-run for destructive actions."
  - "Done means: help text, edge cases tested (empty input, spaces, missing files), ShellCheck clean, and someone else could run it."
related:
  - script-architecture
  - testing-shell-scripts
  - robust-patterns
---

## The process

Every project in this level — and most real scripts — goes through the same stages:

| Stage | Output | Typical time |
|---|---|---|
| 1. Understand | a one-paragraph problem statement and 3–5 concrete examples | 10% |
| 2. Design | usage line, options, outputs, exit codes, failure behaviour | 10% |
| 3. Skeleton | a runnable script that parses arguments and handles one case | 15% |
| 4. Features | one requirement at a time, each verified | 40% |
| 5. Harden | validation, edge cases, safety, cleanup | 15% |
| 6. Polish | help text, comments, README, review | 10% |

## 1. Understand: examples before code

"Write a tool that cleans up old files" is not a specification. Turn it into examples:

```text
$ cleanup --days 30 ~/downloads          # lists files older than 30 days (dry run by default)
would delete: /home/me/downloads/old-report.pdf (45 days)
would delete: /home/me/downloads/setup.tar.gz (90 days)
2 files, 12.4 MB would be freed

$ cleanup --days 30 --delete ~/downloads   # actually deletes
deleted 2 files, 12.4 MB freed

$ cleanup ~/nope
cleanup: not a directory: /home/me/nope     (stderr, exit 1)
```

Questions the examples force you to answer: Is the default safe? What counts as "old" (modification time)? Does it recurse? What about hidden files, directories, symlinks? What's printed when nothing matches?

## 2. Design the interface

Write the help text **first** — it's the contract:

```bash
usage() {
  cat <<EOF
Usage: cleanup [-d DAYS] [-x] [-v] DIR...
Find files in DIR older than DAYS days (default 30).
Without -x only lists them (dry run).

  -d DAYS   age threshold in days
  -x        actually delete the files
  -v        verbose output
  -h        show this help

Exit status: 0 success, 1 error, 2 usage error.
EOF
}
```

Decide early:

| Decision | Good default |
|---|---|
| destructive actions | dry run unless an explicit flag is given |
| output | data on stdout, messages on stderr |
| exit codes | 0 ok, 1 runtime error, 2 usage error |
| configuration | flags > environment > defaults |
| input | arguments and/or stdin; `-` means stdin |

## 3. A walking skeleton

The smallest end-to-end version that runs:

```bash title="skeleton.sh" playground
#!/usr/bin/env bash
set -euo pipefail
PROG=cleanup
die() { echo "$PROG: $*" >&2; exit 1; }

main() {
  local days=30 OPTIND opt
  while getopts ':d:h' opt; do
    case $opt in
      d) days=$OPTARG ;;
      h) echo "usage: $PROG [-d DAYS] DIR"; return 0 ;;
      *) echo "usage: $PROG [-d DAYS] DIR" >&2; return 2 ;;
    esac
  done
  shift $((OPTIND - 1))
  (( $# == 1 )) || { echo "usage: $PROG [-d DAYS] DIR" >&2; return 2; }
  [[ -d $1 ]] || die "not a directory: $1"
  echo "would scan $1 for files older than $days days"
}

main -d 7 ~/downloads
main ~/nope 2>&1 || echo "(exit $?)"
```

It doesn't *do* the job yet, but everything around the job — parsing, validation, errors, exit codes — works and can be tested. Each feature now slots into `main`.

## 4. Features, one at a time

For each requirement:

1. Add a test case (an example from stage 1).
2. Implement the smallest change that passes it.
3. Run *all* the examples again.
4. Commit.

Keep functions small: `find_candidates`, `human_size`, `delete_files`, `report`. Small functions are easy to test by sourcing the script.

## 5. Harden

Walk through the robustness checklist from earlier levels:

- [ ] `set -euo pipefail`, and failures handled where they're expected
- [ ] every expansion quoted; `--` before file operands
- [ ] works with spaces, newlines and leading dashes in file names (NUL-separated pipelines)
- [ ] no matches / empty input / empty file handled
- [ ] arguments validated (numbers are numbers, paths exist)
- [ ] temporary files via `mktemp` with an EXIT trap
- [ ] destructive actions behind a flag, with a dry run
- [ ] dependencies checked with `command -v`
- [ ] safe to run twice; safe to interrupt
- [ ] `shellcheck` reports nothing

## 6. Polish and review

- `-h` prints accurate help; errors suggest the fix.
- A header comment states purpose, usage and requirements.
- Variable and function names explain themselves.
- Someone else can run it from a fresh checkout by following the README.

## How the project pages work

Each project in this level includes: the problem, requirements, the concepts it uses (linked to lessons), step-by-step guidance, hints, expected output, test cases, edge cases, a complete reference solution, an explanation and extension ideas. Try each step yourself before opening hints, and only compare with the solution once your version works — the struggle is where the learning happens.

## Common mistakes

```mistake
title: Writing everything before running anything
wrong: |
  # 200 lines written in one go, run for the first time at the end
right: |
  # skeleton → run → one feature → run → next feature → run …
why: Bugs found immediately are trivial to locate; bugs found after 200 lines could be anywhere.
```

```mistake
title: Testing only the happy path
wrong: |
  ./cleanup.sh ~/downloads     # works once, call it done
right: |
  ./cleanup.sh ~/downloads; ./cleanup.sh ~/empty-dir; ./cleanup.sh "dir with spaces"
  ./cleanup.sh; ./cleanup.sh -d abc ~/downloads; ./cleanup.sh ~/missing
why: Edge cases — empty, missing, malformed, unusual names — are where shell scripts break.
```

## Practice

```exercise
kind: mcq
difficulty: beginner
prompt: "A script will delete files. What's the safest default behaviour?"
options:
  - Delete immediately, it's what the user asked for
  - List what would be deleted (dry run) unless an explicit flag such as --delete is given
  - Ask for confirmation by email
  - Move everything to /tmp
answer: 1
explanation: A dry-run default makes mistakes visible before they're destructive.
```

```exercise
kind: mcq
difficulty: beginner
prompt: Which exit status conventionally signals a usage error (bad arguments)?
options:
  - "0"
  - "1"
  - "2"
  - "127"
answer: 2
explanation: "0 success, 1 general error, 2 misuse/usage; 126/127 are reserved by the shell for not executable / not found."
```

```exercise
kind: command
difficulty: beginner
prompt: "Write a one-line function `usage` that prints `usage: tool FILE` to stderr and returns 2, then call it and print the status."
solution: "usage() { echo 'usage: tool FILE' >&2; return 2; }; usage; echo $?"
explanation: "Usage errors belong on stderr with status 2."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: From examples to a skeleton
prompt: "Build the skeleton of `wordfreq [-n N] FILE`: default N=5; `-n` must be a positive integer (else `wordfreq: -n needs a positive integer` on stderr, return 2); FILE must be readable (else `wordfreq: cannot read FILE`, return 1); on success print the N most frequent words (lower-cased, letters only) as `COUNT WORD`, ties alphabetical. Run the test calls."
starter: |
  #!/usr/bin/env bash
  wordfreq() {
    :
  }
  wordfreq -n 3 ~/notes.txt
  wordfreq -n zero ~/notes.txt 2>&1; echo "status $?"
  wordfreq ~/missing.txt 2>&1; echo "status $?"
solution: |
  #!/usr/bin/env bash
  wordfreq() {
    local n=5 OPTIND opt
    while getopts ':n:' opt; do
      case $opt in
        n) n=$OPTARG ;;
        *) echo "usage: wordfreq [-n N] FILE" >&2; return 2 ;;
      esac
    done
    shift $((OPTIND - 1))
    [[ $n =~ ^[1-9][0-9]*$ ]] || { echo "wordfreq: -n needs a positive integer" >&2; return 2; }
    [[ -r ${1:-} ]] || { echo "wordfreq: cannot read ${1:-}" >&2; return 1; }
    tr -cs 'A-Za-z' '\n' < "$1" | tr 'A-Z' 'a-z' | grep -v '^$' |
      sort | uniq -c | sort -k1,1nr -k2,2 | head -n "$n" | awk '{ print $1, $2 }'
  }
  wordfreq -n 3 ~/notes.txt
  wordfreq -n zero ~/notes.txt 2>&1; echo "status $?"
  wordfreq ~/missing.txt 2>&1; echo "status $?"
expectedOutput: |
  3 a
  2 and
  2 shell
  wordfreq: -n needs a positive integer
  status 2
  wordfreq: cannot read /home/learner/missing.txt
  status 1
checks:
  - pattern: getopts
    message: Parse -n with getopts.
hints:
  - "`tr -cs 'A-Za-z' '\\n'` puts one word per line."
  - "Validate N with `[[ $n =~ ^[1-9][0-9]*$ ]]`."
  - "Rank with `sort | uniq -c | sort -k1,1nr -k2,2`."
explanation: "Interface and validation first, then a single pipeline for the actual work — the same shape as every project that follows."
```
