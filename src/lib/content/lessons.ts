import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { Exercise, Lesson, Section } from "@/types/content";
import { findLesson } from "@/lib/curriculum";
import { parseSections, splitFrontmatter } from "./markdown";

const LESSON_DIR = path.join(process.cwd(), "src", "content", "lessons");

const cache = new Map<string, Lesson>();

export function collectExercises(sections: Section[]): Exercise[] {
  const out: Exercise[] = [];
  for (const s of sections) {
    for (const b of s.blocks) {
      if (b.type === "exercise") out.push(b.exercise);
      if (b.type === "callout") {
        for (const inner of b.blocks) if (inner.type === "exercise") out.push(inner.exercise);
      }
    }
  }
  return out;
}

function toList(v: unknown): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

export function lessonExists(slug: string): boolean {
  return fs.existsSync(path.join(LESSON_DIR, `${slug}.md`));
}

/** Load and parse a lesson. Results are memoised per process. */
export function getLesson(slug: string): Lesson | undefined {
  const cached = cache.get(slug);
  if (cached) return cached;
  const meta = findLesson(slug);
  if (!meta) return undefined;
  const file = path.join(LESSON_DIR, `${slug}.md`);
  if (!fs.existsSync(file)) return undefined;
  const raw = fs.readFileSync(file, "utf8");
  const { data, body } = splitFrontmatter(raw);
  const sections = parseSections(body, { source: slug, exerciseCounter: { n: 0 } });
  const lesson: Lesson = {
    meta: {
      slug: meta.slug,
      title: meta.title,
      summary: meta.summary,
      minutes: meta.minutes,
      difficulty: meta.difficulty,
      tags: meta.tags,
    },
    objectives: toList(data.objectives),
    summary: toList(data.summary),
    related: toList(data.related),
    sections,
    exercises: collectExercises(sections),
  };
  cache.set(slug, lesson);
  return lesson;
}
