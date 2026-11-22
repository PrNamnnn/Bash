/**
 * Glob patterns (filename expansion, case, [[ == ]], ${var#pat}) and
 * conversion of POSIX BRE/ERE regular expressions to JavaScript RegExp.
 *
 * In glob patterns produced by the expander, a backslash escapes the next
 * character — this is how quoted characters are kept literal.
 */

const POSIX_CLASSES: Record<string, string> = {
  alpha: "a-zA-Z",
  digit: "0-9",
  alnum: "a-zA-Z0-9",
  upper: "A-Z",
  lower: "a-z",
  space: " \\t\\n\\r\\f\\v",
  blank: " \\t",
  punct: "!-\\/:-@\\[-`{-~",
  xdigit: "0-9A-Fa-f",
  word: "\\w",
  cntrl: "\\x00-\\x1f\\x7f",
  print: "\\x20-\\x7e",
  graph: "\\x21-\\x7e",
};

function escapeRe(c: string): string {
  return c.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
}

/**
 * Parse a bracket expression starting at `i` (pointing at "[").
 * Returns the JS character class and the index after "]", or null if unterminated.
 */
function bracket(p: string, i: number, globNegation: boolean): { re: string; end: number } | null {
  let j = i + 1;
  let negate = false;
  if (p[j] === "!" && globNegation) {
    negate = true;
    j++;
  } else if (p[j] === "^") {
    negate = true;
    j++;
  }
  let body = "";
  let first = true;
  while (j < p.length) {
    const c = p[j];
    if (c === "]" && !first) {
      return { re: `[${negate ? "^" : ""}${body}]`, end: j + 1 };
    }
    first = false;
    if (c === "[" && p[j + 1] === ":") {
      const close = p.indexOf(":]", j + 2);
      if (close !== -1) {
        const name = p.slice(j + 2, close);
        const cls = POSIX_CLASSES[name];
        if (cls) {
          body += cls;
          j = close + 2;
          continue;
        }
      }
    }
    if (c === "\\" && globNegation && j + 1 < p.length) {
      body += escapeRe(p[j + 1]);
      j += 2;
      continue;
    }
    if (c === "-" && body && p[j + 1] !== "]") {
      body += "-";
      j++;
      continue;
    }
    body += c === "\\" ? "\\\\" : c === "]" || c === "[" || c === "^" ? "\\" + c : c;
    j++;
  }
  return null;
}

export interface GlobOptions {
  /** In pathname expansion, * and ? never match "/". */
  pathname?: boolean;
  nocase?: boolean;
}

/** Convert a glob to a regex source (unanchored). */
export function globToRegexSource(p: string, opts: GlobOptions = {}): string {
  let re = "";
  const any = opts.pathname ? "[^/]" : "[\\s\\S]";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "\\") {
      if (i + 1 < p.length) {
        re += escapeRe(p[i + 1]);
        i++;
      } else re += "\\\\";
      continue;
    }
    if (c === "*") {
      while (p[i + 1] === "*") i++;
      re += `${any}*`;
      continue;
    }
    if (c === "?") {
      re += any;
      continue;
    }
    if (c === "[") {
      const b = bracket(p, i, true);
      if (b) {
        re += b.re;
        i = b.end - 1;
        continue;
      }
      re += "\\[";
      continue;
    }
    re += escapeRe(c);
  }
  return re;
}

const globCache = new Map<string, RegExp>();

export function globToRegex(p: string, opts: GlobOptions = {}): RegExp {
  const key = `${opts.pathname ? 1 : 0}${opts.nocase ? 1 : 0}${p}`;
  let re = globCache.get(key);
  if (!re) {
    re = new RegExp(`^${globToRegexSource(p, opts)}$`, opts.nocase ? "i" : "");
    if (globCache.size > 500) globCache.clear();
    globCache.set(key, re);
  }
  return re;
}

export function matchGlob(text: string, pattern: string, opts: GlobOptions = {}): boolean {
  return globToRegex(pattern, opts).test(text);
}

/** True if the pattern contains an unescaped glob metacharacter. */
export function hasGlob(p: string): boolean {
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "*" || c === "?") return true;
    if (c === "[" && p.indexOf("]", i + 2) !== -1) return true;
  }
  return false;
}

/** Remove backslash escapes from a glob pattern (used when it matches nothing). */
export function unescapeGlob(p: string): string {
  return p.replace(/\\(.)/g, "$1");
}

/** Escape a literal string so it can be embedded in a glob pattern. */
export function escapeGlob(s: string): string {
  return s.replace(/[\\*?[\]]/g, "\\$&");
}

/* ------------------------------------------------------------------ */
/* POSIX regex → JS                                                    */
/* ------------------------------------------------------------------ */

export type RegexDialect = "bre" | "ere" | "pcre";

export class RegexError extends Error {}

/** Convert a POSIX basic or extended regular expression to a JS regex source. */
export function posixToJs(src: string, dialect: RegexDialect): string {
  if (dialect === "pcre") return src;
  let out = "";
  const bre = dialect === "bre";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") {
      const n = src[i + 1];
      i++;
      if (n === undefined) {
        out += "\\\\";
        break;
      }
      if (bre && "(){}|+?".includes(n)) {
        out += n;
        continue;
      }
      if (n === "<" || n === ">") {
        out += "\\b";
        continue;
      }
      if ("wWsSbB".includes(n) || /[1-9]/.test(n)) {
        out += "\\" + n;
        continue;
      }
      if (n === "n") {
        out += "\\n";
        continue;
      }
      if (n === "t") {
        out += "\\t";
        continue;
      }
      out += escapeRe(n);
      continue;
    }
    if (c === "[") {
      const b = bracket(src, i, false);
      if (!b) throw new RegexError("Unmatched [, [^, [:, [., or [=");
      out += b.re;
      i = b.end - 1;
      continue;
    }
    if (bre && "(){}|+?".includes(c)) {
      out += "\\" + c;
      continue;
    }
    if (c === "*" && (out === "" || out === "^" || out.endsWith("(") || out.endsWith("|"))) {
      out += "\\*";
      continue;
    }
    if (c === "{" && !bre && !/^\{\d*(,\d*)?\}/.test(src.slice(i))) {
      out += "\\{";
      continue;
    }
    if (c === "/") {
      out += "\\/";
      continue;
    }
    out += c;
  }
  return out;
}

export function compileRegex(src: string, dialect: RegexDialect, flags = ""): RegExp {
  try {
    return new RegExp(posixToJs(src, dialect), flags);
  } catch (err) {
    if (err instanceof RegexError) throw err;
    throw new RegexError(dialect === "pcre" ? (err as Error).message : "Invalid regular expression");
  }
}

export function escapeRegexLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
