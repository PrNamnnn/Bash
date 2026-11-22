import type { CmdCtx } from "../shell";
import { FsError, fsErrorText } from "../vfs";

export interface OptSpec {
  /** Boolean short flags, e.g. "lahR". */
  flags?: string;
  /** Short flags that take an argument, e.g. "nC". */
  withArg?: string;
  /** Long option → short letter (or a long key prefixed with "--"). Suffix "=" means it takes an argument. */
  long?: Record<string, string>;
  /** Stop parsing at the first operand (POSIX style). */
  stopAtOperand?: boolean;
}

export interface ParsedOpts {
  flags: Set<string>;
  values: Map<string, string[]>;
  operands: string[];
  error?: string;
}

export function parseOpts(args: string[], spec: OptSpec): ParsedOpts {
  const flags = new Set<string>();
  const values = new Map<string, string[]>();
  const operands: string[] = [];
  const add = (k: string, v: string) => values.set(k, [...(values.get(k) ?? []), v]);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      operands.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith("--") && a.length > 2) {
      const [name, inline] = a.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
      const entry = spec.long ? Object.entries(spec.long).find(([k]) => k.replace(/=$/, "") === name) : undefined;
      if (!entry) return { flags, values, operands, error: `unrecognized option '${a}'` };
      const takesArg = entry[0].endsWith("=");
      const key = entry[1];
      if (takesArg) {
        const v = inline ?? args[++i];
        if (v === undefined) return { flags, values, operands, error: `option '--${name}' requires an argument` };
        add(key, v);
      } else flags.add(key);
      continue;
    }
    if (a.startsWith("-") && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        if (spec.withArg?.includes(c)) {
          const rest = a.slice(j + 1);
          const v = rest || args[++i];
          if (v === undefined) return { flags, values, operands, error: `option requires an argument -- '${c}'` };
          add(c, v);
          break;
        }
        if (spec.flags?.includes(c)) {
          flags.add(c);
          continue;
        }
        return { flags, values, operands, error: `invalid option -- '${c}'` };
      }
      continue;
    }
    operands.push(a);
    if (spec.stopAtOperand) {
      operands.push(...args.slice(i + 1));
      break;
    }
  }
  return { flags, values, operands };
}

export function last(p: ParsedOpts, k: string): string | undefined {
  const v = p.values.get(k);
  return v ? v[v.length - 1] : undefined;
}

export function usageError(ctx: CmdCtx, msg: string, code = 1): number {
  ctx.err(`${ctx.name}: ${msg}\nTry '${ctx.name} --help' for more information.\n`);
  return code;
}

export function fsMessage(err: unknown): string {
  if (err instanceof FsError) return fsErrorText[err.code];
  throw err;
}

/** Split text into lines; a trailing newline does not create an empty last line. */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function joinLines(lines: string[]): string {
  return lines.length ? lines.join("\n") + "\n" : "";
}

/** Read each operand (or stdin when none / "-"). Calls back with content or prints an error. */
export function eachInput(
  ctx: CmdCtx,
  operands: string[],
  fn: (content: string, name: string) => void,
): number {
  let status = 0;
  const list = operands.length ? operands : ["-"];
  for (const f of list) {
    try {
      fn(ctx.readInput(f), f);
    } catch (err) {
      if (err instanceof FsError) {
        ctx.err(`${ctx.name}: ${f}: ${fsErrorText[err.code]}\n`);
        status = 1;
        continue;
      }
      throw err;
    }
  }
  return status;
}

export function humanSize(n: number): string {
  if (n < 1024) return String(n);
  const units = ["K", "M", "G", "T"];
  let v = n;
  let u = -1;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return (v < 10 ? Math.ceil(v * 10) / 10 : Math.ceil(v)).toString() + units[u];
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function lsDate(ms: number): string {
  const d = new Date(ms);
  const now = Date.now();
  const sixMonths = 1000 * 60 * 60 * 24 * 182;
  const mon = MONTHS[d.getMonth()];
  const day = String(d.getDate()).padStart(2, " ");
  if (Math.abs(now - ms) > sixMonths) return `${mon} ${day}  ${d.getFullYear()}`;
  return `${mon} ${day} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function isoDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}000000 ${sign}${p(Math.floor(Math.abs(off) / 60))}${p(Math.abs(off) % 60)}`;
}

/** GNU-style quoting of a file name in error messages. */
export function q(name: string): string {
  return `'${name}'`;
}

/** strftime-style date formatting (shared by `date` and `printf %(…)T`). */
export function formatDate(d: Date, fmt: string, utc: boolean): string {
  const get = {
    Y: utc ? d.getUTCFullYear() : d.getFullYear(),
    m: (utc ? d.getUTCMonth() : d.getMonth()) + 1,
    d: utc ? d.getUTCDate() : d.getDate(),
    H: utc ? d.getUTCHours() : d.getHours(),
    M: utc ? d.getUTCMinutes() : d.getMinutes(),
    S: utc ? d.getUTCSeconds() : d.getSeconds(),
    w: utc ? d.getUTCDay() : d.getDay(),
  };
  const p = (n: number, w = 2, c = "0") => String(n).padStart(w, c);
  const start = new Date(get.Y, 0, 1);
  const doy = Math.floor((new Date(get.Y, get.m - 1, get.d).getTime() - start.getTime()) / 86400000) + 1;
  const tzOff = utc ? 0 : -d.getTimezoneOffset();
  const tz = utc ? "UTC" : Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(d).find((x) => x.type === "timeZoneName")?.value ?? "UTC";
  return fmt.replace(/%([-_0^#]?)([a-zA-Z%+])/g, (all, flag: string, c: string) => {
    let v: string;
    switch (c) {
      case "Y": v = String(get.Y); break;
      case "y": v = p(get.Y % 100); break;
      case "C": v = p(Math.floor(get.Y / 100)); break;
      case "m": v = p(get.m); break;
      case "d": v = p(get.d); break;
      case "e": v = p(get.d, 2, " "); break;
      case "H": v = p(get.H); break;
      case "I": v = p(get.H % 12 || 12); break;
      case "M": v = p(get.M); break;
      case "S": v = p(get.S); break;
      case "N": v = p((d.getMilliseconds() * 1_000_000), 9); break;
      case "p": v = get.H < 12 ? "AM" : "PM"; break;
      case "P": v = get.H < 12 ? "am" : "pm"; break;
      case "A": v = DAYS_LONG[get.w]; break;
      case "a": v = DAYS[get.w]; break;
      case "B": v = MONTHS_LONG[get.m - 1]; break;
      case "b":
      case "h": v = MONTHS[get.m - 1]; break;
      case "j": v = p(doy, 3); break;
      case "u": v = String(get.w || 7); break;
      case "w": v = String(get.w); break;
      case "s": v = String(Math.floor(d.getTime() / 1000)); break;
      case "F": v = `${get.Y}-${p(get.m)}-${p(get.d)}`; break;
      case "T": v = `${p(get.H)}:${p(get.M)}:${p(get.S)}`; break;
      case "R": v = `${p(get.H)}:${p(get.M)}`; break;
      case "D": v = `${p(get.m)}/${p(get.d)}/${p(get.Y % 100)}`; break;
      case "Z": v = tz; break;
      case "z": v = `${tzOff >= 0 ? "+" : "-"}${p(Math.floor(Math.abs(tzOff) / 60))}${p(Math.abs(tzOff) % 60)}`; break;
      case "n": v = "\n"; break;
      case "t": v = "\t"; break;
      case "%": v = "%"; break;
      case "+": v = formatDate(d, "%a %b %e %H:%M:%S %Z %Y", utc); break;
      default: return all;
    }
    if (flag === "-") v = v.replace(/^[0 ]+(?=.)/, "");
    if (flag === "^") v = v.toUpperCase();
    return v;
  });
}

/** Parse GNU-style date strings: @epoch, "3 days ago", ISO dates, now/today/yesterday. */
export function parseDateSpec(spec: string): Date | null {
  const s = spec.trim();
  if (s.startsWith("@")) {
    const n = Number(s.slice(1));
    return Number.isNaN(n) ? null : new Date(n * 1000);
  }
  const now = new Date();
  const rel = s.match(/^(-?\d+)\s*(second|minute|hour|day|week|month|year)s?(\s+ago)?$/i);
  if (rel) {
    let n = Number(rel[1]);
    if (rel[3]) n = -n;
    const unit = rel[2].toLowerCase();
    const d = new Date(now);
    if (unit === "month") d.setMonth(d.getMonth() + n);
    else if (unit === "year") d.setFullYear(d.getFullYear() + n);
    else d.setTime(d.getTime() + n * { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5 }[unit as "day"]);
    return d;
  }
  if (/^(now|today)$/i.test(s)) return now;
  if (/^yesterday$/i.test(s)) return new Date(now.getTime() - 864e5);
  if (/^tomorrow$/i.test(s)) return new Date(now.getTime() + 864e5);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), Number(iso[4] ?? 0), Number(iso[5] ?? 0), Number(iso[6] ?? 0));
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}
