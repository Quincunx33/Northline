import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useInspector } from "@/lib/store";
import type { Finding } from "@/lib/types";
import { cn } from "@/lib/utils";

const LINE = 20;
const NO_FINDINGS: Finding[] = [];

export function SourceViewer() {
  const source = useInspector((s) => s.source);
  const findings = useInspector((s) => s.analysis?.findings ?? NO_FINDINGS);
  const selectedLine = useInspector((s) => s.selectedLine);
  const playing = useInspector((s) => s.playing);
  const search = useInspector((s) => s.search);
  const setSearch = useInspector((s) => s.setSearch);
  const selectLine = useInspector((s) => s.selectLine);
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(280);

  const lines = useMemo(() => source.split(/\r?\n/), [source]);
  const marks = useMemo(() => {
    const map = new Map<number, "error" | "warning" | "info">();
    for (const finding of findings) {
      if (finding.line == null) continue;
      const prev = map.get(finding.line);
      if (finding.severity === "error" || !prev) {
        if (finding.severity === "error" || finding.severity === "warning" || finding.severity === "info") {
          if (finding.severity === "error" || prev !== "error") map.set(finding.line, finding.severity);
        }
      }
    }
    return map;
  }, [findings]);

  const query = search.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!query) return [] as number[];
    const hit: number[] = [];
    lines.forEach((line, index) => {
      if (line.toLowerCase().includes(query)) hit.push(index + 1);
    });
    return hit;
  }, [lines, query]);

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setHeight(node.clientHeight));
    observer.observe(node);
    setHeight(node.clientHeight);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || selectedLine == null || !scroller.current) return;
    const top = (selectedLine - 1) * LINE;
    const node = scroller.current;
    if (top < node.scrollTop || top > node.scrollTop + node.clientHeight - LINE * 2) {
      node.scrollTop = Math.max(0, top - node.clientHeight / 3);
    }
  }, [playing, selectedLine]);

  const start = Math.max(0, Math.floor(scrollTop / LINE) - 12);
  const count = Math.ceil(height / LINE) + 24;
  const slice = lines.slice(start, start + count);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-surface/50 px-3 py-2 sm:px-4">
        <div className="relative flex min-w-0 flex-1 items-center">
          <Search className="pointer-events-none absolute left-2.5 size-3.5 text-muted" />
          <input
            id="gcode-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search block, G-code, or comment…"
            className="h-8.5 w-full rounded-md border border-border bg-bg pl-8 pr-7 font-mono text-xs text-fg outline-none transition-colors focus:border-primary"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 text-muted hover:text-fg"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
          {query ? `${matches.length} hits` : `${lines.length} lines`}
        </span>
      </div>
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-auto"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div className="relative" style={{ height: lines.length * LINE }}>
          <div style={{ transform: `translateY(${start * LINE}px)` }}>
            {slice.map((line, offset) => {
              const number = start + offset + 1;
              const mark = marks.get(number);
              const active = number === selectedLine;
              const hit = query && line.toLowerCase().includes(query);
              return (
                <button
                  key={number}
                  type="button"
                  onClick={() => selectLine(number)}
                  className={cn(
                    "flex w-full items-start gap-2 px-2 text-left font-mono text-xs leading-5",
                    active ? "bg-raised text-fg" : "text-muted hover:bg-surface",
                    hit && "text-fg",
                  )}
                >
                  <span className="w-12 shrink-0 text-right text-muted">{number}</span>
                  <span
                    className={cn(
                      "mt-1 size-1.5 rounded-full",
                      mark === "error" && "bg-danger",
                      mark === "warning" && "bg-primary",
                      mark === "info" && "bg-rapid",
                      !mark && "bg-transparent",
                    )}
                  />
                  <span className="min-w-0 flex-1 overflow-hidden whitespace-pre text-left">
                    <Highlighted line={line.slice(0, 400)} />
                    {line.length > 400 ? " …" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Highlighted({ line }: { line: string }) {
  if (!line) return <span> </span>;
  const parts: { text: string; kind: string }[] = [];
  const re =
    /(\([^)]*\)|;.*$)|([A-Za-z])([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let last = 0;
  for (const match of line.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ text: line.slice(last, index), kind: "plain" });
    if (match[1]) parts.push({ text: match[1], kind: "comment" });
    else {
      const letter = match[2].toUpperCase();
      const kind = letter === "G" ? "g" : letter === "M" ? "m" : "XYZ".includes(letter) ? "axis" : "word";
      parts.push({ text: match[2] + match[3], kind });
    }
    last = index + match[0].length;
  }
  if (last < line.length) parts.push({ text: line.slice(last), kind: "plain" });
  return (
    <>
      {parts.map((part, index) => (
        <span
          key={index}
          className={cn(
            part.kind === "comment" && "text-muted italic",
            part.kind === "g" && "text-primary",
            part.kind === "m" && "text-ok",
            part.kind === "axis" && "text-fg",
            part.kind === "word" && "text-rapid",
          )}
        >
          {part.text}
        </span>
      ))}
    </>
  );
}
