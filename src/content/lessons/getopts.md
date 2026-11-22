---
objectives:
  - Parse short options (`-v`, `-o FILE`, combined `-vf`) with `getopts`
  - Report invalid options and missing arguments
  - Handle the remaining positional arguments after options with `shift`
  - Parse GNU-style long options with a manual `while/case` loop
summary:
  - "`while getopts 'vo:h' opt; do case $opt in …; esac; done` — a colon after a letter means it takes an argument, available in `$OPTARG`."
  - "A leading colon (`':vo:h'`) enables silent mode: you get `?` for unknown options and `:` for missing arguments, and print your own messages."
  - "After the loop, `shift $((OPTIND - 1))` leaves only the non-option arguments in `$@`."
  - "getopts handles `-abc`, `-ofile` and `-o file`, and stops at `--` or the first non-option."
  - "getopts has no long options; use a `while (( $# )); case $1 in --name=*) …` loop for those."
related:
  - positional-parameters
  - case-statements
  - script-architecture
---

## The problem

Command-line tools take options: `tool -v -o out.txt input1 input2`. Users expect the usual conventions — options in any order, combined flags (`-vf`), arguments attached or separate (`-oout.txt` / `-o out.txt`), `--` to end options. `getopts` (a POSIX builtin) does that parsing for you.

## The getopts loop

```bash title="getopts.sh" playground
parse() {
  local OPTIND opt verbose=0 output=- count=1
  while getopts 'vo:n:h' opt; do
    case $opt in
      v) verbose=1 ;;
      o) output=$OPTARG ;;
      n) count=$OPTARG ;;
      h) echo "usage: tool [-v] [-o FILE] [-n N] ARGS..."; return 0 ;;
      *) echo "usage: tool [-v] [-o FILE] [-n N] ARGS..." >&2; return 2 ;;
    esac
  done
  shift $((OPTIND - 1))
  echo "verbose=$verbose output=$output count=$count args=[$*]"
}
parse -v -o out.txt a b
parse -vn3 -oreport.csv input
parse -- -v is-an-argument
parse -x 2>&1
```

- The **optstring** `'vo:n:h'` lists valid letters; a `:` after a letter means "requires an argument".
- Each call puts the next option letter in `opt` and its argument in `OPTARG`.
- `OPTIND` is the index of the next argument to process. After the loop, `shift $((OPTIND - 1))` removes the options.
- Inside functions, declare `local OPTIND` so repeated calls start fresh.

## Silent error mode

By default getopts prints its own error messages. Starting the optstring with `:` makes it silent and tells you *what* went wrong:

| `opt` value | Meaning | `OPTARG` |
|---|---|---|
| `?` | unknown option | the offending letter |
| `:` | missing argument | the option letter |

```bash title="silent.sh" playground
parse() {
  local OPTIND opt
  while getopts ':f:q' opt; do
    case $opt in
      f) echo "file: $OPTARG" ;;
      q) echo "quiet" ;;
      \?) echo "error: unknown option -$OPTARG" >&2; return 2 ;;
      :)  echo "error: -$OPTARG needs an argument" >&2; return 2 ;;
    esac
  done
}
parse -q -f data.csv
parse -z 2>&1
parse -f 2>&1
```

## A complete script skeleton

```bash
#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<EOF
Usage: ${0##*/} [-v] [-n COUNT] FILE...
  -v        verbose
  -n COUNT  lines to show (default 10)
  -h        show this help
EOF
}

verbose=0 count=10
while getopts ':vn:h' opt; do
  case $opt in
    v) verbose=1 ;;
    n) [[ $OPTARG =~ ^[0-9]+$ ]] || { echo "-n needs a number" >&2; exit 2; }
       count=$OPTARG ;;
    h) usage; exit 0 ;;
    :) echo "option -$OPTARG needs an argument" >&2; usage >&2; exit 2 ;;
    \?) echo "unknown option -$OPTARG" >&2; usage >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))
(( $# > 0 )) || { usage >&2; exit 2; }
```

Exit status 2 is the convention for usage errors.

## Long options

getopts only supports single-letter options. For `--verbose` and `--output=FILE`, write a manual loop:

```bash title="long-options.sh" playground
parse() {
  local verbose=0 output="" args=()
  while (( $# )); do
    case $1 in
      -v|--verbose)   verbose=1 ;;
      -o|--output)    output=${2:?--output needs a value}; shift ;;
      --output=*)     output=${1#*=} ;;
      -h|--help)      echo "usage: …"; return 0 ;;
      --)             shift; args+=("$@"); break ;;
      -*)             echo "unknown option: $1" >&2; return 2 ;;
      *)              args+=("$1") ;;
    esac
    shift
  done
  echo "verbose=$verbose output=$output args=(${args[*]})"
}
parse --verbose --output=report.txt in1 in2
parse in1 -o out.txt -- --not-an-option
```

The external `getopt` command (no "s", from util-linux) can also parse long options, but its behaviour differs between GNU and BSD/macOS — the manual loop is more portable.

## Common mistakes

```mistake
title: Forgetting to shift
wrong: |
  while getopts 'v' opt; do …; done
  for f in "$@"; do …    # still includes -v
right: |
  while getopts 'v' opt; do …; done
  shift $((OPTIND - 1))
  for f in "$@"; do …
why: getopts doesn't remove arguments; it only advances OPTIND.
```

```mistake
title: Missing colon for options with arguments
wrong: |
  while getopts 'vo' opt; do
    case $opt in o) out=$OPTARG ;; esac   # OPTARG is empty
  done
right: |
  while getopts 'vo:' opt; do …
why: Without the colon, -o is a plain flag and its "argument" is treated as a positional argument.
```

## Practice

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  set -- -a -b value file1 file2
  while getopts 'ab:' o; do
    echo "$o${OPTARG:+=$OPTARG}"
  done
  shift $((OPTIND - 1))
  echo "rest: $*"
answer: |
  a
  b=value
  rest: file1 file2
explanation: "-a takes no argument; -b's argument is `value`; after shifting, the files remain."
```

```exercise
kind: fill
difficulty: beginner
prompt: "Write the optstring for options -q (flag), -d DIR and -n NUM, in silent mode."
template: getopts '___' opt
blanks:
  - [":qd:n:", ":qn:d:", ":d:qn:", ":d:n:q", ":n:qd:", ":n:d:q"]
explanation: "Leading colon for silent mode; colons after d and n because they take arguments."
```

```exercise
kind: command
difficulty: intermediate
prompt: "Simulate a script invocation with `set -- -x -f out.txt data.csv`, parse it with getopts (`x` flag, `f:` with argument), and print `x=1 f=out.txt rest=data.csv`."
solution: "set -- -x -f out.txt data.csv; x=0; while getopts 'xf:' o; do case $o in x) x=1;; f) f=$OPTARG;; esac; done; shift $((OPTIND-1)); echo \"x=$x f=$f rest=$*\""
explanation: "After the loop, OPTIND points at `data.csv`."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: A head-like tool
prompt: "Write `mini_head` supporting `-n N` (default 3) and `-q` (don't print `==> FILE <==` headers), followed by one or more files. Unknown options print `mini_head: invalid option -X` to stderr and return 2. Run the given test calls."
starter: |
  #!/usr/bin/env bash
  mini_head() {
    :
  }
  mini_head -n 2 ~/data/fruits.txt ~/data/numbers.txt
  mini_head -q -n1 ~/data/fruits.txt
  mini_head -z ~/data/fruits.txt 2>&1
  echo "status: $?"
solution: |
  #!/usr/bin/env bash
  mini_head() {
    local OPTIND opt n=3 quiet=0 f
    while getopts ':n:q' opt; do
      case $opt in
        n) n=$OPTARG ;;
        q) quiet=1 ;;
        *) echo "mini_head: invalid option -$OPTARG" >&2; return 2 ;;
      esac
    done
    shift $((OPTIND - 1))
    for f in "$@"; do
      (( quiet )) || echo "==> ${f##*/} <=="
      head -n "$n" -- "$f"
    done
  }
  mini_head -n 2 ~/data/fruits.txt ~/data/numbers.txt
  mini_head -q -n1 ~/data/fruits.txt
  mini_head -z ~/data/fruits.txt 2>&1
  echo "status: $?"
expectedOutput: |
  ==> fruits.txt <==
  apple
  banana
  ==> numbers.txt <==
  42
  7
  apple
  mini_head: invalid option -z
  status: 2
checks:
  - pattern: getopts
    message: Parse the options with getopts.
  - pattern: OPTIND
    message: Shift away the options using OPTIND.
hints:
  - "Declare `local OPTIND` so each call parses from the start."
  - "With a leading `:`, unknown options arrive as `?` with the letter in OPTARG."
explanation: "getopts handles `-n 2`, `-n1` and combined flags; the shift leaves just the file names."
```
