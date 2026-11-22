/** Control-flow signals and errors shared across the simulator (kept separate to avoid import cycles). */

export class BreakSignal {
  constructor(public n: number) {}
}
export class ContinueSignal {
  constructor(public n: number) {}
}
export class ReturnSignal {
  constructor(public status: number) {}
}
export class ExitSignal {
  constructor(public status: number) {}
}
/** Aborts the whole top-level run (infinite loops, output floods). */
export class AbortSignal {
  constructor(public message: string) {}
}

export class ExpansionError extends Error {
  constructor(
    message: string,
    /** Fatal errors (unbound variable, ${x:?}) exit a non-interactive shell. */
    public fatal: boolean,
  ) {
    super(message);
  }
}

export const HOME = "/home/learner";

export function shellQuote(s: string): string {
  if (s === "") return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/** Bash's %q style quoting. */
export function bashQ(s: string): string {
  if (s === "") return "''";
  if (/[\n\t\r\x1b]/.test(s)) {
    const map: Record<string, string> = { "\\": "\\\\", "'": "\\'", "\n": "\\n", "\t": "\\t", "\r": "\\r", "\x1b": "\\E" };
    return "$'" + s.replace(/[\\'\n\t\r\x1b]/g, (c) => map[c]) + "'";
  }
  return s.replace(/[^A-Za-z0-9_@%+=:,./-]/g, "\\$&");
}
