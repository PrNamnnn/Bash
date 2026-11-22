import type { CommandFn } from "../shell";
import { builtins } from "../builtins";
import { MONTHS_LONG, formatDate, parseDateSpec, parseOpts, usageError, last } from "./util";
import { normalizePath } from "../vfs";
import { InStream } from "../io";
import { manual } from "./manual";

const delegate =
  (name: string): CommandFn =>
  (ctx) =>
    builtins[name]({ ...ctx, name });

export const whoami: CommandFn = (ctx) => {
  ctx.out("learner\n");
  return 0;
};

export const hostname: CommandFn = (ctx) => {
  if (ctx.args.some((a) => /^-[iI]/.test(a))) {
    ctx.out("10.0.2.15\n");
    return 0;
  }
  ctx.out(ctx.args.includes("-f") ? "bash-mastery.local\n" : "bash-mastery\n");
  return 0;
};

export const uname: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, { flags: "asnrvmpio", long: { all: "a", "kernel-name": "s", nodename: "n", "kernel-release": "r", machine: "m", "operating-system": "o" } });
  if (p.error) return usageError(ctx, p.error);
  const f = p.flags;
  const parts: string[] = [];
  const all = f.has("a");
  if (all || f.has("s") || !f.size) parts.push("Linux");
  if (all || f.has("n")) parts.push("bash-mastery");
  if (all || f.has("r")) parts.push("6.8.0-sim");
  if (all || f.has("v")) parts.push("#1 SMP PREEMPT_DYNAMIC");
  if (all || f.has("m")) parts.push("x86_64");
  if (all || f.has("o")) parts.push("GNU/Linux");
  ctx.out(parts.join(" ") + "\n");
  return 0;
};


export const date: CommandFn = (ctx) => {
  const args = [...ctx.args];
  let utc = false;
  let d = new Date();
  let fmt: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-u" || a === "--utc" || a === "--universal") utc = true;
    else if (a === "-r" || a === "--reference" || a.startsWith("--reference=")) {
      // -r FILE: the file's last modification time
      const file = a.startsWith("--reference=") ? a.slice(12) : (args[++i] ?? "");
      const node = ctx.sh.fs.lookup(ctx.resolve(file));
      if (!node) {
        ctx.err(`date: ${file}: No such file or directory\n`);
        return 1;
      }
      d = new Date(node.mtime);
    } else if (a === "-d" || a === "--date") {
      const spec = args[++i] ?? "";
      const parsed = parseDateSpec(spec);
      if (!parsed) {
        ctx.err(`date: invalid date ${JSON.stringify(spec).replace(/"/g, "'")}\n`);
        return 1;
      }
      d = parsed;
    } else if (a.startsWith("--date=")) {
      const parsed = parseDateSpec(a.slice(7));
      if (!parsed) {
        ctx.err(`date: invalid date '${a.slice(7)}'\n`);
        return 1;
      }
      d = parsed;
    } else if (a === "-I" || a.startsWith("--iso-8601") || a.startsWith("-I")) fmt = a.includes("seconds") || a === "-Iseconds" ? "%Y-%m-%dT%H:%M:%S%z" : "%F";
    else if (a === "-R" || a === "--rfc-email") fmt = "%a, %d %b %Y %H:%M:%S %z";
    else if (a.startsWith("+")) fmt = a.slice(1);
    else {
      ctx.err(`date: invalid date '${a}'\n`);
      return 1;
    }
  }
  ctx.out(formatDate(d, fmt ?? "%a %b %e %H:%M:%S %Z %Y", utc) + "\n");
  return 0;
};

export const cal: CommandFn = (ctx) => {
  const now = new Date();
  let month = now.getMonth();
  let year = now.getFullYear();
  const nums = ctx.args.filter((a) => /^\d+$/.test(a)).map(Number);
  if (nums.length === 2) {
    month = nums[0] - 1;
    year = nums[1];
  } else if (nums.length === 1) {
    ctx.err("cal: note: the simulator prints a single month; showing January of that year.\n");
    month = 0;
    year = nums[0];
  }
  if (month < 0 || month > 11) {
    ctx.err(`cal: ${month + 1} is neither a month number (1..12) nor a name\n`);
    return 1;
  }
  const title = `${MONTHS_LONG[month]} ${year}`;
  let out = " ".repeat(Math.floor((20 - title.length) / 2)) + title + "\n";
  out += "Su Mo Tu We Th Fr Sa\n";
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const highlight = ctx.stdoutIsTTY && month === now.getMonth() && year === now.getFullYear();
  let line = "   ".repeat(first);
  for (let d = 1; d <= days; d++) {
    const cell = String(d).padStart(2);
    line += highlight && d === now.getDate() ? `\x1b[7m${cell}\x1b[0m` : cell;
    if ((first + d) % 7 === 0) {
      out += line + "\n";
      line = "";
    } else line += " ";
  }
  if (line.trim()) out += line.trimEnd() + "\n";
  ctx.out(out);
  return 0;
};

export const id: CommandFn = (ctx) => {
  const f = ctx.args.join("");
  if (f.includes("u")) ctx.out(f.includes("n") ? "learner\n" : "1000\n");
  else if (f.includes("G")) ctx.out(f.includes("n") ? "learner sudo users\n" : "1000 27 100\n");
  else if (f.includes("g")) ctx.out(f.includes("n") ? "learner\n" : "1000\n");
  else ctx.out("uid=1000(learner) gid=1000(learner) groups=1000(learner),27(sudo),100(users)\n");
  return 0;
};

export const groups: CommandFn = (ctx) => {
  ctx.out("learner sudo users\n");
  return 0;
};

export const env: CommandFn = (ctx) => {
  const args = [...ctx.args];
  let e = new Map(ctx.env);
  while (args.length) {
    const a = args[0];
    if (a === "-i" || a === "-" || a === "--ignore-environment") {
      e = new Map();
      args.shift();
    } else if (a === "-u") {
      args.shift();
      e.delete(args.shift() ?? "");
    } else if (/^[A-Za-z_]\w*=/.test(a)) {
      const eq = a.indexOf("=");
      e.set(a.slice(0, eq), a.slice(eq + 1));
      args.shift();
    } else break;
  }
  if (!args.length) {
    ctx.out([...e].map(([k, v]) => `${k}=${v}\n`).join(""));
    return 0;
  }
  // run the command with the modified environment
  const sh = ctx.sh;
  const extra = new Map<string, string>();
  for (const [k, v] of e) if (ctx.env.get(k) !== v) extra.set(k, v);
  const removed = [...ctx.env.keys()].filter((k) => !e.has(k));
  if (removed.length) {
    const child = sh.subshell();
    for (const k of removed) child.unsetVar(k);
    return child.runExternal(args, ctx.fds, extra, ctx.fds);
  }
  return sh.runExternal(args, ctx.fds, extra, ctx.fds);
};

export const printenv: CommandFn = (ctx) => {
  if (!ctx.args.length) {
    ctx.out([...ctx.env].map(([k, v]) => `${k}=${v}\n`).join(""));
    return 0;
  }
  let st = 0;
  for (const n of ctx.args) {
    const v = ctx.env.get(n);
    if (v === undefined) st = 1;
    else ctx.out(v + "\n");
  }
  return st;
};

export const which: CommandFn = (ctx) => {
  const all = ctx.args.includes("-a");
  let st = 0;
  for (const n of ctx.args.filter((a) => a !== "-a")) {
    const pathVar = ctx.env.get("PATH") ?? "";
    let found = false;
    for (const dir of pathVar.split(":")) {
      const full = normalizePath(`${dir || "."}/${n}`, ctx.sh.cwd);
      const node = ctx.sh.fs.lookup(full);
      if (node?.type === "file" && ctx.sh.fs.canExec(node)) {
        ctx.out(full + "\n");
        found = true;
        if (!all) break;
      }
    }
    if (!found) st = 1;
  }
  return st;
};

export const whereis: CommandFn = (ctx) => {
  for (const n of ctx.args.filter((a) => !a.startsWith("-"))) {
    const locs: string[] = [];
    for (const dir of ["/usr/bin", "/bin", "/usr/local/bin", "/usr/sbin"]) {
      if (ctx.sh.fs.isFile(`${dir}/${n}`)) locs.push(`${dir}/${n}`);
    }
    if (manual[n]) locs.push(`/usr/share/man/man1/${n}.1.gz`);
    ctx.out(`${n}:${locs.length ? " " + locs.join(" ") : ""}\n`);
  }
  return 0;
};

export const sleep: CommandFn = (ctx) => {
  if (!ctx.args.length) return usageError(ctx, "missing operand");
  for (const a of ctx.args) {
    if (!/^\d*\.?\d+[smhd]?$/.test(a) && a !== "infinity") {
      ctx.err(`sleep: invalid time interval '${a}'\n`);
      return 1;
    }
  }
  if (!ctx.sh.notices.has("sleep")) {
    ctx.sh.notices.add("sleep");
    ctx.err(`bash-sim: note: sleep returns immediately in the simulator (a real system would pause for ${ctx.args.join(" ")}).\n`);
  }
  return 0;
};

export const clear: CommandFn = (ctx) => {
  ctx.out("\x1b[2J\x1b[H");
  return 0;
};

export const tty: CommandFn = (ctx) => {
  if (ctx.stdin.isTTY) {
    ctx.out("/dev/pts/0\n");
    return 0;
  }
  ctx.out("not a tty\n");
  return 1;
};

export const nproc: CommandFn = (ctx) => {
  ctx.out("4\n");
  return 0;
};

export const ps: CommandFn = (ctx) => {
  const sh = ctx.sh;
  const rows = [
    [String(sh.pid), "pts/0", "00:00:00", "bash"],
    [String(sh.nextPid()), "pts/0", "00:00:00", "ps"],
  ];
  ctx.out(`    PID TTY          TIME CMD\n` + rows.map((r) => `${r[0].padStart(7)} ${r[1].padEnd(8)} ${r[2]} ${r[3]}\n`).join(""));
  if (!sh.notices.has("ps")) {
    sh.notices.add("ps");
    ctx.err("bash-sim: note: this lists the simulator's own processes; Level 11 covers ps on a real system.\n");
  }
  return 0;
};

export const timeout: CommandFn = (ctx) => {
  const args = ctx.args.filter((a) => !a.startsWith("-"));
  if (args.length < 2) return usageError(ctx, "missing operand");
  return ctx.sh.runExternal(args.slice(1), ctx.fds, new Map(), ctx.fds);
};

export const nohup: CommandFn = (ctx) => {
  if (!ctx.args.length) return usageError(ctx, "missing operand");
  return ctx.sh.runExternal(ctx.args, ctx.fds, new Map(), ctx.fds);
};

export const man: CommandFn = (ctx) => {
  const name = ctx.args.filter((a) => !/^\d$/.test(a))[0];
  if (!name) {
    ctx.err("What manual page do you want?\nFor example, try 'man man'.\n");
    return 1;
  }
  const m = manual[name];
  if (!m) {
    ctx.err(`No manual entry for ${name}\n`);
    return 16;
  }
  ctx.out(
    `${name.toUpperCase()}(1)                     Bash Mastery simulator manual\n\nNAME\n       ${name} - ${m[0]}\n\nSYNOPSIS\n       ${m[1]}\n\nDESCRIPTION\n       ${m[2]}\n\n       This is a condensed page. On a real system \`man ${name}\` shows the full manual.\n`,
  );
  return 0;
};

export const expr: CommandFn = (ctx) => {
  const a = ctx.args;
  let i = 0;
  const isNum = (s: string) => /^-?\d+$/.test(s);
  const fail = (msg: string): never => {
    throw new Error(msg);
  };
  const primary = (): string => {
    const t = a[i++];
    if (t === undefined) fail("syntax error: missing argument after '" + (a[i - 2] ?? "") + "'");
    if (t === "(") {
      const v = orE();
      if (a[i++] !== ")") fail("syntax error: expecting ')'");
      return v;
    }
    if (t === "length") return String([...primary()].length);
    if (t === "substr") {
      const s = primary();
      const pos = Number(primary());
      const len = Number(primary());
      return s.substr(pos - 1, len);
    }
    if (t === "index") {
      const s = primary();
      const chars = primary();
      const idx = [...s].findIndex((c) => chars.includes(c));
      return String(idx + 1);
    }
    if (t === "match") {
      const s = primary();
      const re = primary();
      return matchOp(s, re);
    }
    return t;
  };
  const matchOp = (s: string, re: string): string => {
    const m = s.match(new RegExp("^(?:" + re.replace(/\\\(/g, "(").replace(/\\\)/g, ")") + ")"));
    if (!m) return /\\\(/.test(re) ? "" : "0";
    return m[1] !== undefined ? m[1] : String(m[0].length);
  };
  const colon = (): string => {
    let l = primary();
    while (a[i] === ":") {
      i++;
      l = matchOp(l, primary());
    }
    return l;
  };
  const mul = (): string => {
    let l = colon();
    while (["*", "/", "%"].includes(a[i])) {
      const op = a[i++];
      const r = colon();
      if (!isNum(l) || !isNum(r)) fail("non-integer argument");
      const x = BigInt(l);
      const y = BigInt(r);
      if (op !== "*" && y === 0n) fail("division by zero");
      l = String(op === "*" ? x * y : op === "/" ? x / y : x % y);
    }
    return l;
  };
  const add = (): string => {
    let l = mul();
    while (a[i] === "+" || a[i] === "-") {
      const op = a[i++];
      const r = mul();
      if (!isNum(l) || !isNum(r)) fail("non-integer argument");
      l = String(op === "+" ? BigInt(l) + BigInt(r) : BigInt(l) - BigInt(r));
    }
    return l;
  };
  const cmpE = (): string => {
    let l = add();
    while (["<", "<=", "=", "==", "!=", ">=", ">"].includes(a[i])) {
      const op = a[i++];
      const r = add();
      const c = isNum(l) && isNum(r) ? Number(BigInt(l) - BigInt(r)) : l < r ? -1 : l > r ? 1 : 0;
      const res = op === "<" ? c < 0 : op === "<=" ? c <= 0 : op === "=" || op === "==" ? c === 0 : op === "!=" ? c !== 0 : op === ">=" ? c >= 0 : c > 0;
      l = res ? "1" : "0";
    }
    return l;
  };
  const andE = (): string => {
    let l = cmpE();
    while (a[i] === "&") {
      i++;
      const r = cmpE();
      l = l !== "" && l !== "0" && r !== "" && r !== "0" ? l : "0";
    }
    return l;
  };
  const orE = (): string => {
    let l = andE();
    while (a[i] === "|") {
      i++;
      const r = andE();
      l = l !== "" && l !== "0" ? l : r !== "" && r !== "0" ? r : "0";
    }
    return l;
  };
  try {
    if (!a.length) fail("missing operand");
    const v = orE();
    if (i < a.length) fail(`syntax error: unexpected argument '${a[i]}'`);
    ctx.out(v + "\n");
    return v === "" || v === "0" ? 1 : 0;
  } catch (err) {
    ctx.err(`expr: ${(err as Error).message}\n`);
    return 2;
  }
};

export const base64: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, { flags: "di", withArg: "w", long: { decode: "d", "wrap=": "w" } });
  if (p.error) return usageError(ctx, p.error);
  let input: string;
  try {
    input = ctx.readInput(p.operands[0] ?? "-");
  } catch {
    ctx.err(`base64: ${p.operands[0]}: No such file or directory\n`);
    return 1;
  }
  if (p.flags.has("d")) {
    try {
      const bin = atob(input.replace(/\s+/g, ""));
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      ctx.out(new TextDecoder().decode(bytes));
      return 0;
    } catch {
      ctx.err("base64: invalid input\n");
      return 1;
    }
  }
  const bytes = [...input].every((c) => c.charCodeAt(0) < 256) ? Uint8Array.from(input, (c) => c.charCodeAt(0)) : new TextEncoder().encode(input);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  const enc = btoa(bin);
  const wrap = Number(last(p, "w") ?? 76);
  const lines = wrap > 0 ? enc.match(new RegExp(`.{1,${wrap}}`, "g")) ?? [""] : [enc];
  ctx.out(lines.join("\n") + "\n");
  return 0;
};

export const bash: CommandFn = (ctx) => {
  const sh = ctx.sh;
  const args = [...ctx.args];
  const flags: { xtrace?: boolean; errexit?: boolean; nounset?: boolean; noexec?: boolean; verbose?: boolean; pipefail?: boolean } = {};
  let command: string | undefined;
  while (args.length && /^[-+]/.test(args[0]) && args[0] !== "-" && args[0] !== "--") {
    const a = args.shift()!;
    if (a === "--norc" || a === "--noprofile" || a === "--login" || a === "-l" || a === "--posix") continue;
    if (a === "-o" || a === "+o") {
      const o = args.shift();
      if (o === "pipefail") flags.pipefail = a === "-o";
      if (o === "errexit") flags.errexit = a === "-o";
      if (o === "nounset") flags.nounset = a === "-o";
      if (o === "xtrace") flags.xtrace = a === "-o";
      continue;
    }
    for (const c of a.slice(1)) {
      if (c === "c") command = "";
      else if (c === "x") flags.xtrace = true;
      else if (c === "e") flags.errexit = true;
      else if (c === "u") flags.nounset = true;
      else if (c === "n") flags.noexec = true;
      else if (c === "v") flags.verbose = true;
      else if (c === "i") {
        ctx.err("bash-sim: nested interactive shells aren't supported — you are already in Bash.\n");
        return 0;
      } else if (c === "s" || c === "l") continue;
      else {
        ctx.err(`${ctx.name}: -${c}: invalid option\n`);
        return 2;
      }
    }
  }
  if (args[0] === "--") args.shift();
  if (command !== undefined) {
    const src = args.shift();
    if (src === undefined) {
      ctx.err(`${ctx.name}: -c: option requires an argument\n`);
      return 2;
    }
    const child = sh.childProcess(ctx.env);
    child.arg0 = args.shift() ?? ctx.name;
    child.positional = args;
    Object.assign(child.opts, Object.fromEntries(Object.entries(flags).filter(([, v]) => v)));
    return child.runScriptBody(src, ctx.fds);
  }
  if (args.length && args[0] !== "-") {
    const file = args.shift()!;
    const path = normalizePath(file, sh.cwd);
    if (!sh.fs.exists(path)) {
      ctx.err(`${ctx.name}: ${file}: No such file or directory\n`);
      return 127;
    }
    if (sh.fs.isDir(path)) {
      ctx.err(`${ctx.name}: ${file}: Is a directory\n`);
      return 126;
    }
    // `bash script.sh` does not need the execute bit
    const content = sh.fs.readFile(path);
    const child = sh.childProcess(ctx.env);
    child.scriptName = file;
    child.arg0 = file;
    child.positional = args;
    Object.assign(child.opts, Object.fromEntries(Object.entries(flags).filter(([, v]) => v)));
    return child.runScriptBody(content, ctx.fds);
  }
  if (!ctx.stdin.isTTY || !ctx.stdin.eof) {
    const src = ctx.stdin.readAll();
    const child = sh.childProcess(ctx.env);
    Object.assign(child.opts, Object.fromEntries(Object.entries(flags).filter(([, v]) => v)));
    const fds = new Map(ctx.fds);
    fds.set(0, { kind: "in", s: new InStream("") });
    return child.runScriptBody(src, fds);
  }
  ctx.err("bash-sim: nested interactive shells aren't supported — you are already in Bash.\n");
  return 0;
};

export const systemCommands: Record<string, CommandFn> = {
  whoami,
  hostname,
  uname,
  date,
  cal,
  id,
  groups,
  env,
  printenv,
  which,
  whereis,
  sleep,
  clear,
  tty,
  nproc,
  ps,
  timeout,
  nohup,
  man,
  expr,
  base64,
  bash,
  sh: bash,
  echo: delegate("echo"),
  printf: delegate("printf"),
  pwd: delegate("pwd"),
  test: delegate("test"),
  "[": delegate("["),
  true: () => 0,
  false: () => 1,
  kill: delegate("kill"),
};
