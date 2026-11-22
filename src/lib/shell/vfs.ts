/**
 * In-memory virtual filesystem used by the Bash simulator.
 *
 * Everything is a plain JS object tree — nothing touches the real machine.
 * Permissions are modelled for a single non-root user ("learner") so that
 * lessons about chmod, ownership and "Permission denied" behave realistically.
 */

export type FsErrorCode = "ENOENT" | "EISDIR" | "ENOTDIR" | "EEXIST" | "ENOTEMPTY" | "EACCES" | "EINVAL" | "EPERM" | "ELOOP";

export const fsErrorText: Record<FsErrorCode, string> = {
  ENOENT: "No such file or directory",
  EISDIR: "Is a directory",
  ENOTDIR: "Not a directory",
  EEXIST: "File exists",
  ENOTEMPTY: "Directory not empty",
  EACCES: "Permission denied",
  EINVAL: "Invalid argument",
  EPERM: "Operation not permitted",
  ELOOP: "Too many levels of symbolic links",
};

export class FsError extends Error {
  constructor(
    public code: FsErrorCode,
    public path: string,
  ) {
    super(fsErrorText[code]);
  }
}

interface NodeBase {
  mode: number;
  mtime: number;
  owner: string;
  group: string;
  inode: number;
}

export interface FileNode extends NodeBase {
  type: "file";
  content: string;
  /** Set for symbolic links: the target path exactly as given to `ln -s`. */
  symlink?: string;
}

export interface DirNode extends NodeBase {
  type: "dir";
  children: Map<string, FsNode>;
}

export type FsNode = FileNode | DirNode;

export function isSymlink(node: FsNode | undefined): node is FileNode & { symlink: string } {
  return !!node && node.type === "file" && node.symlink !== undefined;
}

export const USER = "learner";
export const GROUP = "learner";

let inodeCounter = 131072;

export function makeDir(mode = 0o755, owner = USER, mtime = Date.now()): DirNode {
  return { type: "dir", children: new Map(), mode, mtime, owner, group: owner, inode: inodeCounter++ };
}

export function makeFile(content: string, mode = 0o644, owner = USER, mtime = Date.now()): FileNode {
  return { type: "file", content, mode, mtime, owner, group: owner, inode: inodeCounter++ };
}

/** Normalise a path to an absolute path without `.`/`..` segments. */
export function normalizePath(path: string, cwd: string): string {
  const abs = path.startsWith("/") ? path : `${cwd}/${path}`;
  const parts: string[] = [];
  for (const seg of abs.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return "/" + parts.join("/");
}

export function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  if (!trimmed) return "/";
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

export function dirName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  if (!trimmed) return "/";
  const i = trimmed.lastIndexOf("/");
  if (i === -1) return ".";
  if (i === 0) return "/";
  return trimmed.slice(0, i).replace(/\/+$/, "") || "/";
}

export class VFS {
  root: DirNode;
  /** File-creation mask, applied to new files (0666) and directories (0777). */
  umask = 0o022;

  constructor(root?: DirNode) {
    this.root = root ?? makeDir(0o755, "root");
  }

  /* ---------- permission helpers (single user model) ---------- */

  private bits(node: FsNode): number {
    if (node.owner === USER) return (node.mode >> 6) & 7;
    if (node.group === GROUP) return (node.mode >> 3) & 7;
    return node.mode & 7;
  }
  canRead(node: FsNode): boolean {
    return (this.bits(node) & 4) !== 0;
  }
  canWrite(node: FsNode): boolean {
    return (this.bits(node) & 2) !== 0;
  }
  canExec(node: FsNode): boolean {
    return (this.bits(node) & 1) !== 0;
  }

  /* ---------- lookup ---------- */

  /**
   * Walk an absolute normalised path, following symbolic links in intermediate
   * components (and in the final one when `follow`). In strict mode, errors are thrown.
   */
  private resolvePath(abs: string, follow: boolean, strict: boolean, orig = abs, depth = 0): { node: FsNode; path: string } | undefined {
    if (depth > 40) {
      if (strict) throw new FsError("ELOOP", orig);
      return undefined;
    }
    const segs = abs.split("/").filter(Boolean);
    let node: FsNode = this.root;
    let path = "";
    for (let i = 0; i < segs.length; i++) {
      if (node.type !== "dir") {
        if (strict) throw new FsError("ENOTDIR", orig);
        return undefined;
      }
      if (strict && !this.canExec(node)) throw new FsError("EACCES", orig);
      const next: FsNode | undefined = node.children.get(segs[i]);
      if (!next) {
        if (strict) throw new FsError("ENOENT", orig);
        return undefined;
      }
      const lastSeg = i === segs.length - 1;
      if (isSymlink(next) && (!lastSeg || follow)) {
        const target = normalizePath(next.symlink, path || "/");
        const rest = segs.slice(i + 1).join("/");
        return this.resolvePath(rest ? `${target}/${rest}` : target, follow, strict, orig, depth + 1);
      }
      node = next;
      path += "/" + segs[i];
    }
    return { node, path: path || "/" };
  }

  /** Resolve an absolute normalised path (following symlinks unless `follow` is false). */
  lookup(abs: string, follow = true): FsNode | undefined {
    if (abs === "/") return this.root;
    return this.resolvePath(abs, follow, false)?.node;
  }

  /** Like lookup but throws precise errors (checks search permission on directories). */
  get(abs: string, follow = true): FsNode {
    if (abs === "/") return this.root;
    return this.resolvePath(abs, follow, true)!.node;
  }

  /** Canonical physical path with every symlink resolved, or undefined if it doesn't exist. */
  realpath(abs: string): string | undefined {
    if (abs === "/") return "/";
    return this.resolvePath(abs, true, false)?.path;
  }

  /** Create a symbolic link at `abs` pointing to `target` (stored verbatim). */
  symlink(target: string, abs: string): void {
    if (this.lookup(abs, false)) throw new FsError("EEXIST", abs);
    const { dir, name } = this.parent(abs);
    if (!this.canWrite(dir)) throw new FsError("EACCES", abs);
    const node = makeFile(target, 0o777);
    node.symlink = target;
    dir.children.set(name, node);
    dir.mtime = Date.now();
  }

  exists(abs: string): boolean {
    return this.lookup(abs) !== undefined;
  }

  isDir(abs: string): boolean {
    return this.lookup(abs)?.type === "dir";
  }

  isFile(abs: string): boolean {
    return this.lookup(abs)?.type === "file";
  }

  private parent(abs: string): { dir: DirNode; name: string } {
    const name = baseName(abs);
    const parentPath = dirName(abs);
    const dir = this.get(parentPath);
    if (dir.type !== "dir") throw new FsError("ENOTDIR", abs);
    return { dir, name };
  }

  /* ---------- reading ---------- */

  readFile(abs: string): string {
    const node = this.get(abs);
    if (node.type === "dir") throw new FsError("EISDIR", abs);
    if (!this.canRead(node)) throw new FsError("EACCES", abs);
    return node.content;
  }

  readdir(abs: string): string[] {
    const node = this.get(abs);
    if (node.type !== "dir") throw new FsError("ENOTDIR", abs);
    if (!this.canRead(node)) throw new FsError("EACCES", abs);
    return [...node.children.keys()].sort(compareNames);
  }

  /* ---------- writing ---------- */

  writeFile(abs: string, content: string, append = false): void {
    const existing = this.lookup(abs);
    if (existing) {
      if (existing.type === "dir") throw new FsError("EISDIR", abs);
      if (!this.canWrite(existing)) throw new FsError("EACCES", abs);
      existing.content = append ? existing.content + content : content;
      existing.mtime = Date.now();
      return;
    }
    const { dir, name } = this.parent(abs);
    if (!this.canWrite(dir)) throw new FsError("EACCES", abs);
    dir.children.set(name, makeFile(content, 0o666 & ~this.umask));
    dir.mtime = Date.now();
  }

  touch(abs: string): void {
    const existing = this.lookup(abs);
    if (existing) {
      existing.mtime = Date.now();
      return;
    }
    this.writeFile(abs, "");
  }

  mkdir(abs: string, parents = false): void {
    if (abs === "/") {
      if (parents) return;
      throw new FsError("EEXIST", abs);
    }
    if (parents) {
      let cur = "";
      for (const seg of abs.split("/").filter(Boolean)) {
        cur += "/" + seg;
        const node = this.lookup(cur);
        if (node) {
          if (node.type !== "dir") throw new FsError("ENOTDIR", cur);
          continue;
        }
        this.mkdir(cur, false);
      }
      return;
    }
    if (this.lookup(abs)) throw new FsError("EEXIST", abs);
    const { dir, name } = this.parent(abs);
    if (!this.canWrite(dir)) throw new FsError("EACCES", abs);
    dir.children.set(name, makeDir(0o777 & ~this.umask));
    dir.mtime = Date.now();
  }

  /** Remove a file, or a directory (only if `recursive` or empty). */
  remove(abs: string, opts: { recursive?: boolean; dirOnly?: boolean } = {}): void {
    if (abs === "/") throw new FsError("EPERM", abs);
    const node = this.get(abs, false);
    const { dir, name } = this.parent(abs);
    if (!this.canWrite(dir)) throw new FsError("EACCES", abs);
    if (node.type === "dir") {
      if (!opts.recursive && !opts.dirOnly) throw new FsError("EISDIR", abs);
      if (node.children.size > 0 && !opts.recursive) throw new FsError("ENOTEMPTY", abs);
    } else if (opts.dirOnly) {
      throw new FsError("ENOTDIR", abs);
    }
    dir.children.delete(name);
    dir.mtime = Date.now();
  }

  /** Insert an existing node at a path (used by mv/cp). */
  put(abs: string, node: FsNode): void {
    const { dir, name } = this.parent(abs);
    if (!this.canWrite(dir)) throw new FsError("EACCES", abs);
    dir.children.set(name, node);
    dir.mtime = Date.now();
  }

  detach(abs: string): FsNode {
    const node = this.get(abs, false);
    const { dir, name } = this.parent(abs);
    if (!this.canWrite(dir)) throw new FsError("EACCES", abs);
    dir.children.delete(name);
    return node;
  }

  /* ---------- utilities ---------- */

  static cloneNode(node: FsNode, preserve = true): FsNode {
    const now = Date.now();
    if (node.type === "file") {
      return { ...node, inode: inodeCounter++, mtime: preserve ? node.mtime : now };
    }
    const children = new Map<string, FsNode>();
    for (const [k, v] of node.children) children.set(k, VFS.cloneNode(v, preserve));
    return { ...node, children, inode: inodeCounter++, mtime: preserve ? node.mtime : now };
  }

  clone(): VFS {
    const v = new VFS(VFS.cloneNode(this.root) as DirNode);
    v.umask = this.umask;
    return v;
  }

  /** Recursively walk a subtree in sorted order (pre-order). */
  *walk(abs: string, depth = 0): Generator<{ path: string; node: FsNode; depth: number }> {
    // The starting point is followed; links found inside the tree are reported, not followed.
    const node = this.lookup(abs, depth === 0);
    if (!node) return;
    yield { path: abs, node, depth };
    if (node.type === "dir" && this.canRead(node)) {
      for (const name of [...node.children.keys()].sort(compareNames)) {
        yield* this.walk(abs === "/" ? `/${name}` : `${abs}/${name}`, depth + 1);
      }
    }
  }

  /** Deterministic serialisation of a subtree, used to compare exercise results. */
  snapshot(abs = "/home/learner"): string {
    const lines: string[] = [];
    for (const { path, node } of this.walk(abs)) {
      if (isSymlink(node)) lines.push(`l ${path} -> ${node.symlink}`);
      else if (node.type === "dir") lines.push(`d ${path} ${node.mode.toString(8)}`);
      else lines.push(`f ${path} ${node.mode.toString(8)} ${JSON.stringify(node.content)}`);
    }
    return lines.join("\n");
  }
}

/** C-locale byte ordering, which is what the simulator documents for ls, sort and globs. */
export function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sizeOf(node: FsNode): number {
  if (node.type === "dir") return 4096;
  return new TextEncoder().encode(node.content).length;
}

export function modeString(node: FsNode): string {
  const t = node.type === "dir" ? "d" : isSymlink(node) ? "l" : "-";
  let s = "";
  const m = node.mode;
  const chars = "rwxrwxrwx";
  for (let i = 0; i < 9; i++) s += m & (1 << (8 - i)) ? chars[i] : "-";
  // setuid/setgid/sticky
  if (m & 0o4000) s = s.slice(0, 2) + (s[2] === "x" ? "s" : "S") + s.slice(3);
  if (m & 0o2000) s = s.slice(0, 5) + (s[5] === "x" ? "s" : "S") + s.slice(6);
  if (m & 0o1000) s = s.slice(0, 8) + (s[8] === "x" ? "t" : "T");
  return t + s;
}
