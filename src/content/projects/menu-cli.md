## Problem

Build `tasks.sh`, a small interactive task manager for the terminal. It shows a numbered menu, lets the user add, list, complete and delete tasks, validates every input, and saves tasks to a file so they survive between runs. It must also be scriptable: the same commands should work when input is piped in.

## Requirements

- Tasks are stored in `${TASKS_FILE:-~/.local/share/tasks.tsv}`, one per line: `id<TAB>status<TAB>created<TAB>title` (status `todo` or `done`).
- Menu: `1) Add  2) List  3) Complete  4) Delete  5) Clear done  q) Quit`, re-shown after each action.
- Add: prompt for a title; reject empty titles, titles longer than 80 characters and titles containing tabs.
- List: show `[ ]`/`[x]`, id and title, with a count of open tasks; show `(no tasks)` when empty.
- Complete/Delete: prompt for an id; reject non-numbers and unknown ids with a clear message.
- Every change is saved atomically (temp file + `mv`).
- EOF on stdin (Ctrl+D, or the end of piped input) exits cleanly, like `q`.
- Non-interactive shortcuts: `tasks.sh add "Buy milk"`, `tasks.sh list`, `tasks.sh done 3`.

## Steps

### Step 1: Storage layer

Write `load` (read the file into parallel arrays `ids`, `states`, `titles`) and `save` (write them back via a temp file and `mv`). Create the directory and file on first use.

### Step 2: Actions as functions

Implement `add_task TITLE`, `list_tasks`, `complete_task ID`, `delete_task ID` and `clear_done`. Each validates its input, modifies the arrays and calls `save`. New ids are `max id + 1`.

### Step 3: Input helpers

Write `ask PROMPT VAR` that prints the prompt to stderr, reads a line with `read -r`, and returns non-zero on EOF. Use `printf -v` or a nameref to set the caller's variable.

### Step 4: The menu loop

Loop forever: print the menu, `ask` for a choice, dispatch with `case`. Invalid choices print a message and loop again. On EOF or `q`, print `bye` and exit 0.

### Step 5: Command-line mode

If arguments are given, dispatch them to the action functions directly instead of starting the menu, returning appropriate exit codes.

## Hints

- Use a tab separator with `IFS=$'\t' read -r id status created title` so titles may contain spaces.
- Validate ids with `[[ $id =~ ^[0-9]+$ ]]`, then search the `ids` array.
- Print menus and prompts to **stderr** so `tasks.sh list > file` captures only data.
- Test the menu non-interactively: `printf '1\nWrite report\n2\nq\n' | tasks.sh`.
- `${#title} -gt 80` checks the length; `[[ $title == *$'\t'* ]]` detects tabs.

## Expected output

```text
$ printf '1\nWrite report\n1\nReview PR\n3\n1\n2\nq\n' | tasks.sh
added #1: Write report
added #2: Review PR
completed #1
[x]  1  Write report
[ ]  2  Review PR
1 open task(s)
bye
```

(Menus and prompts go to stderr and aren't shown here.)

## Test cases

| Case | Input | Expect |
|---|---|---|
| add + list | `add`, title, `list` | the task appears with `[ ]` |
| empty title | `add`, empty line | `title cannot be empty`, nothing saved |
| bad id | `complete`, `abc` | `not a number: abc` |
| unknown id | `complete`, `99` | `no task #99` |
| persistence | add, quit, start again, list | task still present |
| EOF | input ends without `q` | `bye`, exit 0 |
| CLI mode | `tasks.sh add "X"; tasks.sh done 1` | works without the menu |

## Edge cases

- Titles with quotes, `*`, `$` or backslashes (must be stored literally).
- A tasks file edited by hand with blank lines or malformed rows.
- Two instances running at once (consider `flock`).
- Very long lists — paging with `less` when stdout is a terminal.
- A read-only or full disk when saving.

## Solution

```bash title="tasks.sh" playground
#!/usr/bin/env bash
# tasks.sh — interactive (or scriptable) task manager with a TSV store.
set -uo pipefail
TASKS_FILE=${TASKS_FILE:-$HOME/.local/share/tasks.tsv}
ids=() states=() titles=() created=()

load() {
  ids=() states=() titles=() created=()
  mkdir -p -- "${TASKS_FILE%/*}"; touch -- "$TASKS_FILE"
  local id st cr title
  while IFS=$'\t' read -r id st cr title; do
    [[ $id =~ ^[0-9]+$ && ( $st == todo || $st == done ) ]] || continue   # skip malformed rows
    ids+=("$id"); states+=("$st"); created+=("$cr"); titles+=("$title")
  done < "$TASKS_FILE"
}
save() {
  local tmp i
  tmp=$(mktemp "${TASKS_FILE}.XXXXXX") || return 1
  for i in "${!ids[@]}"; do
    printf '%s\t%s\t%s\t%s\n' "${ids[i]}" "${states[i]}" "${created[i]}" "${titles[i]}"
  done > "$tmp" && mv -f -- "$tmp" "$TASKS_FILE"
}
index_of() {          # index_of ID -> prints the array index, or fails
  local i
  for i in "${!ids[@]}"; do [[ ${ids[i]} == "$1" ]] && { echo "$i"; return 0; }; done
  return 1
}
valid_id() {
  [[ $1 =~ ^[0-9]+$ ]] || { echo "not a number: $1" >&2; return 1; }
  index_of "$1" > /dev/null || { echo "no task #$1" >&2; return 1; }
}

add_task() {
  local title=$1 max=0 id
  [[ -n ${title// /} ]]        || { echo "title cannot be empty" >&2; return 1; }
  (( ${#title} <= 80 ))         || { echo "title is longer than 80 characters" >&2; return 1; }
  [[ $title != *$'\t'* ]]       || { echo "title cannot contain tabs" >&2; return 1; }
  for id in "${ids[@]}"; do (( id > max )) && max=$id; done
  ids+=($((max + 1))); states+=(todo); created+=("$(date +%F)"); titles+=("$title")
  save && echo "added #$((max + 1)): $title"
}
list_tasks() {
  (( ${#ids[@]} )) || { echo "(no tasks)"; return 0; }
  local i open=0 box
  for i in "${!ids[@]}"; do
    if [[ ${states[i]} == done ]]; then box="[x]"; else box="[ ]"; (( ++open )); fi
    printf '%s %2s  %s\n' "$box" "${ids[i]}" "${titles[i]}"
  done
  echo "$open open task(s)"
}
complete_task() { valid_id "$1" || return 1; local i; i=$(index_of "$1"); states[i]=done; save && echo "completed #$1"; }
delete_task()   {
  valid_id "$1" || return 1
  local i; i=$(index_of "$1")
  unset 'ids[i]' 'states[i]' 'created[i]' 'titles[i]'
  ids=("${ids[@]}"); states=("${states[@]}"); created=("${created[@]}"); titles=("${titles[@]}")
  save && echo "deleted #$1"
}
clear_done() {
  local i n=0 -a ni=() ns=() nc=() nt=()
  for i in "${!ids[@]}"; do
    if [[ ${states[i]} == done ]]; then (( ++n )); continue; fi
    ni+=("${ids[i]}"); ns+=("${states[i]}"); nc+=("${created[i]}"); nt+=("${titles[i]}")
  done
  ids=("${ni[@]}"); states=("${ns[@]}"); created=("${nc[@]}"); titles=("${nt[@]}")
  save && echo "removed $n completed task(s)"
}

ask() {               # ask PROMPT VARNAME — fails on EOF
  local -n _out=$2
  printf '%s' "$1" >&2
  IFS= read -r _out
}
menu() {
  local choice title id
  while true; do
    printf '\n1) Add  2) List  3) Complete  4) Delete  5) Clear done  q) Quit\n' >&2
    ask "> " choice || break
    case $choice in
      1) ask "Title: " title || break; add_task "$title" ;;
      2) list_tasks ;;
      3) ask "Task id: " id || break; complete_task "$id" ;;
      4) ask "Task id: " id || break; delete_task "$id" ;;
      5) clear_done ;;
      q|Q) break ;;
      "") ;;
      *) echo "unknown choice: $choice" >&2 ;;
    esac
  done
  echo "bye"
}

main() {
  load
  case ${1:-} in
    "")   menu ;;
    add)  add_task "${*:2}" ;;
    list) list_tasks ;;
    done) complete_task "${2:-}" ;;
    rm)   delete_task "${2:-}" ;;
    *)    echo "usage: ${0##*/} [add TITLE | list | done ID | rm ID]" >&2; return 2 ;;
  esac
}

# Playground demo: drive the menu with piped input (prompts go to stderr).
export TASKS_FILE=/tmp/tasks-demo.tsv; rm -f "$TASKS_FILE"
printf '1\nWrite report\n1\nReview PR\n1\n\n3\nabc\n3\n1\n2\nq\n' | main
echo "--- file contents:"
cat "$TASKS_FILE"
```

## Explanation

- **Separation of concerns:** storage (`load`/`save`), actions (`add_task`, …), input (`ask`) and control flow (`menu`, `main`) are independent, so the same actions serve both the menu and the command-line mode.
- **Tab-separated storage** allows spaces and punctuation in titles; validation forbids the one character (tab) that would corrupt the format.
- **Atomic saves** through a temp file in the same directory mean a crash never leaves a half-written task list.
- **EOF handling:** `ask` returns read's status, so the loop ends cleanly on Ctrl+D or the end of piped input instead of spinning.
- **stderr for UI, stdout for data** makes `tasks.sh list | grep report` and scripted tests clean.
- **Renumbering arrays** after `unset` (`ids=("${ids[@]}")`) keeps parallel arrays aligned.

## Extensions

- Add due dates and priorities; sort the list by them.
- Use `select` for the menu, or `dialog`/`whiptail` for a full-screen interface.
- Add `flock` around load/modify/save so two terminals can't lose each other's changes.
- Support editing a task's title and undoing the last action.
- Export to Markdown checklists (`- [ ] title`) and import from them.
