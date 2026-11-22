import "server-only";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { CommandDoc } from "@/types/content";
import { relaxYaml } from "./markdown";

const DIR = path.join(process.cwd(), "src", "content", "commands");

let cache: Map<string, CommandDoc> | null = null;

const ORIGINS = new Set(["bash-builtin", "posix-utility", "gnu-coreutils", "linux-specific", "external-tool"]);

function list(v: unknown): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v.map((x) => String(x).trim()) : [String(v).trim()];
}

/** All command reference entries, keyed by name. Validated at build time. */
export function allCommands(): Map<string, CommandDoc> {
  if (cache) return cache;
  const map = new Map<string, CommandDoc>();
  if (fs.existsSync(DIR)) {
    for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith(".yaml")).sort()) {
      const text = fs.readFileSync(path.join(DIR, file), "utf8").split("\r\n").join("\n");
      const raw = parseYaml(relaxYaml(text)) as Record<string, Record<string, unknown>>;
      for (const [name, d] of Object.entries(raw ?? {})) {
        if (!d.summary || !d.why || !d.syntax) throw new Error(`[content] command ${name} in ${file} needs summary, why, syntax`);
        const origin = String(d.origin ?? "posix-utility");
        if (!ORIGINS.has(origin)) throw new Error(`[content] command ${name} has invalid origin ${origin}`);
        map.set(name, {
          name,
          category: String(d.category ?? file.replace(/\.yaml$/, "")),
          summary: String(d.summary).trim(),
          why: String(d.why).trim(),
          syntax: list(d.syntax),
          flags: Array.isArray(d.flags)
            ? (d.flags as unknown[]).map((f) => {
                if (Array.isArray(f)) return { flag: String(f[0]), description: String(f[1]) };
                const o = f as Record<string, unknown>;
                return { flag: String(o.flag), description: String(o.description) };
              })
            : [],
          examples: Array.isArray(d.examples)
            ? (d.examples as Record<string, unknown>[]).map((e) => ({
                code: String(e.code).replace(/\n$/, ""),
                description: String(e.description ?? e.desc ?? "").trim(),
                output: e.output !== undefined ? String(e.output).replace(/\n$/, "") : undefined,
              }))
            : [],
          useCases: list(d.useCases ?? d.use_cases),
          mistakes: list(d.mistakes),
          related: list(d.related),
          origin: origin as CommandDoc["origin"],
          portability: d.portability ? String(d.portability).trim() : undefined,
        });
      }
    }
  }
  cache = map;
  return map;
}

export function getCommand(name: string): CommandDoc | undefined {
  return allCommands().get(name);
}
