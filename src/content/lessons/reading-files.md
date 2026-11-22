---
objectives:
  - Print, join and number files with `cat`, `nl` and `tac`
  - Page through long files with `less` and know its key bindings
  - Reveal invisible characters such as tabs and Windows line endings
  - Choose the right viewer for the size and purpose of a file
summary:
  - "`cat` prints and concatenates; `cat -A` reveals tabs (`^I`), line ends (`$`) and carriage returns (`^M`)."
  - "`less` pages through files: Space/b to move, `/pattern` to search, `n` for next, `G` for the end, `q` to quit."
  - "`nl` numbers lines (`-ba` for all lines); `tac` prints lines in reverse order."
  - "Use `cat` for small files, `less` to read big ones, `head`/`tail` for samples, and never `cat` a binary to the terminal."
related:
  - head-tail-wc
  - grep-basics
  - inspecting-files
---

## Printing files with cat

::command cat

`cat` really shines at its original job — joining files — and as the start of a pipeline when you want to read several files as one stream:

```bash title="concat.sh" playground
cd ~/logs/archive
cat access.log.2 access.log.1 | wc -l
cat access.log.2 access.log.1 > /tmp/combined.log
head -n 2 /tmp/combined.log
```

### Seeing the invisible

Some characters don't show up on screen but break scripts and data processing: tabs that look like spaces, trailing spaces, and the carriage returns (`\r`) that Windows editors add to every line. `cat -A` makes them visible:

```bash title="invisible.sh" playground
printf 'name\tscore \r\nada\t97\r\n' > /tmp/win.txt
cat /tmp/win.txt
echo "--- cat -A ---"
cat -A /tmp/win.txt
```

`^I` is a tab, `^M` a carriage return, `$` the end of each line. If you see `^M$` at the end of lines in a script, convert it with `sed -i 's/\r$//' file`.

## Reading long files: less and more

::command less more

`less` keys worth memorising:

| Key | Action |
|---|---|
| <kbd>Space</kbd> / <kbd>b</kbd> | Next / previous page |
| <kbd>g</kbd> / <kbd>G</kbd> | Start / end of file |
| `/text` then <kbd>Enter</kbd> | Search forward; <kbd>n</kbd> next match, <kbd>N</kbd> previous |
| `?text` | Search backward |
| <kbd>F</kbd> | Follow the file as it grows (like `tail -f`) |
| <kbd>q</kbd> | Quit |

`man` pages are displayed with `less`, so the same keys work there.

## Numbering and reversing

::command nl tac

## Which viewer when?

| Goal | Use |
|---|---|
| A short config or script | `cat file` |
| A long log or a large file | `less file` |
| The start or end only | `head` / `tail` (next lesson) |
| Live updates | `tail -f` or `less +F` |
| Line numbers for discussion | `nl -ba` or `cat -n` |
| Unknown content | `file` first! |

::terminal
$ cat notes.txt
$ cat -n todo.txt
$ nl notes.txt
$ tac logs/app.log | head -3
$ cat -A data/config.ini | head -3
::

## Common mistakes

```mistake
title: Catting a binary file to the terminal
wrong: |
  cat /usr/bin/ls      # screen fills with garbage, terminal may break
right: |
  file /usr/bin/ls     # find out what it is first
  # if your terminal is garbled: type `reset` and press Enter
why: Binary data contains control sequences that the terminal interprets. Check with `file` before printing unknown files.
```

```mistake
title: Redirecting a file onto itself
wrong: |
  cat header.txt data.csv > data.csv     # data.csv is truncated before cat reads it
right: |
  cat header.txt data.csv > data.tmp && mv data.tmp data.csv
why: The shell sets up `> data.csv` (emptying it) *before* `cat` runs, so the original content is already gone. Write to a new file and rename.
```

## Practice

```exercise
kind: command
difficulty: beginner
prompt: "Print `~/todo.txt` with every line numbered (including blank ones), using `cat`."
solution: cat -n ~/todo.txt
explanation: "`cat -n` numbers every line; `nl -ba` is equivalent with slightly different spacing."
```

```exercise
kind: command
difficulty: beginner
prompt: Print the last line of `~/logs/app.log` first, i.e. the whole file in reverse line order.
solution: tac ~/logs/app.log
hints:
  - Its name is `cat` spelled backwards.
explanation: "`tac` reverses line order — handy for reading logs newest-first. On macOS use `tail -r`."
```

```exercise
kind: mcq
difficulty: beginner
prompt: You are viewing a log in `less`. How do you find the next occurrence of `timeout`?
options:
  - Press Ctrl+F and type timeout
  - Type /timeout and press Enter, then n for further matches
  - Type grep timeout
  - Press q, then run less again
answer: 1
explanation: "`/pattern` searches forward, `n` repeats, `N` goes back. `?pattern` searches backward."
```

## Challenge

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print? (Think about the order in which the shell does things.)
code: |
  cd /tmp
  printf 'a\nb\n' > list.txt
  cat list.txt list.txt > list.txt
  wc -l < list.txt
answer: "0"
hints:
  - When is `> list.txt` applied — before or after cat starts reading?
explanation: "The shell truncates `list.txt` while setting up the redirection, before `cat` runs. `cat` then reads an empty file twice, so the result has 0 lines. GNU cat on a real system detects this and prints `cat: list.txt: input file is output file`."
```
