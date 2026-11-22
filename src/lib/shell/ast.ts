/** AST for the subset of Bash supported by the simulator. */

export type WordPart =
  /** q: 0 = unquoted, 1 = single-quoted / backslash-escaped, 2 = inside double quotes */
  | { t: "lit"; v: string; q: 0 | 1 | 2 }
  | { t: "param"; p: ParamExp; q: boolean }
  | { t: "cmd"; node: Node; src: string; q: boolean }
  | { t: "arith"; src: string; q: boolean }
  | { t: "proc"; dir: "<" | ">"; node: Node; src: string };

export interface Word {
  parts: WordPart[];
  raw: string;
  /** Argument of a declaration builtin that looks like an assignment (no word splitting). */
  assignLike?: boolean;
  /** `name=(...)` argument of declare/local/readonly/export. */
  arrayAssign?: { name: string; append: boolean; elements: Word[] };
}

export interface ParamExp {
  name: string;
  index?: string;
  length?: boolean;
  indirect?: boolean;
  keys?: boolean;
  prefixList?: boolean;
  op?: string;
  arg?: Word;
  arg2?: Word;
}

export type RedirOp = ">" | ">>" | "<" | ">|" | "<>" | ">&" | "<&" | "&>" | "&>>" | "<<" | "<<-" | "<<<";

export interface Redir {
  fd?: number;
  fdVar?: string;
  op: RedirOp;
  target: Word;
  heredoc?: { body: Word; expand: boolean; raw: string };
}

export interface Assign {
  name: string;
  index?: string;
  append: boolean;
  value?: Word;
  array?: Word[];
}

export type Node =
  | { k: "simple"; assigns: Assign[]; words: Word[]; redirs: Redir[]; line: number; src: string }
  | { k: "pipeline"; cmds: Node[]; negate: boolean; time: boolean; pipeErr: boolean[] }
  | { k: "andor"; first: Node; rest: { op: "&&" | "||"; node: Node }[] }
  | { k: "list"; items: { node: Node; bg: boolean }[] }
  | { k: "subshell"; body: Node; redirs: Redir[] }
  | { k: "group"; body: Node; redirs: Redir[] }
  | { k: "if"; clauses: { cond: Node; body: Node }[]; else?: Node; redirs: Redir[] }
  | { k: "for"; name: string; words: Word[] | null; body: Node; redirs: Redir[]; select?: boolean }
  | { k: "cfor"; init: string; cond: string; step: string; body: Node; redirs: Redir[] }
  | { k: "while"; until: boolean; cond: Node; body: Node; redirs: Redir[] }
  | {
      k: "case";
      word: Word;
      items: { patterns: Word[]; body: Node | null; term: ";;" | ";&" | ";;&" }[];
      redirs: Redir[];
    }
  | { k: "func"; name: string; body: Node; src: string }
  | { k: "cond"; expr: CondExpr; redirs: Redir[]; line: number }
  | { k: "arith"; src: string; redirs: Redir[]; line: number };

export type CondExpr =
  | { t: "and" | "or"; l: CondExpr; r: CondExpr }
  | { t: "not"; e: CondExpr }
  | { t: "unary"; op: string; arg: Word }
  | { t: "binary"; op: string; l: Word; r: Word }
  | { t: "word"; w: Word };
