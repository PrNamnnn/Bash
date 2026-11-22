---
objectives:
  - Read and change permissions in symbolic (`u+x`) and octal (`755`) form
  - Explain what read, write and execute mean for files versus directories
  - Use `umask`, ownership, groups and special bits (setuid, setgid, sticky) correctly
  - Inspect users and groups with `id`, `/etc/passwd` and `/etc/group`, and use `sudo` responsibly
summary:
  - "Every file has an owner, a group, and three permission triplets (user, group, other) of `r w x`."
  - "Octal: r=4, w=2, x=1 per triplet: `755` = rwxr-xr-x, `640` = rw-r-----, `600` = rw-------."
  - "On directories: r = list names, w = create/delete/rename entries, x = enter and access entries by name."
  - "`umask 022` removes write for group/other from new files; `umask 077` makes new files private."
  - "Special bits: setuid (4xxx) runs as the file's owner, setgid (2xxx) on directories makes new files inherit the group, sticky (1xxx) on /tmp stops users deleting others' files."
related:
  - file-tests
  - inspecting-files
  - secure-scripting
---

## Users and groups

Linux identifies every process by a **user ID** (UID) and one or more **group IDs** (GIDs). Files record an owning user and group. Permission checks compare the two.

```bash title="identity.sh" playground
id
groups
grep -E '^(root|learner|deploy):' /etc/passwd
grep -E '^(sudo|learner|deploy):' /etc/group
```

`/etc/passwd` fields: `name:x:UID:GID:comment:home:shell`. Password hashes live in `/etc/shadow`, readable only by root. UID 0 is root, which bypasses most permission checks.

## Reading permissions

::viz permissions

```text
-rwxr-x---  1  learner  deploy  1204  Nov 17 10:02  deploy.sh
│└┬┘└┬┘└┬┘     └──┬──┘  └──┬─┘
│ │  │  │        owner   group
│ │  │  └── other: ---  (no access)
│ │  └───── group: r-x  (read, execute)
│ └──────── user:  rwx  (read, write, execute)
└────────── type: - file, d directory, l symlink
```

The kernel checks **only one** triplet: user if you own the file, else group if you're in its group, else other.

## What r, w, x mean

| Bit | On a file | On a directory |
|---|---|---|
| `r` | read contents | list the names inside (`ls`) |
| `w` | modify contents | create, delete, rename entries inside |
| `x` | execute as a program | enter it (`cd`) and access entries by name |

Consequences: deleting a file needs `w` on the **directory**, not the file. And a directory with `x` but no `r` lets you open files whose names you know, but not list them.

## chmod

```bash title="chmod.sh" playground
cd "$(mktemp -d)"
touch script.sh secret.txt
chmod u+x script.sh            # symbolic: add execute for the owner
chmod go-rwx secret.txt        # remove everything for group and other
chmod 750 .                    # octal: rwxr-x---
ls -l
stat -c '%A %a %n' script.sh secret.txt
```

| Symbolic | Meaning |
|---|---|
| `u` `g` `o` `a` | user, group, other, all |
| `+` `-` `=` | add, remove, set exactly |
| `chmod a+r f` | everyone may read |
| `chmod u=rw,go=r f` | 644 |
| `chmod -R g+rX dir` | recursive; `X` = execute only for directories (and already-executable files) |

| Octal | Typical use |
|---|---|
| `755` | programs, public directories |
| `644` | normal files |
| `700` / `600` | private directories / files (`~/.ssh`, keys) |
| `750` / `640` | shared with a group only |

## umask

New files start from `666` (files) or `777` (directories), minus the **umask**:

```bash title="umask.sh" playground
cd "$(mktemp -d)"
for m in 022 027 077; do
  umask "$m"
  touch "file-$m"; mkdir "dir-$m"
  echo "umask $m → file $(stat -c %a "file-$m"), dir $(stat -c %a "dir-$m")"
done
```

Scripts that write secrets should set `umask 077` first.

## Ownership

```bash
chown alice file            # change owner (root only)
chown alice:developers file # owner and group
chgrp developers file       # group only (if you're a member)
chown -R www-data: /srv/www # recursive; "user:" = user's login group
```

## Special bits

| Bit | Octal | On files | On directories |
|---|---|---|---|
| setuid | 4000 | run with the **owner's** UID (e.g. `/usr/bin/passwd`) | — |
| setgid | 2000 | run with the file's group | new files inherit the directory's group |
| sticky | 1000 | — | only a file's owner may delete it (`/tmp` is `1777`) |

`ls -l` shows them as `s` / `S` in the execute position and `t` / `T` for sticky.

```bash title="special.sh" playground
ls -ld /tmp
cd "$(mktemp -d)"
mkdir shared && chmod 2775 shared && ls -ld shared
```

setgid directories are the standard way to make a team folder where every new file belongs to the team's group.

## sudo

`sudo cmd` runs one command as root (or `-u user`) after checking `/etc/sudoers`. Good habits:

- Use `sudo` for the specific command, not `sudo su` / `sudo -i` for everything.
- Edit sudoers only with `visudo` (it validates syntax before saving).
- `sudo` resets most environment variables; `sudo -E` keeps them (if allowed).
- `sudo tee` for writing root-owned files: `echo "x" | sudo tee -a /etc/hosts > /dev/null` (`sudo echo x >> /etc/hosts` fails — the redirection runs as you).

## Common mistakes

```mistake
title: chmod 777 to "fix" permissions
wrong: |
  chmod -R 777 /var/www       # every user and process can modify your site
right: |
  chown -R www-data:www-data /var/www
  find /var/www -type d -exec chmod 755 {} +
  find /var/www -type f -exec chmod 644 {} +
why: 777 grants write to everyone. Fix ownership instead, and give the minimum bits needed.
```

```mistake
title: sudo with a redirection
wrong: |
  sudo echo "10.0.0.5 db" >> /etc/hosts    # Permission denied
right: |
  echo "10.0.0.5 db" | sudo tee -a /etc/hosts > /dev/null
why: Your (non-root) shell performs the redirection before sudo runs.
```

## Practice

```exercise
kind: mcq
difficulty: beginner
prompt: "What permissions does `chmod 640 report.txt` set?"
options:
  - "rw-r-----"
  - "rwxr-----"
  - "rw-rw----"
  - "r--r-----"
answer: 0
explanation: "6 = rw-, 4 = r--, 0 = ---."
```

```exercise
kind: mcq
difficulty: intermediate
prompt: "A directory has mode `drwxr-xr-x` and is owned by root. As a normal user, can you delete a file inside it that *you* own?"
options:
  - Yes, because you own the file
  - No — deleting needs write permission on the directory
  - Yes, if the file is writable
  - Only with the sticky bit set
answer: 1
explanation: Removing a directory entry modifies the directory, so it needs w on the directory.
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  cd "$(mktemp -d)"
  umask 027
  touch f; mkdir d
  stat -c '%a' f d
answer: |
  640
  750
explanation: "666 − 027 → 640 for files, 777 − 027 → 750 for directories."
```

```exercise
kind: command
difficulty: beginner
prompt: "Show the octal permissions and name of `~/projects/scripts/deploy.sh`, then make it executable for its owner and show them again."
solution: f=~/projects/scripts/deploy.sh; stat -c '%a %n' "$f"; chmod u+x "$f"; stat -c '%a %n' "$f"
explanation: "`u+x` adds only the owner's execute bit: 644 becomes 744."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Permission audit
prompt: "Report risky permissions under `~/projects`: for every regular file, print `world-writable: PATH` if others can write it, and `exec-no-shebang: PATH` if it is executable but doesn't start with `#!`. Before auditing, make `~/projects/website/index.html` world-writable (`chmod o+w`) so there's something to find. Print paths relative to `~` (e.g. `projects/...`), sorted."
starter: |
  #!/usr/bin/env bash
  cd ~
  chmod o+w projects/website/index.html
solution: |
  #!/usr/bin/env bash
  cd ~
  chmod o+w projects/website/index.html
  find projects -type f | sort | while IFS= read -r f; do
    perms=$(stat -c %A "$f")
    [[ ${perms:8:1} == w ]] && echo "world-writable: $f"
    if [[ -x $f ]] && [[ $(head -c 2 "$f") != '#!' ]]; then
      echo "exec-no-shebang: $f"
    fi
  done
expectedOutput: |
  world-writable: projects/website/index.html
checks:
  - pattern: stat|find .*-perm
    message: Inspect permissions with stat or find -perm.
hints:
  - "In `stat -c %A` output (`-rw-r--rw-`), character 8 (0-based) is other's w bit."
  - "`head -c 2 file` reads the first two bytes."
explanation: "All the scripts start with a shebang, so only the world-writable file is reported. `find -perm -o+w` is a faster alternative for the first check."
```
