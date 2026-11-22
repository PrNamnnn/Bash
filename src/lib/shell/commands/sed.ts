import type { CommandFn } from "../shell";
import { compileRegex, RegexError } from "../pattern";
import { FsError, fsErrorText } from "../vfs";

type Addr = { t: "line"; n: number } | { t: "last" } | { t: "re"; re: RegExp } | { t: "step"; first: number; step: number };

interface Cmd {
  a1?: Addr;
  a2?: Addr | { t: "rel"; n: number };
  negate: boolean;
  name: string;
  // s
  re?: RegExp | null;
  rep?: string;
  global?: boolean;
  nth?: number;
  print?: boolean;
  wfile?: string;
  // y
  from?: string;
  to?: string;
  // a i c
  text?: string;
  // q
  code?: number;
  // { }
  block?: Cmd[];
  label?: string;
  // range state
  active?: boolean;
  rangeEnd?: number;
}

class SedError extends Error {}

function parseScript(script: string, ere: boolean): Cmd[] {
  let i = 0;
  const s = script;
  const skipWs = () => {
    while (i < s.length && /[ \t]/.test(s[i])) i++;
  };
  const readDelimited = (delim: string): string => {
    let out = "";
    while (i < s.length && s[i] !== delim) {
      if (s[i] === "\\" && i + 1 < s.length) {
        if (s[i + 1] === delim) out += delim;
        else if (s[i + 1] === "n") out += "\\n";
        else out += s[i] + s[i + 1];
        i += 2;
        continue;
      }
      if (s[i] === "\n") throw new SedError("unterminated `s' command");
      out += s[i++];
    }
    if (s[i] !== delim) throw new SedError("unterminated `s' command");
    i++;
    return out;
  };
  let lastRe: RegExp | null = null;
  const makeRe = (src: string, flags = ""): RegExp | null => {
    if (src === "") return lastRe;
    const re = compileRegex(src.replace(/\\n/g, "\n"), ere ? "ere" : "bre", flags);
    lastRe = re;
    return re;
  };
  const readAddr = (): Addr | undefined => {
    if (/\d/.test(s[i] ?? "")) {
      let n = "";
      while (/\d/.test(s[i] ?? "")) n += s[i++];
      if (s[i] === "~") {
        i++;
        let st = "";
        while (/\d/.test(s[i] ?? "")) st += s[i++];
        return { t: "step", first: Number(n), step: Number(st) };
      }
      return { t: "line", n: Number(n) };
    }
    if (s[i] === "$") {
      i++;
      return { t: "last" };
    }
    if (s[i] === "/" || s[i] === "\\") {
      let delim = "/";
      if (s[i] === "\\") {
        delim = s[i + 1];
        i++;
      }
      i++;
      const src = readDelimited(delim);
      let flags = "";
      if (s[i] === "I") {
        flags = "i";
        i++;
      }
      const re = makeRe(src, flags);
      if (!re) throw new SedError("no previous regular expression");
      return { t: "re", re };
    }
    return undefined;
  };
  const readText = (): string => {
    skipWs();
    if (s[i] === "\\") {
      i++;
      if (s[i] === "\n") i++;
    }
    let out = "";
    while (i < s.length && s[i] !== "\n") {
      if (s[i] === "\\" && i + 1 < s.length) {
        out += s[i + 1] === "n" ? "\n" : s[i + 1] === "t" ? "\t" : s[i + 1];
        i += 2;
        continue;
      }
      out += s[i++];
    }
    return out;
  };

  const parseBlock = (inBlock: boolean): Cmd[] => {
    const cmds: Cmd[] = [];
    for (;;) {
      while (i < s.length && /[\s;]/.test(s[i])) i++;
      if (i >= s.length) {
        if (inBlock) throw new SedError("unmatched `{'");
        return cmds;
      }
      if (s[i] === "}") {
        if (!inBlock) throw new SedError("unexpected `}'");
        i++;
        return cmds;
      }
      if (s[i] === "#") {
        while (i < s.length && s[i] !== "\n") i++;
        continue;
      }
      const cmd: Cmd = { negate: false, name: "" };
      cmd.a1 = readAddr();
      if (cmd.a1 && s[i] === ",") {
        i++;
        if (s[i] === "+") {
          i++;
          let n = "";
          while (/\d/.test(s[i] ?? "")) n += s[i++];
          cmd.a2 = { t: "rel", n: Number(n) };
        } else {
          cmd.a2 = readAddr();
          if (!cmd.a2) throw new SedError("unexpected `,'");
        }
      }
      skipWs();
      if (s[i] === "!") {
        cmd.negate = true;
        i++;
        skipWs();
      }
      const c = s[i++];
      if (c === undefined) throw new SedError("missing command");
      cmd.name = c;
      switch (c) {
        case "{":
          cmd.block = parseBlock(true);
          break;
        case "s": {
          const delim = s[i++];
          const src = readDelimited(delim);
          const rep = readDelimited(delim);
          let flags = "";
          cmd.global = false;
          while (i < s.length && /[gpiIme0-9w]/.test(s[i])) {
            const fl = s[i++];
            if (fl === "g") cmd.global = true;
            else if (fl === "p") cmd.print = true;
            else if (fl === "i" || fl === "I") flags += "i";
            else if (fl === "m" || fl === "M") flags += "m";
            else if (/\d/.test(fl)) {
              let n = fl;
              while (/\d/.test(s[i] ?? "")) n += s[i++];
              cmd.nth = Number(n);
            } else if (fl === "w") {
              skipWs();
              let fname = "";
              while (i < s.length && s[i] !== "\n" && s[i] !== ";") fname += s[i++];
              cmd.wfile = fname.trim();
            }
          }
          cmd.re = makeRe(src, flags);
          if (!cmd.re) throw new SedError("no previous regular expression");
          cmd.rep = rep;
          break;
        }
        case "y": {
          const delim = s[i++];
          const from = readDelimited(delim).replace(/\\n/g, "\n");
          const to = readDelimited(delim).replace(/\\n/g, "\n");
          if ([...from].length !== [...to].length) throw new SedError("strings for `y' command are different lengths");
          cmd.from = from;
          cmd.to = to;
          break;
        }
        case "a":
        case "i":
        case "c":
          cmd.text = readText();
          break;
        case "q":
        case "Q": {
          skipWs();
          let n = "";
          while (/\d/.test(s[i] ?? "")) n += s[i++];
          cmd.code = n ? Number(n) : 0;
          break;
        }
        case "b":
        case "t":
        case "T":
        case ":": {
          skipWs();
          let l = "";
          while (i < s.length && !/[\s;}]/.test(s[i])) l += s[i++];
          cmd.label = l;
          break;
        }
        case "w":
        case "r": {
          skipWs();
          let fname = "";
          while (i < s.length && s[i] !== "\n") fname += s[i++];
          cmd.wfile = fname.trim();
          break;
        }
        case "d":
        case "D":
        case "p":
        case "P":
        case "n":
        case "N":
        case "=":
        case "h":
        case "H":
        case "g":
        case "G":
        case "x":
        case "l":
        case "z":
          break;
        default:
          throw new SedError(`unknown command: \`${c}'`);
      }
      cmds.push(cmd);
    }
  };
  return parseBlock(false);
}

function applyReplacement(rep: string, m: RegExpExecArray): string {
  let out = "";
  let caseMode: "" | "U" | "L" = "";
  let oneShot: "" | "u" | "l" = "";
  const emit = (t: string) => {
    for (const ch of t) {
      let c = ch;
      if (oneShot === "u") {
        c = c.toUpperCase();
        oneShot = "";
      } else if (oneShot === "l") {
        c = c.toLowerCase();
        oneShot = "";
      } else if (caseMode === "U") c = c.toUpperCase();
      else if (caseMode === "L") c = c.toLowerCase();
      out += c;
    }
  };
  for (let i = 0; i < rep.length; i++) {
    const c = rep[i];
    if (c === "\\" && i + 1 < rep.length) {
      const n = rep[++i];
      if (/\d/.test(n)) emit(m[Number(n)] ?? "");
      else if (n === "n") emit("\n");
      else if (n === "t") emit("\t");
      else if (n === "&") emit("&");
      else if (n === "U" || n === "L") caseMode = n;
      else if (n === "E") caseMode = "";
      else if (n === "u" || n === "l") oneShot = n;
      else emit(n);
      continue;
    }
    if (c === "&") {
      emit(m[0]);
      continue;
    }
    emit(c);
  }
  return out;
}

export const sed: CommandFn = (ctx) => {
  const args = ctx.args;
  let quiet = false;
  let ere = false;
  let inPlace: string | null = null;
  let separate = false;
  const scripts: string[] = [];
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      files.push(...args.slice(i + 1));
      break;
    }
    if (a === "-n" || a === "--quiet" || a === "--silent") quiet = true;
    else if (a === "-E" || a === "-r" || a === "--regexp-extended") ere = true;
    else if (a === "-s" || a === "--separate") separate = true;
    else if (a === "-u" || a === "--unbuffered" || a === "--posix" || a === "--debug") continue; // no buffering to change in the simulator
    else if (a === "-e") scripts.push(args[++i] ?? "");
    else if (a.startsWith("--expression=")) scripts.push(a.slice(13));
    else if (a === "-f") {
      try {
        scripts.push(ctx.readInput(args[++i] ?? ""));
      } catch {
        ctx.err(`sed: couldn't open file ${args[i]}: No such file or directory\n`);
        return 1;
      }
    } else if (a === "-i" || a.startsWith("-i") || a === "--in-place" || a.startsWith("--in-place=")) {
      inPlace = a.startsWith("--in-place=") ? a.slice(11) : a.slice(2);
    } else if (/^-[nErsuz]+$/.test(a)) {
      if (a.includes("n")) quiet = true;
      if (a.includes("E") || a.includes("r")) ere = true;
      if (a.includes("s")) separate = true;
    } else if (a.startsWith("-") && a.length > 1) {
      ctx.err(`sed: invalid option -- '${a.slice(1, 2)}'\nUsage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...\n`);
      return 1;
    } else if (!scripts.length && !files.length && !args.slice(0, i).some((x) => x === "-e" || x === "-f")) scripts.push(a);
    else files.push(a);
  }
  if (!scripts.length) {
    ctx.err("Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...\n");
    return 1;
  }
  let program: Cmd[];
  try {
    program = parseScript(scripts.join("\n"), ere);
  } catch (err) {
    if (err instanceof SedError || err instanceof RegexError) {
      ctx.err(`sed: -e expression #1, char ${scripts.join("\n").length}: ${err.message}\n`);
      return 1;
    }
    throw err;
  }
  if (inPlace !== null && !files.length) {
    ctx.err("sed: no input files\n");
    return 1;
  }

  const runOn = (content: string): { out: string; quit?: number } => {
    const lines = content.split("\n");
    const hadNl = content.endsWith("\n");
    if (hadNl) lines.pop();
    let out = "";
    let hold = "";
    let quitCode: number | undefined;
    const resetRanges = (cmds: Cmd[]) => cmds.forEach((c) => {
      c.active = false;
      if (c.block) resetRanges(c.block);
    });
    resetRanges(program);
    let idx = 0;
    const total = lines.length;
    const matchAddr = (a: Addr, ps: string, ln: number) => {
      switch (a.t) {
        case "line": return ln === a.n;
        case "last": return ln === total;
        case "re": a.re.lastIndex = 0; return a.re.test(ps);
        case "step": return a.step <= 0 ? ln === a.first : ln >= a.first && (ln - a.first) % a.step === 0;
      }
    };
    const selected = (c: Cmd, ps: string, ln: number): boolean => {
      let r: boolean;
      if (!c.a1) r = true;
      else if (!c.a2) r = matchAddr(c.a1, ps, ln);
      else if (c.active) {
        const a2 = c.a2;
        if (a2.t === "rel") {
          if (ln >= (c.rangeEnd ?? 0)) c.active = false;
        } else if (a2.t === "line") {
          if (ln >= a2.n) c.active = false;
        } else if (matchAddr(a2, ps, ln)) c.active = false;
        r = true;
      } else if (matchAddr(c.a1, ps, ln)) {
        const a2 = c.a2;
        c.active = true;
        if (a2.t === "rel") {
          c.rangeEnd = ln + a2.n;
          if (a2.n === 0) c.active = false;
        } else if (a2.t === "line" && a2.n <= ln) c.active = false;
        r = true;
      } else r = false;
      return c.negate ? !r : r;
    };

    while (idx < lines.length) {
      ctx.sh.tick();
      let ps = lines[idx++];
      let ln = idx;
      let deleted = false;
      let appendQueue = "";
      let substituted = false;
      const exec = (cmds: Cmd[]): "next" | "quit" | "quitSilent" | "restart" | undefined => {
        for (let ci = 0; ci < cmds.length; ci++) {
          const c = cmds[ci];
          if (!selected(c, ps, ln)) continue;
          switch (c.name) {
            case "{": {
              const r = exec(c.block!);
              if (r) return r;
              break;
            }
            case "s": {
              const re = c.re!;
              const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
              let count = 0;
              let did = false;
              ps = ps.replace(g, (...m: unknown[]) => {
                count++;
                const groups = m.slice(0, -2) as string[];
                const arr = Object.assign([...groups], { index: m[m.length - 2] as number, input: ps }) as unknown as RegExpExecArray;
                if (c.nth ? count === c.nth || (c.global && count > c.nth) : c.global || count === 1) {
                  did = true;
                  return applyReplacement(c.rep!, arr);
                }
                return groups[0];
              });
              if (did) {
                substituted = true;
                if (c.print) out += ps + "\n";
                if (c.wfile) ctx.sh.fs.writeFile(ctx.resolve(c.wfile), ps + "\n", true);
              }
              break;
            }
            case "y": {
              const from = [...c.from!];
              const to = [...c.to!];
              ps = [...ps].map((ch) => {
                const k = from.indexOf(ch);
                return k === -1 ? ch : to[k];
              }).join("");
              break;
            }
            case "d":
              deleted = true;
              return "next";
            case "D": {
              const nl = ps.indexOf("\n");
              if (nl === -1) {
                deleted = true;
                return "next";
              }
              ps = ps.slice(nl + 1);
              return "restart";
            }
            case "p":
              out += ps + "\n";
              break;
            case "P":
              out += ps.split("\n")[0] + "\n";
              break;
            case "=":
              out += ln + "\n";
              break;
            case "a":
              appendQueue += c.text + "\n";
              break;
            case "i":
              out += c.text + "\n";
              break;
            case "c":
              if (!c.a2 || !c.active) out += c.text + "\n";
              deleted = true;
              return "next";
            case "q":
              quitCode = c.code;
              return "quit";
            case "Q":
              quitCode = c.code;
              return "quitSilent";
            case "n":
              if (!quiet) out += ps + "\n";
              if (idx >= lines.length) return "quitSilent";
              ps = lines[idx++];
              ln = idx;
              break;
            case "N":
              if (idx >= lines.length) {
                return "quit";
              }
              ps += "\n" + lines[idx++];
              ln = idx;
              break;
            case "h": hold = ps; break;
            case "H": hold += "\n" + ps; break;
            case "g": ps = hold; break;
            case "G": ps += "\n" + hold; break;
            case "x": [ps, hold] = [hold, ps]; break;
            case "l":
              out += ps.replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n") + "$\n";
              break;
            case "z": ps = ""; break;
            case "w":
              ctx.sh.fs.writeFile(ctx.resolve(c.wfile!), ps + "\n", true);
              break;
            case "r":
              try {
                appendQueue += ctx.readInput(c.wfile!);
              } catch {
                /* missing file is silently ignored */
              }
              break;
            case ":":
              break;
            case "b":
            case "t":
            case "T": {
              const jump = c.name === "b" || (c.name === "t" ? substituted : !substituted);
              if (c.name !== "b") substituted = false;
              if (!jump) break;
              if (!c.label) return undefined;
              const target = cmds.findIndex((x) => x.name === ":" && x.label === c.label);
              if (target === -1) {
                throw new SedError(`can't find label for jump to \`${c.label}'`);
              }
              ci = target;
              break;
            }
          }
        }
        return undefined;
      };
      let r: ReturnType<typeof exec>;
      do {
        r = exec(program);
      } while (r === "restart");
      if (!deleted && !quiet && r !== "quitSilent") out += ps + (idx < lines.length || hadNl || r === "quit" ? "\n" : "\n");
      out += appendQueue;
      if (r === "quit" || r === "quitSilent") return { out, quit: quitCode ?? 0 };
    }
    if (!hadNl && out.endsWith("\n") && content !== "") out = out.slice(0, -1);
    return { out };
  };

  let status = 0;
  try {
    if (inPlace !== null) {
      for (const f of files) {
        const abs = ctx.resolve(f);
        let content: string;
        try {
          content = ctx.sh.fs.readFile(abs);
        } catch (err) {
          if (err instanceof FsError) {
            ctx.err(`sed: can't read ${f}: ${fsErrorText[err.code]}\n`);
            status = 2;
            continue;
          }
          throw err;
        }
        if (inPlace) ctx.sh.fs.writeFile(ctx.resolve(f + inPlace), content);
        ctx.sh.fs.writeFile(abs, runOn(content).out);
      }
      return status;
    }
    if (separate) {
      for (const f of files.length ? files : ["-"]) {
        const r = runOn(ctx.readInput(f));
        ctx.out(r.out);
        if (r.quit !== undefined) return r.quit;
      }
      return 0;
    }
    let all = "";
    for (const f of files.length ? files : ["-"]) {
      try {
        const c = ctx.readInput(f);
        all += c && !c.endsWith("\n") && f !== files[files.length - 1] ? c + "\n" : c;
      } catch (err) {
        if (err instanceof FsError) {
          ctx.err(`sed: can't read ${f}: ${fsErrorText[err.code]}\n`);
          status = 2;
          continue;
        }
        throw err;
      }
    }
    const r = runOn(all);
    ctx.out(r.out);
    return r.quit ?? status;
  } catch (err) {
    if (err instanceof SedError) {
      ctx.err(`sed: ${err.message}\n`);
      return 1;
    }
    throw err;
  }
};
