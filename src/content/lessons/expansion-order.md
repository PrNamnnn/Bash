---
objectives:
  - List Bash's expansion steps in the correct order
  - Explain word splitting and the role of IFS
  - Predict the exact arguments produced by complex command lines
  - Use the order to explain classic bugs and their fixes
summary:
  - "Order: brace → tilde → parameter, arithmetic and command substitution (left to right) → word splitting → pathname expansion → quote removal."
  - "Word splitting only applies to the **unquoted results of expansions**, not to text you typed."
  - "`IFS` (default space, tab, newline) defines the split characters; runs of IFS whitespace count as one separator."
  - "Pathname expansion applies to unquoted results too, so `$var` containing `*` can turn into file names."
  - "Quoting an expansion skips both splitting and globbing — that's why `\"$var\"` is the default."
related:
  - quoting
  - globbing
  - execution-model
---

## The pipeline inside the shell

Before a command runs, every word goes through a fixed sequence of transformations. Knowing the order lets you predict — and debug — any command line.

::viz expansion

| # | Step | Example in → out |
|---|---|---|
| 1 | **Brace expansion** | `a{1,2}` → `a1 a2` |
| 2 | **Tilde expansion** | `~/x` → `/home/learner/x` |
| 3 | **Parameter expansion** | `$name` → `my notes` |
|   | **Arithmetic expansion** | `$((2*3))` → `6` |
|   | **Command substitution** | `$(date +%Y)` → `2026` |
| 4 | **Word splitting** | `my notes` → `my`, `notes` (if unquoted) |
| 5 | **Pathname expansion** | `*.csv` → `sales.csv users.csv` |
| 6 | **Quote removal** | `"a b"` → `a b` |

Step 3's three expansions happen together, left to right. Process substitution (`<(cmd)`) also happens at that point.

## Word splitting

After step 3, Bash looks at the **unquoted results of expansions** and splits them into separate words at characters in the `IFS` variable (Internal Field Separator; default: space, tab, newline).

```bash title="splitting.sh" playground
v="  one   two  three  "
printf '<%s>' $v; echo
printf '<%s>' "$v"; echo
literal="a b"
printf '<%s>' a   b; echo     # text you typed is split by the parser, not by IFS
IFS=,
csv="x,y,,z"
printf '<%s>' $csv; echo
```

Notice:

- Leading and trailing IFS whitespace is ignored, and runs of whitespace count as a single separator.
- Non-whitespace IFS characters (like `,`) are strict: two commas produce an empty field.
- Changing `IFS` affects every later unquoted expansion — scope such changes carefully (`IFS=, read -r a b` limits it to one command).

### An empty unquoted expansion vanishes

If an unquoted expansion results in nothing, the word disappears entirely. A quoted empty expansion stays as an empty argument:

```bash title="vanish.sh" playground
empty=""
printf '[%s] ' a $empty b; echo
printf '[%s] ' a "$empty" b; echo
[ -z $empty ] && echo "test sees: [ -z ] — true by accident"
```

## Pathname expansion of results

Globbing also applies to unquoted expansion results. Data containing `*` or `?` suddenly turns into lists of files:

```bash title="glob-results.sh" playground
cd ~/data
answer="Is it *.csv?"
echo $answer
echo "$answer"
```

## Putting it together

Let's trace a real bug, step by step:

```bash
dir="My Documents"
for f in ~/$dir/*.txt; do echo "$f"; done
```

1. Brace: none.
2. Tilde: `~/$dir/*.txt` → `/home/learner/$dir/*.txt`.
3. Parameter: → `/home/learner/My Documents/*.txt`.
4. Word splitting (unquoted!): → `/home/learner/My` and `Documents/*.txt`.
5. Globbing: `Documents/*.txt` is matched relative to the current directory — probably nothing.

The fix quotes the variable but leaves the glob outside the quotes:

```bash
for f in ~/"$dir"/*.txt; do echo "$f"; done
```

## The other half: what is *not* expanded where

| Context | Splitting / globbing? |
|---|---|
| `x=$y` (assignment) | no |
| `[[ $x == $y ]]` | no splitting; right side is a pattern |
| `case $x in` | no |
| `"…"` | neither |
| `$(…)` result, unquoted | yes |
| `$@` unquoted | yes; `"$@"` keeps arguments intact |

## Common mistakes

```mistake
title: Changing IFS globally
wrong: |
  IFS=,
  read -r a b <<< "1,2"
  for f in $files; do ...   # now splits on commas, not spaces!
right: |
  IFS=, read -r a b <<< "1,2"   # IFS only for this read
why: A plain `IFS=,` lasts for the rest of the script. Prefix the command instead, or save and restore it.
```

```mistake
title: Building commands in a string
wrong: |
  opts="-name '*.log'"
  find . $opts        # find receives  -name  '*.log'  with literal quotes
right: |
  opts=(-name '*.log')
  find . "${opts[@]}"
why: "Quotes inside a variable's value are just characters; quote removal only removes quotes you typed. Use arrays to hold lists of arguments."
```

## Practice

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  x="a   b"
  printf '<%s>' $x "$x"; echo
answer: <a><b><a   b>
explanation: "Unquoted `$x` is split into two words; quoted it stays one, spaces intact."
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  IFS=:
  path="/usr/bin:/bin::/sbin"
  printf '[%s]' $path; echo
answer: "[/usr/bin][/bin][][/sbin]"
explanation: A non-whitespace IFS character separates strictly, so `::` produces an empty field.
```

```exercise
kind: mcq
difficulty: intermediate
prompt: Which step happens **first**?
options:
  - Pathname expansion (`*.txt`)
  - Parameter expansion (`$x`)
  - Brace expansion (`{a,b}`)
  - Word splitting
answer: 2
explanation: Brace expansion is first — which is why `{1..$n}` can't use a variable.
```

## Challenge

```exercise
kind: predict
difficulty: advanced
title: Full trace
prompt: Predict the output exactly.
code: |
  cd ~/data
  n=2; pat='*s.csv'; e=
  printf '<%s>' x{1..2} $((n*3)) $pat "$pat" $e "$e"; echo
answer: <x1><x2><6><sales.csv><users.csv><*s.csv><>
hints:
  - Trace each word through braces, expansions, splitting and globbing.
  - Which empty expansion survives?
explanation: "Braces give `x1 x2`, arithmetic gives `6`, unquoted `$pat` globs to the two CSVs ending in s.csv, quoted `$pat` stays literal, unquoted empty `$e` vanishes and quoted `\"$e\"` remains as an empty argument."
```
