/** Streams used by the simulator. All execution is synchronous. */

export class LimitError extends Error {}

export interface OutChunk {
  fd: 1 | 2;
  text: string;
}

export interface Sink {
  isTTY: boolean;
  write(s: string): void;
}

export interface Budget {
  steps: number;
  maxSteps: number;
  outBytes: number;
  maxOutBytes: number;
  startedAt: number;
  maxMillis: number;
  pidSeq: number;
}

export function newBudget(): Budget {
  return {
    steps: 0,
    maxSteps: 250_000,
    outBytes: 0,
    maxOutBytes: 2_000_000,
    startedAt: Date.now(),
    maxMillis: 4000,
    pidSeq: 4200,
  };
}

export class BufferSink implements Sink {
  isTTY = false;
  text = "";
  constructor(private budget?: Budget) {}
  write(s: string): void {
    if (this.budget) {
      this.budget.outBytes += s.length;
      if (this.budget.outBytes > this.budget.maxOutBytes) throw new LimitError("output limit exceeded");
    }
    this.text += s;
  }
}

export class TTYSink implements Sink {
  isTTY = true;
  constructor(
    public chunks: OutChunk[],
    public fd: 1 | 2,
    private budget: Budget,
  ) {}
  write(s: string): void {
    if (!s) return;
    this.budget.outBytes += s.length;
    if (this.budget.outBytes > this.budget.maxOutBytes) throw new LimitError("output limit exceeded");
    const last = this.chunks[this.chunks.length - 1];
    if (last && last.fd === this.fd) last.text += s;
    else this.chunks.push({ fd: this.fd, text: s });
  }
}

export class NullSink implements Sink {
  isTTY = false;
  write(): void {}
}

export class CallbackSink implements Sink {
  isTTY = false;
  constructor(private fn: (s: string) => void) {}
  write(s: string): void {
    this.fn(s);
  }
}

export class InStream {
  pos = 0;
  constructor(
    public data: string,
    public isTTY = false,
  ) {}

  get eof(): boolean {
    return this.pos >= this.data.length;
  }

  /** Read up to (and consuming) the delimiter. Returns null at EOF with no data. */
  readUntil(delim = "\n"): { text: string; terminated: boolean } | null {
    if (this.eof) return null;
    const idx = delim === "" ? this.data.indexOf("\0", this.pos) : this.data.indexOf(delim, this.pos);
    if (idx === -1) {
      const text = this.data.slice(this.pos);
      this.pos = this.data.length;
      return { text, terminated: false };
    }
    const text = this.data.slice(this.pos, idx);
    this.pos = idx + (delim === "" ? 1 : delim.length);
    return { text, terminated: true };
  }

  readChars(n: number): string {
    const text = this.data.slice(this.pos, this.pos + n);
    this.pos += text.length;
    return text;
  }

  readAll(): string {
    const text = this.data.slice(this.pos);
    this.pos = this.data.length;
    return text;
  }
}

export type FdEntry = { kind: "in"; s: InStream } | { kind: "out"; s: Sink };

export type FdTable = Map<number, FdEntry>;

export function cloneFds(fds: FdTable): FdTable {
  return new Map(fds);
}

export function stdinOf(fds: FdTable): InStream {
  const e = fds.get(0);
  return e && e.kind === "in" ? e.s : EMPTY_IN;
}

export function sinkOf(fds: FdTable, fd: number): Sink {
  const e = fds.get(fd);
  return e && e.kind === "out" ? e.s : NULL_SINK;
}

export const NULL_SINK = new NullSink();
export const EMPTY_IN = new InStream("", false);
