---
objectives:
  - Explain what an operating system does and why programs need one
  - Distinguish the Linux kernel from a complete Linux distribution
  - Describe the role of user space, system calls and processes
  - Choose a sensible distribution for learning and know how distributions differ
  - Understand why the skills in this course transfer to servers, containers, macOS and WSL
summary:
  - An operating system manages hardware and gives programs safe, shared access to CPU, memory, files and devices.
  - "Linux is technically just the kernel. A distribution bundles the kernel with GNU tools, a package manager, an init system and defaults."
  - Programs never touch hardware directly; they ask the kernel through system calls such as `open`, `read`, `fork` and `execve`.
  - Most of the internet runs on Linux, so shell skills apply directly to servers, containers, CI runners and cloud machines.
  - Distributions differ mainly in package managers (`apt`, `dnf`, `pacman`), release cadence and defaults — Bash itself is the same.
related:
  - shell-terminal-console
  - linux-filesystem
  - how-a-command-runs
---

## What is an operating system?

A computer, at its lowest level, is a processor that executes instructions, memory that holds data, and devices — disks, network cards, keyboards, screens — that move data in and out. Writing a program that talks to all of that hardware directly would be extraordinarily hard, and if two programs tried to do it at the same time they would corrupt each other's work.

An **operating system (OS)** solves this. It is the software layer that sits between the hardware and every other program, and it has four core jobs:

1. **Process management** — decide which program runs on which CPU core, and for how long, so that dozens of programs appear to run at once.
2. **Memory management** — give each program its own private address space so one program cannot read or overwrite another's memory.
3. **Filesystems** — turn raw blocks on a disk into named files and directories with owners and permissions.
4. **Device and network access** — expose hardware through uniform interfaces, so a program can write to a file without caring whether it lives on an SSD, a USB stick or a network share.

On top of that the OS enforces **security**: it knows which user is running each program and refuses actions that user is not allowed to perform.

### Kernel space and user space

The heart of the OS is the **kernel**. It runs with full hardware privileges in a protected region called *kernel space*. Everything else — your shell, your editor, your web server — runs in *user space* with restricted privileges.

When a user-space program needs something only the kernel can do (open a file, start another program, send a network packet), it makes a **system call**. You will meet several system calls by name in this course because the shell's behaviour is built directly on them:

| System call | What it does | Where you'll see it |
|---|---|---|
| `open` / `read` / `write` | Access files and devices | Every redirection (`>`, `<`) |
| `fork` | Create a copy of the current process | Every external command, every subshell |
| `execve` | Replace a process's program with another | Running `ls`, `grep`, your scripts |
| `pipe` | Create a one-way data channel | Every `|` in a pipeline |
| `kill` | Send a signal to a process | `Ctrl+C`, `kill`, `trap` |

> [!NOTE] Why this matters for Bash
> Bash is just a user-space program. When it "runs a command", it asks the kernel to `fork` and `execve`. When it "redirects output", it asks the kernel to open a file and rewire a file descriptor. Understanding this one idea explains a huge amount of shell behaviour that otherwise looks like magic — for example, why a script can't change the directory of the shell that ran it.

## Linux: the kernel and the distribution

**Linux** is, strictly speaking, a *kernel*: the program Linus Torvalds started in 1991 and that thousands of developers maintain today. A kernel alone is not usable — you cannot log in to a kernel or type commands into it.

What people call "Linux" is usually a **distribution** (or *distro*): the kernel plus everything needed to make a working system:

- **GNU core utilities** — `ls`, `cp`, `mv`, `cat`, `sort` and hundreds more. Many come from the GNU project, which is why you'll sometimes see the system called *GNU/Linux*.
- **A shell** — usually Bash, the GNU project's shell.
- **A package manager** — the tool that installs and updates software (`apt`, `dnf`, `pacman`, `apk`).
- **An init system** — the first process (PID 1) that starts services at boot. Most distributions use **systemd**.
- **Defaults and policies** — release cycle, which software is included, how configuration is laid out.

### Common distributions

| Family | Examples | Package manager | Typical use |
|---|---|---|---|
| Debian | Debian, **Ubuntu**, Linux Mint | `apt` / `dpkg` | Desktops, servers, the most common choice for learning |
| Red Hat | Fedora, RHEL, Rocky Linux, AlmaLinux | `dnf` / `rpm` | Enterprise servers |
| Arch | Arch Linux, Manjaro | `pacman` | Enthusiasts, rolling releases |
| Alpine | Alpine Linux | `apk` | Tiny container images |
| SUSE | openSUSE, SLES | `zypper` | Enterprise, Europe |

For this course, **Ubuntu LTS** (Long Term Support) is the recommended reference system: it is widely documented, it's what most cloud servers and WSL installs default to, and every example here was written against its GNU tools.

> [!PORTABILITY] Bash is the same everywhere — the tools are not
> The Bash *language* behaves the same on every distribution. What differs is the surrounding toolset: package managers, service management and occasionally the flags of utilities. macOS ships BSD versions of `sed`, `grep`, `date` and friends, which behave differently from GNU's — lessons call this out whenever it matters.

## Why learn Linux and the shell?

Linux runs the overwhelming majority of web servers, every Android phone's kernel, nearly all supercomputers, most cloud virtual machines and virtually every container. When you deploy code, the machine on the other end is almost certainly a Linux system that you will manage through a shell.

The shell is also the universal automation language of that world:

- **CI/CD pipelines** (GitHub Actions, GitLab CI, Jenkins) run shell steps.
- **Dockerfiles** run shell commands to build images, and containers start through shell entrypoints.
- **Servers** are configured, debugged and repaired over SSH in a shell.
- **Developers** use it daily for Git, build tools, searching code and processing data.

A graphical interface lets you do what its designers anticipated. A shell lets you combine small tools into exactly the operation you need — and then save it as a script so you never have to do it by hand again.

## How it fits together

Here is the stack you'll be working with throughout the course, from the bottom up:

```text
┌─────────────────────────────────────────────┐
│  You (typing commands)                      │
├─────────────────────────────────────────────┤
│  Terminal emulator (draws text, sends keys) │
├─────────────────────────────────────────────┤
│  Shell: Bash (reads, parses, runs commands) │
├─────────────────────────────────────────────┤
│  Programs: ls, grep, git, python, …         │
├─────────────────────────────────────────────┤
│  System calls: fork, execve, open, read …   │
├─────────────────────────────────────────────┤
│  Linux kernel (processes, memory, files)    │
├─────────────────────────────────────────────┤
│  Hardware                                   │
└─────────────────────────────────────────────┘
```

The next lesson zooms in on the three layers at the top — terminal, shell and console — which beginners very often confuse.

## Try it in the simulator

The terminal below is a simulated Ubuntu-like system that runs entirely in your browser. Run the suggested commands to ask the "system" about itself. Notice that `cat /etc/os-release` just prints a text file: on Linux, a lot of system information is stored in ordinary files.

::terminal
$ uname -a
$ cat /etc/os-release
$ whoami
$ ls /
::

> [!WARNING] Simulated, not real
> `uname` reports `6.8.0-sim` because this is a sandbox, not your computer. Commands that need a real kernel — installing packages, managing services, networking — are explained in later lessons but are not available in the browser.

## Common misconceptions

```mistake
title: '"Linux" and "Bash" are the same thing'
wrong: |
  # "I'm learning Linux, so I'm learning Bash"
right: |
  # Linux  = the kernel (and, loosely, a distribution)
  # Bash   = one shell program that runs on Linux, macOS, WSL, BSD…
  # GNU coreutils = the ls/cp/sort tools you call from the shell
why: Keeping the layers apart tells you where to look when something differs. If `sed -i` behaves differently on macOS, that's a difference in the *tool*, not in Bash.
```

```mistake
title: Assuming the terminal is "the operating system"
wrong: |
  # Closing the terminal shuts the computer down
right: |
  # The terminal is just a program; the kernel and services keep running
why: The terminal and shell are ordinary user-space programs. Servers usually have no screen at all — you reach their shell over SSH.
```

## Practice

```exercise
kind: mcq
difficulty: beginner
prompt: Which component decides which program gets to run on the CPU next?
options:
  - The terminal emulator
  - The shell (Bash)
  - The kernel
  - The package manager
answer: 2
hints:
  - Scheduling is one of the four core jobs of an operating system. Which part of the OS runs with full hardware privileges?
explanation: The **kernel** schedules processes. The shell is just one of the many user-space programs the kernel schedules; the terminal only displays text.
```

```exercise
kind: mcq
difficulty: beginner
prompt: You run `ls` in Bash. Which system call does Bash use to turn its child process into the `ls` program?
options:
  - "`fork`"
  - "`execve`"
  - "`open`"
  - "`pipe`"
answer: 1
hints:
  - "`fork` makes a copy of the current program. Something else must *replace* that copy with `ls`."
explanation: Bash first calls `fork` to create a copy of itself, then the copy calls **`execve`** to replace its program image with `/usr/bin/ls`. You'll see this two-step dance in detail in "What happens when you run a command".
```

```exercise
kind: mcq
difficulty: beginner
title: Choosing a distribution
scenario: Your team runs its web application on Ubuntu servers and you want a local practice environment that matches production as closely as possible.
prompt: Which choice is the most sensible?
options:
  - Install Alpine Linux, because it is the smallest
  - Use Ubuntu LTS (natively, in a VM, or through WSL)
  - Use macOS's built-in shell — it's all the same
  - Use any distribution; package managers are identical everywhere
answer: 1
hints:
  - Think about what differs between distributions — and what you want to avoid surprises with.
explanation: Matching production's distribution means the same package manager (`apt`), the same GNU tool versions and the same defaults. macOS uses BSD tools and a different default shell, and Alpine uses `apk` and BusyBox utilities, so both introduce differences you'd rather not debug.
```

```exercise
kind: command
difficulty: beginner
prompt: In the simulator, system information lives in text files. Print the contents of `/etc/os-release`.
solution: cat /etc/os-release
hints:
  - The command that prints a file's contents is three letters long.
  - "`cat` followed by the full path."
explanation: "`cat /etc/os-release` prints the file. Scripts often read this file to detect which distribution they are running on, e.g. `. /etc/os-release; echo \"$ID\"`."
```

## Challenge

```exercise
kind: mcq
difficulty: intermediate
title: Where does the difference come from?
scenario: A script that works on your Ubuntu laptop fails on a colleague's Mac with `sed: 1: "file.txt": invalid command code f` when running `sed -i 's/old/new/' file.txt`.
prompt: What is the most accurate explanation?
options:
  - macOS runs an older version of Bash, which doesn't support `-i`
  - macOS ships the BSD version of `sed`, where `-i` requires an argument (a backup suffix, possibly empty)
  - The file is corrupted on the Mac
  - The Linux kernel is required for in-place editing
answer: 1
hints:
  - Is `sed` part of Bash, or a separate program?
explanation: "`sed` is a separate utility, not part of Bash. GNU `sed -i` takes an *optional* suffix; BSD `sed -i` takes a *required* one, so it consumed `s/old/new/` as the suffix and then tried to parse `file.txt` as the script. The portable form is `sed -i.bak 's/old/new/' file.txt && rm file.txt.bak`. This is exactly why the course keeps Bash, POSIX tools and GNU behaviour separate."
```
