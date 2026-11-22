import { formatDate } from "./commands/util";
/** printf-style formatting shared by the printf builtin and awk. */

export function processEscapes(s: string, opts: { stopOnC?: boolean } = {}): { text: string; stop: boolean } {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\" || i + 1 >= s.length) {
      out += c;
      continue;
    }
    const n = s[++i];
    switch (n) {
      case "n": out += "\n"; break;
      case "t": out += "\t"; break;
      case "r": out += "\r"; break;
      case "a": out += "\x07"; break;
      case "b": out += "\b"; break;
      case "f": out += "\f"; break;
      case "v": out += "\v"; break;
      case "e":
      case "E": out += "\x1b"; break;
      case "\\": out += "\\"; break;
      case '"': out += '"'; break;
      case "'": out += "'"; break;
      case "c":
        if (opts.stopOnC) return { text: out, stop: true };
        out += "\\c";
        break;
      case "x": {
        const m = s.slice(i + 1).match(/^[0-9a-fA-F]{1,2}/);
        if (m) {
          out += String.fromCharCode(parseInt(m[0], 16));
          i += m[0].length;
        } else out += "\\x";
        break;
      }
      case "0": {
        const m = s.slice(i + 1).match(/^[0-7]{0,3}/);
        out += String.fromCharCode(parseInt(m?.[0] || "0", 8));
        i += m?.[0].length ?? 0;
        break;
      }
      default:
        if (/[1-7]/.test(n)) {
          const m = s.slice(i).match(/^[0-7]{1,3}/)!;
          out += String.fromCharCode(parseInt(m[0], 8));
          i += m[0].length - 1;
        } else out += "\\" + n;
    }
  }
  return { text: out, stop: false };
}

export interface FormatResult {
  text: string;
  consumed: number;
  error?: string;
  stop?: boolean;
}

function pad(s: string, width: number, left: boolean, zero: boolean): string {
  if (s.length >= width) return s;
  if (left) return s + " ".repeat(width - s.length);
  if (zero) {
    const sign = /^[+\- ]/.test(s) ? s[0] : "";
    const body = sign ? s.slice(1) : s;
    return sign + "0".repeat(width - s.length) + body;
  }
  return " ".repeat(width - s.length) + s;
}

function toNumber(arg: string | number | undefined, errors: string[]): number {
  if (arg === undefined) return 0;
  if (typeof arg === "number") return arg;
  const s = arg.trim();
  if (s === "") return 0;
  if (/^['"]/.test(s)) return s.length > 1 ? s.charCodeAt(1) : 0;
  if (/^[+-]?0[xX][0-9a-fA-F]+$/.test(s)) return parseInt(s, 16);
  if (/^[+-]?0[0-7]+$/.test(s)) return parseInt(s, 8);
  const n = Number(s);
  if (Number.isNaN(n)) {
    const lead = s.match(/^[+-]?\d+(\.\d+)?/);
    errors.push(`${s}: invalid number`);
    return lead ? Number(lead[0]) : 0;
  }
  return n;
}

function fmtG(n: number, prec: number, upper: boolean): string {
  if (n === 0) return "0";
  const p = prec === 0 ? 1 : prec;
  const exp = Math.floor(Math.log10(Math.abs(n)));
  let s: string;
  if (exp < -4 || exp >= p) {
    s = n.toExponential(p - 1);
    s = s.replace(/\.?0+e/, "e");
    s = s.replace(/e([+-])(\d)$/, "e$10$2");
  } else {
    s = n.toFixed(Math.max(0, p - 1 - exp));
    if (s.includes(".")) s = s.replace(/\.?0+$/, "");
  }
  return upper ? s.toUpperCase() : s;
}

/**
 * Format one pass of `fmt` with `args`, starting at args[offset].
 * `shellQuote` is used for %q.
 */
export function formatOnce(
  fmt: string,
  args: (string | number)[],
  offset: number,
  opts: { shellQuote?: (s: string) => string; awk?: boolean } = {},
): FormatResult & { errors: string[] } {
  let out = "";
  let ai = offset;
  const errors: string[] = [];
  const next = () => (ai < args.length ? args[ai++] : undefined);
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i];
    if (c === "\\" && !opts.awk) {
      const end = i + 1 < fmt.length ? i + 2 : i + 1;
      // handle multi-char escapes via processEscapes on a slice
      const m = fmt.slice(i).match(/^\\(x[0-9a-fA-F]{1,2}|0[0-7]{0,3}|[1-7][0-7]{0,2}|.)/);
      const seq = m ? m[0] : fmt.slice(i, end);
      const r = processEscapes(seq, { stopOnC: true });
      if (r.stop) return { text: out, consumed: ai - offset, errors, stop: true };
      out += r.text;
      i += seq.length - 1;
      continue;
    }
    if (c !== "%") {
      out += c;
      continue;
    }
    // Bash's %(strftime)T: format a time (epoch seconds; -1 or no argument = now).
    const t = opts.awk ? null : fmt.slice(i).match(/^%(-?)(\d*)\(([^)]*)\)T/);
    if (t) {
      i += t[0].length - 1;
      const a = next();
      const n = a === undefined || a === "" ? -1 : Math.trunc(toNumber(a, errors));
      const d = n === -1 || n === -2 ? new Date() : new Date(n * 1000);
      out += pad(formatDate(d, t[3] || "%X", false), t[2] ? Number(t[2]) : 0, t[1] === "-", false);
      continue;
    }
    const m = fmt.slice(i).match(/^%([-+ 0#]*)(\*|\d+)?(?:\.(\*|\d*))?([diouxXeEfFgGcsbq%])/);
    if (!m) {
      out += "%";
      continue;
    }
    i += m[0].length - 1;
    const flags = m[1];
    let width = m[2] === "*" ? Math.trunc(toNumber(next(), errors)) : m[2] ? Number(m[2]) : 0;
    let left = flags.includes("-");
    if (width < 0) {
      left = true;
      width = -width;
    }
    const precRaw = m[3];
    const prec = precRaw === "*" ? Math.trunc(toNumber(next(), errors)) : precRaw !== undefined ? Number(precRaw || 0) : undefined;
    const conv = m[4];
    const zero = flags.includes("0") && !left;
    const plus = flags.includes("+");
    const space = flags.includes(" ");
    switch (conv) {
      case "%":
        out += "%";
        break;
      case "s": {
        const a = next();
        let s = a === undefined ? "" : String(a);
        if (prec !== undefined) s = s.slice(0, prec);
        out += pad(s, width, left, false);
        break;
      }
      case "b": {
        const a = next();
        const r = processEscapes(a === undefined ? "" : String(a), { stopOnC: true });
        out += pad(r.text, width, left, false);
        if (r.stop) return { text: out, consumed: ai - offset, errors, stop: true };
        break;
      }
      case "q": {
        const a = next();
        const s = opts.shellQuote ? opts.shellQuote(a === undefined ? "" : String(a)) : String(a ?? "");
        out += pad(s, width, left, false);
        break;
      }
      case "c": {
        const a = next();
        const s = a === undefined ? "" : typeof a === "number" && opts.awk ? String.fromCharCode(a) : String(a).charAt(0);
        out += pad(s, width, left, false);
        break;
      }
      case "d":
      case "i": {
        const n = Math.trunc(toNumber(next(), errors));
        let s = Math.abs(n).toString();
        if (prec !== undefined) s = s.padStart(prec, "0");
        s = (n < 0 ? "-" : plus ? "+" : space ? " " : "") + s;
        out += pad(s, width, left, zero && prec === undefined);
        break;
      }
      case "u":
      case "o":
      case "x":
      case "X": {
        let n = Math.trunc(toNumber(next(), errors));
        if (n < 0) n = Number(BigInt.asUintN(64, BigInt(n)));
        let s = conv === "o" ? n.toString(8) : conv === "u" ? n.toString(10) : n.toString(16);
        if (conv === "X") s = s.toUpperCase();
        if (flags.includes("#") && n !== 0) s = (conv === "o" ? "0" : conv === "x" ? "0x" : conv === "X" ? "0X" : "") + s;
        if (prec !== undefined) s = s.padStart(prec, "0");
        out += pad(s, width, left, zero);
        break;
      }
      case "f":
      case "F":
      case "e":
      case "E":
      case "g":
      case "G": {
        const n = toNumber(next(), errors);
        const p = prec ?? 6;
        let s: string;
        if (!Number.isFinite(n)) s = Number.isNaN(n) ? "nan" : n > 0 ? "inf" : "-inf";
        else if (conv === "f" || conv === "F") s = Math.abs(n).toFixed(p);
        else if (conv === "e" || conv === "E") {
          s = Math.abs(n).toExponential(p).replace(/e([+-])(\d)$/, "e$10$2");
          if (conv === "E") s = s.toUpperCase();
        } else s = fmtG(Math.abs(n), p, conv === "G");
        if (Number.isFinite(n)) s = (n < 0 || Object.is(n, -0) ? "-" : plus ? "+" : space ? " " : "") + s;
        out += pad(s, width, left, zero);
        break;
      }
    }
  }
  return { text: out, consumed: ai - offset, errors };
}

/** Full shell printf semantics: the format is reused until all arguments are consumed. */
export function shellPrintf(fmt: string, args: string[], shellQuote: (s: string) => string): { text: string; errors: string[] } {
  let out = "";
  let offset = 0;
  const errors: string[] = [];
  for (;;) {
    const r = formatOnce(fmt, args, offset, { shellQuote });
    out += r.text;
    errors.push(...r.errors);
    offset += r.consumed;
    if (r.stop || r.consumed === 0 || offset >= args.length) break;
  }
  return { text: out, errors };
}

/** Number → string the way awk prints it (integers plainly, others with %.6g). */
export function awkNumberToString(n: number, fmt = "%.6g"): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e16) return String(n);
  if (Number.isNaN(n)) return "nan";
  if (!Number.isFinite(n)) return n > 0 ? "inf" : "-inf";
  return formatOnce(fmt, [n], 0, { awk: true }).text;
}
