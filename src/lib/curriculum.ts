import { curriculum } from "@/content/curriculum";
import type { Difficulty, LessonLocation, LessonMeta, LevelMeta, ModuleMeta } from "@/types/content";

export interface FlatLesson extends LessonMeta {
  levelId: string;
  levelNumber: number;
  levelTitle: string;
  moduleId: string;
  moduleTitle: string;
  /** Position in the full course, 0-based. */
  order: number;
}

let flatCache: FlatLesson[] | null = null;

export function allLessons(): FlatLesson[] {
  if (flatCache) return flatCache;
  const out: FlatLesson[] = [];
  for (const level of curriculum) {
    for (const mod of level.modules) {
      for (const lesson of mod.lessons) {
        out.push({
          ...lesson,
          levelId: level.id,
          levelNumber: level.number,
          levelTitle: level.title,
          moduleId: mod.id,
          moduleTitle: mod.title,
          order: out.length,
        });
      }
    }
  }
  flatCache = out;
  return out;
}

export function findLesson(slug: string): FlatLesson | undefined {
  return allLessons().find((l) => l.slug === slug);
}

export function locateLesson(slug: string): LessonLocation | undefined {
  const flat = allLessons();
  const index = flat.findIndex((l) => l.slug === slug);
  if (index === -1) return undefined;
  const entry = flat[index];
  const level = curriculum.find((l) => l.id === entry.levelId) as LevelMeta;
  const mod = level.modules.find((m) => m.id === entry.moduleId) as ModuleMeta;
  const lesson = mod.lessons.find((l) => l.slug === slug) as LessonMeta;
  return {
    lesson,
    level,
    module: mod,
    index,
    prev: index > 0 ? flat[index - 1] : undefined,
    next: index < flat.length - 1 ? flat[index + 1] : undefined,
  };
}

export function lessonsInLevel(levelId: string): FlatLesson[] {
  return allLessons().filter((l) => l.levelId === levelId);
}

export const difficultyOrder: Difficulty[] = ["beginner", "intermediate", "advanced", "expert"];

export const difficultyLabel: Record<Difficulty, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  expert: "Expert",
};

export function totalMinutes(lessons: { minutes: number }[]): number {
  return lessons.reduce((sum, l) => sum + l.minutes, 0);
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
