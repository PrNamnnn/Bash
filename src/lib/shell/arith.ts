/**
 * Bash arithmetic evaluation ($(( )), (( )), let, array subscripts).
 * Uses 64-bit signed integers like Bash.
 */

export class ArithError extends Error {}

export interface ArithEnv {
  /** Raw string value of a variable (or array element when index given). */
  get(name: string, index?: bigint | string): string;
  set(name: string, value: bigint, index?: bigint | string): void;
  /** Associative arrays take string subscripts in arithmetic context. */
  isAssoc?(name: string): boolean;
}

type Tok = { t: "num"; v: bigint } | { t: "id"; v: string } | { t: "op"; v: string } | { t: "sub"; v: string };

const OPS = [
  "<<=", ">>=", "**", "++", "--", "<<", ">>", "<=", ">=", "==", "!=", "&&", "||", "+=", "-=", "*=", "/=", "%=", "&=", "^=", "|=",
  "+", "-", "*", "/", "%", "<", ">", "!", "~", "&", "^", "|", "?", ":", "=", "(", ")", ",", "[", "]",
];

const wrap = (v: bigint) => BigInt.asIntN(64, v);

function parseNumber(text: string): bigint {
  const m = text.match(/^(\d+)#([0-9a-zA-Z@_]+)$/);
  if (m) {
    const base = Number(m[1]);
    if (base < 2 || base > 64) throw new ArithError(`invalid arithmetic base (error token is "${text}")`);
    let v = 0n;
    for (const ch of m[2]) {
      let d: number;
      if (/[0-9]/.test(ch)) d = ch.charCodeAt(0) - 48;
      else if (/[a-z]/.test(ch)) d = ch.charCodeAt(0) - 87;
      else if (/[A-Z]/.test(ch)) d = base <= 36 ? ch.charCodeAt(0) - 55 : ch.charCodeAt(0) - 29;
      else if (ch === "@") d = 62;
      else d = 63;
      if (d >= base) throw new ArithError(`value too great for base (error token is "${text}")`);
      v = v * BigInt(base) + BigInt(d);
    }
    return v;
  }
  if (/^0[xX][0-9a-fA-F]+$/.test(text)) return BigInt(text);
  if (/^0[0-7]+$/.test(text)) return BigInt("0o" + text.slice(1));
  if (/^\d+$/.test(text)) return BigInt(text);
  throw new ArithError(`value too great for base (error token is "${text}")`);
}

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = src.slice(i).match(/^(\d+#[0-9a-zA-Z@_]+|0[xX][0-9a-fA-F]+|\d+)/)!;
      if (/[A-Za-z_]/.test(src[i + m[0].length] ?? "") && !m[0].includes("#") && !/^0[xX]/.test(m[0])) {
        const bad = src.slice(i).match(/^\w+/)![0];
        throw new ArithError(`value too great for base (error token is "${bad}")`);
      }
      toks.push({ t: "num", v: parseNumber(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)!;
      toks.push({ t: "id", v: m[0] });
      i += m[0].length;
      // A subscript is kept as raw text: associative arrays use it as a string key,
      // indexed arrays evaluate it as a nested arithmetic expression.
      if (src[i] === "[") {
        let depth = 0;
        let j = i;
        for (; j < src.length; j++) {
          if (src[j] === "[") depth++;
          else if (src[j] === "]" && --depth === 0) break;
        }
        if (j >= src.length) throw new ArithError(`bad array subscript (error token is "${src.slice(i)}")`);
        toks.push({ t: "sub", v: src.slice(i + 1, j) });
        i = j + 1;
      }
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ArithError(`syntax error: operand expected (error token is "${src.slice(i)}")`);
    toks.push({ t: "op", v: op });
    i += op.length;
  }
  return toks;
}

interface LValue {
  name: string;
  index?: bigint | string;
}

class Evaluator {
  private i = 0;
  constructor(
    private toks: Tok[],
    private env: ArithEnv,
    private src: string,
    private depth: number,
    /** When false we are in a short-circuited branch: parse but do not evaluate side effects. */
    private live = true,
  ) {}

  run(): bigint {
    if (!this.toks.length) return 0n;
    const v = this.comma();
    if (this.i < this.toks.length) {
      const rest = this.toks
        .slice(this.i)
        .map((t) => String(t.v))
        .join(" ");
      throw new ArithError(`syntax error in expression (error token is "${rest}")`);
    }
    return v;
  }

  private peek(): Tok | undefined {
    return this.toks[this.i];
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t?.t === "op" && t.v === v;
  }
  private take(v: string): void {
    if (!this.isOp(v)) throw new ArithError(`syntax error: \`${v}' expected (error token is "${this.restText()}")`);
    this.i++;
  }
  private restText(): string {
    return this.toks
      .slice(this.i)
      .map((t) => String(t.v))
      .join(" ");
  }

  private readVar(lv: LValue): bigint {
    const raw = this.env.get(lv.name, lv.index).trim();
    if (raw === "") return 0n;
    if (/^-?\d+$/.test(raw)) return wrap(BigInt(raw));
    if (this.depth > 20) throw new ArithError(`expression recursion level exceeded (error token is "${raw}")`);
    return evalArith(raw, this.env, this.depth + 1);
  }

  private writeVar(lv: LValue, v: bigint): bigint {
    if (this.live) this.env.set(lv.name, v, lv.index);
    return v;
  }

  private comma(): bigint {
    let v = this.assign();
    while (this.isOp(",")) {
      this.i++;
      v = this.assign();
    }
    return v;
  }

  /** Parse `[ ... ]` after a name; associative arrays get the raw text as key. */
  private subscript(name: string): bigint | string {
    const t = this.toks[this.i++] as { t: "sub"; v: string };
    if (this.env.isAssoc?.(name)) return t.v.trim();
    if (!this.live) return 0n;
    return evalArith(t.v, this.env, this.depth + 1);
  }

  private hasSubscript(): boolean {
    return this.peek()?.t === "sub";
  }

  private tryLValue(): LValue | undefined {
    const t = this.peek();
    if (t?.t !== "id") return undefined;
    const save = this.i;
    this.i++;
    let index: bigint | string | undefined;
    if (this.hasSubscript()) index = this.subscript(t.v);
    const n = this.peek();
    const assignOps = ["=", "+=", "-=", "*=", "/=", "%=", "<<=", ">>=", "&=", "^=", "|="];
    if (n?.t === "op" && assignOps.includes(n.v)) return { name: t.v, index };
    this.i = save;
    return undefined;
  }

  private assign(): bigint {
    const lv = this.tryLValue();
    if (lv) {
      const op = (this.peek() as { v: string }).v;
      this.i++;
      const rhs = this.assign();
      if (op === "=") return this.writeVar(lv, rhs);
      const cur = this.live ? this.readVar(lv) : 0n;
      return this.writeVar(lv, this.binary(op.slice(0, -1), cur, rhs));
    }
    return this.ternary();
  }

  private ternary(): bigint {
    const cond = this.logicalOr();
    if (!this.isOp("?")) return cond;
    this.i++;
    const wasLive = this.live;
    this.live = wasLive && cond !== 0n;
    const a = this.assign();
    this.take(":");
    this.live = wasLive && cond === 0n;
    const b = this.assign();
    this.live = wasLive;
    return cond !== 0n ? a : b;
  }

  private logicalOr(): bigint {
    let l = this.logicalAnd();
    while (this.isOp("||")) {
      this.i++;
      const wasLive = this.live;
      if (l !== 0n) this.live = false;
      const r = this.logicalAnd();
      this.live = wasLive;
      l = l !== 0n || r !== 0n ? 1n : 0n;
    }
    return l;
  }

  private logicalAnd(): bigint {
    let l = this.bitOr();
    while (this.isOp("&&")) {
      this.i++;
      const wasLive = this.live;
      if (l === 0n) this.live = false;
      const r = this.bitOr();
      this.live = wasLive;
      l = l !== 0n && r !== 0n ? 1n : 0n;
    }
    return l;
  }

  private level(next: () => bigint, ops: string[]): bigint {
    let l = next();
    for (;;) {
      const t = this.peek();
      if (t?.t !== "op" || !ops.includes(t.v)) return l;
      this.i++;
      const r = next();
      l = this.binary(t.v, l, r);
    }
  }

  private bitOr = (): bigint => this.level(this.bitXor, ["|"]);
  private bitXor = (): bigint => this.level(this.bitAnd, ["^"]);
  private bitAnd = (): bigint => this.level(this.equality, ["&"]);
  private equality = (): bigint => this.level(this.relational, ["==", "!="]);
  private relational = (): bigint => this.level(this.shift, ["<", ">", "<=", ">="]);
  private shift = (): bigint => this.level(this.additive, ["<<", ">>"]);
  private additive = (): bigint => this.level(this.multiplicative, ["+", "-"]);
  private multiplicative = (): bigint => this.level(this.power, ["*", "/", "%"]);

  private power = (): bigint => {
    const base = this.unary();
    if (this.isOp("**")) {
      this.i++;
      const exp = this.power();
      return this.binary("**", base, exp);
    }
    return base;
  };

  private binary(op: string, a: bigint, b: bigint): bigint {
    switch (op) {
      case "+": return wrap(a + b);
      case "-": return wrap(a - b);
      case "*": return wrap(a * b);
      case "/":
      case "%":
        if (b === 0n) {
          if (!this.live) return 0n;
          throw new ArithError(`division by 0 (error token is "${this.restText() || this.src}")`);
        }
        return wrap(op === "/" ? a / b : a % b);
      case "**":
        if (b < 0n) throw new ArithError("exponent less than 0");
        return wrap(a ** b);
      case "<<": return wrap(a << b);
      case ">>": return wrap(a >> b);
      case "<": return a < b ? 1n : 0n;
      case ">": return a > b ? 1n : 0n;
      case "<=": return a <= b ? 1n : 0n;
      case ">=": return a >= b ? 1n : 0n;
      case "==": return a === b ? 1n : 0n;
      case "!=": return a !== b ? 1n : 0n;
      case "&": return a & b;
      case "|": return a | b;
      case "^": return a ^ b;
      default: throw new ArithError(`unknown operator ${op}`);
    }
  }

  private unary(): bigint {
    const t = this.peek();
    if (t?.t === "op") {
      if (t.v === "++" || t.v === "--") {
        this.i++;
        const lv = this.lvalue();
        const v = (this.live ? this.readVar(lv) : 0n) + (t.v === "++" ? 1n : -1n);
        return this.writeVar(lv, wrap(v));
      }
      if (t.v === "-") {
        this.i++;
        return wrap(-this.unary());
      }
      if (t.v === "+") {
        this.i++;
        return this.unary();
      }
      if (t.v === "!") {
        this.i++;
        return this.unary() === 0n ? 1n : 0n;
      }
      if (t.v === "~") {
        this.i++;
        return ~this.unary();
      }
    }
    return this.postfix();
  }

  private lvalue(): LValue {
    const t = this.peek();
    if (t?.t !== "id") throw new ArithError(`syntax error: operand expected (error token is "${this.restText()}")`);
    this.i++;
    let index: bigint | string | undefined;
    if (this.hasSubscript()) index = this.subscript(t.v);
    return { name: t.v, index };
  }

  private postfix(): bigint {
    const t = this.peek();
    if (t?.t === "id") {
      const lv = this.lvalue();
      if (this.isOp("++") || this.isOp("--")) {
        const op = (this.peek() as { v: string }).v;
        this.i++;
        const cur = this.live ? this.readVar(lv) : 0n;
        this.writeVar(lv, wrap(cur + (op === "++" ? 1n : -1n)));
        return cur;
      }
      return this.live ? this.readVar(lv) : 0n;
    }
    return this.primary();
  }

  private primary(): bigint {
    const t = this.peek();
    if (!t) throw new ArithError(`syntax error: operand expected (error token is "${this.src}")`);
    if (t.t === "num") {
      this.i++;
      return t.v;
    }
    if (t.t === "op" && t.v === "(") {
      this.i++;
      const v = this.comma();
      this.take(")");
      return v;
    }
    throw new ArithError(`syntax error: operand expected (error token is "${this.restText()}")`);
  }
}

export function evalArith(src: string, env: ArithEnv, depth = 0): bigint {
  const toks = tokenize(src);
  return new Evaluator(toks, env, src.trim(), depth).run();
}
