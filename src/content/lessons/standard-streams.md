---
objectives:
  - Name the three standard streams and their file descriptor numbers
  - Explain why errors go to a separate stream
  - Write your own messages to stderr correctly
  - Detect whether a stream is connected to a terminal
summary:
  - "Every process starts with three open file descriptors: 0 stdin (input), 1 stdout (normal output), 2 stderr (errors and diagnostics)."
  - "By default all three are connected to the terminal; redirection and pipes reconnect them."
  - "Keeping errors on stderr means pipelines and files contain only data, while problems still reach the user."
  - "Scripts send messages to stderr with `>&2`: `echo \"error: …\" >&2`."
  - "`[ -t 1 ]` tests whether stdout is a terminal — tools like ls and grep use this to decide on colours and layout."
related:
  - redirection
  - pipes
  - how-a-command-runs
---

## Three streams for every process

A process doesn't write directly to "the screen". It writes to **file descriptors** — small numbers that refer to open files, pipes or terminals. Every process starts with three:

| fd | Name | Purpose | Default |
|---|---|---|---|
| **0** | standard input (stdin) | data the program reads | the keyboard |
| **1** | standard output (stdout) | the program's results | the terminal screen |
| **2** | standard error (stderr) | errors, warnings, progress | the terminal screen |

::viz std-streams

## Why separate errors from output?

Because output is often **data** for the next program. Imagine searching the whole disk:

```console
$ find / -name '*.conf' > configs.txt
find: '/root': Permission denied
find: '/proc/1/task': Permission denied
```

The list of files goes into `configs.txt` — clean, ready to process — while the errors still appear on the screen where you can see them. If errors were mixed into stdout, every downstream tool would have to filter them out.

::terminal
$ find / -name 'shadow'
$ find / -name 'shadow' 2>/dev/null
$ ls notes.txt /nope
$ ls notes.txt /nope > /tmp/out.txt
$ cat /tmp/out.txt
::

## Writing to stderr from your scripts

Use `>&2` ("redirect stdout to wherever fd 2 points") for anything that isn't the script's actual output:

```bash title="stderr.sh" playground
die() {
  echo "error: $*" >&2
  exit 1
}
echo "result: 42"                  # data → stdout
echo "warning: cache is stale" >&2 # message → stderr
[[ -f /nope ]] || die "config file missing"
```

When you run this in the playground, stderr lines are shown in red. Try piping the script's output somewhere (e.g. `./stderr.sh | wc -l` on a real system): only the `result` line is counted.

> [!TIP] A simple rule
> If another program might want to consume it, it goes to **stdout**. If it's meant for the human watching — errors, warnings, progress bars, prompts — it goes to **stderr**.

## Reading from stdin

Most text tools read **stdin** when you don't give them a file name, which is what makes pipelines possible:

```bash title="stdin.sh" playground
printf 'banana\napple\ncherry\n' | sort
sort <<< "zebra"
wc -l < ~/notes.txt
```

## Is this a terminal?

Programs can ask whether a file descriptor is connected to a terminal. That's how `ls` decides between columns (terminal) and one-per-line (pipe), and how `grep --color=auto` decides whether to colour matches.

```bash title="isatty.sh" playground
if [ -t 1 ]; then echo "stdout is a terminal"; else echo "stdout is NOT a terminal"; fi
ls ~/data | head -3
```

The playground runs scripts with a terminal-like stdout, but `ls` writing into the pipe sees a non-terminal and prints one name per line.

## Beyond 0, 1 and 2

File descriptors 3 and up are free for programs (and your scripts) to open: a database connection, a log file, a lock. Level 8 shows how to open and use them with `exec`. Under the hood, `/proc/<pid>/fd/` lists a process's open descriptors on Linux.

## Common mistakes

```mistake
title: Error messages on stdout
wrong: |
  if [[ ! -f $config ]]; then
    echo "config not found"     # ends up in the output file / next pipeline stage
    exit 1
  fi
right: |
  if [[ ! -f $config ]]; then
    echo "config not found: $config" >&2
    exit 1
  fi
why: Anything written to stdout becomes "data". Errors on stdout corrupt files and pipelines and can be silently swallowed.
```

## Practice

```exercise
kind: mcq
difficulty: beginner
prompt: Which file descriptor number is standard error?
options:
  - "0"
  - "1"
  - "2"
  - "3"
answer: 2
explanation: 0 is stdin, 1 is stdout, 2 is stderr.
```

```exercise
kind: mcq
difficulty: beginner
prompt: "You run `grep -r TODO / > todos.txt`. Where do the \"Permission denied\" messages go?"
options:
  - Into todos.txt
  - To the terminal, because they are written to stderr, which was not redirected
  - Nowhere — grep hides them
  - To /dev/null
answer: 1
explanation: Only stdout (fd 1) was redirected. Error messages go to stderr (fd 2), which still points at the terminal.
```

```exercise
kind: command
difficulty: beginner
compare: stderr
prompt: "Print the message `warning: low disk` to **standard error**."
solution: echo "warning: low disk" >&2
explanation: "`>&2` redirects echo's stdout to stderr. The checker compares what reaches standard error; in the terminal it appears in red."
```

## Challenge

```exercise
kind: predict
difficulty: intermediate
title: Which stream?
prompt: Only stdout is shown by this checker. What does it display?
code: |
  {
    echo "data 1"
    echo "oops" >&2
    ls /nope
    echo "data 2"
  } 2>/dev/null
answer: |
  data 1
  data 2
explanation: "Inside the group, `oops` and the `ls` error go to stderr, which the group redirects to /dev/null. Only the two data lines reach stdout."
```
