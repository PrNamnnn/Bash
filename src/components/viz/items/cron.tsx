"use client";

import { useMemo, useState } from "react";
import { Box, VizFrame } from "../primitives";
import { cn } from "@/lib/cn";

const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12, names: ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] },
  { name: "day of week", min: 0, max: 7, names: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] },
] as const;

const MACROS: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function parseField(spec: string, f: (typeof FIELDS)[number]): Set<number> | string {
  const out = new Set<number>();
  const names = "names" in f ? f.names : undefined;
  for (const part of spec.toLowerCase().split(",")) {
    const m = part.match(/^(\*|[a-z0-9]+(?:-[a-z0-9]+)?)(?:\/(\d+))?$/);
    if (!m) return `invalid ${f.name}: "${part}"`;
    const step = m[2] ? Number(m[2]) : 1;
    if (step < 1) return `invalid step in ${f.name}`;
    let lo: number = f.min;
    let hi: number = f.max === 7 ? 6 : f.max;
    if (m[1] !== "*") {
      const conv = (s: string) => {
        if (/^\d+$/.test(s)) return Number(s);
        const idx = names?.indexOf(s as never) ?? -1;
        return idx === -1 ? NaN : idx + (f.name === "month" ? 1 : 0);
      };
      const [a, b] = m[1].split("-");
      lo = conv(a);
      hi = b !== undefined ? conv(b) : m[2] ? (f.max === 7 ? 6 : f.max) : lo;
      if (Number.isNaN(lo) || Number.isNaN(hi)) return `invalid ${f.name}: "${part}"`;
      if (lo < f.min || hi > f.max || lo > hi) return `${f.name} must be between ${f.min} and ${f.max}`;
    }
    for (let v = lo; v <= hi; v += step) out.add(f.name === "day of week" && v === 7 ? 0 : v);
  }
  return out;
}

function list(nums: number[], fmt: (n: number) => string): string {
  if (nums.length <= 1) return nums.map(fmt).join("");
  return nums.slice(0, -1).map(fmt).join(", ") + " and " + fmt(nums[nums.length - 1]);
}

function describe(fields: string[], sets: Set<number>[]): string {
  const [mi, h, dom, mon, dow] = fields;
  const [sMi, sH, sDom, sMon, sDow] = sets.map((s) => [...s].sort((a, b) => a - b));
  const pad = (n: number) => String(n).padStart(2, "0");
  let time: string;
  if (mi === "*" && h === "*") time = "every minute";
  else if (mi.startsWith("*/") && h === "*") time = `every ${mi.slice(2)} minutes`;
  else if (h === "*") time = `at minute ${list(sMi, String)} of every hour`;
  else if (h.startsWith("*/") && sMi.length === 1) time = `at minute ${sMi[0]} past every ${h.slice(2)} hours`;
  else if (sMi.length * sH.length <= 6) time = `at ${list(sH.flatMap((hh) => sMi.map((mm) => hh * 60 + mm)).sort((a, b) => a - b), (t) => `${pad(Math.floor(t / 60))}:${pad(t % 60)}`)}`;
  else time = `at minutes ${list(sMi, String)} past hours ${list(sH, String)}`;
  const parts = [time];
  if (dom !== "*") parts.push(`on day ${list(sDom, String)} of the month`);
  if (mon !== "*") parts.push(`in ${list(sMon, (m) => MONTH_NAMES[m - 1])}`);
  if (dow !== "*") parts.push(`${dom !== "*" ? "or " : ""}on ${list(sDow, (d) => DAY_NAMES[d])}`);
  return parts.join(", ");
}

function nextRuns(sets: Set<number>[], domRestricted: boolean, dowRestricted: boolean, count: number): Date[] {
  const [sMi, sH, sDom, sMon, sDow] = sets;
  const out: Date[] = [];
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let d = 0; d < 366 * 4 && out.length < count; d++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + d);
    if (!sMon.has(day.getMonth() + 1)) continue;
    const domOk = sDom.has(day.getDate());
    const dowOk = sDow.has(day.getDay());
    const dayOk = domRestricted && dowRestricted ? domOk || dowOk : domOk && dowOk;
    if (!dayOk) continue;
    for (const h of [...sH].sort((a, b) => a - b)) {
      for (const m of [...sMi].sort((a, b) => a - b)) {
        const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
        if (t > now) out.push(t);
        if (out.length >= count) return out;
      }
    }
  }
  return out;
}

const PRESETS = ["*/15 * * * *", "30 2 * * *", "0 9 * * 1-5", "0 0 1 * *", "@weekly", "0 */6 * * *", "15 3 * * sun"];

export default function CronViz() {
  const [expr, setExpr] = useState("30 2 * * *");
  const parsed = useMemo(() => {
    const e = expr.trim();
    if (e === "@reboot") return { reboot: true as const };
    const norm = MACROS[e.toLowerCase()] ?? e;
    const fields = norm.split(/\s+/);
    if (fields.length !== 5) return { error: `a schedule needs 5 fields (minute hour day month weekday), found ${fields.length}` };
    const sets: Set<number>[] = [];
    for (let i = 0; i < 5; i++) {
      const r = parseField(fields[i], FIELDS[i]);
      if (typeof r === "string") return { error: r, field: i };
      sets.push(r);
    }
    return { fields, sets, text: describe(fields, sets), runs: nextRuns(sets, fields[2] !== "*", fields[4] !== "*", 5) };
  }, [expr]);
  const fieldsShown = (MACROS[expr.trim().toLowerCase()] ?? expr.trim()).split(/\s+/);

  return (
    <VizFrame title="Cron schedule explainer" footer="Cron runs commands with a minimal environment (PATH is often just /usr/bin:/bin) and no terminal. Use absolute paths and redirect output to a log file: `30 2 * * * /home/learner/bin/backup.sh >> /var/log/backup.log 2>&1`.">
      <label className="block text-[12px] text-fg-subtle">
        crontab schedule
        <input
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          spellCheck={false}
          className="mt-1 block w-full rounded-md border border-line bg-inset px-3 py-2 font-mono text-[15px] text-fg focus:border-accent/50 focus:outline-none"
        />
      </label>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button key={p} type="button" onClick={() => setExpr(p)} className={cn("rounded border px-2 py-0.5 font-mono text-[11.5px]", expr === p ? "border-accent/50 text-fg" : "border-line text-fg-subtle hover:text-fg-muted")}>
            {p}
          </button>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-5 gap-1.5">
        {FIELDS.map((f, i) => (
          <div key={f.name} className={cn("rounded-md border px-2 py-2 text-center", "error" in parsed && parsed.field === i ? "border-red/60 bg-red-dim/40" : "border-line bg-surface-2")}>
            <div className="font-mono text-[14px] text-fg">{fieldsShown[i] ?? "?"}</div>
            <div className="text-[10.5px] text-fg-subtle">{f.name}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Box title="meaning">
          {"reboot" in parsed ? (
            <p className="text-[13.5px] text-fg">Runs once, when the cron daemon starts (usually at boot).</p>
          ) : "error" in parsed ? (
            <p className="text-[13.5px] text-red">{parsed.error}</p>
          ) : (
            <p className="text-[14px] text-fg">Runs {parsed.text}.</p>
          )}
        </Box>
        <Box title="next 5 runs (your local time)">
          {"runs" in parsed && parsed.runs ? (
            <ol className="space-y-0.5 font-mono text-[12.5px] text-fg-muted">
              {parsed.runs.map((d) => (
                <li key={d.toISOString()}>{d.toLocaleString(undefined, { weekday: "short", year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</li>
              ))}
            </ol>
          ) : (
            <p className="text-[12.5px] text-fg-subtle">—</p>
          )}
        </Box>
      </div>
    </VizFrame>
  );
}
