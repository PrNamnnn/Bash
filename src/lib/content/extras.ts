import "server-only";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { Challenge, CheatSection, Difficulty } from "@/types/content";
import { normalizeExercise } from "./exercise-schema";
import { relaxYaml } from "./markdown";

const CONTENT = path.join(process.cwd(), "src", "content");

let challengeCache: Challenge[] | null = null;
let cheatCache: CheatSection[] | null = null;

export function getChallenges(): Challenge[] {
  if (challengeCache) return challengeCache;
  const file = path.join(CONTENT, "challenges.yaml");
  if (!fs.existsSync(file)) return (challengeCache = []);
  // Each challenge is a YAML document separated by "---" so exercises can use block scalars freely.
  const docs = fs
    .readFileSync(file, "utf8")
    .replace(/\r\n/g, "\n")
    .split(/^---\s*$/m)
    .map((d) => d.trim())
    .filter(Boolean);
  const ctx = { source: "challenges", exerciseCounter: { n: 0 } };
  challengeCache = docs.map((doc) => {
    const d = parseYaml(relaxYaml(doc)) as Record<string, unknown>;
    if (!d.id || !d.title || !d.topic) throw new Error(`[content] challenge is missing id/title/topic: ${doc.slice(0, 80)}`);
    const exercise = normalizeExercise({ ...d, id: `challenge:${d.id}` }, ctx);
    return {
      id: String(d.id),
      title: String(d.title),
      difficulty: (d.difficulty as Difficulty) ?? "beginner",
      topic: String(d.topic),
      lesson: d.lesson ? String(d.lesson) : undefined,
      exercise,
    };
  });
  const ids = new Set<string>();
  for (const c of challengeCache) {
    if (ids.has(c.id)) throw new Error(`[content] duplicate challenge id ${c.id}`);
    ids.add(c.id);
  }
  return challengeCache;
}

export function getCheatSheets(): CheatSection[] {
  if (cheatCache) return cheatCache;
  const file = path.join(CONTENT, "cheatsheets.yaml");
  if (!fs.existsSync(file)) return (cheatCache = []);
  const raw = parseYaml(fs.readFileSync(file, "utf8")) as { sections: Record<string, unknown>[] };
  cheatCache = (raw.sections ?? []).map((s) => ({
    id: String(s.id),
    title: String(s.title),
    description: String(s.description ?? ""),
    groups: ((s.groups as Record<string, unknown>[]) ?? []).map((g) => ({
      title: String(g.title),
      entries: ((g.entries as unknown[]) ?? []).map((e) => {
        if (Array.isArray(e)) return { syntax: String(e[0]), description: String(e[1]), example: e[2] !== undefined ? String(e[2]) : undefined };
        const o = e as Record<string, unknown>;
        return { syntax: String(o.syntax), description: String(o.description), example: o.example !== undefined ? String(o.example) : undefined };
      }),
    })),
  }));
  return cheatCache;
}
