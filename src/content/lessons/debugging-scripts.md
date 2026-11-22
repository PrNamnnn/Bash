---
objectives:
  - Trace execution with `set -x`, `bash -x` and an informative `PS4`
  - Check syntax without running with `bash -n`
  - Use ShellCheck to catch quoting and logic bugs before they bite
  - Locate failures with `caller`, `FUNCNAME`, `BASH_LINENO` and debug logging
summary:
  - "`bash -x script` or `set -x … set +x` prints each command after expansion, prefixed by `PS4`."
  - "`PS4='+ ${BASH_SOURCE##*/}:${LINENO}:${FUNCNAME[0]:-main}: '` shows file, line and function for each traced command."
  - "`bash -n script` parses without executing — a quick syntax check."
  - "ShellCheck (`shellcheck script.sh`) is the single most valuable tool for shell code quality."
  - "Print debug output to stderr, behind a flag: `debug() { (( DEBUG )) && echo \"debug: $*\" >&2; }`."
related:
  - error-handling
  - shell-options
  - testing-shell-scripts
---

## Tracing with set -x

`set -x` (xtrace) makes Bash print every simple command **after expansion**, just before running it. It's the fastest way to see what a script is really doing — especially with quoting problems.

```bash title="xtrace.sh" playground
file="my report.txt"
set -x
wc -l ~/notes.txt
name=$(basename "$file" .txt)
echo "processing $name"
set +x
echo "tracing is off again"
```

- Lines start with `+` (repeated for nesting: `++` inside command substitutions).
- Words are shown with quotes when needed, so you can see exactly how arguments were split.
- Run a whole script traced with `bash -x script.sh`, or put `set -x` around the suspicious part.

## A better PS4

The trace prefix is the `PS4` variable, which is **expanded** each time. Adding the line number and function name makes traces far more useful:

```bash title="ps4.sh" playground
PS4='+ line ${LINENO} in ${FUNCNAME[0]:-main}: '
greet() {
  local who=$1
  echo "hello $who"
}
set -x
greet "Ada"
n=$(( 6 * 7 ))
set +x
```

A popular choice for real scripts:

```bash
export PS4='+ ${BASH_SOURCE##*/}:${LINENO}:${FUNCNAME[0]:-main}: '
```

## Send traces somewhere else

Traces go to stderr, mixing with error messages. Bash 4.1+ can send them to a separate file descriptor:

```bash
exec {BASH_XTRACEFD}> /tmp/trace.log
set -x
```

## Syntax check: bash -n

`bash -n` reads and parses the script without running anything — a cheap check in editors and CI:

```bash title="syntax-check.sh" playground
cat > /tmp/bad.sh <<'EOF'
for f in *.txt; do
  if [[ -f $f ]]; then
    echo "$f"
done
EOF
bash -n /tmp/bad.sh
echo "bash -n status: $?"
```

It catches structural problems (unclosed `if`, bad `case`), not logic errors or typos in command names.

## ShellCheck

[ShellCheck](https://www.shellcheck.net) is a static analyser for shell scripts. It catches hundreds of classes of bugs — unquoted variables, `cd` without error handling, useless `cat`, `[ $x = y ]` pitfalls, POSIX incompatibilities — and explains each with a code (like SC2086) you can look up.

```text
$ shellcheck deploy.sh

In deploy.sh line 7:
cp $src $dest
   ^--^ SC2086 (info): Double quote to prevent globbing and word splitting.

In deploy.sh line 9:
cd $build_dir
^-----------^ SC2164 (warning): Use 'cd ... || exit' in case cd fails.
```

Install it (`apt install shellcheck`, `brew install shellcheck`), run it in your editor and in CI. Suppress a specific warning only with a comment explaining why: `# shellcheck disable=SC2086  # word splitting intended`.

## Where did it fail?

`caller`, `FUNCNAME`, `BASH_LINENO` and `BASH_SOURCE` describe the call stack. Frame *i* is running function `FUNCNAME[i]`, at line `BASH_LINENO[i-1]` of `BASH_SOURCE[i]`:

```bash title="stack.sh" playground
stacktrace() {
  local i
  echo "stack trace:" >&2
  for (( i = 1; i < ${#FUNCNAME[@]}; i++ )); do
    echo "  at ${FUNCNAME[i]} (${BASH_SOURCE[i]}:${BASH_LINENO[i-1]})" >&2
  done
}
load_config() { stacktrace; }
start()       { load_config; }
start 2>&1
```

## Debug logging

Leave cheap, switchable diagnostics in long scripts:

```bash title="debug-log.sh" playground
DEBUG=${DEBUG:-0}
debug() { (( DEBUG )) && printf 'debug: %s\n' "$*" >&2; return 0; }
debug "this is hidden"
DEBUG=1
debug "config loaded from ~/.config/app.conf"
debug "found $(wc -l < ~/data/servers.txt) servers"
echo "normal output"
```

Users can then run `DEBUG=1 ./script.sh` to see the extra detail.

## A debugging checklist

1. **Read the exact error message** — which command, which line?
2. **Run `shellcheck`** — many bugs are recognised instantly.
3. **Trace** with `bash -x` and look at how words were split and quoted.
4. **Print values** (`declare -p var`) at key points.
5. **Shrink the problem**: copy the failing part to a tiny script and reproduce it.
6. **Check assumptions** about the environment: `PATH`, current directory, `bash --version`, `LC_ALL`, which `sed`/`awk` (GNU or BSD).

## Common mistakes

```mistake
title: Debug output on stdout
wrong: |
  echo "DEBUG: got $count items"    # breaks:  result=$(myfunc)
right: |
  echo "DEBUG: got $count items" >&2
why: stdout is a function's or script's data channel; diagnostics belong on stderr.
```

```mistake
title: Leaving set -x on secrets
wrong: |
  set -x
  curl -H "Authorization: Bearer $TOKEN" https://api.example.com
right: |
  set +x
  curl -H "Authorization: Bearer $TOKEN" https://api.example.com
  set -x
why: The trace prints the expanded command — including tokens and passwords — into CI logs.
```

## Practice

```exercise
kind: predict
difficulty: intermediate
prompt: "What does this print? (The `2>&1` makes the trace visible in the same stream.)"
code: |
  x="a b"
  { set -x; echo $x "$x"; } 2>&1
answer: |
  + echo a b 'a b'
  a b a b
explanation: "The trace line comes first and shows the expanded words — three arguments, the last displayed with quotes because it contains a space. Then echo prints them."
```

```exercise
kind: mcq
difficulty: beginner
prompt: Which command checks a script's syntax without running it?
options:
  - "`bash -x script.sh`"
  - "`bash -n script.sh`"
  - "`bash -e script.sh`"
  - "`bash -v script.sh`"
answer: 1
explanation: "-n = noexec: read commands but don't execute them."
```

```exercise
kind: command
difficulty: intermediate
prompt: "Set PS4 to `>> ` and trace only the command `echo hi` (turn tracing off again afterwards)."
solution: "PS4='>> '; set -x; echo hi; set +x"
compare: stderr
explanation: "Tracing output (`>> echo hi`) goes to stderr, followed by the trace of `set +x` itself."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Find the bug with tracing
prompt: "This script should print `3 log files` but prints `1 log files`. Fix it (one-line change). Tracing it with `bash -x` shows why."
starter: |
  #!/usr/bin/env bash
  files=$(ls ~/logs/*.log)
  set -- "$files"
  echo "$# log files"
solution: |
  #!/usr/bin/env bash
  files=$(ls ~/logs/*.log)
  set -- ~/logs/*.log
  echo "$# log files"
expectedOutput: 3 log files
hints:
  - "With `set -x`, look at how many arguments `set --` receives."
  - "Quoting `$files` keeps all names as one argument. Use the glob directly instead."
explanation: "The quoted variable is a single word containing three names. Globbing directly gives one argument per file — and handles spaces in names correctly."
```
