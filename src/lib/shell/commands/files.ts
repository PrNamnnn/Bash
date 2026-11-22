import type { CmdCtx, CommandFn } from "../shell";
import { baseName, compareNames, dirName, FsError, fsErrorText, isSymlink, modeString, normalizePath, sizeOf, USER, VFS, type FsNode } from "../vfs";
import { globToRegex, compileRegex } from "../pattern";
import { humanSize, isoDate, lsDate, parseDateSpec, parseOpts, q, usageError, last } from "./util";

const C = { dir: "\x1b[01;34m", exec: "\x1b[01;32m", reset: "\x1b[0m" };

function blocksKB(node: FsNode): number {
  if (node.type === "dir") return 4;
  const size = sizeOf(node);
  return Math.ceil(size / 4096) * 4;
}

function isExec(node: FsNode): boolean {
  return node.type === "file" && (node.mode & 0o111) !== 0;
}

function colorName(name: string, node: FsNode, color: boolean): string {
  if (!color) return name;
  if (isSymlink(node)) return `\x1b[1;36m${name}${C.reset}`;
  if (node.type === "dir") return `${C.dir}${name}${C.reset}`;
  if (isExec(node)) return `${C.exec}${name}${C.reset}`;
  return name;
}

function indicator(node: FsNode): string {
  if (isSymlink(node)) return "@";
  if (node.type === "dir") return "/";
  if (isExec(node)) return "*";
  return "";
}

function columnize(items: { plain: string; shown: string }[], width: number): string {
  if (!items.length) return "";
  const n = items.length;
  for (let cols = Math.min(n, Math.max(1, Math.floor(width / 3))); cols >= 1; cols--) {
    const rows = Math.ceil(n / cols);
    const widths: number[] = [];
    for (let c = 0; c * rows < n; c++) {
      const col = items.slice(c * rows, (c + 1) * rows);
      widths.push(Math.max(...col.map((i) => i.plain.length)) + 2);
    }
    const total = widths.reduce((a, b) => a + b, 0) - 2;
    if (total <= width || cols === 1) {
      const lines: string[] = [];
      for (let r = 0; r < rows; r++) {
        let line = "";
        for (let c = 0; c < widths.length; c++) {
          const it = items[c * rows + r];
          if (!it) continue;
          const isLast = c === widths.length - 1 || !items[(c + 1) * rows + r];
          line += isLast ? it.shown : it.shown + " ".repeat(widths[c] - it.plain.length);
        }
        lines.push(line);
      }
      return lines.join("\n") + "\n";
    }
  }
  return items.map((i) => i.shown).join("\n") + "\n";
}

/* ------------------------------------------------------------------ */

export const ls: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, {
    flags: "laAhR1tSrdFisgGnC",
    long: { all: "a", "almost-all": "A", "human-readable": "h", recursive: "R", reverse: "r", directory: "d", classify: "F", "color=": "--color" },
  });
  if (p.error) return usageError(ctx, p.error, 2);
  const f = p.flags;
  const long = f.has("l") || f.has("n") || f.has("g");
  const colorOpt = last(p, "--color");
  const color = colorOpt === "always" || (colorOpt !== "never" && ctx.stdoutIsTTY);
  const oneCol = f.has("1") || (!ctx.stdoutIsTTY && !f.has("C"));
  const { sh } = ctx;
  const fs = sh.fs;
  let status = 0;

  const sortEntries = (entries: { name: string; node: FsNode }[]) => {
    entries.sort((a, b) => compareNames(a.name, b.name));
    if (f.has("t")) entries.sort((a, b) => b.node.mtime - a.node.mtime);
    if (f.has("S")) entries.sort((a, b) => sizeOf(b.node) - sizeOf(a.node));
    if (f.has("r")) entries.reverse();
    return entries;
  };

  const longLines = (entries: { name: string; node: FsNode; path?: string }[]): string => {
    const rows = entries.map((e) => {
      const node = e.node;
      const links = node.type === "dir" ? 2 + [...node.children.values()].filter((c) => c.type === "dir").length : 1;
      const size = sizeOf(node);
      const owner = f.has("n") ? (node.owner === USER ? "1000" : "0") : node.owner;
      const group = f.has("n") ? (node.group === USER ? "1000" : "0") : node.group;
      return {
        inode: String(node.inode),
        mode: modeString(node),
        links: String(links),
        owner,
        group,
        size: f.has("h") ? humanSize(size) : String(size),
        date: lsDate(node.mtime),
        name: colorName(e.name, node, color) + (isSymlink(node) ? ` -> ${node.symlink}` : f.has("F") ? indicator(node) : ""),
      };
    });
    const w = (k: keyof (typeof rows)[number]) => Math.max(0, ...rows.map((r) => r[k].length));
    const wl = w("links");
    const wo = w("owner");
    const wg = w("group");
    const ws = w("size");
    const wi = w("inode");
    return rows
      .map(
        (r) =>
          `${f.has("i") ? r.inode.padStart(wi) + " " : ""}${r.mode} ${r.links.padStart(wl)} ${f.has("g") ? "" : r.owner.padEnd(wo) + " "}${f.has("G") ? "" : r.group.padEnd(wg) + " "}${r.size.padStart(ws)} ${r.date} ${r.name}\n`,
      )
      .join("");
  };

  const render = (entries: { name: string; node: FsNode }[]): string => {
    if (long) return longLines(entries);
    const items = entries.map((e) => {
      const plain = (f.has("i") ? `${e.node.inode} ` : "") + e.name + (f.has("F") ? indicator(e.node) : "");
      const shown = (f.has("i") ? `${e.node.inode} ` : "") + colorName(e.name, e.node, color) + (f.has("F") ? indicator(e.node) : "");
      return { plain, shown };
    });
    if (oneCol) return items.map((i) => i.shown + "\n").join("");
    return columnize(items, sh.columns);
  };

  const listDir = (abs: string, node: FsNode & { type: "dir" }): { name: string; node: FsNode }[] => {
    const entries: { name: string; node: FsNode }[] = [];
    if (f.has("a")) {
      entries.push({ name: ".", node });
      const parent = fs.lookup(dirName(abs)) ?? node;
      entries.push({ name: "..", node: parent });
    }
    for (const [name, child] of node.children) {
      if (name.startsWith(".") && !f.has("a") && !f.has("A")) continue;
      entries.push({ name, node: child });
    }
    return sortEntries(entries);
  };

  const operands = p.operands.length ? p.operands : ["."];
  const files: { name: string; node: FsNode }[] = [];
  const dirs: { name: string; abs: string; node: FsNode & { type: "dir" } }[] = [];
  for (const op of operands) {
    const abs = ctx.resolve(op);
    let node: FsNode;
    try {
      const own = fs.lookup(abs, false);
      node = isSymlink(own) && (long || f.has("d") || f.has("F")) && !op.endsWith("/") ? own : fs.get(abs);
    } catch (err) {
      if (err instanceof FsError) {
        ctx.err(`ls: cannot access ${q(op)}: ${fsErrorText[err.code]}\n`);
        status = 2;
        continue;
      }
      throw err;
    }
    if (node.type === "dir" && !f.has("d")) dirs.push({ name: op, abs, node });
    else files.push({ name: op, node });
  }
  let out = "";
  if (files.length) out += render(sortEntries(files));
  const showHeaders = dirs.length + files.length > 1 || f.has("R");
  const visit = (d: { name: string; abs: string; node: FsNode & { type: "dir" } }, first: boolean) => {
    if (!fs.canRead(d.node)) {
      ctx.err(`ls: cannot open directory ${q(d.name)}: Permission denied\n`);
      status = 2;
      return;
    }
    const entries = listDir(d.abs, d.node);
    if (showHeaders) out += `${first && !files.length ? "" : "\n"}${d.name}:\n`;
    if (long) {
      const total = entries.reduce((s, e) => s + blocksKB(e.node), 0);
      out += `total ${f.has("h") ? humanSize(total * 1024) : total}\n`;
    }
    out += render(entries);
    if (f.has("R")) {
      for (const e of entries) {
        if (e.node.type !== "dir" || e.name === "." || e.name === "..") continue;
        const childName = d.name === "/" ? `/${e.name}` : `${d.name.replace(/\/$/, "")}/${e.name}`;
        visit({ name: childName, abs: d.abs === "/" ? `/${e.name}` : `${d.abs}/${e.name}`, node: e.node as FsNode & { type: "dir" } }, false);
      }
    }
  };
  dirs.sort((a, b) => compareNames(a.name, b.name)).forEach((d, i) => visit(d, i === 0));
  ctx.out(out);
  return status;
};

export const mkdir: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, { flags: "pv", withArg: "m", long: { parents: "p", verbose: "v", "mode=": "m" } });
  if (p.error) return usageError(ctx, p.error);
  if (!p.operands.length) return usageError(ctx, "missing operand");
  let status = 0;
  for (const op of p.operands) {
    const abs = ctx.resolve(op);
    try {
      const existed = ctx.sh.fs.exists(abs);
      ctx.sh.fs.mkdir(abs, p.flags.has("p"));
      const mode = last(p, "m");
      if (mode && /^[0-7]+$/.test(mode)) {
        const n = ctx.sh.fs.lookup(abs);
        if (n) n.mode = parseInt(mode, 8);
      }
      if (p.flags.has("v") && !existed) ctx.out(`mkdir: created directory ${q(op)}\n`);
    } catch (err) {
      if (err instanceof FsError) {
        ctx.err(`mkdir: cannot create directory ${q(op)}: ${fsErrorText[err.code]}\n`);
        status = 1;
      } else throw err;
    }
  }
  return status;
};

export const rmdir: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, { flags: "pv", long: { parents: "p", verbose: "v" } });
  if (p.error) return usageError(ctx, p.error);
  if (!p.operands.length) return usageError(ctx, "missing operand");
  let status = 0;
  for (const op of p.operands) {
    const targets = [op];
    if (p.flags.has("p")) {
      let d = op;
      while ((d = dirName(d)) && d !== "." && d !== "/") targets.push(d);
    }
    for (const t of targets) {
      try {
        ctx.sh.fs.remove(ctx.resolve(t), { dirOnly: true });
        if (p.flags.has("v")) ctx.out(`rmdir: removing directory, ${q(t)}\n`);
      } catch (err) {
        if (err instanceof FsError) {
          ctx.err(`rmdir: failed to remove ${q(t)}: ${fsErrorText[err.code]}\n`);
          status = 1;
          break;
        }
        throw err;
      }
    }
  }
  return status;
};

export const touch: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, { flags: "camf", withArg: "dtr", long: { "no-create": "c", "date=": "d", "reference=": "r" } });
  if (p.error) return usageError(ctx, p.error);
  if (!p.operands.length) return usageError(ctx, "missing file operand");
  let status = 0;
  let when = Date.now();
  const ref = last(p, "r");
  if (ref) {
    const n = ctx.sh.fs.lookup(ctx.resolve(ref));
    if (!n) {
      ctx.err(`touch: failed to get attributes of ${q(ref)}: No such file or directory\n`);
      return 1;
    }
    when = n.mtime;
  }
  const d = last(p, "d");
  if (d) {
    const t = parseDateSpec(d)?.getTime() ?? NaN;
    if (Number.isNaN(t)) {
      ctx.err(`touch: invalid date format ${q(d)}\n`);
      return 1;
    }
    when = t;
  }
  for (const op of p.operands) {
    const abs = ctx.resolve(op);
    try {
      const n = ctx.sh.fs.lookup(abs);
      if (n) n.mtime = when;
      else if (!p.flags.has("c")) {
        ctx.sh.fs.writeFile(abs, "");
        const created = ctx.sh.fs.lookup(abs);
        if (created) created.mtime = when;
      }
    } catch (err) {
      if (err instanceof FsError) {
        ctx.err(`touch: cannot touch ${q(op)}: ${fsErrorText[err.code]}\n`);
        status = 1;
      } else throw err;
    }
  }
  return status;
};

function confirm(ctx: CmdCtx, prompt: string): boolean {
  ctx.err(prompt);
  const r = ctx.stdin.readUntil("\n");
  const ans = r?.text ?? "";
  if (!r) ctx.err("\n");
  return /^[yY]/.test(ans.trim());
}

export const rm: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, {
    flags: "rRfivdI",
    long: { recursive: "r", force: "f", interactive: "i", verbose: "v", dir: "d", "no-preserve-root": "--npr", "preserve-root": "--pr" },
  });
  if (p.error) return usageError(ctx, p.error);
  const f = p.flags;
  const recursive = f.has("r") || f.has("R");
  if (!p.operands.length) {
    if (f.has("f")) return 0;
    return usageError(ctx, "missing operand");
  }
  const fs = ctx.sh.fs;
  let status = 0;
  for (const op of p.operands) {
    const abs = ctx.resolve(op);
    if (abs === "/" && recursive && !f.has("--npr")) {
      ctx.err("rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe\n");
      status = 1;
      continue;
    }
    if (/(^|\/)\.\.?\/?$/.test(op)) {
      ctx.err(`rm: refusing to remove '.' or '..' directory: skipping ${q(op)}\n`);
      status = 1;
      continue;
    }
    const node = op === "" ? undefined : fs.lookup(abs, false);
    if (!node) {
      if (!f.has("f") || op === "") {
        ctx.err(`rm: cannot remove ${q(op)}: No such file or directory\n`);
        status = 1;
      }
      continue;
    }
    if (node.type === "dir" && !recursive && !f.has("d")) {
      ctx.err(`rm: cannot remove ${q(op)}: Is a directory\n`);
      status = 1;
      continue;
    }
    if (f.has("i")) {
      const kind = node.type === "dir" ? "directory" : node.content === "" ? "regular empty file" : "regular file";
      if (!confirm(ctx, `rm: remove ${kind} ${q(op)}? `)) continue;
    }
    try {
      if (f.has("v") && recursive && node.type === "dir") {
        const paths = [...fs.walk(abs)].reverse();
        for (const w of paths) {
          const rel = op.replace(/\/$/, "") + w.path.slice(abs.length);
          ctx.out(w.node.type === "dir" ? `removed directory ${q(rel)}\n` : `removed ${q(rel)}\n`);
        }
      } else if (f.has("v")) ctx.out(node.type === "dir" ? `removed directory ${q(op)}\n` : `removed ${q(op)}\n`);
      fs.remove(abs, { recursive, dirOnly: f.has("d") && node.type === "dir" });
    } catch (err) {
      if (err instanceof FsError) {
        ctx.err(`rm: cannot remove ${q(op)}: ${fsErrorText[err.code]}\n`);
        status = 1;
      } else throw err;
    }
  }
  return status;
};

function copyOrMove(ctx: CmdCtx, move: boolean): number {
  const name = move ? "mv" : "cp";
  const p = parseOpts(ctx.args, {
    flags: move ? "finvuT" : "rRfinvpauT",
    withArg: "t",
    long: { recursive: "r", force: "f", interactive: "i", "no-clobber": "n", verbose: "v", archive: "a", preserve: "p", "target-directory=": "t", update: "u" },
  });
  if (p.error) return usageError(ctx, p.error);
  const f = p.flags;
  const fs = ctx.sh.fs;
  const recursive = move || f.has("r") || f.has("R") || f.has("a");
  const preserve = move || f.has("p") || f.has("a");
  const operands = [...p.operands];
  let targetOp = last(p, "t");
  if (!targetOp) {
    if (operands.length < 2) {
      if (!operands.length) return usageError(ctx, "missing file operand");
      return usageError(ctx, `missing destination file operand after ${q(operands[0])}`);
    }
    targetOp = operands.pop()!;
  }
  const targetAbs = ctx.resolve(targetOp);
  const targetIsDir = fs.isDir(targetAbs) && !f.has("T");
  if (operands.length > 1 && !targetIsDir) {
    ctx.err(`${name}: target ${q(targetOp)} is not a directory\n`);
    return 1;
  }
  let status = 0;
  for (const op of operands) {
    const srcAbs = ctx.resolve(op);
    let src: FsNode;
    try {
      src = fs.get(srcAbs, !(move || f.has("a")));
    } catch (err) {
      if (err instanceof FsError) {
        ctx.err(`${name}: cannot stat ${q(op)}: ${fsErrorText[err.code]}\n`);
        status = 1;
        continue;
      }
      throw err;
    }
    if (src.type === "dir" && !recursive) {
      ctx.err(`cp: -r not specified; omitting directory ${q(op)}\n`);
      status = 1;
      continue;
    }
    // `cp -a src/. dest/` copies the *contents* of src into dest (the last component is ".").
    const contentsOf = src.type === "dir" && /(^|\/)\.\/*$/.test(op);
    const intoDir = targetIsDir && !contentsOf;
    const destAbs = intoDir ? normalizePath(`${targetAbs}/${baseName(srcAbs)}`, "/") : targetAbs;
    const destShown = intoDir ? `${targetOp.replace(/\/$/, "")}/${baseName(srcAbs)}` : targetOp;
    if (destAbs === srcAbs) {
      ctx.err(`${name}: ${q(op)} and ${q(destShown)} are the same file\n`);
      status = 1;
      continue;
    }
    if (src.type === "dir" && (destAbs + "/").startsWith(srcAbs + "/")) {
      ctx.err(
        move
          ? `mv: cannot move ${q(op)} to a subdirectory of itself, ${q(destShown)}\n`
          : `cp: cannot copy a directory, ${q(op)}, into itself, ${q(destShown)}\n`,
      );
      status = 1;
      continue;
    }
    const existingRaw = fs.lookup(destAbs, false);
    // mv replaces a symlink at the destination; cp writes through it.
    const existing = isSymlink(existingRaw) && !move ? fs.lookup(destAbs) : existingRaw;
    if (existing) {
      if (f.has("n")) continue;
      if (f.has("u") && existing.mtime >= src.mtime) continue;
      if (f.has("i") && !f.has("f") && !confirm(ctx, `${name}: overwrite ${q(destShown)}? `)) continue;
      if (existing.type === "dir" && src.type !== "dir") {
        ctx.err(`${name}: cannot overwrite directory ${q(destShown)} with non-directory\n`);
        status = 1;
        continue;
      }
      if (existing.type !== "dir" && src.type === "dir") {
        ctx.err(`${name}: cannot overwrite non-directory ${q(destShown)} with directory ${q(op)}\n`);
        status = 1;
        continue;
      }
    }
    try {
      if (move) {
        const node = fs.detach(srcAbs);
        if (existing && existing.type === "dir" && node.type === "dir") {
          if (existing.children.size) {
            fs.put(srcAbs, node);
            ctx.err(`mv: cannot move ${q(op)} to ${q(destShown)}: Directory not empty\n`);
            status = 1;
            continue;
          }
        }
        fs.put(destAbs, node);
      } else {
        const copy = VFS.cloneNode(src, preserve);
        if (!preserve) {
          const stamp = (n: FsNode) => {
            n.mtime = Date.now();
            n.owner = USER;
            n.group = USER;
            if (n.type === "dir") n.children.forEach(stamp);
          };
          stamp(copy);
        }
        if (existing && existing.type === "dir" && copy.type === "dir") {
          for (const [k, v] of copy.children) existing.children.set(k, v);
        } else if (existing && existing.type === "file" && copy.type === "file") {
          fs.writeFile(destAbs, copy.content);
        } else fs.put(destAbs, copy);
      }
      if (f.has("v")) ctx.out(move ? `renamed ${q(op)} -> ${q(destShown)}\n` : `${q(op)} -> ${q(destShown)}\n`);
    } catch (err) {
      if (err instanceof FsError) {
        ctx.err(`${name}: cannot ${move ? "move" : "create regular file"} ${q(destShown)}: ${fsErrorText[err.code]}\n`);
        status = 1;
      } else throw err;
    }
  }
  return status;
}

export const cp: CommandFn = (ctx) => copyOrMove(ctx, false);
export const mv: CommandFn = (ctx) => copyOrMove(ctx, true);

export const file: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, { flags: "bLi", long: { brief: "b", "mime-type": "i" } });
  if (p.error) return usageError(ctx, p.error);
  if (!p.operands.length) return usageError(ctx, "missing file operand");
  for (const op of p.operands) {
    const node = ctx.sh.fs.lookup(ctx.resolve(op));
    let desc: string;
    if (!node) desc = `cannot open \`${op}' (No such file or directory)`;
    else if (node.type === "dir") desc = "directory";
    else {
      const c = node.content;
      const exe = (node.mode & 0o111) !== 0;
      if (/^#!\/sim\/bin\//.test(c)) desc = "ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), dynamically linked, stripped";
      else if (c === "") desc = "empty";
      else if (/^#!.*\b(bash)\b/.test(c)) desc = `Bourne-Again shell script, ASCII text${exe ? " executable" : ""}`;
      else if (/^#!.*\bsh\b/.test(c)) desc = `POSIX shell script, ASCII text${exe ? " executable" : ""}`;
      else if (/^#!.*python/.test(c)) desc = `Python script, ASCII text${exe ? " executable" : ""}`;
      else if (/^\s*[{[]/.test(c) && /[}\]]\s*$/.test(c)) desc = "JSON text data";
      else if (/^[^\n]*,[^\n]*\n/.test(c) && op.endsWith(".csv")) desc = "CSV ASCII text";
      else if (/[^\x00-\x7f]/.test(c)) desc = "Unicode text, UTF-8 text";
      else desc = "ASCII text";
      if (/\r\n/.test(c)) desc += ", with CRLF line terminators";
      if (p.flags.has("i")) desc = node.content === "" ? "inode/x-empty" : desc.includes("ELF") ? "application/x-pie-executable" : desc.includes("shell") ? "text/x-shellscript" : desc.includes("JSON") ? "application/json" : desc.includes("CSV") ? "text/csv" : "text/plain";
    }
    ctx.out(p.flags.has("b") ? `${desc}\n` : `${op}: ${desc}\n`);
  }
  return 0;
};

export const stat: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, { flags: "Lt", withArg: "cf", long: { "format=": "c", "printf=": "c" } });
  if (p.error) return usageError(ctx, p.error);
  if (!p.operands.length) return usageError(ctx, "missing operand");
  let status = 0;
  const fmt = last(p, "c");
  for (const op of p.operands) {
    const node = ctx.sh.fs.lookup(ctx.resolve(op));
    if (!node) {
      ctx.err(`stat: cannot statx ${q(op)}: No such file or directory\n`);
      status = 1;
      continue;
    }
    const size = sizeOf(node);
    const type = node.type === "dir" ? "directory" : size === 0 ? "regular empty file" : "regular file";
    const octal = (node.mode & 0o7777).toString(8);
    const uid = node.owner === USER ? 1000 : 0;
    if (fmt !== undefined) {
      const out = fmt.replace(/%([nsaAUGugFyYihbB%])/g, (_, c: string) => {
        switch (c) {
          case "n": return op;
          case "s": return String(size);
          case "a": return octal;
          case "A": return modeString(node);
          case "U": return node.owner;
          case "G": return node.group;
          case "u": return String(uid);
          case "g": return String(uid);
          case "F": return type;
          case "y": return isoDate(node.mtime);
          case "Y": return String(Math.floor(node.mtime / 1000));
          case "i": return String(node.inode);
          case "h": return node.type === "dir" ? "2" : "1";
          case "b": return String(blocksKB(node) * 2);
          case "B": return "512";
          case "%": return "%";
        }
        return c;
      });
      ctx.out(out.replace(/\\n/g, "\n").replace(/\\t/g, "\t") + "\n");
      continue;
    }
    const t = isoDate(node.mtime);
    ctx.out(
      `  File: ${op}\n` +
        `  Size: ${String(size).padEnd(10)}\tBlocks: ${String(blocksKB(node) * 2).padEnd(10)} IO Block: 4096   ${type}\n` +
        `Device: 8,1\tInode: ${String(node.inode).padEnd(11)} Links: ${node.type === "dir" ? 2 : 1}\n` +
        `Access: (${octal.padStart(4, "0")}/${modeString(node)})  Uid: (${String(uid).padStart(5)}/${node.owner.padStart(8)})   Gid: (${String(uid).padStart(5)}/${node.group.padStart(8)})\n` +
        `Access: ${t}\nModify: ${t}\nChange: ${t}\n Birth: -\n`,
    );
  }
  return status;
};

export const tree: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, { flags: "adFfi", withArg: "L", long: { dirsfirst: "--df" } });
  if (p.error) return usageError(ctx, p.error);
  const maxDepth = last(p, "L") ? Number(last(p, "L")) : Infinity;
  const fs = ctx.sh.fs;
  const roots = p.operands.length ? p.operands : ["."];
  let dirsCount = 0;
  let filesCount = 0;
  let out = "";
  const color = ctx.stdoutIsTTY;
  const walk = (node: FsNode & { type: "dir" }, prefix: string, depth: number) => {
    if (depth > maxDepth) return;
    let names = [...node.children.keys()].filter((n) => p.flags.has("a") || !n.startsWith("."));
    if (p.flags.has("d")) names = names.filter((n) => node.children.get(n)!.type === "dir");
    names.sort(compareNames);
    if (p.flags.has("--df")) names.sort((a, b) => Number(node.children.get(b)!.type === "dir") - Number(node.children.get(a)!.type === "dir"));
    names.forEach((n, i) => {
      const child = node.children.get(n)!;
      const lastItem = i === names.length - 1;
      out += `${prefix}${lastItem ? "└── " : "├── "}${colorName(n, child, color)}${p.flags.has("F") ? indicator(child) : ""}\n`;
      if (child.type === "dir") {
        dirsCount++;
        if (fs.canRead(child)) walk(child, prefix + (lastItem ? "    " : "│   "), depth + 1);
      } else filesCount++;
    });
  };
  for (const r of roots) {
    const node = fs.lookup(ctx.resolve(r));
    if (!node) {
      out += `${r}  [error opening dir]\n`;
      continue;
    }
    out += (color && node.type === "dir" ? `${C.dir}${r}${C.reset}` : r) + "\n";
    if (node.type === "dir") walk(node, "", 1);
  }
  out += `\n${dirsCount} director${dirsCount === 1 ? "y" : "ies"}${p.flags.has("d") ? "" : `, ${filesCount} file${filesCount === 1 ? "" : "s"}`}\n`;
  ctx.out(out);
  return 0;
};

export const basename: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, { flags: "az", withArg: "s", long: { multiple: "a", "suffix=": "s", zero: "z" } });
  if (p.error) return usageError(ctx, p.error);
  if (!p.operands.length) return usageError(ctx, "missing operand");
  const suffix = last(p, "s");
  const multiple = p.flags.has("a") || suffix !== undefined;
  const names = multiple ? p.operands : [p.operands[0]];
  const suf = multiple ? suffix : p.operands[1];
  if (!multiple && p.operands.length > 2) return usageError(ctx, `extra operand ${q(p.operands[2])}`);
  for (const n of names) {
    let b = baseName(n);
    if (suf && b.endsWith(suf) && b !== suf) b = b.slice(0, -suf.length);
    ctx.out(b + (p.flags.has("z") ? "\0" : "\n"));
  }
  return 0;
};

export const dirname: CommandFn = (ctx) => {
  if (!ctx.args.length) return usageError(ctx, "missing operand");
  for (const a of ctx.args) ctx.out(dirName(a) + "\n");
  return 0;
};

export const realpath: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, { flags: "emsqz", long: { "relative-to=": "--rel" } });
  if (p.error) return usageError(ctx, p.error);
  let status = 0;
  for (const op of p.operands) {
    const abs = ctx.resolve(op);
    const real = p.flags.has("s") ? abs : ctx.sh.fs.realpath(abs);
    if (real !== undefined) {
      ctx.out(real + "\n");
      continue;
    }
    // A missing final component is allowed (like GNU realpath without -e) if its directory exists.
    const parent = ctx.sh.fs.realpath(dirName(abs));
    if (parent === undefined || p.flags.has("e")) {
      if (!p.flags.has("q")) ctx.err(`${ctx.name}: ${op}: No such file or directory\n`);
      status = 1;
      continue;
    }
    ctx.out(normalizePath(baseName(abs), parent) + "\n");
  }
  return status;
};

export const readlink: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, {
    flags: "femnqsvz",
    long: { canonicalize: "f", "canonicalize-existing": "e", "canonicalize-missing": "m", "no-newline": "n" },
  });
  if (p.error) return usageError(ctx, p.error);
  if (p.flags.has("f") || p.flags.has("e") || p.flags.has("m")) {
    return realpath({ ...ctx, args: [...(p.flags.has("e") ? ["-e"] : []), "-q", ...p.operands] });
  }
  let status = 0;
  for (const op of p.operands) {
    const node = ctx.sh.fs.lookup(ctx.resolve(op), false);
    if (!isSymlink(node)) {
      if (p.flags.has("v")) ctx.err(`readlink: ${op}: Invalid argument\n`);
      status = 1;
      continue;
    }
    ctx.out(node.symlink + (p.flags.has("n") ? "" : "\n"));
  }
  return status;
};

function applySymbolic(mode: number, spec: string, isDir: boolean, umask: number): number | null {
  let m = mode;
  for (const clause of spec.split(",")) {
    const cm = clause.match(/^([ugoa]*)((?:[-+=][rwxXst]*)+)$/);
    if (!cm) return null;
    const who = cm[1] || "a";
    const useUmask = cm[1] === "";
    const ops = cm[2].match(/[-+=][rwxXst]*/g)!;
    for (const op of ops) {
      const sign = op[0];
      const perms = op.slice(1);
      let bits = 0;
      const shifts: number[] = [];
      if (who.includes("u") || who.includes("a")) shifts.push(6);
      if (who.includes("g") || who.includes("a")) shifts.push(3);
      if (who.includes("o") || who.includes("a")) shifts.push(0);
      for (const s of shifts) {
        let b = 0;
        if (perms.includes("r")) b |= 4;
        if (perms.includes("w")) b |= 2;
        if (perms.includes("x")) b |= 1;
        if (perms.includes("X") && (isDir || (mode & 0o111) !== 0)) b |= 1;
        bits |= b << s;
      }
      if (perms.includes("s")) {
        if (who.includes("u") || who.includes("a")) bits |= 0o4000;
        if (who.includes("g") || who.includes("a")) bits |= 0o2000;
      }
      if (perms.includes("t")) bits |= 0o1000;
      if (useUmask && sign !== "-") bits &= ~umask;
      if (sign === "+") m |= bits;
      else if (sign === "-") m &= ~bits;
      else {
        let mask = 0;
        for (const s of shifts) mask |= 7 << s;
        m = (m & ~mask) | bits;
      }
    }
  }
  return m;
}

export const chmod: CommandFn = (ctx) => {
  const args = [...ctx.args];
  const flags = new Set<string>();
  while (args.length && /^-[Rvcf]+$/.test(args[0])) for (const c of args.shift()!.slice(1)) flags.add(c);
  const [mode, ...files] = args;
  if (!mode) return usageError(ctx, "missing operand");
  if (!files.length) return usageError(ctx, `missing operand after ${q(mode)}`);
  const fs = ctx.sh.fs;
  let status = 0;
  const apply = (abs: string, shown: string, node: FsNode) => {
    if (node.owner !== USER) {
      ctx.err(`chmod: changing permissions of ${q(shown)}: Operation not permitted\n`);
      status = 1;
      return;
    }
    let next: number | null;
    if (/^[0-7]{1,4}$/.test(mode)) next = parseInt(mode, 8);
    else next = applySymbolic(node.mode, mode, node.type === "dir", fs.umask);
    if (next === null) {
      ctx.err(`chmod: invalid mode: ${q(mode)}\nTry 'chmod --help' for more information.\n`);
      status = 1;
      return;
    }
    const old = node.mode;
    node.mode = next;
    if (flags.has("v") || (flags.has("c") && old !== next)) {
      ctx.out(`mode of ${q(shown)} changed from ${old.toString(8).padStart(4, "0")} (${modeString({ ...node, mode: old }).slice(1)}) to ${next.toString(8).padStart(4, "0")} (${modeString(node).slice(1)})\n`);
    }
    void abs;
  };
  for (const f of files) {
    const abs = ctx.resolve(f);
    const node = fs.lookup(abs);
    if (!node) {
      ctx.err(`chmod: cannot access ${q(f)}: No such file or directory\n`);
      status = 1;
      continue;
    }
    if (flags.has("R")) {
      for (const w of fs.walk(abs)) apply(w.path, f + w.path.slice(abs.length), w.node);
    } else apply(abs, f, node);
  }
  return status;
};

export const chown: CommandFn = (ctx) => {
  const args = ctx.args.filter((a) => !/^-[Rvhcf]+$/.test(a));
  const [owner, ...files] = args;
  if (!owner || !files.length) return usageError(ctx, "missing operand");
  let status = 0;
  for (const f of files) {
    const node = ctx.sh.fs.lookup(ctx.resolve(f));
    if (!node) {
      ctx.err(`${ctx.name}: cannot access ${q(f)}: No such file or directory\n`);
      status = 1;
      continue;
    }
    const [u, g] = owner.split(":");
    if ((u && u !== USER) || (g && g !== USER) || node.owner !== USER) {
      ctx.err(`${ctx.name}: changing ownership of ${q(f)}: Operation not permitted\n`);
      status = 1;
    }
  }
  if (status && !ctx.sh.notices.has("chown")) {
    ctx.sh.notices.add("chown");
    ctx.err("bash-sim: hint: only root may give files away; on a real system you would use sudo.\n");
  }
  return status;
};

export const du: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, { flags: "shacbk", withArg: "d", long: { summarize: "s", "human-readable": "h", all: "a", total: "c", "max-depth=": "d" } });
  if (p.error) return usageError(ctx, p.error);
  const fs = ctx.sh.fs;
  const maxDepth = p.flags.has("s") ? 0 : last(p, "d") !== undefined ? Number(last(p, "d")) : Infinity;
  const fmt = (kb: number) => (p.flags.has("h") ? (kb === 0 ? "0" : humanSize(kb * 1024)) : p.flags.has("b") ? String(kb * 1024) : String(kb));
  let total = 0;
  let status = 0;
  const lines: string[] = [];
  const size = (node: FsNode, shown: string, depth: number): number => {
    if (node.type === "file") {
      const s = blocksKB(node);
      if (p.flags.has("a") && depth <= maxDepth) lines.push(`${fmt(s)}\t${shown}`);
      return s;
    }
    let s = 4;
    for (const n of [...node.children.keys()].sort(compareNames)) {
      s += size(node.children.get(n)!, `${shown.replace(/\/$/, "")}/${n}`, depth + 1);
    }
    if (depth <= maxDepth) lines.push(`${fmt(s)}\t${shown}`);
    return s;
  };
  for (const op of p.operands.length ? p.operands : ["."]) {
    const node = fs.lookup(ctx.resolve(op));
    if (!node) {
      ctx.err(`du: cannot access ${q(op)}: No such file or directory\n`);
      status = 1;
      continue;
    }
    const s = size(node, op, 0);
    if (node.type === "file" && !p.flags.has("a")) lines.push(`${fmt(s)}\t${op}`);
    total += s;
  }
  if (p.flags.has("c")) lines.push(`${fmt(total)}\ttotal`);
  ctx.out(lines.map((l) => l + "\n").join(""));
  return status;
};

export const df: CommandFn = (ctx) => {
  const human = ctx.args.some((a) => /^-\w*h/.test(a));
  let used = 0;
  for (const w of ctx.sh.fs.walk("/")) used += blocksKB(w.node);
  const total = 20_511_312;
  const usedTotal = 7_340_032 + used;
  const avail = total - usedTotal - 1_048_576;
  const pct = Math.ceil((usedTotal / (usedTotal + avail)) * 100);
  const f = (kb: number) => (human ? humanSize(kb * 1024) : String(kb));
  ctx.out(
    `Filesystem     ${human ? "Size  Used Avail" : "1K-blocks    Used Available"} Use% Mounted on\n` +
      `/dev/sda1      ${human ? f(total).padStart(4) + " " + f(usedTotal).padStart(5) + " " + f(avail).padStart(5) : String(total).padStart(9) + " " + String(usedTotal).padStart(7) + " " + String(avail).padStart(9)} ${String(pct).padStart(3)}% /\n` +
      `tmpfs          ${human ? "  2.0G     0  2.0G" : "  2097152       0   2097152"}   0% /dev/shm\n`,
  );
  if (!ctx.sh.notices.has("df")) {
    ctx.sh.notices.add("df");
    ctx.err("bash-sim: note: disk figures are simulated; run df -h on a real machine to see yours.\n");
  }
  return 0;
};

export const mktemp: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, { flags: "dqut", withArg: "p", long: { directory: "d", "tmpdir=": "p", quiet: "q", "dry-run": "u" } });
  if (p.error) return usageError(ctx, p.error);
  const template = p.operands[0] ?? "tmp.XXXXXXXXXX";
  // GNU: the X's must be in the last path component; anything after them is an implied --suffix.
  const m = template.match(/X{3,}(?=[^/X]*$)/);
  if (!m || m.index === undefined) {
    ctx.err(`mktemp: too few X's in template ${q(template)}\n`);
    return 1;
  }
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const rand = () => [...m[0]].map(() => chars[Math.floor(Math.random() * chars.length)]).join("");
  const dir = last(p, "p") ?? (p.operands[0] && !p.flags.has("t") ? "" : ctx.env.get("TMPDIR") || "/tmp");
  const name = template.slice(0, m.index) + rand() + template.slice(m.index + m[0].length);
  const path = dir ? `${dir.replace(/\/$/, "")}/${name}` : name;
  const abs = ctx.resolve(path);
  try {
    if (!p.flags.has("u")) {
      if (p.flags.has("d")) {
        ctx.sh.fs.mkdir(abs);
        ctx.sh.fs.lookup(abs)!.mode = 0o700;
      } else {
        ctx.sh.fs.writeFile(abs, "");
        ctx.sh.fs.lookup(abs)!.mode = 0o600;
      }
    }
  } catch (err) {
    if (err instanceof FsError) {
      ctx.err(`mktemp: failed to create ${p.flags.has("d") ? "directory" : "file"} via template ${q(path)}: ${fsErrorText[err.code]}\n`);
      return 1;
    }
    throw err;
  }
  ctx.out(path + "\n");
  return 0;
};

export const ln: CommandFn = (ctx) => {
  const p = parseOpts(ctx.args, {
    flags: "sfnTvri",
    withArg: "t",
    long: { symbolic: "s", force: "f", "no-dereference": "n", "no-target-directory": "T", verbose: "v", relative: "r", "target-directory=": "t" },
  });
  if (p.error) return usageError(ctx, p.error);
  const f = p.flags;
  const fs = ctx.sh.fs;
  const operands = [...p.operands];
  if (!operands.length) return usageError(ctx, "missing file operand");
  let dirOp = last(p, "t");
  if (!dirOp && operands.length === 1) dirOp = ".";
  // ln TARGET LINK_NAME  or  ln TARGET... DIRECTORY
  let linkOp: string | undefined;
  if (!dirOp) {
    const lastOp = operands[operands.length - 1];
    const lastAbs = ctx.resolve(lastOp);
    const own = fs.lookup(lastAbs, false);
    const isDirTarget = !f.has("T") && fs.isDir(lastAbs) && !(f.has("n") && isSymlink(own));
    if (isDirTarget) dirOp = operands.pop();
    else if (operands.length === 2) linkOp = operands.pop();
    else {
      ctx.err(`ln: target ${q(lastOp)} is not a directory\n`);
      return 1;
    }
  }
  const fail = (what: string, shown: string, err: unknown): number => {
    if (err instanceof FsError) {
      ctx.err(`ln: failed to create ${what} ${q(shown)}: ${fsErrorText[err.code]}\n`);
      return 1;
    }
    throw err;
  };
  let status = 0;
  for (const target of operands) {
    const shown = linkOp ?? `${dirOp!.replace(/\/$/, "")}/${baseName(target)}`;
    const linkAbs = ctx.resolve(shown);
    const what = f.has("s") ? "symbolic link" : "hard link";
    const existing = fs.lookup(linkAbs, false);
    if (existing) {
      if (!f.has("f")) {
        ctx.err(`ln: failed to create ${what} ${q(shown)}: File exists\n`);
        status = 1;
        continue;
      }
      if (existing.type === "dir") {
        ctx.err(`ln: ${q(shown)}: cannot overwrite directory\n`);
        status = 1;
        continue;
      }
    }
    if (!f.has("s")) {
      // A hard link is the same node under a second name.
      let node: FsNode;
      try {
        node = fs.get(ctx.resolve(target));
      } catch (err) {
        if (err instanceof FsError) {
          ctx.err(`ln: failed to access ${q(target)}: ${fsErrorText[err.code]}\n`);
          status = 1;
          continue;
        }
        throw err;
      }
      if (node.type === "dir") {
        ctx.err(`ln: ${q(target)}: hard link not allowed for directory\n`);
        status = 1;
        continue;
      }
      try {
        if (existing) fs.remove(linkAbs);
        fs.put(linkAbs, node);
      } catch (err) {
        status = fail(what, shown, err);
        continue;
      }
      if (f.has("v")) ctx.out(`${q(shown)} => ${q(target)}\n`);
      continue;
    }
    try {
      if (existing) fs.remove(linkAbs);
      fs.symlink(target, linkAbs);
    } catch (err) {
      status = fail(what, shown, err);
      continue;
    }
    if (f.has("v")) ctx.out(`${q(shown)} -> ${q(target)}\n`);
  }
  return status;
};

/* ------------------------------------------------------------------ */
/* find                                                                */
/* ------------------------------------------------------------------ */

type FindNode =
  | { t: "and" | "or"; l: FindNode; r: FindNode }
  | { t: "not"; e: FindNode }
  | { t: "test"; name: string; arg?: string }
  | { t: "exec"; argv: string[]; plus: boolean; collected: string[] };

export const find: CommandFn = (ctx) => {
  const args = ctx.args;
  const fs = ctx.sh.fs;
  let i = 0;
  const starts: string[] = [];
  while (i < args.length && !args[i].startsWith("-") && args[i] !== "(" && args[i] !== "!") starts.push(args[i++]);
  if (!starts.length) starts.push(".");
  const toks = args.slice(i);
  let maxDepth = Infinity;
  let minDepth = 0;
  let depthFirst = false;
  let hasAction = false;
  let pos = 0;
  const execNodes: FindNode[] = [];

  const ARG_TESTS = new Set(["-name", "-iname", "-path", "-ipath", "-wholename", "-type", "-size", "-newer", "-mtime", "-mmin", "-perm", "-user", "-group", "-regex", "-iregex", "-printf", "-maxdepth", "-mindepth", "-atime", "-ctime", "-links", "-fprint"]);
  const NOARG = new Set(["-print", "-print0", "-delete", "-empty", "-prune", "-quit", "-true", "-false", "-readable", "-writable", "-executable", "-ls", "-depth", "-daystart", "-mount", "-xdev", "-nouser", "-nogroup"]);

  const parseOr = (): FindNode => {
    let l = parseAnd();
    while (toks[pos] === "-o" || toks[pos] === "-or") {
      pos++;
      l = { t: "or", l, r: parseAnd() };
    }
    return l;
  };
  const parseAnd = (): FindNode => {
    let l = parseNot();
    while (pos < toks.length && toks[pos] !== "-o" && toks[pos] !== "-or" && toks[pos] !== ")") {
      if (toks[pos] === "-a" || toks[pos] === "-and") pos++;
      l = { t: "and", l, r: parseNot() };
    }
    return l;
  };
  const parseNot = (): FindNode => {
    if (toks[pos] === "!" || toks[pos] === "-not") {
      pos++;
      return { t: "not", e: parseNot() };
    }
    return parsePrimary();
  };
  const parsePrimary = (): FindNode => {
    const t = toks[pos++];
    if (t === undefined) throw new Error("expected expression");
    if (t === "(") {
      const e = parseOr();
      if (toks[pos++] !== ")") throw new Error("invalid expression; I was expecting to find a ')' somewhere but did not see one.");
      return e;
    }
    if (t === "-exec" || t === "-execdir" || t === "-ok") {
      const argv: string[] = [];
      while (pos < toks.length && toks[pos] !== ";" && !(toks[pos] === "+" && argv[argv.length - 1] === "{}")) argv.push(toks[pos++]);
      if (pos >= toks.length) throw new Error(`missing argument to \`${t}'`);
      const plus = toks[pos] === "+";
      pos++;
      hasAction = true;
      const n: FindNode = { t: "exec", argv, plus, collected: [] };
      execNodes.push(n);
      return n;
    }
    if (ARG_TESTS.has(t)) {
      const arg = toks[pos++];
      if (arg === undefined) throw new Error(`missing argument to \`${t}'`);
      if (t === "-maxdepth") maxDepth = Number(arg);
      if (t === "-mindepth") minDepth = Number(arg);
      if (t === "-printf" || t === "-fprint") hasAction = true;
      return { t: "test", name: t, arg };
    }
    if (NOARG.has(t)) {
      if (["-print", "-print0", "-delete", "-ls", "-quit"].includes(t)) hasAction = true;
      if (t === "-delete" || t === "-depth") depthFirst = true;
      return { t: "test", name: t };
    }
    throw new Error(`unknown predicate \`${t}'`);
  };

  let expr: FindNode | undefined;
  try {
    if (toks.length) expr = parseOr();
    if (pos < toks.length) throw new Error(`paths must precede expression: \`${toks[pos]}'`);
  } catch (err) {
    ctx.err(`find: ${(err as Error).message}\n`);
    return 1;
  }

  const now = Date.now();
  let status = 0;
  let quit = false;
  let pruned = false;

  const sizeMatch = (bytes: number, spec: string): boolean => {
    const m = spec.match(/^([+-]?)(\d+)([cwbkMG]?)$/);
    if (!m) return false;
    const unit = { c: 1, w: 2, b: 512, k: 1024, M: 1024 ** 2, G: 1024 ** 3, "": 512 }[m[3]]!;
    const n = Number(m[2]);
    const v = Math.ceil(bytes / unit);
    return m[1] === "+" ? v > n : m[1] === "-" ? v < n : v === n;
  };
  const numMatch = (v: number, spec: string): boolean => {
    const m = spec.match(/^([+-]?)(\d+)$/);
    if (!m) return false;
    const n = Number(m[2]);
    return m[1] === "+" ? v > n : m[1] === "-" ? v < n : v === n;
  };

  const evaluate = (e: FindNode, path: string, node: FsNode, depth: number): boolean => {
    switch (e.t) {
      case "and": return evaluate(e.l, path, node, depth) && evaluate(e.r, path, node, depth);
      case "or": return evaluate(e.l, path, node, depth) || evaluate(e.r, path, node, depth);
      case "not": return !evaluate(e.e, path, node, depth);
      case "exec": {
        const name = path;
        if (e.plus) {
          e.collected.push(name);
          return true;
        }
        const argv = e.argv.map((a) => a.replace(/\{\}/g, name));
        return runCmd(ctx, argv) === 0;
      }
      case "test": {
        const base = path === "/" ? "/" : baseName(path);
        const a = e.arg ?? "";
        switch (e.name) {
          case "-name": return globToRegex(a).test(base);
          case "-iname": return globToRegex(a, { nocase: true }).test(base);
          case "-path":
          case "-wholename": return globToRegex(a).test(path);
          case "-ipath": return globToRegex(a, { nocase: true }).test(path);
          case "-regex": return new RegExp(`^(?:${compileRegex(a, "ere").source})$`).test(path);
          case "-iregex": return new RegExp(`^(?:${compileRegex(a, "ere").source})$`, "i").test(path);
          case "-type": return a.split(",").some((t) => (t === "d" ? node.type === "dir" : t === "f" ? node.type === "file" && !isSymlink(node) : t === "l" ? isSymlink(node) : false));
          case "-size": return sizeMatch(node.type === "dir" ? 4096 : sizeOf(node), a);
          case "-empty": return node.type === "dir" ? node.children.size === 0 : node.content === "";
          case "-mtime": return numMatch(Math.floor((now - node.mtime) / 86_400_000), a);
          case "-atime":
          case "-ctime": return numMatch(Math.floor((now - node.mtime) / 86_400_000), a);
          case "-mmin": return numMatch(Math.ceil((now - node.mtime) / 60_000), a);
          case "-newer": {
            const ref = fs.lookup(ctx.resolve(a));
            if (!ref) throw new Error(`'${a}': No such file or directory`);
            return node.mtime > ref.mtime;
          }
          case "-perm": {
            const m = a.match(/^([-/]?)(.+)$/);
            if (!m) return false;
            let want: number;
            if (/^[0-7]+$/.test(m[2])) want = parseInt(m[2], 8);
            else {
              const sym = applySymbolic(0, m[2], node.type === "dir", 0);
              if (sym === null) throw new Error(`invalid mode '${a}'`);
              want = sym;
            }
            const have = node.mode & 0o7777;
            if (m[1] === "-") return (have & want) === want;
            if (m[1] === "/") return want === 0 || (have & want) !== 0;
            return have === want;
          }
          case "-user":
          case "-group": return node.owner === a;
          case "-links": return numMatch(node.type === "dir" ? 2 : 1, a);
          case "-readable": return fs.canRead(node);
          case "-writable": return fs.canWrite(node);
          case "-executable": return fs.canExec(node);
          case "-true":
          case "-depth":
          case "-daystart":
          case "-mount":
          case "-xdev":
          case "-maxdepth":
          case "-mindepth": return true;
          case "-false":
          case "-nouser":
          case "-nogroup": return false;
          case "-print": ctx.out(path + "\n"); return true;
          case "-print0": ctx.out(path + "\0"); return true;
          case "-ls": {
            ctx.out(`${String(node.inode).padStart(8)} ${String(blocksKB(node)).padStart(4)} ${modeString(node)}   1 ${node.owner} ${node.group} ${String(sizeOf(node)).padStart(8)} ${lsDate(node.mtime)} ${path}\n`);
            return true;
          }
          case "-printf": {
            const text = a.replace(/%([pfsdhmMtuP%])|\\n|\\t|\\0/g, (all, c: string | undefined) => {
              if (all === "\\n") return "\n";
              if (all === "\\t") return "\t";
              if (all === "\\0") return "\0";
              switch (c) {
                case "p": return path;
                case "f": return base;
                case "s": return String(node.type === "dir" ? 4096 : sizeOf(node));
                case "d": return String(depth);
                case "h": return dirName(path);
                case "m": return (node.mode & 0o7777).toString(8);
                case "M": return modeString(node);
                case "t": return new Date(node.mtime).toString().slice(0, 24);
                case "u": return node.owner;
                case "P": return path.replace(/^[^/]*\/?/, "");
                case "%": return "%";
              }
              return all;
            });
            ctx.out(text);
            return true;
          }
          case "-delete": {
            try {
              if (path !== "." && path !== "..") fs.remove(ctx.resolve(path), { recursive: false, dirOnly: node.type === "dir" });
              return true;
            } catch (err) {
              if (err instanceof FsError) {
                ctx.err(`find: cannot delete ${q(path)}: ${fsErrorText[err.code]}\n`);
                status = 1;
                return false;
              }
              throw err;
            }
          }
          case "-prune":
            pruned = true;
            return true;
          case "-quit":
            quit = true;
            return true;
        }
        return false;
      }
    }
  };

  const visit = (path: string, abs: string, node: FsNode, depth: number) => {
    if (quit) return;
    ctx.sh.tick();
    const process = () => {
      if (depth < minDepth) return;
      pruned = false;
      let ok = true;
      try {
        ok = expr ? evaluate(expr, path, node, depth) : true;
      } catch (err) {
        ctx.err(`find: ${(err as Error).message}\n`);
        status = 1;
        quit = true;
        return;
      }
      if (ok && !hasAction) ctx.out(path + "\n");
    };
    if (!depthFirst) process();
    const wasPruned = pruned;
    if (node.type === "dir" && depth < maxDepth && !wasPruned && !quit) {
      if (!fs.canRead(node) || !fs.canExec(node)) {
        ctx.err(`find: ${q(path)}: Permission denied\n`);
        status = 1;
      } else {
        for (const name of [...node.children.keys()].sort(compareNames)) {
          const child = node.children.get(name);
          if (!child) continue;
          const childPath = path.endsWith("/") ? path + name : `${path}/${name}`;
          visit(childPath, abs === "/" ? `/${name}` : `${abs}/${name}`, child, depth + 1);
        }
      }
    }
    if (depthFirst) process();
  };

  for (const s of starts) {
    const abs = ctx.resolve(s);
    const node = fs.lookup(abs);
    if (!node) {
      ctx.err(`find: ${q(s)}: No such file or directory\n`);
      status = 1;
      continue;
    }
    visit(s, abs, node, 0);
  }
  for (const e of execNodes) {
    if (e.t === "exec" && e.plus && e.collected.length) {
      const idx = e.argv.indexOf("{}");
      const argv = [...e.argv.slice(0, idx), ...e.collected, ...e.argv.slice(idx + 1)];
      if (runCmd(ctx, argv) !== 0) status = 1;
    }
  }
  return status;
};

/** Run a command as a child process (used by find -exec and xargs). */
export function runCmd(ctx: CmdCtx, argv: string[]): number {
  if (!argv.length) return 0;
  return ctx.sh.runExternal(argv, ctx.fds, new Map(), ctx.fds);
}
