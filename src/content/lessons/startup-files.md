---
objectives:
  - Classify a shell as login/non-login and interactive/non-interactive
  - Know which startup files each kind of shell reads, in which order
  - Decide what belongs in `~/.bash_profile` / `~/.profile` versus `~/.bashrc`
  - Debug "my alias/PATH works in one terminal but not another"
summary:
  - "Login shells read `/etc/profile`, then the first of `~/.bash_profile`, `~/.bash_login`, `~/.profile`. On exit: `~/.bash_logout`."
  - "Interactive non-login shells read `/etc/bash.bashrc` (Debian/Ubuntu) and `~/.bashrc`."
  - "Non-interactive shells (scripts) read nothing — except the file named in `$BASH_ENV`."
  - "Put environment (`PATH`, `EDITOR`) in the profile; put interactive settings (aliases, prompt, completion) in `.bashrc`; make the profile source `.bashrc`."
  - "macOS Terminal opens login shells; most Linux terminal emulators open non-login shells; zsh uses `.zprofile`/`.zshrc`."
related:
  - environment-inheritance
  - aliases-and-builtins
  - setting-up-bash
---

## Two questions about every shell

- **Login?** Was it started by a login (console, `ssh`, `su -`, `bash --login`)? Check with `shopt -q login_shell`.
- **Interactive?** Is a human typing at it? Check with `[[ $- == *i* ]]`.

::viz startup

| Situation | Login | Interactive |
|---|---|---|
| SSH into a server | yes | yes |
| New tab in GNOME Terminal / Konsole | usually no | yes |
| New window in macOS Terminal / iTerm2 | yes | yes |
| `bash` typed inside a shell | no | yes |
| `./script.sh`, cron job, `bash -c 'cmd'` | no | no |
| `ssh host 'command'` | no | no (but Bash may read `~/.bashrc` — a special case) |

```bash title="what-am-i.sh" playground
shopt -q login_shell && echo "login shell" || echo "non-login shell"
[[ $- == *i* ]] && echo "interactive" || echo "non-interactive (this is a script)"
echo "\$- = $-"
```

## Which files are read

**Login shell** (interactive or not):

1. `/etc/profile` (which typically also runs `/etc/profile.d/*.sh`)
2. The **first one that exists** of `~/.bash_profile`, `~/.bash_login`, `~/.profile`
3. On exit: `~/.bash_logout`

**Interactive non-login shell:**

1. `/etc/bash.bashrc` (Debian/Ubuntu; `/etc/bashrc` on Fedora/RHEL, sourced from `~/.bashrc`)
2. `~/.bashrc`

**Non-interactive shell (scripts):** nothing — unless `BASH_ENV` names a file. When invoked as `sh`, Bash follows the POSIX rules instead (`$ENV` for interactive shells).

```bash title="dotfiles.sh" playground
ls -a ~ | grep '^\.'
echo "--- ~/.profile ---"
cat ~/.profile
```

## What goes where

| File | Purpose | Examples |
|---|---|---|
| `~/.profile` or `~/.bash_profile` | once per login: environment for the whole session | `PATH`, `EDITOR`, `LANG`, starting `ssh-agent` |
| `~/.bashrc` | every interactive shell | aliases, functions, prompt (`PS1`), `HISTSIZE`, `shopt`, completion |
| `~/.bash_logout` | when a login shell exits | clearing the screen |

Because login shells don't read `~/.bashrc` on their own, the standard `~/.bash_profile` is:

```bash
# ~/.bash_profile
[[ -f ~/.profile ]] && . ~/.profile     # shared environment (also used by sh)
[[ -f ~/.bashrc ]] && . ~/.bashrc       # interactive settings
```

And `~/.bashrc` starts by returning early when not interactive, so scripts that source it aren't affected by aliases:

```bash
# ~/.bashrc
[[ $- != *i* ]] && return
```

> [!WARNING] ~/.bash_profile hides ~/.profile
> Bash reads only the *first* existing file of the three. Creating `~/.bash_profile` silently stops `~/.profile` (which your distribution may have set up) from being read — unless you source it.

## Reloading

After editing, either open a new terminal or reload in the current one: `source ~/.bashrc`. Exported variables propagate only to shells started afterwards.

## Debugging startup

```bash
bash -x -i -c exit 2>&1 | less      # trace everything an interactive shell runs at startup
bash --norc                         # start without ~/.bashrc
bash --noprofile --norc             # without any startup files
env -i bash --noprofile --norc      # completely clean shell
```

## zsh and other shells

| Shell | Login | Interactive |
|---|---|---|
| bash | `~/.bash_profile` → `~/.profile` | `~/.bashrc` |
| zsh (macOS default) | `~/.zprofile` | `~/.zshrc` (plus `~/.zshenv` always) |
| sh / dash | `~/.profile` | `$ENV` |

## Common mistakes

```mistake
title: PATH changes in ~/.bashrc that pile up
wrong: |
  # ~/.bashrc
  export PATH="$HOME/bin:$PATH"     # nested shells prepend again and again
right: |
  # ~/.profile (once per login), or guard it:
  case ":$PATH:" in *":$HOME/bin:"*) ;; *) PATH="$HOME/bin:$PATH" ;; esac
why: ".bashrc runs for every interactive shell, including nested ones, so unconditional prepends duplicate entries."
```

```mistake
title: Output from .bashrc breaks scp/rsync
wrong: |
  # ~/.bashrc
  echo "Welcome back!"
right: |
  # ~/.bashrc
  [[ $- == *i* ]] || return
  echo "Welcome back!"
why: Some non-interactive ssh sessions source ~/.bashrc; unexpected output corrupts protocols like scp and rsync.
```

## Practice

```exercise
kind: mcq
difficulty: intermediate
prompt: "You SSH into a server whose home contains both `~/.bash_profile` and `~/.profile`. Which is read automatically?"
options:
  - Both, in that order
  - Only ~/.bash_profile
  - Only ~/.profile
  - Neither; only ~/.bashrc
answer: 1
explanation: An SSH login shell reads the first of .bash_profile, .bash_login, .profile that exists.
```

```exercise
kind: mcq
difficulty: beginner
prompt: Where should you define an alias like `alias ll='ls -alF'`?
options:
  - "/etc/profile"
  - "~/.bash_logout"
  - "~/.bashrc"
  - "~/.ssh/config"
answer: 2
explanation: Aliases are interactive conveniences and must be defined in each interactive shell.
```

```exercise
kind: command
difficulty: beginner
prompt: "Print `yes` if the current shell is interactive and `no` otherwise (here, it's a script)."
solution: "[[ $- == *i* ]] && echo yes || echo no"
explanation: "`$-` contains `i` in interactive shells."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Audit your dotfiles
prompt: "For each of `.bash_profile .bash_login .profile .bashrc .bash_logout` in your home directory, print `FILE: present` or `FILE: absent`. Then print `login shells read: X`, where X is the first of the three login files that exists."
starter: |
  #!/usr/bin/env bash
  cd ~
solution: |
  #!/usr/bin/env bash
  cd ~
  for f in .bash_profile .bash_login .profile .bashrc .bash_logout; do
    [[ -f $f ]] && echo "$f: present" || echo "$f: absent"
  done
  for f in .bash_profile .bash_login .profile; do
    if [[ -f $f ]]; then echo "login shells read: $f"; break; fi
  done
expectedOutput: |
  .bash_profile: absent
  .bash_login: absent
  .profile: present
  .bashrc: present
  .bash_logout: present
  login shells read: .profile
hints:
  - "Use `break` once you find the first login file."
explanation: "This mirrors Bash's own rule: the first existing login file wins."
```
