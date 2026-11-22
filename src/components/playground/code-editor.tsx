"use client";

import { useDeferredValue, useId, useMemo, useRef } from "react";
import { highlight, tokClass } from "@/lib/highlight";
import { cn } from "@/lib/cn";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onRun?: () => void;
  ariaLabel: string;
  minLines?: number;
  maxHeight?: string;
  errorLine?: number;
  highlightLine?: number;
  onLineClick?: (line: number) => void;
}

/**
 * Lightweight code editor: a transparent textarea layered over a highlighted
 * <pre>. No editor library, so it costs a few KB instead of megabytes.
 */
export function CodeEditor({ value, onChange, onRun, ariaLabel, minLines = 6, maxHeight = "480px", errorLine, highlightLine, onLineClick }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const helpId = useId();
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const deferred = useDeferredValue(value);
  const lines = useMemo(() => highlight(deferred, "bash"), [deferred]);
  const lineCount = Math.max(minLines, value.split("\n").length);

  const syncScroll = () => {
    const ta = taRef.current;
    if (!ta) return;
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop;
      preRef.current.scrollLeft = ta.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      onRun?.();
      return;
    }
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: end } = ta;
      const next = value.slice(0, s) + "  " + value.slice(end);
      onChange(next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = s + 2;
      });
      return;
    }
    if (e.key === "Enter") {
      // keep indentation
      const s = ta.selectionStart;
      const lineStart = value.lastIndexOf("\n", s - 1) + 1;
      const indent = value.slice(lineStart, s).match(/^\s*/)?.[0] ?? "";
      const extra = /(\bthen|\bdo|\{|\belse)\s*$/.test(value.slice(lineStart, s)) ? "  " : "";
      if (indent || extra) {
        e.preventDefault();
        const ins = "\n" + indent + extra;
        onChange(value.slice(0, s) + ins + value.slice(ta.selectionEnd));
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = s + ins.length;
        });
      }
    }
  };

  const shared = "font-mono text-[13px] leading-[1.6] p-3 whitespace-pre tab-[2]";

  return (
    <div className="relative flex overflow-hidden bg-inset" style={{ maxHeight }}>
      <div
        ref={gutterRef}
        aria-hidden
        className="no-scrollbar shrink-0 overflow-hidden border-r border-line bg-surface py-3 pr-2 pl-3 text-right font-mono text-[12px] leading-[1.6] text-fg-subtle select-none"
        style={{ minHeight: `${minLines * 1.6 * 13 + 24}px` }}
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div
            key={i}
            onClick={() => onLineClick?.(i + 1)}
            className={cn(
              "px-1",
              onLineClick && "cursor-pointer hover:text-fg",
              errorLine === i + 1 && "rounded bg-red-dim text-red",
              highlightLine === i + 1 && "rounded bg-accent-dim text-accent",
            )}
            style={{ height: "1.6em", fontSize: 13 }}
          >
            <span className="text-[12px]">{i + 1}</span>
          </div>
        ))}
      </div>
      <div className="relative min-w-0 flex-1">
        <pre ref={preRef} aria-hidden className={cn(shared, "pointer-events-none absolute inset-0 m-0 overflow-hidden")}>
          {lines.map((toks, i) => (
            <div key={i} className={cn(highlightLine === i + 1 && "-mx-3 bg-accent-dim/50 px-3", errorLine === i + 1 && "-mx-3 bg-red-dim/60 px-3")} style={{ minHeight: "1.6em" }}>
              {toks.map((t, j) => (
                <span key={j} className={tokClass[t.t]}>
                  {t.v}
                </span>
              ))}
            </div>
          ))}
          {"\n"}
        </pre>
        <span id={helpId} className="sr-only">
          Code editor. Tab inserts spaces; press Escape then Tab to move focus. Ctrl+Enter runs the code.
        </span>
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onScroll={syncScroll}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          aria-label={ariaLabel}
          aria-describedby={helpId}
          onKeyUp={(e) => {
            if (e.key === "Escape") e.currentTarget.blur();
          }}
          className={cn(
            shared,
            "relative block w-full resize-none overflow-auto bg-transparent text-transparent caret-fg outline-none selection:bg-accent/30 focus-visible:outline-none",
          )}
          style={{ minHeight: `${minLines * 1.6 * 13 + 24}px`, height: `${lineCount * 1.6 * 13 + 24}px`, maxHeight, WebkitTextFillColor: "transparent" }}
        />
      </div>
    </div>
  );
}
