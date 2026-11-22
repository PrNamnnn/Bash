import type { Assign, CondExpr, Node, ParamExp, Redir, RedirOp, Word, WordPart } from "./ast";

export class ParseError extends Error {
  constructor(
    message: string,
    /** True when the input simply ended too early (used for continuation prompts). */
    public incomplete = false,
    public line = 1,
  ) {
    super(message);
  }
}

const META = new Set([" ", "\t", "\n", ";", "&", "|", "<", ">", "(", ")"]);
const RESERVED_TERMINATORS = new Set(["then", "elif", "else", "fi", "do", "done", "esac", "}"]);
const REDIR_RE = /^(\d+|\{[A-Za-z_][A-Za-z0-9_]*\})?(<<<|<<-|<<|<>|<&|>>|>&|>\||&>>|&>|<|>)/;
/**
 * Recognise `name=`, `name+=`, `name[sub]=` at the start of a word. The subscript may itself
 * contain brackets and quotes (e.g. `map[${keys[i]}]=x`), so brackets are matched with a depth count.
 * Returns [whole prefix, name, "[sub]" or undefined, "+" or ""].
 */
function matchAssign(raw: string): [string, string, string | undefined, string] | null {
  const m = raw.match(/^[A-Za-z_][A-Za-z0-9_]*/);
  if (!m) return null;
  let i = m[0].length;
  let sub: string | undefined;
  if (raw[i] === "[") {
    let depth = 0;
    let sq = false;
    let dq = false;
    let j = i;
    for (; j < raw.length; j++) {
      const c = raw[j];
      if (c === "\\" && !sq) {
        j++;
        continue;
      }
      if (c === "'" && !dq) sq = !sq;
      else if (c === '"' && !sq) dq = !dq;
      else if (!sq && !dq) {
        if (c === "[") depth++;
        else if (c === "]" && --depth === 0) break;
      }
    }
    if (j >= raw.length) return null;
    sub = raw.slice(i, j + 1);
    i = j + 1;
  }
  let plus = "";
  if (raw[i] === "+") {
    plus = "+";
    i++;
  }
  if (raw[i] !== "=") return null;
  return [raw.slice(0, i + 1), m[0], sub, plus];
}

const DECL_BUILTINS = new Set(["declare", "typeset", "local", "readonly", "export"]);

const CONTROL_OPS = [";;&", ";;", ";&", "&&", "||", "|&", ";", "&", "|", "(", ")", "\n"];

type WordMode = "normal" | "string" | "heredoc" | "cond-regex";

interface PendingHeredoc {
  redir: Redir;
  delim: string;
  strip: boolean;
  expand: boolean;
}

export class Parser {
  pos = 0;
  line = 1;
  private pending: PendingHeredoc[] = [];
  private depth = 0;

  constructor(
    private src: string,
    private opts: { interactive?: boolean; baseLine?: number } = {},
  ) {
    this.line = opts.baseLine ?? 1;
  }

  /* ------------------------------------------------------------ */
  /* character helpers                                             */
  /* ------------------------------------------------------------ */

  private get ch(): string {
    return this.src[this.pos] ?? "";
  }

  private peek(n = 1): string {
    return this.src[this.pos + n] ?? "";
  }

  private atEnd(): boolean {
    return this.pos >= this.src.length;
  }

  private fail(msg: string, incomplete = false): never {
    throw new ParseError(msg, incomplete, this.line);
  }

  private unexpected(): never {
    if (this.atEnd()) this.fail("syntax error: unexpected end of file", true);
    const tok = this.peekOp() ?? this.peekRawWord() ?? this.ch;
    this.fail(`syntax error near unexpected token \`${tok === "\n" ? "newline" : tok}'`);
  }

  /** Skip spaces, tabs, line continuations and comments (not newlines). */
  private skipBlanks(): void {
    for (;;) {
      const c = this.ch;
      if (c === " " || c === "\t" || c === "\r") {
        this.pos++;
      } else if (c === "\\" && this.peek() === "\n") {
        this.pos += 2;
        this.line++;
      } else if (c === "#") {
        while (!this.atEnd() && this.ch !== "\n") this.pos++;
      } else break;
    }
  }

  private consumeNewline(): void {
    if (this.ch !== "\n") return;
    this.pos++;
    this.line++;
    if (this.pending.length) this.readHeredocBodies();
  }

  private skipNewlines(): void {
    for (;;) {
      this.skipBlanks();
      if (this.ch === "\n") this.consumeNewline();
      else break;
    }
  }

  private peekOp(): string | undefined {
    for (const op of CONTROL_OPS) {
      if (this.src.startsWith(op, this.pos)) {
        // "&>" is a redirection, not a background operator
        if (op === "&" && this.peek() === ">") return undefined;
        return op;
      }
    }
    return undefined;
  }

  private peekRawWord(): string | undefined {
    const m = this.src.slice(this.pos).match(/^[^\s;&|<>()]+/);
    return m?.[0];
  }

  /** Reserved word at the current position (only meaningful in command position). */
  private peekReserved(): string | undefined {
    const m = this.src
      .slice(this.pos)
      .match(/^(if|then|elif|else|fi|for|in|do|done|while|until|case|esac|function|select|time|coproc|\{|\}|!|\[\[)(?=[\s;&|()<>]|$)/);
    return m?.[1];
  }

  private expectReserved(word: string): void {
    this.skipNewlines();
    if (this.peekReserved() !== word) {
      if (this.atEnd()) this.fail(`syntax error: unexpected end of file (expected \`${word}')`, true);
      this.unexpected();
    }
    this.pos += word.length;
  }

  /* ------------------------------------------------------------ */
  /* grammar                                                       */
  /* ------------------------------------------------------------ */

  parseProgram(): Node {
    const list = this.parseList(true);
    this.skipNewlines();
    if (!this.atEnd()) this.unexpected();
    if (this.pending.length) {
      if (this.opts.interactive) this.fail("here-document not terminated", true);
    }
    return list;
  }

  private isListTerminator(): boolean {
    const r = this.peekReserved();
    if (r && RESERVED_TERMINATORS.has(r)) return true;
    const op = this.peekOp();
    return op === ")" || op === ";;" || op === ";&" || op === ";;&";
  }

  private parseList(top = false): Node {
    const items: { node: Node; bg: boolean }[] = [];
    for (;;) {
      this.skipNewlines();
      if (this.atEnd() || this.isListTerminator()) break;
      const node = this.parseAndOr();
      this.skipBlanks();
      const op = this.peekOp();
      if (op === ";") {
        this.pos++;
        items.push({ node, bg: false });
      } else if (op === "&") {
        this.pos++;
        items.push({ node, bg: true });
      } else if (op === "\n") {
        this.consumeNewline();
        items.push({ node, bg: false });
      } else {
        items.push({ node, bg: false });
        if (this.atEnd() || this.isListTerminator()) break;
        this.unexpected();
      }
    }
    if (!items.length && !top) {
      if (this.atEnd()) this.fail("syntax error: unexpected end of file", true);
      this.unexpected();
    }
    return { k: "list", items };
  }

  private parseAndOr(): Node {
    const first = this.parsePipeline();
    const rest: { op: "&&" | "||"; node: Node }[] = [];
    for (;;) {
      this.skipBlanks();
      const op = this.peekOp();
      if (op !== "&&" && op !== "||") break;
      this.pos += 2;
      this.skipNewlines();
      if (this.atEnd()) this.fail("syntax error: unexpected end of file", true);
      rest.push({ op, node: this.parsePipeline() });
    }
    return rest.length ? { k: "andor", first, rest } : first;
  }

  private parsePipeline(): Node {
    this.skipBlanks();
    let negate = false;
    let time = false;
    if (this.peekReserved() === "time") {
      this.pos += 4;
      time = true;
      this.skipBlanks();
    }
    if (this.peekReserved() === "!") {
      this.pos += 1;
      negate = true;
      this.skipBlanks();
    }
    const cmds: Node[] = [this.parseCommand()];
    const pipeErr: boolean[] = [];
    for (;;) {
      this.skipBlanks();
      const op = this.peekOp();
      if (op !== "|" && op !== "|&") break;
      this.pos += op.length;
      pipeErr.push(op === "|&");
      this.skipNewlines();
      if (this.atEnd()) this.fail("syntax error: unexpected end of file", true);
      cmds.push(this.parseCommand());
    }
    if (cmds.length === 1 && !negate && !time) return cmds[0];
    return { k: "pipeline", cmds, negate, time, pipeErr };
  }

  private parseCommand(): Node {
    this.skipBlanks();
    if (++this.depth > 200) this.fail("expression nested too deeply");
    try {
      const r = this.peekReserved();
      switch (r) {
        case "if":
          return this.withRedirs(this.parseIf());
        case "for":
          return this.withRedirs(this.parseFor());
        case "while":
        case "until":
          return this.withRedirs(this.parseWhile(r === "until"));
        case "case":
          return this.withRedirs(this.parseCase());
        case "{":
          return this.withRedirs(this.parseGroup());
        case "[[":
          return this.withRedirs(this.parseCondCommand());
        case "function":
          return this.parseFunctionKeyword();
        case "select": {
          const node = this.parseFor(6);
          if (node.k === "for") node.select = true;
          return this.withRedirs(node);
        }
        case "coproc":
          this.fail("coproc is not supported in this simulator (it is explained in Level 9)");
          break;
        case "then":
        case "elif":
        case "else":
        case "fi":
        case "do":
        case "done":
        case "esac":
        case "}":
        case "in":
          this.fail(`syntax error near unexpected token \`${r}'`);
      }
      if (this.src.startsWith("((", this.pos)) {
        const line = this.line;
        this.pos += 2;
        const expr = this.readArithBody();
        return this.withRedirs({ k: "arith", src: expr, redirs: [], line });
      }
      if (this.ch === "(") {
        this.pos++;
        const body = this.parseList();
        this.skipNewlines();
        if ((this.ch as string) !== ")") {
          if (this.atEnd()) this.fail("syntax error: unexpected end of file", true);
          this.unexpected();
        }
        this.pos++;
        return this.withRedirs({ k: "subshell", body, redirs: [] });
      }
      return this.parseSimple();
    } finally {
      this.depth--;
    }
  }

  private withRedirs(node: Node): Node {
    const target = node as Node & { redirs: Redir[] };
    for (;;) {
      this.skipBlanks();
      const r = this.tryRedir();
      if (!r) break;
      target.redirs.push(r);
    }
    return node;
  }

  private parseIf(): Node {
    this.pos += 2; // if
    const clauses: { cond: Node; body: Node }[] = [];
    const cond = this.parseList();
    this.expectReserved("then");
    const body = this.parseList();
    clauses.push({ cond, body });
    let elseBody: Node | undefined;
    for (;;) {
      this.skipNewlines();
      const r = this.peekReserved();
      if (r === "elif") {
        this.pos += 4;
        const c = this.parseList();
        this.expectReserved("then");
        clauses.push({ cond: c, body: this.parseList() });
      } else if (r === "else") {
        this.pos += 4;
        elseBody = this.parseList();
      } else if (r === "fi") {
        this.pos += 2;
        break;
      } else {
        if (this.atEnd()) this.fail("syntax error: unexpected end of file (expected `fi')", true);
        this.unexpected();
      }
    }
    return { k: "if", clauses, else: elseBody, redirs: [] };
  }

  private parseFor(keywordLength = 3): Node {
    this.pos += keywordLength;
    this.skipBlanks();
    if (keywordLength === 3 && this.src.startsWith("((", this.pos)) {
      this.pos += 2;
      const body = this.readArithBody();
      const parts = splitTopLevel(body, ";");
      if (parts.length !== 3) this.fail("syntax error: `((...))' in for needs three expressions");
      this.skipBlanks();
      if (this.ch === ";") this.pos++;
      this.skipNewlines();
      const loopBody = this.parseDoGroup();
      return { k: "cfor", init: parts[0].trim(), cond: parts[1].trim(), step: parts[2].trim(), body: loopBody, redirs: [] };
    }
    const name = this.peekRawWord();
    if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      if (this.atEnd()) this.fail("syntax error: unexpected end of file", true);
      this.fail(`\`${name ?? this.ch}': not a valid identifier`);
    }
    this.pos += name.length;
    this.skipBlanks();
    let words: Word[] | null = null;
    // allow newline before `in` / `do`
    const save = this.pos;
    const saveLine = this.line;
    this.skipNewlines();
    if (this.peekReserved() === "in") {
      this.pos += 2;
      words = [];
      for (;;) {
        this.skipBlanks();
        const op = this.peekOp();
        if (op === ";" || op === "\n") {
          if (op === ";") this.pos++;
          else this.consumeNewline();
          break;
        }
        if (this.atEnd()) this.fail("syntax error: unexpected end of file", true);
        if (op) this.unexpected();
        const w = this.readWord("normal");
        if (!w) this.unexpected();
        words.push(w);
      }
    } else {
      this.pos = save;
      this.line = saveLine;
      this.skipBlanks();
      if (this.ch === ";") this.pos++;
    }
    this.skipNewlines();
    const body = this.parseDoGroup();
    return { k: "for", name, words, body, redirs: [] };
  }

  private parseDoGroup(): Node {
    this.expectReserved("do");
    const body = this.parseList();
    this.expectReserved("done");
    return body;
  }

  private parseWhile(until: boolean): Node {
    this.pos += until ? 5 : 5;
    const cond = this.parseList();
    const body = this.parseDoGroup();
    return { k: "while", until, cond, body, redirs: [] };
  }

  private parseCase(): Node {
    this.pos += 4;
    this.skipBlanks();
    const word = this.readWord("normal");
    if (!word) {
      if (this.atEnd()) this.fail("syntax error: unexpected end of file", true);
      this.unexpected();
    }
    this.expectReserved("in");
    const items: { patterns: Word[]; body: Node | null; term: ";;" | ";&" | ";;&" }[] = [];
    for (;;) {
      this.skipNewlines();
      if (this.peekReserved() === "esac") {
        this.pos += 4;
        break;
      }
      if (this.atEnd()) this.fail("syntax error: unexpected end of file (expected `esac')", true);
      if (this.ch === "(") this.pos++;
      const patterns: Word[] = [];
      for (;;) {
        this.skipBlanks();
        const w = this.readWord("normal");
        if (!w) this.unexpected();
        patterns.push(w);
        this.skipBlanks();
        if (this.ch === "|") {
          this.pos++;
          continue;
        }
        if (this.ch === ")") {
          this.pos++;
          break;
        }
        if (this.atEnd()) this.fail("syntax error: unexpected end of file", true);
        this.unexpected();
      }
      this.skipNewlines();
      let body: Node | null = null;
      const op0 = this.peekOp();
      if (!(op0 === ";;" || op0 === ";&" || op0 === ";;&") && this.peekReserved() !== "esac") {
        body = this.parseList();
      }
      this.skipNewlines();
      const op = this.peekOp();
      let term: ";;" | ";&" | ";;&" = ";;";
      if (op === ";;" || op === ";&" || op === ";;&") {
        term = op;
        this.pos += op.length;
      } else if (this.peekReserved() !== "esac") {
        if (this.atEnd()) this.fail("syntax error: unexpected end of file (expected `esac')", true);
        this.unexpected();
      }
      items.push({ patterns, body, term });
    }
    return { k: "case", word, items, redirs: [] };
  }

  private parseGroup(): Node {
    this.pos += 1;
    const body = this.parseList();
    this.expectReserved("}");
    return { k: "group", body, redirs: [] };
  }

  private parseFunctionKeyword(): Node {
    const start = this.pos;
    this.pos += 8;
    this.skipBlanks();
    const name = this.peekRawWord();
    if (!name) this.fail("syntax error: function name expected", this.atEnd());
    this.pos += name.length;
    this.skipBlanks();
    if (this.ch === "(") {
      this.pos++;
      this.skipBlanks();
      if ((this.ch as string) !== ")") this.unexpected();
      this.pos++;
    }
    return this.parseFunctionBody(name, start);
  }

  private parseFunctionBody(name: string, start: number): Node {
    this.skipNewlines();
    if (this.atEnd()) this.fail("syntax error: unexpected end of file", true);
    const bodyStart = this.pos;
    const body = this.parseCommand();
    if (body.k === "simple") this.fail(`syntax error near unexpected token \`${body.words[0]?.raw ?? ""}'`);
    const src = `${name} () \n${this.src.slice(bodyStart, this.pos).trim()}`;
    void start;
    return { k: "func", name, body, src };
  }

  /* ---------- [[ ]] ---------- */

  private parseCondCommand(): Node {
    const line = this.line;
    this.pos += 2;
    const expr = this.parseCondOr();
    this.skipCondBlanks();
    if (!this.src.startsWith("]]", this.pos)) {
      if (this.atEnd()) this.fail("syntax error: unexpected end of file (expected `]]')", true);
      this.fail(`syntax error in conditional expression near \`${this.peekRawWord() ?? this.ch}'`);
    }
    this.pos += 2;
    return { k: "cond", expr, redirs: [], line };
  }

  private skipCondBlanks(): void {
    for (;;) {
      this.skipBlanks();
      if (this.ch === "\n") this.consumeNewline();
      else break;
    }
  }

  private parseCondOr(): CondExpr {
    let l = this.parseCondAnd();
    for (;;) {
      this.skipCondBlanks();
      if (!this.src.startsWith("||", this.pos)) break;
      this.pos += 2;
      l = { t: "or", l, r: this.parseCondAnd() };
    }
    return l;
  }

  private parseCondAnd(): CondExpr {
    let l = this.parseCondNot();
    for (;;) {
      this.skipCondBlanks();
      if (!this.src.startsWith("&&", this.pos)) break;
      this.pos += 2;
      l = { t: "and", l, r: this.parseCondNot() };
    }
    return l;
  }

  private parseCondNot(): CondExpr {
    this.skipCondBlanks();
    if (this.ch === "!" && /[\s(]/.test(this.peek())) {
      this.pos++;
      return { t: "not", e: this.parseCondNot() };
    }
    return this.parseCondPrimary();
  }

  private readCondWord(): Word {
    this.skipCondBlanks();
    if (this.atEnd()) this.fail("syntax error: unexpected end of file (expected `]]')", true);
    if ((this.ch === "<" || this.ch === ">") && this.peek() !== "(") {
      const v = this.ch;
      this.pos++;
      return { parts: [{ t: "lit", v, q: 0 }], raw: v };
    }
    const w = this.readWord("normal");
    if (!w) this.fail(`syntax error in conditional expression near \`${this.ch}'`);
    return w;
  }

  private parseCondPrimary(): CondExpr {
    this.skipCondBlanks();
    if (this.ch === "(") {
      this.pos++;
      const e = this.parseCondOr();
      this.skipCondBlanks();
      if ((this.ch as string) !== ")") this.fail("syntax error in conditional expression: expected `)'", this.atEnd());
      this.pos++;
      return e;
    }
    const first = this.readCondWord();
    const firstLit = literalOf(first);
    if (firstLit && /^-[a-zA-Z]$/.test(firstLit) && UNARY_TESTS.has(firstLit)) {
      // unary test, unless what follows is a binary operator (e.g. [[ -f == x ]])
      const save = this.pos;
      this.skipCondBlanks();
      const nextRaw = this.src.slice(this.pos).match(/^\S+/)?.[0] ?? "";
      this.pos = save;
      if (!BINARY_TESTS.has(nextRaw) && !nextRaw.startsWith("]]")) {
        const arg = this.readCondWord();
        return { t: "unary", op: firstLit, arg };
      }
    }
    const save = this.pos;
    const saveLine = this.line;
    this.skipCondBlanks();
    const opMatch = this.src.slice(this.pos).match(/^(==|!=|=~|=|<|>|-eq|-ne|-lt|-le|-gt|-ge|-nt|-ot|-ef)(?=\s)/);
    if (opMatch) {
      this.pos += opMatch[1].length;
      this.skipCondBlanks();
      const r = opMatch[1] === "=~" ? this.readWord("cond-regex") : this.readCondWord();
      if (!r) this.fail("syntax error: missing right-hand side of conditional operator", this.atEnd());
      return { t: "binary", op: opMatch[1] === "=" ? "==" : opMatch[1], l: first, r };
    }
    this.pos = save;
    this.line = saveLine;
    return { t: "word", w: first };
  }

  /* ---------- simple commands ---------- */

  private parseSimple(): Node {
    const line = this.line;
    const start = this.pos;
    const assigns: Assign[] = [];
    const words: Word[] = [];
    const redirs: Redir[] = [];
    for (;;) {
      this.skipBlanks();
      if (this.atEnd()) break;
      const r = this.tryRedir();
      if (r) {
        redirs.push(r);
        continue;
      }
      if (META.has(this.ch) && !this.isProcSubStart()) break;
      // function definition: name () compound
      if (words.length === 0 && assigns.length === 0) {
        const fm = this.src.slice(this.pos).match(/^([A-Za-z_][\w.:-]*)\s*\(\s*\)/);
        if (fm) {
          const fstart = this.pos;
          this.pos += fm[0].length;
          return this.parseFunctionBody(fm[1], fstart);
        }
      }
      const wordStart = this.pos;
      const w = this.readWord("normal");
      if (!w) break;
      if (words.length === 0) {
        const am = matchAssign(w.raw);
        if (am) {
          const name = am[1];
          const index = am[2] ? am[2].slice(1, -1) : undefined;
          const append = am[3] === "+";
          if (this.ch === "(" && w.raw.endsWith("=")) {
            this.pos++;
            const array: Word[] = [];
            for (;;) {
              this.skipNewlines();
              if ((this.ch as string) === ")") {
                this.pos++;
                break;
              }
              if (this.atEnd()) this.fail("syntax error: unexpected end of file", true);
              const el = this.readWord("normal");
              if (!el) this.unexpected();
              array.push(el);
            }
            assigns.push({ name, index, append, array });
          } else {
            const valueSrc = w.raw.slice(am[0].length);
            const value = valueSrc ? subWord(valueSrc, this.line) : { parts: [], raw: "" };
            assigns.push({ name, index, append, value });
          }
          continue;
        }
      }
      if (words.length > 0 && DECL_BUILTINS.has(literalOf(words[0]) ?? "")) {
        const am = matchAssign(w.raw);
        if (am) {
          w.assignLike = true;
          if (this.ch === "(" && w.raw.endsWith("=") && !am[2]) {
            this.pos++;
            const elements: Word[] = [];
            for (;;) {
              this.skipNewlines();
              if ((this.ch as string) === ")") {
                this.pos++;
                break;
              }
              if (this.atEnd()) this.fail("syntax error: unexpected end of file", true);
              const el = this.readWord("normal");
              if (!el) this.unexpected();
              elements.push(el);
            }
            w.arrayAssign = { name: am[1], append: am[3] === "+", elements };
            w.raw = this.src.slice(wordStart, this.pos);
          }
        }
      }
      words.push(w);
    }
    if (!words.length && !assigns.length && !redirs.length) this.unexpected();
    return { k: "simple", assigns, words, redirs, line, src: this.src.slice(start, this.pos).trim() };
  }

  private isProcSubStart(): boolean {
    return (this.ch === "<" || this.ch === ">") && this.peek() === "(";
  }

  private tryRedir(): Redir | undefined {
    if (this.isProcSubStart()) return undefined;
    const m = this.src.slice(this.pos).match(REDIR_RE);
    if (!m) return undefined;
    const prefix = m[1];
    const op = m[2] as RedirOp;
    this.pos += m[0].length;
    let fd: number | undefined;
    let fdVar: string | undefined;
    if (prefix) {
      if (prefix.startsWith("{")) fdVar = prefix.slice(1, -1);
      else fd = Number(prefix);
    }
    this.skipBlanks();
    if (op === "<<" || op === "<<-") {
      const w = this.readWord("normal");
      if (!w) this.fail("syntax error near unexpected token `newline'", this.atEnd());
      const quoted = w.parts.some((p) => p.t === "lit" && p.q > 0);
      const delim = w.parts.map((p) => (p.t === "lit" ? p.v : "")).join("");
      const redir: Redir = { fd, fdVar, op, target: w };
      this.pending.push({ redir, delim, strip: op === "<<-", expand: !quoted });
      return redir;
    }
    const target = this.readWord("normal");
    if (!target) {
      if (this.atEnd()) this.fail("syntax error near unexpected token `newline'", !this.opts.interactive ? false : false);
      this.unexpected();
    }
    return { fd, fdVar, op, target };
  }

  private readHeredocBodies(): void {
    const pending = this.pending;
    this.pending = [];
    for (const h of pending) {
      const lines: string[] = [];
      let found = false;
      while (!this.atEnd()) {
        const nl = this.src.indexOf("\n", this.pos);
        const end = nl === -1 ? this.src.length : nl;
        let lineText = this.src.slice(this.pos, end);
        this.pos = nl === -1 ? this.src.length : nl + 1;
        this.line++;
        if (h.strip) lineText = lineText.replace(/^\t+/, "");
        if (lineText.replace(/\r$/, "") === h.delim) {
          found = true;
          break;
        }
        lines.push(lineText);
      }
      if (!found && this.opts.interactive) {
        this.fail("here-document not terminated", true);
      }
      const raw = lines.length ? lines.join("\n") + "\n" : "";
      const body = h.expand ? subWord(raw, this.line, "heredoc") : { parts: [{ t: "lit" as const, v: raw, q: 1 as const }], raw };
      h.redir.heredoc = { body, expand: h.expand, raw };
    }
  }

  /* ------------------------------------------------------------ */
  /* words                                                         */
  /* ------------------------------------------------------------ */

  /** Read one word starting at pos. Returns undefined if no word characters. */
  readWord(mode: WordMode): Word | undefined {
    const start = this.pos;
    const parts: WordPart[] = [];
    let lit = "";
    const flush = (q: 0 | 1 | 2 = 0) => {
      if (lit) parts.push({ t: "lit", v: lit, q });
      lit = "";
    };
    let regexParen = 0;

    while (!this.atEnd()) {
      const c = this.ch;
      if (mode === "normal") {
        if (META.has(c)) {
          if ((c === "<" || c === ">") && this.peek() === "(" ) {
            flush();
            const dir = c as "<" | ">";
            this.pos += 2;
            const s0 = this.pos;
            const node = this.parseSubList();
            parts.push({ t: "proc", dir, node, src: this.src.slice(s0, this.pos - 1) });
            continue;
          }
          break;
        }
      } else if (mode === "cond-regex") {
        if (c === "(") regexParen++;
        if (c === ")") {
          if (regexParen === 0) break;
          regexParen--;
        }
        if (c === " " || c === "\t" || c === "\n") break;
        if (regexParen === 0 && (c === "&" || c === ";") ) break;
        if (c === "|" && this.peek() === "|" && regexParen === 0) break;
      }

      if (c === "\\") {
        const n = this.peek();
        if (n === "\n") {
          this.pos += 2;
          this.line++;
          continue;
        }
        if (mode === "heredoc") {
          if (n === "$" || n === "`" || n === "\\") {
            flush();
            parts.push({ t: "lit", v: n, q: 1 });
            this.pos += 2;
          } else {
            lit += "\\";
            this.pos++;
          }
          continue;
        }
        if (this.pos + 1 >= this.src.length) {
          this.pos++;
          lit += "\\";
          continue;
        }
        flush();
        parts.push({ t: "lit", v: n, q: 1 });
        this.pos += 2;
        continue;
      }

      if (c === "'" && mode !== "heredoc") {
        flush();
        const end = this.src.indexOf("'", this.pos + 1);
        if (end === -1) this.fail("unexpected EOF while looking for matching `''", true);
        const v = this.src.slice(this.pos + 1, end);
        this.line += countNewlines(v);
        parts.push({ t: "lit", v, q: 1 });
        this.pos = end + 1;
        continue;
      }

      if (c === '"' && mode !== "heredoc") {
        flush();
        this.pos++;
        this.readDoubleQuoted(parts);
        continue;
      }

      if (c === "$") {
        if (mode !== "heredoc" && this.peek() === "'") {
          flush();
          this.pos += 2;
          parts.push({ t: "lit", v: this.readAnsiC(), q: 1 });
          continue;
        }
        if (mode !== "heredoc" && this.peek() === '"') {
          flush();
          this.pos += 2;
          this.readDoubleQuoted(parts);
          continue;
        }
        const part = this.readDollar(false);
        if (part) {
          flush();
          parts.push(part);
          continue;
        }
        lit += "$";
        this.pos++;
        continue;
      }

      if (c === "`") {
        flush();
        parts.push(this.readBacktick(false));
        continue;
      }

      if (c === "\n") this.line++;
      lit += c;
      this.pos++;
    }
    flush(mode === "heredoc" ? 2 : 0);
    if (this.pos === start) return undefined;
    return { parts, raw: this.src.slice(start, this.pos) };
  }

  private readDoubleQuoted(parts: WordPart[]): void {
    const start = parts.length;
    let lit = "";
    const flush = () => {
      if (lit) parts.push({ t: "lit", v: lit, q: 2 });
      lit = "";
    };
    let closed = false;
    while (!this.atEnd()) {
      const c = this.ch;
      if (c === '"') {
        this.pos++;
        closed = true;
        break;
      }
      if (c === "\\") {
        const n = this.peek();
        if (n === "\n") {
          this.pos += 2;
          this.line++;
          continue;
        }
        if (n === "$" || n === "`" || n === '"' || n === "\\") {
          lit += n;
          this.pos += 2;
          continue;
        }
        lit += "\\";
        this.pos++;
        continue;
      }
      if (c === "$") {
        const part = this.readDollar(true);
        if (part) {
          flush();
          parts.push(part);
          continue;
        }
        lit += "$";
        this.pos++;
        continue;
      }
      if (c === "`") {
        flush();
        parts.push(this.readBacktick(true));
        continue;
      }
      if (c === "\n") this.line++;
      lit += c;
      this.pos++;
    }
    if (!closed) this.fail('unexpected EOF while looking for matching `"\'', true);
    flush();
    // An empty "" still produces a (quoted, empty) word part; "$@" with no arguments must not.
    if (parts.length === start) parts.push({ t: "lit", v: "", q: 2 });
  }

  private readAnsiC(): string {
    let out = "";
    while (!this.atEnd() && this.ch !== "'") {
      const c = this.ch;
      if (c === "\\") {
        const n = this.peek();
        this.pos += 2;
        switch (n) {
          case "n": out += "\n"; break;
          case "t": out += "\t"; break;
          case "r": out += "\r"; break;
          case "a": out += "\x07"; break;
          case "b": out += "\b"; break;
          case "e":
          case "E": out += "\x1b"; break;
          case "v": out += "\v"; break;
          case "f": out += "\f"; break;
          case "\\": out += "\\"; break;
          case "'": out += "'"; break;
          case '"': out += '"'; break;
          case "x": {
            const m = this.src.slice(this.pos).match(/^[0-9a-fA-F]{1,2}/);
            if (m) {
              out += String.fromCharCode(parseInt(m[0], 16));
              this.pos += m[0].length;
            } else out += "\\x";
            break;
          }
          case "0": case "1": case "2": case "3": case "4": case "5": case "6": case "7": {
            const m = this.src.slice(this.pos - 1).match(/^[0-7]{1,3}/);
            const digits = m ? m[0] : n;
            out += String.fromCharCode(parseInt(digits, 8));
            this.pos += digits.length - 1;
            break;
          }
          default: out += "\\" + n;
        }
        continue;
      }
      if (c === "\n") this.line++;
      out += c;
      this.pos++;
    }
    if (this.atEnd()) this.fail("unexpected EOF while looking for matching `''", true);
    this.pos++;
    return out;
  }

  private readBacktick(q: boolean): WordPart {
    this.pos++;
    let inner = "";
    while (!this.atEnd() && this.ch !== "`") {
      if (this.ch === "\\" && ["`", "\\", "$"].includes(this.peek())) {
        inner += this.peek();
        this.pos += 2;
        continue;
      }
      if (this.ch === "\n") this.line++;
      inner += this.ch;
      this.pos++;
    }
    if (this.atEnd()) this.fail("unexpected EOF while looking for matching ``'", true);
    this.pos++;
    const node = new Parser(inner, { baseLine: this.line }).parseProgram();
    return { t: "cmd", node, src: inner, q };
  }

  /** Parse `list )` used by $( ... ) and <( ... ); pos is just after the "(". */
  private parseSubList(): Node {
    const node = this.parseList(true);
    this.skipNewlines();
    if (this.ch !== ")") {
      if (this.atEnd()) this.fail("unexpected EOF while looking for matching `)'", true);
      this.unexpected();
    }
    this.pos++;
    return node;
  }

  private readArithBody(): string {
    let depth = 0;
    const start = this.pos;
    while (!this.atEnd()) {
      const c = this.ch;
      if (c === "(") depth++;
      else if (c === ")") {
        if (depth === 0 && this.peek() === ")") {
          const body = this.src.slice(start, this.pos);
          this.pos += 2;
          return body;
        }
        depth--;
      } else if (c === "\n") this.line++;
      this.pos++;
    }
    this.fail("unexpected EOF while looking for matching `))'", true);
  }

  private readDollar(q: boolean): WordPart | undefined {
    const n = this.peek();
    if (n === "(" && this.peek(2) === "(") {
      // $(( arithmetic )) — but "$( (" with a space is a subshell
      this.pos += 3;
      return { t: "arith", src: this.readArithBody(), q };
    }
    if (n === "(") {
      this.pos += 2;
      const s0 = this.pos;
      const node = this.parseSubList();
      return { t: "cmd", node, src: this.src.slice(s0, this.pos - 1), q };
    }
    if (n === "{") {
      this.pos += 2;
      const inner = this.readBraceBody();
      return { t: "param", p: parseParamBody(inner, q, this.line), q };
    }
    if (/[A-Za-z_]/.test(n)) {
      const m = this.src.slice(this.pos + 1).match(/^[A-Za-z_][A-Za-z0-9_]*/)!;
      this.pos += 1 + m[0].length;
      return { t: "param", p: { name: m[0] }, q };
    }
    if (/[0-9@*#?$!-]/.test(n) && n !== "") {
      this.pos += 2;
      return { t: "param", p: { name: n }, q };
    }
    return undefined;
  }

  private readBraceBody(): string {
    const start = this.pos;
    let depth = 0;
    let sq = false;
    let dq = false;
    // Quote state of each enclosing ${ … } level: a nested expansion starts a fresh quoting context.
    const dqStack: boolean[] = [];
    while (!this.atEnd()) {
      const c = this.ch;
      if (c === "\\" && !sq) {
        this.pos += 2;
        continue;
      }
      if (c === "'" && !dq) sq = !sq;
      else if (c === '"' && !sq) dq = !dq;
      else if (!sq) {
        if (c === "$" && this.peek() === "{") {
          depth++;
          dqStack.push(dq);
          dq = false;
          this.pos += 2;
          continue;
        }
        if (c === "$" && this.peek() === "(") {
          this.pos += 2;
          let pd = 1;
          while (!this.atEnd() && pd > 0) {
            if (this.ch === "(") pd++;
            else if (this.ch === ")") pd--;
            this.pos++;
          }
          continue;
        }
        if (c === "}" && !dq) {
          if (depth === 0) {
            const body = this.src.slice(start, this.pos);
            this.pos++;
            return body;
          }
          depth--;
          dq = dqStack.pop() ?? false;
        }
      }
      if (c === "\n") this.line++;
      this.pos++;
    }
    this.fail("unexpected EOF while looking for matching `}'", true);
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const UNARY_TESTS = new Set([
  "-a", "-b", "-c", "-d", "-e", "-f", "-g", "-h", "-k", "-p", "-r", "-s", "-t", "-u", "-w", "-x",
  "-G", "-L", "-N", "-O", "-S", "-z", "-n", "-v", "-o", "-R",
]);
const BINARY_TESTS = new Set(["==", "=", "!=", "=~", "<", ">", "-eq", "-ne", "-lt", "-le", "-gt", "-ge", "-nt", "-ot", "-ef"]);

function countNewlines(s: string): number {
  let n = 0;
  for (const c of s) if (c === "\n") n++;
  return n;
}

export function literalOf(w: Word): string | undefined {
  if (w.parts.every((p) => p.t === "lit")) return w.parts.map((p) => (p as { v: string }).v).join("");
  return undefined;
}

function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of s) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === sep && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** Parse a string as a single word with no word-splitting terminators. */
export function subWord(text: string, line = 1, mode: WordMode = "string"): Word {
  if (!text) return { parts: [], raw: "" };
  const p = new Parser(text, { baseLine: line });
  const w = p.readWord(mode);
  return w ?? { parts: [], raw: text };
}

/** Parse the inside of ${...}. */
function parseParamBody(inner: string, inDq: boolean, line: number): ParamExp {
  const s = inner;
  const NAME = /^([A-Za-z_][A-Za-z0-9_]*|[0-9]+|[@*#?$!-])/;
  const argWord = (text: string): Word => {
    if (inDq) {
      // Inside double quotes, single quotes in the argument are literal — except
      // in $'…' ANSI-C strings, which Bash still decodes (shopt extquote, on by default).
      const escaped = text
        .split(/(\$'(?:[^'\\]|\\.)*')/)
        .map((part, i) => (i % 2 === 1 ? part : part.replace(/'/g, "\\'")))
        .join("");
      return subWord(escaped, line, "string");
    }
    return subWord(text, line, "string");
  };

  // ${#}  ${#name}  ${#arr[@]}
  if (s === "#") return { name: "#" };
  if (s.startsWith("#") && s.length > 1) {
    const m = s.slice(1).match(NAME);
    if (m) {
      let rest = s.slice(1 + m[0].length);
      let index: string | undefined;
      if (rest.startsWith("[")) {
        const close = rest.indexOf("]");
        index = rest.slice(1, close);
        rest = rest.slice(close + 1);
      }
      if (!rest) return { name: m[0], index, length: true };
    }
  }

  // ${!name} ${!arr[@]} ${!prefix*}
  if (s.startsWith("!") && s.length > 1) {
    const m = s.slice(1).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (m) {
      const rest = s.slice(1 + m[0].length);
      if (rest === "*" || rest === "@") return { name: m[0], prefixList: true };
      if (rest === "[@]" || rest === "[*]") return { name: m[0], keys: true, index: rest.slice(1, -1) };
      const inner2 = parseParamBody(m[0] + rest, inDq, line);
      return { ...inner2, indirect: true };
    }
  }

  const m = s.match(NAME);
  if (!m) throw new ParseError(`\${${inner}}: bad substitution`, false, line);
  const name = m[0];
  let rest = s.slice(name.length);
  let index: string | undefined;
  if (rest.startsWith("[")) {
    let depth = 0;
    let close = -1;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "[") depth++;
      if (rest[i] === "]") {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close === -1) throw new ParseError(`\${${inner}}: bad substitution`, false, line);
    index = rest.slice(1, close);
    rest = rest.slice(close + 1);
  }
  if (!rest) return { name, index };

  for (const op of [":-", ":=", ":+", ":?", "-", "=", "+", "?"]) {
    if (rest.startsWith(op)) return { name, index, op, arg: argWord(rest.slice(op.length)) };
  }
  for (const op of ["##", "#", "%%", "%"]) {
    if (rest.startsWith(op)) return { name, index, op, arg: argWord(rest.slice(op.length)) };
  }
  for (const op of ["//", "/#", "/%", "/"]) {
    if (rest.startsWith(op)) {
      const body = rest.slice(op.length);
      const slash = findUnescaped(body, "/");
      const pat = slash === -1 ? body : body.slice(0, slash);
      const rep = slash === -1 ? "" : body.slice(slash + 1);
      return { name, index, op, arg: argWord(pat), arg2: argWord(rep) };
    }
  }
  for (const op of ["^^", "^", ",,", ","]) {
    if (rest.startsWith(op)) return { name, index, op, arg: argWord(rest.slice(op.length)) };
  }
  if (rest.startsWith("@") && rest.length === 2) {
    return { name, index, op: "@", arg: { parts: [{ t: "lit", v: rest[1], q: 1 }], raw: rest[1] } };
  }
  if (rest.startsWith(":")) {
    const body = rest.slice(1);
    const colon = findUnescaped(body, ":");
    const off = colon === -1 ? body : body.slice(0, colon);
    const len = colon === -1 ? undefined : body.slice(colon + 1);
    return {
      name,
      index,
      op: ":",
      arg: { parts: [{ t: "lit", v: off, q: 1 }], raw: off },
      arg2: len !== undefined ? { parts: [{ t: "lit", v: len, q: 1 }], raw: len } : undefined,
    };
  }
  throw new ParseError(`\${${inner}}: bad substitution`, false, line);
}

function findUnescaped(s: string, ch: string): number {
  let sq = false;
  let dq = false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "'" && !dq) sq = !sq;
    else if (c === '"' && !sq) dq = !dq;
    else if (!sq && !dq) {
      if (c === "{") depth++;
      if (c === "}") depth--;
      if (c === ch && depth === 0) return i;
    }
  }
  return -1;
}

export function parse(src: string, opts: { interactive?: boolean } = {}): Node {
  return new Parser(src, opts).parseProgram();
}
