export interface PlaygroundExample {
  id: string;
  title: string;
  description: string;
  code: string;
  args?: string;
  stdin?: string;
  notes?: Record<number, string>;
}

export const PLAYGROUND_EXAMPLES: PlaygroundExample[] = [
  {
    id: "greet",
    title: "Arguments and validation",
    description: "Handle any number of arguments safely, with a usage message and exit codes.",
    args: 'Ada "Grace Hopper" Linus',
    code: `#!/usr/bin/env bash
# Greet every name passed on the command line.

if (( $# == 0 )); then
  echo "usage: $0 NAME..." >&2
  exit 64   # EX_USAGE
fi

for name in "$@"; do
  printf 'Hello, %s! (%d characters)\\n' "$name" "\${#name}"
done

echo "Greeted $# people."`,
    notes: {
      4: "`$#` is the number of arguments. `(( ))` does arithmetic comparison and succeeds when the expression is non-zero.",
      5: "Errors go to stderr (`>&2`) so they don't pollute output that might be piped elsewhere.",
      6: "64 is the conventional 'usage error' code from sysexits.h. Any non-zero status means failure.",
      9: '`"$@"` expands to every argument as a separate word — "Grace Hopper" stays one name.',
      10: "`${#name}` is the length of the string. printf reuses the format for each set of arguments.",
    },
  },
  {
    id: "log-report",
    title: "Access log report",
    description: "Answer real questions about a web server log with a handful of pipelines.",
    code: `#!/usr/bin/env bash
log=logs/access.log

echo "Requests:      $(wc -l < "$log")"
echo "Unique IPs:    $(awk '{print $1}' "$log" | sort -u | wc -l)"
echo "Server errors: $(awk '$9 >= 500' "$log" | wc -l)"
echo

echo "Top 3 clients:"
awk '{print $1}' "$log" | sort | uniq -c | sort -rn | head -3

echo
echo "Status codes:"
awk '{codes[$9]++} END {for (c in codes) printf "  %s  %d\\n", c, codes[c]}' "$log" | sort`,
  },
  {
    id: "csv",
    title: "CSV report with associative arrays",
    description: "Aggregate revenue per region in pure Bash, then compare with an awk one-liner.",
    code: `#!/usr/bin/env bash
declare -A revenue

# skip the header, split each line on commas
while IFS=, read -r date region product units price; do
  cents=\${price/./}                       # 24.50 -> 2450
  (( revenue[$region] += units * 10#$cents ))
done < <(tail -n +2 data/sales.csv)

for region in "\${!revenue[@]}"; do
  total=\${revenue[$region]}
  printf '%-6s %8d.%02d\\n' "$region" $(( total / 100 )) $(( total % 100 ))
done | sort -k2 -rn`,
  },
  {
    id: "strings",
    title: "String manipulation",
    description: "Parameter expansion: defaults, substrings, pattern removal and replacement — no external commands.",
    code: `#!/usr/bin/env bash
path="/var/log/nginx/access.log.2.gz"

echo "file name:  \${path##*/}"
echo "directory:  \${path%/*}"
echo "extension:  \${path##*.}"
echo "no .gz:     \${path%.gz}"
echo "basename:   \${path##*/}" | sed 's/\\..*//'
echo "uppercase:  \${path^^}"
echo "replace:    \${path//\\//:}"
echo "substring:  \${path:5:3}"
echo "length:     \${#path}"

unset missing
echo "default:    \${missing:-fallback}"`,
  },
  {
    id: "stdin",
    title: "Reading input line by line",
    description: "The correct way to process lines: IFS= read -r, and handling a last line without a newline.",
    stdin: "alice,admin\nbob,developer\n  carol , support\ndan,developer",
    code: `#!/usr/bin/env bash
count=0
while IFS=, read -r user role || [[ -n $user ]]; do
  user=\${user// /}          # strip spaces
  role=\${role// /}
  printf '%-6s -> %s\\n' "$user" "$role"
  (( ++count ))
done

echo "processed $count users"`,
    notes: {
      3: "`IFS=,` splits each line on commas for this `read` only. `-r` keeps backslashes literal. `|| [[ -n $user ]]` handles a final line that has no trailing newline.",
      7: "Pre-increment `++count` returns the new value, so it never evaluates to 0 — important under `set -e`.",
    },
  },
  {
    id: "getopts",
    title: "Option parsing with getopts",
    description: "Parse -v, -n NUM and -o FILE in any order, with combined flags and error handling.",
    args: "-v -n 3 -o report.txt extra-arg",
    code: `#!/usr/bin/env bash
usage() { echo "usage: $0 [-v] [-n NUM] [-o FILE] ARGS..." >&2; exit 64; }

verbose=0 count=1 output=/dev/stdout
while getopts ":vn:o:h" opt; do
  case $opt in
    v) verbose=1 ;;
    n) [[ $OPTARG =~ ^[0-9]+$ ]] || { echo "-n needs a number" >&2; exit 64; }
       count=$OPTARG ;;
    o) output=$OPTARG ;;
    h) usage ;;
    :) echo "option -$OPTARG needs a value" >&2; usage ;;
    ?) echo "unknown option -$OPTARG" >&2; usage ;;
  esac
done
shift $(( OPTIND - 1 ))

(( verbose )) && echo "verbose on, count=$count, output=$output" >&2
for (( i = 1; i <= count; i++ )); do
  echo "run $i: $*"
done`,
  },
  {
    id: "trap",
    title: "Cleanup with trap",
    description: "Temporary files that are always removed — even when the script fails halfway.",
    code: `#!/usr/bin/env bash
set -euo pipefail

workdir=$(mktemp -d)
cleanup() {
  echo "cleaning up $workdir" >&2
  rm -rf -- "$workdir"
}
trap cleanup EXIT

echo "working in $workdir"
printf '%s\\n' one two three > "$workdir/data.txt"
wc -l < "$workdir/data.txt"

# simulate a failure: the EXIT trap still runs
grep -q four "$workdir/data.txt"
echo "this line is never reached"`,
  },
  {
    id: "functions",
    title: "Functions, locals and return values",
    description: "Return data by printing, return status with return, and keep variables local.",
    code: `#!/usr/bin/env bash
# Convert bytes to a human-readable size.
human() {
  local bytes=$1 units=(B K M G T) i=0
  while (( bytes >= 1024 && i < \${#units[@]} - 1 )); do
    (( bytes /= 1024, i++ ))
  done
  echo "\${bytes}\${units[i]}"
}

is_even() { (( $1 % 2 == 0 )); }

for n in 512 2048 5242880 3221225472; do
  printf '%12d -> %s\\n' "$n" "$(human "$n")"
done

for n in 3 4; do
  if is_even "$n"; then echo "$n is even"; else echo "$n is odd"; fi
done`,
  },
  {
    id: "heredoc",
    title: "Generating files with here documents",
    description: "Render a config file from variables, then inspect it.",
    code: `#!/usr/bin/env bash
app=shop port=8080 workers=4

cat > /tmp/app.conf <<EOF
# generated by $0 on $(date +%F)
[server]
name = $app
port = $port
workers = $workers
EOF

cat <<'EOF'
Quoted delimiter: $app is NOT expanded here.
EOF

echo "--- /tmp/app.conf ---"
cat /tmp/app.conf
grep -c = /tmp/app.conf`,
  },
  {
    id: "arrays",
    title: "Arrays: build, sort and filter",
    description: "Collect files into an array, sort them, and iterate safely even with spaces in names.",
    code: `#!/usr/bin/env bash
cd ~/downloads

files=(*)                       # glob into an array
echo "found \${#files[@]} files"

pdfs=()
for f in "\${files[@]}"; do
  [[ $f == *.pdf ]] && pdfs+=("$f")
done
echo "PDFs: \${pdfs[*]}"

# sort with a NUL-safe pipeline into a new array
mapfile -t sorted < <(printf '%s\\n' "\${files[@]}" | sort -r)
printf '  - %s\\n' "\${sorted[@]}"`,
  },
  {
    id: "loops",
    title: "Loops and loop control",
    description: "for, while, C-style loops, break and continue in one place.",
    code: `#!/usr/bin/env bash
for i in {1..10}; do
  (( i % 2 )) && continue      # skip odd numbers
  (( i > 8 )) && break         # stop after 8
  printf '%d ' "$i"
done
echo

n=5
while (( n-- > 0 )); do printf '%d.. ' "$n"; done
echo "liftoff"

for (( row = 1; row <= 3; row++ )); do
  for (( col = 1; col <= 3; col++ )); do
    printf '%3d' $(( row * col ))
  done
  echo
done`,
  },
];
