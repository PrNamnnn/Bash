# Bash: Basic File Manipulation

Basic commands for navigating directories, creating, viewing, modifying, copying, moving and deleting files and directories.

---

## 1. Current Working Directory

### `pwd`

Prints the current working directory.

```bash
pwd
```

Example:

```text
/home/naman
```

Useful whenever you are unsure where you currently are.

---

## 2. Listing Files

### `ls`

Lists files and directories in the current directory.

```bash
ls
```

### `ls -l`

Shows detailed information.

```bash
ls -l
```

Typical output contains:

```text
permissions  owner  group  size  date  filename
```

### `ls -a`

Shows hidden files as well.

```bash
ls -a
```

### `ls -la`

Detailed listing including hidden files.

```bash
ls -la
```

---

# 3. Changing Directories

## `cd`

Move into a directory.

```bash
cd projects
```

### Go to parent directory

```bash
cd ..
```

### Go to home directory

```bash
cd ~
```

or simply:

```bash
cd
```

### Go to root directory

```bash
cd /
```

### Go to an absolute path

```bash
cd /mnt/c/Users/naman/Desktop/Study/Rust
```

### Directory names containing spaces

Use quotes:

```bash
cd "Lec2 - Guessing game"
```

or escape spaces:

```bash
cd Lec2\ -\ Guessing\ game
```

---

# 4. Creating Directories

## `mkdir`

Creates a directory.

```bash
mkdir projects
```

Create multiple directories:

```bash
mkdir project1 project2 project3
```

### Create nested directories

```bash
mkdir -p projects/bash/notes
```

`-p` creates parent directories if they don't already exist.

---

# 5. Creating Files

## `touch`

Creates an empty file.

```bash
touch file.txt
```

Multiple files:

```bash
touch file1.txt file2.txt file3.txt
```

---

# 6. Reading Files

## `cat`

Displays the contents of a file.

```bash
cat file.txt
```

Example:

```bash
cat main.rs
```

### `less`

Useful for large files.

```bash
less file.txt
```

Navigation:

```text
Space → next page
b     → previous page
q     → quit
```

### `head`

Shows the beginning of a file.

```bash
head file.txt
```

First 10 lines:

```bash
head -n 10 file.txt
```

### `tail`

Shows the end of a file.

```bash
tail file.txt
```

Last 10 lines:

```bash
tail -n 10 file.txt
```

---

# 7. Writing to Files

## `echo`

Print text.

```bash
echo "Hello"
```

### Write to a file

```bash
echo "This is a normal text file" > file.txt
```

`>` **overwrites** the file.

---

## Append to a file

```bash
echo "hello" >> file.txt
```

`>>` **adds** content to the end without deleting existing content.

Example:

```bash
echo naman >> file.txt
echo shikhar >> file.txt
echo priyansh >> file.txt
```

---

# 8. Copying Files

## `cp`

Copy a file.

```bash
cp file.txt backup.txt
```

Copy into a directory:

```bash
cp file.txt projects/
```

Copy multiple files:

```bash
cp file1.txt file2.txt projects/
```

### Copy a directory

```bash
cp -r projects backup/
```

`-r` means recursive.

---

# 9. Moving / Renaming Files

## `mv`

Move a file:

```bash
mv file.txt projects/
```

Rename a file:

```bash
mv old.txt new.txt
```

Rename a directory:

```bash
mv old_folder new_folder
```

Move and rename simultaneously:

```bash
mv file.txt projects/new.txt
```

---

# 10. Removing Files

## `rm`

Delete a file.

```bash
rm file.txt
```

### Ask before deleting

```bash
rm -i file.txt
```

This is especially useful while learning.

Example from practice:

```bash
rm file1.txt -i
```

---

## Delete multiple files

```bash
rm file1.txt file2.txt
```

### Delete a directory

```bash
rm -r projects/
```

`-r` means recursive.

### Force deletion

```bash
rm -f file.txt
```

### Recursive + force

```bash
rm -rf directory/
```

⚠️ `rm -rf` is powerful. There is generally no recycle bin recovery from it.

---

# 11. File Information

## `file`

Determine what type of file something is.

```bash
file file.txt
```

Example:

```bash
file main.exe
```

This is useful because a filename extension alone does not guarantee what the file actually contains.

---

# 12. Command History

## `history`

Shows previously executed commands.

```bash
history
```

Your Bash history is particularly useful while learning because you can see exactly what you previously tried.

---

# 13. Clearing the Terminal

## `clear`

Clears the terminal screen.

```bash
clear
```

Shortcut:

```text
Ctrl + L
```

---

# 14. Command Chaining

Multiple commands can be executed on one line.

```bash
cd ..; cd ..
```

` ; ` means:

> Execute the next command regardless of whether the previous command succeeded.

---

## `&&`

Run the second command only if the first succeeds.

```bash
mkdir project && cd project
```

Another example:

```bash
python3 --version && pip3 --version
```

This is generally safer than blindly chaining commands with `;`.

---

# 15. Wildcards

Wildcards allow patterns to match filenames.

## `*`

Matches zero or more characters.

```bash
ls *.txt
```

Matches all `.txt` files.

Example:

```bash
cat file*.txt
```

---

## `?`

Matches exactly one character.

```bash
ls file?.txt
```

Could match:

```text
file1.txt
file2.txt
fileA.txt
```

---

# 16. Aliases

An alias creates a shortcut for a command.

Example:

```bash
alias ll='ls -la'
```

Now:

```bash
ll
```

runs:

```bash
ls -la
```

View existing aliases:

```bash
alias
```

Remove an alias:

```bash
unalias ll
```

### Make an alias permanent

Edit:

```bash
nano ~/.bashrc
```

Add:

```bash
alias ll='ls -la'
```

Then reload:

```bash
source ~/.bashrc
```

---

# 17. Useful Bash File Commands Cheat Sheet

| Command | Purpose |
|---|---|
| `pwd` | Show current directory |
| `ls` | List files |
| `cd` | Change directory |
| `mkdir` | Create directory |
| `touch` | Create empty file |
| `cat` | Read file |
| `less` | Read large file |
| `head` | Show beginning |
| `tail` | Show end |
| `echo` | Print/write text |
| `cp` | Copy |
| `mv` | Move/rename |
| `rm` | Delete |
| `file` | Identify file type |
| `history` | Show command history |
| `clear` | Clear terminal |
| `alias` | Create command shortcut |

---

# Key Things to Remember

```text
>     overwrite file
>>    append to file

.     current directory
..    parent directory
~     home directory
/     root directory

*     wildcard: many characters
?     wildcard: one character
```

The most important distinction:

```bash
echo hello > file.txt
```

replaces the contents.

Whereas:

```bash
echo hello >> file.txt
```

adds to the existing contents.