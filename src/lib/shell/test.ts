import type { Shell } from "./shell";
import { isSymlink, normalizePath } from "./vfs";
import { HOME } from "./signals";

export class TestError extends Error {}

const UNARY = new Set(["-e", "-a", "-f", "-d", "-r", "-w", "-x", "-s", "-L", "-h", "-b", "-c", "-p", "-S", "-t", "-z", "-n", "-O", "-G", "-g", "-u", "-k", "-N"]);
const BINARY = new Set(["=", "==", "!=", "<", ">", "-eq", "-ne", "-lt", "-le", "-gt", "-ge", "-nt", "-ot", "-ef"]);

function toInt(s: string): bigint {
  const t = s.trim();
  if (!/^[+-]?\d+$/.test(t)) throw new TestError(`${s}: integer expression expected`);
  return BigInt(t);
}

function unary(sh: Shell, op: string, arg: string): boolean {
  if (op === "-z") return arg === "";
  if (op === "-n") return arg !== "";
  if (op === "-t") return arg === "0" || arg === "1" || arg === "2" ? sh.interactive : false;
  const abs = normalizePath(arg.startsWith("~") ? HOME + arg.slice(1) : arg, sh.cwd);
  if (arg === "") return false;
  if (abs === "/dev/null" || abs === "/dev/stdin" || abs === "/dev/stdout" || abs === "/dev/stderr") {
    return op === "-e" || op === "-a" || op === "-c" || op === "-r" || op === "-w";
  }
  const node = sh.fs.lookup(abs);
  switch (op) {
    case "-e":
    case "-a":
      return !!node;
    case "-f":
      return node?.type === "file";
    case "-d":
      return node?.type === "dir";
    case "-r":
      return !!node && sh.fs.canRead(node);
    case "-w":
      return !!node && sh.fs.canWrite(node);
    case "-x":
      return !!node && sh.fs.canExec(node);
    case "-s":
      return !!node && (node.type === "dir" || node.content.length > 0);
    case "-O":
    case "-G":
      return !!node && node.owner === "learner";
    case "-u":
      return !!node && (node.mode & 0o4000) !== 0;
    case "-g":
      return !!node && (node.mode & 0o2000) !== 0;
    case "-k":
      return !!node && (node.mode & 0o1000) !== 0;
    case "-N":
      return !!node;
    case "-L":
    case "-h":
      return isSymlink(sh.fs.lookup(abs, false));
    default:
      return false; // -b -c -p -S: no such files in the simulator
  }
}

function binary(sh: Shell, l: string, op: string, r: string): boolean {
  switch (op) {
    case "=":
    case "==":
      return l === r;
    case "!=":
      return l !== r;
    case "<":
      return l < r;
    case ">":
      return l > r;
    case "-eq": return toInt(l) === toInt(r);
    case "-ne": return toInt(l) !== toInt(r);
    case "-lt": return toInt(l) < toInt(r);
    case "-le": return toInt(l) <= toInt(r);
    case "-gt": return toInt(l) > toInt(r);
    case "-ge": return toInt(l) >= toInt(r);
    case "-nt":
    case "-ot":
    case "-ef": {
      const a = sh.fs.lookup(normalizePath(l, sh.cwd));
      const b = sh.fs.lookup(normalizePath(r, sh.cwd));
      if (op === "-ef") return !!a && a === b;
      if (op === "-nt") return !!a && (!b || a.mtime > b.mtime);
      return !!b && (!a || a.mtime < b.mtime);
    }
  }
  throw new TestError(`${op}: binary operator expected`);
}

/** Evaluate `test` / `[` arguments. Returns 0 (true), 1 (false). Throws TestError on syntax errors. */
export function evalTest(sh: Shell, args: string[]): number {
  let i = 0;

  const byCount = (a: string[]): boolean => {
    switch (a.length) {
      case 0:
        return false;
      case 1:
        return a[0] !== "";
      case 2:
        if (a[0] === "!") return a[1] === "";
        if (UNARY.has(a[0])) return unary(sh, a[0], a[1]);
        throw new TestError(`${a[0]}: unary operator expected`);
      case 3:
        if (BINARY.has(a[1])) return binary(sh, a[0], a[1], a[2]);
        if (a[1] === "-a") return a[0] !== "" && a[2] !== "";
        if (a[1] === "-o") return a[0] !== "" || a[2] !== "";
        if (a[0] === "!") return !byCount(a.slice(1));
        if (a[0] === "(" && a[2] === ")") return a[1] !== "";
        throw new TestError(`${a[1]}: binary operator expected`);
      case 4:
        if (a[0] === "!") return !byCount(a.slice(1));
        if (a[0] === "(" && a[3] === ")") return byCount(a.slice(1, 3));
    }
    return general(a);
  };

  const general = (a: string[]): boolean => {
    i = 0;
    const r = orExpr(a);
    if (i < a.length) throw new TestError(`${a[i]}: unexpected argument`);
    return r;
  };

  const orExpr = (a: string[]): boolean => {
    let v = andExpr(a);
    while (a[i] === "-o") {
      i++;
      const r = andExpr(a);
      v = v || r;
    }
    return v;
  };
  const andExpr = (a: string[]): boolean => {
    let v = notExpr(a);
    while (a[i] === "-a") {
      i++;
      const r = notExpr(a);
      v = v && r;
    }
    return v;
  };
  const notExpr = (a: string[]): boolean => {
    if (a[i] === "!") {
      i++;
      return !notExpr(a);
    }
    return primary(a);
  };
  const primary = (a: string[]): boolean => {
    if (a[i] === "(") {
      i++;
      const v = orExpr(a);
      if (a[i] !== ")") throw new TestError("`)' expected");
      i++;
      return v;
    }
    if (UNARY.has(a[i]) && i + 1 < a.length && !BINARY.has(a[i + 1])) {
      const op = a[i];
      const arg = a[i + 1];
      i += 2;
      return unary(sh, op, arg);
    }
    if (i + 2 < a.length + 0 && BINARY.has(a[i + 1])) {
      const l = a[i];
      const op = a[i + 1];
      const r = a[i + 2];
      i += 3;
      return binary(sh, l, op, r);
    }
    if (i >= a.length) throw new TestError("argument expected");
    const v = a[i];
    i++;
    return v !== "";
  };

  return byCount(args) ? 0 : 1;
}
