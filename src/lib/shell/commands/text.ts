import type { CmdCtx, CommandFn } from "../shell";
import { FsError, fsErrorText, compareNames } from "../vfs";
import { compileRegex, escapeRegexLiteral, RegexError, type RegexDialect } from "../pattern";
import { eachInput, joinLines, last, parseOpts, q, splitLines, usageError } from "./util";
import { runCmd } from "./files";

/* ---------------- cat / tac / nl / rev ---------------- */

export const cat: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, { flags: "nbsEATv", long: { number: "n", "number-nonblank": "b", "squeeze-blank": "s", "show-ends": "E", "show-all": "A", "show-tabs": "T" } });
  if (p.error) return usageError(ctx, p.error);
  const f = p.flags;
  let n = 0;
  let prevBlank = false;
  return eachInput(ctx, p.operands, (content, name) => {
    if (ctx.sh.fs.isDir(ctx.resolve(name)) && name !== "-") {
      ctx.err(`cat: ${name}: Is a directory\n`);
      return;
    }
    if (!f.size) {
      ctx.out(content);
      return;
    }
    const lines = content.split("\n");
    const endsNl = content.endsWith("\n");
    if (endsNl) lines.pop();
    let out = "";
    lines.forEach((line, i) => {
      const blank = line === "";
      if (f.has("s") && blank && prevBlank) return;
      prevBlank = blank;
      let l = line;
      if (f.has("T") || f.has("A")) l = l.replace(/\t/g, "^I");
      if (f.has("E") || f.has("A")) l += "$";
      if (f.has("b") ? !blank : f.has("n")) l = `${String(++n).padStart(6)}\t${l}`;
      out += l + (i < lines.length - 1 || endsNl ? "\n" : "");
    });
    ctx.out(out);
  });
};

export const tac: CommandFn = (ctx) =>
  eachInput(ctx, ctx.args.filter((a) => !a.startsWith("-") || a === "-"), (content) => {
    ctx.out(joinLines(splitLines(content).reverse()));
  });

export const rev: CommandFn = (ctx) =>
  eachInput(ctx, ctx.args, (content) => {
    ctx.out(joinLines(splitLines(content).map((l) => [...l].reverse().join(""))));
  });

export const nl: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, { withArg: "bwsvin", long: { "body-numbering=": "b", "number-width=": "w", "number-separator=": "s" } });
  if (p.error) return usageError(ctx, p.error);
  const style = last(p, "b") ?? "t";
  const width = Number(last(p, "w") ?? 6);
  const sep = last(p, "s") ?? "\t";
  let n = Number(last(p, "v") ?? 1);
  const inc = Number(last(p, "i") ?? 1);
  return eachInput(ctx, p.operands, (content) => {
    let out = "";
    for (const line of splitLines(content)) {
      const number = style === "a" || (style === "t" && line.trim() !== "");
      if (number) {
        out += `${String(n).padStart(width)}${sep}${line}\n`;
        n += inc;
      } else out += `${" ".repeat(width + sep.length)}${line}\n`.replace(/\s+\n$/, "\n");
    }
    ctx.out(out);
  });
};

/* ---------------- head / tail ---------------- */

function headTail(ctx: CmdCtx, isHead: boolean): number {
  const args = ctx.args.map((a) => (/^-\d+$/.test(a) ? `-n${a.slice(1)}` : a));
  const p = parseOpts(args, { flags: "qvfF", withArg: "nc", long: { "lines=": "n", "bytes=": "c", quiet: "q", verbose: "v", follow: "f" } });
  if (p.error) return usageError(ctx, p.error);
  const nArg = last(p, "n");
  const cArg = last(p, "c");
  const files = p.operands.length ? p.operands : ["-"];
  const headers = (files.length > 1 && !p.flags.has("q")) || p.flags.has("v");
  if (p.flags.has("f") && !ctx.sh.notices.has("tail-f")) {
    ctx.sh.notices.add("tail-f");
    ctx.err("tail: note: -f (follow) waits forever for new data on a real system; the simulator prints the current end of the file instead.\n");
  }
  let status = 0;
  let first = true;
  for (const file of files) {
    let content: string;
    try {
      if (file !== "-" && ctx.sh.fs.isDir(ctx.resolve(file))) {
        ctx.err(`${ctx.name}: error reading ${q(file)}: Is a directory\n`);
        status = 1;
        continue;
      }
      content = ctx.readInput(file);
    } catch (err) {
      if (err instanceof FsError) {
        ctx.err(`${ctx.name}: cannot open ${q(file)} for reading: ${fsErrorText[err.code]}\n`);
        status = 1;
        continue;
      }
      throw err;
    }
    if (headers) ctx.out(`${first ? "" : "\n"}==> ${file === "-" ? "standard input" : file} <==\n`);
    first = false;
    if (cArg !== undefined) {
      const fromStart = cArg.startsWith("+");
      const n = parseInt(cArg.replace(/^[+-]/, ""), 10);
      if (Number.isNaN(n)) return usageError(ctx, `invalid number of bytes: ${q(cArg)}`);
      if (isHead) ctx.out(cArg.startsWith("-") ? content.slice(0, Math.max(0, content.length - n)) : content.slice(0, n));
      else ctx.out(fromStart ? content.slice(Math.max(0, n - 1)) : content.slice(Math.max(0, content.length - n)));
      continue;
    }
    const spec = nArg ?? "10";
    const n = parseInt(spec.replace(/^[+-]/, ""), 10);
    if (Number.isNaN(n)) return usageError(ctx, `invalid number of lines: ${q(spec)}`);
    const endsNl = content.endsWith("\n");
    const lines = splitLines(content);
    let selected: string[];
    let lastIncluded: boolean;
    if (isHead) {
      selected = spec.startsWith("-") ? lines.slice(0, Math.max(0, lines.length - n)) : lines.slice(0, n);
      lastIncluded = selected.length === lines.length;
    } else {
      selected = spec.startsWith("+") ? lines.slice(Math.max(0, n - 1)) : n === 0 ? [] : lines.slice(-n);
      lastIncluded = selected.length > 0;
    }
    let text = selected.join("\n");
    if (selected.length && (!lastIncluded || endsNl)) text += "\n";
    ctx.out(text);
  }
  return status;
}

export const head: CommandFn = (ctx) => headTail(ctx, true);
export const tail: CommandFn = (ctx) => headTail(ctx, false);

/* ---------------- wc ---------------- */

export const wc: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, { flags: "lwcmL", long: { lines: "l", words: "w", bytes: "c", chars: "m", "max-line-length": "L" } });
  if (p.error) return usageError(ctx, p.error);
  let sel = [...p.flags];
  if (!sel.length) sel = ["l", "w", "c"];
  const order = ["l", "w", "m", "c", "L"].filter((c) => sel.includes(c));
  const rows: { counts: number[]; name?: string }[] = [];
  const totals = order.map(() => 0);
  let status = 0;
  const files = p.operands.length ? p.operands : ["-"];
  for (const file of files) {
    let content: string;
    try {
      if (file !== "-" && ctx.sh.fs.isDir(ctx.resolve(file))) {
        ctx.err(`wc: ${file}: Is a directory\n`);
        rows.push({ counts: order.map(() => 0), name: file });
        status = 1;
        continue;
      }
      content = ctx.readInput(file);
    } catch (err) {
      if (err instanceof FsError) {
        ctx.err(`wc: ${file}: ${fsErrorText[err.code]}\n`);
        status = 1;
        continue;
      }
      throw err;
    }
    const counts = order.map((c) => {
      switch (c) {
        case "l": return (content.match(/\n/g) ?? []).length;
        case "w": return content.split(/\s+/).filter(Boolean).length;
        case "c": return new TextEncoder().encode(content).length;
        case "m": return [...content].length;
        case "L": return Math.max(0, ...content.split("\n").map((l) => l.replace(/\t/g, "        ").length));
      }
      return 0;
    });
    counts.forEach((v, i) => (totals[i] = order[i] === "L" ? Math.max(totals[i], v) : totals[i] + v));
    rows.push({ counts, name: p.operands.length ? file : undefined });
  }
  if (files.length > 1) rows.push({ counts: totals, name: "total" });
  const single = order.length === 1 && rows.length === 1;
  const width = single ? 0 : Math.max(1, ...rows.flatMap((r) => r.counts.map((c) => String(c).length)), !p.operands.length ? 7 : 1);
  for (const r of rows) {
    const nums = r.counts.map((c) => String(c).padStart(width)).join(" ");
    ctx.out(r.name !== undefined ? `${nums} ${r.name}\n` : `${nums}\n`);
  }
  return status;
};

/* ---------------- sort / uniq ---------------- */

interface SortKey {
  start: number;
  startChar: number;
  end?: number;
  endChar?: number;
  opts: string;
}

function parseKey(spec: string): SortKey | null {
  const m = spec.match(/^(\d+)(?:\.(\d+))?([bdfgihnMrRV]*)(?:,(\d+)(?:\.(\d+))?([bdfgihnMrRV]*))?$/);
  if (!m) return null;
  return {
    start: Number(m[1]),
    startChar: m[2] ? Number(m[2]) : 0,
    end: m[4] ? Number(m[4]) : undefined,
    endChar: m[5] ? Number(m[5]) : undefined,
    opts: (m[3] ?? "") + (m[6] ?? ""),
  };
}

function humanValue(s: string): number {
  const m = s.trim().match(/^(-?[\d.]+)\s*([KMGTPE]?)/i);
  if (!m) return 0;
  const mult = { "": 1, K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18 }[m[2].toUpperCase()] ?? 1;
  return Number(m[1]) * mult;
}

function leadingNumber(s: string): number {
  const m = s.trim().match(/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/);
  return m ? Number(m[0]) : 0;
}

function versionCompare(a: string, b: string): number {
  const pa = a.match(/\d+|\D+/g) ?? [];
  const pb = b.match(/\d+|\D+/g) ?? [];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "";
    const y = pb[i] ?? "";
    if (/^\d/.test(x) && /^\d/.test(y)) {
      const d = Number(x) - Number(y);
      if (d) return d;
    } else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export const sort: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, {
    flags: "nrufbhVMdcsRgz",
    withArg: "kto",
    long: { "zero-terminated": "z", "numeric-sort": "n", reverse: "r", unique: "u", "ignore-case": "f", "human-numeric-sort": "h", "version-sort": "V", "key=": "k", "field-separator=": "t", "output=": "o", stable: "s", check: "c", "random-sort": "R", "general-numeric-sort": "g" },
  });
  if (p.error) return usageError(ctx, p.error, 2);
  const f = p.flags;
  const sepRaw = last(p, "t");
  const sep = sepRaw === "\\t" ? "\t" : sepRaw;
  const keys = (p.values.get("k") ?? []).map(parseKey);
  if (keys.some((k) => !k)) return usageError(ctx, `invalid key specification`, 2);
  const zero = f.has("z");
  const term = zero ? "\0" : "\n";
  let all = "";
  const st = eachInput(ctx, p.operands, (c) => {
    all += c && !c.endsWith(term) ? c + term : c;
  });
  if (st) return 2;
  const lines = zero ? all.split("\0").slice(0, -1) : splitLines(all);

  const fieldsOf = (line: string): { text: string; start: number }[] => {
    if (sep !== undefined) {
      const out: { text: string; start: number }[] = [];
      let pos = 0;
      for (const part of line.split(sep)) {
        out.push({ text: part, start: pos });
        pos += part.length + sep.length;
      }
      return out;
    }
    // default: fields begin at the transition from blank to non-blank (leading blanks belong to the field)
    const out: { text: string; start: number }[] = [];
    const re = /\s*\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) out.push({ text: m[0], start: m.index });
    return out;
  };

  const keyText = (line: string, k: SortKey): string => {
    const fields = fieldsOf(line);
    const sf = fields[k.start - 1];
    if (!sf) return "";
    let startPos = sf.start + (k.startChar ? k.startChar - 1 : 0);
    if (k.opts.includes("b") || f.has("b")) {
      while (line[startPos] === " " || line[startPos] === "\t") startPos++;
    }
    let endPos = line.length;
    if (k.end !== undefined) {
      const ef = fields[k.end - 1];
      if (ef) endPos = k.endChar ? ef.start + k.endChar : ef.start + ef.text.length;
    }
    return line.slice(startPos, endPos);
  };

  const compareText = (a: string, b: string, opts: string): number => {
    const has = (c: string) => opts.includes(c);
    let r: number;
    if (has("n")) r = leadingNumber(a) - leadingNumber(b);
    else if (has("g")) r = (Number(a.trim()) || 0) - (Number(b.trim()) || 0);
    else if (has("h")) r = humanValue(a) - humanValue(b);
    else if (has("V")) r = versionCompare(a, b);
    else if (has("M")) {
      const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
      r = months.indexOf(a.trim().slice(0, 3).toUpperCase()) - months.indexOf(b.trim().slice(0, 3).toUpperCase());
    } else {
      let x = a;
      let y = b;
      if (has("f")) {
        x = x.toUpperCase();
        y = y.toUpperCase();
      }
      if (has("d")) {
        x = x.replace(/[^\w\s]/g, "");
        y = y.replace(/[^\w\s]/g, "");
      }
      r = compareNames(x, y);
    }
    return has("r") ? -r : r;
  };

  const globalOpts = [...f].join("");
  const cmp = (a: string, b: string): number => {
    if (keys.length) {
      for (const k of keys as SortKey[]) {
        const o = k.opts.replace(/b/g, "") || globalOpts.replace(/[usc]/g, "");
        const r = compareText(keyText(a, k), keyText(b, k), o);
        if (r) return r;
      }
      if (f.has("s") || f.has("u")) return 0;
      return f.has("r") ? -compareNames(a, b) : compareNames(a, b);
    }
    const r = compareText(a, b, globalOpts);
    if (r || f.has("s") || f.has("u") || f.has("n") || f.has("h") || f.has("f")) {
      if (r) return r;
      if (f.has("u")) return 0;
      return f.has("r") ? -compareNames(a, b) : compareNames(a, b);
    }
    return r;
  };

  if (f.has("c")) {
    for (let i = 1; i < lines.length; i++) {
      if (cmp(lines[i - 1], lines[i]) > 0) {
        ctx.err(`sort: ${p.operands[0] ?? "-"}:${i + 1}: disorder: ${lines[i]}\n`);
        return 1;
      }
    }
    return 0;
  }
  let sorted: string[];
  if (f.has("R")) sorted = [...lines].sort(() => Math.random() - 0.5);
  else sorted = [...lines].sort(cmp);
  if (f.has("u")) sorted = sorted.filter((l, i) => i === 0 || cmp(sorted[i - 1], l) !== 0);
  const out = zero ? sorted.map((l) => l + "\0").join("") : joinLines(sorted);
  const o = last(p, "o");
  if (o) ctx.sh.fs.writeFile(ctx.resolve(o), out);
  else ctx.out(out);
  return 0;
};

export const uniq: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, { flags: "cduiD", withArg: "fsw", long: { count: "c", repeated: "d", unique: "u", "ignore-case": "i", "skip-fields=": "f", "skip-chars=": "s", "check-chars=": "w", "all-repeated": "D" } });
  if (p.error) return usageError(ctx, p.error);
  const f = p.flags;
  const skipF = Number(last(p, "f") ?? 0);
  const skipC = Number(last(p, "s") ?? 0);
  const checkW = last(p, "w") ? Number(last(p, "w")) : undefined;
  const [input, output] = p.operands;
  let content: string;
  try {
    content = ctx.readInput(input ?? "-");
  } catch (err) {
    if (err instanceof FsError) {
      ctx.err(`uniq: ${input}: ${fsErrorText[err.code]}\n`);
      return 1;
    }
    throw err;
  }
  const key = (l: string) => {
    let k = l;
    if (skipF) k = k.replace(new RegExp(`^(\\s*\\S+){${skipF}}`), "");
    if (skipC) k = k.slice(skipC);
    if (checkW !== undefined) k = k.slice(0, checkW);
    return f.has("i") ? k.toLowerCase() : k;
  };
  const groups: { line: string; count: number; all: string[] }[] = [];
  for (const line of splitLines(content)) {
    const g = groups[groups.length - 1];
    if (g && key(g.line) === key(line)) {
      g.count++;
      g.all.push(line);
    } else groups.push({ line, count: 1, all: [line] });
  }
  let out = "";
  for (const g of groups) {
    if (f.has("d") && g.count < 2) continue;
    if (f.has("u") && g.count > 1) continue;
    if (f.has("D")) {
      if (g.count > 1) out += g.all.map((l) => l + "\n").join("");
      continue;
    }
    out += f.has("c") ? `${String(g.count).padStart(7)} ${g.line}\n` : `${g.line}\n`;
  }
  if (output) ctx.sh.fs.writeFile(ctx.resolve(output), out);
  else ctx.out(out);
  return 0;
};

/* ---------------- cut / paste / tr / column ---------------- */

function parseList(spec: string): ((n: number) => boolean) | null {
  const parts = spec.split(",");
  const ranges: [number, number][] = [];
  for (const part of parts) {
    const m = part.match(/^(\d*)(-?)(\d*)$/);
    if (!m || (!m[1] && !m[3])) return null;
    const a = m[1] ? Number(m[1]) : 1;
    const b = m[2] ? (m[3] ? Number(m[3]) : Infinity) : a;
    if (a < 1) return null;
    ranges.push([a, b]);
  }
  return (n) => ranges.some(([a, b]) => n >= a && n <= b);
}

export const cut: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, { flags: "sn", withArg: "dfcb", long: { "delimiter=": "d", "fields=": "f", "characters=": "c", "bytes=": "b", "only-delimited": "s", complement: "--complement", "output-delimiter=": "--od" } });
  if (p.error) return usageError(ctx, p.error);
  const fields = last(p, "f");
  const chars = last(p, "c") ?? last(p, "b");
  if (!fields && !chars) return usageError(ctx, "you must specify a list of bytes, characters, or fields");
  const sel = parseList((fields ?? chars)!);
  if (!sel) return usageError(ctx, `invalid field value ${q((fields ?? chars)!)}`);
  const pick = p.flags.has("--complement") ? (n: number) => !sel(n) : sel;
  const delimRaw = last(p, "d") ?? "\t";
  if (delimRaw.length !== 1) return usageError(ctx, "the delimiter must be a single character");
  const outDelim = last(p, "--od") ?? delimRaw;
  return eachInput(ctx, p.operands, (content) => {
    let out = "";
    for (const line of splitLines(content)) {
      if (chars) {
        out += [...line].filter((_, i) => pick(i + 1)).join("") + "\n";
        continue;
      }
      if (!line.includes(delimRaw)) {
        if (!p.flags.has("s")) out += line + "\n";
        continue;
      }
      out += line.split(delimRaw).filter((_, i) => pick(i + 1)).join(outDelim) + "\n";
    }
    ctx.out(out);
  });
};

export const paste: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, { flags: "s", withArg: "d", long: { serial: "s", "delimiters=": "d" } });
  if (p.error) return usageError(ctx, p.error);
  const delims = (last(p, "d") ?? "\t").replace(/\\t/g, "\t").replace(/\\n/g, "\n").replace(/\\0/g, "");
  const files = p.operands.length ? p.operands : ["-"];
  const contents: string[][] = [];
  let stdinCache: string[] | null = null;
  for (const f of files) {
    try {
      if (f === "-") {
        stdinCache ??= splitLines(ctx.readInput("-"));
        contents.push(stdinCache);
      } else contents.push(splitLines(ctx.readInput(f)));
    } catch (err) {
      if (err instanceof FsError) {
        ctx.err(`paste: ${f}: ${fsErrorText[err.code]}\n`);
        return 1;
      }
      throw err;
    }
  }
  const d = (i: number) => (delims.length ? delims[i % delims.length] : "");
  let out = "";
  if (p.flags.has("s")) {
    for (const lines of contents) out += lines.map((l, i) => (i ? d(i - 1) : "") + l).join("") + "\n";
  } else {
    const rows = Math.max(0, ...contents.map((c) => c.length));
    for (let r = 0; r < rows; r++) out += contents.map((c, i) => (i ? d(i - 1) : "") + (c[r] ?? "")).join("") + "\n";
  }
  ctx.out(out);
  return 0;
};

function expandSet(spec: string): string[] {
  const out: string[] = [];
  const classes: Record<string, string> = {
    lower: "abcdefghijklmnopqrstuvwxyz",
    upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    digit: "0123456789",
    space: " \t\n\r\f\v",
    blank: " \t",
    punct: "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
  };
  classes.alpha = classes.lower + classes.upper;
  classes.alnum = classes.alpha + classes.digit;
  classes.xdigit = "0123456789ABCDEFabcdef";
  let i = 0;
  const s = spec;
  const readChar = (): string => {
    if (s[i] === "\\" && i + 1 < s.length) {
      const n = s[i + 1];
      i += 2;
      const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", f: "\f", v: "\v", "0": "\0" };
      if (/[0-7]/.test(n)) {
        const m = s.slice(i - 1).match(/^[0-7]{1,3}/)!;
        i += m[0].length - 1;
        return String.fromCharCode(parseInt(m[0], 8));
      }
      return map[n] ?? n;
    }
    return s[i++];
  };
  while (i < s.length) {
    const cm = s.slice(i).match(/^\[:(\w+):\]/);
    if (cm && classes[cm[1]]) {
      out.push(...classes[cm[1]]);
      i += cm[0].length;
      continue;
    }
    const rep = s.slice(i).match(/^\[(.)\*(\d*)\]/);
    if (rep) {
      out.push(...rep[1].repeat(Number(rep[2] || 1)));
      i += rep[0].length;
      continue;
    }
    const c = readChar();
    if (s[i] === "-" && i + 1 < s.length) {
      i++;
      const e = readChar();
      for (let x = c.charCodeAt(0); x <= e.charCodeAt(0); x++) out.push(String.fromCharCode(x));
      continue;
    }
    out.push(c);
  }
  return out;
}

export const tr: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, { flags: "dscCt", long: { delete: "d", "squeeze-repeats": "s", complement: "c" } });
  if (p.error) return usageError(ctx, p.error);
  const f = p.flags;
  const [s1, s2] = p.operands;
  if (s1 === undefined) return usageError(ctx, "missing operand");
  if (!f.has("d") && !f.has("s") && s2 === undefined) return usageError(ctx, `missing operand after ${q(s1)}`);
  if (p.operands.length > (f.has("d") && !f.has("s") ? 1 : 2)) {
    return usageError(ctx, `extra operand ${q(p.operands[f.has("d") && !f.has("s") ? 1 : 2])}\nOnly one string may be given when deleting without squeezing repeats.`);
  }
  const set1 = expandSet(s1);
  const complement = f.has("c") || f.has("C");
  const in1 = (c: string) => (complement ? !set1.includes(c) : set1.includes(c));
  const input = ctx.stdin.readAll();
  let out = "";
  if (f.has("d")) {
    for (const c of input) if (!in1(c)) out += c;
    if (f.has("s") && s2 !== undefined) {
      const set2 = expandSet(s2);
      let r = "";
      for (const c of out) if (!(set2.includes(c) && r.endsWith(c))) r += c;
      out = r;
    }
    ctx.out(out);
    return 0;
  }
  if (s2 === undefined) {
    for (const c of input) if (!(in1(c) && out.endsWith(c))) out += c;
    ctx.out(out);
    return 0;
  }
  let set2 = expandSet(s2);
  if (!set2.length) set2 = [""];
  const map = new Map<string, string>();
  if (!complement) set1.forEach((c, i) => map.set(c, set2[Math.min(i, set2.length - 1)]));
  for (const c of input) {
    let x = c;
    if (complement) {
      if (!set1.includes(c)) x = set2[set2.length - 1];
    } else if (map.has(c)) x = map.get(c)!;
    if (f.has("s") && set2.includes(x) && out.endsWith(x) && (complement ? !set1.includes(c) : map.has(c))) continue;
    out += x;
  }
  ctx.out(out);
  return 0;
};

export const column: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, { flags: "tnex", withArg: "soNR", long: { table: "t", "separator=": "s", "output-separator=": "o" } });
  if (p.error) return usageError(ctx, p.error);
  let all = "";
  const st = eachInput(ctx, p.operands, (c) => (all += c));
  const lines = splitLines(all);
  if (!p.flags.has("t")) {
    ctx.out(joinLines(lines));
    return st;
  }
  const sep = last(p, "s");
  const outSep = last(p, "o") ?? "  ";
  const rows = lines.filter((l) => l.trim() !== "").map((l) => (sep ? l.split(new RegExp(`[${escapeRegexLiteral(sep)}]`)) : l.trim().split(/\s+/)));
  const widths: number[] = [];
  for (const r of rows) r.forEach((c, i) => (widths[i] = Math.max(widths[i] ?? 0, c.length)));
  ctx.out(rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]))).join(outSep) + "\n").join(""));
  return st;
};

export const fold: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, { flags: "sb", withArg: "w", long: { "width=": "w", spaces: "s" } });
  if (p.error) return usageError(ctx, p.error);
  const width = Number(last(p, "w") ?? 80);
  return eachInput(ctx, p.operands, (content) => {
    let out = "";
    for (const line of content.split("\n").slice(0, content.endsWith("\n") ? -1 : undefined)) {
      let rest = line;
      while (rest.length > width) {
        let cut = width;
        if (p.flags.has("s")) {
          const sp = rest.lastIndexOf(" ", width - 1);
          if (sp > 0) cut = sp + 1;
        }
        out += rest.slice(0, cut) + "\n";
        rest = rest.slice(cut);
      }
      out += rest + "\n";
    }
    ctx.out(out);
  });
};

/* ---------------- tee / seq / yes ---------------- */

export const tee: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, { flags: "ai", long: { append: "a", "ignore-interrupts": "i" } });
  if (p.error) return usageError(ctx, p.error);
  const input = ctx.stdin.readAll();
  let status = 0;
  for (const f of p.operands) {
    try {
      const sink = ctx.sh.openWrite(f, p.flags.has("a"), ctx.fds, false);
      sink.write(input);
    } catch (err) {
      if (err instanceof FsError) {
        ctx.err(`tee: ${f}: ${fsErrorText[err.code]}\n`);
        status = 1;
      } else throw err;
    }
  }
  ctx.out(input);
  return status;
};

export const seq: CommandFn = (ctx) => {
  const args = [...ctx.args];
  let sep = "\n";
  let equalWidth = false;
  let fmt: string | undefined;
  while (args.length && /^-[swf]/.test(args[0]) && !/^-\d/.test(args[0])) {
    const a = args.shift()!;
    if (a === "-w") equalWidth = true;
    else if (a.startsWith("-s")) sep = a.length > 2 ? a.slice(2) : (args.shift() ?? "");
    else if (a.startsWith("-f")) fmt = a.length > 2 ? a.slice(2) : args.shift();
  }
  sep = sep.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  const nums = args.map(Number);
  if (!nums.length || nums.some((n) => Number.isNaN(n))) return usageError(ctx, args.length ? `invalid floating point argument: ${q(args.find((a) => Number.isNaN(Number(a)))!)}` : "missing operand");
  let [first, inc, lastN] = nums.length === 1 ? [1, 1, nums[0]] : nums.length === 2 ? [nums[0], 1, nums[1]] : nums;
  if (inc === 0) return usageError(ctx, "invalid Zero increment value: '0'");
  const decimals = Math.max(...args.map((a) => (a.includes(".") ? a.split(".")[1].length : 0)));
  const out: string[] = [];
  for (let v = first; inc > 0 ? v <= lastN + 1e-10 : v >= lastN - 1e-10; v = first + inc * out.length) {
    let s = decimals ? v.toFixed(decimals) : String(Math.round(v));
    if (fmt) s = fmt.replace(/%(\.\d+)?[gfde]/, (m) => (m.includes(".") ? v.toFixed(Number(m.match(/\.(\d+)/)![1])) : String(v)));
    out.push(s);
    if (out.length > 200000) break;
    void inc;
  }
  if (equalWidth) {
    const w = Math.max(...out.map((s) => s.length));
    for (let i = 0; i < out.length; i++) out[i] = out[i].startsWith("-") ? "-" + out[i].slice(1).padStart(w - 1, "0") : out[i].padStart(w, "0");
  }
  if (out.length) ctx.out(out.join(sep) + "\n");
  [first, inc, lastN] = [0, 0, 0];
  return 0;
};

export const yes: CommandFn = (ctx) => {
  const text = (ctx.args.length ? ctx.args.join(" ") : "y") + "\n";
  ctx.out(text.repeat(ctx.stdoutIsTTY ? 50 : 5000));
  if (ctx.stdoutIsTTY) ctx.err("yes: stopped after 50 lines (on a real system yes runs until interrupted with Ctrl+C)\n");
  return 0;
};

/* ---------------- diff / cmp / comm ---------------- */

type Edit = { op: "=" | "-" | "+"; a: number; b: number; line: string };

function lcsDiff(a: string[], b: string[]): Edit[] {
  const n = a.length;
  const m = b.length;
  if (n * m > 4_000_000) {
    // fall back to a naive diff for very large inputs
    return [...a.map((line, i) => ({ op: "-" as const, a: i, b: 0, line })), ...b.map((line, j) => ({ op: "+" as const, a: n, b: j, line }))];
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const edits: Edit[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      edits.push({ op: "=", a: i, b: j, line: a[i] });
      i++;
      j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      edits.push({ op: "+", a: i, b: j, line: b[j] });
      j++;
    } else {
      edits.push({ op: "-", a: i, b: j, line: a[i] });
      i++;
    }
  }
  return edits;
}

function range(start: number, count: number): string {
  return count <= 1 ? String(start + (count === 0 ? 0 : 1)) : `${start + 1},${start + count}`;
}

export const diff: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, { flags: "uqiwyBsr", withArg: "U", long: { unified: "u", brief: "q", "ignore-case": "i", "ignore-all-space": "w", "side-by-side": "y", "report-identical-files": "s", recursive: "r", color: "--color" } });
  if (p.error) return usageError(ctx, p.error, 2);
  const [fa, fb] = p.operands;
  if (fa === undefined || fb === undefined) return usageError(ctx, `missing operand after ${q(fa ?? "diff")}`, 2);
  const fsys = ctx.sh.fs;
  const da = fsys.lookup(ctx.resolve(fa));
  const db = fsys.lookup(ctx.resolve(fb));
  if (da?.type === "dir" && db?.type === "dir") {
    if (!p.flags.has("r") && !p.flags.has("q")) {
      ctx.err("bash-sim: diff: comparing directories needs -r (and the simulator reports them in brief form, like -q)\n");
    }
    // Recursive comparison, reported in brief (-q) form.
    let differ = false;
    const walk = (a: string, b: string, recurse: boolean): void => {
      const names = (d: string) => new Set(fsys.readdir(ctx.resolve(d)).filter((n) => n !== "." && n !== ".."));
      const na = names(a);
      const nb = names(b);
      for (const n of [...new Set([...na, ...nb])].sort()) {
        const pa = `${a.replace(/\/$/, "")}/${n}`;
        const pb = `${b.replace(/\/$/, "")}/${n}`;
        if (!nb.has(n)) { ctx.out(`Only in ${a.replace(/\/$/, "")}: ${n}\n`); differ = true; continue; }
        if (!na.has(n)) { ctx.out(`Only in ${b.replace(/\/$/, "")}: ${n}\n`); differ = true; continue; }
        const xa = fsys.lookup(ctx.resolve(pa))!;
        const xb = fsys.lookup(ctx.resolve(pb))!;
        if (xa.type === "dir" && xb.type === "dir") {
          if (recurse) walk(pa, pb, true);
          else ctx.out(`Common subdirectories: ${pa} and ${pb}\n`);
        } else if (xa.type !== xb.type) {
          ctx.out(`File ${pa} is a ${xa.type === "dir" ? "directory" : "regular file"} while file ${pb} is a ${xb.type === "dir" ? "directory" : "regular file"}\n`);
          differ = true;
        } else if (ctx.readInput(pa) !== ctx.readInput(pb)) {
          ctx.out(`Files ${pa} and ${pb} differ\n`);
          differ = true;
        }
      }
    };
    walk(fa, fb, p.flags.has("r"));
    return differ ? 1 : 0;
  }
  let ta: string;
  let tb: string;
  try {
    ta = ctx.readInput(fa);
    tb = ctx.readInput(fb);
  } catch (err) {
    if (err instanceof FsError) {
      ctx.err(`diff: ${err.path}: ${fsErrorText[err.code]}\n`);
      return 2;
    }
    throw err;
  }
  const norm = (l: string) => {
    let x = l;
    if (p.flags.has("i")) x = x.toLowerCase();
    if (p.flags.has("w")) x = x.replace(/\s+/g, "");
    return x;
  };
  const a = splitLines(ta);
  const b = splitLines(tb);
  const edits = lcsDiff(a.map(norm), b.map(norm)).map((e) => ({ ...e, line: e.op === "+" ? b[e.b] : a[e.a] }));
  const changed = edits.some((e) => e.op !== "=");
  if (!changed) {
    if (p.flags.has("s")) ctx.out(`Files ${fa} and ${fb} are identical\n`);
    return 0;
  }
  if (p.flags.has("q")) {
    ctx.out(`Files ${fa} and ${fb} differ\n`);
    return 1;
  }
  const unified = p.flags.has("u") || p.values.has("U");
  if (unified) {
    const ctxN = Number(last(p, "U") ?? 3);
    const now = new Date().toISOString().replace("T", " ").replace("Z", "");
    let out = `--- ${fa}\t${now}\n+++ ${fb}\t${now}\n`;
    // group edits into hunks
    const idx = edits.map((e, i) => (e.op !== "=" ? i : -1)).filter((i) => i >= 0);
    let h = 0;
    while (h < idx.length) {
      let start = Math.max(0, idx[h] - ctxN);
      let end = Math.min(edits.length - 1, idx[h] + ctxN);
      let k = h + 1;
      while (k < idx.length && idx[k] - ctxN <= end + 1) {
        end = Math.min(edits.length - 1, idx[k] + ctxN);
        k++;
      }
      const hunk = edits.slice(start, end + 1);
      const aStart = hunk.find((e) => e.op !== "+")?.a ?? hunk[0].a;
      const bStart = hunk.find((e) => e.op !== "-")?.b ?? hunk[0].b;
      const aCount = hunk.filter((e) => e.op !== "+").length;
      const bCount = hunk.filter((e) => e.op !== "-").length;
      out += `@@ -${aCount === 0 ? aStart : aStart + 1}${aCount === 1 ? "" : "," + aCount} +${bCount === 0 ? bStart : bStart + 1}${bCount === 1 ? "" : "," + bCount} @@\n`;
      for (const e of hunk) out += (e.op === "=" ? " " : e.op) + e.line + "\n";
      h = k;
      start = 0;
    }
    ctx.out(out);
    return 1;
  }
  // normal format
  let out = "";
  let i = 0;
  while (i < edits.length) {
    if (edits[i].op === "=") {
      i++;
      continue;
    }
    const dels: Edit[] = [];
    const adds: Edit[] = [];
    const startA = edits[i].a;
    const startB = edits[i].b;
    while (i < edits.length && edits[i].op !== "=") {
      if (edits[i].op === "-") dels.push(edits[i]);
      else adds.push(edits[i]);
      i++;
    }
    if (dels.length && adds.length) {
      out += `${range(startA, dels.length)}c${range(startB, adds.length)}\n`;
      out += dels.map((d) => `< ${d.line}\n`).join("") + "---\n" + adds.map((d) => `> ${d.line}\n`).join("");
    } else if (dels.length) {
      out += `${range(startA, dels.length)}d${startB}\n` + dels.map((d) => `< ${d.line}\n`).join("");
    } else {
      out += `${startA}a${range(startB, adds.length)}\n` + adds.map((d) => `> ${d.line}\n`).join("");
    }
  }
  ctx.out(out);
  return 1;
};

export const cmp: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, { flags: "sl", long: { silent: "s", quiet: "s", verbose: "l" } });
  if (p.error) return usageError(ctx, p.error, 2);
  const [fa, fb = "-"] = p.operands;
  if (!fa) return usageError(ctx, "missing operand", 2);
  let a: string;
  let b: string;
  try {
    a = ctx.readInput(fa);
    b = ctx.readInput(fb);
  } catch (err) {
    if (err instanceof FsError) {
      ctx.err(`cmp: ${err.path}: ${fsErrorText[err.code]}\n`);
      return 2;
    }
    throw err;
  }
  let line = 1;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      if (!p.flags.has("s")) ctx.out(`${fa} ${fb} differ: byte ${i + 1}, line ${line}\n`);
      return 1;
    }
    if (a[i] === "\n") line++;
  }
  if (a.length !== b.length) {
    if (!p.flags.has("s")) ctx.err(`cmp: EOF on ${a.length < b.length ? fa : fb} after byte ${Math.min(a.length, b.length)}, line ${line}\n`);
    return 1;
  }
  return 0;
};

export const comm: CommandFn = (ctx) => {
  const args = ctx.args;
  const hide = new Set<string>();
  const files: string[] = [];
  for (const a of args) {
    if (/^-[123]+$/.test(a)) for (const c of a.slice(1)) hide.add(c);
    else files.push(a);
  }
  if (files.length !== 2) return usageError(ctx, "missing operand");
  let a: string[];
  let b: string[];
  try {
    a = splitLines(ctx.readInput(files[0]));
    b = splitLines(ctx.readInput(files[1]));
  } catch (err) {
    if (err instanceof FsError) {
      ctx.err(`comm: ${err.path}: ${fsErrorText[err.code]}\n`);
      return 1;
    }
    throw err;
  }
  let i = 0;
  let j = 0;
  let out = "";
  const col = (n: number, s: string) => {
    if (hide.has(String(n))) return;
    let prefix = "";
    for (let c = 1; c < n; c++) if (!hide.has(String(c))) prefix += "\t";
    out += prefix + s + "\n";
  };
  while (i < a.length || j < b.length) {
    if (j >= b.length || (i < a.length && a[i] < b[j])) col(1, a[i++]);
    else if (i >= a.length || b[j] < a[i]) col(2, b[j++]);
    else {
      col(3, a[i]);
      i++;
      j++;
    }
  }
  ctx.out(out);
  return 0;
};

/* ---------------- xargs ---------------- */

function xargsSplit(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let has = false;
  let quote: string | null = null;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      has = true;
      continue;
    }
    if (c === "\\" && i + 1 < input.length) {
      cur += input[++i];
      has = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (cur || has) out.push(cur);
      cur = "";
      has = false;
      continue;
    }
    cur += c;
  }
  if (cur || has) out.push(cur);
  return out;
}

export const xargs: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, {
    flags: "0rtpx",
    withArg: "nIdPLsa",
    long: { null: "0", "no-run-if-empty": "r", verbose: "t", "max-args=": "n", "replace=": "I", "delimiter=": "d", "max-procs=": "P", "arg-file=": "a" },
    stopAtOperand: true,
  });
  if (p.error) return usageError(ctx, p.error);
  const cmd = p.operands.length ? p.operands : ["echo"];
  const file = last(p, "a");
  let input: string;
  try {
    input = file ? ctx.readInput(file) : ctx.stdin.readAll();
  } catch (err) {
    if (err instanceof FsError) {
      ctx.err(`xargs: ${file}: ${fsErrorText[err.code]}\n`);
      return 1;
    }
    throw err;
  }
  const replace = last(p, "I");
  const delim = last(p, "d");
  let items: string[];
  if (p.flags.has("0")) items = input.split("\0").filter((s, i, arr) => !(i === arr.length - 1 && s === ""));
  else if (delim !== undefined) {
    const d = delim.replace(/\\n/, "\n").replace(/\\t/, "\t");
    items = input.split(d);
    if (items[items.length - 1] === "" || items[items.length - 1] === "\n") items.pop();
  } else if (replace !== undefined || last(p, "L")) items = splitLines(input).map((l) => l.replace(/^\s+/, "")).filter((l) => l !== "");
  else items = xargsSplit(input);
  if (p.values.has("P") && !ctx.sh.notices.has("xargs-P")) {
    ctx.sh.notices.add("xargs-P");
    ctx.err("xargs: note: -P runs commands in parallel on a real system; the simulator runs them one after another.\n");
  }
  if (!items.length && p.flags.has("r")) return 0;
  const run = (argv: string[]) => {
    if (p.flags.has("t")) ctx.err(argv.join(" ") + "\n");
    const st = runCmd(ctx, argv);
    if (st === 127) {
      return 127;
    }
    return st === 0 ? 0 : st === 255 ? 124 : 123;
  };
  let status = 0;
  if (replace !== undefined) {
    for (const it of items) {
      const st = run(cmd.map((a) => a.split(replace).join(it)));
      if (st === 127) return 127;
      if (st) status = st;
    }
    return status;
  }
  const n = last(p, "n") ? Number(last(p, "n")) : last(p, "L") ? Number(last(p, "L")) : Infinity;
  if (!items.length) return run(cmd) === 127 ? 127 : 0;
  for (let i = 0; i < items.length; i += Number.isFinite(n) ? n : items.length) {
    const st = run([...cmd, ...items.slice(i, i + (Number.isFinite(n) ? n : items.length))]);
    if (st === 127) return 127;
    if (st) status = st;
  }
  return status;
};

/* ---------------- grep ---------------- */

export const grep: CommandFn = (ctx) => {
  const name = ctx.name;
  const p = parseOpts(ctx.args, {
    flags: "ivnclLrRwxEFPoqshHbzZaIU",
    withArg: "efABCm",
    long: {
      "ignore-case": "i", "invert-match": "v", "line-number": "n", count: "c", "files-with-matches": "l", "files-without-match": "L",
      recursive: "r", "word-regexp": "w", "line-regexp": "x", "extended-regexp": "E", "fixed-strings": "F", "perl-regexp": "P",
      "only-matching": "o", quiet: "q", silent: "q", "no-messages": "s", "with-filename": "H", "no-filename": "h", "byte-offset": "b",
      "regexp=": "e", "file=": "f", "after-context=": "A", "before-context=": "B", "context=": "C", "max-count=": "m",
      "color=": "--color", "colour=": "--color", "include=": "--include", "exclude=": "--exclude", "exclude-dir=": "--exclude-dir", null: "Z", "line-buffered": "U", binary: "U",
    },
  });
  if (p.error) return usageError(ctx, p.error, 2);
  const f = p.flags;
  let patterns = p.values.get("e") ?? [];
  let operands = [...p.operands];
  const patFile = last(p, "f");
  if (patFile) {
    try {
      patterns = [...patterns, ...splitLines(ctx.readInput(patFile))];
    } catch {
      ctx.err(`${name}: ${patFile}: No such file or directory\n`);
      return 2;
    }
  }
  if (!patterns.length) {
    if (!operands.length) {
      ctx.err(`Usage: grep [OPTION]... PATTERNS [FILE]...\nTry 'grep --help' for more information.\n`);
      return 2;
    }
    patterns = operands.shift()!.split("\n");
  }
  const dialect: RegexDialect | "fixed" = f.has("F") || name === "fgrep" ? "fixed" : f.has("P") ? "pcre" : f.has("E") || name === "egrep" ? "ere" : "bre";
  let re: RegExp;
  try {
    const sources = patterns.map((pat) => (dialect === "fixed" ? escapeRegexLiteral(pat) : compileRegex(pat, dialect).source));
    let src = sources.map((s) => `(?:${s})`).join("|");
    if (f.has("w")) src = `(?<![A-Za-z0-9_])(?:${src})(?![A-Za-z0-9_])`;
    if (f.has("x")) src = `^(?:${src})$`;
    re = new RegExp(src, "g" + (f.has("i") ? "i" : ""));
  } catch (err) {
    if (err instanceof RegexError || err instanceof SyntaxError) {
      ctx.err(`${name}: ${err instanceof RegexError ? err.message : "Invalid regular expression"}\n`);
      return 2;
    }
    throw err;
  }
  const colorOpt = last(p, "--color");
  const color = colorOpt === "always" || ((colorOpt === "auto" || colorOpt === undefined) && ctx.stdoutIsTTY);
  const after = Number(last(p, "A") ?? last(p, "C") ?? 0);
  const before = Number(last(p, "B") ?? last(p, "C") ?? 0);
  const maxCount = last(p, "m") !== undefined ? Number(last(p, "m")) : Infinity;
  const recursive = f.has("r") || f.has("R");
  const include = p.values.get("--include") ?? [];
  const exclude = p.values.get("--exclude") ?? [];
  const excludeDir = p.values.get("--exclude-dir") ?? [];
  const fs = ctx.sh.fs;

  // Expand recursive operands into files
  let files: string[] = [];
  if (!operands.length) operands = recursive ? ["."] : ["-"];
  const globMatch = (pat: string, s: string) => new RegExp(`^${pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`).test(s);
  let status = 1;
  let hadError = false;
  for (const op of operands) {
    if (op === "-") {
      files.push("-");
      continue;
    }
    const abs = ctx.resolve(op);
    const node = fs.lookup(abs);
    if (node?.type === "dir") {
      if (!recursive) {
        if (!f.has("s")) ctx.err(`${name}: ${op}: Is a directory\n`);
        hadError = true;
        continue;
      }
      for (const w of fs.walk(abs)) {
        if (w.node.type !== "file") continue;
        const rel = op.replace(/\/$/, "") + w.path.slice(abs.length);
        const parts = rel.split("/");
        if (excludeDir.some((d) => parts.slice(0, -1).some((seg) => globMatch(d, seg)))) continue;
        const base = parts[parts.length - 1];
        if (include.length && !include.some((g) => globMatch(g, base))) continue;
        if (exclude.some((g) => globMatch(g, base))) continue;
        files.push(op === "." && !p.operands.length ? rel.replace(/^\.\//, "") : rel);
      }
      continue;
    }
    files.push(op);
  }
  files = files.filter((x, i) => files.indexOf(x) === i);
  const showName = f.has("H") || (!f.has("h") && (files.length > 1 || recursive));
  const C = { file: "\x1b[35m", sep: "\x1b[36m", num: "\x1b[32m", match: "\x1b[01;31m", reset: "\x1b[0m" };
  const highlight = (line: string) =>
    color ? line.replace(new RegExp(re.source, re.flags), (m) => (m ? `${C.match}${m}${C.reset}` : m)) : line;
  let out = "";

  for (const file of files) {
    let content: string;
    try {
      content = ctx.readInput(file);
    } catch (err) {
      if (err instanceof FsError) {
        if (!f.has("s")) ctx.err(`${name}: ${file}: ${fsErrorText[err.code]}\n`);
        hadError = true;
        continue;
      }
      throw err;
    }
    const label = file === "-" ? "(standard input)" : file;
    const lines = splitLines(content);
    let count = 0;
    let lastPrinted = -1;
    let afterLeft = 0;
    const prefix = (i: number, sepChar: string) => {
      let s = "";
      if (showName) s += color ? `${C.file}${label}${C.reset}${C.sep}${sepChar}${C.reset}` : label + sepChar;
      if (f.has("n")) s += color ? `${C.num}${i + 1}${C.reset}${C.sep}${sepChar}${C.reset}` : `${i + 1}${sepChar}`;
      return s;
    };
    for (let i = 0; i < lines.length; i++) {
      if (count >= maxCount) break;
      const line = lines[i];
      re.lastIndex = 0;
      const matched = re.test(line) !== f.has("v");
      if (!matched) {
        if (afterLeft > 0 && !f.has("c") && !f.has("l") && !f.has("q") && !f.has("L")) {
          out += prefix(i, "-") + line + "\n";
          lastPrinted = i;
          afterLeft--;
        }
        continue;
      }
      count++;
      status = 0;
      if (f.has("q")) {
        ctx.out(out);
        return 0;
      }
      if (f.has("l") || f.has("L") || f.has("c")) continue;
      if (before || after) {
        const from = Math.max(lastPrinted + 1, i - before);
        if (lastPrinted >= 0 && from > lastPrinted + 1) out += color ? `${C.sep}--${C.reset}\n` : "--\n";
        for (let k = from; k < i; k++) out += prefix(k, "-") + lines[k] + "\n";
      }
      if (f.has("o") && !f.has("v")) {
        const all = new RegExp(re.source, re.flags);
        let m: RegExpExecArray | null;
        while ((m = all.exec(line))) {
          if (m[0] === "") {
            all.lastIndex++;
            continue;
          }
          out += prefix(i, ":") + (color ? `${C.match}${m[0]}${C.reset}` : m[0]) + "\n";
        }
      } else out += prefix(i, ":") + (f.has("v") ? line : highlight(line)) + "\n";
      lastPrinted = i;
      afterLeft = after;
    }
    if (f.has("c")) out += (showName ? label + ":" : "") + count + "\n";
    if (f.has("l") && count) out += label + (f.has("Z") ? "\0" : "\n");
    if (f.has("L") && !count) out += label + (f.has("Z") ? "\0" : "\n");
    if (f.has("L") && !count) status = 0;
  }
  ctx.out(out);
  if (hadError && !(f.has("q") && status === 0)) return 2;
  return status;
};
