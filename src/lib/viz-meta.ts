export interface VizMeta {
  id: string;
  title: string;
  description: string;
  lesson: string;
}

/** Metadata for every interactive visualization (used by lessons, the gallery and search). */
export const VIZ: VizMeta[] = [
  { id: "command-execution", title: "How the shell executes a command", description: "Step through reading, tokenising, expansion, redirection, lookup, fork, exec and wait for a real command line.", lesson: "how-a-command-runs" },
  { id: "path-lookup", title: "Command lookup and PATH", description: "Type a command name and watch Bash check aliases, keywords, functions, builtins and then each PATH directory in order.", lesson: "command-lookup" },
  { id: "pipes", title: "Data flowing through a pipeline", description: "Click each stage of a real log-analysis pipeline to see exactly what passes between commands.", lesson: "pipes" },
  { id: "std-streams", title: "stdin, stdout and stderr", description: "Pick a redirection and see where each of the three standard streams ends up.", lesson: "standard-streams" },
  { id: "fd-flow", title: "File descriptor tables and redirection order", description: "Apply redirections left to right and watch the descriptor table change — why `> f 2>&1` differs from `2>&1 > f`.", lesson: "redirection" },
  { id: "expansion", title: "Shell expansion stages", description: "Follow one command line through brace, tilde, parameter, command and arithmetic expansion, word splitting, globbing and quote removal.", lesson: "expansion-order" },
  { id: "quoting", title: "Quoting side by side", description: "Type a value and compare unquoted, double-quoted and single-quoted expansion — including how many arguments the command receives.", lesson: "quoting" },
  { id: "subshell", title: "Process vs subshell", description: "Run the same assignment in the current shell, in ( ), and in a pipeline, and see which changes survive.", lesson: "subshells" },
  { id: "process-tree", title: "Parent and child processes", description: "Toggle export on variables, launch a child process, and see what it inherits — and what it can never send back.", lesson: "environment-inheritance" },
  { id: "jobs", title: "Background jobs and job control", description: "Start, stop, background and foreground simulated jobs with &, Ctrl+Z, bg, fg, jobs and kill.", lesson: "job-control" },
  { id: "signals", title: "Signals and trap", description: "Send signals to a running script with and without trap handlers and see what happens, including the exit status.", lesson: "signals-and-trap" },
  { id: "loops", title: "Loop execution stepper", description: "Step through for, while and C-style loops line by line with live variable values and output.", lesson: "for-loops" },
  { id: "conditionals", title: "Conditional flow", description: "Change the input and watch which branch of an if/elif/else chain runs.", lesson: "if-statements" },
  { id: "functions", title: "Function calls and the call stack", description: "Watch frames push and pop as functions call each other, with local variables and arguments per frame.", lesson: "functions" },
  { id: "arrays", title: "Array operations", description: "Append, unset, slice and iterate an array, and see indices, length and sparse gaps update live.", lesson: "indexed-arrays" },
  { id: "permissions", title: "File permission calculator", description: "Toggle read/write/execute bits and convert between symbolic, octal and ls -l notation.", lesson: "users-groups-permissions" },
  { id: "cron", title: "Cron schedule explainer", description: "Type a crontab expression and get a plain-English description plus the next run times.", lesson: "cron-and-scheduling" },
  { id: "startup", title: "Shell startup sequence", description: "Choose how Bash is started and see which startup files it reads, in which order.", lesson: "startup-files" },
];

export function vizById(id: string): VizMeta | undefined {
  return VIZ.find((v) => v.id === id);
}
