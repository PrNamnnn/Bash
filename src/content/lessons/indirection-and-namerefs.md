---
objectives:
  - Read a variable whose name is stored in another variable with `${!name}`
  - Use namerefs (`declare -n`) to pass arrays to functions by reference
  - List variables by prefix with `${!prefix@}`
  - Recognise why `eval` is dangerous and what to use instead
summary:
  - "`${!ref}` expands to the value of the variable *named* by `$ref` (indirect expansion)."
  - "`declare -n alias=target` makes `alias` another name for `target` — reads and writes go through (Bash 4.3+)."
  - "Namerefs are the clean way to return arrays or modify a caller's variable from a function."
  - "`${!prefix@}` lists variable names starting with prefix; `${!arr[@]}` lists array keys (different feature, same symbol)."
  - "Avoid `eval` on anything containing user input; it executes arbitrary code."
related:
  - functions
  - associative-arrays
  - secure-scripting
---

## Indirect expansion

Sometimes the *name* of a variable is data — chosen at runtime:

```bash title="indirect.sh" playground
color_web=green color_db=red color_cache=amber
for svc in web db cache; do
  var="color_$svc"
  echo "$svc is ${!var}"
done
```

`${!var}` means: take the value of `var` (`color_web`), then expand *that* variable.

## Listing variables by prefix

```bash title="prefix.sh" playground
APP_HOST=localhost APP_PORT=8080 APP_MODE=dev OTHER=x
for name in ${!APP_@}; do
  echo "$name=${!name}"
done
```

`${!prefix@}` expands to all variable names beginning with `prefix`. Handy for dumping a group of settings.

## Namerefs: declare -n

A **nameref** is an alias for another variable. Every read or write of the nameref goes to the target:

```bash title="nameref.sh" playground
declare -n ref=target
target=1
ref=2
echo "target is now $target"
```

Their real power is in functions: you can pass the **name** of an array and work on the caller's array directly.

```bash title="nameref-functions.sh" playground
# append to the caller's array
add_item() {
  local -n _list=$1
  _list+=("$2")
}
# "return" an array by filling the caller's variable
split_path() {
  local -n _out=$1
  IFS=/ read -ra _out <<< "${2#/}"
}
# sum any array
sum() {
  local -n _nums=$1
  local total=0 n
  for n in "${_nums[@]}"; do (( total += n )); done
  echo "$total"
}
items=()
add_item items "first thing"
add_item items "second thing"
printf '%s\n' "${items[@]}"
split_path parts /var/log/nginx/access.log
echo "${#parts[@]} parts, last: ${parts[-1]}"
scores=(70 85 92)
echo "sum: $(sum scores)"
```

> [!WARNING] Name collisions
> If the caller's variable has the same name as the nameref (`local -n list=$1` called with `list`), you get a circular reference. Prefix nameref names (`_list`, `__out`) to make collisions unlikely.

## Why not eval?

Before namerefs, people used `eval` to do this. `eval` concatenates its arguments and runs them **as code** — so if any part comes from user input, the user can run anything:

```bash
name='x; rm -rf ~'
eval "$name=42"          # runs: x=42... then rm -rf ~   (DON'T)
```

| Need | Instead of eval, use |
|---|---|
| read a variable by name | `${!name}` |
| assign a variable by name | `printf -v "$name" '%s' "$value"` or `declare -n` |
| arrays by name | `declare -n` |
| build a command | an array: `cmd=(grep -r "$pat"); "${cmd[@]}"` |

```bash title="printf-v.sh" playground
set_var() { printf -v "$1" '%s' "$2"; }
set_var greeting "hello world"
echo "$greeting"
```

`printf -v` validates that the name is a legal identifier, so it can't be abused to run code.

## Common mistakes

```mistake
title: Confusing ${!var} with ${!arr[@]}
wrong: |
  declare -A m=([a]=1)
  echo "${!m}"         # indirection on m's value — not the keys
right: |
  echo "${!m[@]}"      # keys
why: The `!` means indirection on a plain variable but "list keys" with `[@]` or `[*]`.
```

```mistake
title: Building assignments with eval
wrong: |
  eval "config_$key=\$value"
right: |
  declare -A config
  config[$key]=$value
why: A map is usually what you really want; it avoids eval and generated variable names entirely.
```

## Practice

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  a=b; b=c; c=d
  echo "${!a} ${!b}"
answer: c d
explanation: "`${!a}` is the value of b (c); `${!b}` is the value of c (d)."
```

```exercise
kind: predict
difficulty: advanced
prompt: What does this print?
code: |
  inc() { local -n v=$1; (( v += 10 )); }
  count=5
  inc count
  inc count
  echo "$count"
answer: "25"
explanation: The nameref modifies the caller's variable directly each time.
```

```exercise
kind: mcq
difficulty: intermediate
prompt: What is the safest way to assign `$value` to a variable whose name is in `$name`?
options:
  - "`eval \"$name=$value\"`"
  - "`printf -v \"$name\" '%s' \"$value\"`"
  - "`$name=$value`"
  - "`${!name}=$value`"
answer: 1
explanation: "printf -v checks the name and never executes the value. `$name=$value` is just a command name, and `${!name}=` is not an assignment."
```

## Challenge

```exercise
kind: script
difficulty: advanced
title: Array utilities by reference
prompt: "Write `filter_gt ARRAY_NAME LIMIT OUT_NAME` that copies the elements of the named array greater than LIMIT into the array named OUT_NAME, using namerefs. The test prints the result."
starter: |
  #!/usr/bin/env bash
  filter_gt() {
    :
  }
  nums=(4 18 7 42 15 3)
  filter_gt nums 10 big
  echo "${#big[@]}: ${big[*]}"
solution: |
  #!/usr/bin/env bash
  filter_gt() {
    local -n _in=$1 _out=$3
    local x
    _out=()
    for x in "${_in[@]}"; do
      (( x > $2 )) && _out+=("$x")
    done
    return 0
  }
  nums=(4 18 7 42 15 3)
  filter_gt nums 10 big
  echo "${#big[@]}: ${big[*]}"
expectedOutput: "3: 18 42 15"
checks:
  - pattern: (local|declare) -n
    message: Use namerefs (local -n / declare -n).
hints:
  - "`local -n _in=$1 _out=$3` creates both references at once."
  - "Reset the output with `_out=()` before appending."
explanation: "Two namerefs, one for input and one for output, let a function read and fill arrays that belong to its caller."
```
