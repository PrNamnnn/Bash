# Bash: Hidden Files

In Linux, files and directories whose names begin with `.` are normally treated as hidden.

Examples:

```text
.bashrc
.bash_history
.profile
.config/
.ssh/
```

Hidden does **not** mean encrypted or protected. It mainly means that normal `ls` does not display them.

---

# 1. Creating a Hidden File

Simply start the filename with `.`:

```bash
touch .secret
```

Create a hidden directory:

```bash
mkdir .config
```

---

# 2. Viewing Hidden Files

Normal:

```bash
ls
```

Hidden files will not normally appear.

Use:

```bash
ls -a
```

`-a` means:

> all files, including hidden files.

---

# 3. Detailed Hidden File Listing

```bash
ls -la
```

This gives:

- permissions
- owner
- group
- size
- modification time
- filename

including hidden files.

---

# 4. Understanding `.` and `..`

When you run:

```bash
ls -la
```

you will normally see:

```text
.
..
.bashrc
file.txt
```

### `.`

Represents the current directory.

```bash
cd .
```

This effectively keeps you where you are.

### `..`

Represents the parent directory.

```bash
cd ..
```

---

# 5. Accessing Hidden Files

Hidden files behave like normal files.

Read one:

```bash
cat .secret
```

Edit one:

```bash
nano .secret
```

Delete one:

```bash
rm .secret
```

Move one:

```bash
mv .secret backup/
```

---

# 6. Hidden Configuration Files

Linux programs commonly store configuration in hidden files/directories.

Examples:

```text
~/.bashrc
~/.profile
~/.config/
~/.ssh/
```

Your Bash configuration:

```bash
cat ~/.bashrc
```

Edit it:

```bash
nano ~/.bashrc
```

After modifying it:

```bash
source ~/.bashrc
```

This reloads the configuration without opening a new terminal.

---

# 7. Finding Hidden Files

Using `find`:

```bash
find ~ -name ".*"
```

This searches for names beginning with `.`.

A more controlled example:

```bash
find . -maxdepth 1 -name ".*"
```

This searches only the current directory.

---

# 8. Hidden Files and Wildcards

This is an important Bash concept.

```bash
ls *
```

does **not** normally match hidden files.

For hidden files:

```bash
ls .*
```

However, be careful because `.*` can also match:

```text
.
..
```

So don't blindly use destructive commands with patterns such as:

```bash
rm -rf .*
```

That is a classic way to create a very bad afternoon.

---

# 9. Common Hidden Files

| File | Purpose |
|---|---|
| `.bashrc` | Bash interactive shell configuration |
| `.bash_history` | Bash command history |
| `.profile` | Shell/login environment configuration |
| `.config/` | Application configuration |
| `.ssh/` | SSH configuration and keys |
| `.git/` | Git repository metadata |

---

# 10. Hidden Files vs Protected Files

A hidden file:

```text
.secret
```

is simply hidden from normal directory listings.

It does **not** automatically mean:

```text
encrypted
private
secure
root-only
```

Permissions determine access.

For example:

```bash
ls -la .secret
```

may show something like:

```text
-rw------- 1 naman naman 20 Oct 11 .secret
```

The permissions determine who can read/write the file.

---

# Cheat Sheet

```bash
ls -a
ls -la

touch .file
mkdir .directory

cat .file
nano .file

find . -name ".*"

cat ~/.bashrc
nano ~/.bashrc
source ~/.bashrc
```

---

# Key Idea

Linux does not have a special "hidden file type".

The convention is simply:

```text
filename starts with .
```

Therefore:

```text
file.txt       → normal
.secret        → hidden
.config/       → hidden directory
```