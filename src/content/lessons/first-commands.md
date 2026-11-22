---
objectives:
  - Run your first commands and read their output
  - Find out where you are, who you are and which machine you are on
  - Format the current date and time for humans and for file names
  - Use history to recall and repeat earlier commands
summary:
  - "`pwd` prints the current directory, `whoami` your user name, `hostname` the machine, `uname` the kernel."
  - "`date +FORMAT` formats time; `%F` (YYYY-MM-DD) and `%Y%m%d-%H%M%S` are safe in file names."
  - "`clear` (or Ctrl+L) clears the screen; `history` lists previous commands and `!!` repeats the last one."
  - Most information commands are tiny, single-purpose programs — the Unix philosophy in action.
related:
  - absolute-and-relative-paths
  - echo-and-printf
  - how-a-command-runs
---

## Typing a command

A command line has a **command name** followed by optional **arguments**, separated by spaces. Press <kbd>Enter</kbd> and the shell runs it, shows any output, and prints a new prompt.

```console
$ pwd
/home/learner
$ whoami
learner
```

If you mistype a command, Bash tells you so — and the exit status (more on that later) is 127:

```console
$ pdw
bash: pdw: command not found
```

Nothing is broken. Read the message, fix the typo, try again. Error messages are your most useful teacher.

## Where am I? Who am I? Which machine?

::command pwd whoami hostname uname

Together these answer the three questions you should ask whenever you sit down at a terminal — especially one connected to a remote server:

::terminal
$ pwd
$ whoami
$ hostname
$ uname -a
$ cat /etc/os-release
::

## Dates and times

::command date cal

Getting date formats right matters more than it looks. Compare two ways to name a daily backup:

```bash title="names.sh" playground
echo "backup-$(date +%d-%m-%Y).tar.gz"   # day first: sorts badly
echo "backup-$(date +%F).tar.gz"          # ISO 8601: sorts chronologically
echo "backup-$(date +%Y%m%d-%H%M%S).tar.gz"
```

ISO dates (year-month-day) sort correctly as plain text, so `ls` lists your backups in chronological order. The `$( ... )` part — *command substitution* — runs `date` and inserts its output into the line; you'll study it properly in Level 2.

## Keeping the screen and history tidy

::command clear history

History is stored in memory while the shell runs and saved to `~/.bash_history` when it exits. Try this sequence:

::terminal
$ echo first
$ echo second
$ history 3
$ !!
$ !echo
::

`!!` and `!echo` are *history expansion*: Bash replaces them with an earlier command and prints the expanded line before running it.

> [!WARNING] Secrets end up in history
> Anything you type — including `mysql -p'S3cret'` — is written to `~/.bash_history`. Let programs prompt for passwords, or read them from protected files. In Bash, setting `HISTCONTROL=ignorespace` lets you start a line with a space to keep it out of history.

## The Unix philosophy in miniature

Notice that each of these commands does **one small thing** and prints plain text. That isn't an accident:

1. Write programs that do one thing and do it well.
2. Write programs that work together.
3. Write programs that handle text streams, because that is a universal interface.

Because `whoami` prints just the name, you can use its output elsewhere:

```bash title="greeting.sh" playground
echo "Logged in as $(whoami) on $(hostname), $(date '+%A %d %B')"
```

## Common mistakes

```mistake
title: Spaces inside a date format
wrong: |
  date +%Y-%m-%d %H:%M
  # date: extra operand '%H:%M'
right: |
  date '+%Y-%m-%d %H:%M'
why: The space splits the format into two arguments. Quote the whole `+FORMAT` so it stays one argument.
```

```mistake
title: Case-sensitive commands
wrong: |
  PWD          # prints nothing useful — it's a variable name, not a command
  Whoami       # command not found
right: |
  pwd
  whoami
why: Linux is case-sensitive everywhere — commands, file names, options (`-r` and `-R` are often different).
```

## Practice

```exercise
kind: mcq
difficulty: beginner
prompt: Which command tells you the directory you are currently in?
options:
  - "`whoami`"
  - "`pwd`"
  - "`where`"
  - "`cd`"
answer: 1
explanation: "`pwd` — print working directory. `cd` with no arguments would *move* you home rather than tell you where you are."
```

```exercise
kind: command
difficulty: beginner
prompt: Print today's date in the form `YYYY-MM-DD` (for example 2026-11-17).
solution: date +%F
hints:
  - Formats start with a `+`.
  - "There's a single shorthand for year-month-day — or combine `%Y`, `%m` and `%d`."
explanation: "`date +%F` is shorthand for `date +%Y-%m-%d`. Both are accepted because the checker compares outputs."
```

```exercise
kind: fill
difficulty: beginner
prompt: Complete the command so it prints the current user and machine in the form `learner@bash-mastery`.
template: echo "$(___)@$(___)"
blanks:
  - ["whoami", "id -un"]
  - ["hostname", "uname -n"]
hints:
  - One command prints your user name, another prints the machine name.
explanation: "`$(whoami)` and `$(hostname)` are replaced by each command's output — the same information most prompts display."
```

```exercise
kind: predict
difficulty: beginner
prompt: In the simulator, what does this print?
code: |
  cd /tmp
  pwd
  cd
  pwd
answer: |
  /tmp
  /home/learner
hints:
  - What does `cd` do with no arguments?
explanation: "`cd` with no argument returns to `$HOME`, which is `/home/learner` here."
```

## Challenge

```exercise
kind: command
difficulty: intermediate
title: A log-line timestamp
prompt: "Print the current time in the format `HH:MM:SS` followed by a space and the word `ready` — for example `14:03:09 ready`. Use a single `date` command with a format string."
solution: date '+%T ready'
hints:
  - The format can contain literal text as well as `%` specifiers.
  - "`%T` is shorthand for `%H:%M:%S`. Remember to quote a format that contains a space."
explanation: "`date '+%H:%M:%S ready'` (or `+%T`) prints literal text alongside the time. The same idea builds log lines: `echo \"$(date '+%F %T') backup started\"`."
```
