import { manual } from "@/lib/shell/commands/manual";

/**
 * Rule-based, locally authored "explain this code" engine. It recognises the
 * constructs taught in the course and describes each line in plain English.
 * Lesson examples can override it with hand-written notes.
 */

const BUILTIN_SUMMARY: Record<string, string> = {
  echo: "prints its arguments",
  printf: "prints formatted text (more predictable than echo)",
  cd: "changes the current directory",
  pwd: "prints the current directory",
  read: "reads a line of input into variables",
  local: "declares variables visible only inside the current function",
  export: "marks variables so child processes inherit them",
  declare: "declares variables and sets attributes (-a array, -A map, -i integer, -r read-only)",
  readonly: "makes a variable unchangeable",
  set: "changes shell options or positional parameters",
  shift: "drops the first positional parameter(s), renumbering the rest",
  exit: "ends the script with an exit status",
  return: "leaves the function with a status",
  source: "runs a file in the current shell",
  ".": "runs a file in the current shell (same as source)",
  test: "evaluates a condition",
  "[": "evaluates a condition (the test command)",
  trap: "registers code to run when a signal or EXIT happens",
  unset: "removes a variable or function",
  eval: "re-parses its arguments as shell code (dangerous with untrusted data)",
  exec: "replaces the shell, or applies redirections to the shell itself",
  getopts: "parses short command-line options one at a time",
  mapfile: "reads lines into an array",
  readarray: "reads lines into an array",
  shopt: "toggles optional shell behaviour",
  let: "evaluates arithmetic",
  wait: "waits for background jobs to finish",
  kill: "sends a signal to a process",
  true: "does nothing and succeeds",
  false: "does nothing and fails",
  ":": "does nothing and succeeds (often used as a placeholder)",
  break: "leaves the enclosing loop",
  continue: "skips to the next loop iteration",
  type: "shows how a command name would be resolved",
  command: "runs a command, skipping functions and aliases",
  alias: "defines a shortcut for a command",
  cat: "prints file contents",
};

const KEYWORD_LINES: [RegExp, string][] = [
  [/^#!\s*\/usr\/bin\/env bash/, "Shebang: when this file is executed, the kernel runs it with the first `bash` found in PATH."],
  [/^#!\s*\/bin\/bash/, "Shebang: run this file with /bin/bash when it is executed directly."],
  [/^#!/, "Shebang: names the interpreter that runs this file."],
  [/^#/, "A comment — Bash ignores everything after # on this line."],
  [/^set -euo pipefail/, "Strict mode: exit on errors (-e), error on unset variables (-u), and make pipelines fail if any stage fails (pipefail). Useful, but read the strict-mode lesson for its pitfalls."],
  [/^(then|do|else)$/, "Starts the body of the preceding if/elif/else or loop."],
  [/^fi$/, "Ends the if statement."],
  [/^done/, "Ends the loop."],
  [/^esac$/, "Ends the case statement."],
  [/^\}$/, "Ends the function body or command group."],
  [/^;;$/, "Ends this case branch."],
  [/^else\b/, "Runs when none of the conditions above succeeded."],
];

function describeConstructs(line: string): string[] {
  const notes: string[] = [];
  if (/\$\(\(/.test(line)) notes.push("`$(( ))` performs integer arithmetic.");
  else if (/\(\(/.test(line)) notes.push("`(( ))` evaluates arithmetic; it succeeds when the result is non-zero.");
  if (/\$\((?!\()/.test(line) || /`[^`]+`/.test(line)) notes.push("`$( )` runs a command and substitutes its output.");
  if (/<\(/.test(line)) notes.push("`<( )` is process substitution: a command's output presented as a file.");
  if (/"\$@"/.test(line)) notes.push('`"$@"` expands to every argument, each kept as a separate word.');
  else if (/\$@|\$\*/.test(line)) notes.push("`$@`/`$*` unquoted splits arguments on spaces — usually you want `\"$@\"`.");
  if (/\$#/.test(line)) notes.push("`$#` is the number of positional arguments.");
  if (/\$\?/.test(line)) notes.push("`$?` holds the exit status of the previous command.");
  if (/\$\{[^}]*:-/.test(line)) notes.push("`${var:-default}` uses a fallback when the variable is unset or empty.");
  if (/\$\{[^}]*:\?/.test(line)) notes.push("`${var:?msg}` aborts with an error when the variable is unset or empty.");
  if (/\$\{[^}]*(##|%%|#|%)[^}]*\}/.test(line) && !/\$\{#/.test(line)) notes.push("Pattern removal (`#`, `##`, `%`, `%%`) strips text from the start or end of a value.");
  if (/\$\{[^}]*\/\/?/.test(line)) notes.push("`${var/old/new}` replaces text inside a value (`//` replaces all).");
  if (/\$\{#/.test(line)) notes.push("`${#var}` is a length (characters, or elements for arrays).");
  if (/\[@\]/.test(line)) notes.push('`"${arr[@]}"` expands to every array element as separate words.');
  if (/\[\[/.test(line)) notes.push("`[[ ]]` is Bash's conditional expression: safer than `[ ]`, supports `==` patterns, `=~` regex, `&&` and `||`.");
  else if (/(^|\s)\[\s/.test(line)) notes.push("`[ ]` is the POSIX test command; quote variables inside it.");
  if (/\s-(eq|ne|lt|le|gt|ge)\s/.test(line)) notes.push("`-eq -ne -lt -le -gt -ge` compare integers.");
  if (/\s-(f|d|e|r|w|x|s)\s/.test(line)) notes.push("File tests: -f regular file, -d directory, -e exists, -r/-w/-x permissions, -s non-empty.");
  if (/\s-[zn]\s/.test(line)) notes.push("`-z` is true for an empty string, `-n` for a non-empty one.");
  if (/=~/.test(line)) notes.push("`=~` matches against an extended regular expression; captures land in BASH_REMATCH.");
  if (/2>&1/.test(line)) notes.push("`2>&1` sends stderr to wherever stdout currently points.");
  else if (/2>\s*\/dev\/null/.test(line)) notes.push("`2>/dev/null` discards error messages.");
  else if (/(^|[^0-9&])>>/.test(line)) notes.push("`>>` appends output to a file.");
  else if (/(^|[^0-9<>&-])>(?!&)/.test(line) && !/\[\[.*>.*\]\]/.test(line) && !/\(\(.*>.*\)\)/.test(line)) notes.push("`>` writes output to a file, replacing its contents.");
  if (/<<-?\s*['"]?\w+/.test(line)) notes.push("`<<WORD` starts a here document: the following lines up to WORD become stdin.");
  else if (/<<</.test(line)) notes.push("`<<<` feeds a single string to stdin (here string).");
  else if (/(^|\s)<\s/.test(line)) notes.push("`<` reads stdin from a file.");
  if (/\|\|/.test(line)) notes.push("`||` runs the right side only if the left side fails.");
  if (/&&/.test(line)) notes.push("`&&` runs the right side only if the left side succeeds.");
  if (/(^|[^|])\|(?!\|)/.test(line)) notes.push("`|` pipes stdout of the left command into stdin of the right one.");
  if (/&\s*$/.test(line) && !/&&\s*$/.test(line)) notes.push("A trailing `&` runs the command in the background.");
  return notes;
}

function firstCommand(segment: string): string | undefined {
  const s = segment.trim().replace(/^(if|then|elif|else|do|while|until|!|time)\s+/, "");
  const m = s.match(/^(?:[A-Za-z_]\w*=\S*\s+)*([A-Za-z_.:[][\w.-]*)/);
  return m?.[1];
}

export function explainLine(raw: string): string {
  const line = raw.trim();
  if (!line) return "";
  for (const [re, text] of KEYWORD_LINES) if (re.test(line)) return text;
  const parts: string[] = [];
  let m: RegExpMatchArray | null;
  if ((m = line.match(/^(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{?/)) || (m = line.match(/^function\s+([A-Za-z_][\w-]*)/))) {
    parts.push(`Defines a function named \`${m[1]}\`; call it like a command, its arguments arrive as $1, $2…`);
  } else if ((m = line.match(/^for\s+\(\(/))) {
    parts.push("A C-style for loop: initialise; test; update — like in C or JavaScript.");
  } else if ((m = line.match(/^for\s+(\w+)\s+in\s+(.*?)(;\s*do)?$/))) {
    parts.push(`Loops over each word of \`${m[2]}\`, setting \`${m[1]}\` to one item per iteration.`);
  } else if ((m = line.match(/^for\s+(\w+)\s*(;\s*do)?$/))) {
    parts.push(`Loops over the script's arguments ("$@"), one per iteration, in \`${m[1]}\`.`);
  } else if (/^while\s+.*read/.test(line) || /^while\s+IFS=/.test(line)) {
    parts.push("Reads input one line at a time until it runs out (`IFS= read -r` keeps lines exactly as written).");
  } else if (/^while\b/.test(line)) {
    parts.push("Repeats the body as long as the condition command succeeds.");
  } else if (/^until\b/.test(line)) {
    parts.push("Repeats the body until the condition command succeeds.");
  } else if (/^if\b/.test(line) || /^elif\b/.test(line)) {
    parts.push(`${/^elif/.test(line) ? "Otherwise, tests" : "Tests"} a condition: the body runs if the command's exit status is 0.`);
  } else if ((m = line.match(/^case\s+(.+)\s+in$/))) {
    parts.push(`Compares ${m[1]} against the glob patterns below; the first match wins.`);
  } else if ((m = line.match(/^([^)(\s]+(?:\|[^)\s]+)*)\)/)) && !/\$\(/.test(line.slice(0, m[0].length))) {
    parts.push(`A case branch for values matching \`${m[1]}\`.`);
  } else if ((m = line.match(/^(local|declare|readonly|export)\s+(-\w+\s+)?([A-Za-z_]\w*)(=|$|\s)/))) {
    const kind = m[1] === "local" ? "a function-local" : m[1] === "export" ? "an exported (environment)" : m[1] === "readonly" ? "a read-only" : "a declared";
    parts.push(`Creates ${kind} variable \`${m[3]}\`${m[2] ? ` with options ${m[2].trim()}` : ""}.`);
  } else if ((m = line.match(/^([A-Za-z_]\w*)(\[[^\]]*\])?(\+?)=\((.*)\)?$/))) {
    parts.push(`${m[3] ? "Appends to" : "Creates"} the array \`${m[1]}\`.`);
  } else if ((m = line.match(/^([A-Za-z_]\w*)(\[[^\]]*\])?(\+?)=(\S*)$/))) {
    parts.push(`${m[3] ? "Appends to" : "Assigns a value to"} \`${m[1]}${m[2] ?? ""}\` — no spaces around \`=\` in Bash assignments.`);
  } else {
    const segments = line.split(/\|\||&&|\||;/);
    const cmds = segments.map(firstCommand).filter((c): c is string => !!c && !["then", "do", "fi", "done"].includes(c));
    const described = cmds.slice(0, 3).map((c) => {
      const b = BUILTIN_SUMMARY[c];
      if (b) return `\`${c}\` ${b}`;
      const man = manual[c];
      if (man) return `\`${c}\` — ${man[0]}`;
      return `\`${c}\` runs a command (a function, script or program found via PATH)`;
    });
    if (described.length) parts.push(described.join("; ") + ".");
  }
  parts.push(...describeConstructs(line));
  return parts.join(" ");
}

export function explainCode(code: string, notes?: Record<number, string>): { line: number; code: string; text: string }[] {
  return code
    .split("\n")
    .map((c, i) => ({ line: i + 1, code: c, text: notes?.[i + 1] ?? explainLine(c) }))
    .filter((x) => x.code.trim() && x.text);
}
