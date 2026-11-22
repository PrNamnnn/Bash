---
objectives:
  - Distinguish shell variables from environment variables
  - Use `export` to pass variables to child processes, and per-command assignments
  - Explain why a child can never change its parent's variables
  - Inspect and clean an environment with `env`, `printenv` and `env -i`
summary:
  - "A shell variable lives only in the current shell; an environment variable is copied into every child process."
  - "`export NAME` (or `export NAME=value`) moves a variable into the environment; `export -n` removes the flag."
  - "`NAME=value command` sets a variable in the environment of that one command only."
  - "Inheritance is one-way and by copy: children get a snapshot; changes never flow back to the parent."
  - "Subshells `( … )` and `$( … )` see all variables (exported or not) because they are copies of the shell, not new programs."
related:
  - variables
  - environment-inheritance
  - startup-files
---

## Two kinds of variables

When you write `count=3`, Bash creates a **shell variable**: it exists inside this shell process and nowhere else. Programs you start can't see it.

**Environment variables** are different: they're part of a list (the *environment*) that the kernel copies into every new process at `execve` time. That's how programs learn about `HOME`, `PATH`, `LANG`, `TZ` or `EDITOR`.

::viz process-tree

```bash title="two-kinds.sh" playground
color=blue                     # shell variable
export SIZE=large              # environment variable
echo "in this shell: $color $SIZE"
bash -c 'echo "in a child:   ${color:-<none>} ${SIZE:-<none>}"'
```

## export

| Command | Effect |
|---|---|
| `export NAME=value` | create (or update) and export |
| `export NAME` | export an existing shell variable |
| `export -n NAME` | stop exporting, keep the value |
| `export -p` / `declare -x` | list exported variables |
| `unset NAME` | remove the variable completely |

Once exported, a variable stays exported even when you change its value — the *attribute* is attached to the name.

## One-shot environment: NAME=value command

Put assignments **before** a command to give just that command extra environment variables, without changing your shell:

```bash title="prefix.sh" playground
TZ=Asia/Tokyo date '+%H:%M in Tokyo' 2>/dev/null || echo "(time zones need a real system)"
GREETING=hi bash -c 'echo "child sees $GREETING"'
echo "parent sees: ${GREETING:-<unset>}"
LC_ALL=C sort ~/data/fruits.txt | head -3
```

This is the cleanest way to configure a single run: `DEBUG=1 ./build.sh`, `PGPASSWORD=… psql …` (though secrets in the environment have their own risks), `LANG=C grep …`.

## Copies, not links

A child receives a **copy** of the environment at the moment it starts:

- The parent changing a variable later doesn't affect a running child.
- The child changing or exporting variables never affects the parent.

That's why a script can't `cd` for you or set variables in your terminal — and why tools that need to do that (`ssh-agent`, Python virtualenvs, `nvm`) ask you to `source` a file or `eval` their output.

```bash title="one-way.sh" playground
export LEVEL=parent
bash -c 'export LEVEL=child; echo "child set LEVEL=$LEVEL"'
echo "back in parent: LEVEL=$LEVEL"
```

### Subshells are different

A subshell (`( … )`, `$( … )`, pipeline stages) is a **copy of the shell itself**, not a new program, so it sees every variable — exported or not:

```bash title="subshell-vars.sh" playground
secret=not-exported
( echo "subshell sees: $secret" )
echo "substitution sees: $(echo "$secret")"
bash -c 'echo "new bash sees: ${secret:-<nothing>}"'
```

## Inspecting the environment

::command env printenv

`env -i` starts a program with an **empty** environment — a great way to reproduce bugs in cron jobs and systemd services, which run with a minimal environment:

```bash
env -i PATH=/usr/bin:/bin HOME="$HOME" bash -c './nightly-job.sh'
```

## Where environment variables come from

At login, variables are set by `/etc/environment`, `/etc/profile`, `~/.profile` (or `~/.bash_profile`) — covered in the startup-files lesson. Desktop launchers, systemd units (`Environment=`), cron (`VAR=value` lines), Docker (`-e`, `ENV`) and CI systems each have their own ways to set them.

## Common mistakes

```mistake
title: Expecting a script to change your shell
wrong: |
  # setenv.sh
  export API_URL=https://api.example.com
  $ ./setenv.sh
  $ echo $API_URL        # empty
right: |
  $ source ./setenv.sh
  $ echo $API_URL
why: Running the script starts a child process; its exports die with it. `source` runs it in your current shell.
```

```mistake
title: Forgetting to export for child programs
wrong: |
  JAVA_OPTS="-Xmx2g"
  ./start-server.sh      # the server never sees JAVA_OPTS
right: |
  export JAVA_OPTS="-Xmx2g"
  ./start-server.sh
  # or: JAVA_OPTS="-Xmx2g" ./start-server.sh
why: Plain assignments create shell variables. Programs only receive exported (environment) variables.
```

## Practice

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  a=1
  export b=2
  bash -c 'echo "[$a] [$b]"'
answer: "[] [2]"
explanation: "Only exported variables reach the child bash process."
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  x=outer
  ( x=inner )
  X=changed bash -c 'true'
  echo "$x ${X:-unset}"
answer: outer unset
explanation: "The subshell's assignment is lost, and the prefix assignment only existed in the child's environment."
```

```exercise
kind: command
difficulty: beginner
prompt: "Print the value of the `HOME` environment variable using `printenv`."
solution: printenv HOME
explanation: "`printenv NAME` prints one variable from the environment."
```

## Challenge

```exercise
kind: mcq
difficulty: intermediate
title: Cron can't find node
scenario: "A script works in your terminal but fails under cron with `node: command not found`. Your `~/.bashrc` adds `~/.nvm/versions/node/v20/bin` to PATH."
prompt: What's the underlying reason?
options:
  - Cron uses a different kernel
  - Cron starts jobs with a minimal environment and doesn't read `~/.bashrc`, so the PATH entry is missing
  - node can't run without a terminal
  - The script needs `export node`
answer: 1
explanation: "Cron jobs inherit cron's own small environment (often `PATH=/usr/bin:/bin`) and run non-interactive shells that don't read `.bashrc`. Use absolute paths or set PATH at the top of the script/crontab."
```
