import type { CmdCtx, CommandFn, Shell, Var } from "./shell";
import { AbortSignal, BreakSignal, ContinueSignal, ExitSignal, ExpansionError, HOME, ReturnSignal, bashQ } from "./signals";
import { evalArith, ArithError } from "./arith";
import { processEscapes, shellPrintf } from "./format";
import { evalTest, TestError } from "./test";
import { FsError, fsErrorText, normalizePath, compareNames } from "./vfs";
import { ParseError, Parser } from "./parser";
import { InStream } from "./io";
import { externals } from "./commands";

export const DECLARATION_BUILTINS = new Set(["declare", "typeset", "local", "readonly", "export"]);
/** POSIX special builtins: prefix assignments persist. */
export const SPECIAL_BUILTINS = new Set(["export", "readonly", "set", "shift", "unset", ":", ".", "source", "eval", "exec", "exit", "return", "break", "continue", "trap", "times"]);

export const KEYWORDS = new Set([
  "if", "then", "elif", "else", "fi", "for", "in", "do", "done", "while", "until", "case", "esac", "function", "select", "time", "{", "}", "!", "[[", "]]", "coproc",
]);

const SIGNALS: [number, string][] = [
  [1, "HUP"], [2, "INT"], [3, "QUIT"], [6, "ABRT"], [9, "KILL"], [10, "USR1"], [12, "USR2"], [13, "PIPE"], [14, "ALRM"], [15, "TERM"],
  [17, "CHLD"], [18, "CONT"], [19, "STOP"], [20, "TSTP"],
];

function sigName(spec: string): string | undefined {
  const s = spec.toUpperCase().replace(/^SIG/, "");
  if (s === "EXIT" || s === "0") return "EXIT";
  if (s === "ERR" || s === "DEBUG" || s === "RETURN") return s;
  if (/^\d+$/.test(s)) return SIGNALS.find(([n]) => n === Number(s))?.[1];
  return SIGNALS.find(([, n]) => n === s)?.[1];
}

function sigNumber(name: string): number {
  return SIGNALS.find(([, n]) => n === name)?.[0] ?? 0;
}

function bad(ctx: CmdCtx, msg: string, code = 1): number {
  ctx.err(`${ctx.sh.errPrefix()}: ${ctx.name}: ${msg}\n`);
  return code;
}

function validName(n: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(n);
}

function quoteValue(v: string): string {
  return `"${v.replace(/(["\\$`])/g, "\\$1")}"`;
}

function declLine(name: string, v: Var): string {
  let flags = "";
  if (v.kind === "indexed") flags += "a";
  if (v.kind === "assoc") flags += "A";
  if (v.integer) flags += "i";
  if (v.lower) flags += "l";
  if (v.nameref) flags += "n";
  if (v.readonly) flags += "r";
  if (v.upper) flags += "u";
  if (v.exported) flags += "x";
  const f = flags ? `-${flags}` : "--";
  if (v.kind === "indexed") {
    const m = v.value as Map<number, string>;
    const items = [...m.keys()].sort((a, b) => a - b).map((k) => `[${k}]=${quoteValue(m.get(k)!)}`);
    return `declare ${f} ${name}=(${items.join(" ")})`;
  }
  if (v.kind === "assoc") {
    const m = v.value as Map<string, string>;
    const items = [...m.entries()].map(([k, val]) => `[${/^[\w-]+$/.test(k) ? k : quoteValue(k)}]=${quoteValue(val)}`);
    return `declare ${f} ${name}=(${items.join(" ")}${items.length ? " " : ""})`;
  }
  return `declare ${f} ${name}=${quoteValue(v.value as string)}`;
}

function allVars(sh: Shell): Map<string, Var> {
  const out = new Map<string, Var>();
  for (const scope of sh.scopes) for (const [k, v] of scope) out.set(k, v);
  return out;
}

/* ------------------------------------------------------------------ */

const cd: CommandFn = (ctx) => {
  const { sh } = ctx;
  let args = ctx.args.filter((a) => a !== "-P" && a !== "-L");
  if (args[0] === "--") args = args.slice(1);
  if (args.length > 1) return bad(ctx, "too many arguments");
  let target = args[0];
  let print = false;
  if (target === undefined) {
    target = sh.getVar("HOME") ?? "";
    if (!target) return bad(ctx, "HOME not set");
  } else if (target === "-") {
    target = sh.getVar("OLDPWD") ?? "";
    if (!target) return bad(ctx, "OLDPWD not set");
    print = true;
  }
  const abs = normalizePath(target, sh.cwd);
  try {
    const node = sh.fs.get(abs);
    if (node.type !== "dir") return bad(ctx, `${target}: Not a directory`);
    if (!sh.fs.canExec(node)) return bad(ctx, `${target}: Permission denied`);
  } catch (err) {
    if (err instanceof FsError) return bad(ctx, `${target}: ${fsErrorText[err.code]}`);
    throw err;
  }
  sh.setVar("OLDPWD", sh.cwd);
  sh.cwd = abs;
  sh.setVar("PWD", abs);
  if (print) ctx.out(abs + "\n");
  return 0;
};

const pwd: CommandFn = (ctx) => {
  ctx.out(ctx.sh.cwd + "\n");
  return 0;
};

const echo: CommandFn = (ctx) => {
  let args = ctx.args;
  let newline = true;
  let escapes = false;
  while (args.length && /^-[neE]+$/.test(args[0])) {
    for (const c of args[0].slice(1)) {
      if (c === "n") newline = false;
      if (c === "e") escapes = true;
      if (c === "E") escapes = false;
    }
    args = args.slice(1);
  }
  let text = args.join(" ");
  if (escapes) {
    const r = processEscapes(text, { stopOnC: true });
    text = r.text;
    if (r.stop) newline = false;
  }
  ctx.out(text + (newline ? "\n" : ""));
  return 0;
};

const printf: CommandFn = (ctx) => {
  let args = ctx.args;
  let varName: string | undefined;
  if (args[0] === "-v") {
    varName = args[1];
    if (!varName) return bad(ctx, "-v: option requires an argument", 2);
    args = args.slice(2);
  }
  if (args[0] === "--") args = args.slice(1);
  if (!args.length) {
    ctx.err(`${ctx.sh.errPrefix()}: printf: usage: printf [-v var] format [arguments]\n`);
    return 2;
  }
  const { text, errors } = shellPrintf(args[0], args.slice(1), bashQ);
  for (const e of errors) ctx.err(`${ctx.sh.errPrefix()}: printf: ${e}\n`);
  if (varName) {
    const m = varName.match(/^([A-Za-z_]\w*)(?:\[(.*)\])?$/);
    if (!m) return bad(ctx, `\`${varName}': not a valid identifier`);
    ctx.sh.setVar(m[1], text, m[2] !== undefined ? { index: m[2] } : {});
  } else ctx.out(text);
  return errors.length ? 1 : 0;
};

/* ---------- variables ---------- */

function parseDeclFlags(args: string[]): { on: Set<string>; off: Set<string>; rest: string[] } {
  const on = new Set<string>();
  const off = new Set<string>();
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      i++;
      break;
    }
    if (/^-[aAfFgilnprtuxI]+$/.test(a)) for (const c of a.slice(1)) on.add(c);
    else if (/^\+[aAfFgilnprtuxI]+$/.test(a)) for (const c of a.slice(1)) off.add(c);
    else break;
  }
  return { on, off, rest: args.slice(i) };
}

function declareImpl(ctx: CmdCtx, mode: "declare" | "local" | "export" | "readonly"): number {
  const { sh } = ctx;
  const { on, off, rest } = parseDeclFlags(ctx.args);
  if (mode === "local" && sh.funcDepth === 0) return bad(ctx, "can only be used in a function");
  if (mode === "local" && ctx.args.includes("-")) {
    // `local -`: restore the set options when the function returns (Bash 4.4).
    sh.saveOptionsForFrame();
    const others = ctx.args.filter((a) => a !== "-");
    if (!others.length) return 0;
    return declareImpl({ ...ctx, args: others }, mode);
  }
  if (mode === "export") on.add("x");
  if (mode === "readonly") on.add("r");
  if (mode === "export" && on.has("n")) {
    on.delete("n");
    on.delete("x");
    off.add("x");
  }
  const local = (mode === "local" || mode === "declare") && sh.funcDepth > 0 && !on.has("g");

  if (on.has("f") || on.has("F")) {
    const names = rest.length ? rest : [...sh.funcs.keys()].sort(compareNames);
    let st = 0;
    for (const n of names) {
      const f = sh.funcs.get(n);
      if (!f) {
        st = 1;
        continue;
      }
      ctx.out(on.has("F") ? `declare -f ${n}\n` : f.src + "\n");
    }
    return st;
  }

  if (!rest.length || on.has("p")) {
    const vars = allVars(sh);
    const names = rest.length ? rest : [...vars.keys()].sort(compareNames);
    let st = 0;
    for (const n of names) {
      const v = vars.get(n);
      if (!v) {
        if (rest.length) {
          ctx.err(`${sh.errPrefix()}: ${ctx.name}: ${n}: not found\n`);
          st = 1;
        }
        continue;
      }
      if (mode === "export" && !v.exported) continue;
      if (mode === "readonly" && !v.readonly) continue;
      if (!rest.length && on.size && !on.has("p")) {
        if (on.has("x") && !v.exported) continue;
        if (on.has("r") && !v.readonly) continue;
        if (on.has("a") && v.kind !== "indexed") continue;
        if (on.has("A") && v.kind !== "assoc") continue;
      }
      ctx.out(declLine(n, v) + "\n");
    }
    return st;
  }

  let st = 0;
  for (const arg of rest) {
    const m = arg.match(/^([A-Za-z_][A-Za-z0-9_]*)(\[[^\]]*\])?(\+?=)?([\s\S]*)$/);
    if (!m) {
      ctx.err(`${sh.errPrefix()}: ${ctx.name}: \`${arg}': not a valid identifier\n`);
      st = 1;
      continue;
    }
    const [, name, idx, eq, value] = m;
    const scope = local ? sh.scopes[sh.scopes.length - 1] : sh.scopes[0];
    let v = local ? scope.get(name) : sh.getVarRecord(name, !on.has("n"));
    if (!v) {
      v = { kind: on.has("A") ? "assoc" : on.has("a") ? "indexed" : "scalar", value: on.has("A") ? new Map<string, string>() : on.has("a") ? new Map<number, string>() : "" };
      if (!eq && !on.has("a") && !on.has("A")) (v as Var & { unsetValue?: boolean }).unsetValue = true;
      scope.set(name, v);
    } else if (v.readonly && (eq || on.size > (on.has("p") ? 1 : 0)) && !(mode === "export" && !eq)) {
      if (eq || on.has("a") || on.has("A") || on.has("i")) {
        ctx.err(`${sh.errPrefix()}: ${ctx.name}: ${name}: readonly variable\n`);
        st = 1;
        continue;
      }
    }
    if (on.has("A") && v.kind !== "assoc") {
      v.kind = "assoc";
      v.value = new Map<string, string>();
    }
    if (on.has("a") && v.kind === "scalar") {
      const val = v.value as string;
      v.kind = "indexed";
      v.value = new Map<number, string>(val ? [[0, val]] : []);
    }
    if (on.has("i")) v.integer = true;
    if (off.has("i")) v.integer = false;
    if (on.has("l")) {
      v.lower = true;
      v.upper = false;
    }
    if (on.has("u")) {
      v.upper = true;
      v.lower = false;
    }
    if (on.has("n")) v.nameref = true;
    if (on.has("x")) v.exported = true;
    if (off.has("x")) v.exported = false;
    if (eq) {
      if (v.nameref && !idx) {
        v.value = value;
      } else {
        delete (v as Var & { unsetValue?: boolean }).unsetValue;
        const wasRo = v.readonly;
        v.readonly = false;
        try {
          if (value === "__ARRAY_LITERAL__") {
            // name=(...) — the interpreter assigns the array after this builtin returns
          } else {
            sh.setVar(name, value, { local, index: idx ? idx.slice(1, -1) : undefined, append: eq === "+=" });
          }
        } finally {
          v.readonly = wasRo;
        }
      }
    }
    if (on.has("r")) v.readonly = true;
  }
  return st;
}

const declare: CommandFn = (ctx) => declareImpl(ctx, "declare");
const local: CommandFn = (ctx) => declareImpl(ctx, "local");
const exportB: CommandFn = (ctx) => declareImpl(ctx, "export");
const readonly: CommandFn = (ctx) => declareImpl(ctx, "readonly");

const unset: CommandFn = (ctx) => {
  const { sh } = ctx;
  let args = ctx.args;
  let mode: "v" | "f" | "any" = "any";
  while (args[0] === "-v" || args[0] === "-f" || args[0] === "-n") {
    mode = args[0] === "-f" ? "f" : "v";
    args = args.slice(1);
  }
  let st = 0;
  for (const a of args) {
    const m = a.match(/^([A-Za-z_]\w*)(?:\[(.*)\])?$/);
    if (!m) {
      ctx.err(`${sh.errPrefix()}: unset: \`${a}': not a valid identifier\n`);
      st = 1;
      continue;
    }
    if (mode === "f") {
      sh.funcs.delete(m[1]);
      continue;
    }
    try {
      const removed = sh.unsetVar(m[1], m[2], ctx.fds);
      if (!removed && mode === "any") sh.funcs.delete(m[1]);
    } catch (err) {
      if (err instanceof ExpansionError) {
        ctx.err(`${sh.errPrefix()}: ${err.message}\n`);
        st = 1;
      } else throw err;
    }
  }
  return st;
};

const shift: CommandFn = (ctx) => {
  const n = ctx.args[0] === undefined ? 1 : Number(ctx.args[0]);
  if (!Number.isInteger(n) || n < 0) return bad(ctx, `${ctx.args[0]}: numeric argument required`);
  if (n > ctx.sh.positional.length) return 1;
  ctx.sh.positional = ctx.sh.positional.slice(n);
  return 0;
};

/* ---------- read / mapfile ---------- */

const read: CommandFn = (ctx) => {
  const { sh } = ctx;
  const args = ctx.args;
  let raw = false;
  let prompt = "";
  let arrayName: string | undefined;
  let delim = "\n";
  let nchars: number | undefined;
  let exactChars = false;
  let fd: number | undefined;
  const names: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (names.length === 0 && /^-[a-zA-Z]+$/.test(a)) {
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        const takeArg = () => {
          const rest = a.slice(j + 1);
          j = a.length;
          if (rest) return rest;
          i++;
          return args[i] ?? "";
        };
        if (c === "r") raw = true;
        else if (c === "s" || c === "e") {
          /* silent / readline: no effect */
        } else if (c === "p") prompt = takeArg();
        else if (c === "a") arrayName = takeArg();
        else if (c === "d") delim = takeArg().slice(0, 1);
        else if (c === "n") nchars = Number(takeArg());
        else if (c === "N") {
          nchars = Number(takeArg());
          exactChars = true;
        } else if (c === "t") takeArg();
        else if (c === "u") fd = Number(takeArg());
        else return bad(ctx, `-${c}: invalid option`, 2);
      }
      continue;
    }
    names.push(a);
  }
  let stream = ctx.stdin;
  if (fd !== undefined) {
    const e = ctx.fds.get(fd);
    if (!e || e.kind !== "in") return bad(ctx, `${fd}: invalid file descriptor: Bad file descriptor`);
    stream = e.s;
  }
  if (prompt && stream.isTTY) ctx.err(prompt);
  if (stream.isTTY && stream.eof) {
    if (!sh.notices.has("read-tty")) {
      sh.notices.add("read-tty");
      ctx.err(
        "bash-sim: read: the simulator cannot wait for keyboard input; provide input with a pipe, here-string (<<<) or the playground's stdin box.\n",
      );
    }
  }

  let line: string;
  let ok: boolean;
  if (nchars !== undefined) {
    line = stream.readChars(nchars);
    ok = line.length > 0;
    if (!exactChars) {
      const di = line.indexOf(delim);
      if (di !== -1) {
        stream.pos -= line.length - di - 1;
        line = line.slice(0, di);
      }
    }
  } else {
    // Read, honouring backslash-newline continuation when not raw.
    line = "";
    ok = false;
    for (;;) {
      const r = stream.readUntil(delim === "" ? "" : delim);
      if (!r) break;
      line += r.text;
      ok = r.terminated;
      if (!raw && delim === "\n" && r.terminated && /(^|[^\\])(\\\\)*\\$/.test(r.text)) {
        line = line.slice(0, -1);
        continue;
      }
      break;
    }
    if (!ok && line === "") {
      // EOF with nothing read: variables are set to empty
      ok = false;
    }
  }
  const status = ok ? 0 : 1;

  const ifs = sh.getVar("IFS") ?? " \t\n";
  const unescape = (s: string) => (raw ? s : s.replace(/\\(.)/g, "$1"));
  const isWs = (c: string) => (c === " " || c === "\t" || c === "\n") && ifs.includes(c);

  const splitFields = (text: string, max: number): string[] => {
    const fields: string[] = [];
    let i = 0;
    // trim leading IFS whitespace
    while (i < text.length && isWs(text[i])) i++;
    while (i < text.length) {
      if (fields.length === max - 1) {
        let rest = text.slice(i);
        // trim trailing IFS whitespace
        let e = rest.length;
        while (e > 0 && isWs(rest[e - 1]) && !(rest[e - 2] === "\\" && !raw)) e--;
        rest = rest.slice(0, e);
        // a single trailing non-whitespace delimiter is removed
        if (rest.length && ifs.includes(rest[rest.length - 1]) && !isWs(rest[rest.length - 1])) {
          const without = rest.slice(0, -1);
          if (![...without].some((c) => ifs.includes(c) && !isWs(c))) rest = without;
        }
        fields.push(unescape(rest));
        return fields;
      }
      let f = "";
      while (i < text.length && !ifs.includes(text[i])) {
        if (!raw && text[i] === "\\" && i + 1 < text.length) {
          f += text[i] + text[i + 1];
          i += 2;
          continue;
        }
        f += text[i];
        i++;
      }
      fields.push(unescape(f));
      while (i < text.length && isWs(text[i])) i++;
      if (i < text.length && ifs.includes(text[i]) && !isWs(text[i])) {
        i++;
        while (i < text.length && isWs(text[i])) i++;
      }
    }
    return fields;
  };

  if (arrayName) {
    sh.setArray(arrayName, ifs === "" ? [unescape(line)] : splitFields(line, Infinity));
    return status;
  }
  const targets = names.length ? names : ["REPLY"];
  if (!names.length) {
    sh.setVar("REPLY", unescape(line));
    return status;
  }
  const fields = ifs === "" ? [unescape(line)] : splitFields(line, targets.length);
  targets.forEach((n, i) => {
    if (!validName(n)) throw new ExpansionError(`\`${n}': not a valid identifier`, false);
    sh.setVar(n, fields[i] ?? "");
  });
  return status;
};

const mapfile: CommandFn = (ctx) => {
  const { sh } = ctx;
  let trim = false;
  let count = 0;
  let skip = 0;
  let delim = "\n";
  let fd: number | undefined;
  let name = "MAPFILE";
  const a = ctx.args;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "-t") trim = true;
    else if (a[i] === "-n") count = Number(a[++i]);
    else if (a[i] === "-s") skip = Number(a[++i]);
    else if (a[i] === "-d") delim = (a[++i] ?? "").slice(0, 1);
    else if (a[i] === "-u") fd = Number(a[++i]);
    else if (a[i].startsWith("-")) return bad(ctx, `${a[i]}: invalid option`, 2);
    else name = a[i];
  }
  let stream = ctx.stdin;
  if (fd !== undefined) {
    const e = ctx.fds.get(fd);
    if (!e || e.kind !== "in") return bad(ctx, `${fd}: invalid file descriptor`);
    stream = e.s;
  }
  const lines: string[] = [];
  let read = 0;
  for (;;) {
    const r = stream.readUntil(delim === "" ? "" : delim);
    if (!r) break;
    read++;
    if (read <= skip) continue;
    lines.push(trim || !r.terminated ? r.text : r.text + (delim || "\0"));
    if (count && lines.length >= count) break;
  }
  sh.setArray(name, lines);
  return 0;
};

/* ---------- options ---------- */

const OPTION_LETTERS: Record<string, string> = {
  e: "errexit",
  u: "nounset",
  x: "xtrace",
  C: "noclobber",
  f: "noglob",
  n: "noexec",
  v: "verbose",
  a: "allexport",
  E: "errtrace",
  T: "functrace",
};

const set: CommandFn = (ctx) => {
  const { sh } = ctx;
  const args = ctx.args;
  if (!args.length) {
    const vars = allVars(sh);
    for (const n of [...vars.keys()].sort(compareNames)) {
      const v = vars.get(n)!;
      if (v.kind !== "scalar") ctx.out(declLine(n, v).replace(/^declare -\S+ /, "") + "\n");
      else ctx.out(`${n}=${shellQuoteForSet(v.value as string)}\n`);
    }
    for (const [n, f] of [...sh.funcs].sort(([a], [b]) => compareNames(a, b))) {
      void n;
      ctx.out(f.src + "\n");
    }
    return 0;
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      sh.positional = args.slice(i + 1);
      return 0;
    }
    if (a === "-o" || a === "+o") {
      const name = args[i + 1];
      if (!name) {
        for (const [k, v] of Object.entries(sh.opts).sort()) {
          ctx.out(a === "-o" ? `${k.padEnd(15)}\t${v ? "on" : "off"}\n` : `set ${v ? "-o" : "+o"} ${k}\n`);
        }
        return 0;
      }
      i++;
      if (!(name in sh.opts)) {
        if (["braceexpand", "hashall", "histexpand", "history", "interactive-comments", "monitor", "emacs", "vi", "posix"].includes(name)) continue;
        return bad(ctx, `${name}: invalid option name`, 2);
      }
      sh.opts[name] = a === "-o";
      continue;
    }
    if (/^[-+][a-zA-Z]+$/.test(a)) {
      const enable = a[0] === "-";
      for (const c of a.slice(1)) {
        if (c === "o") {
          // `-o NAME` inside a cluster (e.g. `set -euo pipefail`) takes the next argument.
          const name = args[++i];
          if (name === undefined) return bad(ctx, "-o: option requires an argument", 2);
          if (name in sh.opts) sh.opts[name] = enable;
          else if (!["braceexpand", "hashall", "histexpand", "history", "interactive-comments", "monitor", "emacs", "vi", "posix"].includes(name)) {
            return bad(ctx, `${name}: invalid option name`, 2);
          }
          continue;
        }
        const name = OPTION_LETTERS[c];
        if (!name) {
          if ("hBHmb".includes(c)) continue;
          return bad(ctx, `-${c}: invalid option`, 2);
        }
        sh.opts[name] = enable;
      }
      continue;
    }
    if (a === "-") {
      sh.opts.xtrace = false;
      sh.opts.verbose = false;
      sh.positional = args.slice(i + 1);
      return 0;
    }
    sh.positional = args.slice(i);
    return 0;
  }
  return 0;
};

function shellQuoteForSet(v: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]*$/.test(v) && v !== "") return v;
  return bashQ(v).startsWith("$'") ? bashQ(v) : `'${v.replace(/'/g, "'\\''")}'`;
}

const shopt: CommandFn = (ctx) => {
  const { sh } = ctx;
  let mode: "s" | "u" | "p" | "list" = "list";
  let quiet = false;
  const names: string[] = [];
  for (const a of ctx.args) {
    if (a === "-s") mode = "s";
    else if (a === "-u") mode = "u";
    else if (a === "-p") mode = "p";
    else if (a === "-q") quiet = true;
    else if (a === "-o") continue;
    else names.push(a);
  }
  if (mode === "s" || mode === "u") {
    let st = 0;
    for (const n of names) {
      if (!(n in sh.shopts)) {
        if (["checkwinsize", "cmdhist", "histappend", "progcomp", "interactive_comments", "promptvars", "sourcepath", "complete_fullquote", "extquote", "force_fignore", "hostcomplete", "checkhash", "autocd", "cdspell"].includes(n)) continue;
        ctx.err(`${sh.errPrefix()}: shopt: ${n}: invalid shell option name\n`);
        st = 1;
        continue;
      }
      sh.shopts[n] = mode === "s";
      if (n === "extglob" && mode === "s" && !sh.notices.has("extglob")) {
        sh.notices.add("extglob");
        ctx.err("bash-sim: note: extended glob patterns like @(a|b) are not supported by this simulator.\n");
      }
    }
    return st;
  }
  const list = names.length ? names : Object.keys(sh.shopts).sort();
  let st = 0;
  for (const n of list) {
    if (!(n in sh.shopts)) {
      ctx.err(`${sh.errPrefix()}: shopt: ${n}: invalid shell option name\n`);
      st = 1;
      continue;
    }
    if (!sh.shopts[n]) st = names.length ? 1 : st;
    if (quiet) continue;
    ctx.out(mode === "p" ? `shopt ${sh.shopts[n] ? "-s" : "-u"} ${n}\n` : `${n.padEnd(15)}\t${sh.shopts[n] ? "on" : "off"}\n`);
  }
  return st;
};

/* ---------- flow ---------- */

const returnB: CommandFn = (ctx) => {
  const { sh } = ctx;
  const n = ctx.args[0] === undefined ? sh.status : Number(ctx.args[0]);
  if (!Number.isInteger(n)) return bad(ctx, `${ctx.args[0]}: numeric argument required`, 2);
  if (sh.funcDepth === 0 && !(sh as Shell & { sourcing?: number }).sourcing) {
    return bad(ctx, "can only `return' from a function or sourced script");
  }
  throw new ReturnSignal(((n % 256) + 256) % 256);
};

const exit: CommandFn = (ctx) => {
  const { sh } = ctx;
  const raw = ctx.args[0];
  let n = raw === undefined ? sh.status : Number(raw);
  if (raw !== undefined && !/^[+-]?\d+$/.test(raw)) {
    ctx.err(`${sh.errPrefix()}: exit: ${raw}: numeric argument required\n`);
    n = 2;
  }
  if (sh.interactive && !sh.isSubshell) ctx.err("exit\n");
  throw new ExitSignal(((n % 256) + 256) % 256);
};

const loopCtl =
  (kind: "break" | "continue"): CommandFn =>
  (ctx) => {
    const n = ctx.args[0] === undefined ? 1 : Number(ctx.args[0]);
    if (!Number.isInteger(n) || n < 1) return bad(ctx, `${ctx.args[0]}: loop count out of range`);
    if (ctx.sh.loopDepth === 0) {
      ctx.err(`${ctx.sh.errPrefix()}: ${kind}: only meaningful in a \`for', \`while', or \`until' loop\n`);
      return 0;
    }
    const levels = Math.min(n, ctx.sh.loopDepth);
    throw kind === "break" ? new BreakSignal(levels) : new ContinueSignal(levels);
  };

const test: CommandFn = (ctx) => {
  let args = ctx.args;
  if (ctx.name === "[") {
    if (args[args.length - 1] !== "]") {
      ctx.err(`${ctx.sh.errPrefix()}: [: missing \`]'\n`);
      return 2;
    }
    args = args.slice(0, -1);
  }
  try {
    return evalTest(ctx.sh, args);
  } catch (err) {
    if (err instanceof TestError) {
      ctx.err(`${ctx.sh.errPrefix()}: ${ctx.name}: ${err.message}\n`);
      return 2;
    }
    throw err;
  }
};

const letB: CommandFn = (ctx) => {
  if (!ctx.args.length) return bad(ctx, "expression expected");
  let last = 0n;
  for (const a of ctx.args) {
    try {
      last = evalArith(ctx.sh.expandArithText(a, ctx.fds), ctx.sh.arithEnv());
    } catch (err) {
      if (err instanceof ArithError) return bad(ctx, `${a}: ${err.message}`);
      throw err;
    }
  }
  return last === 0n ? 1 : 0;
};

/* ---------- command lookup ---------- */

function describe(sh: Shell, name: string, all: boolean): { kind: string; text: string }[] {
  const out: { kind: string; text: string }[] = [];
  if (sh.aliases.has(name)) out.push({ kind: "alias", text: `${name} is aliased to \`${sh.aliases.get(name)}'` });
  if (KEYWORDS.has(name)) out.push({ kind: "keyword", text: `${name} is a shell keyword` });
  if (sh.funcs.has(name)) out.push({ kind: "function", text: `${name} is a function\n${sh.funcs.get(name)!.src}` });
  if (name in builtins) out.push({ kind: "builtin", text: `${name} is a shell builtin` });
  const pathVar = sh.getVar("PATH") ?? "";
  const seen = new Set<string>();
  for (const dir of pathVar.split(":")) {
    const full = normalizePath(`${dir || "."}/${name}`, sh.cwd);
    if (seen.has(full)) continue;
    seen.add(full);
    const node = sh.fs.lookup(full);
    if (node?.type === "file" && sh.fs.canExec(node)) {
      out.push({ kind: "file", text: `${name} is ${full}` });
      if (!all) break;
    }
  }
  if (name.includes("/")) {
    const full = normalizePath(name, sh.cwd);
    const node = sh.fs.lookup(full);
    if (node?.type === "file" && sh.fs.canExec(node)) out.push({ kind: "file", text: `${name} is ${name}` });
  }
  return all ? out : out.slice(0, 1);
}

const type: CommandFn = (ctx) => {
  let t = false;
  let all = false;
  let pathOnly = false;
  const names: string[] = [];
  for (const a of ctx.args) {
    if (/^-[atpP]+$/.test(a)) {
      if (a.includes("t")) t = true;
      if (a.includes("a")) all = true;
      if (a.includes("p") || a.includes("P")) pathOnly = true;
    } else names.push(a);
  }
  let st = 0;
  for (const n of names) {
    const d = describe(ctx.sh, n, all);
    if (!d.length) {
      if (!t && !pathOnly) ctx.err(`${ctx.sh.errPrefix()}: type: ${n}: not found\n`);
      st = 1;
      continue;
    }
    for (const x of d) {
      if (pathOnly) {
        if (x.kind === "file") ctx.out(x.text.replace(/^.* is /, "") + "\n");
      } else ctx.out((t ? x.kind : x.text) + "\n");
    }
  }
  return st;
};

const command: CommandFn = (ctx) => {
  const { sh } = ctx;
  let args = ctx.args;
  let v = false;
  let V = false;
  while (args.length && /^-[pvV]+$/.test(args[0])) {
    if (args[0].includes("v")) v = true;
    if (args[0].includes("V")) V = true;
    args = args.slice(1);
  }
  if (!args.length) return 0;
  if (v || V) {
    let st = 0;
    for (const n of args) {
      const d = describe(sh, n, false);
      if (!d.length) {
        if (V) ctx.err(`${sh.errPrefix()}: command: ${n}: not found\n`);
        st = 1;
        continue;
      }
      const x = d[0];
      if (V) ctx.out(x.text.split("\n")[0] + "\n");
      else if (x.kind === "file") ctx.out(x.text.replace(/^.* is /, "") + "\n");
      else if (x.kind === "alias") ctx.out(`alias ${n}='${sh.aliases.get(n)}'\n`);
      else ctx.out(n + "\n");
    }
    return st;
  }
  // run, bypassing functions and aliases
  if (args[0] in builtins) return sh.runBuiltin(args[0], args, ctx.fds);
  return sh.runExternal(args, ctx.fds, new Map(), ctx.fds);
};

const builtinB: CommandFn = (ctx) => {
  const name = ctx.args[0];
  if (!name) return 0;
  if (!(name in builtins)) return bad(ctx, `${name}: not a shell builtin`);
  return ctx.sh.runBuiltin(name, ctx.args, ctx.fds);
};

const alias: CommandFn = (ctx) => {
  const { sh } = ctx;
  const args = ctx.args.filter((a) => a !== "-p");
  if (!args.length) {
    for (const [k, v] of [...sh.aliases].sort(([a], [b]) => compareNames(a, b))) ctx.out(`alias ${k}='${v.replace(/'/g, "'\\''")}'\n`);
    return 0;
  }
  let st = 0;
  for (const a of args) {
    const eq = a.indexOf("=");
    if (eq === -1) {
      const v = sh.aliases.get(a);
      if (v === undefined) {
        ctx.err(`${sh.errPrefix()}: alias: ${a}: not found\n`);
        st = 1;
      } else ctx.out(`alias ${a}='${v.replace(/'/g, "'\\''")}'\n`);
      continue;
    }
    sh.aliases.set(a.slice(0, eq), a.slice(eq + 1));
  }
  if (!sh.interactive && !sh.shopts.expand_aliases && !sh.notices.has("alias-script")) {
    sh.notices.add("alias-script");
  }
  return st;
};

const unalias: CommandFn = (ctx) => {
  if (ctx.args[0] === "-a") {
    ctx.sh.aliases.clear();
    return 0;
  }
  let st = 0;
  for (const a of ctx.args) {
    if (!ctx.sh.aliases.delete(a)) {
      ctx.err(`${ctx.sh.errPrefix()}: unalias: ${a}: not found\n`);
      st = 1;
    }
  }
  return st;
};

const hash: CommandFn = (ctx) => {
  const table = ctx.sh.hashTable;
  if (ctx.args[0] === "-r") {
    table.clear();
    return 0;
  }
  if (ctx.args[0] === "-d") {
    for (const n of ctx.args.slice(1)) table.delete(n);
    return 0;
  }
  if (ctx.args.length) {
    for (const n of ctx.args) {
      const p = ctx.sh.findInPath(n);
      if (!p) return bad(ctx, `${n}: not found`);
      table.set(n, { path: p, hits: table.get(n)?.hits ?? 0 });
    }
    return 0;
  }
  if (!table.size) {
    ctx.out("hash: hash table empty\n");
    return 0;
  }
  ctx.out("hits\tcommand\n");
  for (const { path, hits } of table.values()) ctx.out(`${String(hits).padStart(4)}\t${path}\n`);
  return 0;
};

/* ---------- history / misc ---------- */

const history: CommandFn = (ctx) => {
  const h = ctx.sh.history;
  if (ctx.args[0] === "-c") {
    h.length = 0;
    return 0;
  }
  const n = ctx.args[0] && /^\d+$/.test(ctx.args[0]) ? Number(ctx.args[0]) : h.length;
  const start = Math.max(0, h.length - n);
  for (let i = start; i < h.length; i++) ctx.out(`${String(i + 1).padStart(5)}  ${h[i]}\n`);
  return 0;
};


const source: CommandFn = (ctx) => {
  const { sh } = ctx;
  const file = ctx.args[0];
  if (!file) {
    ctx.err(`${sh.errPrefix()}: ${ctx.name}: filename argument required\n`);
    return 2;
  }
  let path = file;
  if (!file.includes("/")) {
    const found = (sh.getVar("PATH") ?? "")
      .split(":")
      .map((d) => normalizePath(`${d}/${file}`, sh.cwd))
      .find((p) => sh.fs.isFile(p));
    path = found ?? normalizePath(file, sh.cwd);
  }
  let content: string;
  try {
    content = sh.readPath(path, ctx.fds);
  } catch (err) {
    if (err instanceof FsError) {
      ctx.err(`${sh.errPrefix()}: ${file}: ${fsErrorText[err.code]}\n`);
      return 1;
    }
    throw err;
  }
  const savedPos = sh.positional;
  if (ctx.args.length > 1) sh.positional = ctx.args.slice(1);
  const s = sh as Shell & { sourcing?: number };
  s.sourcing = (s.sourcing ?? 0) + 1;
  const savedName = sh.scriptName;
  sh.sourceStack.push(file);
  try {
    let node;
    try {
      node = new Parser(content).parseProgram();
    } catch (err) {
      if (err instanceof ParseError) {
        ctx.err(`${file}: line ${err.line}: ${err.message}\n`);
        return 2;
      }
      throw err;
    }
    try {
      return sh.exec(node, ctx.fds);
    } catch (err) {
      if (err instanceof ReturnSignal) return err.status;
      throw err;
    }
  } finally {
    s.sourcing!--;
    sh.sourceStack.pop();
    sh.scriptName = savedName;
    if (ctx.args.length > 1) sh.positional = savedPos;
  }
};

const evalB: CommandFn = (ctx) => {
  const src = ctx.args.join(" ");
  if (!src.trim()) return 0;
  let node;
  try {
    node = new Parser(src).parseProgram();
  } catch (err) {
    if (err instanceof ParseError) {
      ctx.err(`${ctx.sh.errPrefix()}: eval: ${err.message}\n`);
      return 2;
    }
    throw err;
  }
  return ctx.sh.exec(node, ctx.fds);
};

const exec: CommandFn = (ctx) => {
  const { sh } = ctx;
  if (!ctx.args.length) {
    const outer = sh.outerFds ?? sh.fds;
    for (const k of [...outer.keys()]) if (!ctx.fds.has(k)) outer.delete(k);
    for (const [k, v] of ctx.fds) outer.set(k, v);
    return 0;
  }
  const args = ctx.args;
  let st: number;
  if (sh.funcs.has(args[0])) st = sh.callFunction(args[0], args.slice(1), ctx.fds);
  else if (args[0] in builtins) st = sh.runBuiltin(args[0], args, ctx.fds);
  else st = sh.runExternal(args, ctx.fds, new Map(), ctx.fds);
  if (sh.interactive && !sh.isSubshell) {
    ctx.err("bash-sim: note: exec replaced the shell process; the simulator starts a fresh prompt instead of closing the terminal.\n");
    return st;
  }
  throw new ExitSignal(st);
};

const trap: CommandFn = (ctx) => {
  const { sh } = ctx;
  const args = ctx.args;
  if (args[0] === "-l") {
    ctx.out(SIGNALS.map(([n, s]) => `${String(n).padStart(2)}) SIG${s}`).join("\t") + "\n");
    return 0;
  }
  if (!args.length || args[0] === "-p") {
    const filter = args.slice(1).map((a) => sigName(a));
    for (const [sig, cmd] of sh.traps) {
      if (filter.length && !filter.includes(sig)) continue;
      ctx.out(`trap -- '${cmd.replace(/'/g, "'\\''")}' ${sig === "EXIT" || sig === "ERR" || sig === "DEBUG" || sig === "RETURN" ? sig : "SIG" + sig}\n`);
    }
    return 0;
  }
  let action: string | null = args[0];
  let sigs = args.slice(1);
  if (args.length === 1 || /^\d+$/.test(args[0])) {
    // `trap SIG` or `trap 2` → reset
    if (args.length === 1) {
      sigs = args;
      action = null;
    }
  }
  if (action === "-") action = null;
  let st = 0;
  for (const s of sigs) {
    const name = sigName(s);
    if (!name) {
      ctx.err(`${sh.errPrefix()}: trap: ${s}: invalid signal specification\n`);
      st = 1;
      continue;
    }
    if (action === null) sh.traps.delete(name);
    else sh.traps.set(name, action);
  }
  return st;
};

const kill: CommandFn = (ctx) => {
  const { sh } = ctx;
  let args = ctx.args;
  if (args[0] === "-l" || args[0] === "-L") {
    if (args[1]) {
      const n = Number(args[1]);
      const name = Number.isNaN(n) ? sigName(args[1]) : SIGNALS.find(([k]) => k === n % 128)?.[1];
      ctx.out((name ?? "") + "\n");
      return name ? 0 : 1;
    }
    ctx.out(SIGNALS.map(([n, s]) => `${String(n).padStart(2)}) SIG${s}`).join("\t") + "\n");
    return 0;
  }
  let sig = "TERM";
  if (args[0] === "-s" || args[0] === "-n") {
    sig = sigName(args[1] ?? "") ?? "";
    args = args.slice(2);
  } else if (args[0]?.startsWith("-") && args[0] !== "--") {
    sig = sigName(args[0].slice(1)) ?? "";
    args = args.slice(1);
  }
  if (args[0] === "--") args = args.slice(1);
  if (!sig) return bad(ctx, "invalid signal specification");
  if (!args.length) {
    ctx.err(`${sh.errPrefix()}: kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]\n`);
    return 2;
  }
  let st = 0;
  for (const target of args) {
    if (target === String(sh.pid) || target === String(sh.bashpid) || (target === "0" && true)) {
      deliverSignal(ctx, sig);
      continue;
    }
    if (target.startsWith("%")) {
      ctx.err(`${sh.errPrefix()}: kill: ${target}: no such job\n`);
      st = 1;
      continue;
    }
    if (!/^-?\d+$/.test(target)) {
      ctx.err(`${sh.errPrefix()}: kill: ${target}: arguments must be process or job IDs\n`);
      st = 1;
      continue;
    }
    ctx.err(`${sh.errPrefix()}: kill: (${target}) - No such process\n`);
    st = 1;
  }
  return st;
};

function deliverSignal(ctx: CmdCtx, sig: string): void {
  const { sh } = ctx;
  const handler = sh.traps.get(sig);
  if (handler !== undefined) {
    if (handler === "") return; // ignored
    const saved = sh.status;
    sh.runTrapSource(handler, ctx.fds);
    sh.status = saved;
    return;
  }
  if (sig === "CHLD" || sig === "CONT" || sig === "WINCH") return;
  if (sh.interactive && !sh.isSubshell && (sig === "TERM" || sig === "INT" || sig === "QUIT")) {
    ctx.err(`bash-sim: an interactive Bash ignores SIG${sig} sent to itself (try it inside a script instead).\n`);
    return;
  }
  const names: Record<string, string> = { TERM: "Terminated", INT: "", HUP: "Hangup", KILL: "Killed", QUIT: "Quit", USR1: "User defined signal 1", USR2: "User defined signal 2", ABRT: "Aborted", ALRM: "Alarm clock" };
  const msg = names[sig];
  if (msg) ctx.err(`${msg}\n`);
  if (sh.interactive && !sh.isSubshell) {
    ctx.err("bash-sim: (the simulated terminal stays open)\n");
    return;
  }
  throw new ExitSignal(128 + sigNumber(sig));
}

const wait: CommandFn = (ctx) => {
  const jobs = ctx.sh.jobs;
  const args = ctx.args.filter((a) => a !== "-n");
  if (!args.length) {
    const last = jobs[jobs.length - 1];
    if (ctx.args.includes("-n")) return last ? last.status : 127;
    return 0;
  }
  let st = 0;
  for (const a of args) {
    const job = a.startsWith("%") ? jobs.find((j) => j.id === Number(a.slice(1))) : jobs.find((j) => String(j.pid) === a);
    if (!job) {
      ctx.err(`${ctx.sh.errPrefix()}: wait: pid ${a} is not a child of this shell\n`);
      st = 127;
      continue;
    }
    st = job.status;
  }
  return st;
};

const jobsB: CommandFn = (ctx) => {
  const jobs = ctx.sh.jobs;
  const showPid = ctx.args.includes("-l") || ctx.args.includes("-p");
  jobs.forEach((j, i) => {
    const mark = i === jobs.length - 1 ? "+" : i === jobs.length - 2 ? "-" : " ";
    const state = j.status === 0 ? "Done" : `Exit ${j.status}`;
    if (ctx.args.includes("-p")) ctx.out(`${j.pid}\n`);
    else ctx.out(`[${j.id}]${mark}  ${showPid ? j.pid + " " : ""}${state.padEnd(24)}${j.cmd}\n`);
  });
  ctx.sh.jobs = [];
  return 0;
};

const fgbg: CommandFn = (ctx) => {
  ctx.err(`${ctx.sh.errPrefix()}: ${ctx.name}: ${ctx.args[0] ?? "current"}: no current job (background jobs finish instantly in this simulator)\n`);
  return 1;
};

const getopts: CommandFn = (ctx) => {
  const { sh } = ctx;
  const [optstring, name, ...rest] = ctx.args;
  if (optstring === undefined || name === undefined) {
    ctx.err(`${sh.errPrefix()}: getopts: usage: getopts optstring name [arg ...]\n`);
    return 2;
  }
  const args = rest.length ? rest : sh.positional;
  const silent = optstring.startsWith(":");
  const spec = silent ? optstring.slice(1) : optstring;
  let optind = Number(sh.getVar("OPTIND") ?? "1") || 1;
  const state = sh as Shell & { lastOptind?: number };
  // If the script reset OPTIND (e.g. OPTIND=1 inside a function), restart within-word scanning.
  if (state.lastOptind !== undefined && optind !== state.lastOptind) sh.getoptsChar = 1;
  const finish = () => {
    sh.setVar(name, "?");
    sh.setVar("OPTIND", String(optind));
    state.lastOptind = optind;
    sh.getoptsChar = 1;
    sh.unsetVar("OPTARG");
    return 1;
  };
  const setInd = (n: number) => {
    sh.setVar("OPTIND", String(n));
    state.lastOptind = n;
  };
  const arg = args[optind - 1];
  if (arg === undefined || arg === "-" || !arg.startsWith("-")) return finish();
  if (arg === "--") {
    optind++;
    return finish();
  }
  const ch = arg[sh.getoptsChar];
  const advance = () => {
    if (sh.getoptsChar + 1 >= arg.length) {
      optind++;
      sh.getoptsChar = 1;
    } else sh.getoptsChar++;
  };
  const idx = spec.indexOf(ch);
  if (idx === -1 || ch === ":") {
    advance();
    setInd(optind);
    if (silent) {
      sh.setVar(name, "?");
      sh.setVar("OPTARG", ch);
    } else {
      ctx.err(`${sh.arg0}: illegal option -- ${ch}\n`);
      sh.setVar(name, "?");
      sh.unsetVar("OPTARG");
    }
    return 0;
  }
  if (spec[idx + 1] === ":") {
    let value: string | undefined;
    if (sh.getoptsChar + 1 < arg.length) {
      value = arg.slice(sh.getoptsChar + 1);
      optind++;
      sh.getoptsChar = 1;
    } else {
      value = args[optind];
      optind += 2;
      sh.getoptsChar = 1;
    }
    if (value === undefined) {
      setInd(optind - 1);
      if (silent) {
        sh.setVar(name, ":");
        sh.setVar("OPTARG", ch);
      } else {
        ctx.err(`${sh.arg0}: option requires an argument -- ${ch}\n`);
        sh.setVar(name, "?");
        sh.unsetVar("OPTARG");
      }
      return 0;
    }
    sh.setVar(name, ch);
    sh.setVar("OPTARG", value);
    setInd(optind);
    return 0;
  }
  advance();
  sh.setVar(name, ch);
  sh.unsetVar("OPTARG");
  setInd(optind);
  return 0;
};

/* ---------- directory stack ---------- */

function tildePath(p: string): string {
  return p === HOME ? "~" : p.startsWith(HOME + "/") ? "~" + p.slice(HOME.length) : p;
}

const dirs: CommandFn = (ctx) => {
  const list = [ctx.sh.cwd, ...ctx.sh.dirStack];
  if (ctx.args.includes("-c")) {
    ctx.sh.dirStack = [];
    return 0;
  }
  if (ctx.args.includes("-v")) list.forEach((d, i) => ctx.out(`${String(i).padStart(2)}  ${tildePath(d)}\n`));
  else ctx.out(list.map(tildePath).join(" ") + "\n");
  return 0;
};

const pushd: CommandFn = (ctx) => {
  const { sh } = ctx;
  const target = ctx.args[0];
  const prev = sh.cwd;
  if (!target) {
    if (!sh.dirStack.length) return bad(ctx, "no other directory");
    const top = sh.dirStack.shift()!;
    const st = cd({ ...ctx, name: "pushd", args: [top] });
    if (st) return st;
    sh.dirStack.unshift(prev);
  } else {
    const st = cd({ ...ctx, name: "pushd", args: [target] });
    if (st) return st;
    sh.dirStack.unshift(prev);
  }
  return dirs({ ...ctx, args: [] });
};

const popd: CommandFn = (ctx) => {
  const { sh } = ctx;
  if (!sh.dirStack.length) return bad(ctx, "directory stack empty");
  const top = sh.dirStack.shift()!;
  const st = cd({ ...ctx, name: "popd", args: [top] });
  if (st) return st;
  return dirs({ ...ctx, args: [] });
};

const umask: CommandFn = (ctx) => {
  const fs = ctx.sh.fs;
  const a = ctx.args.filter((x) => x !== "-S");
  if (!a.length) {
    if (ctx.args.includes("-S")) {
      const allowed = (~fs.umask) & 0o777;
      const part = (shift: number) => ["r", "w", "x"].filter((_, i) => allowed & (1 << (shift + 2 - i))).join("");
      ctx.out(`u=${part(6)},g=${part(3)},o=${part(0)}\n`);
    } else ctx.out(fs.umask.toString(8).padStart(4, "0") + "\n");
    return 0;
  }
  if (!/^[0-7]{1,4}$/.test(a[0])) return bad(ctx, `${a[0]}: octal number out of range (symbolic modes are not supported in the simulator)`);
  fs.umask = parseInt(a[0], 8);
  return 0;
};

const help: CommandFn = (ctx) => {
  if (ctx.args[0]) {
    const n = ctx.args[0];
    if (n in builtins) {
      ctx.out(`${n}: a shell builtin. Lessons in this course explain it in depth — try the Cheat Sheets or Search (Ctrl+K) for "${n}".\n`);
      return 0;
    }
    return bad(ctx, `no help topics match \`${n}'.  Try \`help' with no arguments.`);
  }
  const bi = Object.keys(builtins).filter((b) => b !== "[").sort();
  const ex = Object.keys(externals).sort();
  ctx.out(
    "Bash Mastery simulator — a sandboxed Bash interpreter running entirely in your browser.\n" +
      "Nothing here touches a real system. Supported features include variables, quoting,\n" +
      "expansions, pipes, redirection, here-docs, functions, arrays, loops, [[ ]], (( )) and scripts.\n\n" +
      "Shell builtins:\n" +
      wrapList(bi) +
      "\nUtilities (/usr/bin):\n" +
      wrapList(ex) +
      "\nTerminal shortcuts: ↑/↓ history · Tab completion · Ctrl+L clear · Ctrl+C cancel line · `reset` restores the sandbox.\n",
  );
  return 0;
};

function wrapList(items: string[]): string {
  const lines: string[] = [];
  let cur = " ";
  for (const it of items) {
    if (cur.length + it.length + 1 > 78) {
      lines.push(cur);
      cur = " ";
    }
    cur += " " + it;
  }
  if (cur.trim()) lines.push(cur);
  return lines.join("\n") + "\n";
}

const trueB: CommandFn = () => 0;
const falseB: CommandFn = () => 1;

const disown: CommandFn = (ctx) => {
  ctx.sh.jobs = [];
  return 0;
};

const caller: CommandFn = (ctx) => {
  const { sh } = ctx;
  if (!sh.funcDepth) return 1;
  const frame = ctx.args.length ? Number(ctx.args[0]) : -1;
  const depth = sh.funcNames.length;
  const idx = frame < 0 ? 0 : frame;
  if (!Number.isInteger(idx) || idx >= depth) return 1;
  const line = sh.callLines[depth - 1 - idx] ?? 0;
  const fn = sh.funcNames[depth - 2 - idx] ?? "main";
  if (frame < 0) ctx.out(`${line} ${sh.scriptName ?? "NULL"}\n`);
  else ctx.out(`${line} ${fn} ${sh.scriptName ?? "NULL"}\n`);
  return 0;
};

const times: CommandFn = (ctx) => {
  ctx.out("0m0.010s 0m0.005s\n0m0.000s 0m0.000s\n");
  return 0;
};

export const builtins: Record<string, CommandFn> = {
  cd,
  pwd,
  echo,
  printf,
  declare,
  typeset: declare,
  local,
  export: exportB,
  readonly,
  unset,
  shift,
  read,
  mapfile,
  readarray: mapfile,
  set,
  shopt,
  return: returnB,
  exit,
  logout: exit,
  break: loopCtl("break"),
  continue: loopCtl("continue"),
  test,
  "[": test,
  true: trueB,
  false: falseB,
  ":": trueB,
  let: letB,
  type,
  command,
  builtin: builtinB,
  alias,
  unalias,
  hash,
  history,
  source,
  ".": source,
  eval: evalB,
  exec,
  trap,
  kill,
  wait,
  jobs: jobsB,
  fg: fgbg,
  bg: fgbg,
  disown,
  getopts,
  dirs,
  pushd,
  popd,
  umask,
  help,
  caller,
  times,
};

/** Read helpers re-exported for commands that need a stream. */
export { InStream, AbortSignal };
