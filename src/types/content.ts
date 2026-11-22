/**
 * Content model for the curriculum.
 *
 * The outline (levels → modules → lessons) is lightweight metadata that can be
 * shipped to the client. Lesson bodies live in Markdown files and are parsed on
 * the server into the `Block` tree below, so they never enter the JS bundle.
 */

export type Difficulty = "beginner" | "intermediate" | "advanced" | "expert";

export interface LessonMeta {
  slug: string;
  title: string;
  summary: string;
  minutes: number;
  difficulty: Difficulty;
  /** Commands or concepts this lesson teaches — used for search and filters. */
  tags: string[];
}

export interface ModuleMeta {
  id: string;
  title: string;
  lessons: LessonMeta[];
}

export interface LevelMeta {
  id: string;
  number: number;
  title: string;
  tagline: string;
  description: string;
  difficulty: Difficulty;
  /** Skill area used by the dashboard's skill breakdown. */
  skill: SkillArea;
  modules: ModuleMeta[];
}

export type SkillArea =
  | "foundations"
  | "commands"
  | "shell-language"
  | "io"
  | "text-processing"
  | "scripting"
  | "internals"
  | "engineering"
  | "operations";

/** A lesson's position in the outline, resolved once on the server. */
export interface LessonLocation {
  lesson: LessonMeta;
  level: LevelMeta;
  module: ModuleMeta;
  index: number;
  prev?: LessonMeta;
  next?: LessonMeta;
}

/* ------------------------------------------------------------------ */
/* Parsed lesson body                                                  */
/* ------------------------------------------------------------------ */

export type CalloutVariant = "note" | "tip" | "warning" | "danger" | "portability";

export type Block =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: 3 | 4; text: string; id: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | {
      type: "code";
      code: string;
      lang: string;
      title?: string;
      output?: string;
      /** Render as an editable, runnable playground. */
      playground?: boolean;
      /** Optional per-line explanations, keyed by 1-based line number. */
      notes?: Record<number, string>;
    }
  | { type: "callout"; variant: CalloutVariant; title?: string; blocks: Block[] }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "viz"; id: string }
  | { type: "command"; names: string[] }
  | { type: "terminal"; fixture?: string; suggestions: string[] }
  | { type: "exercise"; exercise: Exercise }
  | { type: "mistake"; mistake: Mistake }
  | { type: "compare"; items: { label: string; code: string; note?: string }[] };

export interface Mistake {
  title: string;
  wrong: string;
  right: string;
  why: string;
}

export interface Section {
  id: string;
  title: string;
  blocks: Block[];
}

export interface Lesson {
  meta: LessonMeta;
  objectives: string[];
  summary: string[];
  related: string[];
  sections: Section[];
  exercises: Exercise[];
}

/* ------------------------------------------------------------------ */
/* Exercises                                                          */
/* ------------------------------------------------------------------ */

interface ExerciseBase {
  id: string;
  difficulty: Difficulty;
  title?: string;
  /** Inline markdown. */
  prompt: string;
  /** Optional scenario framing for real-world problems. */
  scenario?: string;
  code?: string;
  hints: string[];
  /** Inline markdown shown after a correct answer or once revealed. */
  explanation: string;
}

export interface McqExercise extends ExerciseBase {
  kind: "mcq";
  options: string[];
  answer: number;
}

export interface PredictExercise extends ExerciseBase {
  kind: "predict";
  answer: string;
  accept?: string[];
}

export interface FillExercise extends ExerciseBase {
  kind: "fill";
  /** Template with `___` marking each blank. */
  template: string;
  /** Accepted answers per blank. */
  blanks: string[][];
}

export interface FindBugExercise extends ExerciseBase {
  kind: "find-bug";
  /** 1-based line number of the bug in `code`. */
  answer: number;
  fix: string;
}

export interface CommandExercise extends ExerciseBase {
  kind: "command";
  /** Filesystem fixture the command runs against. */
  fixture?: string;
  /** Reference command; the learner's output must match its output. */
  solution: string;
  /** Compare stdout (default) or the resulting filesystem. */
  compare?: "stdout" | "stderr" | "fs" | "both";
  /** Shell commands run before both the learner's and the reference command. */
  setup?: string;
}

export interface ScriptCheck {
  pattern: string;
  flags?: string;
  /** If true the pattern must NOT appear. */
  forbid?: boolean;
  message: string;
}

export interface ScriptExercise extends ExerciseBase {
  kind: "script";
  starter: string;
  solution: string;
  checks?: ScriptCheck[];
  /** If present, the script runs in the simulator and its stdout must match. */
  expectedOutput?: string;
  args?: string;
  stdin?: string;
  fixture?: string;
}

export type Exercise =
  | McqExercise
  | PredictExercise
  | FillExercise
  | FindBugExercise
  | CommandExercise
  | ScriptExercise;

/* ------------------------------------------------------------------ */
/* Commands reference                                                  */
/* ------------------------------------------------------------------ */

export interface CommandFlag {
  flag: string;
  description: string;
}

export interface CommandExample {
  code: string;
  description: string;
  output?: string;
}

export interface CommandDoc {
  name: string;
  category: string;
  summary: string;
  why: string;
  syntax: string[];
  flags: CommandFlag[];
  examples: CommandExample[];
  useCases: string[];
  mistakes: string[];
  related: string[];
  /** Where the command comes from and how it differs across platforms. */
  origin: "bash-builtin" | "posix-utility" | "gnu-coreutils" | "linux-specific" | "external-tool";
  portability?: string;
}

/* ------------------------------------------------------------------ */
/* Projects, challenges, cheat sheets                                  */
/* ------------------------------------------------------------------ */

export interface ProjectMeta {
  slug: string;
  number: number;
  title: string;
  summary: string;
  difficulty: Difficulty;
  hours: number;
  concepts: string[];
}

export interface ProjectStep {
  id: string;
  title: string;
  blocks: Block[];
}

export interface Project {
  meta: ProjectMeta;
  problem: Block[];
  requirements: string[];
  conceptLinks: string[];
  steps: ProjectStep[];
  hints: string[];
  expectedOutput: Block[];
  tests: Block[];
  edgeCases: string[];
  solution: Block[];
  explanation: Block[];
  extensions: string[];
}

export interface Challenge {
  id: string;
  title: string;
  difficulty: Difficulty;
  topic: string;
  lesson?: string;
  exercise: Exercise;
}

export interface CheatEntry {
  syntax: string;
  description: string;
  example?: string;
}

export interface CheatSection {
  id: string;
  title: string;
  description: string;
  groups: { title: string; entries: CheatEntry[] }[];
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

export type SearchKind =
  | "lesson"
  | "section"
  | "command"
  | "exercise"
  | "cheatsheet"
  | "project"
  | "challenge"
  | "visualization"
  | "page";

export interface SearchItem {
  kind: SearchKind;
  title: string;
  /** Context line: level/module, command summary, etc. */
  context: string;
  href: string;
  /** Extra text that is searched but not displayed. */
  keywords: string;
}
