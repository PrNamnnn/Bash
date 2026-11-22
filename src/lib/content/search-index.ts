import "server-only";
import type { Block, SearchItem } from "@/types/content";
import { allLessons } from "@/lib/curriculum";
import { getLesson } from "./lessons";
import { allCommands } from "./commands";
import { getChallenges, getCheatSheets } from "./extras";
import { projects } from "@/content/projects";
import { VIZ } from "@/lib/viz-meta";
import { NAV } from "@/lib/nav";

const strip = (s: string) => s.replace(/[`*_]/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

function blockText(blocks: Block[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.type === "paragraph") parts.push(b.text);
    else if (b.type === "list") parts.push(...b.items);
    else if (b.type === "heading") parts.push(b.text);
    else if (b.type === "callout") parts.push(blockText(b.blocks));
  }
  return strip(parts.join(" ")).slice(0, 600);
}

/** Build the client-side search index (served as a static JSON file). */
export function buildSearchIndex(): SearchItem[] {
  const items: SearchItem[] = [];
  for (const n of NAV) items.push({ kind: "page", title: n.label, context: "Page", href: n.href, keywords: n.href });
  items.push({ kind: "page", title: "Command reference", context: "Every command in depth", href: "/cheatsheets/commands", keywords: "man reference commands" });

  for (const l of allLessons()) {
    const lesson = getLesson(l.slug);
    items.push({
      kind: "lesson",
      title: l.title,
      context: `Level ${l.levelNumber} · ${l.levelTitle}`,
      href: `/learn/${l.slug}`,
      keywords: `${l.summary} ${l.tags.join(" ")} ${l.moduleTitle}`,
    });
    if (!lesson) continue;
    for (const s of lesson.sections) {
      items.push({ kind: "section", title: strip(s.title), context: l.title, href: `/learn/${l.slug}#${s.id}`, keywords: blockText(s.blocks) });
      for (const b of s.blocks) {
        if (b.type === "heading") items.push({ kind: "section", title: strip(b.text), context: `${l.title} › ${strip(s.title)}`, href: `/learn/${l.slug}#${b.id}`, keywords: "" });
      }
    }
    lesson.exercises.forEach((e) => {
      items.push({ kind: "exercise", title: e.title ?? strip(e.prompt).slice(0, 90), context: `Exercise · ${l.title}`, href: `/learn/${l.slug}#practice`, keywords: `${strip(e.prompt)} ${e.code ?? ""}` });
    });
  }
  for (const c of allCommands().values()) {
    items.push({ kind: "command", title: c.name, context: strip(c.summary), href: `/cheatsheets/commands#cmd-${c.name}`, keywords: `${c.syntax.join(" ")} ${c.flags.map((f) => f.flag).join(" ")} ${c.category}` });
  }
  for (const s of getCheatSheets()) {
    for (const g of s.groups) {
      for (const e of g.entries) {
        items.push({ kind: "cheatsheet", title: e.syntax, context: `${s.title} › ${g.title} — ${strip(e.description)}`, href: `/cheatsheets#${s.id}`, keywords: `${e.description} ${e.example ?? ""}` });
      }
    }
  }
  for (const p of projects) items.push({ kind: "project", title: `${p.title}`, context: `Project ${p.number} · ${p.summary}`, href: `/projects/${p.slug}`, keywords: p.concepts.join(" ") });
  for (const c of getChallenges()) items.push({ kind: "challenge", title: c.title, context: `Challenge · ${c.topic}`, href: `/challenges`, keywords: strip(c.exercise.prompt) });
  for (const v of VIZ) items.push({ kind: "visualization", title: v.title, context: v.description, href: `/visualize#${v.id}`, keywords: v.id });
  return items;
}
