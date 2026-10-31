import {
  Activity,
  AlertTriangle,
  Box,
  Check,
  ChevronDown,
  Code,
  Columns,
  Download,
  FolderOpen,
  Info,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Sliders,
  Square,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SourceViewer } from "@/components/editor/SourceViewer";
import { ToolpathViewer } from "@/components/viewer/ToolpathViewer";
import { PLANS, entitlements } from "@/lib/billing";
import { BUILT_IN_PROFILES } from "@/lib/machines";
import { downloadBlob, findingsCsv, pdfBytes, reportDocument } from "@/lib/reports";
import { SAMPLES } from "@/lib/samples";
import { currentProfile, playbackCursor, useInspector } from "@/lib/store";
import type { MachineConfig, MobileTab } from "@/lib/types";
import { ADVISORY, cn, formatBytes, formatDuration, formatMm } from "@/lib/utils";

const TABS: { id: MobileTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "view", label: "3D View", icon: Box },
  { id: "code", label: "G-Code", icon: Code },
  { id: "inspect", label: "Inspect", icon: Activity },
  { id: "setup", label: "Setup", icon: Sliders },
];

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];

export function InspectorApp() {
  const boot = useInspector((s) => s.boot);
  const fileName = useInspector((s) => s.fileName);
  const status = useInspector((s) => s.status);
  const progress = useInspector((s) => s.progressLabel);
  const error = useInspector((s) => s.error);
  const mobileTab = useInspector((s) => s.mobileTab);
  const setMobileTab = useInspector((s) => s.setMobileTab);
  const openFile = useInspector((s) => s.openFile);
  const openSample = useInspector((s) => s.openSample);
  const plansOpen = useInspector((s) => s.plansOpen);
  const limitsOpen = useInspector((s) => s.limitsOpen);
  const setPlansOpen = useInspector((s) => s.setPlansOpen);
  const setLimitsOpen = useInspector((s) => s.setLimitsOpen);
  const togglePlay = useInspector((s) => s.togglePlay);
  const step = useInspector((s) => s.step);
  const analysis = useInspector((s) => s.analysis);
  const profile = useInspector(currentProfile);
  const profiles = useInspector((s) => s.profiles);
  const setProfileId = useInspector((s) => s.setProfileId);
  const inputRef = useRef<HTMLInputElement>(null);

  // Responsive state enhancements
  const [advisoryOpen, setAdvisoryOpen] = useState(false);
  const [tabletView, setTabletView] = useState<"split" | "3d" | "code" | "inspect" | "setup">("split");
  const [tabletTab, setTabletTab] = useState<"inspect" | "setup" | "code">("inspect");

  const activeErrors = analysis?.stats.errorCount ?? 0;
  const activeWarnings = analysis?.stats.warningCount ?? 0;

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
      } else if (event.key === "ArrowRight") step(1);
      else if (event.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, togglePlay]);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      useInspector.getState().advance(dt);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden bg-bg text-fg select-none"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file) void openFile(file);
      }}
    >
      {/* ──────────────────────────────────────────────────────────── */}
      {/* Global Responsive Header (Desktop, Tablet, Mobile)         */}
      {/* ──────────────────────────────────────────────────────────── */}
      <header className="flex h-13 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface/90 px-3 py-2 backdrop-blur-md sm:px-4">
        {/* Brand & Active File / Sample Switcher */}
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="flex size-7 items-center justify-center rounded bg-primary/15 text-primary shrink-0">
              <Box className="size-4" />
            </span>
            <span className="font-semibold tracking-tight text-fg text-sm sm:text-base shrink-0">Northline</span>
          </div>

          <div className="hidden h-4 w-px bg-border sm:block shrink-0" />

          {/* Quick Sample Selector Dropdown */}
          <div className="relative flex items-center min-w-0">
            <select
              aria-label="Quick Load Sample Program"
              value={SAMPLES.find((s) => s.name === fileName)?.id ?? ""}
              onChange={(e) => {
                if (e.target.value) openSample(e.target.value);
              }}
              className="h-8 w-28 sm:w-40 md:w-48 truncate rounded border border-border bg-bg/80 pl-2 pr-6 font-mono text-xs text-fg outline-none transition-colors hover:border-primary/60 focus:border-primary"
            >
              <option value="" disabled>
                {fileName || "Load program…"}
              </option>
              {SAMPLES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-1.5 size-3.5 text-muted" />
          </div>

          {/* Machine Profile badge (Hidden on mobile & tablet) */}
          <div className="hidden items-center xl:flex shrink-0">
            <select
              aria-label="Select Machine Profile"
              value={profile.id}
              onChange={(e) => setProfileId(e.target.value)}
              className="h-8 max-w-[150px] truncate rounded border border-border/80 bg-surface px-2 text-xs text-muted outline-none hover:text-fg focus:border-primary"
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Center Key Metrics Readout or Loading Progress */}
        {status === "running" ? (
          <div className="hidden items-center gap-2 text-xs font-mono text-primary animate-pulse sm:flex shrink-0">
            <span className="size-2 rounded-full bg-primary shrink-0" />
            <span className="truncate max-w-[160px]">{progress || "Inspecting…"}</span>
          </div>
        ) : analysis ? (
          <div className="hidden items-center gap-2.5 text-xs md:flex shrink-0">
            <span className="text-muted">
              Est: <strong className="font-mono text-fg">{formatDuration(analysis.time.totalTimeS)}</strong>
            </span>
            <span className="text-border hidden xl:inline">·</span>
            <span className="text-muted hidden xl:inline">
              Lines: <strong className="font-mono text-fg">{analysis.lineCount}</strong>
            </span>
            <span className="text-border">·</span>
            <span className={cn("font-medium", activeErrors > 0 ? "text-danger" : "text-ok")}>
              {activeErrors > 0 ? `${activeErrors} errors` : "0 errors"}
            </span>
          </div>
        ) : null}

        {/* Right Actions: Limits, Plans, Advisory & Open File */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {/* Advisory banner toggle */}
          <button
            type="button"
            className={cn(
              "inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs transition-colors",
              advisoryOpen ? "bg-raised text-primary" : "text-muted hover:text-fg hover:bg-surface",
            )}
            onClick={() => setAdvisoryOpen(!advisoryOpen)}
            title="Toggle safety advisory information"
          >
            <Info className="size-3.5" />
            <span className="hidden sm:inline">Advisory</span>
          </button>

          <button
            type="button"
            className="hidden h-8 rounded-md px-2 text-xs text-muted transition-colors hover:bg-surface hover:text-fg md:inline-block"
            onClick={() => setLimitsOpen(true)}
          >
            Limits
          </button>
          <button
            type="button"
            className="hidden h-8 rounded-md px-2 text-xs text-muted transition-colors hover:bg-surface hover:text-fg md:inline-block"
            onClick={() => setPlansOpen(true)}
          >
            Plans
          </button>

          {/* Primary Open File Button */}
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 sm:px-3 text-xs font-semibold text-primary-fg shadow-sm transition-all hover:brightness-110 active:scale-95 sm:h-9 sm:text-sm shrink-0"
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="size-3.5 sm:size-4" />
            <span>Open</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".gcode,.nc,.tap,.cnc,.txt,text/plain"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void openFile(file);
              event.target.value = "";
            }}
          />
        </div>
      </header>

      {/* Dismissible Advisory Banner */}
      {advisoryOpen && (
        <div className="relative flex shrink-0 items-start justify-between gap-3 border-b border-border bg-raised/70 px-3 py-2 text-xs text-muted sm:px-4">
          <p className="leading-relaxed">{ADVISORY}</p>
          <button
            type="button"
            onClick={() => setAdvisoryOpen(false)}
            className="rounded p-1 text-muted hover:bg-surface hover:text-fg"
            aria-label="Dismiss advisory"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {error && (
        <div className="shrink-0 border-b border-border bg-danger/10 px-3 py-2 text-xs text-danger sm:px-4" role="alert">
          {error}
        </div>
      )}

      {status === "running" && <div className="h-0.5 shrink-0 animate-pulse bg-primary" />}

      {/* ──────────────────────────────────────────────────────────── */}
      {/* 1. DESKTOP VIEW (lg: 1024px+)                                */}
      {/* 3-Column Studio Grid: Setup | 3D Viewport & Code | Inspector */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="hidden min-h-0 flex-1 lg:grid lg:grid-cols-[18rem_minmax(0,1fr)_22rem] xl:grid-cols-[20rem_minmax(0,1fr)_24rem] lg:grid-rows-[minmax(0,1fr)_16rem]">
        {/* Left Column: Machine Profiles, Samples & Projects */}
        <aside className="min-h-0 overflow-auto border-r border-border bg-bg/50">
          <SetupPanel />
        </aside>

        {/* Center Column: 3D Toolpath Viewport */}
        <div className="relative min-h-0 min-w-0 bg-bg">
          <ToolpathViewer />
        </div>

        {/* Right Column: Deep Diagnostic Inspector */}
        <aside className="min-h-0 overflow-auto border-l border-border bg-bg/50">
          <InspectPanel />
        </aside>

        {/* Bottom Full-Width Row: Playback Scrubbing & Program Code / Log */}
        <section className="col-span-3 flex min-h-0 flex-col border-t border-border bg-surface/30">
          <PlaybackBar />
          <ProgramPane />
        </section>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* 2. TABLET WORKBENCH (md: 768px - 1023px)                     */}
      {/* Adaptable mode: Split View, 3D Fullscreen, Code, Diagnostics */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="hidden min-h-0 flex-1 md:flex lg:hidden flex-col">
        {/* Tablet Navigation & Mode Switcher Bar */}
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-surface/70 px-3 py-1.5 backdrop-blur-md">
          {/* Mode Selector Segmented Control */}
          <div className="flex items-center gap-1 rounded-lg border border-border bg-bg/90 p-0.5">
            <button
              type="button"
              onClick={() => setTabletView("split")}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-all active:scale-95",
                tabletView === "split"
                  ? "bg-primary text-primary-fg font-semibold shadow-xs"
                  : "text-muted hover:text-fg hover:bg-surface",
              )}
            >
              <Columns className="size-3.5" />
              <span>Split</span>
            </button>
            <button
              type="button"
              onClick={() => setTabletView("3d")}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-all active:scale-95",
                tabletView === "3d"
                  ? "bg-primary text-primary-fg font-semibold shadow-xs"
                  : "text-muted hover:text-fg hover:bg-surface",
              )}
            >
              <Box className="size-3.5" />
              <span>3D View</span>
            </button>
            <button
              type="button"
              onClick={() => setTabletView("code")}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-all active:scale-95",
                tabletView === "code"
                  ? "bg-primary text-primary-fg font-semibold shadow-xs"
                  : "text-muted hover:text-fg hover:bg-surface",
              )}
            >
              <Code className="size-3.5" />
              <span>G-Code</span>
            </button>
            <button
              type="button"
              onClick={() => setTabletView("inspect")}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-all active:scale-95",
                tabletView === "inspect"
                  ? "bg-primary text-primary-fg font-semibold shadow-xs"
                  : "text-muted hover:text-fg hover:bg-surface",
              )}
            >
              <Activity className="size-3.5" />
              <span>
                Inspect{" "}
                {activeErrors > 0 && (
                  <span className={tabletView === "inspect" ? "text-primary-fg font-bold" : "text-danger"}>
                    ({activeErrors})
                  </span>
                )}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setTabletView("setup")}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-all active:scale-95",
                tabletView === "setup"
                  ? "bg-primary text-primary-fg font-semibold shadow-xs"
                  : "text-muted hover:text-fg hover:bg-surface",
              )}
            >
              <Sliders className="size-3.5" />
              <span>Setup</span>
            </button>
          </div>

          {/* Quick Tablet Stat Pill */}
          {analysis && (
            <div className="flex items-center gap-2 rounded-md bg-raised/80 px-2.5 py-1 text-xs">
              <span className="text-muted">
                Est: <strong className="font-mono text-fg">{formatDuration(analysis.time.totalTimeS)}</strong>
              </span>
              <span className="text-border">·</span>
              <span className={cn("font-medium", activeErrors > 0 ? "text-danger" : "text-ok")}>
                {activeErrors > 0 ? `${activeErrors} errors` : "0 errors"}
              </span>
            </div>
          )}
        </div>

        {/* Tablet Content Viewports */}
        <div className="min-h-0 flex-1 relative flex">
          {/* 1. Split View Mode */}
          {tabletView === "split" && (
            <div className="flex min-h-0 flex-1">
              {/* Left Column: 3D Viewport with Compact Playback Bar */}
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1">
                  <ToolpathViewer />
                </div>
                <PlaybackBar compact />
              </div>

              {/* Right Column: Tabbed Inspector / G-Code / Setup */}
              <aside className="flex w-[40%] min-w-[310px] max-w-[420px] shrink-0 flex-col border-l border-border bg-surface/20">
                <div className="flex shrink-0 border-b border-border bg-surface/60">
                  <button
                    type="button"
                    className={cn(
                      "flex-1 h-10 text-xs font-medium transition-colors",
                      tabletTab === "inspect"
                        ? "border-b-2 border-primary text-fg font-semibold bg-surface/80"
                        : "text-muted hover:text-fg",
                    )}
                    onClick={() => setTabletTab("inspect")}
                  >
                    Inspect {activeErrors > 0 && <span className="ml-1 text-danger">({activeErrors})</span>}
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "flex-1 h-10 text-xs font-medium transition-colors",
                      tabletTab === "code"
                        ? "border-b-2 border-primary text-fg font-semibold bg-surface/80"
                        : "text-muted hover:text-fg",
                    )}
                    onClick={() => setTabletTab("code")}
                  >
                    G-Code
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "flex-1 h-10 text-xs font-medium transition-colors",
                      tabletTab === "setup"
                        ? "border-b-2 border-primary text-fg font-semibold bg-surface/80"
                        : "text-muted hover:text-fg",
                    )}
                    onClick={() => setTabletTab("setup")}
                  >
                    Setup
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-auto">
                  {tabletTab === "inspect" && <InspectPanel />}
                  {tabletTab === "code" && (
                    <div className="h-full">
                      <SourceViewer />
                    </div>
                  )}
                  {tabletTab === "setup" && <SetupPanel />}
                </div>
              </aside>
            </div>
          )}

          {/* 2. Fullscreen 3D View Mode */}
          {tabletView === "3d" && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1">
                <ToolpathViewer />
              </div>
              <PlaybackBar />
            </div>
          )}

          {/* 3. Fullscreen G-Code Mode */}
          {tabletView === "code" && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1">
                <SourceViewer />
              </div>
              <PlaybackBar compact />
            </div>
          )}

          {/* 4. Fullscreen Inspect Diagnostics Mode */}
          {tabletView === "inspect" && (
            <div className="h-full flex-1 overflow-auto p-3">
              <div className="mx-auto max-w-4xl">
                <InspectPanel />
              </div>
            </div>
          )}

          {/* 5. Fullscreen Setup Mode */}
          {tabletView === "setup" && (
            <div className="h-full flex-1 overflow-auto p-3">
              <div className="mx-auto max-w-2xl">
                <SetupPanel />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* 3. MOBILE VIEW (< 768px)                                     */}
      {/* Single Focused Viewport + Bottom Thumb Navigation Bar         */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col md:hidden">
        {/* Active Tab Screen Area */}
        <div className="min-h-0 flex-1 overflow-hidden pb-16">
          {mobileTab === "view" && (
            <div className="flex h-full flex-col">
              <div className="min-h-0 flex-1">
                <ToolpathViewer />
              </div>
              <PlaybackBar compact />
            </div>
          )}
          {mobileTab === "code" && (
            <div className="flex h-full flex-col">
              <div className="min-h-0 flex-1">
                <SourceViewer />
              </div>
              <PlaybackBar compact />
            </div>
          )}
          {mobileTab === "inspect" && (
            <div className="h-full overflow-auto p-1">
              <InspectPanel />
            </div>
          )}
          {mobileTab === "setup" && (
            <div className="h-full overflow-auto p-1">
              <SetupPanel />
            </div>
          )}
        </div>

        {/* Thumb-Zone Fixed Bottom Navigation Bar (Pattern 1) */}
        <nav
          aria-label="Mobile Navigation"
          className="fixed bottom-0 left-0 right-0 z-40 flex h-16 items-center justify-around border-t border-border bg-surface/95 px-2 backdrop-blur-md pb-[env(safe-area-inset-bottom)]"
        >
          {TABS.map((tab) => {
            const IconComponent = tab.icon;
            const active = mobileTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                className={cn(
                  "relative flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 rounded-lg py-1 transition-all active:scale-95",
                  active ? "text-primary font-semibold" : "text-muted hover:text-fg",
                )}
                onClick={() => setMobileTab(tab.id)}
              >
                <div className="relative">
                  <IconComponent className="size-5" />
                  {tab.id === "inspect" && (activeErrors > 0 || activeWarnings > 0) && (
                    <span
                      className={cn(
                        "absolute -top-1 -right-1 size-2 rounded-full",
                        activeErrors > 0 ? "bg-danger" : "bg-primary",
                      )}
                    />
                  )}
                </div>
                <span className="text-[11px] tracking-tight">{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {plansOpen && <PlansDialog onClose={() => setPlansOpen(false)} />}
      {limitsOpen && <LimitsDialog onClose={() => setLimitsOpen(false)} />}
    </div>
  );
}

function ProgramPane() {
  const tab = useInspector((s) => s.bottomTab);
  const setTab = useInspector((s) => s.setBottomTab);
  const log = useInspector((s) => s.log);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 gap-2 border-b border-border px-3">
        <button
          type="button"
          className={cn("h-9 text-xs", tab === "program" ? "text-primary" : "text-muted")}
          onClick={() => setTab("program")}
        >
          Program
        </button>
        <button
          type="button"
          className={cn("h-9 text-xs", tab === "log" ? "text-primary" : "text-muted")}
          onClick={() => setTab("log")}
        >
          Log
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {tab === "program" ? (
          <SourceViewer />
        ) : (
          <ul className="h-full overflow-auto px-3 py-2 font-mono text-xs text-muted">
            {log.length === 0 && <li>No engine messages yet.</li>}
            {log.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PlaybackBar({ compact = false }: { compact?: boolean }) {
  const playing = useInspector((s) => s.playing);
  const togglePlay = useInspector((s) => s.togglePlay);
  const restart = useInspector((s) => s.restart);
  const step = useInspector((s) => s.step);
  const speed = useInspector((s) => s.speed);
  const setSpeed = useInspector((s) => s.setSpeed);
  const mode = useInspector((s) => s.playMode);
  const setPlayMode = useInspector((s) => s.setPlayMode);
  const scrub = useInspector((s) => s.scrub);
  const cursor = useInspector(playbackCursor);
  const seg = useInspector((s) => s.analysis?.segments[s.playIndex] ?? null);
  const analysis = useInspector((s) => s.analysis);
  const playIndex = useInspector((s) => s.playIndex);

  const totalTime = analysis?.time.totalTimeS ?? 0;
  const currentTime = totalTime * cursor;

  return (
    <div className="shrink-0 border-b border-border bg-surface/95 px-3 py-2 backdrop-blur-sm sm:px-4">
      {compact ? (
        /* ── Compact 2-Row Layout (For Mobile, Tablet Split, or narrow views) ── */
        <div className="flex flex-col gap-1.5">
          {/* Row 1: Scrubber with timestamps */}
          <div className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-left font-mono text-[11px] tabular-nums text-muted">
              {formatDuration(currentTime)}
            </span>
            <label className="sr-only" htmlFor="scrub-compact">
              Timeline
            </label>
            <input
              id="scrub-compact"
              className="h-8 min-w-0 flex-1 accent-primary touch-pan-x"
              type="range"
              min={0}
              max={1000}
              value={Math.round(cursor * 1000)}
              onChange={(event) => scrub(Number(event.target.value) / 1000)}
            />
            <span className="w-12 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted">
              {formatDuration(totalTime)}
            </span>
          </div>

          {/* Row 2: Controls + Speed + Mode */}
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1">
              <IconButton label="Restart" onClick={restart}>
                <Square className="size-3.5" />
              </IconButton>
              <IconButton label="Step back" onClick={() => step(-1)}>
                <SkipBack className="size-3.5" />
              </IconButton>
              <IconButton label={playing ? "Pause" : "Play"} onClick={togglePlay} highlight>
                {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
              </IconButton>
              <IconButton label="Step forward" onClick={() => step(1)}>
                <SkipForward className="size-3.5" />
              </IconButton>
            </div>

            <div className="flex items-center gap-1.5">
              <select
                aria-label="Playback speed"
                className="h-8 rounded-md border border-border bg-bg px-2 font-mono text-xs text-fg outline-none"
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
              >
                {SPEEDS.map((value) => (
                  <option key={value} value={value}>
                    {value}×
                  </option>
                ))}
              </select>

              <button
                type="button"
                className={cn(
                  "h-8 rounded-md border border-border px-2 text-xs font-medium transition-colors",
                  mode === "estimate" ? "bg-raised text-primary border-primary/50" : "text-muted hover:text-fg",
                )}
                onClick={() => setPlayMode(mode === "preview" ? "estimate" : "preview")}
              >
                {mode === "preview" ? "Preview" : "Estimate"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* ── Full Inline Layout (Desktop and Fullscreen views) ── */
        <div className="flex flex-col gap-1">
          {/* Mobile fallback when screen is < sm */}
          <div className="flex flex-col gap-2 sm:hidden">
            <div className="flex items-center gap-2">
              <span className="w-12 text-left font-mono text-[11px] tabular-nums text-muted">
                {formatDuration(currentTime)}
              </span>
              <label className="sr-only" htmlFor="scrub-mobile">
                Timeline
              </label>
              <input
                id="scrub-mobile"
                className="h-8 min-w-0 flex-1 accent-primary touch-pan-x"
                type="range"
                min={0}
                max={1000}
                value={Math.round(cursor * 1000)}
                onChange={(event) => scrub(Number(event.target.value) / 1000)}
              />
              <span className="w-12 text-right font-mono text-[11px] tabular-nums text-muted">
                {formatDuration(totalTime)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1">
                <IconButton label="Restart" onClick={restart}>
                  <Square className="size-4" />
                </IconButton>
                <IconButton label="Step back" onClick={() => step(-1)}>
                  <SkipBack className="size-4" />
                </IconButton>
                <IconButton label={playing ? "Pause" : "Play"} onClick={togglePlay} highlight>
                  {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
                </IconButton>
                <IconButton label="Step forward" onClick={() => step(1)}>
                  <SkipForward className="size-4" />
                </IconButton>
              </div>
              <div className="flex items-center gap-1.5">
                <select
                  aria-label="Playback speed"
                  className="h-9 rounded-md border border-border bg-bg px-2 font-mono text-xs text-fg outline-none"
                  value={speed}
                  onChange={(event) => setSpeed(Number(event.target.value))}
                >
                  {SPEEDS.map((value) => (
                    <option key={value} value={value}>
                      {value}×
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={cn(
                    "h-9 rounded-md border border-border px-2.5 text-xs font-medium transition-colors",
                    mode === "estimate" ? "bg-raised text-primary border-primary/50" : "text-muted hover:text-fg",
                  )}
                  onClick={() => setPlayMode(mode === "preview" ? "estimate" : "preview")}
                >
                  {mode === "preview" ? "Preview" : "Estimate"}
                </button>
              </div>
            </div>
          </div>

          {/* Inline layout for sm+ */}
          <div className="hidden sm:flex sm:items-center sm:gap-3">
            <div className="flex shrink-0 items-center gap-1">
              <IconButton label="Restart" onClick={restart}>
                <Square className="size-3.5" />
              </IconButton>
              <IconButton label="Step back" onClick={() => step(-1)}>
                <SkipBack className="size-3.5" />
              </IconButton>
              <IconButton label={playing ? "Pause" : "Play"} onClick={togglePlay} highlight>
                {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
              </IconButton>
              <IconButton label="Step forward" onClick={() => step(1)}>
                <SkipForward className="size-3.5" />
              </IconButton>
            </div>

            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                {formatDuration(currentTime)}
              </span>
              <label className="sr-only" htmlFor="scrub">
                Timeline
              </label>
              <input
                id="scrub"
                className="h-9 min-w-24 flex-1 accent-primary"
                type="range"
                min={0}
                max={1000}
                value={Math.round(cursor * 1000)}
                onChange={(event) => scrub(Number(event.target.value) / 1000)}
              />
              <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                {formatDuration(totalTime)}
              </span>
              <span className="hidden shrink-0 rounded bg-raised px-1.5 py-0.5 font-mono text-[11px] text-muted md:inline-block">
                {Math.round(cursor * 100)}%
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <select
                aria-label="Playback speed"
                className="h-8 rounded-md border border-border bg-bg px-2 font-mono text-xs text-fg outline-none hover:border-primary/60 focus:border-primary"
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
              >
                {SPEEDS.map((value) => (
                  <option key={value} value={value}>
                    {value}×
                  </option>
                ))}
              </select>

              <div className="flex rounded-md border border-border p-0.5 bg-bg/60">
                <button
                  type="button"
                  className={cn(
                    "h-7 rounded px-2 text-xs font-medium transition-colors",
                    mode === "preview" ? "bg-raised text-fg shadow-xs" : "text-muted hover:text-fg",
                  )}
                  onClick={() => setPlayMode("preview")}
                >
                  Preview
                </button>
                <button
                  type="button"
                  className={cn(
                    "h-7 rounded px-2 text-xs font-medium transition-colors",
                    mode === "estimate" ? "bg-raised text-fg shadow-xs" : "text-muted hover:text-fg",
                  )}
                  onClick={() => setPlayMode("estimate")}
                >
                  Time scale
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Subline status info */}
      <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
        <span className="truncate">
          {seg
            ? `Block ${playIndex + 1} (Line ${seg.line}) · spindle ${seg.spindle}${seg.spindleSpeed ? ` @ ${seg.spindleSpeed} RPM` : ""}`
            : "No active motion"}
        </span>
        <span className="hidden shrink-0 font-mono sm:inline">
          {mode === "preview" ? "Geometric path preview" : "Physics estimate playback"}
        </span>
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  highlight = false,
  children,
}: {
  label: string;
  onClick: () => void;
  highlight?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-9 sm:size-8 items-center justify-center rounded-md border text-fg transition-all active:scale-95",
        highlight
          ? "border-primary bg-primary text-primary-fg shadow-sm hover:brightness-110"
          : "border-border bg-bg/80 hover:bg-surface hover:text-fg",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function SetupPanel() {
  const profile = useInspector(currentProfile);
  const profiles = useInspector((s) => s.profiles);
  const setProfileId = useInspector((s) => s.setProfileId);
  const patch = useInspector((s) => s.patchProfile);
  const duplicate = useInspector((s) => s.duplicateProfile);
  const remove = useInspector((s) => s.removeProfile);
  const resetBuiltins = useInspector((s) => s.resetBuiltins);
  const openSample = useInspector((s) => s.openSample);
  const projects = useInspector((s) => s.projects);
  const persist = useInspector((s) => s.persistProject);
  const openProject = useInspector((s) => s.openProject);
  const removeProject = useInspector((s) => s.removeProject);
  const fileName = useInspector((s) => s.fileName);
  const builtin = BUILT_IN_PROFILES.some((item) => item.id === profile.id);

  return (
    <div className="flex flex-col gap-5 p-3 sm:p-4">
      {/* Sample Programs Library */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Sample Programs</h2>
          <span className="text-[11px] text-muted">{SAMPLES.length} built-in</span>
        </div>
        <ul className="mt-2.5 flex flex-col gap-1.5">
          {SAMPLES.map((sample) => {
            const isActive = sample.name === fileName;
            return (
              <li key={sample.id}>
                <button
                  type="button"
                  className={cn(
                    "w-full rounded-lg border p-2.5 text-left transition-all active:scale-[0.99]",
                    isActive
                      ? "border-primary/80 bg-primary/10 shadow-xs"
                      : "border-border bg-surface/50 hover:bg-surface hover:border-border/80",
                  )}
                  onClick={() => openSample(sample.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("text-sm font-medium", isActive ? "text-primary" : "text-fg")}>
                      {sample.name}
                    </span>
                    {isActive && <Check className="size-4 shrink-0 text-primary" />}
                  </div>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted">{sample.blurb}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Saved Projects in Local IndexedDB */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Local Saved Projects</h2>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
            onClick={() => void persist()}
          >
            <FolderOpen className="size-3.5" />
            Save Current
          </button>
        </div>
        {projects.length === 0 ? (
          <p className="mt-2 text-xs leading-relaxed text-muted">No saved projects yet. Stored privately in IndexedDB.</p>
        ) : (
          <ul className="mt-2.5 flex flex-col gap-1.5">
            {projects.map((project) => (
              <li
                key={project.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface/50 p-2"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-sm font-medium text-fg hover:text-primary"
                  onClick={() => void openProject(project.id)}
                >
                  {project.name}
                </button>
                <button
                  type="button"
                  className="h-8 rounded px-2 text-xs text-danger/80 transition-colors hover:bg-danger/10 hover:text-danger"
                  onClick={() => void removeProject(project.id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Machine Profile Configuration */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Machine Profile & Limits</h2>
        <p className="mt-1 text-xs leading-5 text-muted">{profile.note}</p>
        <label className="mt-3 block text-xs text-muted">
          Active Profile
          <select
            className="mt-1.5 h-10 w-full rounded-lg border border-border bg-bg px-2.5 text-sm text-fg outline-none focus:border-primary"
            value={profile.id}
            onChange={(event) => setProfileId(event.target.value)}
          >
            {profiles.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.illustrative ? " (illustrative)" : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button
            type="button"
            className="h-8 rounded-md border border-border bg-surface/60 px-2.5 text-xs font-medium text-fg transition-colors hover:bg-raised"
            onClick={duplicate}
          >
            Duplicate
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-surface/60 px-2.5 text-xs font-medium text-fg transition-colors hover:bg-raised"
            onClick={resetBuiltins}
          >
            <RotateCcw className="size-3.5" />
            Reset Samples
          </button>
          {!builtin && (
            <button
              type="button"
              className="h-8 rounded-md border border-danger/30 bg-danger/10 px-2.5 text-xs font-medium text-danger transition-colors hover:bg-danger/20"
              onClick={() => remove(profile.id)}
            >
              Delete
            </button>
          )}
        </div>
        <div className="mt-3.5 grid grid-cols-2 gap-2">
          <Num label="X min (mm)" value={profile.xMin} onChange={(xMin) => patch({ xMin })} />
          <Num label="X max (mm)" value={profile.xMax} onChange={(xMax) => patch({ xMax })} />
          <Num label="Y min (mm)" value={profile.yMin} onChange={(yMin) => patch({ yMin })} />
          <Num label="Y max (mm)" value={profile.yMax} onChange={(yMax) => patch({ yMax })} />
          <Num label="Z min (mm)" value={profile.zMin} onChange={(zMin) => patch({ zMin })} />
          <Num label="Z max (mm)" value={profile.zMax} onChange={(zMax) => patch({ zMax })} />
          <Num label="Rapid (mm/min)" value={profile.rapidRate} onChange={(rapidRate) => patch({ rapidRate })} />
          <Num label="Max Feed" value={profile.maxFeed} onChange={(maxFeed) => patch({ maxFeed })} />
          <Num label="Clearance Z" value={profile.clearanceZ} onChange={(clearanceZ) => patch({ clearanceZ })} />
          <Num
            label="Accel (mm/s²)"
            value={profile.acceleration ?? Number.NaN}
            allowEmpty
            onChange={(acceleration) => patch({ acceleration: Number.isFinite(acceleration) ? acceleration : null })}
          />
        </div>
        <label className="mt-3 block text-xs text-muted">
          Controller Preset
          <select
            className="mt-1 h-10 w-full rounded-lg border border-border bg-bg px-2.5 text-sm text-fg outline-none focus:border-primary"
            value={profile.controllerPreset}
            onChange={(event) => patch({ controllerPreset: event.target.value as MachineConfig["controllerPreset"] })}
          >
            <option value="grbl">GRBL-style startup assumptions</option>
            <option value="generic">Generic (conservative defaults)</option>
          </select>
        </label>
        <label className="mt-3 block text-xs text-muted">
          Default Units (if unstated)
          <select
            className="mt-1 h-10 w-full rounded-lg border border-border bg-bg px-2.5 text-sm text-fg outline-none focus:border-primary"
            value={profile.defaultUnits}
            onChange={(event) => patch({ defaultUnits: event.target.value as MachineConfig["defaultUnits"] })}
          >
            <option value="mm">Millimeters (G21)</option>
            <option value="inch">Inches (G20)</option>
          </select>
        </label>
        <div className="mt-3.5 space-y-2 rounded-lg border border-border/80 bg-surface/40 p-2.5">
          <label className="flex items-center gap-2.5 text-xs text-fg cursor-pointer">
            <input
              type="checkbox"
              className="size-4 rounded accent-primary"
              checked={profile.requireSpindle}
              onChange={(event) => patch({ requireSpindle: event.target.checked })}
            />
            Flag cuts before M3/M4 spindle start
          </label>
          <label className="flex items-center gap-2.5 text-xs text-fg cursor-pointer">
            <input
              type="checkbox"
              className="size-4 rounded accent-primary"
              checked={profile.flagLowRapid}
              onChange={(event) => patch({ flagLowRapid: event.target.checked })}
            />
            Flag rapid moves below clearance plane
          </label>
        </div>
      </section>
    </div>
  );
}

function Num({
  label,
  value,
  onChange,
  allowEmpty = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  allowEmpty?: boolean;
}) {
  return (
    <label className="text-[11px] text-muted">
      {label}
      <input
        className="mt-1 h-8.5 w-full rounded-md border border-border bg-bg px-2 font-mono text-xs text-fg outline-none transition-colors focus:border-primary"
        inputMode="decimal"
        defaultValue={Number.isFinite(value) ? String(value) : ""}
        key={Number.isFinite(value) ? String(value) : "empty"}
        placeholder={allowEmpty ? "off" : ""}
        onBlur={(event) => {
          if (allowEmpty && event.target.value.trim() === "") {
            onChange(Number.NaN);
            return;
          }
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </label>
  );
}

function InspectPanel() {
  const analysis = useInspector((s) => s.analysis);
  const fileName = useInspector((s) => s.fileName);
  const fileSize = useInspector((s) => s.fileSize);
  const profile = useInspector(currentProfile);
  const severity = useInspector((s) => s.severity);
  const setSeverity = useInspector((s) => s.setSeverity);
  const selectSegment = useInspector((s) => s.selectSegment);
  const selectLine = useInspector((s) => s.selectLine);
  const selected = useInspector((s) => s.analysis?.segments.find((seg) => seg.id === s.selectedSegmentId) ?? null);
  const source = useInspector((s) => s.source);

  const errorCount = analysis?.stats.errorCount ?? 0;
  const warningCount = analysis?.stats.warningCount ?? 0;
  const infoCount = (analysis?.findings ?? []).filter((f) => f.severity === "info").length;

  const findings = (analysis?.findings ?? []).filter((finding) => severity === "all" || finding.severity === severity);
  const selectedSource = selected ? source.split(/\r?\n/)[selected.line - 1] : null;

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4">
      {/* 6 Key Stat KPI Cards */}
      <section className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-2 xl:grid-cols-3 gap-2">
        <Stat label="File Size" value={formatBytes(fileSize)} />
        <Stat label="Total Lines" value={analysis ? String(analysis.lineCount) : "—"} />
        <Stat label="Segments" value={analysis ? String(analysis.segmentCount) : "—"} />
        <Stat label="Path Length" value={analysis ? `${formatMm(analysis.stats.totalDistanceMm)} mm` : "—"} />
        <Stat label="Estimate" value={analysis ? formatDuration(analysis.time.totalTimeS) : "—"} />
        <Stat
          label="Issues"
          value={analysis ? `${errorCount}E · ${warningCount}W` : "—"}
          tone={errorCount > 0 ? "danger" : warningCount > 0 ? "warn" : "ok"}
        />
      </section>

      {/* Rapid vs Cutting Stats */}
      {analysis && (
        <div className="rounded-lg border border-border/80 bg-surface/50 p-2.5 text-xs text-muted leading-relaxed">
          <p>
            Rapid: <span className="font-mono text-fg">{formatMm(analysis.stats.rapidDistanceMm)} mm</span> ({formatDuration(analysis.time.rapidTimeS)}) · Cut: <span className="font-mono text-fg">{formatMm(analysis.stats.cutDistanceMm)} mm</span> ({formatDuration(analysis.time.cutTimeS)})
          </p>
          <p className="mt-1 font-mono text-[11px] text-muted/80">
            Bounds: {formatMm(analysis.bbox.size[0])} × {formatMm(analysis.bbox.size[1])} × {formatMm(analysis.bbox.size[2])} mm
          </p>
        </div>
      )}

      {/* Export Actions Grid */}
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Export Inspection</h2>
        <div className="grid grid-cols-3 gap-2">
          <ExportButton kind="json" />
          <ExportButton kind="csv" />
          <ExportButton kind="pdf" />
        </div>
      </section>

      {/* Selected Block Details */}
      {selected && (
        <section className="rounded-lg border border-primary/40 bg-surface p-3 shadow-xs">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-primary">Selected Line {selected.line}</span>
            <span className="font-mono text-muted">{selected.kind}</span>
          </div>
          <p className="mt-1.5 rounded bg-bg px-2 py-1 font-mono text-xs text-fg overflow-x-auto">{selectedSource || "—"}</p>
          <p className="mt-2 text-xs text-muted">
            Length: <span className="font-mono text-fg">{formatMm(selected.lengthMm)} mm</span>
            {selected.timeS != null ? ` · Est: ${formatDuration(selected.timeS)}` : ""}
          </p>
        </section>
      )}

      {/* Findings Section with Segmented Severity Filter */}
      <section>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Findings & Diagnostics</h2>
        </div>

        {/* Segmented Filter Buttons */}
        <div className="mt-2 flex rounded-lg border border-border bg-bg/80 p-0.5">
          <button
            type="button"
            className={cn(
              "flex-1 h-7 rounded text-xs font-medium transition-colors",
              severity === "all" ? "bg-raised text-fg shadow-xs" : "text-muted hover:text-fg",
            )}
            onClick={() => setSeverity("all")}
          >
            All ({analysis?.findings.length ?? 0})
          </button>
          <button
            type="button"
            className={cn(
              "flex-1 h-7 rounded text-xs font-medium transition-colors",
              severity === "error" ? "bg-danger/20 text-danger font-semibold shadow-xs" : "text-muted hover:text-danger",
            )}
            onClick={() => setSeverity("error")}
          >
            Errors ({errorCount})
          </button>
          <button
            type="button"
            className={cn(
              "flex-1 h-7 rounded text-xs font-medium transition-colors",
              severity === "warning" ? "bg-primary/20 text-primary font-semibold shadow-xs" : "text-muted hover:text-primary",
            )}
            onClick={() => setSeverity("warning")}
          >
            Warn ({warningCount})
          </button>
          <button
            type="button"
            className={cn(
              "flex-1 h-7 rounded text-xs font-medium transition-colors",
              severity === "info" ? "bg-rapid/20 text-rapid font-semibold shadow-xs" : "text-muted hover:text-rapid",
            )}
            onClick={() => setSeverity("info")}
          >
            Info ({infoCount})
          </button>
        </div>

        {/* Findings List */}
        <ul className="mt-2.5 flex flex-col gap-2">
          {findings.length === 0 ? (
            <li className="rounded-lg border border-border/60 bg-surface/30 p-4 text-center text-xs text-muted">
              No findings under this filter.
            </li>
          ) : (
            findings.map((finding) => (
              <li key={finding.id}>
                <button
                  type="button"
                  className={cn(
                    "w-full rounded-lg border p-2.5 text-left transition-all active:scale-[0.99]",
                    finding.severity === "error"
                      ? "border-danger/40 bg-danger/5 hover:border-danger"
                      : finding.severity === "warning"
                        ? "border-primary/40 bg-primary/5 hover:border-primary"
                        : "border-border bg-surface hover:border-border/80",
                  )}
                  onClick={() => {
                    if (finding.segmentId != null) selectSegment(finding.segmentId);
                    else if (finding.line != null) selectLine(finding.line);
                  }}
                >
                  <div className="flex items-center gap-2 text-xs">
                    {finding.severity === "error" ? (
                      <AlertTriangle className="size-4 shrink-0 text-danger" />
                    ) : finding.severity === "warning" ? (
                      <AlertTriangle className="size-4 shrink-0 text-primary" />
                    ) : (
                      <Info className="size-4 shrink-0 text-rapid" />
                    )}
                    <span className="font-semibold uppercase text-xs tracking-wider">
                      {finding.severity}
                    </span>
                    <span className="text-muted">· {finding.line ? `Line ${finding.line}` : "Global"}</span>
                    <span className="ml-auto font-mono text-[11px] text-muted">{finding.code}</span>
                  </div>
                  <p className="mt-1.5 text-sm font-medium text-fg">{finding.message}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{finding.explanation}</p>
                  {finding.suggestion && (
                    <p className="mt-1.5 rounded bg-surface/80 p-1.5 text-xs text-primary/90 font-mono">
                      ↳ {finding.suggestion}
                    </p>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      </section>

      {/* G-Code Command Distribution */}
      {analysis && (
        <section className="rounded-lg border border-border/80 bg-surface/40 p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Command Distribution</h2>
          <ul className="mt-2.5 grid grid-cols-2 sm:grid-cols-3 gap-1.5 font-mono text-xs">
            {analysis.commands.map((command) => (
              <li
                key={command.code}
                className={cn(
                  "flex items-center justify-between rounded px-2 py-1",
                  command.supported ? "bg-bg text-fg" : "bg-danger/10 text-danger",
                )}
              >
                <span>{command.code}</span>
                <span className="text-muted">×{command.count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {fileName && (
        <div className="mt-auto border-t border-border/60 pt-3 text-[11px] text-muted flex items-center justify-between">
          <span className="truncate">File: <strong className="font-mono text-fg">{fileName}</strong></span>
          <span className="shrink-0 text-muted/80">{profile.name}</span>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "danger" | "ok" | "warn" }) {
  return (
    <div className="rounded-lg border border-border bg-surface/80 px-2.5 py-2 transition-colors hover:border-border/80">
      <p className="text-[11px] text-muted">{label}</p>
      <p
        className={cn(
          "mt-0.5 truncate font-mono text-sm font-semibold tabular-nums",
          tone === "danger" && "text-danger",
          tone === "warn" && "text-primary",
          tone === "ok" && "text-ok",
          !tone && "text-fg",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function ExportButton({ kind }: { kind: "json" | "csv" | "pdf" }) {
  const analysis = useInspector((s) => s.analysis);
  const profile = useInspector(currentProfile);
  const fileName = useInspector((s) => s.fileName);
  const fileSize = useInspector((s) => s.fileSize);
  const disabled = !analysis;
  return (
    <button
      type="button"
      disabled={disabled}
      className="inline-flex h-8.5 w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-2 text-xs font-medium text-fg shadow-xs transition-colors hover:bg-raised hover:border-border/80 active:scale-95 disabled:opacity-40"
      onClick={() => {
        if (!analysis) return;
        const base = fileName.replace(/\.[^.]+$/, "") || "inspection";
        if (kind === "json") {
          const doc = reportDocument(analysis, profile, {
            fileName,
            fileSize,
            generatedAt: new Date().toISOString(),
          });
          downloadBlob(`${base}-inspection.json`, JSON.stringify(doc, null, 2), "application/json");
        } else if (kind === "csv") {
          downloadBlob(`${base}-findings.csv`, findingsCsv(analysis), "text/csv");
        } else {
          const lines = [`Generated ${new Date().toISOString()}`, `File ${fileName} (${formatBytes(fileSize)})`, ...analysis.reportLines];
          downloadBlob(`${base}-inspection.pdf`, pdfBytes(lines) as unknown as BlobPart, "application/pdf");
        }
      }}
    >
      <Download className="size-3.5" />
      {kind.toUpperCase()}
    </button>
  );
}

function PlansDialog({ onClose }: { onClose: () => void }) {
  const access = entitlements();
  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-bg/80 p-3 sm:items-center" role="presentation" onClick={onClose}>
      <div className="max-h-[85dvh] w-full max-w-3xl overflow-auto rounded-md border border-border bg-surface p-4" role="dialog" aria-modal="true" aria-labelledby="plans-title" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="plans-title" className="text-base font-semibold">Plans</h2>
            <p className="mt-1 text-sm text-muted">
              Billing is not connected. Nothing is sold, and no subscription is active. Team features need accounts, which this build does not have.
            </p>
          </div>
          <button type="button" className="h-9 px-2 text-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {PLANS.map((plan) => (
            <section key={plan.id} className="rounded-md border border-border p-3">
              <h3 className="text-sm font-medium">{plan.name}</h3>
              <p className="mt-1 text-xs text-muted">{plan.summary}</p>
              <ul className="mt-3 flex flex-col gap-1 text-sm">
                {plan.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="mt-4 text-xs leading-5 text-muted">
          Local inspection, preview, diagnostics, reports, custom profiles, and saved projects run in this browser
          {access.billingConfigured ? "" : " because a client-side lock would not be a real payment check"}. Collaboration and team admin stay off.
        </p>
      </div>
    </div>
  );
}

function LimitsDialog({ onClose }: { onClose: () => void }) {
  const dialect = useInspector((s) => s.analysis?.dialect ?? null);
  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-bg/80 p-3 sm:items-center" role="presentation" onClick={onClose}>
      <div className="max-h-[85dvh] w-full max-w-2xl overflow-auto rounded-md border border-border bg-surface p-4" role="dialog" aria-modal="true" aria-labelledby="limits-title" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 id="limits-title" className="text-base font-semibold">Dialect and limits</h2>
          <button type="button" className="h-9 px-2 text-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="mt-2 text-sm leading-6 text-muted">
          {dialect?.summary ??
            "Northline interprets a documented 3-axis mill subset. Unsupported codes are flagged and not applied. This is not a control replay."}
        </p>
        <h3 className="mt-4 text-xs font-medium tracking-wide text-muted">Interpreted</h3>
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {(dialect?.supported ?? ["Load a program to list the active dialect."]).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <h3 className="mt-4 text-xs font-medium tracking-wide text-muted">Not simulated</h3>
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {(dialect?.notSimulated ?? []).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="mt-4 text-xs leading-5 text-muted">
          Files over 8 MB are refused. Programs longer than 200,000 lines are truncated and marked. There is no connection to a CNC controller and no automatic upload.
        </p>
      </div>
    </div>
  );
}
