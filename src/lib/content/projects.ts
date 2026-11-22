import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { Block, Project, ProjectStep } from "@/types/content";
import { findProject } from "@/content/projects";
import { parseSections, splitFrontmatter, slugify } from "./markdown";

const DIR = path.join(process.cwd(), "src", "content", "projects");
const cache = new Map<string, Project>();

function listItems(blocks: Block[]): string[] {
  return blocks.flatMap((b) => (b.type === "list" ? b.items : b.type === "paragraph" ? [b.text] : []));
}

export function projectExists(slug: string): boolean {
  return fs.existsSync(path.join(DIR, `${slug}.md`));
}

/**
 * Project files use fixed section headings:
 * Problem, Requirements, Concepts, Steps (### sub-steps), Hints, Expected output,
 * Test cases, Edge cases, Solution, Explanation, Extensions.
 */
export function getProject(slug: string): Project | undefined {
  const hit = cache.get(slug);
  if (hit) return hit;
  const meta = findProject(slug);
  if (!meta || !projectExists(slug)) return undefined;
  const { body } = splitFrontmatter(fs.readFileSync(path.join(DIR, `${slug}.md`), "utf8"));
  const sections = parseSections(body, { source: `project:${slug}`, exerciseCounter: { n: 0 } });
  const get = (title: string) => sections.find((s) => s.title.toLowerCase() === title.toLowerCase())?.blocks ?? [];
  const stepBlocks = get("Steps");
  const steps: ProjectStep[] = [];
  for (const b of stepBlocks) {
    if (b.type === "heading" && b.level === 3) steps.push({ id: slugify(b.text), title: b.text.replace(/^Step\s+\d+:\s*/i, ""), blocks: [] });
    else if (steps.length) steps[steps.length - 1].blocks.push(b);
  }
  for (const required of ["Problem", "Requirements", "Steps", "Solution", "Explanation"]) {
    if (!sections.some((s) => s.title === required)) throw new Error(`[content] project ${slug} is missing the "${required}" section`);
  }
  const project: Project = {
    meta,
    problem: get("Problem"),
    requirements: listItems(get("Requirements")),
    conceptLinks: meta.concepts,
    steps,
    hints: listItems(get("Hints")),
    expectedOutput: get("Expected output"),
    tests: get("Test cases"),
    edgeCases: listItems(get("Edge cases")),
    solution: get("Solution"),
    explanation: get("Explanation"),
    extensions: listItems(get("Extensions")),
  };
  cache.set(slug, project);
  return project;
}
