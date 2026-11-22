import type { ReactNode } from "react";

const COLORS: Record<number, string> = {
  30: "#6b727c",
  31: "#f37b7b",
  32: "#5fd49b",
  33: "#f2b45a",
  34: "#7fb2ff",
  35: "#d59cf5",
  36: "#6fd3e0",
  37: "#e6e8eb",
  90: "#8a919b",
  91: "#ff9a9a",
  92: "#86eab8",
  93: "#ffd27f",
  94: "#a7caff",
  95: "#e6b8ff",
  96: "#9ae6f0",
  97: "#ffffff",
};

interface Style {
  color?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
}

/** Render text containing ANSI SGR escape sequences as styled spans. */
export function Ansi({ text, base }: { text: string; base?: string }): ReactNode {
  if (!text.includes("\x1b")) return text;
  const out: ReactNode[] = [];
  let style: Style = {};
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  const push = (s: string) => {
    if (!s) return;
    const st: React.CSSProperties = {};
    if (style.color) st.color = style.color;
    if (style.bg) st.backgroundColor = style.bg;
    const cls = [style.bold && "ansi-bold", style.dim && "ansi-dim", style.italic && "ansi-italic", style.underline && "ansi-underline", style.inverse && "ansi-inverse"]
      .filter(Boolean)
      .join(" ");
    out.push(
      <span key={key++} className={cls || undefined} style={st}>
        {s}
      </span>,
    );
  };
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index));
    last = re.lastIndex;
    const codes = m[1] === "" ? [0] : m[1].split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) style = {};
      else if (c === 1) style = { ...style, bold: true };
      else if (c === 2) style = { ...style, dim: true };
      else if (c === 3) style = { ...style, italic: true };
      else if (c === 4) style = { ...style, underline: true };
      else if (c === 7) style = { ...style, inverse: true };
      else if (c === 22) style = { ...style, bold: false, dim: false };
      else if (c === 23) style = { ...style, italic: false };
      else if (c === 24) style = { ...style, underline: false };
      else if (c === 27) style = { ...style, inverse: false };
      else if (c === 39) style = { ...style, color: undefined };
      else if (c === 49) style = { ...style, bg: undefined };
      else if (COLORS[c]) style = { ...style, color: COLORS[c] };
      else if (c >= 40 && c <= 47) style = { ...style, bg: COLORS[c - 10] };
      else if ((c === 38 || c === 48) && codes[i + 1] === 5) {
        const n = codes[i + 2];
        const palette = [30, 31, 32, 33, 34, 35, 36, 37, 90, 91, 92, 93, 94, 95, 96, 97];
        const col = n < 16 ? COLORS[palette[n]] : `hsl(${(n * 37) % 360} 60% 65%)`;
        style = c === 38 ? { ...style, color: col } : { ...style, bg: col };
        i += 2;
      } else if ((c === 38 || c === 48) && codes[i + 1] === 2) {
        const col = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`;
        style = c === 38 ? { ...style, color: col } : { ...style, bg: col };
        i += 4;
      }
    }
  }
  push(text.slice(last));
  void base;
  return out;
}

/** Remove ANSI escape sequences. */
export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}
