---
objectives:
  - Read normal and unified `diff` output
  - Compare files, directories and command outputs
  - Use exit statuses of `diff` and `cmp` in scripts and tests
  - Find set differences between lists with `comm`
summary:
  - "`diff a b` describes how to turn a into b: `NcM` change, `NaM` add, `NdM` delete; `<` lines are from a, `>` from b."
  - "`diff -u` is the unified format used by patches and Git: `-` removed, `+` added, with context."
  - "Exit status: 0 identical, 1 different, 2 trouble — perfect for tests."
  - "`cmp` finds the first differing byte (and works on binaries); `comm` compares sorted lists."
related:
  - sort-and-uniq
  - process-substitution
  - testing-shell-scripts
---

## Comparing text with diff

::command diff

### Reading normal format

```text
3c3          ← line 3 of the first file Changes into line 3 of the second
< gamma      ← line from the first file
---
> GAMMA      ← line from the second file
4a5          ← after line 4 of the first file, Add line 5 of the second
> epsilon
```

Think of it as instructions: "to turn `old.txt` into `new.txt`, change line 3 and add a line after line 4."

### Unified format

The unified format (`-u`) shows changes with surrounding context and is what `git diff`, code review tools and `patch` use:

```bash title="unified.sh" playground
cd ~/data
diff -u old.txt new.txt
echo "exit status: $?"
```

Lines starting with `-` exist only in the old file, `+` only in the new one, and a space means unchanged context. `@@ -1,4 +1,5 @@` says the hunk covers 4 lines starting at line 1 in the old file and 5 lines starting at line 1 in the new one.

### Comparing command output

Combine `diff` with process substitution `<( … )` (Level 3) to compare the *output* of two commands without temporary files:

```bash title="compare-output.sh" playground
diff <(ls ~/data) <(ls ~/data; echo extra.csv)
diff <(sort ~/data/fruits.txt | uniq) <(sort -u ~/data/fruits.txt) && echo "identical"
```

## Byte-level comparison

::command cmp

## Set operations on lists

::command comm

## Using exit statuses

`diff`, `cmp` and `grep -q` turn comparisons into exit statuses, which is exactly what tests need:

```bash title="test.sh" playground
expected=$'a\nb'
actual=$(printf 'a\nb\n')
if diff <(echo "$expected") <(echo "$actual") > /dev/null; then
  echo "PASS"
else
  echo "FAIL"
fi
```

::terminal
$ diff data/old.txt data/new.txt
$ diff -u data/old.txt data/new.txt
$ cmp data/old.txt data/new.txt
$ diff -q notes.txt "downloads/notes (copy).txt"
$ comm -3 <(sort data/fruits.txt | uniq) <(printf 'apple\nkiwi\n')
::

## Common mistakes

```mistake
title: Treating diff's exit status 1 as an error
wrong: |
  set -e
  diff expected.txt actual.txt > report.diff   # script stops when files differ
  echo "report written"
right: |
  diff expected.txt actual.txt > report.diff || true
  # or check explicitly: status 0 same, 1 different, 2 error
why: "For `diff` and `cmp`, 1 means \"different\" — a normal answer, not a failure. Handle it deliberately."
```

## Practice

```exercise
kind: mcq
difficulty: beginner
prompt: "In normal diff output, what does `7d6` mean?"
options:
  - Line 7 of the first file was deleted; afterwards the files are in sync at line 6 of the second file
  - Line 6 was duplicated
  - The files differ in 7 places
  - Delete 6 characters from line 7
answer: 0
explanation: "`d` = delete. Line 7 of the first file must be deleted to match the second, where the surrounding content is at line 6."
```

```exercise
kind: command
difficulty: beginner
prompt: "Show the differences between `~/data/old.txt` and `~/data/new.txt` in unified format."
solution: diff -u ~/data/old.txt ~/data/new.txt
explanation: "`diff -u` prints headers with file names and timestamps, then hunks of `-`/`+` lines."
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  cmp -s ~/data/old.txt ~/data/new.txt
  echo $?
  cmp -s ~/notes.txt ~/notes.txt
  echo $?
answer: |
  1
  0
explanation: "`cmp -s` prints nothing; the exit status is 1 when files differ and 0 when they are identical."
```

## Challenge

```exercise
kind: command
difficulty: intermediate
title: What was added?
prompt: "Print only the lines that appear in `~/data/new.txt` but not in `~/data/old.txt`, using `comm` and process substitution to sort both files on the fly."
solution: comm -13 <(sort ~/data/old.txt) <(sort ~/data/new.txt)
hints:
  - "`comm -1` hides lines only in file 1, `-3` hides lines in both."
explanation: "`comm -13` suppresses columns 1 (only in old) and 3 (common), leaving lines only in the new file: `GAMMA` and `epsilon`. comm requires sorted input, hence `<(sort …)`."
```
