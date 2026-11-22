import { describe, expect, it } from "vitest";
import { allLessons } from "@/lib/curriculum";
import { getLesson, lessonExists } from "@/lib/content/lessons";
import { allCommands } from "@/lib/content/commands";
import { getChallenges, getCheatSheets } from "@/lib/content/extras";
import { getProject, projectExists } from "@/lib/content/projects";
import { projects } from "@/content/projects";
import { VIZ } from "@/lib/viz-meta";
import { PLAYGROUND_EXAMPLES } from "@/content/playground-examples";
import { runScript, createFs } from "@/lib/shell";
import type { Block, Exercise } from "@/types/content";

const norm = (s: string) =>
  s
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");

function walk(blocks: Block[], fn: (b: Block) => void) {
  for (const b of blocks) {
    fn(b);
    if (b.type === "callout") walk(b.blocks, fn);
  }
}

/** Run an exercise's reference answer through the simulator where that is meaningful. */
function verifyExercise(ex: Exercise): string | null {
  if (ex.kind === "command") {
    const fs = createFs(ex.fixture);
    const code = ex.setup ? `{\n${ex.setup}\n} >/dev/null 2>&1\n${ex.solution}` : ex.solution;
    const r = runScript({ code, fs, interactive: true });
    if (/command not found|not supported|not implemented|syntax error/.test(r.stderr)) return `solution failed: ${r.stderr.trim()}`;
    const shown = ex.compare === "stderr" ? r.stderr : r.stdout;
    if (!shown.trim() && (ex.compare ?? "stdout") !== "fs") return "solution produced no output";
    return null;
  }
  if (ex.kind === "script" && ex.expectedOutput !== undefined) {
    const r = runScript({ code: ex.solution, args: ex.args, stdin: ex.stdin, fixture: ex.fixture });
    if (norm(r.stdout) !== norm(ex.expectedOutput)) return `solution output mismatch:\n--- got ---\n${r.stdout}\n--- expected ---\n${ex.expectedOutput}\n--- stderr ---\n${r.stderr}`;
    for (const c of ex.checks ?? []) {
      const hit = new RegExp(c.pattern, c.flags ?? "m").test(ex.solution);
      if (c.forbid ? hit : !hit) return `solution fails its own check: ${c.message}`;
    }
    return null;
  }
  if (ex.kind === "script") {
    for (const c of ex.checks ?? []) {
      const hit = new RegExp(c.pattern, c.flags ?? "m").test(ex.solution);
      if (c.forbid ? hit : !hit) return `solution fails its own check: ${c.message}`;
    }
  }
  if (ex.kind === "predict" && ex.code && !/^#\s*no-verify/m.test(ex.code)) {
    const r = runScript({ code: ex.code, fixture: "default", stdin: "" });
    const expected = [ex.answer, ...(ex.accept ?? [])].map(norm);
    if (!expected.includes(norm(r.stdout))) return `predicted answer differs from simulator:\n--- simulator ---\n${r.stdout}${r.stderr ? "\n--- stderr ---\n" + r.stderr : ""}\n--- answer ---\n${ex.answer}`;
  }
  return null;
}

describe("curriculum content", () => {
  const lessons = allLessons();
  const slugs = new Set(lessons.map((l) => l.slug));
  const commands = allCommands();
  const vizIds = new Set(VIZ.map((v) => v.id));
  const exerciseIds = new Set<string>();

  it("command docs are well formed", () => {
    const problems: string[] = [];
    for (const c of commands.values()) {
      if (!c.examples.length) problems.push(`${c.name}: no examples`);
      for (const r of c.related) if (!commands.has(r)) problems.push(`${c.name}: related ${r} has no doc`);
    }
    expect(problems, problems.join("; ")).toEqual([]);
  });

  for (const l of lessons) {
    it(`lesson ${l.slug}`, () => {
      expect(lessonExists(l.slug), `missing file src/content/lessons/${l.slug}.md`).toBe(true);
      const lesson = getLesson(l.slug)!;
      expect(lesson.objectives.length, "objectives").toBeGreaterThan(1);
      expect(lesson.summary.length, "summary").toBeGreaterThan(1);
      expect(lesson.sections.length, "sections").toBeGreaterThan(2);
      expect(lesson.exercises.length, "exercises").toBeGreaterThan(0);
      for (const r of lesson.related) expect(slugs.has(r), `related ${r}`).toBe(true);
      const problems: string[] = [];
      for (const s of lesson.sections) {
        walk(s.blocks, (b) => {
          if (b.type === "command") for (const n of b.names) if (!commands.has(n)) problems.push(`unknown command doc ${n}`);
          if (b.type === "viz" && !vizIds.has(b.id)) problems.push(`unknown viz ${b.id}`);
          if (b.type === "exercise") {
            if (exerciseIds.has(b.exercise.id)) problems.push(`duplicate exercise id ${b.exercise.id}`);
            exerciseIds.add(b.exercise.id);
            const err = verifyExercise(b.exercise);
            if (err) problems.push(`exercise ${b.exercise.id}: ${err}`);
          }
          if (b.type === "code" && b.playground) {
            const r = runScript({ code: b.code, fixture: "default" });
            // Only errors in the block itself count; demos may deliberately run broken helper files.
            if (/^script\.sh: .*syntax error|not supported|not implemented/m.test(r.stderr)) problems.push(`playground block failed: ${r.stderr.trim()}`);
          }
        });
      }
      expect(problems, problems.join("\n\n")).toEqual([]);
    });
  }

  it("projects parse", () => {
    for (const p of projects) {
      if (!projectExists(p.slug)) continue;
      const pr = getProject(p.slug)!;
      expect(pr.steps.length, `${p.slug} steps`).toBeGreaterThan(2);
      expect(pr.requirements.length, `${p.slug} requirements`).toBeGreaterThan(2);
      for (const c of pr.conceptLinks) expect(slugs.has(c), `${p.slug} concept ${c}`).toBe(true);
      expect(pr.hints.length, `${p.slug} hints`).toBeGreaterThan(1);
      expect(pr.edgeCases.length, `${p.slug} edge cases`).toBeGreaterThan(1);
      expect(pr.extensions.length, `${p.slug} extensions`).toBeGreaterThan(1);
      expect(pr.solution.some((b) => b.type === "code"), `${p.slug} solution code`).toBe(true);
    }
  });

  for (const p of projects) {
    it(`project ${p.slug} runnable blocks`, () => {
      expect(projectExists(p.slug), `missing file src/content/projects/${p.slug}.md`).toBe(true);
      const pr = getProject(p.slug)!;
      const problems: string[] = [];
      const all = [pr.problem, ...pr.steps.map((s) => s.blocks), pr.expectedOutput, pr.tests, pr.solution, pr.explanation];
      for (const blocks of all) {
        walk(blocks, (b) => {
          if (b.type === "code" && b.playground) {
            const r = runScript({ code: b.code, fixture: "default" });
            if (/^script\.sh: .*(syntax error|not supported|not implemented|command not found|unbound variable)/m.test(r.stderr)) {
              problems.push(`${b.title ?? "block"}: ${r.stderr.trim()}`);
            }
            if (!r.stdout.trim()) problems.push(`${b.title ?? "block"}: produced no output`);
            if (process.env.SHOW_PROJECT_OUTPUT) console.log(`--- ${p.slug} ${b.title ?? ""}\n${r.stdout}${r.stderr}`);
          }
        });
      }
      expect(problems, problems.join("\n\n")).toEqual([]);
    });
  }

  it("challenges verify", () => {
    const problems: string[] = [];
    for (const c of getChallenges()) {
      const err = verifyExercise(c.exercise);
      if (err) problems.push(`${c.id}: ${err}`);
      if (c.lesson && !slugs.has(c.lesson)) problems.push(`${c.id}: unknown lesson ${c.lesson}`);
    }
    expect(problems, problems.join("\n\n")).toEqual([]);
  });

  it("cheat sheets parse", () => {
    for (const s of getCheatSheets()) expect(s.groups.length).toBeGreaterThan(0);
  });

  it("playground examples run cleanly", () => {
    const problems: string[] = [];
    for (const ex of PLAYGROUND_EXAMPLES) {
      const r = runScript({ code: ex.code, args: ex.args, stdin: ex.stdin, fixture: "default" });
      if (/syntax error|not supported|command not found|unbound|bad substitution/.test(r.stderr)) problems.push(`${ex.id}: ${r.stderr}`);
      if (!r.stdout.trim()) problems.push(`${ex.id}: no output`);
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
});
