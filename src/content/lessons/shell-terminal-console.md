---
objectives:
  - Tell apart the terminal emulator, the shell and the console
  - Explain what a command-line interface offers that a GUI does not
  - Name the common shells and know where Bash fits among them
  - Recognise which program is responsible when something goes wrong
summary:
  - The **terminal** (emulator) draws text and sends your keystrokes; it does not understand commands.
  - The **shell** is the program that reads command lines, interprets them and runs programs. Bash is one shell among several.
  - The **console** historically means the physical terminal attached to a machine; today the word is used loosely for any text interface.
  - A CLI lets you combine small programs, automate repetition and work on remote machines — things GUIs do poorly.
  - "Common shells: sh (POSIX standard), bash (default on most Linux), zsh (default on macOS), fish, dash (Debian's /bin/sh)."
related:
  - operating-systems-and-linux
  - setting-up-bash
  - how-a-command-runs
---

## Three words, three different things

When you open the "Terminal" app on Linux or macOS, or Windows Terminal with WSL, at least **two separate programs** start working together. Beginners often call the whole thing "the terminal" or "the console", and it doesn't matter — until something breaks and you need to know which part to blame.

| Name | What it is | What it does | Examples |
|---|---|---|---|
| **Terminal emulator** | A graphical application | Draws characters on screen, handles fonts, colours, scrollback and copy/paste; sends your keystrokes to the shell | GNOME Terminal, Windows Terminal, iTerm2, Alacritty, kitty |
| **Shell** | A command interpreter | Prints the prompt, reads your line, parses it, expands variables and wildcards, runs programs, reports their status | bash, zsh, fish, dash, sh |
| **Console** | The system's primary text device | Historically a physical keyboard and screen wired to the machine; on Linux, the text-mode virtual consoles you reach with <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>F3</kbd> | `/dev/console`, `/dev/tty1` |

The terminal is the *window*. The shell is the *program inside the window* that understands what you type.

> [!TIP] A useful mental model
> The terminal is like a telephone handset: it carries your voice and plays back the reply. The shell is the person on the other end who actually understands and acts on what you say.

## How they talk to each other

The terminal and the shell are connected through a **pseudo-terminal** (a *pty*) provided by the kernel. It looks like a file to both sides:

1. You press keys. The terminal emulator writes them to the pty.
2. The shell reads a complete line from the pty, interprets it and starts programs.
3. Programs write their output to the same pty.
4. The terminal reads that output and draws it.

Because the shell just reads and writes text through a device, the same shell works whether you're using a local window, an SSH session from another continent, or a serial cable to a router. That's also why a server with no screen at all can still be managed: SSH gives you a pty on the remote machine and a shell runs there.

```console
$ tty
/dev/pts/0
```

The `tty` command prints the name of the terminal device your shell is connected to. `pts` means "pseudo-terminal slave".

> [!NOTE] What the terminal decides vs what the shell decides
> Colours and fonts, how <kbd>Ctrl</kbd>+<kbd>C</kbd> is copied, scrollback size: **terminal**. Tab completion, history, the prompt, aliases, what `*.txt` means: **shell**. If tab completion is broken, changing terminal apps won't help.

## CLI vs GUI

A **graphical user interface (GUI)** shows you what's possible: menus, buttons, icons. It's discoverable and great for tasks you do occasionally. A **command-line interface (CLI)** expects you to know what to ask for — and in exchange gives you capabilities a GUI rarely offers:

- **Composition** — connect small programs into new tools: `grep ERROR app.log | sort | uniq -c`.
- **Automation** — anything you type can be saved in a script and run again, on a schedule, on a thousand servers.
- **Precision** — "delete every `.tmp` file older than 7 days in this tree" is one command, not hours of clicking.
- **Remote work** — a shell over SSH needs only a few kilobytes per second.
- **Reproducibility** — a command can be pasted into documentation, a ticket or a CI pipeline and produce the same result.

The two are complementary. Professionals use GUIs for exploration and the CLI for anything repetitive, remote or precise.

## Shells: Bash and its relatives

Many shells exist. They share a common core defined by the **POSIX** standard (the "Portable Operating System Interface"), and each adds extensions.

| Shell | Notes |
|---|---|
| `sh` | The POSIX shell. On modern systems `/bin/sh` is usually a link to a smaller shell like **dash** (Debian/Ubuntu) or to bash in POSIX mode. |
| `bash` | The **B**ourne-**A**gain **SH**ell from the GNU project (1989). Default interactive shell on most Linux distributions and the de-facto language of shell scripts. |
| `zsh` | Very compatible with bash, with richer completion and theming. Default on macOS since Catalina (2019). |
| `fish` | Friendly and modern, but intentionally *not* POSIX-compatible — scripts look different. |
| `dash` | Small and fast; used as `/bin/sh` on Debian and Ubuntu for system scripts. |

This course teaches **Bash 5**, and it always tells you when something is Bash-specific versus portable POSIX shell. That distinction matters the moment you write `#!/bin/sh` at the top of a script.

::terminal
$ echo $SHELL
$ echo $BASH_VERSION
$ tty
$ ps
::

> [!PORTABILITY] Which shell am I using?
> `$SHELL` is your *login* shell from `/etc/passwd`, not necessarily the shell you are typing into right now. `echo $0` or `ps -p $$` shows the current one. On a Mac, if `echo $0` prints `-zsh`, you're in zsh — run `bash` to start Bash inside it.

## Common mistakes

```mistake
title: Blaming the terminal for a shell problem
wrong: |
  # "My terminal doesn't understand 'll'"
  # → installs a different terminal app
right: |
  # 'll' is an alias defined by your shell configuration
  type ll        # ask the SHELL what 'll' is
  alias ll='ls -alF'
why: Aliases, completion and the prompt belong to the shell's configuration (`~/.bashrc`), not the terminal emulator.
```

```mistake
title: Pasting zsh or fish syntax into a Bash script
wrong: |
  #!/usr/bin/env bash
  for f in **/*.txt(.); do echo $f; done   # zsh glob qualifier
right: |
  #!/usr/bin/env bash
  shopt -s globstar
  for f in **/*.txt; do echo "$f"; done
why: Shells share a common core, but each has its own extensions. Know which shell will run your script — the shebang line decides.
```

## Real-world use cases

- **Over SSH**: your laptop runs the terminal emulator; the shell runs on the server. When the connection drops, the remote shell receives a hang-up signal (SIGHUP) — that's why long jobs use `tmux` or `nohup`.
- **In CI pipelines**: there's no terminal at all. GitHub Actions starts `bash` non-interactively and feeds it your `run:` step. Commands that wait for keyboard input hang forever.
- **In Docker containers**: `docker exec -it web bash` allocates a pty (`-t`) and keeps stdin open (`-i`) so you get an interactive shell inside the container.

## Practice

```exercise
kind: mcq
difficulty: beginner
prompt: You press <kbd>Tab</kbd> and nothing completes. Which component is responsible for tab completion?
options:
  - The terminal emulator
  - The shell
  - The kernel
  - The font renderer
answer: 1
hints:
  - Completion needs to know about commands, files and variables. Which program knows about those?
explanation: Completion is a **shell** feature (Bash's *readline* library). The terminal just forwards the Tab key.
```

```exercise
kind: mcq
difficulty: beginner
prompt: Which statement about `/bin/sh` on Ubuntu is correct?
options:
  - It is always Bash
  - It is usually dash, a small POSIX shell, so Bash-only syntax may fail in `#!/bin/sh` scripts
  - It is zsh
  - It doesn't exist on Ubuntu
answer: 1
hints:
  - Debian and Ubuntu chose a faster, smaller shell for system scripts.
explanation: On Debian and Ubuntu, `/bin/sh` → **dash**. A script with `#!/bin/sh` that uses `[[ ]]` or arrays will fail with errors like `[[: not found`. Use `#!/usr/bin/env bash` when you use Bash features.
```

```exercise
kind: command
difficulty: beginner
prompt: Print the version of Bash running in the simulator using the `BASH_VERSION` variable.
solution: echo $BASH_VERSION
hints:
  - Variables are read with a `$` in front of their name.
  - "`echo` prints its arguments."
explanation: "`echo $BASH_VERSION` prints something like `5.2.21(1)-release`. Scripts can check `${BASH_VERSINFO[0]}` to require a minimum major version."
```

## Challenge

```exercise
kind: mcq
difficulty: intermediate
title: Hung CI job
scenario: A deployment step in your CI pipeline runs `ssh deploy@web01` followed by commands on the next lines. Locally it works; in CI the job hangs until it times out.
prompt: What is the most likely reason?
options:
  - CI terminals have a different font
  - "`ssh` without a command opens an interactive shell that waits for input; in CI nobody types anything, so it waits forever"
  - The CI runner uses zsh
  - SSH is not allowed in CI
answer: 1
hints:
  - What does `ssh host` do when you give it no command to run?
  - In CI, is there a person typing at a keyboard?
explanation: "Without a command, `ssh` starts an interactive login shell on the server. The following lines of your CI script would only run *after* that remote shell exits. Pass the commands explicitly: `ssh -o BatchMode=yes deploy@web01 'cd /srv/app && ./deploy.sh'` — and `BatchMode` makes it fail instead of prompting for a password."
```
