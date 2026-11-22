/**
 * Public API of the Bash simulator.
 *
 * The simulator is a TypeScript interpreter for a large subset of Bash that
 * runs against an in-memory filesystem. It never executes anything on the
 * user's machine and never uses eval().
 */
import { BufferSink, InStream, newBudget, TTYSink, type Budget, type OutChunk } from "./io";
import { ParseError, Parser } from "./parser";
import { AbortSignal, ExitSignal, Shell } from "./shell";
import { createFs } from "./fixtures";
import { builtins, KEYWORDS } from "./builtins";
import { externals } from "./commands";
import { compareNames, normalizePath, type VFS } from "./vfs";

export type { OutChunk } from "./io";
export { VFS } from "./vfs";

export interface RunResult {
  chunks: OutChunk[];
  status: number;
  /** The output asked the terminal to clear the screen. */
  clear: boolean;
  /** Text echoed after history expansion (e.g. `!!`). */
  echoed?: string;
}

function resetBudget(b: Budget): void {
  b.steps = 0;
  b.outBytes = 0;
  b.startedAt = Date.now();
}

function splitClear(chunks: OutChunk[]): { chunks: OutChunk[]; clear: boolean } {
  let clear = false;
  let out = chunks;
  for (let i = chunks.length - 1; i >= 0; i--) {
    const idx = chunks[i].text.lastIndexOf("\x1b[2J");
    if (idx !== -1) {
      clear = true;
      const rest = chunks[i].text.slice(idx + 4).replace(/^\x1b\[H/, "");
      out = [...(rest ? [{ fd: chunks[i].fd, text: rest }] : []), ...chunks.slice(i + 1)];
      break;
    }
  }
  return { chunks: out, clear };
}

/** An interactive terminal session. */
export class ShellSession {
  sh!: Shell;
  private chunks: OutChunk[] = [];
  private budget: Budget = newBudget();

  constructor(private fixture?: string) {
    this.reset();
  }

  reset(): void {
    this.chunks = [];
    this.budget = newBudget();
    const fs = createFs(this.fixture);
    this.sh = new Shell({ fs, interactive: true, budget: this.budget, ttyChunks: this.chunks });
    this.sh.initEnvironment();
    // Mimic a login shell that sourced ~/.bashrc (aliases, EDITOR, history settings).
    this.sh.aliases.set("ll", "ls -alF");
    this.sh.aliases.set("la", "ls -A");
  }

  get fs(): VFS {
    return this.sh.fs;
  }

  prompt(): string {
    return this.sh.promptString("PS1");
  }

  continuationPrompt(): string {
    return this.sh.promptString("PS2");
  }

  /** True if the input is syntactically incomplete (needs more lines). */
  needsMore(src: string): boolean {
    try {
      new Parser(src, { interactive: true }).parseProgram();
      return false;
    } catch (err) {
      return err instanceof ParseError && err.incomplete;
    }
  }

  /** Expand !! / !$ / !n history references. */
  private historyExpand(line: string): { text: string; error?: string; changed: boolean } {
    const h = this.sh.history;
    if (!line.includes("!")) return { text: line, changed: false };
    let out = "";
    let changed = false;
    let inSingle = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === "'" ) inSingle = !inSingle;
      if (c === "\\" && i + 1 < line.length) {
        out += c + line[++i];
        continue;
      }
      if (c !== "!" || inSingle) {
        out += c;
        continue;
      }
      const rest = line.slice(i + 1);
      let m: RegExpMatchArray | null;
      let event: string | undefined;
      let len = 0;
      if (rest.startsWith("!")) {
        event = h[h.length - 1];
        len = 1;
      } else if (rest.startsWith("$")) {
        const last = h[h.length - 1];
        event = last?.trim().split(/\s+/).pop();
        len = 1;
      } else if ((m = rest.match(/^-?\d+/))) {
        const n = Number(m[0]);
        event = n < 0 ? h[h.length + n] : h[n - 1];
        len = m[0].length;
      } else if ((m = rest.match(/^[A-Za-z][\w.-]*/))) {
        event = [...h].reverse().find((x) => x.startsWith(m![0]));
        len = m[0].length;
      } else {
        out += c;
        continue;
      }
      if (event === undefined) return { text: line, error: `bash: !${rest.slice(0, len)}: event not found`, changed: false };
      out += event;
      changed = true;
      i += len;
    }
    return { text: out, changed };
  }

  run(input: string): RunResult {
    this.chunks.length = 0;
    resetBudget(this.budget);
    const sh = this.sh;
    const exp = this.historyExpand(input);
    if (exp.error) {
      return { chunks: [{ fd: 2, text: exp.error + "\n" }], status: 1, clear: false };
    }
    const src = exp.text;
    if (src.trim()) {
      sh.history.push(src.replace(/\n/g, "\n"));
      if (sh.history.length > 1000) sh.history.shift();
    }
    // Report finished background jobs like bash does before the next prompt.
    let status: number;
    try {
      status = sh.runSource(src, sh.fds);
    } catch (err) {
      if (err instanceof AbortSignal) {
        if (err.message) this.chunks.push({ fd: 2, text: err.message + "\n" });
        status = 130;
        sh.status = 1;
      } else if (err instanceof ExitSignal) {
        status = err.status;
      } else if (err instanceof RangeError) {
        this.chunks.push({ fd: 2, text: "bash-sim: stopped: recursion too deep\n" });
        status = 1;
      } else throw err;
    }
    if (sh.exitRequested) {
      sh.exitRequested = false;
      this.chunks.push({ fd: 2, text: "bash-sim: the simulated terminal stays open after `exit` — type `reset` to start a fresh session.\n" });
    }
    const done = sh.jobs.filter((j) => !j.reported);
    for (const j of done) {
      j.reported = true;
      this.chunks.push({ fd: 2, text: `[${j.id}]+  ${j.status === 0 ? "Done" : `Exit ${j.status}`}                    ${j.cmd}\n` });
    }
    sh.jobs = sh.jobs.filter((j) => !j.reported || true);
    const { chunks, clear } = splitClear(this.chunks.map((c) => ({ ...c })));
    return { chunks, status, clear, echoed: exp.changed ? src : undefined };
  }

  /** Tab completion: returns the replacement range and candidates. */
  complete(line: string): { start: number; candidates: string[] } {
    const sh = this.sh;
    const m = line.match(/(\S*)$/);
    const word = m ? m[1] : "";
    const start = line.length - word.length;
    const before = line.slice(0, start);
    const isCommandPos = /(^|[;&|(]|\$\()\s*$/.test(before) || /(^|\s)(sudo|time|xargs|exec|command)\s+$/.test(before);
    if (word.startsWith("$")) {
      const prefix = word.slice(1).replace(/^\{/, "");
      const names = new Set<string>();
      for (const scope of sh.scopes) for (const k of scope.keys()) if (k.startsWith(prefix)) names.add(k);
      return { start, candidates: [...names].sort(compareNames).map((n) => (word.startsWith("${") ? "${" + n + "}" : "$" + n)) };
    }
    if (isCommandPos && !word.includes("/")) {
      const names = new Set<string>([
        ...Object.keys(builtins),
        ...Object.keys(externals),
        ...sh.funcs.keys(),
        ...sh.aliases.keys(),
        ...[...KEYWORDS].filter((k) => /^[a-z]/.test(k)),
      ]);
      return { start, candidates: [...names].filter((n) => n.startsWith(word)).sort(compareNames) };
    }
    // path completion
    const expanded = word.startsWith("~") ? "/home/learner" + word.slice(1) : word;
    const slash = expanded.lastIndexOf("/");
    const dirPart = slash === -1 ? "" : expanded.slice(0, slash + 1);
    const base = slash === -1 ? expanded : expanded.slice(slash + 1);
    const dirAbs = normalizePath(dirPart || ".", sh.cwd);
    const node = sh.fs.lookup(dirAbs);
    if (!node || node.type !== "dir") return { start, candidates: [] };
    const shownDir = slash === -1 ? "" : word.slice(0, word.lastIndexOf("/") + 1);
    const candidates = [...node.children.entries()]
      .filter(([n]) => n.startsWith(base) && (base.startsWith(".") || !n.startsWith(".")))
      .sort(([a], [b]) => compareNames(a, b))
      .map(([n, child]) => shownDir + n.replace(/([ '"()&;|<>$`\\])/g, "\\$1") + (child.type === "dir" ? "/" : ""));
    return { start, candidates };
  }

  get cwd(): string {
    return this.sh.cwd;
  }
}

export interface ScriptRun {
  chunks: OutChunk[];
  stdout: string;
  stderr: string;
  status: number;
  fs: VFS;
  aborted?: string;
}

/**
 * Run a script non-interactively (the playground and exercise checker).
 * `tty` controls whether stdout behaves like a terminal (colours, columns).
 */
export function runScript(opts: {
  code: string;
  args?: string;
  stdin?: string;
  fixture?: string;
  fs?: VFS;
  tty?: boolean;
  name?: string;
  interactive?: boolean;
}): ScriptRun {
  const budget = newBudget();
  const chunks: OutChunk[] = [];
  const fs = opts.fs ?? createFs(opts.fixture);
  const sh = new Shell({ fs, interactive: opts.interactive ?? false, budget, ttyChunks: chunks });
  sh.initEnvironment();
  if (opts.interactive) {
    sh.aliases.set("ll", "ls -alF");
    sh.aliases.set("la", "ls -A");
  }
  sh.scriptName = opts.interactive ? null : opts.name ?? "script.sh";
  sh.arg0 = opts.name ?? "script.sh";
  let out: BufferSink | TTYSink;
  let err: BufferSink | TTYSink;
  if (opts.tty) {
    out = new TTYSink(chunks, 1, budget);
    err = new TTYSink(chunks, 2, budget);
  } else {
    out = new BufferSink(budget);
    err = new BufferSink(budget);
  }
  sh.fds = new Map([
    [0, { kind: "in", s: new InStream(opts.stdin ?? "", false) }],
    [1, { kind: "out", s: out }],
    [2, { kind: "out", s: err }],
  ]);
  let aborted: string | undefined;
  let status = 0;
  try {
    if (opts.args && opts.args.trim()) {
      const st = sh.runSource(`set -- ${opts.args}`, sh.fds);
      if (st !== 0) throw new AbortSignal("bash-sim: could not parse the arguments");
    }
    status = opts.interactive ? sh.runSource(opts.code, sh.fds) : sh.runScriptBody(opts.code, sh.fds);
  } catch (e) {
    if (e instanceof AbortSignal) {
      aborted = e.message;
      status = 130;
      if (e.message) {
        if (opts.tty) chunks.push({ fd: 2, text: e.message + "\n" });
        else (err as BufferSink).text += e.message + "\n";
      }
    } else if (e instanceof ExitSignal) status = e.status;
    else if (e instanceof RangeError) {
      aborted = "recursion too deep";
      status = 1;
    } else throw e;
  }
  const stdout = opts.tty ? chunks.filter((c) => c.fd === 1).map((c) => c.text).join("") : (out as BufferSink).text;
  const stderr = opts.tty ? chunks.filter((c) => c.fd === 2).map((c) => c.text).join("") : (err as BufferSink).text;
  return { chunks: opts.tty ? chunks : [{ fd: 1, text: stdout }, { fd: 2, text: stderr }].filter((c) => c.text) as OutChunk[], stdout, stderr, status, fs, aborted };
}

/** Check whether source parses; returns an error message or null. */
export function syntaxCheck(code: string): { message: string; line: number } | null {
  try {
    new Parser(code).parseProgram();
    return null;
  } catch (err) {
    if (err instanceof ParseError) return { message: err.message, line: err.line };
    throw err;
  }
}

export { createFs };
export const SUPPORTED_COMMANDS = (): { builtins: string[]; externals: string[] } => ({
  builtins: Object.keys(builtins).sort(compareNames),
  externals: Object.keys(externals).sort(compareNames),
});
