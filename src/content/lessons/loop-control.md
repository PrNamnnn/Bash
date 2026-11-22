---
objectives:
  - Leave a loop early with `break` and skip an iteration with `continue`
  - Control nested loops with `break N` / `continue N`
  - Redirect and pipe the output of a whole loop
  - Build interactive menus with `select`
summary:
  - "`break` exits the innermost loop; `continue` jumps to its next iteration."
  - "`break 2` / `continue 2` act on the enclosing loop level."
  - "A loop is one compound command: `done > file`, `done | sort` and `done < input` apply to the whole loop."
  - "`select var in options; do …; done` prints a numbered menu and reads choices (from stdin)."
  - "Guard clauses with `continue` keep loop bodies flat and readable."
related:
  - for-loops
  - while-and-until
  - case-statements
---

## break and continue

```bash title="break-continue.sh" playground
for n in 4 8 15 16 23 42; do
  (( n % 2 )) && continue          # skip odd numbers
  (( n > 20 )) && break            # stop at the first large even number
  echo "even: $n"
done
echo "after the loop"
```

- `continue` — skip the rest of this iteration.
- `break` — leave the loop entirely; execution continues after `done`.

## Guard clauses

`continue` lets you filter early instead of nesting `if`s:

```bash title="guards.sh" playground
while IFS= read -r line; do
  [[ -z $line ]] && continue                 # skip blank lines
  [[ $line == \#* ]] && continue             # skip comments
  [[ $line == \[* ]] && { section=${line//[\[\]]/}; continue; }
  key=${line%% =*} value=${line#*= }
  echo "$section.$key = $value"
done < ~/data/config.ini
```

## Nested loops: break N

`break N` and `continue N` affect the N-th enclosing loop:

```bash title="nested.sh" playground
for server in web01 web02 db01; do
  for check in ping disk cpu; do
    if [[ $server == web02 && $check == disk ]]; then
      echo "$server: disk check failed, skipping remaining checks"
      continue 2
    fi
    echo "$server: $check ok"
  done
done
```

## Redirecting a whole loop

A loop is a compound command, so redirections and pipes after `done` apply to all of it — and the file is opened just once:

```bash title="loop-redirect.sh" playground
for i in {1..5}; do
  echo "line $i"
done > /tmp/lines.txt
wc -l < /tmp/lines.txt

for f in ~/data/*; do
  echo "$(wc -l < "$f") $(basename "$f")"
done | sort -rn | head -3
```

Writing `echo … >> file` inside the loop reopens the file on every iteration — slower and easy to get wrong.

## select menus

`select` prints a numbered menu to stderr, reads a number into `REPLY`, and sets the variable to the matching item. It loops until `break`:

```bash title="select.sh" playground
PS3="Choose an environment: "
select env in dev staging prod quit; do
  case $env in
    dev|staging|prod) echo "deploying to $env"; break ;;
    quit) echo "bye"; break ;;
    *) echo "invalid choice: $REPLY" ;;
  esac
done <<< $'7\n2'
```

(Here the answers come from a here-string so it runs non-interactively; in a real terminal the user types them.)

## Common mistakes

```mistake
title: break inside a pipeline subshell
wrong: |
  cat list.txt | while read -r x; do
    [[ $x == stop ]] && break
  done
  echo "found=$found"   # variables set inside are lost too
right: |
  while read -r x; do
    [[ $x == stop ]] && { found=1; break; }
  done < list.txt
why: break works, but the loop runs in a subshell, so anything it sets disappears.
```

```mistake
title: Forgetting to break out of select
wrong: |
  select opt in yes no; do
    echo "you chose $opt"     # loops forever, asking again
  done
right: |
  select opt in yes no; do
    echo "you chose $opt"; break
  done
why: select repeats until break, EOF or a signal.
```

## Practice

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  for i in 1 2 3 4 5; do
    (( i == 2 )) && continue
    (( i == 4 )) && break
    echo "$i"
  done
answer: |
  1
  3
explanation: 2 is skipped; the loop stops when it reaches 4.
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  for a in x y; do
    for b in 1 2 3; do
      [[ $b == 2 ]] && break 2
      echo "$a$b"
    done
  done
  echo end
answer: |
  x1
  end
explanation: "`break 2` leaves both loops at the first b=2."
```

```exercise
kind: command
difficulty: beginner
prompt: "Print the numbers 1 to 10 except multiples of 3, on one line separated by spaces, using `continue`. End with a newline."
solution: for i in {1..10}; do (( i % 3 == 0 )) && continue; printf '%d ' "$i"; done; echo
explanation: "`(( i % 3 == 0 )) && continue` skips 3, 6 and 9."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: First failing server
prompt: "Loop over `~/data/servers.txt` and print `checking NAME` for each server until you meet one whose state is not `running`; then print `first problem: NAME` and stop the loop. Skip any line starting with `#`."
starter: |
  #!/usr/bin/env bash
solution: |
  #!/usr/bin/env bash
  while read -r name ip state; do
    [[ $name == \#* ]] && continue
    echo "checking $name"
    if [[ $state != running ]]; then
      echo "first problem: $name"
      break
    fi
  done < ~/data/servers.txt
expectedOutput: |
  checking web01
  checking web02
  checking db01
  checking cache01
  first problem: cache01
checks:
  - pattern: \bbreak\b
    message: Stop the loop with break.
hints:
  - "`read -r name ip state` splits each line into three fields."
explanation: "continue skips comments, break stops at the first non-running server."
```
