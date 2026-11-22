## Problem

You need strong random passwords and passphrases for new accounts, service credentials and API secrets — generated locally, from a cryptographically secure source, with control over length and character classes, and guaranteed to satisfy common policy rules ("at least one digit and one symbol").

## Requirements

- Usage: `pwgen.sh [-l LENGTH] [-n COUNT] [-c CLASSES] [-x EXCLUDE] [-w WORDS]`
  - `-l` length (default 20, minimum 8, maximum 256)
  - `-n` how many passwords (default 1)
  - `-c` character classes from `l` (lower), `u` (upper), `d` (digits), `s` (symbols); default `luds`
  - `-x` characters to exclude (e.g. `0O1lI` for readability)
  - `-w N` generate an N-word passphrase from a word list instead
- Randomness must come from `/dev/urandom` (never `$RANDOM`, which is predictable and only 15 bits).
- Every generated password contains at least one character from each selected class.
- Print one password per line to stdout and nothing else; errors go to stderr with status 2.
- Report the approximate entropy (`bits`) on stderr with `-v`.

## Steps

### Step 1: Options and validation

Parse options with `getopts`, check numeric ranges, and validate that `-c` only contains `ludS` letters and isn't empty.

### Step 2: Build the alphabet

Map each class to its characters (`a-z`, `A-Z`, `0-9`, a symbol set) and remove excluded characters with parameter expansion or `tr -d`. Reject configurations where a class becomes empty.

### Step 3: Draw random characters

Generate characters with `tr -dc "$alphabet" < /dev/urandom | head -c "$length"`. Understand why `tr -dc` (delete the complement) gives uniform characters: it discards bytes not in the set instead of mapping them.

### Step 4: Enforce the class rules

Check the result contains each required class (`[[ $pw == *[0-9]* ]]` etc.); if not, generate again. With a length ≥ 8 this almost always succeeds on the first or second try.

### Step 5: Passphrases

With `-w`, pick N random lines from a word list using random numbers from `/dev/urandom` (e.g. via `shuf -n` or modulo arithmetic on random bytes), joined by `-`.

### Step 6: Entropy estimate

Entropy ≈ `length × log2(alphabet size)` for passwords and `words × log2(list size)` for passphrases. Compute it with awk.

## Hints

- Put `-` at the end of a `tr` set and `]`/`\` carefully, or avoid them, to keep the set literal.
- `LC_ALL=C tr` treats input as raw bytes, which is what you want with `/dev/urandom`.
- `head -c N` reads only what it needs; the pipeline stops when head exits.
- To pick a random index below N without bias, reject values ≥ the largest multiple of N.
- Never log generated passwords or put them in command lines of other programs.

## Expected output

```text
$ pwgen.sh -l 16 -n 3
q7R$wN2!xLp@9dFz
Vb3#kT8m&Qe5^sYh
...
$ pwgen.sh -l 12 -c ld -x 0O1lI
k4mz8q2rw7tf
$ pwgen.sh -w 4 -v
chalk-meteor-badge-walnut
entropy: ~26.4 bits (4 words from a 97-word list)
```

## Test cases

| Case | Command | Expect |
|---|---|---|
| default | `pwgen.sh` | one 20-character password with all four classes |
| count | `pwgen.sh -n 5 \| wc -l` | `5` |
| classes | `pwgen.sh -c d -l 10` | 10 digits only |
| exclusions | `pwgen.sh -x 0O1lI -n 100 \| grep -c '[0O1lI]'` | `0` |
| too short | `pwgen.sh -l 4` | error, status 2 |
| bad class | `pwgen.sh -c z` | error, status 2 |
| impossible | `pwgen.sh -c d -x 0123456789` | "digits class is empty", status 2 |

## Edge cases

- Symbols that are special in `tr` sets (`-`, `\`, `[`, `]`) or in shells (`$`, `` ` ``, `!`).
- Very long passwords (256 characters) and large counts.
- Systems without `shuf` (macOS) for passphrases.
- Copy-paste problems with ambiguous characters — offer `-x` or a "readable" preset.
- Using the output in scripts: always quote it (`"$pw"`).

## Solution

```bash title="pwgen.sh" playground
#!/usr/bin/env bash
# pwgen.sh — secure password and passphrase generator using /dev/urandom.
set -euo pipefail
export LC_ALL=C
PROG=${0##*/}

LOWER=abcdefghijklmnopqrstuvwxyz
UPPER=ABCDEFGHIJKLMNOPQRSTUVWXYZ
DIGITS=0123456789
SYMBOLS='!@#$%^&*()_+=.,:;?'
WORDS=(acid amber anchor apple arrow atlas autumn badge banjo basil beacon berry bison blade
       bloom bolt bramble brick bronze cactus candle canyon carbon cedar chalk cobalt comet coral
       crane crater dawn delta dune ember falcon fern flint forest galaxy garnet glacier granite
       harbor hazel heron horizon island ivory jade jasmine kettle lagoon lantern lemon lotus
       maple marble meadow meteor mint nectar nickel oasis ocean olive onyx orbit orchid otter
       pebble pepper pine planet plum quartz quill raven reef ripple river saddle saffron sage
       shadow sierra silver spruce staple summit thistle thunder timber topaz tulip velvet walnut willow)

usage() { echo "usage: $PROG [-l LENGTH] [-n COUNT] [-c CLASSES] [-x EXCLUDE] [-w WORDS] [-v]" >&2; exit 2; }
die()   { echo "$PROG: $*" >&2; exit 2; }

rand_below() {        # rand_below N — uniform random integer in [0, N), N <= 100000
  local n=$1 limit r
  limit=$(( 100000 - 100000 % n ))            # reject the biased tail (rejection sampling)
  while :; do
    r=$(tr -dc '0-9' < /dev/urandom | head -c 5)
    r=$(( 10#$r ))                            # 10#: leading zeros are not octal
    (( r < limit )) && { echo $(( r % n )); return; }
  done
}

strip() {             # strip SET EXCLUDE — remove excluded characters from a set
  local set=$1 ex=$2 i c
  for (( i = 0; i < ${#ex}; i++ )); do c=${ex:i:1}; set=${set//"$c"/}; done
  printf '%s' "$set"
}

password() {          # password LENGTH ALPHABET CLASSES
  local len=$1 alphabet=$2 classes=$3 pw
  while :; do
    pw=$(tr -dc "$alphabet" < /dev/urandom | head -c "$len")
    [[ $classes != *l* || $pw == *[a-z]* ]] || continue
    [[ $classes != *u* || $pw == *[A-Z]* ]] || continue
    [[ $classes != *d* || $pw == *[0-9]* ]] || continue
    if [[ $classes == *s* ]]; then
      [[ $pw == *[!a-zA-Z0-9]* ]] || continue
    fi
    printf '%s\n' "$pw"
    return
  done
}

main() {
  local length=20 count=1 classes=luds exclude="" words=0 verbose=0 opt OPTIND
  while getopts ':l:n:c:x:w:vh' opt; do
    case $opt in
      l) length=$OPTARG ;; n) count=$OPTARG ;; c) classes=$OPTARG ;;
      x) exclude=$OPTARG ;; w) words=$OPTARG ;; v) verbose=1 ;;
      *) usage ;;
    esac
  done
  [[ $count =~ ^[1-9][0-9]*$ ]] || die "-n must be a positive integer"

  if [[ $words != 0 ]]; then
    [[ $words =~ ^[1-9][0-9]?$ ]] || die "-w must be 1-99"
    local i j phrase
    for (( i = 0; i < count; i++ )); do
      phrase=""
      for (( j = 0; j < words; j++ )); do phrase+="${phrase:+-}${WORDS[$(rand_below ${#WORDS[@]})]}"; done
      printf '%s\n' "$phrase"
    done
    (( verbose )) && awk -v w="$words" -v n="${#WORDS[@]}" 'BEGIN { printf "entropy: ~%.1f bits (%d words from a %d-word list)\n", w * log(n) / log(2), w, n }' >&2
    return 0
  fi

  [[ $length =~ ^[0-9]+$ ]] && (( length >= 8 && length <= 256 )) || die "-l must be between 8 and 256"
  [[ -n $classes && $classes =~ ^[luds]+$ ]] || die "-c accepts only the letters l, u, d, s"
  local alphabet="" name set
  for name in l u d s; do
    [[ $classes == *$name* ]] || continue
    case $name in l) set=$LOWER ;; u) set=$UPPER ;; d) set=$DIGITS ;; s) set=$SYMBOLS ;; esac
    set=$(strip "$set" "$exclude")
    [[ -n $set ]] || die "the '$name' class is empty after exclusions"
    alphabet+=$set
  done
  local i
  for (( i = 0; i < count; i++ )); do password "$length" "$alphabet" "$classes"; done
  (( verbose )) && awk -v l="$length" -v n="${#alphabet}" 'BEGIN { printf "entropy: ~%.1f bits (%d chars from a %d-symbol alphabet)\n", l * log(n) / log(2), l, n }' >&2
  return 0
}

main -l 16 -n 3
main -l 12 -c ld -x 0O1lI
main -w 4 -v
( main -c d -x 0123456789 ) 2>&1 || echo "(status $?)"
```

## Explanation

- **Secure randomness:** `/dev/urandom` is the kernel's cryptographically secure generator. `$RANDOM` is a 15-bit linear generator — fine for jitter, never for secrets.
- **`tr -dc ALPHABET`** deletes every byte *not* in the alphabet, so the surviving characters are uniformly distributed. Mapping bytes with `% size` instead would bias towards some characters.
- **Retry until the policy holds** keeps the distribution uniform; forcing a digit into a fixed position would make passwords more predictable.
- **Unbiased index selection:** `rand_below` draws a uniform 5-digit number from `/dev/urandom` and rejects values at or above the largest multiple of N (rejection sampling) — the same idea `shuf` and good libraries use. `10#$r` stops numbers like `00812` being read as octal.
- **Passphrase strength depends on the list size:** the demo list has 97 words (~6.6 bits each, so 4 words ≈ 26 bits — too weak for real use). The EFF list of 7776 words gives ~12.9 bits per word; 6 words ≈ 77 bits.
- **Exclusions applied per class** let the script detect impossible requests early with a clear message.
- **Only passwords on stdout:** entropy notes and errors go to stderr, so `pw=$(pwgen.sh)` captures exactly one password.

## Extensions

- Load passphrase words from a large list such as the EFF diceware list (7776 words ≈ 12.9 bits per word).
- Add `--copy` to put the result on the clipboard (`xclip`, `pbcopy`) instead of printing it.
- Pronounceable mode (alternating consonants and vowels) with an honest entropy estimate.
- Check a candidate against the Have I Been Pwned k-anonymity API (`curl` with only the hash prefix).
- Package it as a function in your `~/.bashrc` with completion for its options.
