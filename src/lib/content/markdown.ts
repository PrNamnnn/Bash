import "server-only";
import { parse as parseYaml } from "yaml";
import type { Block, CalloutVariant, Exercise, Mistake, Section } from "@/types/content";
import { normalizeExercise } from "./exercise-schema";

/**
 * A deliberately small Markdown dialect for course content.
 *
 * Supported:
 *   ## Section            → new section (appears in the table of contents)
 *   ### / ####            → sub-headings inside a section
 *   paragraphs, - lists, 1. lists, | tables |
 *   > [!NOTE|TIP|WARNING|DANGER|PORTABILITY] Optional title
 *   ```bash title="x.sh" playground   fenced code (optionally runnable)
 *   ```output             attaches expected output to the previous code block
 *   ```notes              YAML map of line → explanation for the previous code block
 *   ```exercise           YAML exercise definition
 *   ```mistake            YAML { title, wrong, right, why }
 *   ```compare            YAML list of { label, code, note }
 *   ::viz <id>
 *   ::command <name> [<name>...]
 *   ::terminal [fixture]  …suggested commands…  ::
 */

export interface ParseContext {
  /** Used for auto-generated exercise ids and error messages. */
  source: string;
  exerciseCounter: { n: number };
}

const FENCE = /^```(\S*)\s*(.*)$/;

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

export function splitFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  const text = raw.replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) return { data: {}, body: text };
  const end = text.indexOf("\n---", 4);
  if (end === -1) return { data: {}, body: text };
  const yaml = text.slice(4, end);
  const body = text.slice(end + 4).replace(/^\n/, "");
  const data = (parseYaml(relaxYaml(yaml)) ?? {}) as Record<string, unknown>;
  return { data, body };
}

function parseAttrs(info: string): Record<string, string | true> {
  const attrs: Record<string, string | true> = {};
  const re = /(\w+)(?:="([^"]*)")?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(info))) attrs[m[1]] = m[2] ?? true;
  return attrs;
}

const SCALAR_KEYS = new Set([
  "prompt", "scenario", "explanation", "title", "answer", "solution", "fix", "hint", "label", "note", "why", "message",
  "pattern", "setup", "fixture", "expectedOutput", "args", "stdin", "id", "kind", "difficulty", "compare", "template", "wrong", "right", "code", "starter", "flags",
  "summary", "why", "description", "portability", "origin", "category", "output", "flag", "topic", "lesson", "syntax",
]);

function needsQuoting(v: string): boolean {
  if (/^["'|>[{]/.test(v)) return false;
  if (/^[&*!%@`]/.test(v)) return true;
  return /^[`@%]/.test(v) || /:\s/.test(v) || /\s#/.test(v) || /:$/.test(v) || /^-\s/.test(v) || /^\?\s/.test(v);
}

function sq(v: string): string {
  return "'" + v.replace(/'/g, "''") + "'";
}

/**
 * Make authoring forgiving: wrap plain scalars that YAML would misread
 * (values containing ": ", " #", or starting with a backtick) in single quotes.
 */
export function relaxYaml(code: string): string {
  const lines = code.split("\n");
  let blockIndent = -1;
  return lines
    .map((line) => {
      // Leave the bodies of block scalars (key: |) untouched.
      const indent = line.match(/^\s*/)![0].length;
      if (blockIndent >= 0) {
        if (line.trim() === "" || indent > blockIndent) return line;
        blockIndent = -1;
      }
      if (/:\s*[|>][-+]?\s*$/.test(line)) {
        blockIndent = indent + (line.trimStart().startsWith("- ") ? 2 : 0);
        return line;
      }
      let m = line.match(/^(\s*)([A-Za-z]+):[ \t]+(.+?)\s*$/);
      if (m && SCALAR_KEYS.has(m[2]) && needsQuoting(m[3])) return `${m[1]}${m[2]}: ${sq(m[3])}`;
      m = line.match(/^(\s*)-[ \t]+([A-Za-z]+):[ \t]+(.+?)\s*$/);
      if (m && SCALAR_KEYS.has(m[2])) return needsQuoting(m[3]) ? `${m[1]}- ${m[2]}: ${sq(m[3])}` : line;
      m = line.match(/^(\s*)-[ \t]+(.+?)\s*$/);
      if (m && needsQuoting(m[2]) && !/^[A-Za-z]+:\s/.test(m[2])) return `${m[1]}- ${sq(m[2])}`;
      return line;
    })
    .join("\n");
}

function yamlBlock<T>(code: string, ctx: ParseContext, what: string): T {
  try {
    return parseYaml(relaxYaml(code)) as T;
  } catch (err) {
    throw new Error(`[content] Invalid YAML in ${what} block of ${ctx.source}: ${(err as Error).message}`);
  }
}

const calloutVariants: Record<string, CalloutVariant> = {
  NOTE: "note",
  TIP: "tip",
  WARNING: "warning",
  DANGER: "danger",
  PORTABILITY: "portability",
};

/** Parse a markdown body into blocks (no section splitting). */
export function parseBlocks(body: string, ctx: ParseContext): Block[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  const lastCode = (): Extract<Block, { type: "code" }> | undefined => {
    const b = blocks[blocks.length - 1];
    return b && b.type === "code" ? b : undefined;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code
    const fence = line.match(FENCE);
    if (fence) {
      const lang = fence[1] || "text";
      const info = fence[2] ?? "";
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // closing fence
      const code = buf.join("\n");
      switch (lang) {
        case "output": {
          const prev = lastCode();
          if (prev) prev.output = code;
          else blocks.push({ type: "code", lang: "text", code, title: "Output" });
          break;
        }
        case "notes": {
          const prev = lastCode();
          const map = yamlBlock<Record<string, string>>(code, ctx, "notes");
          if (prev && map) {
            prev.notes = {};
            for (const [k, v] of Object.entries(map)) prev.notes[Number(k)] = String(v);
          }
          break;
        }
        case "exercise": {
          const data = yamlBlock<Record<string, unknown>>(code, ctx, "exercise");
          const exercise: Exercise = normalizeExercise(data, ctx);
          blocks.push({ type: "exercise", exercise });
          break;
        }
        case "mistake": {
          const m = yamlBlock<Mistake>(code, ctx, "mistake");
          if (!m?.title || !m.wrong || !m.right || !m.why) {
            throw new Error(`[content] mistake block in ${ctx.source} needs title, wrong, right, why`);
          }
          blocks.push({
            type: "mistake",
            mistake: {
              title: String(m.title),
              wrong: String(m.wrong).replace(/\n$/, ""),
              right: String(m.right).replace(/\n$/, ""),
              why: String(m.why).trim(),
            },
          });
          break;
        }
        case "compare": {
          const items = yamlBlock<{ label: string; code: string; note?: string }[]>(code, ctx, "compare");
          blocks.push({
            type: "compare",
            items: items.map((it) => ({
              label: String(it.label),
              code: String(it.code).replace(/\n$/, ""),
              note: it.note ? String(it.note).trim() : undefined,
            })),
          });
          break;
        }
        default: {
          const attrs = parseAttrs(info);
          blocks.push({
            type: "code",
            lang,
            code,
            title: typeof attrs.title === "string" ? attrs.title : undefined,
            playground: attrs.playground === true,
          });
        }
      }
      continue;
    }

    // Directives
    if (line.startsWith("::")) {
      const [name, ...args] = line.slice(2).trim().split(/\s+/);
      if (name === "viz") {
        blocks.push({ type: "viz", id: args[0] });
        i++;
        continue;
      }
      if (name === "command") {
        blocks.push({ type: "command", names: args });
        i++;
        continue;
      }
      if (name === "terminal") {
        const suggestions: string[] = [];
        i++;
        while (i < lines.length && lines[i].trim() !== "::") {
          const s = lines[i].trim();
          if (s) suggestions.push(s.replace(/^\$\s?/, ""));
          i++;
        }
        i++;
        blocks.push({ type: "terminal", fixture: args[0], suggestions });
        continue;
      }
      throw new Error(`[content] Unknown directive ::${name} in ${ctx.source}`);
    }

    // Headings inside a section
    const h = line.match(/^(#{3,4})\s+(.*)$/);
    if (h) {
      const text = h[2].trim();
      blocks.push({ type: "heading", level: h[1].length as 3 | 4, text, id: slugify(text) });
      i++;
      continue;
    }

    // Callouts
    if (line.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      const first = buf[0]?.match(/^\[!(\w+)\]\s*(.*)$/);
      let variant: CalloutVariant = "note";
      let title: string | undefined;
      if (first) {
        variant = calloutVariants[first[1].toUpperCase()] ?? "note";
        title = first[2] || undefined;
        buf.shift();
      }
      blocks.push({ type: "callout", variant, title, blocks: parseBlocks(buf.join("\n"), ctx) });
      continue;
    }

    // Tables
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const [head, sep, ...rest] = rows;
      const hasSep = sep && sep.every((c) => /^:?-{2,}:?$/.test(c.trim()));
      blocks.push({ type: "table", head, rows: hasSep ? rest : [sep, ...rest].filter(Boolean) });
      continue;
    }

    // Lists
    const listMatch = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      const ordered = /\d+\./.test(listMatch[2]);
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (m && /\d+\./.test(m[2]) === ordered) {
          items.push(m[3]);
          i++;
          continue;
        }
        if (items.length && /^\s{2,}\S/.test(lines[i])) {
          items[items.length - 1] += " " + lines[i].trim();
          i++;
          continue;
        }
        break;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    // Paragraph
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !FENCE.test(lines[i]) &&
      !lines[i].startsWith("::") &&
      !lines[i].startsWith(">") &&
      !lines[i].startsWith("|") &&
      !/^#{2,4}\s/.test(lines[i]) &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i])
    ) {
      buf.push(lines[i].trim());
      i++;
    }
    if (buf.length) blocks.push({ type: "paragraph", text: buf.join(" ") });
    else i++;
  }

  return blocks;
}

function splitRow(line: string): string[] {
  // Split on unescaped pipes that are not inside backticks.
  const cells: string[] = [];
  let cur = "";
  let inCode = false;
  const s = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
      continue;
    }
    if (c === "`") inCode = !inCode;
    if (c === "|" && !inCode) {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

/** Split a markdown body into `##` sections. */
export function parseSections(body: string, ctx: ParseContext): Section[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const sections: Section[] = [];
  let current: { title: string; id: string; lines: string[] } | null = null;
  let inFence = false;
  const used = new Set<string>();

  const flush = () => {
    if (!current) return;
    sections.push({ id: current.id, title: current.title, blocks: parseBlocks(current.lines.join("\n"), ctx) });
  };

  for (const line of lines) {
    if (/^```/.test(line)) inFence = !inFence;
    const m = !inFence && line.match(/^##\s+(.*?)(?:\s+\{#([\w-]+)\})?\s*$/);
    if (m) {
      flush();
      let id = m[2] ?? slugify(m[1]);
      while (used.has(id)) id += "-x";
      used.add(id);
      current = { title: m[1], id, lines: [] };
      continue;
    }
    if (!current) current = { title: "Introduction", id: "introduction", lines: [] };
    current.lines.push(line);
  }
  flush();
  return sections.filter((s) => s.blocks.length > 0);
}
