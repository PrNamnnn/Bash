---
objectives:
  - Write a shell script file with a correct shebang line
  - Make it executable with `chmod +x` and run it in the different ways
  - Explain the difference between `./script.sh`, `bash script.sh` and `source script.sh`
  - Organise scripts in `~/bin` so they run like any other command
summary:
  - "A script is a text file of commands. The first line `#!/usr/bin/env bash` (the shebang) tells the kernel which interpreter runs it."
  - "`chmod +x script.sh` adds execute permission; then `./script.sh` runs it in a **new** bash process."
  - "`bash script.sh` runs it without needing the execute bit (the shebang is ignored); `source script.sh` runs it in the **current** shell."
  - "Put personal scripts in `~/bin` (or `~/.local/bin`) and add it to PATH to run them by name."
  - "Use `.sh` or no extension, comments with `#`, and `bash -n` to check syntax without running."
related:
  - variables
  - how-a-command-runs
  - users-groups-permissions
---

## From commands to a program

Every command you've typed so far could be saved in a file and run again. That file is a **shell script**. Scripts let you:

- repeat a procedure exactly, every time;
- share it with colleagues or run it on a server;
- schedule it (cron, CI pipelines);
- build it up step by step into a real tool.

Here is a complete script:

```bash title="hello.sh" playground
#!/usr/bin/env bash
# hello.sh — print a greeting and some facts about the system.

name=$(whoami)
echo "Hello, $name!"
echo "You are on $(hostname), running Bash $BASH_VERSION."
echo "Today is $(date +%A), and your home holds $(ls ~ | wc -l) items."
```

## The shebang line

The first line, `#!/usr/bin/env bash`, is the **shebang** (from *hash* `#` + *bang* `!`). When you execute the file, the **kernel** reads those first bytes and runs the named interpreter with the script's path as an argument — effectively `/usr/bin/env bash ./hello.sh`.

| Shebang | Meaning |
|---|---|
| `#!/usr/bin/env bash` | Use the first `bash` in PATH — portable across Linux, macOS (Homebrew), BSD. Recommended. |
| `#!/bin/bash` | Use exactly /bin/bash — fine on Linux, but it's Bash 3.2 on macOS. |
| `#!/bin/sh` | A POSIX shell (dash on Ubuntu) — only use if the script avoids all Bash features. |

The shebang must be the very first line, with no blank line or space before `#!`. To any shell reading the file, it's just a comment.

## Making it executable

A new file isn't executable. Running it directly fails:

```console
$ ./hello.sh
bash: ./hello.sh: Permission denied
$ chmod +x hello.sh
$ ./hello.sh
Hello, learner!
```

`chmod +x` sets the execute permission bits (see the permissions lesson for the details). `ls -l` now shows `-rwxr-xr-x`.

::terminal
$ cd projects/scripts
$ ls -l
$ ./deploy.sh v1
$ chmod +x deploy.sh
$ ./deploy.sh v1
$ bash deploy.sh v2
::

## Four ways to run a script

| Command | Needs `+x`? | Runs in | Uses shebang? |
|---|---|---|---|
| `./script.sh` | yes | a new process | yes |
| `script.sh` (in PATH) | yes | a new process | yes |
| `bash script.sh` | no | a new bash process | no (bash is chosen explicitly) |
| `source script.sh` or `. script.sh` | no | **the current shell** | no |

The difference between a new process and the current shell matters: a script that does `cd /tmp` or `export DEBUG=1` affects only its own process — unless you `source` it.

```bash title="source-vs-run.sh" playground
cat > /tmp/setdir.sh <<'EOF'
cd /tmp
MESSAGE="set by the script"
EOF
bash /tmp/setdir.sh
echo "after bash:   pwd=$PWD message=${MESSAGE:-<unset>}"
source /tmp/setdir.sh
echo "after source: pwd=$PWD message=${MESSAGE:-<unset>}"
```

`source` is how `~/.bashrc` is loaded and how scripts load libraries of functions. Use it deliberately — sourced code can change everything in your shell.

## Your own commands: ~/bin

To run your scripts from anywhere by name, put them in a directory on your PATH:

```bash
mkdir -p ~/bin
mv hello.sh ~/bin/hello          # the extension is optional
chmod +x ~/bin/hello
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.bashrc   # many distros already do this via ~/.profile
hello
```

## Structure and style from day one

```bash
#!/usr/bin/env bash
# backup-notes.sh — copy ~/notes.txt to a dated backup.
# Usage: backup-notes.sh [DEST_DIR]

dest=${1:-$HOME/backups}          # first argument, or a default
mkdir -p "$dest"
cp ~/notes.txt "$dest/notes-$(date +%F).txt"
echo "Backed up to $dest"
```

- A header comment says what the script does and how to call it.
- Variables have descriptive names and are quoted when used.
- Each step is simple and readable.

Later levels add error handling, options and tests — but these habits start now.

### Checking syntax without running

`bash -n script.sh` parses the script and reports syntax errors without executing anything:

```bash title="syntax-check.sh" playground
printf 'echo start\nif true; then\necho missing fi\n' > /tmp/broken.sh
bash -n /tmp/broken.sh
echo "exit status: $?"
```

## Common mistakes

```mistake
title: Forgetting ./
wrong: |
  $ hello.sh
  bash: hello.sh: command not found
right: |
  $ ./hello.sh
why: The current directory isn't in PATH (on purpose). `./` tells Bash the exact location.
```

```mistake
title: Windows line endings
wrong: |
  $ ./script.sh
  /usr/bin/env: 'bash\r': No such file or directory
right: |
  $ sed -i 's/\r$//' script.sh
  $ ./script.sh
why: The file was saved with CRLF endings, so the shebang names `bash\r`. Save scripts with LF line endings.
```

```mistake
title: Using sh to run a Bash script
wrong: |
  $ sh deploy.sh        # dash on Ubuntu: "[[: not found"
right: |
  $ ./deploy.sh         # honours the bash shebang
  $ bash deploy.sh
why: "`sh script` ignores the shebang and runs the POSIX shell, which lacks Bash features."
```

## Practice

```exercise
kind: mcq
difficulty: beginner
prompt: What is the recommended first line for a Bash script that should run on Linux and macOS?
options:
  - "`#!/bin/sh`"
  - "`#!/usr/bin/env bash`"
  - "`# bash script`"
  - "`#!bash`"
answer: 1
explanation: "`env` finds bash via PATH, so Homebrew's Bash 5 is used on macOS and the system Bash on Linux."
```

```exercise
kind: command
difficulty: beginner
prompt: "`~/projects/scripts/deploy.sh` is not executable. Make it executable and run it with the argument `v3`, in one command line."
solution: chmod +x ~/projects/scripts/deploy.sh && ~/projects/scripts/deploy.sh v3
explanation: "`chmod +x` adds the execute bit; `&&` runs the script only if chmod succeeded."
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  printf 'cd /tmp\nx=42\n' > /tmp/s.sh
  cd ~
  bash /tmp/s.sh
  echo "${x:-none} $PWD"
  . /tmp/s.sh
  echo "${x:-none} $PWD"
answer: |
  none /home/learner
  42 /tmp
explanation: "`bash` runs the file in a child process; `.` (source) runs it in the current shell."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: A complete small script
prompt: "Write a script that prints the number of `.csv` files in `~/data` and the total number of lines in them, exactly in the format shown. It must start with a proper shebang."
starter: |
  # count CSV files and lines in ~/data
solution: |
  #!/usr/bin/env bash
  # count CSV files and lines in ~/data
  files=$(ls ~/data/*.csv | wc -l)
  lines=$(cat ~/data/*.csv | wc -l)
  echo "CSV files: $files"
  echo "Total lines: $lines"
expectedOutput: |
  CSV files: 2
  Total lines: 25
checks:
  - pattern: ^#!(/usr/bin/env bash|/bin/bash)
    message: Start the script with a shebang line such as #!/usr/bin/env bash.
hints:
  - "A glob `~/data/*.csv` selects the files."
  - "`cat` them all and count lines with `wc -l`."
explanation: "The glob selects the files; `wc -l` counts. (17 lines in sales.csv + 8 in users.csv.)"
```
