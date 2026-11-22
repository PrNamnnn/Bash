---
objectives:
  - Create, read, modify and delete elements of indexed arrays
  - Expand arrays safely with `"${arr[@]}"` and get lengths, indices and slices
  - Fill arrays from command output with `mapfile` / `readarray`
  - Use arrays to build command lines without quoting bugs
summary:
  - "Create: `arr=(a \"b c\" d)`; append: `arr+=(e)`; set one: `arr[5]=x`; delete: `unset 'arr[1]'`."
  - "Read: `${arr[0]}`, `${arr[-1]}` (last). All elements: `\"${arr[@]}\"` — always quoted."
  - "`${#arr[@]}` = count, `${!arr[@]}` = indices, `${arr[@]:1:2}` = slice."
  - "Arrays can be sparse: indices needn't be contiguous after unset."
  - "`mapfile -t lines < file` reads lines into an array; arrays are the safe way to hold lists of file names or arguments."
related:
  - associative-arrays
  - for-loops
  - parameter-expansion
---

## Why arrays?

A plain string variable holds one string. Storing a *list* in it (`files="a.txt b c.txt"`) breaks as soon as an item contains a space. Arrays keep each item separate, no matter what characters it contains.

::viz arrays

## Creating and reading

```bash title="basics.sh" playground
fruits=(apple "dragon fruit" cherry)
echo "first:  ${fruits[0]}"
echo "second: ${fruits[1]}"
echo "last:   ${fruits[-1]}"
echo "count:  ${#fruits[@]}"
fruits+=(date elderberry)          # append
fruits[1]="fig"                    # replace
printf '<%s>\n' "${fruits[@]}"
```

Indices start at 0. Braces are required: `$fruits[1]` means `${fruits[0]}` followed by the text `[1]`. And `$fruits` alone is just the first element.

## Expanding all elements

| Expansion | Result |
|---|---|
| `"${arr[@]}"` | each element as a separate word — **use this** |
| `"${arr[*]}"` | all elements joined into one word with the first char of IFS |
| `${arr[@]}` unquoted | elements re-split and globbed — almost always a bug |

```bash title="expand.sh" playground
files=("my report.txt" "notes.txt")
printf '[%s]\n' "${files[@]}"
echo ---
printf '[%s]\n' ${files[@]}
echo ---
IFS=,; echo "${files[*]}"; unset IFS
```

## Indices, length and slices

```bash title="indices.sh" playground
arr=(zero one two three four five)
echo "indices: ${!arr[@]}"
echo "slice 2..3: ${arr[@]:2:2}"
echo "from 4:     ${arr[@]:4}"
echo "length of element 3: ${#arr[3]}"
unset 'arr[1]'
echo "after unset: ${arr[*]} (count ${#arr[@]})"
echo "indices now: ${!arr[@]}"
```

After `unset`, the array is **sparse** — index 1 no longer exists, and the others keep their numbers. Iterate with `"${!arr[@]}"` when indices matter.

## Filling arrays

```bash title="filling.sh" playground
mapfile -t lines < ~/todo.txt              # one element per line, -t strips newlines
echo "${#lines[@]} todo items; first: ${lines[0]}"

shopt -s nullglob
csvs=(~/data/*.csv)                         # glob results
echo "${#csvs[@]} csv files"

read -ra words <<< "split these words"     # split a string
echo "${words[1]}"

mapfile -t big < <(sort -rn ~/data/numbers.txt | head -3)
echo "top three: ${big[*]}"
```

Avoid `arr=($(command))`: the output is word-split *and* globbed. Use `mapfile -t arr < <(command)`.

## Building command lines

Arrays are the right way to assemble arguments conditionally:

```bash title="args.sh" playground
verbose=1 dry_run=1
args=(-a --exclude "*.tmp")
(( verbose )) && args+=(-v)
(( dry_run )) && args+=(--dry-run)
args+=("$HOME/my files/" "backup:/srv/")
printf 'rsync'; printf ' %q' "${args[@]}"; echo
```

Each element stays one argument even with spaces or `*` in it — something a string variable can never guarantee.

## Iterating

```bash
for item in "${arr[@]}"; do …; done                 # values
for i in "${!arr[@]}"; do echo "$i: ${arr[i]}"; done   # indices and values
```

Inside `[ ]` of an indexed array, the subscript is arithmetic, so `${arr[i]}` and `${arr[i+1]}` work without `$`.

## Common mistakes

```mistake
title: Forgetting the braces or the [@]
wrong: |
  echo $arr[1]        # first element followed by "[1]"
  for x in $arr; do   # only the first element
right: |
  echo "${arr[1]}"
  for x in "${arr[@]}"; do
why: Without braces Bash sees `$arr` (element 0) and literal text.
```

```mistake
title: Loading command output with word splitting
wrong: |
  files=($(find . -name '*.log'))    # breaks names with spaces, expands globs
right: |
  mapfile -t files < <(find . -name '*.log')
  # names that may contain newlines:
  mapfile -d '' files < <(find . -name '*.log' -print0)
why: Unquoted command substitution splits on IFS and globs each word.
```

## Practice

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  a=(x y z)
  a+=(w)
  echo "${#a[@]} ${a[1]} ${a[-1]}"
answer: 4 y w
explanation: Appending makes four elements; index 1 is y; -1 is the last.
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  list=("a b" c)
  for x in ${list[@]}; do echo "$x"; done
answer: |
  a
  b
  c
explanation: "Unquoted, `${list[@]}` is re-split into three words. Quoted, it would print two lines: `a b` and `c`."
```

```exercise
kind: command
difficulty: beginner
prompt: "Read `~/data/fruits.txt` into an array with `mapfile`, then print the number of elements."
solution: mapfile -t f < ~/data/fruits.txt; echo "${#f[@]}"
explanation: "`mapfile -t` stores one line per element; `${#f[@]}` counts them."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Reverse and join
prompt: "Read `~/data/servers.txt` and collect the server names (first field) into an array. Print them in reverse order joined by `, `."
starter: |
  #!/usr/bin/env bash
  names=()
solution: |
  #!/usr/bin/env bash
  names=()
  while read -r name _; do
    names+=("$name")
  done < ~/data/servers.txt
  out=""
  for (( i = ${#names[@]} - 1; i >= 0; i-- )); do
    out+="${out:+, }${names[i]}"
  done
  echo "$out"
expectedOutput: mail01, cache01, db01, web02, web01
hints:
  - "Append with `names+=(\"$name\")`."
  - "Loop from `${#names[@]} - 1` down to 0."
  - "`${out:+, }` expands to `, ` only when out is already non-empty."
explanation: "Arrays give random access by index, so reversing is a simple countdown loop."
```
