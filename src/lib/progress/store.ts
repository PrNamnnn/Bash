/**
 * Learning progress, persisted to localStorage.
 *
 * - Versioned schema with migrations, so future changes never wipe progress.
 * - Corrupted data is backed up and replaced with a clean state instead of crashing.
 * - Writes are debounced and skipped when nothing changed.
 * - Other tabs are kept in sync through the `storage` event.
 */

export const STORAGE_KEY = "bash-mastery:progress";
export const SCHEMA_VERSION = 1;

export interface ExerciseRecord {
  attempts: number;
  solved: boolean;
  solvedAt?: string;
  hintsUsed: number;
  revealed: boolean;
}

export interface ActivityEvent {
  type: "lesson" | "exercise" | "project" | "note";
  id: string;
  label: string;
  at: string;
}

export interface ProgressState {
  version: number;
  lessons: Record<string, { completedAt: string }>;
  exercises: Record<string, ExerciseRecord>;
  projects: Record<string, { steps: string[]; completedAt?: string; startedAt: string }>;
  bookmarks: string[];
  notes: Record<string, { text: string; updatedAt: string }>;
  /** Local calendar days (YYYY-MM-DD) with learning activity. */
  activityDays: string[];
  recent: ActivityEvent[];
  lastLesson?: { slug: string; at: string };
}

export const EMPTY_STATE: ProgressState = Object.freeze({
  version: SCHEMA_VERSION,
  lessons: {},
  exercises: {},
  projects: {},
  bookmarks: [],
  notes: {},
  activityDays: [],
  recent: [],
}) as ProgressState;

/* ------------------------------------------------------------------ */
/* validation                                                          */
/* ------------------------------------------------------------------ */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";

function sanitize(raw: unknown): ProgressState {
  if (!isObj(raw)) throw new Error("not an object");
  const out: ProgressState = {
    version: SCHEMA_VERSION,
    lessons: {},
    exercises: {},
    projects: {},
    bookmarks: [],
    notes: {},
    activityDays: [],
    recent: [],
  };
  if (isObj(raw.lessons)) {
    for (const [k, v] of Object.entries(raw.lessons)) if (isObj(v) && isStr(v.completedAt)) out.lessons[k] = { completedAt: v.completedAt };
  }
  if (isObj(raw.exercises)) {
    for (const [k, v] of Object.entries(raw.exercises)) {
      if (!isObj(v)) continue;
      out.exercises[k] = {
        attempts: Number.isFinite(v.attempts) ? Math.max(0, Number(v.attempts)) : 0,
        solved: v.solved === true,
        solvedAt: isStr(v.solvedAt) ? v.solvedAt : undefined,
        hintsUsed: Number.isFinite(v.hintsUsed) ? Math.max(0, Number(v.hintsUsed)) : 0,
        revealed: v.revealed === true,
      };
    }
  }
  if (isObj(raw.projects)) {
    for (const [k, v] of Object.entries(raw.projects)) {
      if (!isObj(v)) continue;
      out.projects[k] = {
        steps: Array.isArray(v.steps) ? v.steps.filter(isStr) : [],
        completedAt: isStr(v.completedAt) ? v.completedAt : undefined,
        startedAt: isStr(v.startedAt) ? v.startedAt : new Date().toISOString(),
      };
    }
  }
  if (Array.isArray(raw.bookmarks)) out.bookmarks = [...new Set(raw.bookmarks.filter(isStr))];
  if (isObj(raw.notes)) {
    for (const [k, v] of Object.entries(raw.notes)) {
      if (isObj(v) && isStr(v.text)) out.notes[k] = { text: v.text, updatedAt: isStr(v.updatedAt) ? v.updatedAt : new Date().toISOString() };
    }
  }
  if (Array.isArray(raw.activityDays)) out.activityDays = [...new Set(raw.activityDays.filter((d) => isStr(d) && /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort().slice(-400);
  if (Array.isArray(raw.recent)) {
    out.recent = raw.recent
      .filter((e): e is ActivityEvent => isObj(e) && isStr(e.type) && isStr(e.id) && isStr(e.at))
      .map((e) => ({ type: e.type, id: e.id, label: isStr(e.label) ? e.label : e.id, at: e.at }))
      .slice(0, 40);
  }
  if (isObj(raw.lastLesson) && isStr(raw.lastLesson.slug) && isStr(raw.lastLesson.at)) out.lastLesson = { slug: raw.lastLesson.slug, at: raw.lastLesson.at };
  return out;
}

/** Upgrade older stored shapes. Add a case for each future version bump. */
function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  const version = Number(raw.version ?? 0);
  if (version > SCHEMA_VERSION) {
    // Data from a newer app version: keep what we understand.
    return raw;
  }
  // v0 (unversioned) → v1: no structural change, just stamp the version.
  return { ...raw, version: SCHEMA_VERSION };
}

/* ------------------------------------------------------------------ */
/* store                                                               */
/* ------------------------------------------------------------------ */

type Listener = () => void;

let state: ProgressState = EMPTY_STATE;
let loaded = false;
let lastSerialized = "";
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();
let loadWarning: string | null = null;

function load(): void {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      state = sanitize(migrate(JSON.parse(raw)));
      lastSerialized = JSON.stringify(state);
    }
  } catch {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) window.localStorage.setItem(`${STORAGE_KEY}:corrupt-${Date.now()}`, raw);
    } catch {
      /* storage unavailable */
    }
    loadWarning = "Saved progress could not be read and was reset. A backup of the old data was kept in localStorage.";
    state = { ...EMPTY_STATE };
  }
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    try {
      state = e.newValue ? sanitize(migrate(JSON.parse(e.newValue))) : { ...EMPTY_STATE };
      lastSerialized = JSON.stringify(state);
      emit();
    } catch {
      /* ignore malformed cross-tab writes */
    }
  });
  window.addEventListener("pagehide", flush);
}

function emit(): void {
  for (const l of listeners) l();
}

function flush(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (typeof window === "undefined") return;
  const serialized = JSON.stringify(state);
  if (serialized === lastSerialized) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, serialized);
    lastSerialized = serialized;
  } catch {
    /* quota exceeded or storage disabled: keep in memory */
  }
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
}

export function getState(): ProgressState {
  load();
  return state;
}

export function getServerState(): ProgressState {
  return EMPTY_STATE;
}

export function subscribe(l: Listener): () => void {
  load();
  listeners.add(l);
  return () => listeners.delete(l);
}

export function consumeLoadWarning(): string | null {
  const w = loadWarning;
  loadWarning = null;
  return w;
}

function update(fn: (s: ProgressState) => ProgressState): void {
  load();
  const next = fn(state);
  if (next === state) return;
  state = next;
  emit();
  scheduleSave();
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

export function localDay(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function withActivity(s: ProgressState, ev: Omit<ActivityEvent, "at">): ProgressState {
  const at = new Date().toISOString();
  const day = localDay();
  const activityDays = s.activityDays.includes(day) ? s.activityDays : [...s.activityDays, day].slice(-400);
  const recent = [{ ...ev, at }, ...s.recent.filter((r) => !(r.type === ev.type && r.id === ev.id))].slice(0, 40);
  return { ...s, activityDays, recent };
}

export function computeStreak(days: string[], now?: Date): { current: number; longest: number } {
  if (!days.length) return { current: 0, longest: 0 };
  const today = now ?? new Date();
  const set = new Set(days);
  const dayMs = 86_400_000;
  // current: consecutive days ending today (or yesterday, so the streak isn't lost until a day is missed)
  let current = 0;
  let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!set.has(localDay(cursor))) cursor = new Date(cursor.getTime() - dayMs);
  while (set.has(localDay(cursor))) {
    current++;
    cursor = new Date(cursor.getTime() - dayMs);
  }
  const sorted = [...set].sort();
  let longest = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of sorted) {
    const [y, m, dd] = d.split("-").map(Number);
    const t = new Date(y, m - 1, dd).getTime();
    run = prev !== null && Math.round((t - prev) / dayMs) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = t;
  }
  return { current, longest };
}

/* ------------------------------------------------------------------ */
/* actions                                                             */
/* ------------------------------------------------------------------ */

export const actions = {
  completeLesson(slug: string, title: string): void {
    update((s) => {
      if (s.lessons[slug]) return s;
      return withActivity({ ...s, lessons: { ...s.lessons, [slug]: { completedAt: new Date().toISOString() } } }, { type: "lesson", id: slug, label: title });
    });
  },
  uncompleteLesson(slug: string): void {
    update((s) => {
      if (!s.lessons[slug]) return s;
      const lessons = { ...s.lessons };
      delete lessons[slug];
      return { ...s, lessons };
    });
  },
  visitLesson(slug: string): void {
    update((s) => (s.lastLesson?.slug === slug ? s : { ...s, lastLesson: { slug, at: new Date().toISOString() } }));
  },
  recordAttempt(id: string, label: string, correct: boolean): void {
    update((s) => {
      const prev = s.exercises[id] ?? { attempts: 0, solved: false, hintsUsed: 0, revealed: false };
      const rec: ExerciseRecord = {
        ...prev,
        attempts: prev.attempts + 1,
        solved: prev.solved || correct,
        solvedAt: prev.solved ? prev.solvedAt : correct ? new Date().toISOString() : undefined,
      };
      const next = { ...s, exercises: { ...s.exercises, [id]: rec } };
      return withActivity(next, { type: "exercise", id, label });
    });
  },
  useHint(id: string): void {
    update((s) => {
      const prev = s.exercises[id] ?? { attempts: 0, solved: false, hintsUsed: 0, revealed: false };
      return { ...s, exercises: { ...s.exercises, [id]: { ...prev, hintsUsed: prev.hintsUsed + 1 } } };
    });
  },
  reveal(id: string): void {
    update((s) => {
      const prev = s.exercises[id] ?? { attempts: 0, solved: false, hintsUsed: 0, revealed: false };
      if (prev.revealed) return s;
      return { ...s, exercises: { ...s.exercises, [id]: { ...prev, revealed: true } } };
    });
  },
  resetExercise(id: string): void {
    update((s) => {
      if (!s.exercises[id]) return s;
      const exercises = { ...s.exercises };
      delete exercises[id];
      return { ...s, exercises };
    });
  },
  toggleProjectStep(project: string, step: string, title: string): void {
    update((s) => {
      const prev = s.projects[project] ?? { steps: [], startedAt: new Date().toISOString() };
      const steps = prev.steps.includes(step) ? prev.steps.filter((x) => x !== step) : [...prev.steps, step];
      return withActivity({ ...s, projects: { ...s.projects, [project]: { ...prev, steps } } }, { type: "project", id: project, label: title });
    });
  },
  setProjectComplete(project: string, title: string, done: boolean): void {
    update((s) => {
      const prev = s.projects[project] ?? { steps: [], startedAt: new Date().toISOString() };
      const next = { ...prev, completedAt: done ? new Date().toISOString() : undefined };
      const st = { ...s, projects: { ...s.projects, [project]: next } };
      return done ? withActivity(st, { type: "project", id: project, label: title }) : st;
    });
  },
  toggleBookmark(key: string): void {
    update((s) => ({ ...s, bookmarks: s.bookmarks.includes(key) ? s.bookmarks.filter((b) => b !== key) : [key, ...s.bookmarks] }));
  },
  setNote(key: string, text: string, label: string): void {
    update((s) => {
      const cur = s.notes[key]?.text ?? "";
      if (cur === text) return s;
      const notes = { ...s.notes };
      if (!text.trim()) delete notes[key];
      else notes[key] = { text, updatedAt: new Date().toISOString() };
      const next = { ...s, notes };
      return text.trim() ? withActivity(next, { type: "note", id: key, label }) : next;
    });
  },
  importState(raw: unknown): void {
    const clean = sanitize(migrate(raw as Record<string, unknown>));
    update(() => clean);
    flush();
  },
  resetAll(): void {
    update(() => ({ ...EMPTY_STATE, lessons: {}, exercises: {}, projects: {}, bookmarks: [], notes: {}, activityDays: [], recent: [] }));
    flush();
  },
};

export function exportState(): string {
  return JSON.stringify(getState(), null, 2);
}
