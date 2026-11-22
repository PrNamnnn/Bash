---
objectives:
  - Repeat while (or until) a command succeeds
  - Read files and command output line by line with `while IFS= read -r`
  - Avoid the pipe-into-while subshell trap
  - Write retry loops with limits and back-off
summary:
  - "`while CMD; do …; done` repeats while CMD exits 0; `until CMD; do …; done` repeats until it does."
  - "`while IFS= read -r line; do …; done < file` is the correct way to process lines."
  - "Piping into `while` runs the loop in a subshell; variables set inside are lost. Use `< file` or `< <(cmd)` instead."
  - "Handle a missing final newline with `|| [[ -n $line ]]`; split fields with `IFS=, read -r a b c`."
  - "Infinite loops (`while true`) need an exit: `break`, a counter, or a signal."
related:
  - for-loops
  - loop-control
  - reading-input
---

## while and until

```bash
while COMMANDS; do BODY; done     # repeat while the condition succeeds (status 0)
until COMMANDS; do BODY; done     # repeat until the condition succeeds
```

As with `if`, the condition is any command list — often `[[ ]]` or `(( ))`:

```bash title="counters.sh" playground
n=3
while (( n > 0 )); do
  echo "T-minus $n"
  (( n-- ))
done
echo "liftoff"
tries=0
until (( tries >= 3 )); do
  (( ++tries ))
  echo "try $tries"
done
```

## Reading lines

The single most important loop in shell scripting:

```bash
while IFS= read -r line; do
  printf '%s\n' "$line"
done < file.txt
```

- `IFS=` keeps leading and trailing whitespace.
- `-r` keeps backslashes literal.
- The redirection `< file.txt` applies to the **whole loop**, so each `read` gets the next line.

```bash title="read-lines.sh" playground
n=0
while IFS= read -r line; do
  (( ++n ))
  printf '%2d: %s\n' "$n" "$line"
done < ~/todo.txt
echo "$n lines"
```

### Splitting fields

Give `read` several variable names; the last one gets the rest of the line. Set `IFS` just for `read` to choose the separator:

```bash title="fields.sh" playground
while read -r name ip state; do
  [[ $state == running ]] || echo "ALERT: $name ($ip) is $state"
done < ~/data/servers.txt
echo ---
{
  read -r header                         # skip the header line
  while IFS=, read -r date region product units price; do
    [[ $region == north ]] && echo "$date $product x$units"
  done
} < ~/data/sales.csv
```

## The subshell trap

Each part of a pipeline runs in its own subshell. If the `while` loop is in a pipeline, variables it sets **disappear** when the pipeline ends:

```bash title="subshell-trap.sh" playground
count=0
grep ERROR ~/logs/app.log | while read -r line; do (( ++count )); done
echo "pipe: count=$count"          # 0!

count=0
while read -r line; do (( ++count )); done < <(grep ERROR ~/logs/app.log)
echo "process substitution: count=$count"
```

Fixes: redirect from a file (`< file`), use process substitution (`< <(cmd)`), or `shopt -s lastpipe` (non-interactive scripts only).

## Last line without a newline

`read` returns non-zero at end of file — even if it *did* read a final partial line. Keep it with `|| [[ -n $line ]]`:

```bash title="last-line.sh" playground
printf 'one\ntwo\nthree' > /tmp/nonl.txt
while IFS= read -r line || [[ -n $line ]]; do
  echo "got: $line"
done < /tmp/nonl.txt
```

## Retry loops

Network calls and services fail transiently. A bounded retry with back-off is a staple:

```bash title="retry.sh" playground
attempt=1 max=4 delay=1
flaky() { (( attempt >= 3 )); }   # pretend it succeeds on the 3rd try
until flaky; do
  if (( attempt >= max )); then
    echo "giving up after $attempt attempts" >&2
    exit 1
  fi
  echo "attempt $attempt failed; retrying in ${delay}s"
  sleep "$delay"
  (( attempt++, delay *= 2 ))
done
echo "succeeded on attempt $attempt"
```

## Infinite loops

`while true` (or `while :`) runs forever — fine for daemons and menus as long as something ends it: `break`, `exit`, or a signal such as Ctrl+C. Always include a `sleep` in polling loops so they don't burn a CPU core.

```bash
while true; do
  check_health || alert
  sleep 30
done
```

## Common mistakes

```mistake
title: Reading a file with for or cat
wrong: |
  for line in $(cat hosts.txt); do …
  cat hosts.txt | while read line; do …   # subshell + no -r
right: |
  while IFS= read -r line; do …; done < hosts.txt
why: for splits on every space; piping from cat loses variables and needs an extra process.
```

```mistake
title: Commands in the loop eat stdin
wrong: |
  while read -r host; do
    ssh "$host" uptime        # ssh reads the rest of the file from stdin!
  done < hosts.txt
right: |
  while read -r host; do
    ssh -n "$host" uptime     # or: ssh "$host" uptime < /dev/null
  done < hosts.txt
  # or read from a different file descriptor:
  while read -r host <&3; do ssh "$host" uptime; done 3< hosts.txt
why: Every command inside the loop inherits its stdin — the file being read.
```

## Practice

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  i=1
  while (( i < 20 )); do
    (( i *= 3 ))
  done
  echo "$i"
answer: "27"
explanation: "1 → 3 → 9 → 27; at 27 the condition fails."
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  total=0
  printf '1\n2\n3\n' | while read -r n; do (( total += n )); done
  echo "total=$total"
answer: total=0
explanation: The loop runs in a pipeline subshell; its `total` is discarded.
```

```exercise
kind: command
difficulty: beginner
prompt: "Use a `while read` loop over `~/data/servers.txt` to print only the names (first field) of servers, one per line."
solution: while read -r name rest; do echo "$name"; done < ~/data/servers.txt
explanation: "`read -r name rest` puts the first word in `name` and the remainder in `rest`."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Sum a column without awk
prompt: "Using a `while IFS=, read` loop, sum the `units` column (4th field) of `~/data/sales.csv`, skipping the header, and print `total units: N`."
starter: |
  #!/usr/bin/env bash
  total=0
solution: |
  #!/usr/bin/env bash
  total=0
  {
    read -r _header
    while IFS=, read -r date region product units price; do
      (( total += units ))
    done
  } < ~/data/sales.csv
  echo "total units: $total"
expectedOutput: "total units: 133"
checks:
  - pattern: while
    message: Use a while loop.
  - pattern: IFS=,
    message: Split the fields with IFS=,
hints:
  - "Read the header once with `read` before the loop, inside a `{ …; } < file` group."
explanation: "A command group shares one input redirection, so the first `read` consumes the header and the loop gets the rest. No subshell, so `total` survives."
```
