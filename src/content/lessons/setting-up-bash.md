---
objectives:
  - Get a working Bash on Linux, macOS or Windows (WSL)
  - Check which Bash version you have and why the version matters
  - Read every part of the default command prompt
  - Use the essential editing keys of an interactive shell
summary:
  - "Linux: Bash is almost always installed. macOS: the built-in Bash is 3.2 (2007); install a current one with Homebrew. Windows: use WSL 2 with Ubuntu."
  - "`bash --version` and `$BASH_VERSION` tell you the version; many features in this course need Bash 4 or 5."
  - "The prompt `user@host:~/dir$` shows who you are, which machine, where you are, and whether you are root (`#`) or not (`$`)."
  - Readline shortcuts (Ctrl+A/E, Ctrl+R, Ctrl+W, Tab) make the command line fast to edit.
related:
  - shell-terminal-console
  - startup-files
  - first-commands
---

## Getting Bash

You can follow every lesson in this course using the built-in simulator, but you should also have a real Bash on your machine — scripts are meant to run for real.

### Linux

Bash is the default shell on virtually every Linux distribution. Open your distribution's *Terminal* application and you are in Bash. Check with:

```console
$ echo $0
bash
$ bash --version | head -1
GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu)
```

### macOS

macOS ships **two** shells you'll care about:

- **zsh** is the default interactive shell since macOS Catalina (10.15).
- **/bin/bash** exists but is version **3.2** from 2007, kept because later versions use the GPLv3 licence. It lacks associative arrays, `mapfile`, `${var,,}`, `**` globbing and more.

Install a current Bash with [Homebrew](https://brew.sh):

```bash
brew install bash
/opt/homebrew/bin/bash --version     # Apple Silicon; /usr/local/bin/bash on Intel
```

Scripts that start with `#!/usr/bin/env bash` will use the first `bash` in your `PATH`, so make sure Homebrew's directory comes first. You can keep zsh as your interactive shell and still run Bash scripts — or type `bash` to start an interactive Bash session.

> [!PORTABILITY] macOS tools are BSD tools
> Besides an old Bash, macOS ships BSD versions of `sed`, `grep`, `date`, `stat`, `find` and others. Their options differ from the GNU versions on Linux. `brew install coreutils gnu-sed grep findutils` installs GNU versions as `gsed`, `ggrep`, `gdate`… Lessons point out the differences whenever they matter.

### Windows: WSL 2

The **Windows Subsystem for Linux** runs a real Linux kernel and distribution alongside Windows. It's the best way to learn Bash on Windows.

```text
PS C:\> wsl --install -d Ubuntu
```

Reboot when asked, open *Ubuntu* from the Start menu, and create a Linux user name and password. Inside WSL you have the same Bash and GNU tools as on an Ubuntu server.

> [!WARNING] Git Bash and Cygwin are not Linux
> Git Bash (bundled with Git for Windows) gives you a Bash, but on top of Windows: paths like `C:\Users`, no `/proc`, different line endings, and many Linux tools missing. It's fine for running Git, but use WSL to learn Linux system administration.

## Which version do I have — and why does it matter?

```bash
echo "$BASH_VERSION"            # 5.2.21(1)-release
echo "${BASH_VERSINFO[0]}"      # 5 — the major version as a number
```

| Feature | Needs |
|---|---|
| Associative arrays (`declare -A`), `mapfile`, `${var^^}`, `**` globstar | Bash 4.0+ |
| `declare -n` namerefs, `wait -n` | Bash 4.3+ |
| `${var@Q}` and other `@` transformations | Bash 4.4+ |
| `$EPOCHSECONDS`, `$EPOCHREALTIME`, `wait -p` | Bash 5.0/5.1+ |

A script that depends on newer features can refuse to run on old versions instead of failing mysteriously:

```bash title="require-bash4.sh" playground
if (( BASH_VERSINFO[0] < 4 )); then
  echo "This script needs Bash 4 or newer (found $BASH_VERSION)" >&2
  exit 1
fi
echo "OK: Bash $BASH_VERSION"
```

## Reading the prompt

The **prompt** is the text Bash prints when it is ready for your next command. A typical default on Ubuntu looks like this:

```console
learner@bash-mastery:~/projects$
```

| Part | Meaning |
|---|---|
| `learner` | Your user name (`\u` in the prompt definition) |
| `@bash-mastery` | The host name — crucial when you have SSH sessions to several servers open |
| `:~/projects` | The current directory; `~` is shorthand for your home directory |
| `$` | You're a normal user. As **root** this becomes `#` — a visual warning that commands have full power |

The prompt is defined by the variable `PS1`. You can inspect it and change it for the current session:

::terminal
$ echo "$PS1"
$ PS1='[\u \W]\$ '
$ cd projects
$ PS1='\[\e[1;32m\]\u@\h\[\e[0m\]:\[\e[1;34m\]\w\[\e[0m\]\$ '
::

Permanent changes go into `~/.bashrc` — covered in the startup-files lesson. There is also `PS2`, the *continuation prompt* (`> `) shown when Bash needs more input, for example after you type `for i in 1 2; do` and press Enter.

## Editing the command line

Bash uses the **readline** library for line editing. These keys work in Bash (and in many other programs that use readline, such as `python3` and `psql`):

| Keys | Action |
|---|---|
| <kbd>Tab</kbd> | Complete a command, file name or variable; press twice to list options |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Previous / next command in history |
| <kbd>Ctrl</kbd>+<kbd>R</kbd> | Reverse-search history as you type |
| <kbd>Ctrl</kbd>+<kbd>A</kbd> / <kbd>Ctrl</kbd>+<kbd>E</kbd> | Jump to start / end of line |
| <kbd>Alt</kbd>+<kbd>B</kbd> / <kbd>Alt</kbd>+<kbd>F</kbd> | Back / forward one word |
| <kbd>Ctrl</kbd>+<kbd>W</kbd> | Delete the word before the cursor |
| <kbd>Ctrl</kbd>+<kbd>U</kbd> / <kbd>Ctrl</kbd>+<kbd>K</kbd> | Delete to start / end of line |
| <kbd>Ctrl</kbd>+<kbd>C</kbd> | Abandon the current line (or interrupt the running program) |
| <kbd>Ctrl</kbd>+<kbd>D</kbd> | End of input — on an empty line, exits the shell |
| <kbd>Ctrl</kbd>+<kbd>L</kbd> | Clear the screen |

> [!TIP] Copy and paste
> In most Linux terminals, copy/paste is <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> / <kbd>V</kbd> because <kbd>Ctrl</kbd>+<kbd>C</kbd> already means "interrupt". On macOS it's <kbd>Cmd</kbd>+<kbd>C</kbd>/<kbd>V</kbd>.

## Common mistakes

```mistake
title: Testing scripts with macOS's /bin/bash 3.2
wrong: |
  #!/bin/bash
  declare -A counts   # "declare: -A: invalid option" on macOS
right: |
  #!/usr/bin/env bash
  # and install Bash 5 with: brew install bash
  declare -A counts
why: "`#!/bin/bash` pins the ancient system Bash on macOS. `#!/usr/bin/env bash` uses whichever Bash comes first in PATH."
```

```mistake
title: Editing scripts on Windows and running them in WSL
wrong: |
  $ ./deploy.sh
  /usr/bin/env: 'bash\r': No such file or directory
right: |
  $ sed -i 's/\r$//' deploy.sh     # or: dos2unix deploy.sh
  $ ./deploy.sh
why: Windows editors may save files with CRLF line endings. The invisible `\r` becomes part of the interpreter name. Configure your editor (and Git's `core.autocrlf`) to use LF for shell scripts.
```

## Practice

```exercise
kind: mcq
difficulty: beginner
prompt: Your prompt ends with `#` instead of `$`. What does that tell you?
options:
  - The previous command failed
  - You are logged in as root, so commands run with full privileges
  - You are inside a comment
  - Bash is waiting for more input
answer: 1
hints:
  - The last character of the default prompt depends on your user ID.
explanation: "`\\$` in PS1 prints `#` when your effective user ID is 0 (root) and `$` otherwise. Treat a `#` prompt as a warning sign."
```

```exercise
kind: predict
difficulty: beginner
prompt: In the simulator, what does this print?
code: |
  echo "${BASH_VERSINFO[0]}"
answer: "5"
hints:
  - "`BASH_VERSINFO` is an array; element 0 is the major version."
explanation: The simulator implements Bash 5.2, so the major version is `5`. Scripts use this number to check requirements.
```

```exercise
kind: fill
difficulty: beginner
prompt: Complete the shebang so the script runs with the first `bash` found in `PATH` (portable across Linux and macOS with Homebrew).
template: "#!___ bash"
blanks:
  - ["/usr/bin/env"]
hints:
  - A small program in /usr/bin looks up a command in PATH and runs it.
explanation: "`#!/usr/bin/env bash` asks `env` to find `bash` in your PATH, so it uses Homebrew's Bash 5 on macOS and the system Bash on Linux."
```

## Challenge

```exercise
kind: mcq
difficulty: intermediate
title: The mysterious \r
scenario: A teammate on Windows commits `build.sh`. On the Linux CI runner it fails with `$'\r': command not found` on every line.
prompt: Which fix addresses the root cause for the whole repository?
options:
  - Add `set -e` to the script
  - Add a `.gitattributes` rule `*.sh text eol=lf` so shell scripts are always checked out with LF line endings
  - Run the script with `sh` instead of `bash`
  - Rename the file to `build.bash`
answer: 1
hints:
  - The `\r` is a carriage return from Windows CRLF line endings.
  - The fix should prevent the problem for every contributor, not just this file once.
explanation: "Each line ends in `\\r\\n`; Bash treats the `\\r` as part of the command. Converting the file once (`dos2unix`) fixes it today, but a `.gitattributes` entry `*.sh text eol=lf` makes Git normalise line endings for everyone."
```
