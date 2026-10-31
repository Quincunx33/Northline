import {
  Check,
  Code,
  Download,
  Edit3,
  Eye,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { downloadBlob } from "@/lib/reports";
import { useInspector } from "@/lib/store";
import type { Finding } from "@/lib/types";
import { cn } from "@/lib/utils";

const LINE = 20;
const NO_FINDINGS: Finding[] = [];

const COMMON_SNIPPETS: { label: string; code: string; title: string }[] = [
  { label: "G00 Rapid", code: "G00 Z5.000\n", title: "Insert Rapid Retract move" },
  { label: "G01 Feed", code: "G01 X50.000 Y50.000 F800\n", title: "Insert Linear Feed move" },
  { label: "G02 Arc CW", code: "G02 X20.000 Y20.000 I10.000 J0.000 F600\n", title: "Insert Clockwise Arc" },
  { label: "G03 Arc CCW", code: "G03 X20.000 Y20.000 I0.000 J10.000 F600\n", title: "Insert Counter-Clockwise Arc" },
  { label: "M03 Spindle", code: "M03 S12000\n", title: "Start Spindle CW at 12k RPM" },
  { label: "M05 Stop", code: "M05\n", title: "Stop Spindle" },
  { label: "M08 Coolant", code: "M08\n", title: "Flood Coolant ON" },
  { label: "G28 Home", code: "G28 G91 Z0\n", title: "Safe retract to Home" },
];

export function SourceViewer() {
  const source = useInspector((s) => s.source);
  const originalSource = useInspector((s) => s.originalSource);
  const fileName = useInspector((s) => s.fileName);
  const findings = useInspector((s) => s.analysis?.findings ?? NO_FINDINGS);
  const selectedLine = useInspector((s) => s.selectedLine);
  const playing = useInspector((s) => s.playing);
  const search = useInspector((s) => s.search);
  const status = useInspector((s) => s.status);
  const setSearch = useInspector((s) => s.setSearch);
  const selectLine = useInspector((s) => s.selectLine);
  const updateSource = useInspector((s) => s.updateSource);
  const revertSource = useInspector((s) => s.revertSource);

  // Tab mode: "view" (line-by-line inspector synced with 3D) or "edit" (interactive code editor)
  const [mode, setMode] = useState<"view" | "edit">("view");

  // Local editor draft state
  const [draft, setDraft] = useState(source);
  const [autoApply, setAutoApply] = useState(true);
  const [justApplied, setJustApplied] = useState(false);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });

  // Sync draft when source changes externally (e.g. sample change or file upload)
  useEffect(() => {
    setDraft(source);
  }, [source]);

  // Check if modified compared to original
  const isDirty = draft !== originalSource;
  const hasUnappliedEdits = draft !== source;

  // View mode virtual scrolling
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(280);

  // Edit mode refs
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const lines = useMemo(() => (mode === "edit" ? draft : source).split(/\r?\n/), [mode, draft, source]);

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
  }, [mode]);

  // Keep line in view when simulation plays in view mode
  useEffect(() => {
    if (mode !== "view" || !playing || selectedLine == null || !scroller.current) return;
    const top = (selectedLine - 1) * LINE;
    const node = scroller.current;
    if (top < node.scrollTop || top > node.scrollTop + node.clientHeight - LINE * 2) {
      node.scrollTop = Math.max(0, top - node.clientHeight / 3);
    }
  }, [mode, playing, selectedLine]);

  // When switching to edit mode, scroll textarea to the currently selected line
  useEffect(() => {
    if (mode === "edit" && selectedLine && textareaRef.current) {
      const textarea = textareaRef.current;
      const targetLine = Math.min(selectedLine, lines.length);
      const approxLineHeight = 20;
      textarea.scrollTop = Math.max(0, (targetLine - 5) * approxLineHeight);
      if (gutterRef.current) {
        gutterRef.current.scrollTop = textarea.scrollTop;
      }
    }
  }, [mode, selectedLine, lines.length]);

  const handleApplyChanges = (immediate = true) => {
    updateSource(draft, immediate);
    setJustApplied(true);
    setTimeout(() => setJustApplied(false), 1800);
  };

  const handleDraftChange = (newText: string) => {
    setDraft(newText);
    if (autoApply) {
      updateSource(newText, false);
    }
  };

  const handleRevert = () => {
    revertSource();
    setDraft(originalSource);
  };

  const handleDownload = () => {
    const blob = new Blob([draft], { type: "text/plain;charset=utf-8" });
    const name = fileName.replace(/\.[^/.]+$/, "") + "-edited.nc";
    downloadBlob(blob, name);
  };

  const handleFormatGCode = () => {
    // Standardize G-code: uppercase commands, trim trailing spaces
    const formatted = draft
      .split(/\r?\n/)
      .map((l) => {
        const commentIdx = l.indexOf(";");
        const parenIdx = l.indexOf("(");
        const cutIdx =
          commentIdx !== -1 && parenIdx !== -1
            ? Math.min(commentIdx, parenIdx)
            : commentIdx !== -1
              ? commentIdx
              : parenIdx;
        if (cutIdx !== -1) {
          const codePart = l.slice(0, cutIdx).toUpperCase();
          const commentPart = l.slice(cutIdx);
          return (codePart + commentPart).trimEnd();
        }
        return l.toUpperCase().trimEnd();
      })
      .join("\n");
    handleDraftChange(formatted);
  };

  const insertSnippet = (snippet: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const startPos = textarea.selectionStart;
    const endPos = textarea.selectionEnd;
    const newText = draft.slice(0, startPos) + snippet + draft.slice(endPos);
    handleDraftChange(newText);

    setTimeout(() => {
      textarea.focus();
      const newCursor = startPos + snippet.length;
      textarea.setSelectionRange(newCursor, newCursor);
      updateCursorPosition(newText, newCursor);
    }, 0);
  };

  const updateCursorPosition = (text: string, pos: number) => {
    const textUpToPos = text.slice(0, pos);
    const lineList = textUpToPos.split("\n");
    const line = lineList.length;
    const col = lineList[lineList.length - 1].length + 1;
    setCursorPos({ line, col });
  };

  const handleTextareaKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab key inserts 2 spaces instead of leaving focus
    if (e.key === "Tab") {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const spaces = "  ";
      const newText = draft.slice(0, start) + spaces + draft.slice(end);
      handleDraftChange(newText);
      setTimeout(() => {
        textarea.setSelectionRange(start + spaces.length, start + spaces.length);
        updateCursorPosition(newText, start + spaces.length);
      }, 0);
    } else if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      handleApplyChanges(true);
    }
  };

  const handleTextareaScroll = () => {
    if (textareaRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  const start = Math.max(0, Math.floor(scrollTop / LINE) - 12);
  const count = Math.ceil(height / LINE) + 24;
  const slice = lines.slice(start, start + count);

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      {/* ──────────────────────────────────────────────────────────── */}
      {/* Top Action Toolbar (Mode switcher, Search, Apply, Download)  */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface/70 px-3 py-2 sm:px-4 shrink-0">
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Mode Segmented Switch: View / Inspect vs Edit */}
          <div className="flex rounded-lg border border-border bg-bg/80 p-0.5">
            <button
              type="button"
              onClick={() => setMode("view")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                mode === "view"
                  ? "bg-primary text-primary-fg shadow-xs"
                  : "text-muted hover:text-fg hover:bg-surface",
              )}
            >
              <Eye className="size-3.5" />
              <span>View</span>
            </button>
            <button
              type="button"
              onClick={() => setMode("edit")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                mode === "edit"
                  ? "bg-primary text-primary-fg shadow-xs"
                  : "text-muted hover:text-fg hover:bg-surface",
              )}
            >
              <Edit3 className="size-3.5" />
              <span>Edit</span>
              {isDirty && (
                <span className="size-1.5 rounded-full bg-amber-400 animate-pulse" title="Code modified" />
              )}
            </button>
          </div>

          {/* Quick status badge */}
          {mode === "edit" && (
            <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-mono">
              {status === "running" ? (
                <span className="text-primary animate-pulse">Parsing 3D…</span>
              ) : hasUnappliedEdits ? (
                <span className="text-amber-400">Unapplied edits</span>
              ) : (
                <span className="text-ok flex items-center gap-1">
                  <Check className="size-3" /> Synced with 3D
                </span>
              )}
            </div>
          )}
        </div>

        {/* View mode search or Edit mode actions */}
        {mode === "view" ? (
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2 max-w-sm ml-auto">
            <div className="relative flex min-w-0 flex-1 items-center">
              <Search className="pointer-events-none absolute left-2.5 size-3.5 text-muted" />
              <input
                id="gcode-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search G-code, coordinates, comments…"
                className="h-8 w-full rounded-md border border-border bg-bg pl-8 pr-7 font-mono text-xs text-fg outline-none transition-colors focus:border-primary"
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
        ) : (
          <div className="flex items-center gap-1.5 sm:gap-2 ml-auto">
            {/* Auto-apply toggle */}
            <label className="hidden sm:inline-flex items-center gap-1.5 text-xs text-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoApply}
                onChange={(e) => setAutoApply(e.target.checked)}
                className="rounded border-border accent-primary size-3.5"
              />
              <span>Auto-apply</span>
            </label>

            {/* Format code */}
            <button
              type="button"
              onClick={handleFormatGCode}
              title="Uppercase G-codes and clean trailing whitespace"
              className="inline-flex h-7.5 items-center gap-1 rounded-md border border-border bg-bg px-2 text-xs text-muted hover:text-fg hover:border-primary/50 transition-colors"
            >
              <Sparkles className="size-3 text-primary" />
              <span className="hidden sm:inline">Format</span>
            </button>

            {/* Revert edits button */}
            {isDirty && (
              <button
                type="button"
                onClick={handleRevert}
                title="Revert back to original file"
                className="inline-flex h-7.5 items-center gap-1 rounded-md border border-border bg-bg px-2 text-xs text-muted hover:text-fg hover:border-danger/50 transition-colors"
              >
                <RotateCcw className="size-3 text-danger" />
                <span className="hidden sm:inline">Reset</span>
              </button>
            )}

            {/* Download modified file */}
            <button
              type="button"
              onClick={handleDownload}
              title="Download modified G-code file"
              className="inline-flex h-7.5 items-center gap-1 rounded-md border border-border bg-bg px-2 text-xs text-muted hover:text-fg hover:border-primary/50 transition-colors"
            >
              <Download className="size-3" />
              <span className="hidden sm:inline">Export</span>
            </button>

            {/* Apply to 3D Button */}
            <button
              type="button"
              onClick={() => handleApplyChanges(true)}
              className={cn(
                "inline-flex h-7.5 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold shadow-xs transition-all active:scale-95",
                justApplied
                  ? "bg-ok text-ok-fg"
                  : hasUnappliedEdits
                    ? "bg-amber-500 text-black hover:bg-amber-400"
                    : "bg-primary text-primary-fg hover:brightness-110",
              )}
            >
              {justApplied ? (
                <>
                  <Check className="size-3.5" />
                  <span>Applied!</span>
                </>
              ) : (
                <>
                  <Code className="size-3.5" />
                  <span>Update 3D</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* Snippet Quick-Insert Bar (Visible in Edit Mode)              */}
      {/* ──────────────────────────────────────────────────────────── */}
      {mode === "edit" && (
        <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border bg-surface/30 px-3 py-1.5 text-xs scrollbar-none sm:px-4">
          <span className="text-[11px] font-medium text-muted uppercase tracking-wider shrink-0 flex items-center gap-1">
            <Plus className="size-3" /> Insert:
          </span>
          {COMMON_SNIPPETS.map((snippet) => (
            <button
              key={snippet.label}
              type="button"
              title={snippet.title}
              onClick={() => insertSnippet(snippet.code)}
              className="inline-flex shrink-0 items-center gap-1 rounded border border-border/80 bg-bg/90 px-2 py-0.5 font-mono text-[11px] text-muted hover:border-primary hover:text-primary transition-colors"
            >
              {snippet.label}
            </button>
          ))}
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────── */}
      {/* Editor Body: View Mode (Virtualized) or Edit Mode (Textarea) */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 relative flex flex-col">
        {mode === "view" ? (
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
                        "flex w-full items-start gap-2 px-2 text-left font-mono text-xs leading-5 transition-colors",
                        active ? "bg-raised text-fg" : "text-muted hover:bg-surface",
                        hit && "text-fg bg-primary/10",
                      )}
                    >
                      <span className="w-12 shrink-0 text-right text-muted select-none">{number}</span>
                      <span
                        className={cn(
                          "mt-1 size-1.5 rounded-full shrink-0",
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
        ) : (
          <div className="flex h-full min-h-0 flex-1 bg-bg">
            {/* Line Numbers Gutter */}
            <div
              ref={gutterRef}
              className="flex flex-col border-r border-border bg-surface/40 py-2 font-mono text-xs text-muted select-none overflow-hidden w-12 sm:w-14 text-right pr-2 shrink-0 leading-5"
            >
              {lines.map((_, idx) => {
                const lineNum = idx + 1;
                const mark = marks.get(lineNum);
                return (
                  <div key={lineNum} className="relative flex items-center justify-end gap-1 h-5">
                    {mark && (
                      <span
                        className={cn(
                          "size-1.5 rounded-full shrink-0",
                          mark === "error" && "bg-danger",
                          mark === "warning" && "bg-primary",
                          mark === "info" && "bg-rapid",
                        )}
                      />
                    )}
                    <span className={cn(lineNum === cursorPos.line ? "text-primary font-bold" : "text-muted")}>
                      {lineNum}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Editable Textarea */}
            <div className="relative min-w-0 flex-1 h-full">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => {
                  handleDraftChange(e.target.value);
                  updateCursorPosition(e.target.value, e.target.selectionStart);
                }}
                onKeyDown={handleTextareaKeyDown}
                onScroll={handleTextareaScroll}
                onClick={(e) => {
                  const target = e.currentTarget;
                  updateCursorPosition(target.value, target.selectionStart);
                }}
                onKeyUp={(e) => {
                  const target = e.currentTarget;
                  updateCursorPosition(target.value, target.selectionStart);
                }}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                placeholder="Enter or paste G-code here…"
                className="h-full w-full resize-none bg-transparent p-2 font-mono text-xs leading-5 text-fg outline-none whitespace-pre overflow-auto scrollbar-thin"
              />
            </div>
          </div>
        )}
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* Editor Status Bar Footer                                    */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-t border-border bg-surface/50 px-3 py-1 text-[11px] font-mono text-muted sm:px-4 shrink-0">
        <div className="flex items-center gap-3">
          <span>{lines.length} lines</span>
          <span>{draft.length.toLocaleString()} chars</span>
          {mode === "edit" && (
            <span className="text-primary">
              Ln {cursorPos.line}, Col {cursorPos.col}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {mode === "view" ? (
            <button
              type="button"
              onClick={() => setMode("edit")}
              className="text-primary hover:underline flex items-center gap-1 font-sans text-xs"
            >
              <Edit3 className="size-3" /> Edit G-code
            </button>
          ) : (
            <span className="text-muted">
              Press <kbd className="rounded border border-border bg-surface px-1 py-0.5 text-[10px]">Ctrl+S</kbd> to update 3D
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Highlighted({ line }: { line: string }) {
  if (!line) return <span> </span>;
  const parts: { text: string; kind: string }[] = [];
  const re = /(\([^)]*\)|;.*$)|([A-Za-z])([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
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
