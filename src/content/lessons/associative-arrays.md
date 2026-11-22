---
objectives:
  - Declare associative arrays (dictionaries) with `declare -A`
  - Add, read, test and delete keys
  - Iterate over keys and values
  - Use maps for counting, grouping, lookups and configuration
summary:
  - "`declare -A map` is required before use; then `map[key]=value`, or `declare -A map=([k1]=v1 [k2]=v2)`."
  - "`${map[key]}` reads, `${!map[@]}` lists keys, `${map[@]}` values, `${#map[@]}` counts."
  - "Test for a key with `[[ -v map[$key] ]]`; delete with `unset 'map[$key]'`."
  - "Key order is unspecified — sort the keys when output order matters."
  - "Bash 4.0+ only; macOS ships Bash 3.2 at /bin/bash."
related:
  - indexed-arrays
  - awk-programs
  - log-parsing
---

## Declaring a map

An associative array maps string **keys** to values — a dictionary or hash map.

```bash title="basics.sh" playground
declare -A port=([http]=80 [https]=443 [ssh]=22)
port[postgres]=5432
echo "ssh uses port ${port[ssh]}"
echo "${#port[@]} services"
for svc in "${!port[@]}"; do
  echo "$svc -> ${port[$svc]}"
done | sort
```

`declare -A` is mandatory. Without it, `map[http]=80` creates an **indexed** array where `http` is evaluated arithmetically as 0 — a silent bug.

## Reading, testing, deleting

```bash title="testing.sh" playground
declare -A color=([apple]=red [banana]=yellow)
key=cherry
if [[ -v color[$key] ]]; then
  echo "$key is ${color[$key]}"
else
  echo "no colour known for $key"
fi
echo "default: ${color[$key]:-unknown}"
unset 'color[banana]'
echo "keys left: ${!color[*]}"
```

`[[ -v map[key] ]]` tests whether the key exists (even with an empty value). `${map[key]:-default}` supplies a fallback. Quote the `unset` argument so the brackets aren't treated as a glob.

## Counting things

The killer use case: a frequency table in one pass.

```bash title="count.sh" playground
declare -A hits
while read -r ip _ _ _ _ _ _ _ status _; do
  (( hits[$status]++ )) || true
done < ~/logs/access.log
for code in "${!hits[@]}"; do
  printf '%s %3d\n' "$code" "${hits[$code]}"
done | sort
```

## Grouping and lookups

```bash title="group.sh" playground
declare -A total count
{
  read -r _
  while IFS=, read -r date region product units price; do
    total[$region]=$(( ${total[$region]:-0} + units ))
    (( ++count[$region] ))
  done
} < ~/data/sales.csv
for r in $(printf '%s\n' "${!total[@]}" | sort); do
  printf '%-6s %3d units in %d sales\n' "$r" "${total[$r]}" "${count[$r]}"
done
```

Maps also make neat lookup tables that replace long `case` statements:

```bash
declare -A handler=([start]=do_start [stop]=do_stop [status]=do_status)
"${handler[$1]:-usage}" "${@:2}"
```

## Loading key=value config

```bash title="config.sh" playground
declare -A cfg
while IFS='=' read -r key value; do
  [[ -z $key || $key == \#* ]] && continue
  cfg[$key]=$value
done < ~/.config/app.conf
echo "log level: ${cfg[log_level]}"
for k in "${!cfg[@]}"; do echo "$k"; done | sort | tr '\n' ' '; echo
```

## Portability

Associative arrays need Bash 4.0 (2009) or newer. macOS's `/bin/bash` is 3.2 — install a modern Bash with Homebrew or use `awk` for portable maps. In `zsh`, `typeset -A` is similar but the syntax for iterating keys differs.

## Common mistakes

```mistake
title: Forgetting declare -A
wrong: |
  status[web01]=up
  status[db01]=down
  echo "${status[web01]}"     # down! both keys evaluate to index 0
right: |
  declare -A status
  status[web01]=up
  status[db01]=down
why: Without -A, Bash creates an indexed array and evaluates `web01` as an arithmetic expression (an unset variable → 0).
```

```mistake
title: Expecting insertion order
wrong: |
  for k in "${!map[@]}"; do echo "$k"; done   # order looks random
right: |
  for k in "${!map[@]}"; do echo "$k"; done | sort
why: Associative arrays are hash tables; their key order is unspecified.
```

## Practice

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  declare -A m=([a]=1 [b]=2)
  m[a]=5
  m[c]=3
  echo "${#m[@]} ${m[a]}"
answer: 3 5
explanation: Assigning to an existing key replaces the value; c is new.
```

```exercise
kind: fill
difficulty: beginner
prompt: Print every key of the associative array `users`, one per line.
template: printf '%s\n' "___"
blanks:
  - ["${!users[@]}"]
explanation: "`${!users[@]}` expands to the keys, `${users[@]}` to the values."
```

```exercise
kind: command
difficulty: intermediate
prompt: "Declare an associative array `cap` with keys `fr`→Paris and `jp`→Tokyo, then print `jp: Tokyo`."
solution: "declare -A cap=([fr]=Paris [jp]=Tokyo); echo \"jp: ${cap[jp]}\""
explanation: "The compound assignment `([key]=value …)` creates several entries at once."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Requests per page
prompt: "Count requests per path (the 7th whitespace field) in `~/logs/access.log` using an associative array. Print the three most requested paths as `COUNT PATH`, highest first (ties: alphabetical by path)."
starter: |
  #!/usr/bin/env bash
  declare -A count
solution: |
  #!/usr/bin/env bash
  declare -A count
  while read -r _ _ _ _ _ _ path _; do
    (( ++count[$path] ))
  done < ~/logs/access.log
  for p in "${!count[@]}"; do
    echo "${count[$p]} $p"
  done | sort -k1,1nr -k2,2 | head -3
expectedOutput: |
  4 /api/checkout
  4 /health
  2 /
checks:
  - pattern: declare -A
    message: Use an associative array.
hints:
  - "`read -r _ _ _ _ _ _ path _` puts the 7th field in path."
  - "`sort -k1,1nr -k2,2` sorts by count descending, then path."
explanation: "The map does the counting in one pass; sort and head rank the result."
```
