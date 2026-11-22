import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Inline markdown: `code`, **bold**, *emphasis*, [text](href), <kbd>.
 * Isomorphic — used by server-rendered lessons and client exercises.
 */
export function Inline({ text }: { text: string }): ReactNode {
  return <>{parseInline(text, 0)}</>;
}

function parseInline(text: string, depth: number): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  let buf = "";
  let key = 0;
  const flush = () => {
    if (buf) out.push(buf);
    buf = "";
  };
  while (i < text.length) {
    const c = text[i];
    if (c === "\\" && i + 1 < text.length && "`*[]_\\".includes(text[i + 1])) {
      buf += text[i + 1];
      i += 2;
      continue;
    }
    if (c === "`") {
      // support ``code with ` inside``
      const fence = text.startsWith("``", i) ? "``" : "`";
      const end = text.indexOf(fence, i + fence.length);
      if (end !== -1) {
        flush();
        let code = text.slice(i + fence.length, end);
        if (fence === "``") code = code.trim();
        out.push(
          <code key={key++} className="inline-code">
            {code}
          </code>,
        );
        i = end + fence.length;
        continue;
      }
    }
    if (c === "*" && text[i + 1] === "*" && depth < 3) {
      const end = text.indexOf("**", i + 2);
      if (end !== -1) {
        flush();
        out.push(<strong key={key++}>{parseInline(text.slice(i + 2, end), depth + 1)}</strong>);
        i = end + 2;
        continue;
      }
    }
    if ((c === "*" || c === "_") && depth < 3 && /\S/.test(text[i + 1] ?? "") && (i === 0 || /[\s(]/.test(text[i - 1]))) {
      const end = text.indexOf(c, i + 1);
      if (end !== -1 && /\S/.test(text[end - 1]) && !/\w/.test(text[end + 1] ?? "")) {
        flush();
        out.push(<em key={key++}>{parseInline(text.slice(i + 1, end), depth + 1)}</em>);
        i = end + 1;
        continue;
      }
    }
    if (c === "[") {
      const m = text.slice(i).match(/^\[([^\]]+)\]\(([^)\s]+)\)/);
      if (m) {
        flush();
        const href = m[2];
        const children = parseInline(m[1], depth + 1);
        out.push(
          href.startsWith("/") ? (
            <Link key={key++} href={href}>
              {children}
            </Link>
          ) : href.startsWith("#") ? (
            <a key={key++} href={href}>
              {children}
            </a>
          ) : (
            <a key={key++} href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        );
        i += m[0].length;
        continue;
      }
    }
    if (c === "<" && text.startsWith("<kbd>", i)) {
      const end = text.indexOf("</kbd>", i);
      if (end !== -1) {
        flush();
        out.push(
          <kbd key={key++} className="rounded border border-line-strong bg-surface-2 px-1.5 py-0.5 font-mono text-[0.8em] text-fg">
            {text.slice(i + 5, end)}
          </kbd>,
        );
        i = end + 6;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}
