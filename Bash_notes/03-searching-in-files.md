# Bash: Searching in Files

Searching is one of the most useful skills in Linux.

The main tools covered here are:

```text
grep
find
cat + grep
pipes |
regular expressions
```

---

# 1. `grep`

`grep` searches text inside files.

Basic syntax:

```bash
grep "pattern" file
```

Example:

```bash
grep "Meow" file.txt
```

This prints lines containing `Meow`.

---

# 2. Case-Sensitive Search

By default:

```bash
grep "Meow" file.txt
```

and:

```bash
grep "meow" file.txt
```

are different searches.

---

# 3. Case-Insensitive Search

Use `-i`:

```bash
grep -i "meow" file.txt
```

This can match:

```text
Meow
meow
MEOW
mEoW
```

---

# 4. Show Only the Matching Text

Use:

```bash
grep -o "Meo" file.txt
```

`-o` means:

> print only the matching portion instead of the entire line.

---

# 5. Search with Patterns

`grep` supports regular expressions.

Example:

```bash
grep '^m' file.txt
```

`^` means:

> beginning of the line.

So this searches for lines beginning with `m`.

---

## Any single character: `.`

```bash
grep '^m.' file.txt
```

Here:

```text
^   → beginning
m   → literal m
.   → any single character
```

Therefore it matches something like:

```text
Meow
Mummy
me
```

depending on case sensitivity.

---

# 6. Repeating the Pattern

Example:

```bash
grep '^m..' file.txt
```

This means:

```text
start with m
then any character
then any character
```

Another example:

```bash
grep '^m....' file.txt
```

---

# 7. Context Around Matches

Sometimes you don't want only the matching line.

You want surrounding lines too.

---

## Lines After Match: `-A`

```bash
grep -A2 "Meo" file.txt
```

`-A2` means:

> show 2 lines After the matching line.

---

## Lines Before Match: `-B`

```bash
grep -B2 "Meo" file.txt
```

`-B2` means:

> show 2 lines Before the matching line.

---

## Lines Before and After: `-C`

```bash
grep -C2 "Meo" file.txt
```

`-C2` means:

> show 2 lines of Context around the match.

---

Example:

```bash
grep -B1 -A1 "Meo" file.txt
```

This gives:

```text
1 line before
matching line
1 line after
```

---

# 8. Combining `grep` Options

Options can be combined.

Example:

```bash
grep -i -A2 -B3 "meo" file.txt
```

Meaning:

```text
-i   → case insensitive
-A2  → 2 lines after
-B3  → 3 lines before
```

---

# 9. Searching Using Pipes

The pipe:

```bash
|
```

takes the output of one command and sends it to another command.

Example:

```bash
cat file.txt | grep naman
```

Meaning:

```text
cat file.txt
      ↓
   output
      ↓
grep naman
```

---

# 10. Multiple Searches with Pipes

Example:

```bash
cat file.txt | grep -i nam | grep -i A
```

This means:

1. Read `file.txt`
2. Find lines containing `nam`
3. From those results, find lines containing `A`

---

Another example:

```bash
cat file.txt | grep -i nam | grep -i shi
```

This progressively filters the output.

---

# 11. Searching for a Character

Example:

```bash
grep -i "a" file.txt
```

Find lines containing `a`, ignoring case.

---

Only display the matching character:

```bash
grep -i -o "a" file.txt
```

---

# 12. `find`

`grep` searches **inside files**.

`find` searches for **files/directories themselves**.

This distinction is extremely important.

---

## Find by filename

```bash
find . -name "file.txt"
```

Search from the current directory.

---

## Find all `.txt` files

```bash
find . -name "*.txt"
```

---

## Case-insensitive filename search

```bash
find . -iname "*.txt"
```

---

## Find directories

```bash
find . -type d
```

---

## Find files

```bash
find . -type f
```

---

# 13. Searching the Entire Home Directory

```bash
find ~ -name "file.txt"
```

Search all `.txt` files:

```bash
find ~ -name "*.txt"
```

---

# 14. Combining `find` and `grep`

You can first find files and then search their contents.

Example:

```bash
find . -name "*.txt" -exec grep -i "naman" {} \;
```

This means:

```text
find all .txt files
        ↓
run grep on each file
        ↓
search for "naman"
```

This is a powerful pattern for real-world Linux work.

---

# 15. `grep` Recursively

Instead of manually finding files:

```bash
grep -r "naman" .
```

This searches recursively through files under the current directory.

Case-insensitive:

```bash
grep -ri "naman" .
```

---

# 16. Useful `grep` Options

| Option | Meaning |
|---|---|
| `-i` | Ignore case |
| `-o` | Print only matching text |
| `-A N` | N lines after |
| `-B N` | N lines before |
| `-C N` | N lines before and after |
| `-r` | Recursive search |
| `-n` | Show line numbers |
| `-v` | Invert match |
| `-l` | Show filenames containing match |
| `-c` | Count matching lines |

---

# 17. Line Numbers

```bash
grep -n "naman" file.txt
```

Example:

```text
5:naman
12:Naman
```

Now you know exactly where the match occurs.

---

# 18. Invert Search

`-v` means:

> show lines that DON'T match.

Example:

```bash
grep -v "naman" file.txt
```

This excludes lines containing `naman`.

Case-insensitive:

```bash
grep -iv "naman" file.txt
```

---

# 19. Count Matches

```bash
grep -c "naman" file.txt
```

This counts matching lines.

---

# 20. Show Only Filenames

When searching multiple files:

```bash
grep -rl "naman" .
```

This tells you **which files** contain the text rather than printing all matching lines.

---

# 21. Useful Search Patterns

### Lines starting with `m`

```bash
grep '^m' file.txt
```

### Lines ending with `m`

```bash
grep 'm$' file.txt
```

### Exactly one character after `m`

```bash
grep 'm.' file.txt
```

### Search multiple words

```bash
grep -E 'naman|shikhar' file.txt
```

`-E` enables extended regular expressions.

---

# 22. `cat` Is Not Always Necessary

You used:

```bash
cat file.txt | grep naman
```

It works, but for simple searches this is cleaner:

```bash
grep naman file.txt
```

Instead of:

```bash
cat file.txt | grep naman
```

Why?

Because `grep` can read the file directly.

The pipe becomes useful when the **input comes from another command**.

For example:

```bash
history | grep cargo
```

This is a very useful real-world example.

---

# 23. Searching Your Command History

Since Bash stores command history:

```bash
history | grep cargo
```

Find previous Python commands:

```bash
history | grep python
```

Find commands involving `cd`:

```bash
history | grep "cd "
```

---

# 24. Search Tool Selection

Think of it like this:

```text
"I need to find a FILE"
        ↓
      find

"I need to find TEXT inside a file"
        ↓
      grep

"I need to filter command output"
        ↓
      grep + |

"I need to search an entire directory tree"
        ↓
      grep -r
      or
      find
```

---

# Cheat Sheet

```bash
# Search inside file
grep "word" file.txt

# Case insensitive
grep -i "word" file.txt

# Show matching text only
grep -o "word" file.txt

# Show line numbers
grep -n "word" file.txt

# Show context
grep -A2 "word" file.txt
grep -B2 "word" file.txt
grep -C2 "word" file.txt

# Search recursively
grep -r "word" .

# Find files
find . -name "*.txt"

# Find directories
find . -type d

# Find files
find . -type f

# Combine commands
history | grep cargo

# Multiple filters
cat file.txt | grep -i nam | grep -i shi
```

---

# Most Important Concept

Remember the difference:

```bash
find
```

→ **Where is the file?**

```bash
grep
```

→ **Where is the text?**

```bash
|
```

→ **Take this command's output and give it to another command.**

Once these three concepts become natural, Linux command-line work gets considerably easier.