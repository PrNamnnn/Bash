import { curriculum } from "@/content/curriculum";
import type { NavLevel } from "@/components/lesson/curriculum-nav";

/** Compact outline passed to the client-side curriculum navigation. */
export function navLevels(): NavLevel[] {
  return curriculum.map((l) => ({
    id: l.id,
    number: l.number,
    title: l.title,
    modules: l.modules.map((m) => ({ id: m.id, title: m.title, lessons: m.lessons.map((x) => ({ slug: x.slug, title: x.title, minutes: x.minutes })) })),
  }));
}
