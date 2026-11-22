import type { ParamExp, Word, WordPart } from "./ast";
import { ArithError, evalArith } from "./arith";
import { BufferSink, cloneFds, type FdTable } from "./io";
import { escapeGlob, globToRegex, globToRegexSource, hasGlob, unescapeGlob } from "./pattern";
import { compareNames, normalizePath } from "./vfs";
import type { Shell } from "./shell";
import { ExitSignal, ExpansionError, HOME, ReturnSignal, bashQ } from "./signals";

export { ExpansionError };

interface Seg {
  text: string;
  /** Quoted text is never split or globbed. */
  quoted: boolean;
}

interface Field {
  segs: Seg[];
  /** Field must be kept even if empty (contains a quoted part). */
  keep: boolean;
}

interface ExpandOpts {
  split: boolean;
  glob: boolean;
  assignment?: boolean;
  heredoc?: boolean;
}

/* ------------------------------------------------------------------ */
/* brace expansion                                                     */
/* ------------------------------------------------------------------ */

type Item = { c: string } | { p: WordPart };

function toItems(w: Word): Item[] {
  const items: Item[] = [];
  for (const p of w.parts) {
    if (p.t === "lit" && p.q === 0) for (const c of p.v) items.push({ c });
    else items.push({ p });
  }
  return items;
}

function fromItems(items: Item[], raw: string): Word {
  const parts: WordPart[] = [];
  let lit = "";
  for (const it of items) {
    if ("c" in it) lit += it.c;
    else {
      if (lit) parts.push({ t: "lit", v: lit, q: 0 });
      lit = "";
      parts.push(it.p);
    }
  }
  if (lit) parts.push({ t: "lit", v: lit, q: 0 });
  return { parts, raw };
}

function seqValues(inner: string): string[] | null {
  let m = inner.match(/^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    let step = Math.abs(Number(m[3] ?? 1)) || 1;
    const width = /^-?0\d/.test(m[1]) || /^-?0\d/.test(m[2]) ? Math.max(m[1].length, m[2].length) : 0;
    const out: string[] = [];
    if (a > b) step = -step;
    for (let v = a; step > 0 ? v <= b : v >= b; v += step) {
      out.push(width ? (v < 0 ? "-" + String(-v).padStart(width - 1, "0") : String(v).padStart(width, "0")) : String(v));
      if (out.length > 100000) break;
    }
    return out;
  }
  m = inner.match(/^([a-zA-Z])\.\.([a-zA-Z])(?:\.\.(-?\d+))?$/);
  if (m) {
    const a = m[1].charCodeAt(0);
    const b = m[2].charCodeAt(0);
    let step = Math.abs(Number(m[3] ?? 1)) || 1;
    if (a > b) step = -step;
    const out: string[] = [];
    for (let v = a; step > 0 ? v <= b : v >= b; v += step) out.push(String.fromCharCode(v));
    return out;
  }
  return null;
}

function braceExpand(items: Item[], depth = 0): Item[][] {
  if (depth > 20) return [items];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!("c" in it) || it.c !== "{") continue;
    // `${` never reaches here (parsed as a parameter), but `\{` is quoted.
    let d = 0;
    const commas: number[] = [];
    let close = -1;
    for (let j = i; j < items.length; j++) {
      const x = items[j];
      if (!("c" in x)) continue;
      if (x.c === "{") d++;
      else if (x.c === "}") {
        d--;
        if (d === 0) {
          close = j;
          break;
        }
      } else if (x.c === "," && d === 1) commas.push(j);
    }
    if (close === -1) continue;
    const prefix = items.slice(0, i);
    const suffix = items.slice(close + 1);
    if (commas.length) {
      const alts: Item[][] = [];
      let start = i + 1;
      for (const c of [...commas, close]) {
        alts.push(items.slice(start, c));
        start = c + 1;
      }
      return alts.flatMap((alt) => braceExpand([...prefix, ...alt, ...suffix], depth + 1));
    }
    const innerItems = items.slice(i + 1, close);
    if (innerItems.every((x) => "c" in x)) {
      const inner = innerItems.map((x) => (x as { c: string }).c).join("");
      const vals = seqValues(inner);
      if (vals) {
        return vals.flatMap((v) => braceExpand([...prefix, ...[...v].map((c) => ({ c })), ...suffix], depth + 1));
      }
    }
  }
  return [items];
}

function hasBrace(w: Word): boolean {
  return w.parts.some((p) => p.t === "lit" && p.q === 0 && p.v.includes("{") && p.v.includes("}")) ||
    (w.parts.some((p) => p.t === "lit" && p.q === 0 && p.v.includes("{")) && w.parts.some((p) => p.t === "lit" && p.q === 0 && p.v.includes("}")));
}

/* ------------------------------------------------------------------ */
/* parameter expansion                                                 */
/* ------------------------------------------------------------------ */

interface ParamResult {
  values: string[];
  /** True for "$@"-style expansions that produce one word per element. */
  list: boolean;
}

function ifsFirst(sh: Shell): string {
  const ifs = sh.getVar("IFS");
  if (ifs === undefined) return " ";
  return ifs.slice(0, 1);
}

function patternFromWord(sh: Shell, w: Word | undefined, fds: FdTable): string {
  if (!w) return "";
  return expandPattern(sh, w, fds);
}

function removePattern(value: string, pat: string, op: string): string {
  if (!pat) return value;
  const src = globToRegexSource(pat);
  if (op === "#" || op === "##") {
    // prefix: try lengths from shortest/longest
    const re = new RegExp(`^(?:${src})$`);
    if (op === "#") {
      for (let i = 0; i <= value.length; i++) if (re.test(value.slice(0, i))) return value.slice(i);
    } else {
      for (let i = value.length; i >= 0; i--) if (re.test(value.slice(0, i))) return value.slice(i);
    }
    return value;
  }
  const re = new RegExp(`^(?:${src})$`);
  if (op === "%") {
    for (let i = value.length; i >= 0; i--) if (re.test(value.slice(i))) return value.slice(0, i);
  } else {
    for (let i = 0; i <= value.length; i++) if (re.test(value.slice(i))) return value.slice(0, i);
  }
  return value;
}

function replacePattern(sh: Shell, value: string, p: ParamExp, fds: FdTable): string {
  const pat = patternFromWord(sh, p.arg, fds);
  const repSegs = p.arg2 ? expandToSegs(sh, p.arg2, fds) : [];
  const makeRep = (match: string) =>
    repSegs
      .map((s) => (s.quoted || !sh.shopts.patsub_replacement ? s.text : s.text.replace(/\\&/g, "\u0000").replace(/&/g, match).replace(/\u0000/g, "&")))
      .join("");
  if (!pat && p.op !== "/#" && p.op !== "/%") return value;
  const src = globToRegexSource(pat);
  if (p.op === "/#") {
    const re = new RegExp(`^(?:${src})`);
    // longest match at start
    for (let i = value.length; i >= 0; i--) {
      if (new RegExp(`^(?:${src})$`).test(value.slice(0, i))) return makeRep(value.slice(0, i)) + value.slice(i);
    }
    void re;
    return value;
  }
  if (p.op === "/%") {
    for (let i = 0; i <= value.length; i++) {
      if (new RegExp(`^(?:${src})$`).test(value.slice(i))) return value.slice(0, i) + makeRep(value.slice(i));
    }
    return value;
  }
  // greedy longest match at each position, like bash
  const re = new RegExp(`^(?:${src})$`);
  let out = "";
  let i = 0;
  let replaced = false;
  while (i <= value.length) {
    let matched = -1;
    if (!(replaced && p.op === "/")) {
      for (let j = value.length; j > i; j--) {
        if (re.test(value.slice(i, j))) {
          matched = j;
          break;
        }
      }
    }
    if (matched > i) {
      out += makeRep(value.slice(i, matched));
      i = matched;
      replaced = true;
      continue;
    }
    if (i < value.length) out += value[i];
    i++;
  }
  return out;
}

function caseConvert(value: string, op: string): string {
  switch (op) {
    case "^^": return value.toUpperCase();
    case ",,": return value.toLowerCase();
    case "^": return value.charAt(0).toUpperCase() + value.slice(1);
    case ",": return value.charAt(0).toLowerCase() + value.slice(1);
  }
  return value;
}

function getBase(sh: Shell, p: ParamExp, quoted: boolean, fds: FdTable): { values: string[]; list: boolean; set: boolean } {
  const name = p.name;
  // special parameters
  if (name === "@" || name === "*") {
    const vals = [...sh.positional];
    return { values: vals, list: name === "@" || !quoted, set: vals.length > 0 };
  }
  if (name === "#") return { values: [String(sh.positional.length)], list: false, set: true };
  if (name === "?") return { values: [String(sh.status)], list: false, set: true };
  if (name === "$") return { values: [String(sh.pid)], list: false, set: true };
  if (name === "!") return { values: [sh.lastBg], list: false, set: sh.lastBg !== "" };
  if (name === "-") {
    let f = "hB";
    if (sh.opts.errexit) f += "e";
    if (sh.opts.nounset) f += "u";
    if (sh.opts.xtrace) f += "x";
    if (sh.opts.noclobber) f += "C";
    if (sh.opts.noglob) f += "f";
    if (sh.interactive) f = "i" + f;
    return { values: [f], list: false, set: true };
  }
  if (/^\d+$/.test(name)) {
    const n = Number(name);
    if (n === 0) return { values: [sh.arg0], list: false, set: true };
    const v = sh.positional[n - 1];
    return { values: [v ?? ""], list: false, set: v !== undefined };
  }
  if (p.index !== undefined) {
    if (p.index === "@" || p.index === "*") {
      const vals = sh.getArrayValues(name);
      return { values: vals, list: p.index === "@" || !quoted, set: sh.getVarRecord(name) !== undefined };
    }
    const v = sh.getElement(name, p.index, fds);
    return { values: [v ?? ""], list: false, set: v !== undefined };
  }
  const v = sh.getVar(name);
  return { values: [v ?? ""], list: false, set: v !== undefined };
}

function expandParam(sh: Shell, p: ParamExp, quoted: boolean, fds: FdTable): ParamResult {
  // ${!prefix*}
  if (p.prefixList) {
    const names = new Set<string>();
    for (const scope of sh.scopes) for (const k of scope.keys()) if (k.startsWith(p.name)) names.add(k);
    const vals = [...names].sort(compareNames);
    return { values: quoted ? [vals.join(" ")] : vals, list: !quoted };
  }
  // ${!arr[@]}
  if (p.keys) {
    const keys = sh.getArrayKeys(p.name);
    return { values: p.index === "*" && quoted ? [keys.join(ifsFirst(sh))] : keys, list: !(p.index === "*" && quoted) };
  }
  let base: { values: string[]; list: boolean; set: boolean };
  if (p.indirect) {
    const ref = sh.getVar(p.name);
    if (ref === undefined || ref === "") {
      if (sh.opts.nounset) throw new ExpansionError(`${p.name}: unbound variable`, true);
      return { values: [""], list: false };
    }
    const m = ref.match(/^([A-Za-z_]\w*|\d+|[@*#?$!])(?:\[(.*)\])?$/);
    if (!m) throw new ExpansionError(`${ref}: invalid indirect expansion`, false);
    base = getBase(sh, { ...p, name: m[1], index: m[2] ?? p.index, indirect: false }, quoted, fds);
  } else {
    base = getBase(sh, p, quoted, fds);
  }

  if (p.length) {
    if (p.name === "@" || p.name === "*" || p.index === "@" || p.index === "*") {
      return { values: [String(base.values.length)], list: false };
    }
    if (!base.set && sh.opts.nounset) throw new ExpansionError(`${p.name}: unbound variable`, true);
    return { values: [String([...(base.values[0] ?? "")].length)], list: false };
  }

  const op = p.op;
  const isNull = !base.set || (base.values.length === 0 || (base.values.length === 1 && base.values[0] === ""));
  const displayName = p.index !== undefined ? `${p.name}[${p.index}]` : p.name;

  if (!op) {
    if (!base.set && sh.opts.nounset && !(p.name === "@" || p.name === "*")) {
      throw new ExpansionError(`${displayName}: unbound variable`, true);
    }
    return { values: base.values, list: base.list };
  }

  switch (op) {
    case ":-":
    case "-": {
      const useDefault = op === ":-" ? isNull : !base.set;
      if (useDefault) return { values: [expandSingle(sh, p.arg!, fds)], list: false };
      return { values: base.values, list: base.list };
    }
    case ":=":
    case "=": {
      const useDefault = op === ":=" ? isNull : !base.set;
      if (useDefault) {
        if (/^\d+$|^[@*#?$!-]$/.test(p.name)) throw new ExpansionError(`$${p.name}: cannot assign in this way`, false);
        const val = expandSingle(sh, p.arg!, fds);
        sh.setVar(p.name, val, p.index !== undefined ? { index: p.index, io: fds } : {});
        return { values: [val], list: false };
      }
      return { values: base.values, list: base.list };
    }
    case ":+":
    case "+": {
      const useAlt = op === ":+" ? !isNull : base.set;
      if (useAlt) return { values: [expandSingle(sh, p.arg!, fds)], list: false };
      return { values: quoted ? [""] : [], list: false };
    }
    case ":?":
    case "?": {
      const fail = op === ":?" ? isNull : !base.set;
      if (fail) {
        const msg = p.arg && p.arg.parts.length ? expandSingle(sh, p.arg, fds) : op === ":?" ? "parameter null or not set" : "parameter not set";
        throw new ExpansionError(`${displayName}: ${msg}`, true);
      }
      return { values: base.values, list: base.list };
    }
    case "#":
    case "##":
    case "%":
    case "%%": {
      const pat = patternFromWord(sh, p.arg, fds);
      return { values: base.values.map((v) => removePattern(v, pat, op)), list: base.list };
    }
    case "/":
    case "//":
    case "/#":
    case "/%":
      return { values: base.values.map((v) => replacePattern(sh, v, p, fds)), list: base.list };
    case "^":
    case "^^":
    case ",":
    case ",,":
      return { values: base.values.map((v) => caseConvert(v, op)), list: base.list };
    case "@": {
      const t = p.arg ? expandSingle(sh, p.arg, fds) : "";
      const conv = (v: string) => {
        switch (t) {
          case "Q": return bashQ(v).startsWith("$'") ? bashQ(v) : `'${v.replace(/'/g, "'\\''")}'`;
          case "U": return v.toUpperCase();
          case "L": return v.toLowerCase();
          case "u": return v.charAt(0).toUpperCase() + v.slice(1);
          case "E": return v.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\\\/g, "\\");
          case "a": {
            const rec = sh.getVarRecord(p.name);
            if (!rec) return "";
            return (rec.kind === "indexed" ? "a" : rec.kind === "assoc" ? "A" : "") + (rec.integer ? "i" : "") + (rec.readonly ? "r" : "") + (rec.exported ? "x" : "");
          }
          default: return v;
        }
      };
      return { values: base.values.map(conv), list: base.list };
    }
    case ":": {
      const offText = p.arg ? expandSingle(sh, p.arg, fds) : "0";
      const lenText = p.arg2 ? expandSingle(sh, p.arg2, fds) : undefined;
      let off: number;
      let len: number | undefined;
      try {
        off = Number(evalArith(sh.expandArithText(offText || "0", fds), sh.arithEnv()));
        len = lenText !== undefined ? Number(evalArith(sh.expandArithText(lenText || "0", fds), sh.arithEnv())) : undefined;
      } catch (err) {
        if (err instanceof ArithError) throw new ExpansionError(`${offText}: ${err.message}`, false);
        throw err;
      }
      if (base.list || p.name === "@" || p.name === "*" || p.index === "@" || p.index === "*") {
        let arr = base.values;
        if (p.name === "@" || p.name === "*") {
          arr = [sh.arg0, ...arr];
        }
        let start = off < 0 ? arr.length + off : off;
        if (start < 0) start = arr.length;
        const end = len === undefined ? arr.length : len < 0 ? arr.length + len : start + len;
        if (len !== undefined && len < 0 && end < start) throw new ExpansionError(`${len}: substring expression < 0`, false);
        return { values: arr.slice(start, end), list: base.list };
      }
      const v = base.values[0] ?? "";
      const chars = [...v];
      let start = off < 0 ? chars.length + off : off;
      if (start < 0) return { values: [""], list: false };
      if (start > chars.length) start = chars.length;
      let end: number;
      if (len === undefined) end = chars.length;
      else if (len < 0) {
        end = chars.length + len;
        if (end < start) throw new ExpansionError(`${len}: substring expression < 0`, false);
      } else end = start + len;
      return { values: [chars.slice(start, end).join("")], list: false };
    }
  }
  return { values: base.values, list: base.list };
}

/* ------------------------------------------------------------------ */
/* command substitution                                                */
/* ------------------------------------------------------------------ */

function commandSubst(sh: Shell, part: Extract<WordPart, { t: "cmd" }>, fds: FdTable): string {
  const sub = sh.subshell();
  sub.substDepth = sh.substDepth + 1;
  if (!sh.shopts.inherit_errexit) sub.opts.errexit = false;
  const buf = new BufferSink(sh.budget);
  const cfds = cloneFds(fds);
  cfds.set(1, { kind: "out", s: buf });
  let status = 0;
  try {
    status = sub.runExitTrap(cfds, sub.exec(part.node, cfds));
  } catch (err) {
    if (err instanceof ExitSignal || err instanceof ReturnSignal) status = sub.runExitTrap(cfds, err.status);
    else throw err;
  }
  sh.lastSubstStatus = status;
  sh.status = status;
  return buf.text.replace(/\n+$/, "");
}

let procSubCounter = 63;

function processSubst(sh: Shell, part: Extract<WordPart, { t: "proc" }>, fds: FdTable): string {
  const path = `/dev/fd/${procSubCounter}`;
  procSubCounter = procSubCounter <= 40 ? 63 : procSubCounter - 1;
  if (part.dir === "<") {
    const sub = sh.subshell();
    const buf = new BufferSink(sh.budget);
    const cfds = cloneFds(fds);
    cfds.set(1, { kind: "out", s: buf });
    try {
      sub.exec(part.node, cfds);
    } catch (err) {
      if (!(err instanceof ExitSignal)) throw err;
    }
    sh.devfd.set(path, buf.text);
  } else {
    sh.devfd.set(path, "");
    sh.pendingWriters.push({ path, node: part.node });
  }
  return path;
}

/* ------------------------------------------------------------------ */
/* word → fields                                                       */
/* ------------------------------------------------------------------ */

function tildeExpand(w: Word, assignment: boolean): Word {
  const first = w.parts[0];
  if (!first || first.t !== "lit" || first.q !== 0) return w;
  const expandOne = (text: string): string | null => {
    const m = text.match(/^~([^/:]*)/);
    if (!m) return null;
    const user = m[1];
    let home: string | null = null;
    if (user === "") home = HOME;
    else if (user === "learner") home = HOME;
    else if (user === "root") home = "/root";
    if (home === null) return null;
    return home + text.slice(m[0].length);
  };
  const parts = [...w.parts];
  if (first.v.startsWith("~")) {
    const m = first.v.match(/^~([^/:]*)/)!;
    if (m[1] === "" && parts.length > 1 && !first.v.slice(1).length && parts[1].t !== "lit") {
      // "~$x" — bash does not expand a tilde followed directly by an expansion
    }
    const exp = expandOne(first.v.slice(0, m[0].length));
    if (exp !== null) {
      parts.splice(0, 1, { t: "lit", v: exp, q: 1 }, ...(first.v.length > m[0].length ? [{ t: "lit" as const, v: first.v.slice(m[0].length), q: 0 as const }] : []));
    }
  }
  if (assignment) {
    // ~ after ':' in assignments (PATH=~/bin:~/tools)
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.t !== "lit" || p.q !== 0 || !p.v.includes(":~")) continue;
      parts[i] = { ...p, v: p.v.replace(/:~(?=\/|:|$)/g, ":" + HOME) };
    }
  }
  return { ...w, parts };
}

function isIfsWs(c: string, ifs: string): boolean {
  return (c === " " || c === "\t" || c === "\n") && ifs.includes(c);
}

/** Expand a word's parts into fields (before globbing). */
function expandFields(sh: Shell, w: Word, fds: FdTable, o: ExpandOpts): Field[] {
  const ifs = sh.getVar("IFS") ?? " \t\n";
  const fields: Field[] = [];
  let cur: Field = { segs: [], keep: false };
  let curHasText = false;
  const push = () => {
    fields.push(cur);
    cur = { segs: [], keep: false };
    curHasText = false;
  };
  const addQuoted = (text: string) => {
    cur.segs.push({ text, quoted: true });
    cur.keep = true;
    if (text) curHasText = true;
  };
  const addUnquotedLiteral = (text: string) => {
    cur.segs.push({ text, quoted: false });
    if (text) curHasText = true;
  };
  const addSplittable = (text: string) => {
    if (!o.split || ifs === "") {
      cur.segs.push({ text, quoted: false });
      if (text) curHasText = true;
      return;
    }
    let buf = "";
    let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (ifs.includes(c)) {
        if (buf) {
          cur.segs.push({ text: buf, quoted: false });
          curHasText = true;
          buf = "";
        }
        // consume a run: whitespace* [non-ws-delim] whitespace*
        let j = i;
        while (j < text.length && isIfsWs(text[j], ifs)) j++;
        let hardDelim = false;
        if (j < text.length && ifs.includes(text[j]) && !isIfsWs(text[j], ifs)) {
          hardDelim = true;
          j++;
          while (j < text.length && isIfsWs(text[j], ifs)) j++;
        }
        if (curHasText || cur.keep || hardDelim) push();
        if (hardDelim && !curHasText) {
          // field already pushed (possibly empty)
        }
        i = j;
        continue;
      }
      buf += c;
      i++;
    }
    if (buf) {
      cur.segs.push({ text: buf, quoted: false });
      curHasText = true;
    }
  };

  for (const part of w.parts) {
    switch (part.t) {
      case "lit":
        if (part.q === 0 && !o.heredoc) addUnquotedLiteral(part.v);
        else addQuoted(part.v);
        break;
      case "param": {
        const r = expandParam(sh, part.p, part.q, fds);
        if (part.q || o.heredoc) {
          if (r.list && o.split) {
            if (r.values.length === 0) break;
            r.values.forEach((v, idx) => {
              if (idx > 0) push();
              addQuoted(v);
            });
          } else {
            const joined = r.list ? r.values.join(part.p.name === "*" || part.p.index === "*" ? ifsFirst(sh) : " ") : r.values.join(ifsFirst(sh));
            addQuoted(joined);
          }
        } else if (r.list) {
          r.values.forEach((v, idx) => {
            if (idx > 0 && o.split && (curHasText || cur.keep)) push();
            else if (idx > 0 && !o.split) addUnquotedLiteral(" ");
            addSplittable(v);
          });
        } else {
          addSplittable(r.values.join(" "));
        }
        break;
      }
      case "cmd": {
        const text = commandSubst(sh, part, fds);
        if (part.q || o.heredoc) addQuoted(text);
        else addSplittable(text);
        break;
      }
      case "arith": {
        let v: bigint;
        try {
          v = evalArith(sh.expandArithText(part.src, fds), sh.arithEnv());
        } catch (err) {
          if (err instanceof ArithError) throw new ExpansionError(`${part.src.trim()}: ${err.message}`, false);
          throw err;
        }
        if (part.q || o.heredoc) addQuoted(String(v));
        else addSplittable(String(v));
        break;
      }
      case "proc":
        addQuoted(processSubst(sh, part, fds));
        break;
    }
  }
  if (curHasText || cur.keep || cur.segs.some((s) => s.text !== "")) fields.push(cur);
  return fields;
}

function fieldText(f: Field): string {
  return f.segs.map((s) => s.text).join("");
}

function fieldPattern(f: Field): string {
  return f.segs.map((s) => (s.quoted ? escapeGlob(s.text) : s.text)).join("");
}

/* ------------------------------------------------------------------ */
/* pathname expansion                                                  */
/* ------------------------------------------------------------------ */

export function globPaths(sh: Shell, pattern: string): string[] {
  const absolute = pattern.startsWith("/");
  const trailingSlash = pattern.endsWith("/") && pattern.length > 1;
  const segs = pattern.split("/").filter((s, i, arr) => s !== "" || (i === 0 && absolute && false) || (i === arr.length - 1 && false));
  let results: { display: string; abs: string }[] = [{ display: absolute ? "/" : "", abs: absolute ? "/" : sh.cwd }];
  const join = (display: string, name: string) => (display === "" ? name : display.endsWith("/") ? display + name : `${display}/${name}`);
  const absJoin = (abs: string, name: string) => (abs === "/" ? `/${name}` : `${abs}/${name}`);
  const nocase = sh.shopts.nocaseglob;

  for (let si = 0; si < segs.length; si++) {
    const seg = segs[si];
    const last = si === segs.length - 1;
    const next: { display: string; abs: string }[] = [];
    if (!hasGlob(seg)) {
      const name = unescapeGlob(seg);
      for (const r of results) {
        const abs = normalizePath(absJoin(r.abs, name), "/");
        if (sh.fs.exists(abs)) next.push({ display: join(r.display, name), abs });
      }
    } else if (seg === "**" && sh.shopts.globstar) {
      for (const r of results) {
        next.push({ display: r.display, abs: r.abs });
        for (const w of sh.fs.walk(r.abs)) {
          if (w.path === r.abs) continue;
          const rel = w.path.slice(r.abs === "/" ? 1 : r.abs.length + 1);
          if (!sh.shopts.dotglob && rel.split("/").some((p) => p.startsWith("."))) continue;
          if (!last && w.node.type !== "dir") continue;
          next.push({ display: join(r.display, rel), abs: w.path });
        }
      }
    } else {
      const re = globToRegex(seg, { pathname: true, nocase });
      const allowDot = seg.startsWith(".") || seg.startsWith("\\.") || sh.shopts.dotglob;
      for (const r of results) {
        const node = sh.fs.lookup(r.abs);
        if (!node || node.type !== "dir" || !sh.fs.canRead(node)) continue;
        for (const name of [...node.children.keys()].sort(compareNames)) {
          if (name.startsWith(".") && !allowDot) continue;
          if (!re.test(name)) continue;
          const child = node.children.get(name)!;
          if (!last && child.type !== "dir") continue;
          next.push({ display: join(r.display, name), abs: absJoin(r.abs, name) });
        }
      }
    }
    results = next;
    if (!results.length) break;
  }
  let out = results.filter((r) => r.display !== "").map((r) => r.display);
  if (trailingSlash) out = results.filter((r) => sh.fs.isDir(r.abs)).map((r) => r.display + "/");
  return out.sort(compareNames);
}

/* ------------------------------------------------------------------ */
/* public API                                                          */
/* ------------------------------------------------------------------ */

/** Full expansion of command words: brace, tilde, parameter, command, arithmetic, splitting, globbing. */
export function expandWords(sh: Shell, words: Word[], fds: FdTable): string[] {
  const out: string[] = [];
  for (const word of words) {
    const variants = hasBrace(word) ? braceExpand(toItems(word)).map((items) => fromItems(items, word.raw)) : [word];
    for (const v of variants) {
      const w = tildeExpand(v, false);
      for (const f of expandFields(sh, w, fds, { split: true, glob: true })) {
        const pattern = fieldPattern(f);
        const unquotedGlob = f.segs.some((s) => !s.quoted && /[*?[]/.test(s.text));
        if (!sh.opts.noglob && unquotedGlob && hasGlob(pattern)) {
          const matches = globPaths(sh, pattern);
          if (matches.length) {
            out.push(...matches);
            continue;
          }
          if (sh.shopts.failglob) throw new ExpansionError(`no match: ${fieldText(f)}`, false);
          if (sh.shopts.nullglob) continue;
          out.push(fieldText(f));
          continue;
        }
        out.push(fieldText(f));
      }
    }
  }
  return out;
}

/** Expand to a single string with no splitting or globbing (assignments, [[ ]], case, here-strings). */
export function expandSingle(sh: Shell, w: Word, fds: FdTable, o: { assignment?: boolean; heredoc?: boolean } = {}): string {
  const word = o.heredoc ? w : tildeExpand(w, !!o.assignment);
  const fields = expandFields(sh, word, fds, { split: false, glob: false, heredoc: o.heredoc });
  return fields.map(fieldText).join(" ");
}

/** Expand a word into segments (used for replacement strings). */
function expandToSegs(sh: Shell, w: Word, fds: FdTable): Seg[] {
  const fields = expandFields(sh, w, fds, { split: false, glob: false });
  return fields.flatMap((f) => f.segs);
}

/** Expand a word for use as a glob pattern: quoted characters are escaped. */
export function expandPattern(sh: Shell, w: Word, fds: FdTable): string {
  const word = tildeExpand(w, false);
  const fields = expandFields(sh, word, fds, { split: false, glob: false });
  return fields.map(fieldPattern).join(" ");
}
