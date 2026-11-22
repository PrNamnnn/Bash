---
objectives:
  - State the order in which Bash resolves a command name
  - Inspect resolution with `type -a`, `command -v` and `hash`
  - Understand PATH search, its order and its security implications
  - Bypass aliases and functions with `command`, `builtin` and `\name`
summary:
  - "Lookup order: alias → keyword → function → builtin → hashed path → search `$PATH` left to right → command not found (127)."
  - "A name containing `/` skips the search: `./script`, `/usr/bin/ls`."
  - "Bash caches PATH results in a hash table; `hash -r` clears it after moving programs."
  - "`command -v name` is the portable way to test whether a command exists."
  - "Never put `.` or writable directories early in PATH — anyone who can write there can hijack your commands."
related:
  - finding-commands
  - execution-model
  - aliases-and-builtins
---

## The lookup order

When the first word of a simple command is a name without a slash, Bash checks, in order:

::viz path-lookup

1. **Alias** (interactive shells, or `shopt -s expand_aliases`)
2. **Keyword** — `if`, `for`, `[[`, `{` …
3. **Function**
4. **Builtin** — `cd`, `echo`, `printf` …
5. **Hash table** — remembered locations of programs used before
6. **`$PATH` search** — each directory, left to right; the first executable match wins
7. Not found → `command_not_found_handle` if defined, otherwise "command not found" and status **127**

A name containing a `/` (`./deploy.sh`, `/usr/bin/env`, `bin/tool`) is executed directly — no search.

```bash title="lookup.sh" playground
type -a echo
type -t if ls printf
ls() { echo "a function shadows ls"; }
type -t ls
ls
command ls -d ~/data       # skip the function
unset -f ls
type -a ls
```

## Inspecting resolution

| Command | Shows |
|---|---|
| `type name` | how name would be interpreted |
| `type -a name` | every match, in priority order |
| `type -t name` | one word: alias, keyword, function, builtin, file |
| `type -P name` | the path that a PATH search finds |
| `command -v name` | what would run (POSIX; good for existence checks) |
| `which name` | external program only (not POSIX; ignores functions and builtins) |
| `hash` | the cached locations |

```bash title="exists.sh" playground
for tool in grep jq awk docker sed; do
  if command -v "$tool" > /dev/null; then
    echo "$tool: $(command -v "$tool")"
  else
    echo "$tool: not installed"
  fi
done
```

## PATH

`PATH` is a colon-separated list of directories:

```bash title="path.sh" playground
echo "$PATH" | tr ':' '\n'
mkdir -p ~/bin
printf '#!/usr/bin/env bash\necho "my own hello"\n' > ~/bin/hello
chmod +x ~/bin/hello
hello 2>&1 || echo "(not found: ~/bin isn't in PATH yet)"
PATH="$HOME/bin:$PATH"
hello
type hello
```

Order matters: the first match wins. Prepending (`~/bin:$PATH`) lets your versions override system ones; appending gives the system priority.

## The hash table

Searching PATH on every command would be slow, so Bash remembers where it found each program:

```bash title="hash.sh" playground
hash -r
ls > /dev/null; grep -q x /etc/hosts; ls > /dev/null
hash
```

If you install a program into a directory earlier in PATH, Bash may keep running the old cached one. `hash -r` (or opening a new shell) fixes it. Zsh users use `rehash`.

## Bypassing aliases and functions

| Syntax | Skips |
|---|---|
| `\ls` or `'ls'` | aliases (quoting any part prevents alias expansion) |
| `command ls` | aliases and functions |
| `builtin echo` | everything except builtins |
| `/usr/bin/ls` | everything — run this exact file |
| `env ls` | aliases, functions and builtins |

Wrapping functions use this to call the real command: `grep() { command grep --color=auto "$@"; }`.

## Security: PATH hijacking

If PATH contains `.` (the current directory) or a directory other users can write to, someone can drop a program named `ls` or `sudo` there and you'll run it. Rules:

- Never put `.` in PATH (especially not first). Type `./script` instead.
- In scripts that run as root or from cron, set PATH explicitly: `PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`.
- An empty element (`::` or a trailing `:`) also means the current directory.

## Common mistakes

```mistake
title: Using which to test for a command
wrong: |
  if [ -n "$(which docker)" ]; then …
right: |
  if command -v docker > /dev/null; then …
why: which isn't POSIX, its output and status differ between systems, and it ignores functions/builtins.
```

```mistake
title: Script works in terminal but not in cron
wrong: |
  # crontab: */5 * * * * mytool --sync
  # cron's PATH is just /usr/bin:/bin — mytool in /usr/local/bin isn't found
right: |
  # crontab:
  PATH=/usr/local/bin:/usr/bin:/bin
  */5 * * * * mytool --sync
why: Non-interactive environments often have a minimal PATH. Set it explicitly or use absolute paths.
```

## Practice

```exercise
kind: mcq
difficulty: intermediate
prompt: "You define a function named `echo`. Which runs when you type `echo hi`?"
options:
  - The builtin echo
  - /usr/bin/echo
  - The function
  - Whichever comes first in PATH
answer: 2
explanation: Functions are checked before builtins and PATH.
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  printf() { echo "wrapped"; }
  printf 'x\n'
  command printf 'y\n'
  builtin printf 'z\n'
answer: |
  wrapped
  y
  z
explanation: "`command` and `builtin` both skip the function."
```

```exercise
kind: command
difficulty: beginner
prompt: Print every location Bash knows for `ls`, in priority order.
solution: type -a ls
explanation: "`type -a` lists all matches, not just the first."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Dependency checker
prompt: "Write `require` that takes command names and prints `missing: NAME` (to stdout here) for each that isn't available, returning 1 if any are missing. Call it with `grep sed jq awk rsync` and print `status N`."
starter: |
  #!/usr/bin/env bash
  require() {
    :
  }
  require grep sed jq awk rsync
  echo "status $?"
solution: |
  #!/usr/bin/env bash
  require() {
    local cmd missing=0
    for cmd in "$@"; do
      if ! command -v "$cmd" > /dev/null; then
        echo "missing: $cmd"
        missing=1
      fi
    done
    return "$missing"
  }
  require grep sed jq awk rsync
  echo "status $?"
expectedOutput: |
  missing: jq
  missing: rsync
  status 1
checks:
  - pattern: command -v
    message: Use command -v to test each command.
hints:
  - "`command -v name > /dev/null` succeeds only if name resolves."
explanation: "Checking all dependencies up front gives users one clear list instead of a failure halfway through."
```
