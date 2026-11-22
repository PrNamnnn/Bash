import type { CommandFn, CmdCtx } from "../shell";
import { compileRegex, RegexError } from "../pattern";
import { awkNumberToString, formatOnce } from "../format";
import { FsError, fsErrorText } from "../vfs";
import { BufferSink, InStream, cloneFds } from "../io";
import { ExitSignal } from "../signals";

/* ------------------------------------------------------------------ */
/* values                                                              */
/* ------------------------------------------------------------------ */

const UNINIT: unique symbol = Symbol("uninit");
class StrNum {
  constructor(public s: string) {}
}
type Val = number | string | StrNum | typeof UNINIT;
type AwkArray = Map<string, Val>;

const NUM_RE = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/;

function toNum(v: Val): number {
  if (typeof v === "number") return v;
  if (v === UNINIT) return 0;
  const s = v instanceof StrNum ? v.s : v;
  const m = s.match(/^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/);
  if (m) return Number(m[0]);
  if (/^\s*[+-]?(inf|nan)/i.test(s)) return Number(s.trim().replace(/^\+/, "").replace(/inf.*/i, "Infinity"));
  return 0;
}

class AwkError extends Error {}

/* ------------------------------------------------------------------ */
/* lexer                                                               */
/* ------------------------------------------------------------------ */

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "ere"; v: string }
  | { t: "name"; v: string }
  | { t: "funcname"; v: string }
  | { t: "builtin"; v: string }
  | { t: "kw"; v: string }
  | { t: "op"; v: string }
  | { t: "nl" }
  | { t: "eof" };

const KEYWORDS = new Set(["BEGIN", "END", "function", "func", "if", "else", "while", "for", "do", "break", "continue", "next", "nextfile", "exit", "return", "delete", "in", "getline", "print", "printf"]);
const BUILTINS = new Set(["length", "substr", "index", "split", "sub", "gsub", "match", "sprintf", "sin", "cos", "atan2", "exp", "log", "sqrt", "int", "rand", "srand", "tolower", "toupper", "system", "close", "fflush", "gensub", "systime", "strftime"]);
const OPS = ["+=", "-=", "*=", "/=", "%=", "^=", "**=", "==", "<=", ">=", "!=", "++", "--", "&&", "||", ">>", "!~", "**", "{", "}", "(", ")", "[", "]", ";", ",", "+", "-", "*", "/", "%", "^", "!", ">", "<", "|", "?", ":", "~", "$", "="];

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const regexAllowed = () => {
    const last = toks[toks.length - 1];
    if (!last) return true;
    if (last.t === "num" || last.t === "str" || last.t === "name" || last.t === "ere") return false;
    if (last.t === "builtin") return false;
    if (last.t === "op" && (last.v === ")" || last.v === "]" || last.v === "$" || last.v === "++" || last.v === "--")) return false;
    return true;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    if (c === "\\" && src[i + 1] === "\n") {
      i += 2;
      continue;
    }
    if (c === "#") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "\n") {
      toks.push({ t: "nl" });
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = src.slice(i).match(/^(0[xX][0-9a-fA-F]+|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)/)!;
      toks.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)!;
      const w = m[0];
      i += w.length;
      if (KEYWORDS.has(w)) toks.push({ t: "kw", v: w === "func" ? "function" : w });
      else if (BUILTINS.has(w)) toks.push({ t: "builtin", v: w });
      else if (src[i] === "(") toks.push({ t: "funcname", v: w });
      else toks.push({ t: "name", v: w });
      continue;
    }
    if (c === '"') {
      let s = "";
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\" && i + 1 < src.length) {
          const n = src[++i];
          const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", '"': '"', "/": "/", a: "\x07", b: "\b", f: "\f", v: "\v" };
          if (n in map) s += map[n];
          else if (/[0-7]/.test(n)) {
            const m = src.slice(i).match(/^[0-7]{1,3}/)!;
            s += String.fromCharCode(parseInt(m[0], 8));
            i += m[0].length - 1;
          } else s += "\\" + n;
          i++;
          continue;
        }
        if (src[i] === "\n") throw new AwkError("newline in string");
        s += src[i++];
      }
      if (src[i] !== '"') throw new AwkError("non-terminated string");
      i++;
      toks.push({ t: "str", v: s });
      continue;
    }
    if (c === "/" && regexAllowed()) {
      let s = "";
      i++;
      let inBracket = false;
      while (i < src.length && (src[i] !== "/" || inBracket)) {
        if (src[i] === "\\" && i + 1 < src.length) {
          if (src[i + 1] === "/") s += "/";
          else s += src[i] + src[i + 1];
          i += 2;
          continue;
        }
        if (src[i] === "[") inBracket = true;
        else if (src[i] === "]") inBracket = false;
        if (src[i] === "\n") throw new AwkError("newline in regex");
        s += src[i++];
      }
      i++;
      toks.push({ t: "ere", v: s });
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new AwkError(`syntax error at source line 1: unexpected character '${c}'`);
    toks.push({ t: "op", v: op === "**" ? "^" : op === "**=" ? "^=" : op });
    i += op.length;
  }
  toks.push({ t: "eof" });
  return toks;
}

/* ------------------------------------------------------------------ */
/* AST                                                                 */
/* ------------------------------------------------------------------ */

type Expr =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "re"; v: string }
  | { k: "var"; name: string }
  | { k: "idx"; name: string; subs: Expr[] }
  | { k: "field"; e: Expr }
  | { k: "assign"; op: string; target: Expr; e: Expr }
  | { k: "cond"; c: Expr; a: Expr; b: Expr }
  | { k: "bin"; op: string; l: Expr; r: Expr }
  | { k: "un"; op: string; e: Expr }
  | { k: "incdec"; op: "++" | "--"; prefix: boolean; target: Expr }
  | { k: "in"; subs: Expr[]; name: string }
  | { k: "match"; neg: boolean; l: Expr; r: Expr }
  | { k: "call"; name: string; args: Expr[] }
  | { k: "builtin"; name: string; args: Expr[] }
  | { k: "getline"; target?: Expr; file?: Expr; cmd?: Expr }
  | { k: "group"; e: Expr };

type Stmt =
  | { k: "expr"; e: Expr }
  | { k: "print"; args: Expr[]; redir?: { op: string; target: Expr } }
  | { k: "printf"; args: Expr[]; redir?: { op: string; target: Expr } }
  | { k: "if"; c: Expr; then: Stmt; else?: Stmt }
  | { k: "while"; c: Expr; body: Stmt }
  | { k: "do"; c: Expr; body: Stmt }
  | { k: "for"; init?: Stmt; c?: Expr; step?: Stmt; body: Stmt }
  | { k: "forin"; v: string; arr: string; body: Stmt }
  | { k: "block"; body: Stmt[] }
  | { k: "next" }
  | { k: "nextfile" }
  | { k: "exit"; e?: Expr }
  | { k: "return"; e?: Expr }
  | { k: "break" }
  | { k: "continue" }
  | { k: "delete"; name: string; subs?: Expr[] }
  | { k: "nop" };

interface Rule {
  kind: "begin" | "end" | "main";
  pattern?: Expr;
  range?: Expr;
  inRange?: boolean;
  body?: Stmt[];
}

interface Func {
  params: string[];
  body: Stmt[];
}

/* ------------------------------------------------------------------ */
/* parser                                                              */
/* ------------------------------------------------------------------ */

class AwkParser {
  i = 0;
  noGt = 0;
  noIn = 0;
  constructor(private toks: Tok[]) {}

  peek(o = 0): Tok {
    return this.toks[this.i + o];
  }
  isOp(v: string): boolean {
    const t = this.peek();
    return t.t === "op" && t.v === v;
  }
  isKw(v: string): boolean {
    const t = this.peek();
    return t.t === "kw" && t.v === v;
  }
  expectOp(v: string): void {
    if (!this.isOp(v)) throw new AwkError(`syntax error: expected '${v}' near ${this.describe()}`);
    this.i++;
  }
  describe(): string {
    const t = this.peek();
    if (t.t === "eof") return "end of program";
    if (t.t === "nl") return "newline";
    return `'${"v" in t ? String(t.v) : (t as { t: string }).t}'`;
  }
  skipNl(): void {
    while (this.peek().t === "nl") this.i++;
  }
  skipTerm(): void {
    while (this.peek().t === "nl" || this.isOp(";")) this.i++;
  }

  program(): { rules: Rule[]; funcs: Map<string, Func> } {
    const rules: Rule[] = [];
    const funcs = new Map<string, Func>();
    this.skipTerm();
    while (this.peek().t !== "eof") {
      if (this.isKw("BEGIN") || this.isKw("END")) {
        const kind = this.isKw("BEGIN") ? "begin" : "end";
        this.i++;
        this.skipNl();
        rules.push({ kind, body: this.block() });
      } else if (this.isKw("function")) {
        this.i++;
        const nameTok = this.peek();
        if (nameTok.t !== "funcname" && nameTok.t !== "name") throw new AwkError("syntax error: function name expected");
        this.i++;
        this.expectOp("(");
        const params: string[] = [];
        while (!this.isOp(")")) {
          const p = this.peek();
          if (p.t !== "name") throw new AwkError("syntax error in function parameters");
          params.push(p.v);
          this.i++;
          if (this.isOp(",")) {
            this.i++;
            this.skipNl();
          }
        }
        this.i++;
        this.skipNl();
        funcs.set((nameTok as { v: string }).v, { params, body: this.block() });
      } else {
        let pattern: Expr | undefined;
        let range: Expr | undefined;
        if (!this.isOp("{")) {
          pattern = this.expr();
          if (this.isOp(",")) {
            this.i++;
            this.skipNl();
            range = this.expr();
          }
        }
        let body: Stmt[] | undefined;
        if (this.isOp("{")) body = this.block();
        rules.push({ kind: "main", pattern, range, body });
      }
      this.skipTerm();
    }
    return { rules, funcs };
  }

  block(): Stmt[] {
    this.expectOp("{");
    const out: Stmt[] = [];
    this.skipTerm();
    while (!this.isOp("}")) {
      if (this.peek().t === "eof") throw new AwkError("syntax error: unexpected end of program, missing '}'");
      out.push(this.stmt());
      this.skipTerm();
    }
    this.i++;
    return out;
  }

  simpleOrBlock(): Stmt {
    this.skipNl();
    if (this.isOp(";")) {
      this.i++;
      return { k: "nop" };
    }
    return this.stmt();
  }

  endStmt(): void {
    if (this.isOp(";") || this.peek().t === "nl") {
      this.i++;
      return;
    }
    if (this.isOp("}") || this.peek().t === "eof") return;
    throw new AwkError(`syntax error near ${this.describe()}`);
  }

  stmt(): Stmt {
    const t = this.peek();
    if (t.t === "op" && t.v === "{") return { k: "block", body: this.block() };
    if (t.t === "kw") {
      switch (t.v) {
        case "if": {
          this.i++;
          this.expectOp("(");
          const c = this.expr();
          this.expectOp(")");
          const then = this.simpleOrBlock();
          const save = this.i;
          this.skipTerm();
          if (this.isKw("else")) {
            this.i++;
            return { k: "if", c, then, else: this.simpleOrBlock() };
          }
          this.i = save;
          return { k: "if", c, then };
        }
        case "while": {
          this.i++;
          this.expectOp("(");
          const c = this.expr();
          this.expectOp(")");
          if (this.isOp(";")) {
            this.i++;
            return { k: "while", c, body: { k: "nop" } };
          }
          return { k: "while", c, body: this.simpleOrBlock() };
        }
        case "do": {
          this.i++;
          const body = this.simpleOrBlock();
          this.skipTerm();
          if (!this.isKw("while")) throw new AwkError("syntax error: expected 'while' after 'do'");
          this.i++;
          this.expectOp("(");
          const c = this.expr();
          this.expectOp(")");
          this.endStmt();
          return { k: "do", c, body };
        }
        case "for": {
          this.i++;
          this.expectOp("(");
          if (this.peek().t === "name" && this.peek(1).t === "kw" && (this.peek(1) as { v: string }).v === "in" && this.peek(2).t === "name" && this.peek(3).t === "op" && (this.peek(3) as { v: string }).v === ")") {
            const v = (this.peek() as { v: string }).v;
            const arr = (this.peek(2) as { v: string }).v;
            this.i += 4;
            return { k: "forin", v, arr, body: this.simpleOrBlock() };
          }
          const init = this.isOp(";") ? undefined : this.simpleStmt();
          this.expectOp(";");
          this.skipNl();
          const c = this.isOp(";") ? undefined : this.expr();
          this.expectOp(";");
          this.skipNl();
          const step = this.isOp(")") ? undefined : this.simpleStmt();
          this.expectOp(")");
          if (this.isOp(";")) {
            this.i++;
            return { k: "for", init, c, step, body: { k: "nop" } };
          }
          return { k: "for", init, c, step, body: this.simpleOrBlock() };
        }
        case "next":
          this.i++;
          this.endStmt();
          return { k: "next" };
        case "nextfile":
          this.i++;
          this.endStmt();
          return { k: "nextfile" };
        case "break":
          this.i++;
          this.endStmt();
          return { k: "break" };
        case "continue":
          this.i++;
          this.endStmt();
          return { k: "continue" };
        case "exit":
        case "return": {
          this.i++;
          let e: Expr | undefined;
          if (!(this.isOp(";") || this.isOp("}") || this.peek().t === "nl" || this.peek().t === "eof")) e = this.expr();
          this.endStmt();
          return t.v === "exit" ? { k: "exit", e } : { k: "return", e };
        }
        case "delete": {
          this.i++;
          const n = this.peek();
          if (n.t !== "name") throw new AwkError("syntax error: delete needs an array name");
          this.i++;
          let subs: Expr[] | undefined;
          if (this.isOp("[")) {
            this.i++;
            subs = this.exprList("]");
            this.expectOp("]");
          }
          this.endStmt();
          return { k: "delete", name: n.v, subs };
        }
      }
    }
    const s = this.simpleStmt();
    this.endStmt();
    return s;
  }

  simpleStmt(): Stmt {
    if (this.isKw("print") || this.isKw("printf")) {
      const kind = (this.peek() as { v: string }).v as "print" | "printf";
      this.i++;
      let args: Expr[] = [];
      this.noGt++;
      try {
        if (this.isOp("(")) {
          // print (a, b) > "file"  or  print (a)(b)
          const save = this.i;
          this.i++;
          this.noGt--;
          let inner: Expr[];
          try {
            inner = this.exprList(")");
          } finally {
            this.noGt++;
          }
          if (this.isOp(")")) {
            this.i++;
            if (this.peek().t === "nl" || this.isOp(";") || this.isOp("}") || this.isOp(">") || this.isOp(">>") || this.isOp("|") || this.peek().t === "eof") {
              args = inner;
            } else {
              this.i = save;
              args = this.exprList();
            }
          } else {
            this.i = save;
            args = this.exprList();
          }
        } else if (!(this.isOp(";") || this.isOp("}") || this.peek().t === "nl" || this.isOp(">") || this.isOp(">>") || this.isOp("|") || this.peek().t === "eof")) {
          args = this.exprList();
        }
      } finally {
        this.noGt--;
      }
      let redir: { op: string; target: Expr } | undefined;
      if (this.isOp(">") || this.isOp(">>") || this.isOp("|")) {
        const op = (this.peek() as { v: string }).v;
        this.i++;
        this.noGt++;
        try {
          redir = { op, target: this.concat() };
        } finally {
          this.noGt--;
        }
      }
      return { k: kind, args, redir };
    }
    return { k: "expr", e: this.expr() };
  }

  exprList(close?: string): Expr[] {
    const out: Expr[] = [];
    if (close && this.isOp(close)) return out;
    out.push(this.expr());
    while (this.isOp(",")) {
      this.i++;
      this.skipNl();
      out.push(this.expr());
    }
    return out;
  }

  expr(): Expr {
    return this.ternary();
  }

  isLvalue(e: Expr): boolean {
    return e.k === "var" || e.k === "idx" || e.k === "field";
  }

  ternary(): Expr {
    const c = this.or();
    if (this.isOp("?")) {
      this.i++;
      this.skipNl();
      const a = this.ternary();
      this.skipNl();
      this.expectOp(":");
      this.skipNl();
      const b = this.ternary();
      return { k: "cond", c, a, b };
    }
    const t = this.peek();
    if (t.t === "op" && ["=", "+=", "-=", "*=", "/=", "%=", "^="].includes(t.v) && this.isLvalue(c)) {
      this.i++;
      this.skipNl();
      return { k: "assign", op: t.v, target: c, e: this.ternary() };
    }
    return c;
  }

  or(): Expr {
    let l = this.and();
    while (this.isOp("||")) {
      this.i++;
      this.skipNl();
      l = { k: "bin", op: "||", l, r: this.and() };
    }
    return l;
  }

  and(): Expr {
    let l = this.inExpr();
    while (this.isOp("&&")) {
      this.i++;
      this.skipNl();
      l = { k: "bin", op: "&&", l, r: this.inExpr() };
    }
    return l;
  }

  inExpr(): Expr {
    let l = this.matchExpr();
    while (this.isKw("in") && !this.noIn) {
      this.i++;
      const n = this.peek();
      if (n.t !== "name") throw new AwkError("syntax error: array name expected after 'in'");
      this.i++;
      l = { k: "in", subs: l.k === "group" && (l as { multi?: Expr[] }).multi ? (l as { multi?: Expr[] }).multi! : [l], name: n.v };
    }
    return l;
  }

  matchExpr(): Expr {
    let l = this.comparison();
    while (this.isOp("~") || this.isOp("!~")) {
      const neg = this.isOp("!~");
      this.i++;
      l = { k: "match", neg, l, r: this.comparison() };
    }
    return l;
  }

  comparison(): Expr {
    const l = this.concat();
    const t = this.peek();
    if (t.t === "op" && ["<", "<=", "==", "!=", ">=", ">"].includes(t.v)) {
      if (t.v === ">" && this.noGt) return l;
      this.i++;
      return { k: "bin", op: t.v, l, r: this.concat() };
    }
    return l;
  }

  startsOperand(): boolean {
    const t = this.peek();
    if (t.t === "num" || t.t === "str" || t.t === "ere" || t.t === "name" || t.t === "funcname" || t.t === "builtin") return true;
    if (t.t === "op" && (t.v === "$" || t.v === "(" || t.v === "!" || t.v === "++" || t.v === "--" || t.v === "-" || t.v === "+")) return t.v !== "-" && t.v !== "+";
    if (t.t === "kw" && t.v === "getline") return false;
    return false;
  }

  concat(): Expr {
    let l = this.additive();
    while (this.startsOperand() && !(this.isKw("in"))) {
      if (this.isOp("!") ) break;
      l = { k: "bin", op: "concat", l, r: this.additive() };
    }
    // `cmd | getline [var]`
    while (this.isOp("|") && this.peek(1).t === "kw" && (this.peek(1) as { v: string }).v === "getline") {
      this.i += 2;
      let target: Expr | undefined;
      if (this.peek().t === "name" || this.isOp("$")) target = this.primaryPostfix();
      l = { k: "getline", cmd: l, target };
    }
    return l;
  }

  additive(): Expr {
    let l = this.multiplicative();
    for (;;) {
      if (this.isOp("+") || this.isOp("-")) {
        const op = (this.peek() as { v: string }).v;
        this.i++;
        l = { k: "bin", op, l, r: this.multiplicative() };
      } else return l;
    }
  }

  multiplicative(): Expr {
    let l = this.unary();
    for (;;) {
      if (this.isOp("*") || this.isOp("/") || this.isOp("%")) {
        const op = (this.peek() as { v: string }).v;
        this.i++;
        l = { k: "bin", op, l, r: this.unary() };
      } else return l;
    }
  }

  unary(): Expr {
    if (this.isOp("!")) {
      this.i++;
      return { k: "un", op: "!", e: this.unary() };
    }
    if (this.isOp("-") || this.isOp("+")) {
      const op = (this.peek() as { v: string }).v;
      this.i++;
      return { k: "un", op, e: this.unary() };
    }
    return this.power();
  }

  power(): Expr {
    const base = this.incdec();
    if (this.isOp("^")) {
      this.i++;
      return { k: "bin", op: "^", l: base, r: this.unaryPower() };
    }
    return base;
  }

  unaryPower(): Expr {
    if (this.isOp("-") || this.isOp("+") || this.isOp("!")) {
      const op = (this.peek() as { v: string }).v;
      this.i++;
      return { k: "un", op, e: this.unaryPower() };
    }
    return this.power();
  }

  incdec(): Expr {
    if (this.isOp("++") || this.isOp("--")) {
      const op = (this.peek() as { v: string }).v as "++" | "--";
      this.i++;
      const target = this.primaryPostfix();
      if (!this.isLvalue(target)) throw new AwkError("syntax error: ++/-- needs a variable");
      return { k: "incdec", op, prefix: true, target };
    }
    const e = this.primaryPostfix();
    if ((this.isOp("++") || this.isOp("--")) && this.isLvalue(e)) {
      const op = (this.peek() as { v: string }).v as "++" | "--";
      this.i++;
      return { k: "incdec", op, prefix: false, target: e };
    }
    return e;
  }

  primaryPostfix(): Expr {
    const t = this.peek();
    if (t.t === "op" && t.v === "$") {
      this.i++;
      return { k: "field", e: this.incdecForField() };
    }
    return this.primary();
  }

  incdecForField(): Expr {
    if (this.isOp("++") || this.isOp("--")) {
      const op = (this.peek() as { v: string }).v as "++" | "--";
      this.i++;
      return { k: "incdec", op, prefix: true, target: this.primaryPostfix() };
    }
    if (this.isOp("-")) {
      this.i++;
      return { k: "un", op: "-", e: this.primaryPostfix() };
    }
    return this.primaryPostfix();
  }

  primary(): Expr {
    const t = this.peek();
    switch (t.t) {
      case "num":
        this.i++;
        return { k: "num", v: t.v };
      case "str":
        this.i++;
        return { k: "str", v: t.v };
      case "ere":
        this.i++;
        return { k: "re", v: t.v };
      case "name": {
        this.i++;
        if (this.isOp("[")) {
          this.i++;
          const subs = this.exprList("]");
          this.expectOp("]");
          return { k: "idx", name: t.v, subs };
        }
        return { k: "var", name: t.v };
      }
      case "funcname": {
        this.i++;
        this.expectOp("(");
        const args = this.exprList(")");
        this.expectOp(")");
        return { k: "call", name: t.v, args };
      }
      case "builtin": {
        this.i++;
        if (this.isOp("(")) {
          this.i++;
          const args = this.exprList(")");
          this.expectOp(")");
          return { k: "builtin", name: t.v, args };
        }
        if (t.v === "length") return { k: "builtin", name: "length", args: [] };
        throw new AwkError(`syntax error: ${t.v} requires arguments`);
      }
      case "kw":
        if (t.v === "getline") {
          this.i++;
          let target: Expr | undefined;
          if (this.peek().t === "name" || this.isOp("$")) target = this.primaryPostfix();
          let file: Expr | undefined;
          if (this.isOp("<")) {
            this.i++;
            file = this.primaryPostfix();
          }
          return { k: "getline", target, file };
        }
        break;
      case "op":
        if (t.v === "(") {
          this.i++;
          this.noIn++;
          this.noGt = 0;
          let list: Expr[];
          try {
            list = this.exprList(")");
          } finally {
            this.noIn--;
          }
          this.expectOp(")");
          if (list.length > 1) {
            if (!this.isKw("in")) throw new AwkError("syntax error: unexpected ','");
            const g = { k: "group" as const, e: list[0] } as Expr & { multi?: Expr[] };
            (g as { multi?: Expr[] }).multi = list;
            return g;
          }
          return { k: "group", e: list[0] };
        }
        if (t.v === "-" || t.v === "+" || t.v === "!") return this.unary();
    }
    throw new AwkError(`syntax error near ${this.describe()}`);
  }
}

/* ------------------------------------------------------------------ */
/* interpreter                                                         */
/* ------------------------------------------------------------------ */

class NextSignal {}
class NextFileSignal {}
class AwkExit {
  constructor(public code: number) {}
}
class AwkReturn {
  constructor(public v: Val) {}
}
class AwkBreak {}
class AwkContinue {}

class Interp {
  globals = new Map<string, Val | AwkArray>();
  frames: Map<string, Val | AwkArray>[] = [];
  links = new WeakMap<Map<string, Val | AwkArray>, Map<string, { scope: Map<string, Val | AwkArray>; name: string }>>();
  fields: string[] = [""];
  nf = 0;
  record = "";
  out = "";
  files = new Map<string, { append: boolean }>();
  pipes = new Map<string, string>();
  readers = new Map<string, InStream>();
  reCache = new Map<string, RegExp>();
  rand = mulberry(0);
  seed = 0;
  steps = 0;
  inputs: { name: string; stream: InStream }[] = [];
  currentInput: InStream | null = null;
  inputIndex = 0;

  constructor(
    private ctx: CmdCtx,
    private funcs: Map<string, Func>,
  ) {
    const g = this.globals;
    g.set("FS", " ");
    g.set("OFS", " ");
    g.set("ORS", "\n");
    g.set("RS", "\n");
    g.set("NR", 0);
    g.set("FNR", 0);
    g.set("NF", 0);
    g.set("SUBSEP", "\x1c");
    g.set("CONVFMT", "%.6g");
    g.set("OFMT", "%.6g");
    g.set("RSTART", 0);
    g.set("RLENGTH", -1);
    g.set("FILENAME", "");
    const env: AwkArray = new Map();
    for (const [k, v] of ctx.env) env.set(k, new StrNum(v));
    g.set("ENVIRON", env);
  }

  str(v: Val, fmt = "CONVFMT"): string {
    if (typeof v === "number") return awkNumberToString(v, this.getStr(fmt));
    if (v === UNINIT) return "";
    if (v instanceof StrNum) return v.s;
    return v;
  }

  getStr(name: string): string {
    const v = this.globals.get(name);
    if (v === undefined || v instanceof Map) return "";
    if (typeof v === "number") return String(v);
    if (v === UNINIT) return "";
    return v instanceof StrNum ? v.s : v;
  }

  regex(src: string): RegExp {
    let re = this.reCache.get(src);
    if (!re) {
      try {
        re = compileRegex(src, "ere");
      } catch (err) {
        if (err instanceof RegexError) throw new AwkError(`invalid regex: ${src}`);
        throw err;
      }
      this.reCache.set(src, re);
    }
    return re;
  }

  toRegex(e: Expr): RegExp {
    if (e.k === "re") return this.regex(e.v);
    return this.regex(this.str(this.eval(e)));
  }

  /* ---------- variables ---------- */

  lookup(name: string): Map<string, Val | AwkArray> {
    const f = this.frames[this.frames.length - 1];
    if (f && f.has(name)) return f;
    return this.globals;
  }

  getVar(name: string): Val {
    if (name === "NF") return this.nf;
    const scope = this.lookup(name);
    const v = scope.get(name);
    if (v === undefined) return UNINIT;
    if (v instanceof Map) throw new AwkError(`attempt to use array \`${name}' in a scalar context`);
    return v;
  }

  setVar(name: string, v: Val): void {
    if (name === "NF") {
      this.setNF(Math.max(0, Math.trunc(toNum(v))));
      return;
    }
    const scope = this.lookup(name);
    if (scope.get(name) instanceof Map) throw new AwkError(`attempt to use array \`${name}' in a scalar context`);
    scope.set(name, v);
  }

  getArray(name: string): AwkArray {
    const scope = this.lookup(name);
    let v = scope.get(name);
    if (v === undefined || v === UNINIT) {
      const link = this.links.get(scope)?.get(name);
      const linked = link?.scope.get(link.name);
      v = linked instanceof Map ? linked : new Map();
      scope.set(name, v);
      if (link && !(linked instanceof Map)) link.scope.set(link.name, v);
    }
    if (!(v instanceof Map)) throw new AwkError(`attempt to use scalar \`${name}' as an array`);
    return v;
  }

  subKey(subs: Expr[]): string {
    return subs.map((s) => this.str(this.eval(s))).join(this.getStr("SUBSEP"));
  }

  /* ---------- fields ---------- */

  setRecord(text: string): void {
    this.record = text;
    this.splitRecord();
  }

  splitRecord(): void {
    const fs = this.getStr("FS");
    let parts: string[];
    const text = this.record;
    if (fs === " ") parts = text.split(/[ \t\n]+/).filter((x, i, arr) => !((i === 0 || i === arr.length - 1) && x === ""));
    else if (fs === "") parts = [...text];
    else if (fs.length === 1 && fs !== "\\") parts = text === "" ? [] : text.split(fs);
    else parts = text === "" ? [] : text.split(new RegExp(this.regex(fs).source));
    if (text.trim() === "" && fs === " ") parts = [];
    this.fields = [text, ...parts];
    this.nf = parts.length;
  }

  rebuild(): void {
    const ofs = this.getStr("OFS");
    this.record = this.fields.slice(1, this.nf + 1).join(ofs);
    this.fields[0] = this.record;
  }

  setNF(n: number): void {
    while (this.fields.length <= n) this.fields.push("");
    this.fields.length = n + 1;
    this.nf = n;
    this.rebuild();
  }

  getField(i: number): Val {
    if (i < 0) throw new AwkError(`trying to access out of range field ${i}`);
    if (i === 0) return new StrNum(this.record);
    if (i > this.nf) return UNINIT;
    return new StrNum(this.fields[i]);
  }

  setField(i: number, v: string): void {
    if (i === 0) {
      this.setRecord(v);
      return;
    }
    while (this.fields.length <= i) this.fields.push("");
    this.fields[i] = v;
    if (i > this.nf) this.nf = i;
    this.rebuild();
  }

  /* ---------- evaluation ---------- */

  truthy(v: Val): boolean {
    if (typeof v === "number") return v !== 0;
    if (v === UNINIT) return false;
    if (v instanceof StrNum) return NUM_RE.test(v.s) ? Number(v.s) !== 0 : v.s !== "";
    return v !== "";
  }

  compare(a: Val, b: Val): number {
    const numeric = (v: Val) => typeof v === "number" || v === UNINIT || (v instanceof StrNum && NUM_RE.test(v.s));
    if (numeric(a) && numeric(b)) {
      const x = toNum(a);
      const y = toNum(b);
      return x < y ? -1 : x > y ? 1 : 0;
    }
    const x = this.str(a);
    const y = this.str(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }

  assignTo(target: Expr, v: Val): void {
    if (target.k === "var") this.setVar(target.name, v);
    else if (target.k === "idx") this.getArray(target.name).set(this.subKey(target.subs), v);
    else if (target.k === "field") this.setField(Math.trunc(toNum(this.eval(target.e))), this.str(v));
    else throw new AwkError("assignment to non-variable");
  }

  readTarget(target: Expr): Val {
    if (target.k === "var") return this.getVar(target.name);
    if (target.k === "idx") {
      const arr = this.getArray(target.name);
      const key = this.subKey(target.subs);
      if (!arr.has(key)) arr.set(key, UNINIT);
      return arr.get(key)!;
    }
    if (target.k === "field") return this.getField(Math.trunc(toNum(this.eval(target.e))));
    throw new AwkError("not an lvalue");
  }

  eval(e: Expr): Val {
    if (++this.steps % 2048 === 0) this.ctx.sh.tick();
    switch (e.k) {
      case "num": return e.v;
      case "str": return e.v;
      case "re": return this.regex(e.v).test(this.record) ? 1 : 0;
      case "group": return this.eval(e.e);
      case "var": return this.getVar(e.name);
      case "idx": return this.readTarget(e);
      case "field": return this.getField(Math.trunc(toNum(this.eval(e.e))));
      case "assign": {
        let v = this.eval(e.e);
        if (v instanceof StrNum && e.op === "=") v = new StrNum(v.s);
        if (e.op !== "=") {
          const cur = toNum(this.readTarget(e.target));
          const r = toNum(v);
          switch (e.op) {
            case "+=": v = cur + r; break;
            case "-=": v = cur - r; break;
            case "*=": v = cur * r; break;
            case "/=":
              if (r === 0) throw new AwkError("division by zero in /=");
              v = cur / r;
              break;
            case "%=":
              if (r === 0) throw new AwkError("division by zero in %=");
              v = cur % r;
              break;
            case "^=": v = cur ** r; break;
          }
        }
        this.assignTo(e.target, v);
        return v;
      }
      case "cond": return this.truthy(this.eval(e.c)) ? this.eval(e.a) : this.eval(e.b);
      case "un": {
        const v = this.eval(e.e);
        if (e.op === "!") return this.truthy(v) ? 0 : 1;
        if (e.op === "-") return -toNum(v);
        return toNum(v);
      }
      case "incdec": {
        const cur = toNum(this.readTarget(e.target));
        const next = e.op === "++" ? cur + 1 : cur - 1;
        this.assignTo(e.target, next);
        return e.prefix ? next : cur;
      }
      case "in": return this.getArray(e.name).has(this.subKey(e.subs)) ? 1 : 0;
      case "match": {
        const s = this.str(this.eval(e.l));
        const m = this.toRegex(e.r).test(s);
        return m !== e.neg ? 1 : 0;
      }
      case "bin": {
        if (e.op === "&&") return this.truthy(this.eval(e.l)) && this.truthy(this.eval(e.r)) ? 1 : 0;
        if (e.op === "||") return this.truthy(this.eval(e.l)) || this.truthy(this.eval(e.r)) ? 1 : 0;
        const l = this.eval(e.l);
        const r = this.eval(e.r);
        switch (e.op) {
          case "concat": return this.str(l) + this.str(r);
          case "+": return toNum(l) + toNum(r);
          case "-": return toNum(l) - toNum(r);
          case "*": return toNum(l) * toNum(r);
          case "/": {
            const d = toNum(r);
            if (d === 0) throw new AwkError("division by zero");
            return toNum(l) / d;
          }
          case "%": {
            const d = toNum(r);
            if (d === 0) throw new AwkError("division by zero in %");
            return toNum(l) % d;
          }
          case "^": return toNum(l) ** toNum(r);
          case "<": return this.compare(l, r) < 0 ? 1 : 0;
          case "<=": return this.compare(l, r) <= 0 ? 1 : 0;
          case ">": return this.compare(l, r) > 0 ? 1 : 0;
          case ">=": return this.compare(l, r) >= 0 ? 1 : 0;
          case "==": return this.compare(l, r) === 0 ? 1 : 0;
          case "!=": return this.compare(l, r) !== 0 ? 1 : 0;
        }
        throw new AwkError(`unknown operator ${e.op}`);
      }
      case "call": return this.callUser(e.name, e.args);
      case "builtin": return this.callBuiltin(e.name, e.args);
      case "getline": return this.getline(e);
    }
  }

  getline(e: Extract<Expr, { k: "getline" }>): Val {
    let line: string | null;
    if (e.cmd) {
      const cmd = this.str(this.eval(e.cmd));
      let r = this.readers.get("|" + cmd);
      if (!r) {
        r = new InStream(this.runShell(cmd, ""));
        this.readers.set("|" + cmd, r);
      }
      line = r.readUntil("\n")?.text ?? null;
    } else if (e.file) {
      const name = this.str(this.eval(e.file));
      let r = this.readers.get(name);
      if (!r) {
        try {
          r = new InStream(this.ctx.readInput(name));
        } catch {
          return -1;
        }
        this.readers.set(name, r);
      }
      line = r.readUntil("\n")?.text ?? null;
    } else {
      line = this.nextRecord();
      if (line !== null) {
        this.globals.set("NR", toNum(this.getVar("NR")) + 1);
        this.globals.set("FNR", toNum(this.getVar("FNR")) + 1);
      }
    }
    if (line === null) return 0;
    if (e.target) this.assignTo(e.target, new StrNum(line));
    else if (e.cmd || e.file) {
      this.setRecord(line);
      if (e.cmd) this.globals.set("NR", toNum(this.getVar("NR")) + 1);
    } else this.setRecord(line);
    return 1;
  }

  runShell(cmd: string, input: string): string {
    const sub = this.ctx.sh.subshell();
    const buf = new BufferSink(this.ctx.sh.budget);
    const fds = cloneFds(this.ctx.fds);
    fds.set(0, { kind: "in", s: new InStream(input) });
    fds.set(1, { kind: "out", s: buf });
    try {
      sub.runSource(cmd, fds);
    } catch (err) {
      if (!(err instanceof ExitSignal)) throw err;
    }
    return buf.text;
  }

  callUser(name: string, args: Expr[]): Val {
    const f = this.funcs.get(name);
    if (!f) throw new AwkError(`calling undefined function ${name}`);
    if (this.frames.length > 300) throw new AwkError("function call nesting too deep");
    const frame = new Map<string, Val | AwkArray>();
    f.params.forEach((p, i) => {
      const a = args[i];
      if (!a) {
        frame.set(p, UNINIT);
        return;
      }
      if (a.k === "var") {
        const scope = this.lookup(a.name);
        const existing = scope.get(a.name);
        if (existing instanceof Map) {
          frame.set(p, existing);
          return;
        }
        if (existing === undefined || existing === UNINIT) {
          // An untyped variable may become an array inside the function: link it back to the caller.
          frame.set(p, UNINIT);
          let l = this.links.get(frame);
          if (!l) this.links.set(frame, (l = new Map()));
          l.set(p, { scope, name: a.name });
          return;
        }
        frame.set(p, existing);
        return;
      }
      frame.set(p, this.eval(a));
    });
    this.frames.push(frame);
    try {
      this.execBlock(f.body);
    } catch (err) {
      if (err instanceof AwkReturn) return err.v;
      throw err;
    } finally {
      this.frames.pop();
    }
    return UNINIT;
  }

  callBuiltin(name: string, args: Expr[]): Val {
    const a = (i: number) => (args[i] ? this.eval(args[i]) : UNINIT);
    switch (name) {
      case "length": {
        if (!args.length) return [...this.record].length;
        const e = args[0];
        if (e.k === "var") {
          const scope = this.lookup(e.name);
          const v = scope.get(e.name);
          if (v instanceof Map) return v.size;
        }
        return [...this.str(a(0))].length;
      }
      case "substr": {
        const s = [...this.str(a(0))];
        const m = toNum(a(1));
        const start = Math.round(m);
        let n = args.length > 2 ? Math.round(toNum(a(2))) : Infinity;
        let from = start;
        if (from < 1) {
          n += from - 1;
          from = 1;
        }
        if (n <= 0) return "";
        return s.slice(from - 1, Number.isFinite(n) ? from - 1 + n : undefined).join("");
      }
      case "index": {
        const s = this.str(a(0));
        const t = this.str(a(1));
        return s.indexOf(t) + 1;
      }
      case "split": {
        const s = this.str(a(0));
        const target = args[1];
        if (!target || target.k !== "var") throw new AwkError("split: second argument must be an array");
        const arr = this.getArray(target.name);
        arr.clear();
        let parts: string[];
        const sepExpr = args[2];
        const fs = sepExpr ? (sepExpr.k === "re" ? null : this.str(this.eval(sepExpr))) : this.getStr("FS");
        if (s === "") parts = [];
        else if (sepExpr?.k === "re") parts = s.split(new RegExp(this.regex(sepExpr.v).source));
        else if (fs === " ") parts = s.trim() === "" ? [] : s.trim().split(/[ \t\n]+/);
        else if (fs === "") parts = [...s];
        else if (fs!.length === 1) parts = s.split(fs!);
        else parts = s.split(new RegExp(this.regex(fs!).source));
        parts.forEach((p, i) => arr.set(String(i + 1), new StrNum(p)));
        return parts.length;
      }
      case "sub":
      case "gsub":
        return this.substitute(name === "gsub", args);
      case "gensub": {
        const re = this.toRegex(args[0]);
        const repl = this.str(a(1));
        const how = this.str(a(2));
        const target = args.length > 3 ? this.str(a(3)) : this.record;
        const global = /^[gG]/.test(how);
        const nth = global ? 0 : Math.max(1, Math.trunc(toNum(a(2))) || 1);
        let count = 0;
        const g = new RegExp(re.source, "g");
        return target.replace(g, (...m: unknown[]) => {
          count++;
          const groups = m.slice(0, -2) as string[];
          if (!global && count !== nth) return groups[0];
          return repl.replace(/\\(\d)|&|\\&/g, (x, d: string | undefined) => (x === "\\&" ? "&" : x === "&" ? groups[0] : groups[Number(d)] ?? ""));
        });
      }
      case "match": {
        const s = this.str(a(0));
        const re = this.toRegex(args[1]);
        const m = re.exec(s);
        if (args[2] && args[2].k === "var") {
          const arr = this.getArray(args[2].name);
          arr.clear();
          if (m) m.forEach((g, i) => arr.set(String(i), new StrNum(g ?? "")));
        }
        if (!m) {
          this.globals.set("RSTART", 0);
          this.globals.set("RLENGTH", -1);
          return 0;
        }
        this.globals.set("RSTART", m.index + 1);
        this.globals.set("RLENGTH", m[0].length);
        return m.index + 1;
      }
      case "sprintf": {
        if (!args.length) throw new AwkError("sprintf: no format");
        return this.format(args);
      }
      case "sin": return Math.sin(toNum(a(0)));
      case "cos": return Math.cos(toNum(a(0)));
      case "atan2": return Math.atan2(toNum(a(0)), toNum(a(1)));
      case "exp": return Math.exp(toNum(a(0)));
      case "log": return Math.log(toNum(a(0)));
      case "sqrt": return Math.sqrt(toNum(a(0)));
      case "int": return Math.trunc(toNum(a(0)));
      case "rand": return this.rand();
      case "srand": {
        const prev = this.seed;
        this.seed = args.length ? toNum(a(0)) : Math.floor(Date.now() / 1000);
        this.rand = mulberry(this.seed);
        return prev;
      }
      case "tolower": return this.str(a(0)).toLowerCase();
      case "toupper": return this.str(a(0)).toUpperCase();
      case "system": {
        this.flush();
        const sub = this.ctx.sh.subshell();
        let st = 0;
        try {
          st = sub.runSource(this.str(a(0)), this.ctx.fds);
        } catch (err) {
          if (err instanceof ExitSignal) st = err.status;
          else throw err;
        }
        return st;
      }
      case "close": {
        const n = this.str(a(0));
        this.closeStream(n);
        this.readers.delete(n);
        this.readers.delete("|" + n);
        return 0;
      }
      case "fflush": return 0;
      case "systime": return Math.floor(Date.now() / 1000);
      case "strftime": {
        const d = args.length > 1 ? new Date(toNum(a(1)) * 1000) : new Date();
        const fmt = args.length ? this.str(a(0)) : "%a %b %e %H:%M:%S %Z %Y";
        const p = (n: number) => String(n).padStart(2, "0");
        return fmt.replace(/%([YmdHMSjeabZ%])/g, (_, c: string) => {
          switch (c) {
            case "Y": return String(d.getFullYear());
            case "m": return p(d.getMonth() + 1);
            case "d": return p(d.getDate());
            case "e": return String(d.getDate()).padStart(2, " ");
            case "H": return p(d.getHours());
            case "M": return p(d.getMinutes());
            case "S": return p(d.getSeconds());
            case "a": return d.toDateString().slice(0, 3);
            case "b": return d.toDateString().slice(4, 7);
            case "Z": return "UTC";
            case "%": return "%";
          }
          return c;
        });
      }
    }
    throw new AwkError(`function ${name} not supported`);
  }

  substitute(global: boolean, args: Expr[]): Val {
    const re = this.toRegex(args[0]);
    const repl = this.str(this.eval(args[1]));
    const target = args[2] ?? ({ k: "field", e: { k: "num", v: 0 } } as Expr);
    const original = this.str(this.readTarget(target));
    let count = 0;
    const g = new RegExp(re.source, "g");
    const result = original.replace(g, (m: string) => {
      if (!global && count > 0) return m;
      count++;
      let out = "";
      for (let i = 0; i < repl.length; i++) {
        if (repl[i] === "\\" && repl[i + 1] === "&") {
          out += "&";
          i++;
        } else if (repl[i] === "\\" && repl[i + 1] === "\\") {
          out += "\\";
          i++;
        } else if (repl[i] === "&") out += m;
        else out += repl[i];
      }
      return out;
    });
    if (count) this.assignTo(target, result);
    return count;
  }

  format(args: Expr[]): string {
    const fmt = this.str(this.eval(args[0]));
    const vals = args.slice(1).map((x) => {
      const v = this.eval(x);
      if (typeof v === "number") return v;
      if (v === UNINIT) return "";
      return v instanceof StrNum ? v.s : v;
    });
    return formatOnce(fmt, vals, 0, { awk: true }).text;
  }

  /* ---------- output ---------- */

  emit(text: string, redir: { op: string; target: Expr } | undefined): void {
    if (!redir) {
      this.out += text;
      if (this.out.length > 65536) this.flush();
      return;
    }
    const target = this.str(this.eval(redir.target));
    if (redir.op === "|") {
      this.pipes.set(target, (this.pipes.get(target) ?? "") + text);
      return;
    }
    if (target === "/dev/stderr") {
      this.flush();
      this.ctx.err(text);
      return;
    }
    if (target === "/dev/stdout" || target === "-") {
      this.out += text;
      return;
    }
    const abs = this.ctx.resolve(target);
    if (!this.files.has(target)) {
      this.files.set(target, { append: true });
      this.ctx.sh.fs.writeFile(abs, text, redir.op === ">>");
      return;
    }
    this.ctx.sh.fs.writeFile(abs, text, true);
  }

  flush(): void {
    if (this.out) {
      this.ctx.out(this.out);
      this.out = "";
    }
  }

  closeStream(name: string): void {
    const data = this.pipes.get(name);
    if (data !== undefined) {
      this.flush();
      this.pipes.delete(name);
      this.ctx.out(this.runShell(name, data));
    }
    this.files.delete(name);
  }

  closeAll(): void {
    this.flush();
    for (const name of [...this.pipes.keys()]) this.closeStream(name);
  }

  /* ---------- statements ---------- */

  execBlock(body: Stmt[]): void {
    for (const s of body) this.exec(s);
  }

  exec(s: Stmt): void {
    switch (s.k) {
      case "nop":
        return;
      case "expr":
        this.eval(s.e);
        return;
      case "print": {
        const ofs = this.getStr("OFS");
        const ors = this.getStr("ORS");
        const text = s.args.length ? s.args.map((a) => this.str(this.eval(a), "OFMT")).join(ofs) : this.record;
        this.emit(text + ors, s.redir);
        return;
      }
      case "printf":
        if (!s.args.length) throw new AwkError("printf: no format");
        this.emit(this.format(s.args), s.redir);
        return;
      case "if":
        if (this.truthy(this.eval(s.c))) this.exec(s.then);
        else if (s.else) this.exec(s.else);
        return;
      case "while":
        while (this.truthy(this.eval(s.c))) {
          this.ctx.sh.tick();
          try {
            this.exec(s.body);
          } catch (err) {
            if (err instanceof AwkBreak) break;
            if (err instanceof AwkContinue) continue;
            throw err;
          }
        }
        return;
      case "do":
        do {
          this.ctx.sh.tick();
          try {
            this.exec(s.body);
          } catch (err) {
            if (err instanceof AwkBreak) break;
            if (err instanceof AwkContinue) continue;
            throw err;
          }
        } while (this.truthy(this.eval(s.c)));
        return;
      case "for":
        if (s.init) this.exec(s.init);
        while (!s.c || this.truthy(this.eval(s.c))) {
          this.ctx.sh.tick();
          try {
            this.exec(s.body);
          } catch (err) {
            if (err instanceof AwkBreak) break;
            if (!(err instanceof AwkContinue)) throw err;
          }
          if (s.step) this.exec(s.step);
        }
        return;
      case "forin": {
        const arr = this.getArray(s.arr);
        for (const k of [...arr.keys()]) {
          this.ctx.sh.tick();
          if (!arr.has(k)) continue;
          this.setVar(s.v, new StrNum(k));
          try {
            this.exec(s.body);
          } catch (err) {
            if (err instanceof AwkBreak) break;
            if (err instanceof AwkContinue) continue;
            throw err;
          }
        }
        return;
      }
      case "block":
        this.execBlock(s.body);
        return;
      case "next":
        throw new NextSignal();
      case "nextfile":
        throw new NextFileSignal();
      case "exit":
        throw new AwkExit(s.e ? Math.trunc(toNum(this.eval(s.e))) : 0);
      case "return":
        throw new AwkReturn(s.e ? this.eval(s.e) : UNINIT);
      case "break":
        throw new AwkBreak();
      case "continue":
        throw new AwkContinue();
      case "delete": {
        const arr = this.getArray(s.name);
        if (s.subs) arr.delete(this.subKey(s.subs));
        else arr.clear();
        return;
      }
    }
  }

  /* ---------- input ---------- */

  nextRecord(): string | null {
    for (;;) {
      if (!this.currentInput) {
        if (this.inputIndex >= this.inputs.length) return null;
        const inp = this.inputs[this.inputIndex++];
        this.currentInput = inp.stream;
        this.globals.set("FILENAME", inp.name === "-" ? "" : inp.name);
        this.globals.set("FNR", 0);
      }
      const rs = this.getStr("RS");
      const s = this.currentInput;
      if (rs === "\n" || rs.length === 1) {
        const r = s.readUntil(rs || "\n");
        if (r) return r.text;
      } else if (rs === "") {
        // paragraph mode
        while (!s.eof && s.data[s.pos] === "\n") s.pos++;
        if (!s.eof) {
          const rest = s.data.slice(s.pos);
          const m = rest.match(/\n\n+/);
          if (!m) {
            s.pos = s.data.length;
            return rest.replace(/\n$/, "");
          }
          s.pos += m.index! + m[0].length;
          return rest.slice(0, m.index);
        }
      } else {
        if (!s.eof) {
          const rest = s.data.slice(s.pos);
          const m = new RegExp(this.regex(rs).source).exec(rest);
          if (!m) {
            s.pos = s.data.length;
            return rest.replace(/\n$/, "");
          }
          s.pos += m.index + m[0].length;
          return rest.slice(0, m.index);
        }
      }
      this.currentInput = null;
    }
  }
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* command                                                             */
/* ------------------------------------------------------------------ */

export const awk: CommandFn = (ctx) => {
  const args = ctx.args;
  let fs: string | undefined;
  const assigns: [string, string][] = [];
  let program: string | undefined;
  const operands: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (program === undefined && operands.length === 0) {
      if (a === "--") {
        program = args[++i];
        continue;
      }
      if (a.startsWith("-F")) {
        fs = a.length > 2 ? a.slice(2) : args[++i];
        continue;
      }
      if (a === "-v") {
        const kv = args[++i] ?? "";
        const eq = kv.indexOf("=");
        if (eq < 1) {
          ctx.err(`awk: invalid -v argument: ${kv}\n`);
          return 2;
        }
        assigns.push([kv.slice(0, eq), kv.slice(eq + 1)]);
        continue;
      }
      if (a.startsWith("-v") && a.includes("=")) {
        const kv = a.slice(2);
        assigns.push([kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)]);
        continue;
      }
      if (a === "-f") {
        try {
          program = ctx.readInput(args[++i] ?? "");
        } catch {
          ctx.err(`awk: can't open file ${args[i]}\n`);
          return 2;
        }
        continue;
      }
      if (a.startsWith("-") && a.length > 1 && a !== "-") {
        ctx.err(`awk: unknown option ${a}\n`);
        return 2;
      }
      program = a;
      continue;
    }
    operands.push(a);
  }
  if (program === undefined) {
    ctx.err("usage: awk [-F fs][-v var=value][prog | -f progfile][file ...]\n");
    return 2;
  }
  let parsed: { rules: Rule[]; funcs: Map<string, Func> };
  try {
    parsed = new AwkParser(lex(program)).program();
  } catch (err) {
    if (err instanceof AwkError) {
      ctx.err(`awk: ${err.message}\n awk: source line 1 context is ${program.split("\n")[0].slice(0, 60)}\n`);
      return 2;
    }
    throw err;
  }
  const it = new Interp(ctx, parsed.funcs);
  const unescape = (v: string) => v.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\\\/g, "\\");
  if (fs !== undefined) it.globals.set("FS", fs === "t" ? "\t" : unescape(fs));
  for (const [k, v] of assigns) it.globals.set(k, new StrNum(unescape(v)));
  const argv: AwkArray = new Map([["0", "awk"]]);
  operands.forEach((o, i) => argv.set(String(i + 1), new StrNum(o)));
  it.globals.set("ARGV", argv);
  it.globals.set("ARGC", operands.length + 1);

  const begin = parsed.rules.filter((r) => r.kind === "begin");
  const end = parsed.rules.filter((r) => r.kind === "end");
  const main = parsed.rules.filter((r) => r.kind === "main");
  let exitCode = 0;
  let exiting = false;

  const report = (err: unknown): boolean => {
    if (err instanceof AwkError) {
      it.flush();
      ctx.err(`awk: ${err.message}\n`);
      exitCode = 2;
      return true;
    }
    if (err instanceof FsError) {
      it.flush();
      ctx.err(`awk: ${err.path}: ${fsErrorText[err.code]}\n`);
      exitCode = 2;
      return true;
    }
    return false;
  };

  try {
    for (const r of begin) it.execBlock(r.body!);
  } catch (err) {
    if (err instanceof AwkExit) {
      exitCode = err.code;
      exiting = true;
    } else if (report(err)) {
      it.closeAll();
      return exitCode;
    } else throw err;
  }

  if (!exiting && (main.length || end.length)) {
    // build the input list (operands may contain var=value assignments)
    const list = operands.length ? operands : ["-"];
    for (const name of list) {
      if (/^[A-Za-z_]\w*=/.test(name)) {
        it.inputs.push({ name: "\0assign\0" + name, stream: new InStream("") });
        continue;
      }
      try {
        it.inputs.push({ name, stream: new InStream(ctx.readInput(name)) });
      } catch (err) {
        if (err instanceof FsError) {
          it.flush();
          ctx.err(`awk: cannot open "${name}" (${fsErrorText[err.code]})\n`);
          exitCode = 2;
          continue;
        }
        throw err;
      }
    }
    try {
      for (;;) {
        // handle var=value operands as they are reached
        while (!it.currentInput && it.inputIndex < it.inputs.length && it.inputs[it.inputIndex].name.startsWith("\0assign\0")) {
          const kv = it.inputs[it.inputIndex++].name.slice(8);
          const eq = kv.indexOf("=");
          it.globals.set(kv.slice(0, eq), new StrNum(unescape(kv.slice(eq + 1))));
        }
        const rec = it.nextRecord();
        if (rec === null) break;
        it.globals.set("NR", toNum(it.getVar("NR")) + 1);
        it.globals.set("FNR", toNum(it.getVar("FNR")) + 1);
        it.setRecord(rec);
        try {
          for (const r of main) {
            let matched: boolean;
            if (r.range) {
              if (r.inRange) {
                matched = true;
                if (it.truthy(it.eval(r.range))) r.inRange = false;
              } else if (r.pattern && it.truthy(it.eval(r.pattern))) {
                matched = true;
                r.inRange = !it.truthy(it.eval(r.range));
              } else matched = false;
            } else matched = !r.pattern || it.truthy(it.eval(r.pattern));
            if (!matched) continue;
            if (r.body) it.execBlock(r.body);
            else it.emit(it.record + it.getStr("ORS"), undefined);
          }
        } catch (err) {
          if (err instanceof NextSignal) continue;
          if (err instanceof NextFileSignal) {
            it.currentInput = null;
            continue;
          }
          throw err;
        }
      }
    } catch (err) {
      if (err instanceof AwkExit) exitCode = err.code;
      else if (report(err)) {
        it.closeAll();
        return exitCode;
      } else throw err;
    }
  }

  try {
    for (const r of end) it.execBlock(r.body!);
  } catch (err) {
    if (err instanceof AwkExit) exitCode = err.code;
    else if (!report(err)) throw err;
  }
  it.closeAll();
  return exitCode;
};
