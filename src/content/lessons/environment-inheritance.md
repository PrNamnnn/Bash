---
objectives:
  - Explain how the environment is copied from parent to child at exec time
  - Distinguish what a child process inherits from what it doesn't
  - Pass, override and clear environment variables for single commands
  - Explain why a child can never change its parent's environment
summary:
  - "Each process has its own environment: a list of `NAME=value` strings copied from its parent when it starts."
  - "Children inherit exported variables, the working directory, open file descriptors, umask, resource limits and ignored signals."
  - "Children do not inherit unexported variables, functions (unless `export -f`), aliases, shell options or traps."
  - "`VAR=x cmd` sets VAR only for cmd; `env -i cmd` starts cmd with an empty environment; `env -u VAR cmd` removes one."
  - "Information only flows downward. To get data back from a child, read its stdout or exit status, or `source` it."
related:
  - environment-and-export
  - subshells
  - startup-files
---

## A tree of processes

Every process (except PID 1) has a parent. Your terminal starts a shell; the shell starts commands; scripts start more commands. When a process is created, it gets a **copy** of certain things from its parent — and from then on the two are independent.

::viz process-tree

## What a child inherits

| Inherited by an exec'd program | Not inherited |
|---|---|
| exported variables (the environment) | unexported shell variables |
| current working directory | shell functions (unless `export -f`, Bash children only) |
| open file descriptors (stdin/out/err, plus others) | aliases |
| umask, resource limits (`ulimit`) | `set` / `shopt` options (except via `SHELLOPTS`/`BASHOPTS` if exported) |
| user and group IDs | traps (but *ignored* signals stay ignored) |
| ignored signal dispositions | the shell's history, job table, `$?` |

```bash title="inherit.sh" playground
plain="not exported"
export SHARED="exported"
greet() { echo "function"; }
bash -c '
  echo "plain:  ${plain:-<missing>}"
  echo "SHARED: ${SHARED:-<missing>}"
  type greet >/dev/null 2>&1 && echo "greet: found" || echo "greet: <missing>"
  echo "cwd:    $PWD"
'
```

## Per-command environment

A variable assignment before a command puts it in **that command's** environment only:

```bash title="per-command.sh" playground
LANG=C sort ~/data/fruits.txt | head -3
TZ=UTC bash -c 'echo "child sees TZ=$TZ"'
echo "parent TZ: ${TZ:-unset}"
env -i HOME=/tmp bash -c 'echo "clean env: HOME=$HOME USER=${USER:-unset}"'
env -u SHARED bash -c 'echo "SHARED removed: ${SHARED:-unset}"'
```

| Syntax | Effect |
|---|---|
| `VAR=value cmd` | add/override VAR for cmd only |
| `env VAR=value cmd` | same, via the `env` program |
| `env -i cmd` | run cmd with an empty environment |
| `env -u VAR cmd` | run cmd without VAR |
| `export VAR` | mark VAR for all future children |
| `export -n VAR` | stop exporting VAR |

## Downward only

A child gets a **copy**. Whatever it does to its copy — set variables, `cd`, change options — dies with it. There is no system call that lets a process change its parent's environment.

```bash title="downward.sh" playground
cat > /tmp/setter.sh <<'EOF'
export DEPLOY_ENV=production
cd /etc
EOF
chmod +x /tmp/setter.sh
/tmp/setter.sh
echo "after running:  DEPLOY_ENV=${DEPLOY_ENV:-unset}, PWD=$PWD"
source /tmp/setter.sh
echo "after sourcing: DEPLOY_ENV=${DEPLOY_ENV:-unset}, PWD=$PWD"
```

Ways to get information back from a child:

- **stdout** — `value=$(child)`
- **exit status** — `if child; then …`
- **a file** the child writes and the parent reads
- **`source`** — don't use a child at all; run the code in the current shell
- **`eval "$(child)"`** — the child prints shell code (like `ssh-agent -s`), the parent runs it. Only for trusted programs.

## Environment in the real world

- `sudo` resets most of the environment for security (`sudo -E` preserves it, if allowed).
- `cron` starts jobs with a minimal environment: tiny PATH, no `~/.bashrc`.
- `systemd` services get only what's in the unit file (`Environment=`, `EnvironmentFile=`).
- Docker containers get the image's `ENV` plus `docker run -e`.

That's why scripts that "work in my terminal" can fail elsewhere: always set what you depend on.

## Inspecting a process's environment

```bash
env                          # this shell's exported environment
printenv HOME                # one variable
cat /proc/1234/environ | tr '\0' '\n'   # another process (Linux; needs permission)
```

## Common mistakes

```mistake
title: Setting a variable in a pipeline or child and expecting it later
wrong: |
  get_token | read -r TOKEN      # subshell
  ./load-env.sh                  # child process
  echo "$TOKEN $DB_URL"          # both empty
right: |
  TOKEN=$(get_token)
  source ./load-env.sh
why: Pipelines and executed scripts run in other processes; only the current shell's own assignments persist.
```

```mistake
title: Exporting secrets everywhere
wrong: |
  export DB_PASSWORD=…     # every child process can read it (and some log their env)
right: |
  DB_PASSWORD=… backup-tool    # only this command gets it
  # or pass through a file with 600 permissions
why: Exported variables reach every descendant. Limit secrets to the processes that need them.
```

## Practice

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  A=1
  export B=2
  bash -c 'echo "${A:-none} ${B:-none}"'
  A=3 bash -c 'echo "${A:-none}"'
answer: |
  none 2
  3
explanation: "Only exported B reaches the first child; the second gets A through a per-command assignment."
```

```exercise
kind: mcq
difficulty: beginner
prompt: "A script `setup.sh` runs `export PATH=$PATH:/opt/tool/bin`. You run `./setup.sh` — why can't you run `tool` afterwards?"
options:
  - The export syntax is wrong
  - The script ran in a child process; its environment was discarded when it exited
  - PATH can't be changed by scripts
  - You need to log out and back in
answer: 1
explanation: Run it with `source setup.sh` to change the current shell.
```

```exercise
kind: command
difficulty: intermediate
prompt: "Run `bash -c 'echo $GREETING'` so that it prints `hola`, without exporting GREETING in your shell."
solution: GREETING=hola bash -c 'echo $GREETING'
explanation: The prefix assignment applies only to that one command's environment.
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Environment report
prompt: "Set `APP_MODE=dev` (not exported), `export APP_PORT=8080` and `export APP_DEBUG=1`. Then start a child `bash -c` that prints, for each of APP_MODE, APP_PORT and APP_DEBUG, `NAME=value` or `NAME is not set`. Run the child a second time with `env -u APP_DEBUG`."
starter: |
  #!/usr/bin/env bash
solution: |
  #!/usr/bin/env bash
  APP_MODE=dev
  export APP_PORT=8080
  export APP_DEBUG=1
  report='for v in APP_MODE APP_PORT APP_DEBUG; do
    if [[ -v $v ]]; then echo "$v=${!v}"; else echo "$v is not set"; fi
  done'
  bash -c "$report"
  echo ---
  env -u APP_DEBUG bash -c "$report"
expectedOutput: |
  APP_MODE is not set
  APP_PORT=8080
  APP_DEBUG=1
  ---
  APP_MODE is not set
  APP_PORT=8080
  APP_DEBUG is not set
checks:
  - pattern: bash -c
    message: Start a child shell with bash -c.
  - pattern: env -u
    message: Remove a variable with env -u.
hints:
  - "Inside the child, `[[ -v $v ]]` tests whether the variable named in v is set and `${!v}` reads it."
explanation: "Only exported variables cross the process boundary; env -u removes one for a single child."
```
