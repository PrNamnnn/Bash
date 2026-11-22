---
objectives:
  - Measure before optimising, with `time` and `$SECONDS`/`$EPOCHREALTIME`
  - Identify the main cost in shell scripts: starting processes in loops
  - Replace per-line external commands with builtins, parameter expansion or a single awk/sed pass
  - Use parallelism (`xargs -P`, background jobs) where work is independent
summary:
  - "Measure: `time cmd`, or `start=$EPOCHREALTIME … end=$EPOCHREALTIME` for parts of a script."
  - "The #1 cost is process creation: each `$(…)`, pipe or external command in a loop forks and execs."
  - "Prefer builtins and parameter expansion inside loops (`${f##*/}` over `$(basename \"$f\")`)."
  - "For bulk text work, one `awk`/`sed`/`grep`/`sort` over the whole file beats a `while read` loop by orders of magnitude."
  - "`while read` itself is slow for big files (it reads byte by byte from pipes); use it for control flow, not data crunching."
related:
  - execution-model
  - parameter-expansion
  - awk-programs
---

## Measure first

```bash
time ./report.sh              # real = wall clock, user/sys = CPU time
```

Inside a script, `$EPOCHREALTIME` (Bash 5) gives microsecond timestamps:

```bash title="timing.sh" playground
start=$EPOCHREALTIME
total=0
for (( i = 0; i < 2000; i++ )); do (( total += i )); done
end=$EPOCHREALTIME
echo "sum=$total"
awk -v s="$start" -v e="$end" 'BEGIN { printf "loop took %.1f ms (simulated)\n", (e - s) * 1000 }'
```

(The simulator's timings don't reflect a real machine; the relative costs below come from real Bash on Linux.)

## Why shell scripts are slow: processes

A builtin runs inside Bash in nanoseconds to microseconds. An external command needs **fork + exec + wait** — roughly 0.5–2 ms each. That's invisible once, but inside a loop over 10,000 items it's 5–20 seconds.

| Operation (real Linux, approximate) | Cost per call |
|---|---|
| arithmetic `(( n++ ))`, `${var#prefix}` | ~1 µs |
| `[[ $x == y* ]]` | ~1 µs |
| `$(cmd)` with a builtin | ~0.5 ms (forks a subshell) |
| external command (`basename`, `cut`, `date`) | ~1 ms |
| a 3-command pipeline | ~2–3 ms |

## Replace externals in loops

```bash
# slow: two processes per file
for f in *.log; do
  name=$(basename "$f" .log)
  dir=$(dirname "$f")
done
# fast: no processes
for f in *.log; do
  name=${f##*/}; name=${name%.log}
  dir=${f%/*}
done
```

| External | Builtin equivalent |
|---|---|
| `$(basename "$p")` | `${p##*/}` |
| `$(dirname "$p")` | `${p%/*}` |
| `$(echo "$s" \| tr a-z A-Z)` | `${s^^}` |
| `$(echo "$s" \| cut -d, -f2)` | `IFS=, read -r _ f2 _ <<< "$s"` |
| `$(expr $a + $b)` | `$(( a + b ))` |
| `$(date +%s)` | `$EPOCHSECONDS` (Bash 5) or `printf '%(%s)T'` |
| `$(cat file)` | `$(< file)` |
| `$(seq 1 100)` | `{1..100}` or `for ((…))` |

```bash title="builtin-dates.sh" playground
printf 'today: %(%Y-%m-%d)T\n' -1
printf 'epoch: %s\n' "$EPOCHSECONDS"
content=$(< ~/todo.txt)
echo "first line: ${content%%$'\n'*}"
```

## One pass over the data

Line-by-line loops in Bash are slow even without externals: `read` on a pipe reads one byte at a time. For data processing, hand the whole file to a tool built for it:

```bash title="one-pass.sh" playground
# slow pattern: a loop with per-line work
total=0
while IFS=, read -r _ region _ units _; do
  [[ $region == north ]] && (( total += units ))
done < <(tail -n +2 ~/data/sales.csv)
echo "loop:  north units = $total"

# fast pattern: one awk process for the whole file
awk -F, 'NR > 1 && $2 == "north" { t += $4 } END { print "awk:   north units = " t }' ~/data/sales.csv
```

On a million-line file, the awk version is typically 50–100× faster.

Other one-pass tricks:

- `grep -c` instead of `grep | wc -l`.
- `sort | uniq -c` or awk arrays instead of counting in a Bash loop.
- `find … -exec cmd {} +` (batches many files per command) instead of `-exec cmd {} \;` (one process per file).
- `xargs` to batch arguments: `printf '%s\0' *.png | xargs -0 optipng`.

## Avoid useless work

```bash
cat file | grep x          # extra process: grep x file
grep x file | wc -l        # grep -c x file
ls | wc -l                 # files=(*); echo ${#files[@]}
for i in $(seq 1 1000000)  # builds a million-word list in memory: use for ((…))
```

## Parallelism

When items are independent and the work is CPU- or I/O-bound, run several at once:

```bash
# 4 at a time with xargs
printf '%s\0' *.wav | xargs -0 -n 1 -P 4 flac --best

# background jobs with a limit
max=4
for f in *.wav; do
  flac --best "$f" &
  (( $(jobs -rp | wc -l) >= max )) && wait -n
done
wait
```

GNU `parallel` adds progress bars, retries and remote execution.

## When to leave Bash

If, after removing process overhead, the script is still too slow — or most of its time is spent manipulating data structures in loops — rewrite the hot part in awk, or the whole tool in Python/Go. Bash is a superb orchestrator and a poor number cruncher.

## Common mistakes

```mistake
title: Command substitution for every field
wrong: |
  while read -r line; do
    user=$(echo "$line" | cut -d: -f1)
    shell=$(echo "$line" | cut -d: -f7)
  done < /etc/passwd       # four processes per line
right: |
  while IFS=: read -r user _ _ _ _ _ shell; do
    :
  done < /etc/passwd       # zero processes
why: read can split fields itself, using IFS.
```

```mistake
title: -exec \; on thousands of files
wrong: |
  find . -name '*.tmp' -exec rm {} \;   # one rm process per file
right: |
  find . -name '*.tmp' -exec rm {} +    # many files per rm
  find . -name '*.tmp' -delete          # GNU/BSD find, no rm at all
why: The `+` form batches arguments like xargs.
```

## Practice

```exercise
kind: mcq
difficulty: intermediate
prompt: "Which version of this loop body starts no new processes? (`f` holds a path.)"
options:
  - "`n=$(basename \"$f\")`"
  - "`n=$(echo \"$f\" | sed 's#.*/##')`"
  - "`n=${f##*/}`"
  - "`n=$(awk -F/ '{print $NF}' <<< \"$f\")`"
answer: 2
explanation: Parameter expansion happens inside Bash; the others fork at least one process.
```

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  f=/var/log/nginx/access.log.1
  echo "${f%/*} ${f##*/} ${f##*.}"
answer: /var/log/nginx access.log.1 1
explanation: "Directory, base name and last extension — all without basename/dirname."
```

```exercise
kind: command
difficulty: intermediate
prompt: "Count the lines in `~/logs/access.log` that contain ` 404 ` using a single grep process (no pipes)."
solution: grep -c ' 404 ' ~/logs/access.log
explanation: "`grep -c` counts matches itself — no need for `| wc -l`."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Remove the processes
prompt: "The starter forks 4 processes per line. Rewrite it with zero external commands inside the loop (use read with IFS and parameter expansion) so it prints the same output: user and shell name (basename) for users whose shell is bash."
starter: |
  #!/usr/bin/env bash
  while read -r line; do
    user=$(echo "$line" | cut -d: -f1)
    shell=$(echo "$line" | cut -d: -f7)
    [ "$(basename "$shell")" = bash ] && echo "$user $(basename "$shell")"
  done < /etc/passwd
solution: |
  #!/usr/bin/env bash
  while IFS=: read -r user _ _ _ _ _ shell; do
    [[ ${shell##*/} == bash ]] && echo "$user ${shell##*/}"
  done < /etc/passwd
expectedOutput: |
  root bash
  postgres bash
  learner bash
  deploy bash
checks:
  - pattern: \$\(
    forbid: true
    message: No command substitutions — use read and parameter expansion.
hints:
  - "`IFS=: read -r user _ _ _ _ _ shell` splits all seven fields."
  - "`${shell##*/}` is the basename."
explanation: "Same output, zero forks per line: on a large file that's the difference between seconds and milliseconds."
```
