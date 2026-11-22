---
objectives:
  - Distinguish `set` options from `shopt` options and inspect both
  - Use the most important options for globbing, safety and debugging
  - Scope option changes to a function or subshell and restore them
  - Recognise options that change behaviour in surprising ways
summary:
  - "`set -o NAME` / `set +o NAME` (or short flags like `-e`, `-u`, `-x`) are POSIX-style options; `shopt -s NAME` / `shopt -u NAME` are Bash-specific."
  - "`set -o` and `shopt` list the current values; `$-` holds the active single-letter flags."
  - "Globbing: `nullglob`, `failglob`, `dotglob`, `globstar` (`**`), `nocaseglob`, `extglob`."
  - "Safety: `errexit`, `nounset`, `pipefail`, `noclobber` (`set -C`), `inherit_errexit`."
  - "Restore options with `local -` (Bash 4.4) in functions, a subshell, or by saving `$(shopt -p)` / `$(set +o)`."
related:
  - error-handling
  - globbing
  - debugging-scripts
---

## Two families of options

| | `set` | `shopt` |
|---|---|---|
| origin | POSIX (plus Bash extras) | Bash only |
| enable / disable | `set -o name` / `set +o name`, or `set -e` / `set +e` | `shopt -s name` / `shopt -u name` |
| list | `set -o`, or `echo $-` | `shopt`, `shopt -p` |
| test one | `[[ -o name ]]` | `shopt -q name` |

Yes, for `set`, **minus turns an option on** and plus turns it off — a historical quirk.

```bash title="inspect.sh" playground
echo "flags: $-"
set -o | grep -E 'errexit|nounset|pipefail|noclobber'
shopt -p nullglob globstar
set -u
[[ -o nounset ]] && echo "nounset is on"
shopt -q nullglob || echo "nullglob is off"
```

## The options that matter most

### set

| Option | Short | Effect |
|---|---|---|
| `errexit` | `-e` | exit when a command fails (with exceptions — see error handling) |
| `nounset` | `-u` | error on expanding an unset variable |
| `pipefail` | — | a pipeline fails if any part fails |
| `xtrace` | `-x` | trace commands |
| `noclobber` | `-C` | `>` refuses to overwrite existing files (`>\|` forces) |
| `noglob` | `-f` | disable globbing |
| `allexport` | `-a` | export every variable assigned |
| `errtrace` | `-E` | ERR trap is inherited by functions |
| `noexec` | `-n` | parse only (syntax check) |

### shopt

| Option | Effect |
|---|---|
| `nullglob` | unmatched globs expand to nothing |
| `failglob` | unmatched globs are an error |
| `dotglob` | `*` also matches dotfiles |
| `globstar` | `**` matches any depth of directories |
| `nocaseglob` / `nocasematch` | case-insensitive globs / `case` and `[[ == ]]` |
| `extglob` | extended patterns `?( )`, `*( )`, `+( )`, `@( )`, `!( )` |
| `inherit_errexit` | command substitutions inherit `set -e` |
| `lastpipe` | last pipeline command runs in the current shell (non-interactive) |
| `expand_aliases` | expand aliases in scripts |

## Globbing options in action

```bash title="glob-options.sh" playground
cd ~
echo "default:  "*.xyz
shopt -s nullglob; echo "nullglob: [" *.xyz "]"; shopt -u nullglob
shopt -s dotglob;  echo "dotglob:  " .b*; shopt -u dotglob
shopt -s globstar; echo "globstar: " projects/**/*.sh
```

## noclobber

```bash title="noclobber.sh" playground
cd /tmp
echo first > keep.txt
set -C
echo second > keep.txt 2>&1 || echo "refused to overwrite"
echo third >| keep.txt
cat keep.txt
set +C
```

## Scoping option changes

Changing an option inside a function affects the whole shell. Three ways to keep it local:

```bash title="scoping.sh" playground
# 1. local - (Bash 4.4+) restores set options when the function returns
f() { local -; set -f; echo "inside: $-"; }
f; echo "after:  $-"

# 2. a subshell body
g() ( shopt -s nullglob; echo "matches: " /nope/* )
g; shopt -q nullglob || echo "nullglob still off"

# 3. save and restore explicitly
saved=$(shopt -p nullglob)
shopt -s nullglob
eval "$saved"
shopt -p nullglob
```

## Options and portability

`set -e`, `-u`, `-x`, `-f`, `-C`, `-a`, `-n` are POSIX and work in `sh`. `pipefail` was added to POSIX in 2024 and works in Bash, zsh, ksh and recent dash. Everything under `shopt` is Bash-only.

## Common mistakes

```mistake
title: Enabling extglob too late
wrong: |
  shopt -s extglob; [[ $f == +([0-9]).log ]]   # on one line in a function body: may fail to parse
right: |
  shopt -s extglob          # at the top of the script, on its own line
  …
  [[ $f == +([0-9]).log ]]
why: Bash parses a whole line (or compound command) before running it, so the option must already be on when the pattern is parsed.
```

```mistake
title: nullglob surprises with ls
wrong: |
  shopt -s nullglob
  ls *.bak        # no .bak files → runs plain `ls`, listing everything
right: |
  shopt -s nullglob
  files=(*.bak)
  (( ${#files[@]} )) && ls -- "${files[@]}"
why: With nullglob, a pattern that matches nothing disappears — leaving the command with no arguments.
```

## Practice

```exercise
kind: predict
difficulty: intermediate
prompt: "What does this print? (The directory has no `.zzz` files.)"
code: |
  cd /tmp
  for f in *.zzz; do echo "got $f"; done
  shopt -s nullglob
  for f in *.zzz; do echo "got $f"; done
  echo end
answer: |
  got *.zzz
  end
explanation: Without nullglob the pattern stays literal; with it, the list is empty and the loop body never runs.
```

```exercise
kind: mcq
difficulty: beginner
prompt: Which command turns ON the nounset option?
options:
  - "`set +u`"
  - "`set -u`"
  - "`shopt -s nounset`"
  - "`set -o +nounset`"
answer: 1
explanation: For set, `-` enables and `+` disables. nounset isn't a shopt option.
```

```exercise
kind: command
difficulty: intermediate
prompt: "Enable globstar and print every `.log` file anywhere under `~/logs` (one argument per file, space-separated via echo)."
solution: shopt -s globstar; echo ~/logs/**/*.log
explanation: "`**` matches zero or more directory levels when globstar is on."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Option-safe helper
prompt: "Write `count_matches PATTERN` that prints how many files in the current directory match the glob PATTERN (0 when none), using nullglob without leaving it enabled afterwards. Test in `~/data` with `*.csv`, `*.json` and `*.xlsx`, then print `nullglob: off` if it's still disabled."
starter: |
  #!/usr/bin/env bash
  count_matches() {
    :
  }
  cd ~/data
  count_matches '*.csv'
  count_matches '*.json'
  count_matches '*.xlsx'
solution: |
  #!/usr/bin/env bash
  count_matches() (
    shopt -s nullglob
    local files=($1)
    echo "$1: ${#files[@]}"
  )
  cd ~/data
  count_matches '*.csv'
  count_matches '*.json'
  count_matches '*.xlsx'
  shopt -q nullglob || echo "nullglob: off"
expectedOutput: |
  *.csv: 2
  *.json: 1
  *.xlsx: 0
  nullglob: off
checks:
  - pattern: nullglob
    message: Use nullglob for the zero-match case.
hints:
  - "A function with a `( … )` body runs in a subshell, so its shopt changes vanish."
  - "An unquoted `$1` inside an array assignment is globbed."
explanation: "The subshell body scopes the option; nullglob turns zero matches into an empty array."
```
