import type { Assign, CondExpr, Node, Redir, Word } from "./ast";
import { ArithError, evalArith, type ArithEnv } from "./arith";
import { expandPattern, expandSingle, expandWords } from "./expand";
import { AbortSignal, BreakSignal, ContinueSignal, ExitSignal, ExpansionError, HOME, ReturnSignal, bashQ, shellQuote } from "./signals";

export { AbortSignal, BreakSignal, ContinueSignal, ExitSignal, ExpansionError, HOME, ReturnSignal, bashQ, shellQuote };
import {
  BufferSink,
  cloneFds,
  InStream,
  LimitError,
  NULL_SINK,
  sinkOf,
  stdinOf,
  TTYSink,
  type Budget,
  type FdEntry,
  type FdTable,
  type OutChunk,
  type Sink,
} from "./io";
import { ParseError, Parser, literalOf, subWord } from "./parser";
import { compileRegex, matchGlob, RegexError } from "./pattern";
import { baseName, FsError, fsErrorText, normalizePath, VFS } from "./vfs";
import { builtins, DECLARATION_BUILTINS, SPECIAL_BUILTINS } from "./builtins";
import { externals } from "./commands";
import { evalTest, TestError } from "./test";

/* ------------------------------------------------------------------ */
/* variables                                                           */
/* ------------------------------------------------------------------ */

export type VarValue = string | Map<number, string> | Map<string, string>;

export interface Var {
  kind: "scalar" | "indexed" | "assoc";
  value: VarValue;
  exported?: boolean;
  readonly?: boolean;
  integer?: boolean;
  nameref?: boolean;
  lower?: boolean;
  upper?: boolean;
}

export type Scope = Map<string, Var>;

function cloneVar(v: Var): Var {
  return { ...v, value: typeof v.value === "string" ? v.value : new Map(v.value as Map<never, string>) };
}

export interface CmdCtx {
  sh: Shell;
  name: string;
  args: string[];
  fds: FdTable;
  env: Map<string, string>;
  stdin: InStream;
  out(s: string): void;
  err(s: string): void;
  /** Print "name: msg" to stderr. */
  error(msg: string): void;
  stdoutIsTTY: boolean;
  resolve(p: string): string;
  readInput(p: string): string;
}

export type CommandFn = (ctx: CmdCtx) => number;

export interface ShellOptions {
  fs: VFS;
  interactive?: boolean;
  cwd?: string;
  budget: Budget;
  ttyChunks?: OutChunk[];
}

const DEFAULT_PS1 = "\\[\\e[1;32m\\]\\u@\\h\\[\\e[0m\\]:\\[\\e[1;34m\\]\\w\\[\\e[0m\\]\\$ ";

let nextShellPid = 3000;

export class Shell {
  fs: VFS;
  scopes: Scope[] = [new Map()];
  funcs = new Map<string, { node: Node; src: string; file?: string }>();
  /** Files currently being sourced, innermost last (for BASH_SOURCE). */
  sourceStack: string[] = [];
  aliases = new Map<string, string>();
  opts: Record<string, boolean> = {
    errexit: false,
    nounset: false,
    xtrace: false,
    pipefail: false,
    noclobber: false,
    noglob: false,
    noexec: false,
    verbose: false,
    allexport: false,
    errtrace: false,
    functrace: false,
  };
  shopts: Record<string, boolean> = {
    nullglob: false,
    failglob: false,
    dotglob: false,
    globstar: false,
    nocaseglob: false,
    nocasematch: false,
    extglob: false,
    expand_aliases: false,
    lastpipe: false,
    inherit_errexit: false,
    patsub_replacement: true,
    globskipdots: true,
    login_shell: false,
    histappend: false,
    checkwinsize: true,
    cdspell: false,
    autocd: false,
    xpg_echo: false,
    sourcepath: true,
  };
  cwd: string;
  positional: string[] = [];
  arg0 = "bash";
  status = 0;
  pid: number;
  bashpid: number;
  /** Nesting depth of subshells ($BASH_SUBSHELL). */
  subshellLevel = 0;
  /** Per function frame: set options saved by `local -`. */
  savedOptsStack: (Record<string, boolean> | undefined)[] = [];

  saveOptionsForFrame(): void {
    const i = this.savedOptsStack.length - 1;
    if (i >= 0 && !this.savedOptsStack[i]) this.savedOptsStack[i] = { ...this.opts };
  }

  /** Remembered command locations (`hash`). */
  hashTable = new Map<string, { path: string; hits: number }>();
  /** Source of the simple command being executed ($BASH_COMMAND). */
  bashCommand = "";
  private inPs4 = false;
  ppid = 1;
  lastBg = "";
  interactive: boolean;
  scriptName: string | null = null;
  traps = new Map<string, string>();
  history: string[] = [];
  dirStack: string[] = [];
  fds: FdTable;
  budget: Budget;
  substDepth = 0;
  funcDepth = 0;
  funcNames: string[] = [];
  /** Line numbers each active function was called from (for caller / BASH_LINENO). */
  callLines: number[] = [];
  loopDepth = 0;
  errexitSuppressed = 0;
  currentLine = 1;
  getoptsChar = 1;
  jobs: { id: number; pid: number; cmd: string; status: number; reported: boolean }[] = [];
  notices = new Set<string>();
  devfd = new Map<string, string>();
  pendingWriters: { path: string; node: Node }[] = [];
  lastSubstStatus = 0;
  startTime = Date.now();
  inTrap = false;
  columns = 80;
  isSubshell = false;
  ttyChunks: OutChunk[];
  /** Set when `exit` is used in the interactive top-level shell. */
  exitRequested = false;
  /** fd table in effect before the current builtin's own redirections (for `exec`). */
  outerFds: FdTable | null = null;

  constructor(o: ShellOptions) {
    this.fs = o.fs;
    this.interactive = o.interactive ?? false;
    this.cwd = o.cwd ?? HOME;
    this.budget = o.budget;
    this.pid = nextShellPid++;
    this.bashpid = this.pid;
    this.ttyChunks = o.ttyChunks ?? [];
    this.fds = new Map<number, FdEntry>([
      [0, { kind: "in", s: new InStream("", true) }],
      [1, { kind: "out", s: new TTYSink(this.ttyChunks, 1, this.budget) }],
      [2, { kind: "out", s: new TTYSink(this.ttyChunks, 2, this.budget) }],
    ]);
  }

  /** Initialise the standard environment of a fresh login shell. */
  initEnvironment(): void {
    const env: Record<string, string> = {
      HOME,
      USER: "learner",
      LOGNAME: "learner",
      SHELL: "/bin/bash",
      PATH: "/usr/local/bin:/usr/bin:/bin",
      LANG: "C.UTF-8",
      TERM: "xterm-256color",
      PWD: this.cwd,
      EDITOR: "nano",
    };
    for (const [k, v] of Object.entries(env)) this.setVar(k, v, { export: true });
    const shellVars: Record<string, string> = {
      HOSTNAME: "bash-mastery",
      HOSTTYPE: "x86_64",
      OSTYPE: "linux-gnu",
      MACHTYPE: "x86_64-pc-linux-gnu",
      BASH: "/bin/bash",
      BASH_VERSION: "5.2.21(1)-release",
      IFS: " \t\n",
      PS1: DEFAULT_PS1,
      PS2: "> ",
      PS4: "+ ",
      HISTSIZE: "1000",
      UID: "1000",
      EUID: "1000",
      OPTIND: "1",
      SHLVL: "1",
    };
    for (const [k, v] of Object.entries(shellVars)) this.setVar(k, v);
    this.setArray("BASH_VERSINFO", ["5", "2", "21", "1", "release", "x86_64-pc-linux-gnu"]);
    this.getVarRecord("UID")!.readonly = true;
    this.getVarRecord("EUID")!.readonly = true;
  }

  /* ---------------------------------------------------------------- */
  /* variable access                                                   */
  /* ---------------------------------------------------------------- */

  private resolveName(name: string, depth = 0): string {
    if (depth > 10) return name;
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const v = this.scopes[i].get(name);
      if (v) {
        if (v.nameref && typeof v.value === "string" && v.value) return this.resolveName(v.value.replace(/\[.*$/, ""), depth + 1);
        return name;
      }
    }
    return name;
  }

  getVarRecord(name: string, followRef = true): Var | undefined {
    const n = followRef ? this.resolveName(name) : name;
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const v = this.scopes[i].get(n);
      if (v) return v;
    }
    return undefined;
  }

  /** Dynamic variables computed on read. */
  private dynamicVar(name: string): string | undefined {
    switch (name) {
      case "RANDOM":
        return String(Math.floor(Math.random() * 32768));
      case "SECONDS":
        return String(Math.floor((Date.now() - this.startTime) / 1000));
      case "EPOCHSECONDS":
        return String(Math.floor(Date.now() / 1000));
      case "EPOCHREALTIME":
        return (Date.now() / 1000).toFixed(6);
      case "BASHPID":
        return String(this.bashpid);
      case "BASH_COMMAND":
        return this.bashCommand;
      case "BASH_SUBSHELL":
        return String(this.subshellLevel);
      case "LINENO":
        return String(this.currentLine);
      case "PPID":
        return String(this.ppid);
      case "SHELLOPTS":
        return Object.entries(this.opts)
          .filter(([, v]) => v)
          .map(([k]) => k)
          .concat(["braceexpand", "hashall"])
          .sort()
          .join(":");
      case "BASHOPTS":
        return Object.entries(this.shopts)
          .filter(([, v]) => v)
          .map(([k]) => k)
          .sort()
          .join(":");
      case "FUNCNAME":
        return this.funcNames[this.funcNames.length - 1];
    }
    return undefined;
  }

  /** Value of a scalar variable (element 0 of arrays). undefined if unset. */
  getVar(name: string): string | undefined {
    const dyn = this.dynamicVar(name);
    if (dyn !== undefined) return dyn;
    const v = this.getVarRecord(name);
    if (!v) return undefined;
    if (typeof v.value === "string") return v.value;
    if (v.kind === "indexed") return (v.value as Map<number, string>).get(0);
    return (v.value as Map<string, string>).get("0");
  }

  isSet(name: string): boolean {
    return this.dynamicVar(name) !== undefined || this.getVarRecord(name) !== undefined;
  }

  getArrayValues(name: string): string[] {
    if (name === "FUNCNAME") {
      if (!this.funcNames.length) return [];
      const names = [...this.funcNames].reverse();
      return this.scriptName ? [...names, "main"] : names;
    }
    if (name === "BASH_LINENO") {
      if (!this.funcNames.length) return [];
      return [...[...this.callLines].reverse().map(String), "0"];
    }
    if (name === "BASH_SOURCE") {
      const main = this.scriptName ?? "";
      if (!this.funcNames.length) return [...[...this.sourceStack].reverse(), main];
      const frames = [...this.funcNames].reverse().map((f) => this.funcs.get(f)?.file ?? main);
      return [...frames, main];
    }
    const v = this.getVarRecord(name);
    if (!v) return [];
    if (typeof v.value === "string") return [v.value];
    if (v.kind === "indexed") {
      const m = v.value as Map<number, string>;
      return [...m.keys()].sort((a, b) => a - b).map((k) => m.get(k)!);
    }
    return [...(v.value as Map<string, string>).values()];
  }

  getArrayKeys(name: string): string[] {
    const v = this.getVarRecord(name);
    if (!v) return [];
    if (typeof v.value === "string") return ["0"];
    if (v.kind === "indexed") return [...(v.value as Map<number, string>).keys()].sort((a, b) => a - b).map(String);
    return [...(v.value as Map<string, string>).keys()];
  }

  getElement(name: string, index: string, io: FdTable): string | undefined {
    if (name === "FUNCNAME" || name === "BASH_LINENO" || name === "BASH_SOURCE") {
      const vals = this.getArrayValues(name);
      const i = this.evalIndex(index, name);
      return vals[i < 0 ? vals.length + i : i];
    }
    const v = this.getVarRecord(name);
    if (!v) return undefined;
    if (v.kind === "assoc") return (v.value as Map<string, string>).get(this.expandAssocKey(index, io));
    const i = this.evalIndex(index, name);
    if (typeof v.value === "string") return i === 0 ? v.value : undefined;
    const m = v.value as Map<number, string>;
    if (i < 0) {
      const keys = [...m.keys()].sort((a, b) => a - b);
      const max = keys.length ? keys[keys.length - 1] : -1;
      return m.get(max + 1 + i);
    }
    return m.get(i);
  }

  expandAssocKey(index: string, io: FdTable): string {
    const w = new Parser(index).readWord("string");
    return w ? expandSingle(this, w, io) : index;
  }

  evalIndex(index: string, name?: string): number {
    void name;
    const expanded = this.expandArithText(index);
    return Number(evalArith(expanded, this.arithEnv()));
  }

  private checkWritable(name: string, v?: Var): void {
    if (v?.readonly) throw new ExpansionError(`${name}: readonly variable`, false);
  }

  /** Create or update a variable. */
  setVar(
    name: string,
    value: string,
    o: { local?: boolean; export?: boolean; index?: string; append?: boolean; io?: FdTable } = {},
  ): void {
    const target = this.resolveName(name);
    if (target === "PATH") this.hashTable.clear();
    let scope: Scope | undefined;
    if (o.local) scope = this.scopes[this.scopes.length - 1];
    else {
      for (let i = this.scopes.length - 1; i >= 0; i--) {
        if (this.scopes[i].has(target)) {
          scope = this.scopes[i];
          break;
        }
      }
      scope ??= this.scopes[0];
    }
    let v = scope.get(target);
    this.checkWritable(target, v);
    if (!v) {
      v = { kind: "scalar", value: "" };
      if (this.opts.allexport) v.exported = true;
      scope.set(target, v);
    }
    if (o.export) v.exported = true;
    let val = value;
    if (v.integer) {
      const cur = o.append ? Number(this.getVar(target) ?? 0) : 0;
      val = String(Number(evalArith(this.expandArithText(value), this.arithEnv())) + (o.append ? cur : 0));
    } else if (o.append && o.index === undefined) {
      val = (typeof v.value === "string" ? v.value : this.getVar(target) ?? "") + value;
    }
    if (v.lower) val = val.toLowerCase();
    if (v.upper) val = val.toUpperCase();
    if (o.index !== undefined) {
      if (v.kind === "assoc") {
        const key = this.expandAssocKey(o.index, o.io ?? this.fds);
        const m = v.value as Map<string, string>;
        m.set(key, o.append ? (m.get(key) ?? "") + val : val);
        return;
      }
      if (v.kind === "scalar") {
        const m = new Map<number, string>();
        if (typeof v.value === "string" && v.value !== "") m.set(0, v.value);
        v.kind = "indexed";
        v.value = m;
      }
      const m = v.value as Map<number, string>;
      let i = this.evalIndex(o.index, target);
      if (i < 0) {
        const keys = [...m.keys()];
        i = (keys.length ? Math.max(...keys) + 1 : 0) + i;
        if (i < 0) throw new ExpansionError(`${target}[${o.index}]: bad array subscript`, false);
      }
      m.set(i, o.append ? (m.get(i) ?? "") + val : val);
      return;
    }
    if (v.kind === "indexed") {
      (v.value as Map<number, string>).set(0, val);
      return;
    }
    if (v.kind === "assoc") {
      (v.value as Map<string, string>).set("0", val);
      return;
    }
    v.value = val;
    if (target === "PWD" && !o.local) return;
  }

  setArray(name: string, values: string[], o: { local?: boolean; append?: boolean; keys?: (string | undefined)[]; io?: FdTable } = {}): void {
    const target = this.resolveName(name);
    let scope: Scope | undefined;
    if (o.local) scope = this.scopes[this.scopes.length - 1];
    else {
      for (let i = this.scopes.length - 1; i >= 0; i--) {
        if (this.scopes[i].has(target)) {
          scope = this.scopes[i];
          break;
        }
      }
      scope ??= this.scopes[0];
    }
    let v = scope.get(target);
    this.checkWritable(target, v);
    if (!v) {
      v = { kind: "indexed", value: new Map<number, string>() };
      scope.set(target, v);
    }
    if (v.kind === "assoc") {
      const m = o.append ? (v.value as Map<string, string>) : new Map<string, string>();
      values.forEach((val, i) => {
        const k = o.keys?.[i];
        if (k === undefined) throw new ExpansionError(`${target}: ${val}: must use subscript when assigning associative array`, false);
        m.set(this.expandAssocKey(k, o.io ?? this.fds), val);
      });
      v.value = m;
      return;
    }
    let m: Map<number, string>;
    if (o.append && v.kind === "indexed") m = v.value as Map<number, string>;
    else if (o.append && typeof v.value === "string") m = new Map(v.value ? [[0, v.value]] : []);
    else m = new Map();
    let next = m.size ? Math.max(...m.keys()) + 1 : 0;
    values.forEach((val, i) => {
      const k = o.keys?.[i];
      if (k !== undefined) {
        next = this.evalIndex(k, target);
      }
      m.set(next, v!.integer ? String(evalArith(this.expandArithText(val), this.arithEnv())) : val);
      next++;
    });
    v.kind = "indexed";
    v.value = m;
  }

  unsetVar(name: string, index?: string, io?: FdTable): boolean {
    const target = this.resolveName(name);
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const v = this.scopes[i].get(target);
      if (!v) continue;
      if (v.readonly) throw new ExpansionError(`unset: ${target}: cannot unset: readonly variable`, false);
      if (index !== undefined && index !== "@" && index !== "*") {
        if (v.kind === "assoc") (v.value as Map<string, string>).delete(this.expandAssocKey(index, io ?? this.fds));
        else if (v.kind === "indexed") (v.value as Map<number, string>).delete(this.evalIndex(index));
        else if (this.evalIndex(index) === 0) this.scopes[i].delete(target);
        return true;
      }
      this.scopes[i].delete(target);
      return true;
    }
    return false;
  }

  /** Environment passed to child processes. */
  exportedEnv(extra?: Map<string, string>): Map<string, string> {
    const env = new Map<string, string>();
    for (const scope of this.scopes) {
      for (const [k, v] of scope) {
        if (v.exported && typeof v.value === "string") env.set(k, v.value);
        else if (!v.exported) env.delete(k);
      }
    }
    if (extra) for (const [k, v] of extra) env.set(k, v);
    return env;
  }

  arithEnv(): ArithEnv {
    return {
      get: (name, index) => {
        if (index !== undefined) {
          const v = this.getVarRecord(name);
          if (v?.kind === "assoc") return (v.value as Map<string, string>).get(String(index)) ?? "";
          return this.getElement(name, String(index), this.fds) ?? "";
        }
        const val = this.getVar(name);
        if (val === undefined && this.opts.nounset) throw new ExpansionError(`${name}: unbound variable`, true);
        return val ?? "";
      },
      set: (name, value, index) => {
        this.setVar(name, String(value), index !== undefined ? { index: String(index) } : {});
      },
      isAssoc: (name) => this.getVarRecord(name)?.kind === "assoc",
    };
  }

  /** Expand $var / $(cmd) inside arithmetic text before evaluation. */
  expandArithText(src: string, io: FdTable = this.fds): string {
    if (!/[$`"'\\]/.test(src)) return src;
    const w = new Parser(src).readWord("string");
    return w ? expandSingle(this, w, io) : src;
  }

  arith(src: string, io: FdTable): bigint {
    return evalArith(this.expandArithText(src, io), this.arithEnv());
  }

  /* ---------------------------------------------------------------- */
  /* process helpers                                                   */
  /* ---------------------------------------------------------------- */

  nextPid(): number {
    return ++this.budget.pidSeq;
  }

  tick(): void {
    const b = this.budget;
    b.steps++;
    if (b.steps > b.maxSteps) {
      throw new AbortSignal(
        `bash-sim: stopped after ${b.maxSteps.toLocaleString("en-US")} steps — this usually means an infinite loop`,
      );
    }
    if ((b.steps & 1023) === 0 && Date.now() - b.startedAt > b.maxMillis) {
      throw new AbortSignal("bash-sim: stopped after running for too long — this usually means an infinite loop");
    }
  }

  /** Create a subshell: a copy of this shell's state that shares the filesystem. */
  subshell(): Shell {
    const s = Object.create(Shell.prototype) as Shell;
    Object.assign(s, this);
    s.scopes = this.scopes.map((sc) => {
      const m: Scope = new Map();
      for (const [k, v] of sc) m.set(k, cloneVar(v));
      return m;
    });
    s.funcs = new Map(this.funcs);
    s.aliases = new Map(this.aliases);
    s.opts = { ...this.opts };
    if (!this.shopts.inherit_errexit && this.substDepth >= 0) s.opts.errexit = this.opts.errexit;
    s.shopts = { ...this.shopts };
    s.positional = [...this.positional];
    // Traps are reset in subshells, except ignored signals.
    s.traps = new Map([...this.traps].filter(([, v]) => v === ""));
    s.fds = cloneFds(this.fds);
    s.dirStack = [...this.dirStack];
    s.funcNames = [...this.funcNames];
    s.callLines = [...this.callLines];
    s.sourceStack = [...this.sourceStack];
    s.savedOptsStack = [...this.savedOptsStack];
    s.hashTable = new Map([...this.hashTable].map(([k, v]) => [k, { ...v }]));
    s.bashpid = this.nextPid();
    s.subshellLevel = this.subshellLevel + 1;
    s.jobs = [];
    s.pendingWriters = [];
    s.isSubshell = true;
    s.interactive = false;
    s.exitRequested = false;
    return s;
  }

  errPrefix(): string {
    if (this.interactive && !this.scriptName) return "bash";
    if (this.scriptName) return `${this.scriptName}: line ${this.currentLine}`;
    return `bash: line ${this.currentLine}`;
  }

  /* ---------------------------------------------------------------- */
  /* top-level entry points                                            */
  /* ---------------------------------------------------------------- */

  /** Parse and run source text. Returns the final status. */
  runSource(src: string, fds: FdTable = this.fds): number {
    let node: Node;
    try {
      node = new Parser(src, { interactive: this.interactive }).parseProgram();
    } catch (err) {
      if (err instanceof ParseError) {
        const prefix = this.interactive && !this.scriptName ? "bash" : `${this.scriptName ?? "bash"}: line ${err.line}`;
        sinkOf(fds, 2).write(`${prefix}: ${err.message}\n`);
        this.status = 2;
        return 2;
      }
      throw err;
    }
    return this.runNode(node, fds);
  }

  /** Run trap code; $LINENO inside it refers to the line that triggered the trap. */
  runTrapSource(src: string, fds: FdTable): number {
    const line = this.currentLine;
    let node: Node;
    try {
      node = new Parser(src, { interactive: this.interactive, baseLine: line }).parseProgram();
    } catch (err) {
      if (err instanceof ParseError) {
        sinkOf(fds, 2).write(`${this.errPrefix()}: ${err.message}\n`);
        return 2;
      }
      throw err;
    }
    try {
      return this.runNode(node, fds);
    } finally {
      this.currentLine = line;
    }
  }

  runNode(node: Node, fds: FdTable): number {
    try {
      this.status = this.exec(node, fds);
    } catch (err) {
      if (err instanceof ExitSignal) {
        this.status = err.status;
        if (this.interactive && !this.isSubshell) this.exitRequested = true;
        else throw err;
      } else if (err instanceof ReturnSignal) {
        sinkOf(fds, 2).write(`${this.errPrefix()}: return: can only \`return' from a function or sourced script\n`);
        this.status = 1;
      } else if (err instanceof BreakSignal || err instanceof ContinueSignal) {
        this.status = 0;
      } else if (err instanceof LimitError) {
        throw new AbortSignal("bash-sim: output limit reached; stopping");
      } else throw err;
    }
    return this.status;
  }

  /** Run a whole script as the main program of this (non-interactive) shell. */
  runScriptBody(src: string, fds: FdTable): number {
    let status = 0;
    try {
      status = this.runSource(src, fds);
    } catch (err) {
      if (err instanceof ExitSignal) status = err.status;
      else throw err;
    }
    this.status = status;
    return this.runExitTrap(fds, status);
  }

  runExitTrap(fds: FdTable, status: number): number {
    const trap = this.traps.get("EXIT");
    if (trap && !this.inTrap) {
      this.traps.delete("EXIT");
      this.inTrap = true;
      this.status = status;
      try {
        this.runSource(trap, fds);
      } catch (err) {
        if (err instanceof ExitSignal) return err.status;
        throw err;
      } finally {
        this.inTrap = false;
      }
    }
    return status;
  }

  /* ---------------------------------------------------------------- */
  /* execution                                                         */
  /* ---------------------------------------------------------------- */

  private checkErrexit(status: number, fds: FdTable): void {
    if (status === 0 || this.errexitSuppressed > 0 || this.inTrap) return;
    const errTrap = this.traps.get("ERR");
    // Without `set -E`, functions, substitutions and subshells don't inherit the ERR trap.
    if (errTrap && (this.opts.errtrace || (this.funcDepth === 0 && !this.isSubshell))) {
      this.inTrap = true;
      const saved = this.status;
      try {
        this.status = status;
        this.runTrapSource(errTrap, fds);
      } finally {
        this.inTrap = false;
        this.status = saved;
      }
    }
    if (this.opts.errexit) throw new ExitSignal(status);
  }

  exec(node: Node, fds: FdTable): number {
    switch (node.k) {
      case "list":
        return this.execList(node, fds);
      case "andor":
        return this.execAndOr(node, fds);
      case "pipeline":
        return this.execPipeline(node, fds);
      case "simple": {
        if (!this.inTrap) this.bashCommand = node.src;
        const st = this.execSimple(node, fds);
        this.status = st;
        this.checkErrexit(st, fds);
        return st;
      }
      case "func":
        this.funcs.set(node.name, { node: node.body, src: node.src, file: this.sourceStack[this.sourceStack.length - 1] ?? this.scriptName });
        return 0;
      default:
        return this.execCompound(node, fds);
    }
  }

  private execList(node: Extract<Node, { k: "list" }>, fds: FdTable): number {
    let status = this.status;
    for (const item of node.items) {
      if (item.bg) {
        status = this.execBackground(item.node, fds);
      } else {
        status = this.exec(item.node, fds);
      }
      this.status = status;
    }
    return status;
  }

  private execBackground(node: Node, fds: FdTable): number {
    const pid = this.nextPid();
    const id = (this.jobs.length ? Math.max(...this.jobs.map((j) => j.id)) : 0) + 1;
    if (this.interactive) sinkOf(fds, 2).write(`[${id}] ${pid}\n`);
    if (!this.notices.has("bg")) {
      this.notices.add("bg");
      sinkOf(fds, 2).write(
        "bash-sim: note: background jobs run to completion immediately in this simulator; on a real system they run concurrently.\n",
      );
    }
    const sub = this.subshell();
    sub.bashpid = pid;
    let st = 0;
    try {
      st = sub.exec(node, fds);
    } catch (err) {
      if (err instanceof ExitSignal) st = err.status;
      else throw err;
    }
    this.jobs.push({ id, pid, cmd: describeNode(node), status: st, reported: false });
    this.lastBg = String(pid);
    return 0;
  }

  private execAndOr(node: Extract<Node, { k: "andor" }>, fds: FdTable): number {
    const all = [node.first, ...node.rest.map((r) => r.node)];
    const ops = node.rest.map((r) => r.op);
    let status: number;
    this.errexitSuppressed++;
    try {
      status = this.exec(node.first, fds);
    } finally {
      this.errexitSuppressed--;
    }
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      const isLast = i === ops.length - 1;
      if ((op === "&&" && status !== 0) || (op === "||" && status === 0)) continue;
      if (isLast) status = this.exec(all[i + 1], fds);
      else {
        this.errexitSuppressed++;
        try {
          status = this.exec(all[i + 1], fds);
        } finally {
          this.errexitSuppressed--;
        }
      }
      this.status = status;
    }
    this.status = status;
    return status;
  }

  private execPipeline(node: Extract<Node, { k: "pipeline" }>, fds: FdTable): number {
    const start = Date.now();
    let status: number;
    const statuses: number[] = [];
    if (node.negate) this.errexitSuppressed++;
    try {
      if (node.cmds.length === 1) {
        status = this.exec(node.cmds[0], fds);
        statuses.push(status);
      } else {
        let input: InStream = stdinOf(fds);
        for (let i = 0; i < node.cmds.length; i++) {
          const last = i === node.cmds.length - 1;
          const cfds = cloneFds(fds);
          cfds.set(0, { kind: "in", s: input });
          let pipe: BufferSink | undefined;
          if (!last) {
            pipe = new BufferSink(this.budget);
            cfds.set(1, { kind: "out", s: pipe });
            if (node.pipeErr[i]) cfds.set(2, { kind: "out", s: pipe });
          }
          const useCurrent = last && this.shopts.lastpipe && !this.interactive;
          const sh = useCurrent ? this : this.subshell();
          let st: number;
          try {
            st = sh.exec(node.cmds[i], cfds);
          } catch (err) {
            if (err instanceof ExitSignal && !useCurrent) st = err.status;
            else if (err instanceof ReturnSignal && !useCurrent) st = err.status;
            else if ((err instanceof BreakSignal || err instanceof ContinueSignal) && !useCurrent) st = 0;
            else throw err;
          }
          statuses.push(st);
          input = new InStream(pipe ? pipe.text : "");
        }
        status = statuses[statuses.length - 1];
        if (this.opts.pipefail) {
          for (let i = statuses.length - 1; i >= 0; i--) {
            if (statuses[i] !== 0) {
              status = statuses[i];
              break;
            }
          }
        }
      }
    } finally {
      if (node.negate) this.errexitSuppressed--;
    }
    if (node.cmds.length > 1 || node.negate) this.setArray("PIPESTATUS", statuses.map(String));
    if (node.negate) status = status === 0 ? 1 : 0;
    if (node.time) {
      const secs = ((Date.now() - start) / 1000).toFixed(3);
      sinkOf(fds, 2).write(`\nreal\t0m${secs}s\nuser\t0m0.000s\nsys\t0m0.000s\n`);
    }
    this.status = status;
    if (!node.negate && node.cmds.length > 1) this.checkErrexit(status, fds);
    return status;
  }

  private execCompound(node: Node, outerFds: FdTable): number {
    if (!("redirs" in node)) return 0;
    let fds = outerFds;
    if (node.redirs.length) {
      const r = this.applyRedirs(node.redirs, outerFds);
      if (r === null) return 1;
      fds = r;
    }
    try {
      switch (node.k) {
        case "group":
          return this.exec(node.body, fds);
        case "subshell": {
          const sub = this.subshell();
          let st: number;
          try {
            st = sub.runExitTrap(fds, sub.exec(node.body, fds));
          } catch (err) {
            // A subshell runs its own EXIT trap however it ends (falling off the end, exit or return).
            if (err instanceof ExitSignal) st = sub.runExitTrap(fds, err.status);
            else if (err instanceof ReturnSignal) st = sub.runExitTrap(fds, err.status);
            else throw err;
          }
          this.status = st;
          this.checkErrexit(st, outerFds);
          return st;
        }
        case "if": {
          for (const c of node.clauses) {
            this.errexitSuppressed++;
            let cst: number;
            try {
              cst = this.exec(c.cond, fds);
            } finally {
              this.errexitSuppressed--;
            }
            if (cst === 0) return this.exec(c.body, fds);
          }
          if (node.else) return this.exec(node.else, fds);
          this.status = 0;
          return 0;
        }
        case "while":
          return this.execWhile(node, fds);
        case "for":
          return this.execFor(node, fds);
        case "cfor":
          return this.execCFor(node, fds);
        case "case":
          return this.execCase(node, fds);
        case "cond": {
          this.currentLine = node.line;
          let st: number;
          try {
            if (this.opts.xtrace) this.trace(["[[", describeCond(node.expr), "]]"], fds);
            st = this.evalCond(node.expr, fds) ? 0 : 1;
          } catch (err) {
            if (err instanceof ExpansionError || err instanceof RegexError || err instanceof TestError || err instanceof ArithError) {
              sinkOf(fds, 2).write(`${this.errPrefix()}: ${err.message}\n`);
              st = 2;
            } else throw err;
          }
          this.status = st;
          this.checkErrexit(st, fds);
          return st;
        }
        case "arith": {
          this.currentLine = node.line;
          let st: number;
          try {
            if (this.opts.xtrace) this.trace(["((", node.src.trim(), "))"], fds);
            st = this.arith(node.src, fds) !== 0n ? 0 : 1;
          } catch (err) {
            if (err instanceof ArithError || err instanceof ExpansionError) {
              sinkOf(fds, 2).write(`${this.errPrefix()}: ${node.src.trim()}: ${err.message}\n`);
              st = 1;
            } else throw err;
          }
          this.status = st;
          this.checkErrexit(st, fds);
          return st;
        }
      }
    } finally {
      this.flushPendingWriters(outerFds);
    }
    return 0;
  }

  private runLoopBody(body: Node, fds: FdTable): "break" | "continue" | undefined {
    try {
      this.exec(body, fds);
    } catch (err) {
      if (err instanceof BreakSignal) {
        if (err.n > 1) throw new BreakSignal(err.n - 1);
        return "break";
      }
      if (err instanceof ContinueSignal) {
        if (err.n > 1) throw new ContinueSignal(err.n - 1);
        return "continue";
      }
      throw err;
    }
    return undefined;
  }

  private execWhile(node: Extract<Node, { k: "while" }>, fds: FdTable): number {
    let status = 0;
    this.loopDepth++;
    try {
      for (;;) {
        this.tick();
        this.errexitSuppressed++;
        let c: number;
        try {
          c = this.exec(node.cond, fds);
        } finally {
          this.errexitSuppressed--;
        }
        if (node.until ? c === 0 : c !== 0) break;
        const r = this.runLoopBody(node.body, fds);
        status = this.status;
        if (r === "break") break;
      }
    } finally {
      this.loopDepth--;
    }
    this.status = status;
    return status;
  }

  private execFor(node: Extract<Node, { k: "for" }>, fds: FdTable): number {
    let items: string[];
    try {
      items = node.words === null ? [...this.positional] : expandWords(this, node.words, fds);
    } catch (err) {
      if (err instanceof ExpansionError) {
        sinkOf(fds, 2).write(`${this.errPrefix()}: ${err.message}\n`);
        if (err.fatal && !this.interactive) throw new ExitSignal(1);
        return 1;
      }
      throw err;
    }
    if (node.select) return this.execSelect(node, items, fds);
    let status = 0;
    this.loopDepth++;
    try {
      for (const item of items) {
        this.tick();
        this.setVar(node.name, item);
        if (this.opts.xtrace) this.trace(["for", node.name, "in", item], fds, true);
        const r = this.runLoopBody(node.body, fds);
        status = this.status;
        if (r === "break") break;
      }
    } finally {
      this.loopDepth--;
    }
    this.status = status;
    return status;
  }

  /** `select NAME in WORDS`: print a numbered menu and PS3 to stderr, read REPLY from stdin. */
  private execSelect(node: Extract<Node, { k: "for" }>, items: string[], fds: FdTable): number {
    const err = sinkOf(fds, 2);
    const stdin = stdinOf(fds);
    const width = String(items.length).length;
    const menu = items.map((it, i) => `${String(i + 1).padStart(width)}) ${it}\n`).join("");
    let status = 0;
    let showMenu = true;
    this.loopDepth++;
    try {
      for (;;) {
        this.tick();
        if (showMenu) err.write(menu);
        err.write(this.getVar("PS3") ?? "#? ");
        if (stdin.isTTY && stdin.eof && !this.notices.has("read-tty")) {
          this.notices.add("read-tty");
          err.write(
            "\nbash-sim: select: the simulator cannot wait for keyboard input; provide input with a pipe, here-string (<<<) or the playground's stdin box.\n",
          );
        }
        const r = stdin.readUntil("\n");
        if (!r) {
          err.write("\n");
          status = 1;
          break;
        }
        const reply = r.text;
        this.setVar("REPLY", reply);
        if (reply.trim() === "") {
          showMenu = true;
          continue;
        }
        showMenu = false;
        const n = /^\s*\d+\s*$/.test(reply) ? Number(reply) : 0;
        this.setVar(node.name, n >= 1 && n <= items.length ? items[n - 1] : "");
        const res = this.runLoopBody(node.body, fds);
        status = this.status;
        if (res === "break") break;
      }
    } finally {
      this.loopDepth--;
    }
    this.status = status;
    return status;
  }

  private execCFor(node: Extract<Node, { k: "cfor" }>, fds: FdTable): number {
    let status = 0;
    this.loopDepth++;
    try {
      if (node.init) this.arith(node.init, fds);
      for (;;) {
        this.tick();
        if (node.cond && this.arith(node.cond, fds) === 0n) break;
        const r = this.runLoopBody(node.body, fds);
        status = this.status;
        if (r === "break") break;
        if (node.step) this.arith(node.step, fds);
      }
    } catch (err) {
      if (err instanceof ArithError) {
        sinkOf(fds, 2).write(`${this.errPrefix()}: ((: ${err.message}\n`);
        status = 1;
      } else throw err;
    } finally {
      this.loopDepth--;
    }
    this.status = status;
    return status;
  }

  private execCase(node: Extract<Node, { k: "case" }>, fds: FdTable): number {
    const value = expandSingle(this, node.word, fds);
    let status = 0;
    let fallthrough = false;
    for (let i = 0; i < node.items.length; i++) {
      const item = node.items[i];
      const matched =
        fallthrough ||
        item.patterns.some((p) => matchGlob(value, expandPattern(this, p, fds), { nocase: this.shopts.nocasematch }));
      fallthrough = false;
      if (!matched) continue;
      status = item.body ? this.exec(item.body, fds) : 0;
      if (item.term === ";;") break;
      if (item.term === ";&") fallthrough = true;
      // ";;&" → keep testing subsequent patterns
    }
    this.status = status;
    return status;
  }

  /* ---------- [[ ]] ---------- */

  evalCond(e: CondExpr, fds: FdTable): boolean {
    switch (e.t) {
      case "and":
        return this.evalCond(e.l, fds) && this.evalCond(e.r, fds);
      case "or":
        return this.evalCond(e.l, fds) || this.evalCond(e.r, fds);
      case "not":
        return !this.evalCond(e.e, fds);
      case "word":
        return expandSingle(this, e.w, fds) !== "";
      case "unary": {
        const arg = expandSingle(this, e.arg, fds);
        if (e.op === "-v") {
          const m = arg.match(/^([A-Za-z_]\w*)\[(.*)\]$/);
          if (m) return this.getElement(m[1], m[2], fds) !== undefined;
          return this.isSet(arg);
        }
        if (e.op === "-o") return !!this.opts[arg];
        return evalTest(this, [e.op, arg]) === 0;
      }
      case "binary": {
        const l = expandSingle(this, e.l, fds);
        if (e.op === "==" || e.op === "!=") {
          const pat = expandPattern(this, e.r, fds);
          const m = matchGlob(l, pat, { nocase: this.shopts.nocasematch });
          return e.op === "==" ? m : !m;
        }
        if (e.op === "=~") {
          const reSrc = this.regexFromWord(e.r, fds);
          const re = compileRegex(reSrc, "ere", this.shopts.nocasematch ? "i" : "");
          const m = l.match(re);
          if (m) {
            this.setArray("BASH_REMATCH", [...m].map((x) => x ?? ""));
            return true;
          }
          this.setArray("BASH_REMATCH", []);
          return false;
        }
        const r = expandSingle(this, e.r, fds);
        if (e.op === "<") return l < r;
        if (e.op === ">") return l > r;
        if (["-eq", "-ne", "-lt", "-le", "-gt", "-ge"].includes(e.op)) {
          const a = this.arith(l || "0", fds);
          const b = this.arith(r || "0", fds);
          switch (e.op) {
            case "-eq": return a === b;
            case "-ne": return a !== b;
            case "-lt": return a < b;
            case "-le": return a <= b;
            case "-gt": return a > b;
            case "-ge": return a >= b;
          }
        }
        return evalTest(this, [l, e.op, r]) === 0;
      }
    }
  }

  /** Build an ERE from the right side of =~ where quoted parts are literal. */
  private regexFromWord(w: Word, fds: FdTable): string {
    let out = "";
    for (const p of w.parts) {
      if (p.t === "lit") {
        out += p.q ? p.v.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") : p.v;
      } else {
        const text = expandSingle(this, { parts: [p], raw: "" }, fds);
        out += p.t === "param" && p.q ? text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") : text;
      }
    }
    return out;
  }

  /* ---------- simple commands ---------- */

  private execSimple(node: Extract<Node, { k: "simple" }>, fds: FdTable): number {
    this.tick();
    this.currentLine = node.line;
    if (this.opts.noexec) return 0;

    // Alias expansion (interactive shells, or with expand_aliases)
    if ((this.interactive || this.shopts.expand_aliases) && node.words.length) {
      const first = node.words[0];
      const name = first.parts.length === 1 && first.parts[0].t === "lit" && first.parts[0].q === 0 ? first.parts[0].v : undefined;
      if (name && this.aliases.has(name) && !(node as { aliased?: boolean }).aliased) {
        const rest = node.src.slice(node.src.indexOf(first.raw) + first.raw.length);
        const prefix = node.assigns.length ? node.src.slice(0, node.src.indexOf(first.raw)) : "";
        try {
          const sub = new Parser(prefix + this.aliases.get(name)! + rest, { interactive: false }).parseProgram();
          markAliased(sub, name);
          return this.exec(sub, fds);
        } catch (err) {
          if (!(err instanceof ParseError)) throw err;
        }
      }
    }

    let argv: string[];
    const arrayAssigns: { word: Word; local: boolean }[] = [];
    try {
      this.lastSubstStatus = 0;
      const isDecl = node.words.length > 0 && DECLARATION_BUILTINS.has(literalOf(node.words[0]) ?? "");
      if (isDecl) {
        argv = [];
        for (const w of node.words) {
          if (w.arrayAssign) {
            argv.push(w.arrayAssign.name + (w.arrayAssign.append ? "+=" : "=") + "__ARRAY_LITERAL__");
            arrayAssigns.push({ word: w, local: true });
          } else if (w.assignLike) argv.push(expandSingle(this, w, fds, { assignment: true }));
          else argv.push(...expandWords(this, [w], fds));
        }
      } else {
        argv = expandWords(this, node.words, fds);
      }
    } catch (err) {
      return this.handleExpansionError(err, fds);
    }

    // Assignment-only command
    if (!argv.length) {
      try {
        for (const a of node.assigns) this.doAssign(a, fds, false);
      } catch (err) {
        return this.handleExpansionError(err, fds);
      }
      if (this.opts.xtrace && node.assigns.length) {
        this.trace(
          node.assigns.map((a) => `${a.name}${a.index !== undefined ? `[${a.index}]` : ""}=${traceQuote(a.array ? "(" + this.getArrayValues(a.name).join(" ") + ")" : (a.index !== undefined ? this.getElement(a.name, a.index, fds) : this.getVar(a.name)) ?? "")}`),
          fds,
          true,
        );
      }
      if (node.redirs.length) {
        const r = this.applyRedirs(node.redirs, fds);
        this.flushPendingWriters(fds);
        if (r === null) return 1;
      }
      return this.lastSubstStatus;
    }

    const name = argv[0];
    const isFunc = this.funcs.has(name);
    const isBuiltin = !isFunc && name in builtins;

    // Bash performs redirections (including process substitutions) before applying prefix
    // assignments, so `IFS=, read -r a b < <(cmd)` runs cmd with the original IFS.
    let cfds = fds;
    if (node.redirs.length) {
      const r = this.applyRedirs(node.redirs, fds);
      if (r === null) return 1;
      cfds = r;
    }

    // Prefix assignments: temporary environment
    const tempEnv = new Map<string, string>();
    const restore: (() => void)[] = [];
    try {
      for (const a of node.assigns) {
        const value = a.value ? expandSingle(this, a.value, fds, { assignment: true }) : "";
        if (isBuiltin && SPECIAL_BUILTINS.has(name)) {
          this.doAssign(a, fds, false);
        } else if (isBuiltin || isFunc) {
          const prev = this.getVarRecord(a.name);
          const saved = prev ? cloneVar(prev) : undefined;
          this.setVar(a.name, value, { export: true });
          restore.push(() => {
            if (saved) {
              const scope = this.scopes.find((s) => s.has(a.name)) ?? this.scopes[0];
              scope.set(a.name, saved);
            } else this.unsetVar(a.name);
          });
        } else tempEnv.set(a.name, value);
      }
    } catch (err) {
      return this.handleExpansionError(err, fds);
    }

    if (this.opts.xtrace) {
      const pre = node.assigns.map((a) => `${a.name}=${tempEnv.get(a.name) ?? this.getVar(a.name) ?? ""}`);
      this.trace([...pre, ...argv], fds);
    }

    try {
      let st: number;
      if (isFunc) st = this.callFunction(name, argv.slice(1), cfds);
      else if (isBuiltin) {
        this.outerFds = fds;
        // `readonly ARR=(…)` / `declare -r ARR=(…)`: the builtin marks the name readonly before the
        // compound assignment is applied, so remember which names were already readonly beforehand.
        const roBefore = arrayAssigns.map((aa) => !!aa.word.arrayAssign && !!this.getVarRecord(aa.word.arrayAssign.name)?.readonly);
        st = this.runBuiltin(name, argv, cfds);
        arrayAssigns.forEach((aa, i) => {
          if (roBefore[i]) return; // the builtin already reported "readonly variable"
          const rec = aa.word.arrayAssign ? this.getVarRecord(aa.word.arrayAssign.name) : undefined;
          const ro = !!rec?.readonly;
          if (rec && ro) rec.readonly = false;
          try {
            this.doArrayAssignFromWord(aa.word, cfds, name);
          } catch (err) {
            if (!(err instanceof ExpansionError)) throw err;
            sinkOf(cfds, 2).write(`${this.errPrefix()}: ${err.message}\n`);
            st = 1;
          } finally {
            const after = aa.word.arrayAssign ? this.getVarRecord(aa.word.arrayAssign.name) : undefined;
            if (ro && after) after.readonly = true;
          }
        });
      } else st = this.runExternal(argv, cfds, tempEnv, fds);
      return st;
    } finally {
      restore.forEach((f) => f());
      this.flushPendingWriters(fds);
    }
  }

  private handleExpansionError(err: unknown, fds: FdTable): number {
    if (err instanceof ExpansionError || err instanceof ArithError) {
      sinkOf(fds, 2).write(`${this.errPrefix()}: ${err.message}\n`);
      if (err instanceof ExpansionError && err.fatal && !this.interactive) throw new ExitSignal(1);
      if (err instanceof ExpansionError && err.fatal && this.interactive) {
        throw new AbortSignal("");
      }
      return 1;
    }
    throw err;
  }

  doAssign(a: Assign, fds: FdTable, local: boolean): void {
    if (a.array) {
      const values: string[] = [];
      const keys: (string | undefined)[] = [];
      for (const el of a.array) {
        const m = el.raw.match(/^\[([^\]]*)\]\+?=/);
        if (m) {
          const rest = el.raw.slice(m[0].length);
          const w = new Parser(rest).readWord("string");
          values.push(w ? expandSingle(this, w, fds, { assignment: true }) : "");
          keys.push(m[1]);
        } else {
          for (const v of expandWords(this, [el], fds)) {
            values.push(v);
            keys.push(undefined);
          }
        }
      }
      this.setArray(a.name, values, { local, append: a.append, keys, io: fds });
      return;
    }
    const value = a.value ? expandSingle(this, a.value, fds, { assignment: true }) : "";
    this.setVar(a.name, value, { local, index: a.index, append: a.append, io: fds });
  }

  private doArrayAssignFromWord(w: Word, fds: FdTable, builtin: string): void {
    if (!w.arrayAssign) return;
    const local = (builtin === "local" || builtin === "declare" || builtin === "typeset") && this.funcDepth > 0;
    const isGlobal = false;
    this.doAssign({ name: w.arrayAssign.name, append: w.arrayAssign.append, array: w.arrayAssign.elements }, fds, local && !isGlobal);
  }

  trace(args: string[], fds: FdTable, raw = false): void {
    let ps4 = this.getVar("PS4") ?? "+ ";
    if (/[$`]/.test(ps4) && !this.inPs4) {
      // PS4 is expanded like a double-quoted string before each trace line.
      this.inPs4 = true;
      const savedStatus = this.status;
      try {
        ps4 = expandSingle(this, subWord(ps4, this.currentLine, "heredoc"), fds, { heredoc: true });
      } catch {
        /* keep the raw value */
      } finally {
        this.inPs4 = false;
        this.status = savedStatus;
      }
    }
    const ch = ps4[0] ?? "+";
    const prefix = ch.repeat(this.substDepth + 1) + ps4.slice(1);
    const text = raw ? args.join(" ") : args.map(traceQuote).join(" ");
    sinkOf(fds, 2).write(`${prefix}${text}\n`);
  }

  callFunction(name: string, args: string[], fds: FdTable): number {
    const fn = this.funcs.get(name)!;
    if (this.funcDepth >= 500) {
      sinkOf(fds, 2).write(`${this.errPrefix()}: ${name}: maximum function nesting level exceeded (500)\n`);
      throw new AbortSignal("");
    }
    const savedPos = this.positional;
    this.positional = args;
    this.scopes.push(new Map());
    this.funcNames.push(name);
    this.callLines.push(this.currentLine);
    this.savedOptsStack.push(undefined);
    this.funcDepth++;
    let status = 0;
    try {
      status = this.exec(fn.node, fds);
    } catch (err) {
      if (err instanceof ReturnSignal) status = err.status;
      else throw err;
    } finally {
      this.funcDepth--;
      this.funcNames.pop();
      this.callLines.pop();
      const savedOpts = this.savedOptsStack.pop();
      if (savedOpts) this.opts = savedOpts;
      this.scopes.pop();
      this.positional = savedPos;
    }
    this.status = status;
    return status;
  }

  makeCtx(name: string, args: string[], fds: FdTable, env: Map<string, string>): CmdCtx {
    const out = sinkOf(fds, 1);
    const err = sinkOf(fds, 2);
    return {
      sh: this,
      name,
      args,
      fds,
      env,
      stdin: stdinOf(fds),
      out: (s) => out.write(s),
      err: (s) => err.write(s),
      error: (msg) => err.write(`${name}: ${msg}\n`),
      stdoutIsTTY: out.isTTY,
      resolve: (p) => normalizePath(p.startsWith("~") ? HOME + p.slice(1) : p, this.cwd),
      readInput: (p) => this.readPath(p, fds),
    };
  }

  runBuiltin(name: string, argv: string[], fds: FdTable): number {
    const ctx = this.makeCtx(name, argv.slice(1), fds, this.exportedEnv());
    try {
      return builtins[name](ctx);
    } catch (err) {
      if (err instanceof ExpansionError || err instanceof ArithError) {
        ctx.err(`${this.errPrefix()}: ${name}: ${err.message}\n`);
        return 1;
      }
      if (err instanceof FsError) {
        ctx.err(`${this.errPrefix()}: ${name}: ${err.path}: ${fsErrorText[err.code]}\n`);
        return 1;
      }
      throw err;
    }
  }

  /** Locate an external command via PATH. */
  findInPath(name: string): string | undefined {
    if (name.includes("/")) return normalizePath(name, this.cwd);
    // With PATH unset, Bash falls back to a built-in default search path.
    const path = this.getVar("PATH") ?? "/usr/local/bin:/usr/bin:/bin";
    for (const dir of path.split(":")) {
      const d = dir === "" ? this.cwd : dir;
      const full = normalizePath(`${d}/${name}`, this.cwd);
      const node = this.fs.lookup(full);
      if (node && node.type === "file" && this.fs.canExec(node)) return full;
    }
    return undefined;
  }

  runExternal(argv: string[], fds: FdTable, tempEnv: Map<string, string>, outerFds: FdTable): number {
    const name = argv[0];
    const errSink = sinkOf(fds, 2);
    const path = this.findInPath(name);
    if (path && !name.includes("/")) {
      const entry = this.hashTable.get(name);
      if (entry && entry.path === path) entry.hits++;
      else this.hashTable.set(name, { path, hits: 1 });
    }
    if (!path) {
      errSink.write(`${this.errPrefix()}: ${name}: command not found\n`);
      if (!this.notices.has("cnf") && /^(sudo|apt|apt-get|dnf|yum|systemctl|journalctl|ssh|scp|rsync|curl|wget|git|docker|top|htop|ps|kill|vim|vi|nano|less|more|man|python3?|node|make|tar|gzip|zip|unzip|ping|ip|ss|df|free|mount|crontab|shellcheck|shfmt|bats)$/.test(name)) {
        this.notices.add("cnf");
        errSink.write(
          `bash-sim: '${name}' needs a real Linux system. This in-browser simulator implements core utilities only — type 'help' to see them.\n`,
        );
      }
      void outerFds;
      return 127;
    }
    const node = this.fs.lookup(path);
    if (!node) {
      errSink.write(`${this.errPrefix()}: ${name}: ${fsErrorText.ENOENT}\n`);
      return 127;
    }
    if (node.type === "dir") {
      errSink.write(`${this.errPrefix()}: ${name}: Is a directory\n`);
      return 126;
    }
    if (!this.fs.canExec(node)) {
      errSink.write(`${this.errPrefix()}: ${name}: Permission denied\n`);
      return 126;
    }
    const env = this.exportedEnv(tempEnv);
    const sim = node.content.match(/^#!\/sim\/bin\/(\S+)/);
    if (sim) {
      const impl = externals[sim[1]];
      if (!impl) {
        errSink.write(`bash-sim: ${name}: not implemented in this simulator\n`);
        return 127;
      }
      const ctx = this.makeCtx(baseName(name), argv.slice(1), fds, env);
      // External commands run in a child process: give them a snapshot shell.
      try {
        return impl(ctx);
      } catch (err) {
        if (err instanceof FsError) {
          ctx.error(`${err.path}: ${fsErrorText[err.code]}`);
          return 1;
        }
        throw err;
      }
    }
    // A user script: run it in a new bash process.
    return this.runScriptFile(path, name, argv.slice(1), fds, env, {});
  }

  /** Execute a script file in a child bash process. */
  runScriptFile(
    path: string,
    displayName: string,
    args: string[],
    fds: FdTable,
    env: Map<string, string>,
    flags: { xtrace?: boolean; errexit?: boolean; nounset?: boolean; noexec?: boolean; verbose?: boolean; pipefail?: boolean },
  ): number {
    let content: string;
    try {
      content = this.readPath(path, fds);
    } catch (err) {
      if (err instanceof FsError) {
        sinkOf(fds, 2).write(`bash: ${displayName}: ${fsErrorText[err.code]}\n`);
        return err.code === "ENOENT" ? 127 : 126;
      }
      throw err;
    }
    const shebang = content.match(/^#!\s*(\S+)(?:\s+(\S+))?/);
    if (shebang) {
      const interp = shebang[1] === "/usr/bin/env" ? shebang[2] ?? "" : baseName(shebang[1]);
      if (!/^(bash|sh|dash)$/.test(interp)) {
        sinkOf(fds, 2).write(
          `bash-sim: ${displayName}: this script uses '${interp}', but only Bash scripts can run in the simulator\n`,
        );
        return 126;
      }
    }
    const child = this.childProcess(env);
    child.scriptName = displayName;
    child.arg0 = displayName;
    child.positional = args;
    Object.assign(child.opts, Object.fromEntries(Object.entries(flags).filter(([, v]) => v)));
    return child.runScriptBody(content, fds);
  }

  /** A fresh non-interactive bash process inheriting only the environment. */
  childProcess(env: Map<string, string>): Shell {
    const child = new Shell({ fs: this.fs, interactive: false, cwd: this.cwd, budget: this.budget, ttyChunks: this.ttyChunks });
    child.fds = cloneFds(this.fds);
    child.ppid = this.bashpid;
    child.pid = this.nextPid();
    child.bashpid = child.pid;
    child.columns = this.columns;
    child.devfd = this.devfd;
    // shell variables every bash sets itself
    const own: Record<string, string> = {
      HOSTNAME: "bash-mastery",
      BASH: "/bin/bash",
      BASH_VERSION: "5.2.21(1)-release",
      IFS: " \t\n",
      PS4: "+ ",
      OPTIND: "1",
      UID: "1000",
      EUID: "1000",
      OSTYPE: "linux-gnu",
    };
    for (const [k, v] of Object.entries(own)) child.setVar(k, v);
    child.setArray("BASH_VERSINFO", ["5", "2", "21", "1", "release", "x86_64-pc-linux-gnu"]);
    for (const [k, v] of env) child.setVar(k, v, { export: true });
    const lvl = Number(env.get("SHLVL") ?? "1");
    child.setVar("SHLVL", String(lvl + 1), { export: true });
    child.setVar("PWD", this.cwd, { export: true });
    return child;
  }

  /* ---------------------------------------------------------------- */
  /* files and redirection                                             */
  /* ---------------------------------------------------------------- */

  readPath(p: string, fds: FdTable): string {
    if (p === "-" || p === "/dev/stdin") return stdinOf(fds).readAll();
    const abs = normalizePath(p.startsWith("~") ? HOME + p.slice(1) : p, this.cwd);
    if (abs === "/dev/null" || abs === "/dev/zero") return "";
    if (abs === "/dev/urandom" || abs === "/dev/random") {
      let s = "";
      for (let i = 0; i < 8192; i++) s += String.fromCharCode(Math.floor(Math.random() * 256));
      return s;
    }
    const fdm = abs.match(/^\/dev\/fd\/(\d+)$/);
    if (fdm) {
      const fromProc = this.devfd.get(abs);
      if (fromProc !== undefined) return fromProc;
      const e = fds.get(Number(fdm[1]));
      if (e?.kind === "in") return e.s.readAll();
      throw new FsError("ENOENT", p);
    }
    try {
      return this.fs.readFile(abs);
    } catch (err) {
      if (err instanceof FsError) throw new FsError(err.code, p);
      throw err;
    }
  }

  openWrite(p: string, append: boolean, fds: FdTable, clobber: boolean): Sink {
    const abs = normalizePath(p.startsWith("~") ? HOME + p.slice(1) : p, this.cwd);
    if (abs === "/dev/null") return NULL_SINK;
    if (abs === "/dev/stdout") return sinkOf(fds, 1);
    if (abs === "/dev/stderr") return sinkOf(fds, 2);
    if (abs === "/dev/tty") return new TTYSink(this.ttyChunks, 1, this.budget);
    const fdm = abs.match(/^\/dev\/fd\/(\d+)$/);
    if (fdm) {
      if (this.devfd.has(abs)) {
        return { isTTY: false, write: (s) => this.devfd.set(abs, (this.devfd.get(abs) ?? "") + s) };
      }
      return sinkOf(fds, Number(fdm[1]));
    }
    const existing = this.fs.lookup(abs);
    if (!append && existing && existing.type === "file" && this.opts.noclobber && !clobber) {
      throw new ExpansionError(`${p}: cannot overwrite existing file`, false);
    }
    try {
      if (!append || !existing) this.fs.writeFile(abs, "", false);
      else if (existing.type === "dir") throw new FsError("EISDIR", abs);
      else if (!this.fs.canWrite(existing)) throw new FsError("EACCES", abs);
    } catch (err) {
      if (err instanceof FsError) throw new FsError(err.code, p);
      throw err;
    }
    const fs = this.fs;
    const budget = this.budget;
    return {
      isTTY: false,
      write(s: string) {
        budget.outBytes += s.length;
        if (budget.outBytes > budget.maxOutBytes) throw new LimitError("output limit exceeded");
        fs.writeFile(abs, s, true);
      },
    };
  }

  /** Apply redirections, returning a new fd table, or null on error (message already printed). */
  applyRedirs(redirs: Redir[], fds: FdTable, persistent = false): FdTable | null {
    const out = persistent ? fds : cloneFds(fds);
    for (const r of redirs) {
      try {
        let fd = r.fd ?? (r.op.startsWith("<") ? 0 : 1);
        if (r.fdVar) {
          let n = 10;
          while (out.has(n)) n++;
          fd = n;
          this.setVar(r.fdVar, String(n));
        }
        switch (r.op) {
          case "<<":
          case "<<-": {
            const text = r.heredoc ? (r.heredoc.expand ? expandSingle(this, r.heredoc.body, fds, { heredoc: true }) : r.heredoc.raw) : "";
            out.set(fd, { kind: "in", s: new InStream(text) });
            break;
          }
          case "<<<": {
            const text = expandSingle(this, r.target, fds) + "\n";
            out.set(fd, { kind: "in", s: new InStream(text) });
            break;
          }
          case "<":
          case "<>": {
            const target = this.redirTarget(r.target, fds);
            out.set(fd, { kind: "in", s: new InStream(this.readPath(target, fds)) });
            break;
          }
          case ">":
          case ">|":
          case ">>": {
            const target = this.redirTarget(r.target, fds);
            out.set(fd, { kind: "out", s: this.openWrite(target, r.op === ">>", fds, r.op === ">|") });
            break;
          }
          case "&>":
          case "&>>": {
            const target = this.redirTarget(r.target, fds);
            const s = this.openWrite(target, r.op === "&>>", fds, false);
            out.set(1, { kind: "out", s });
            out.set(2, { kind: "out", s });
            break;
          }
          case ">&":
          case "<&": {
            const target = expandSingle(this, r.target, fds);
            if (target === "-") {
              out.delete(fd);
              break;
            }
            const m = target.match(/^(\d+)(-?)$/);
            if (m) {
              const src = out.get(Number(m[1]));
              if (!src) throw new ExpansionError(`${m[1]}: Bad file descriptor`, false);
              out.set(fd, src);
              if (m[2]) out.delete(Number(m[1]));
              break;
            }
            if (r.op === ">&" && r.fd === undefined) {
              const s = this.openWrite(target, false, fds, false);
              out.set(1, { kind: "out", s });
              out.set(2, { kind: "out", s });
              break;
            }
            throw new ExpansionError(`${target}: ambiguous redirect`, false);
          }
        }
      } catch (err) {
        if (err instanceof FsError) {
          sinkOf(fds, 2).write(`${this.errPrefix()}: ${err.path}: ${fsErrorText[err.code]}\n`);
          return null;
        }
        if (err instanceof ExpansionError) {
          sinkOf(fds, 2).write(`${this.errPrefix()}: ${err.message}\n`);
          if (err.fatal && !this.interactive) throw new ExitSignal(1);
          return null;
        }
        throw err;
      }
    }
    return out;
  }

  private redirTarget(w: Word, fds: FdTable): string {
    const vals = expandWords(this, [w], fds);
    if (vals.length !== 1) throw new ExpansionError(`${w.raw}: ambiguous redirect`, false);
    return vals[0];
  }

  /** Run >(cmd) consumers once the producing command has finished. */
  flushPendingWriters(fds: FdTable): void {
    if (!this.pendingWriters.length) return;
    const writers = this.pendingWriters;
    this.pendingWriters = [];
    for (const w of writers) {
      const data = this.devfd.get(w.path) ?? "";
      this.devfd.delete(w.path);
      const sub = this.subshell();
      const cfds = cloneFds(fds);
      cfds.set(0, { kind: "in", s: new InStream(data) });
      try {
        sub.exec(w.node, cfds);
      } catch (err) {
        if (!(err instanceof ExitSignal)) throw err;
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* prompt                                                            */
  /* ---------------------------------------------------------------- */

  promptString(which: "PS1" | "PS2" = "PS1"): string {
    const ps = this.getVar(which) ?? "";
    const home = this.getVar("HOME") ?? HOME;
    const cwdTilde = this.cwd === home ? "~" : this.cwd.startsWith(home + "/") ? "~" + this.cwd.slice(home.length) : this.cwd;
    const now = new Date();
    let out = "";
    for (let i = 0; i < ps.length; i++) {
      const c = ps[i];
      if (c !== "\\") {
        out += c;
        continue;
      }
      const n = ps[++i];
      switch (n) {
        case "u": out += "learner"; break;
        case "h": out += "bash-mastery"; break;
        case "H": out += "bash-mastery.local"; break;
        case "w": out += cwdTilde; break;
        case "W": out += this.cwd === home ? "~" : baseName(this.cwd); break;
        case "$": out += "$"; break;
        case "n": out += "\n"; break;
        case "s": out += "bash"; break;
        case "v": out += "5.2"; break;
        case "V": out += "5.2.21"; break;
        case "t": out += now.toTimeString().slice(0, 8); break;
        case "A": out += now.toTimeString().slice(0, 5); break;
        case "d": out += now.toDateString().slice(0, 10); break;
        case "e": out += "\x1b"; break;
        case "[":
        case "]": break;
        case "\\": out += "\\"; break;
        case "0": {
          const m = ps.slice(i).match(/^0[0-7]{2}/);
          if (m) {
            out += String.fromCharCode(parseInt(m[0], 8));
            i += 2;
          }
          break;
        }
        default: out += "\\" + (n ?? "");
      }
    }
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function markAliased(node: Node, _name: string): void {
  if (node.k === "simple") (node as { aliased?: boolean }).aliased = true;
  else if (node.k === "list") node.items.forEach((i) => markAliased(i.node, _name));
  else if (node.k === "pipeline") node.cmds.forEach((c) => markAliased(c, _name));
  else if (node.k === "andor") {
    markAliased(node.first, _name);
    node.rest.forEach((r) => markAliased(r.node, _name));
  }
}

function traceQuote(s: string): string {
  if (s === "") return "''";
  if (/^[^\s'"\\$`*?[\]{}()<>|&;#~!]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function describeCond(e: CondExpr): string {
  switch (e.t) {
    case "and": return `${describeCond(e.l)} && ${describeCond(e.r)}`;
    case "or": return `${describeCond(e.l)} || ${describeCond(e.r)}`;
    case "not": return `! ${describeCond(e.e)}`;
    case "unary": return `${e.op} ${e.arg.raw}`;
    case "binary": return `${e.l.raw} ${e.op} ${e.r.raw}`;
    case "word": return e.w.raw;
  }
}

export function describeNode(node: Node): string {
  switch (node.k) {
    case "simple": return node.src;
    case "pipeline": return node.cmds.map(describeNode).join(" | ");
    case "andor": return [describeNode(node.first), ...node.rest.map((r) => `${r.op} ${describeNode(r.node)}`)].join(" ");
    case "list": return node.items.map((i) => describeNode(i.node)).join("; ");
    case "subshell": return `( ${describeNode(node.body)} )`;
    case "group": return `{ ${describeNode(node.body)}; }`;
    default: return node.k;
  }
}
