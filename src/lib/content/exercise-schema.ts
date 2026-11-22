import type { Difficulty, Exercise, ScriptCheck } from "@/types/content";

interface Ctx {
  source: string;
  exerciseCounter: { n: number };
}

const difficulties: Difficulty[] = ["beginner", "intermediate", "advanced", "expert"];

function str(v: unknown, field: string, ctx: Ctx, required = true): string {
  if (v === undefined || v === null) {
    if (required) throw new Error(`[content] exercise in ${ctx.source} is missing "${field}"`);
    return "";
  }
  return String(v).replace(/\n$/, "");
}

function strList(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.map((x) => String(x).replace(/\n$/, ""));
  return [String(v)];
}

/**
 * Validate a YAML exercise definition and turn it into a typed Exercise.
 * Throws at build time so authoring mistakes never reach learners.
 */
export function normalizeExercise(data: Record<string, unknown>, ctx: Ctx): Exercise {
  if (!data || typeof data !== "object") throw new Error(`[content] empty exercise in ${ctx.source}`);
  ctx.exerciseCounter.n += 1;
  const id = data.id ? String(data.id) : `${ctx.source}:${ctx.exerciseCounter.n}`;
  const difficulty = (data.difficulty as Difficulty) ?? "beginner";
  if (!difficulties.includes(difficulty)) {
    throw new Error(`[content] exercise ${id} has invalid difficulty "${difficulty}"`);
  }
  const base = {
    id,
    difficulty,
    title: data.title ? String(data.title) : undefined,
    prompt: str(data.prompt, "prompt", ctx).trim(),
    scenario: data.scenario ? String(data.scenario).trim() : undefined,
    code: data.code !== undefined ? str(data.code, "code", ctx, false) : undefined,
    hints: strList(data.hints ?? data.hint),
    explanation: str(data.explanation, "explanation", ctx).trim(),
  };

  switch (data.kind) {
    case "mcq": {
      const options = strList(data.options);
      const answer = Number(data.answer);
      if (options.length < 2 || !Number.isInteger(answer) || answer < 0 || answer >= options.length) {
        throw new Error(`[content] mcq ${id} needs options and a valid 0-based answer index`);
      }
      return { ...base, kind: "mcq", options, answer };
    }
    case "predict":
      return {
        ...base,
        kind: "predict",
        answer: str(data.answer, "answer", ctx),
        accept: strList(data.accept),
      };
    case "fill": {
      const template = str(data.template, "template", ctx);
      const blanksRaw = data.blanks;
      if (!Array.isArray(blanksRaw)) throw new Error(`[content] fill ${id} needs blanks`);
      const blanks = blanksRaw.map((b) => strList(b));
      const count = template.split("___").length - 1;
      if (count !== blanks.length) {
        throw new Error(`[content] fill ${id}: template has ${count} blanks but ${blanks.length} answers`);
      }
      return { ...base, kind: "fill", template, blanks };
    }
    case "find-bug": {
      const answer = Number(data.answer);
      if (!base.code) throw new Error(`[content] find-bug ${id} needs code`);
      const lines = base.code.split("\n").length;
      if (!Number.isInteger(answer) || answer < 1 || answer > lines) {
        throw new Error(`[content] find-bug ${id} answer must be a line number 1..${lines}`);
      }
      return { ...base, kind: "find-bug", answer, fix: str(data.fix, "fix", ctx) };
    }
    case "command":
      return {
        ...base,
        kind: "command",
        fixture: data.fixture ? String(data.fixture) : undefined,
        solution: str(data.solution, "solution", ctx),
        compare: (data.compare as "stdout" | "stderr" | "fs" | "both") ?? "stdout",
        setup: data.setup ? String(data.setup) : undefined,
      };
    case "script": {
      const checks = Array.isArray(data.checks)
        ? (data.checks as Record<string, unknown>[]).map(
            (c): ScriptCheck => ({
              pattern: String(c.pattern),
              flags: c.flags ? String(c.flags) : undefined,
              forbid: Boolean(c.forbid),
              message: String(c.message),
            }),
          )
        : undefined;
      for (const c of checks ?? []) {
        try {
          new RegExp(c.pattern, c.flags);
        } catch {
          throw new Error(`[content] script ${id} has invalid check pattern ${c.pattern}`);
        }
      }
      return {
        ...base,
        kind: "script",
        starter: str(data.starter, "starter", ctx, false),
        solution: str(data.solution, "solution", ctx),
        checks,
        expectedOutput: data.expectedOutput !== undefined ? String(data.expectedOutput).replace(/\n$/, "") : undefined,
        args: data.args ? String(data.args) : undefined,
        stdin: data.stdin ? String(data.stdin) : undefined,
        fixture: data.fixture ? String(data.fixture) : undefined,
      };
    }
    default:
      throw new Error(`[content] exercise ${id} in ${ctx.source} has unknown kind "${String(data.kind)}"`);
  }
}
