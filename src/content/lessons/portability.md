---
objectives:
  - Decide when a script should target POSIX `sh` and when Bash is fine
  - Recognise common Bashisms and their POSIX equivalents
  - Handle GNU vs BSD/macOS differences in `sed`, `date`, `grep`, `stat`, `readlink` and others
  - Test portability with `dash`, `checkbashisms` and ShellCheck
summary:
  - "`#!/bin/sh` promises POSIX shell — on Debian/Ubuntu that's `dash`, which rejects Bashisms like `[[ ]]`, arrays and `${var//x/y}`."
  - "If you use Bash features, say so: `#!/usr/bin/env bash`. macOS ships Bash 3.2 (no associative arrays, no `mapfile`)."
  - "Utilities differ more than shells: `sed -i` (GNU) vs `sed -i ''` (BSD), `date -d` vs `date -v`, `stat -c` vs `stat -f`."
  - "Portable idioms: `printf` over `echo -e`, `command -v` over `which`, `$(…)` over backticks, `[ ]` with `=` in sh."
  - "Test on the platforms you claim to support; ShellCheck warns about Bashisms when the shebang is `sh`."
related:
  - setting-up-bash
  - shell-terminal-console
  - performance
---

## Who needs portability?

| Script runs on… | Target |
|---|---|
| your own Linux machines/servers with Bash | Bash 4.4+ freely |
| macOS laptops too | Bash 3.2-compatible, or require `brew install bash` |
| minimal containers (Alpine, distroless), embedded, initramfs | POSIX `sh` (BusyBox ash, dash) |
| installers others run "anywhere" (`curl … \| sh`) | strict POSIX `sh` and POSIX utilities |

Portability has a cost — fewer features, more care — so decide deliberately and make the shebang tell the truth.

## Bashisms and POSIX equivalents

| Bash | POSIX sh |
|---|---|
| `[[ $a == b* ]]` | `case $a in b*) … ;; esac` |
| `[[ -n $x && -f $f ]]` | `[ -n "$x" ] && [ -f "$f" ]` |
| `[[ $s =~ ^[0-9]+$ ]]` | `case $s in ''\|*[!0-9]*) false ;; *) true ;; esac` |
| `(( n++ ))`, `(( a > b ))` | `n=$((n + 1))`, `[ "$a" -gt "$b" ]` |
| `arr=(a b c)`, `"${arr[@]}"` | `set -- a b c; "$@"` (one list only) |
| `declare -A` | `awk`, or separate variables |
| `${var//old/new}`, `${var^^}` | `printf '%s' "$var" \| sed 's/old/new/g'`, `tr a-z A-Z` |
| `${var:1:3}` | `printf '%s' "$var" \| cut -c2-4` |
| `function f { }` | `f() { }` |
| `local x` | not POSIX (but supported by dash, ash, ksh) |
| `source file` | `. file` |
| `echo -e 'a\tb'` | `printf 'a\tb\n'` |
| `<<< "$str"` | `printf '%s\n' "$str" \|` |
| `<(cmd)` | a temp file or named pipe |
| `&>file` | `>file 2>&1` |
| `$RANDOM`, `$SECONDS`, `$BASHPID` | `awk 'BEGIN{srand(); print int(rand()*32768)}'`, `date +%s` |
| `set -o pipefail` | POSIX since 2024; supported by dash 0.5.11+ |

```bash title="posix-style.sh" playground
# This runs in both bash and POSIX sh.
is_number() {
  case $1 in
    ''|*[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}
upper() { printf '%s\n' "$1" | tr '[:lower:]' '[:upper:]'; }
set -- 42 "4x2" 7
for v do
  if is_number "$v"; then printf '%s is a number\n' "$v"; else printf '%s is not\n' "$v"; fi
done
upper "portable shell"
count=0; count=$((count + 1)); printf 'count=%d\n' "$count"
```

## GNU vs BSD utilities

The bigger trap is usually the **tools**, not the shell. Linux uses GNU coreutils; macOS and the BSDs use BSD versions with different options:

| Task | GNU (Linux) | BSD (macOS) |
|---|---|---|
| in-place sed | `sed -i 's/a/b/' f` | `sed -i '' 's/a/b/' f` |
| extended regex in sed | `sed -E` (or `-r`) | `sed -E` |
| date arithmetic | `date -d '2 days ago' +%F` | `date -v-2d +%F` |
| parse a date | `date -d 2026-11-17 +%s` | `date -j -f %F 2026-11-17 +%s` |
| file size | `stat -c %s f` | `stat -f %z f` |
| modification time | `stat -c %Y f` | `stat -f %m f` |
| canonical path | `readlink -f p` / `realpath p` | `realpath p` (macOS 13+) |
| PCRE grep | `grep -P` | not available — use `grep -E` |
| sort by version | `sort -V` | `sort -V` (recent macOS) |
| `xargs` with no input | runs once unless `-r` | doesn't run |
| `find` with no path | defaults to `.` | path required |

Portable options:

- `sed -i.bak 's/a/b/' f && rm f.bak` works with both.
- Stick to POSIX-specified options (`man 1p sed`, or the POSIX spec online).
- Detect the platform once: `case $(uname -s) in Darwin) … ;; Linux) … ;; esac`.
- Or require GNU tools on macOS (`brew install coreutils gnu-sed` → `gsed`, `gdate`).

## echo is not portable

`echo -n`, `echo -e` and backslash handling differ between shells and systems. `printf` behaves the same everywhere:

```bash
printf '%s\n' "$var"        # instead of echo "$var" (safe even if var is "-n")
printf 'no newline'         # instead of echo -n
printf 'tab\there\n'        # instead of echo -e
```

## Testing portability

- Run the script with `dash script.sh` (Debian/Ubuntu: `apt install dash`) and `busybox sh script.sh`.
- ShellCheck checks against the shebang: with `#!/bin/sh` it flags Bashisms (e.g. SC3010 for `[[ ]]`).
- `checkbashisms` (from Debian's devscripts) does the same.
- In CI, run tests on both `ubuntu-latest` and `macos-latest`.

## Common mistakes

```mistake
title: "#!/bin/sh with Bash syntax"
wrong: |
  #!/bin/sh
  if [[ -f $1 ]]; then arr=(a b); fi   # works on macOS (sh is bash) but fails on Ubuntu (dash)
right: |
  #!/usr/bin/env bash
  if [[ -f $1 ]]; then arr=(a b); fi
why: "The shebang decides the interpreter. On Debian/Ubuntu, /bin/sh is dash: `[[: not found`."
```

```mistake
title: Assuming GNU options on macOS
wrong: |
  sed -i 's/old/new/' config.txt     # macOS: "invalid command code c"
right: |
  sed -i.bak 's/old/new/' config.txt && rm config.txt.bak
why: BSD sed treats the next argument after -i as the backup suffix.
```

## Practice

```exercise
kind: mcq
difficulty: intermediate
prompt: "Which construct works in POSIX sh (dash)?"
options:
  - "`[[ $x == y ]]`"
  - "`case $x in y*) echo yes ;; esac`"
  - "`arr=(1 2 3)`"
  - "`echo ${x^^}`"
answer: 1
explanation: case with glob patterns is POSIX; the others are Bash/ksh extensions.
```

```exercise
kind: mcq
difficulty: intermediate
prompt: "You need `sed -i` to work on both Linux and macOS. Which is portable?"
options:
  - "`sed -i 's/a/b/' f`"
  - "`sed -i '' 's/a/b/' f`"
  - "`sed -i.bak 's/a/b/' f && rm f.bak`"
  - "`sed --in-place 's/a/b/' f`"
answer: 2
explanation: An attached suffix is accepted by both GNU and BSD sed.
```

```exercise
kind: command
difficulty: intermediate
prompt: "Without using `[[ ]]` or `=~`, print `numeric` if `v=12345` contains only digits (use a POSIX `case`)."
solution: "v=12345; case $v in ''|*[!0-9]*) echo not ;; *) echo numeric ;; esac"
explanation: "The POSIX way to validate: reject empty strings and strings containing any non-digit."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Port a Bash script to POSIX sh
prompt: "Rewrite the Bash-only `summary` function using only POSIX features (no arrays, `[[ ]]`, `(( ))`, `${var^^}`, `<<<`, `local` is allowed). It should print each argument upper-cased with its position, then `total: N`."
starter: |
  #!/bin/sh
  # Bash version:
  # summary() { local args=("$@") i; for (( i=0; i<${#args[@]}; i++ )); do echo "$((i+1)): ${args[i]^^}"; done; echo "total: ${#args[@]}"; }
  summary() {
    :
  }
  summary alpha beta gamma
solution: |
  #!/bin/sh
  summary() {
    i=0
    for arg do
      i=$((i + 1))
      printf '%d: %s\n' "$i" "$(printf '%s' "$arg" | tr '[:lower:]' '[:upper:]')"
    done
    printf 'total: %d\n' "$#"
  }
  summary alpha beta gamma
expectedOutput: |
  1: ALPHA
  2: BETA
  3: GAMMA
  total: 3
checks:
  - pattern: \[\[|(?<!\$)\(\(|\^\^|<<<|\w+=\(
    forbid: true
    message: Use only POSIX constructs.
hints:
  - "`for arg do` loops over the positional parameters."
  - "Use `tr '[:lower:]' '[:upper:]'` for upper-casing."
explanation: "Positional parameters replace the array, `$((…))` replaces `(( ))`, and `tr` replaces `${…^^}` — the same behaviour in any POSIX shell."
```
