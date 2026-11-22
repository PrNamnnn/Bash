/**
 * A small, fast Bash syntax highlighter. Runs on the server for static code
 * blocks (zero client JS) and in the browser for the code editor.
 */

export type TokType = "com" | "kw" | "builtin" | "cmd" | "str" | "var" | "num" | "op" | "flag" | "sub" | "plain" | "prompt" | "out";

export interface Tok {
  t: TokType;
  v: string;
}

const KEYWORDS = new Set([
  "if", "then", "elif", "else", "fi", "for", "in", "do", "done", "while", "until", "case", "esac", "function", "select", "time", "coproc", "{", "}", "[[", "]]", "!",
]);
const BUILTINS = new Set([
  "echo", "printf", "cd", "pwd", "read", "local", "export", "declare", "typeset", "set", "unset", "shift", "exit", "return", "source", ".", "test", "[", "]", "trap",
  "readonly", "eval", "exec", "getopts", "mapfile", "readarray", "alias", "unalias", "shopt", "let", "wait", "kill", "jobs", "fg", "bg", "true", "false", "break",
  "continue", "type", "command", "builtin", "hash", "help", "history", "umask", "pushd", "popd", "dirs", "disown", "caller", ":",
]);
const CMD_STARTERS = new Set(["|", "||", "&&", ";", "&", "(", "$(", "`", "then", "do", "else", "elif", "if", "while", "until", "!", "{", "time", "\n", "|&", ";;"]);

function pushTok(out: Tok[], t: TokType, v: string): void {
  if (!v) return;
  const last = out[out.length - 1];
  if (last && last.t === t && (t === "plain" || t === "com" || t === "str" || t === "out")) last.v += v;
  else out.push({ t, v });
}

export function tokenizeBash(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let expectCmd = true;
  let afterCase = false;
  const n = src.length;

  const readDollar = (): string => {
    const start = i;
    if (src[i + 1] === "(" && src[i + 2] === "(") {
      let depth = 0;
      i += 1;
      while (i < n) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")") {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
        i++;
      }
      return src.slice(start, i);
    }
    if (src[i + 1] === "{") {
      let depth = 0;
      while (i < n) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
        i++;
      }
      return src.slice(start, i);
    }
    const m = src.slice(i + 1).match(/^([A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])/);
    i += 1 + (m ? m[0].length : 0);
    return src.slice(start, i);
  };

  while (i < n) {
    const c = src[i];
    // newline
    if (c === "\n") {
      pushTok(out, "plain", "\n");
      i++;
      expectCmd = true;
      continue;
    }
    if (c === " " || c === "\t") {
      let j = i;
      while (j < n && (src[j] === " " || src[j] === "\t")) j++;
      pushTok(out, "plain", src.slice(i, j));
      i = j;
      continue;
    }
    // comment
    if (c === "#" && (i === 0 || /[\s;|&(]/.test(src[i - 1]))) {
      let j = src.indexOf("\n", i);
      if (j === -1) j = n;
      pushTok(out, "com", src.slice(i, j));
      i = j;
      continue;
    }
    // single-quoted string
    if (c === "'" || (c === "$" && src[i + 1] === "'")) {
      const start = i;
      i += c === "$" ? 2 : 1;
      while (i < n && src[i] !== "'") {
        if (c === "$" && src[i] === "\\") i++;
        i++;
      }
      i++;
      pushTok(out, "str", src.slice(start, i));
      expectCmd = false;
      continue;
    }
    // double-quoted string, with $vars highlighted inside
    if (c === '"') {
      pushTok(out, "str", '"');
      i++;
      let buf = "";
      while (i < n && src[i] !== '"') {
        if (src[i] === "\\" && i + 1 < n) {
          buf += src[i] + src[i + 1];
          i += 2;
          continue;
        }
        if (src[i] === "$" && /[A-Za-z_{(0-9@*#?$!-]/.test(src[i + 1] ?? "")) {
          pushTok(out, "str", buf);
          buf = "";
          if (src[i + 1] === "(" && src[i + 2] !== "(") {
            pushTok(out, "sub", "$(");
            i += 2;
            let depth = 1;
            let inner = "";
            while (i < n && depth > 0) {
              if (src[i] === "(") depth++;
              if (src[i] === ")") depth--;
              if (depth > 0) inner += src[i];
              i++;
            }
            out.push(...tokenizeBash(inner));
            pushTok(out, "sub", ")");
            continue;
          }
          out.push({ t: "var", v: readDollar() });
          continue;
        }
        buf += src[i++];
      }
      pushTok(out, "str", buf);
      if (i < n) {
        pushTok(out, "str", '"');
        i++;
      }
      expectCmd = false;
      continue;
    }
    // variables / substitutions
    if (c === "$") {
      if (src[i + 1] === "(" && src[i + 2] !== "(") {
        out.push({ t: "sub", v: "$(" });
        i += 2;
        expectCmd = true;
        continue;
      }
      if (/[A-Za-z_{(0-9@*#?$!-]/.test(src[i + 1] ?? "")) {
        out.push({ t: "var", v: readDollar() });
        expectCmd = false;
        continue;
      }
    }
    if (c === "`") {
      out.push({ t: "sub", v: "`" });
      i++;
      expectCmd = true;
      continue;
    }
    // operators
    const op = src.slice(i).match(/^(\|\||&&|;;|\|&|<<<|<<-|<<|>>|&>>|&>|[0-9]?>&[0-9-]?|[0-9]?>|[0-9]?<|\||;|&|\(|\))/);
    if (op && !(op[0].match(/^[0-9]/) && /[A-Za-z0-9_]/.test(src[i - 1] ?? ""))) {
      out.push({ t: "op", v: op[0] });
      i += op[0].length;
      expectCmd = CMD_STARTERS.has(op[0]) || op[0] === ")" ? op[0] !== ")" : false;
      if (op[0] === ")" && afterCase) expectCmd = true;
      continue;
    }
    // words
    let j = i;
    while (j < n && !/[\s;|&<>()"'`$]/.test(src[j])) {
      if (src[j] === "\\" && j + 1 < n) j++;
      j++;
    }
    if (j === i) {
      pushTok(out, "plain", c);
      i++;
      continue;
    }
    const word = src.slice(i, j);
    i = j;
    if (KEYWORDS.has(word) && (expectCmd || word === "in" || word === "do" || word === "then" || word === "]]" || word === "}")) {
      out.push({ t: "kw", v: word });
      if (word === "case") afterCase = true;
      if (word === "esac") afterCase = false;
      expectCmd = CMD_STARTERS.has(word) || word === "{";
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=/.test(word) && expectCmd) {
      const eq = word.indexOf("=");
      out.push({ t: "var", v: word.slice(0, eq) });
      out.push({ t: "op", v: word[eq - 1] === "+" ? "" : "=" });
      pushTok(out, "plain", word.slice(eq + 1));
      continue;
    }
    if (expectCmd) {
      if (/^[A-Za-z_][\w-]*\(\)$/.test(word) || (src.slice(i).match(/^\s*\(\)/) && /^[A-Za-z_][\w-]*$/.test(word))) {
        out.push({ t: "cmd", v: word });
        expectCmd = false;
        continue;
      }
      out.push({ t: BUILTINS.has(word) ? "builtin" : "cmd", v: word });
      expectCmd = false;
      continue;
    }
    if (/^-{1,2}[A-Za-z]/.test(word)) {
      out.push({ t: "flag", v: word });
      continue;
    }
    if (/^-?\d+(\.\d+)?$/.test(word)) {
      out.push({ t: "num", v: word });
      continue;
    }
    pushTok(out, "plain", word);
  }
  return out;
}

/** Split tokens into lines, preserving token types across newlines. */
export function toLines(toks: Tok[]): Tok[][] {
  const lines: Tok[][] = [[]];
  for (const t of toks) {
    const parts = t.v.split("\n");
    parts.forEach((p, idx) => {
      if (idx > 0) lines.push([]);
      if (p) lines[lines.length - 1].push({ t: t.t, v: p });
    });
  }
  return lines;
}

/** Highlight a "console" transcript: `$ cmd` lines are commands, others are output. */
function tokenizeConsole(src: string): Tok[] {
  const out: Tok[] = [];
  const lines = src.split("\n");
  lines.forEach((line, idx) => {
    const m = line.match(/^(\$|#|>)\s(.*)$/);
    if (m) {
      out.push({ t: "prompt", v: m[1] + " " });
      out.push(...tokenizeBash(m[2]));
    } else out.push({ t: "out", v: line });
    if (idx < lines.length - 1) out.push({ t: "plain", v: "\n" });
  });
  return out;
}

function tokenizeConf(src: string): Tok[] {
  const out: Tok[] = [];
  const lines = src.split("\n");
  lines.forEach((line, idx) => {
    if (/^\s*[#;]/.test(line)) out.push({ t: "com", v: line });
    else {
      const m = line.match(/^(\s*-?\s*)([\w.-]+)(\s*[:=])(.*)$/);
      if (m) {
        out.push({ t: "plain", v: m[1] });
        out.push({ t: "builtin", v: m[2] });
        out.push({ t: "op", v: m[3] });
        out.push({ t: /^\s*["']/.test(m[4]) ? "str" : "plain", v: m[4] });
      } else if (/^\s*\[.*\]\s*$/.test(line)) out.push({ t: "kw", v: line });
      else out.push({ t: "plain", v: line });
    }
    if (idx < lines.length - 1) out.push({ t: "plain", v: "\n" });
  });
  return out;
}

export function highlight(code: string, lang: string): Tok[][] {
  const l = lang.toLowerCase();
  if (["bash", "sh", "shell", "zsh"].includes(l)) return toLines(tokenizeBash(code));
  if (l === "console" || l === "terminal") return toLines(tokenizeConsole(code));
  if (["ini", "conf", "yaml", "yml", "toml", "env", "properties"].includes(l)) return toLines(tokenizeConf(code));
  return code.split("\n").map((line) => (line ? [{ t: "plain" as const, v: line }] : []));
}

export const tokClass: Record<TokType, string> = {
  com: "tok-com",
  kw: "tok-kw",
  builtin: "tok-builtin",
  cmd: "tok-cmd",
  str: "tok-str",
  var: "tok-var",
  num: "tok-num",
  op: "tok-op",
  flag: "tok-flag",
  sub: "tok-sub",
  plain: "tok-plain",
  prompt: "text-accent select-none",
  out: "text-fg-muted",
};
