import {
  AlertTriangle,
  Download,
  FolderOpen,
  Info,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Square,
  Upload,
} from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { SourceViewer } from "@/components/editor/SourceViewer";
import { ToolpathViewer } from "@/components/viewer/ToolpathViewer";
import { PLANS, entitlements } from "@/lib/billing";
import { BUILT_IN_PROFILES } from "@/lib/machines";
import { downloadBlob, findingsCsv, pdfBytes, reportDocument } from "@/lib/reports";
import { SAMPLES } from "@/lib/samples";
import { currentProfile, playbackCursor, useInspector } from "@/lib/store";
import type { MachineConfig, MobileTab } from "@/lib/types";
import { ADVISORY, cn, formatBytes, formatDuration, formatMm } from "@/lib/utils";

const TABS: { id: MobileTab; label: string }[] = [
  { id: "view", label: "View" },
  { id: "code", label: "Code" },
  { id: "inspect", label: "Inspect" },
  { id: "setup", label: "Setup" },
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
  const plansOpen = useInspector((s) => s.plansOpen);
  const limitsOpen = useInspector((s) => s.limitsOpen);
  const setPlansOpen = useInspector((s) => s.setPlansOpen);
  const setLimitsOpen = useInspector((s) => s.setLimitsOpen);
  const togglePlay = useInspector((s) => s.togglePlay);
  const step = useInspector((s) => s.step);
  const inputRef = useRef<HTMLInputElement>(null);

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
      className="flex h-dvh flex-col overflow-hidden bg-bg text-fg"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file) void openFile(file);
      }}
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-wide">Northline</p>
          <p className="truncate font-mono text-xs text-muted">{fileName}</p>
        </div>
        <p className="hidden min-w-0 flex-1 truncate text-xs text-muted md:block">{progress}</p>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" className="h-9 rounded-md px-2 text-xs text-muted" onClick={() => setLimitsOpen(true)}>
            Limits
          </button>
          <button type="button" className="h-9 rounded-md px-2 text-xs text-muted" onClick={() => setPlansOpen(true)}>
            Plans
          </button>
          <button
            type="button"
            className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-fg"
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="size-4" />
            Open
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
      <p className="shrink-0 border-b border-border bg-surface px-3 py-2 text-xs leading-5 text-muted">{ADVISORY}</p>
      {error && (
        <p className="shrink-0 border-b border-border bg-raised px-3 py-2 text-xs text-danger" role="alert">
          {error}
        </p>
      )}
      {status === "running" && <div className="h-0.5 shrink-0 animate-pulse bg-primary" />}

      <div className="hidden min-h-0 flex-1 lg:grid lg:grid-cols-[17rem_minmax(0,1fr)_20rem] lg:grid-rows-[minmax(0,1fr)_16rem]">
        <aside className="overflow-auto border-r border-border">
          <SetupPanel />
        </aside>
        <div className="min-h-0 min-w-0">
          <ToolpathViewer />
        </div>
        <aside className="overflow-auto border-l border-border">
          <InspectPanel />
        </aside>
        <section className="col-span-3 flex min-h-0 flex-col border-t border-border">
          <PlaybackBar />
          <ProgramPane />
        </section>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        <div className="flex shrink-0 border-b border-border">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={cn(
                "h-11 flex-1 text-sm",
                mobileTab === tab.id ? "border-b-2 border-primary text-fg" : "text-muted",
              )}
              onClick={() => setMobileTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {mobileTab === "view" && (
            <div className="flex h-full flex-col">
              <div className="min-h-0 flex-1">
                <ToolpathViewer />
              </div>
              <PlaybackBar />
            </div>
          )}
          {mobileTab === "code" && (
            <div className="flex h-full flex-col">
              <div className="min-h-0 flex-1">
                <SourceViewer />
              </div>
              <PlaybackBar />
            </div>
          )}
          {mobileTab === "inspect" && (
            <div className="h-full overflow-auto">
              <InspectPanel />
            </div>
          )}
          {mobileTab === "setup" && (
            <div className="h-full overflow-auto">
              <SetupPanel />
            </div>
          )}
        </div>
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

function PlaybackBar() {
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

  return (
    <div className="shrink-0 border-b border-border bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <IconButton label="Restart" onClick={restart}>
          <Square className="size-4" />
        </IconButton>
        <IconButton label="Step back" onClick={() => step(-1)}>
          <SkipBack className="size-4" />
        </IconButton>
        <IconButton label={playing ? "Pause" : "Play"} onClick={togglePlay}>
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </IconButton>
        <IconButton label="Step forward" onClick={() => step(1)}>
          <SkipForward className="size-4" />
        </IconButton>
        <label className="sr-only" htmlFor="scrub">
          Timeline
        </label>
        <input
          id="scrub"
          className="h-11 min-w-32 flex-1 accent-primary"
          type="range"
          min={0}
          max={1000}
          value={Math.round(cursor * 1000)}
          onChange={(event) => scrub(Number(event.target.value) / 1000)}
        />
        <select
          aria-label="Playback speed"
          className="h-9 rounded-md border border-border bg-bg px-2 text-xs text-fg"
          value={speed}
          onChange={(event) => setSpeed(Number(event.target.value))}
        >
          {SPEEDS.map((value) => (
            <option key={value} value={value}>
              {value}×
            </option>
          ))}
        </select>
        <div className="flex rounded-md border border-border">
          <button
            type="button"
            className={cn("h-9 px-2 text-xs", mode === "preview" ? "bg-raised text-fg" : "text-muted")}
            onClick={() => setPlayMode("preview")}
          >
            Preview
          </button>
          <button
            type="button"
            className={cn("h-9 px-2 text-xs", mode === "estimate" ? "bg-raised text-fg" : "text-muted")}
            onClick={() => setPlayMode("estimate")}
          >
            Time scale
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted">
        {mode === "preview"
          ? "Preview speed follows the path. It is not machining time."
          : "Time scale uses the estimate. 1× is one estimated second per wall-clock second, still not a machine replay."}{" "}
        {seg ? `Line ${seg.line}, spindle ${seg.spindle}${seg.spindleSpeed ? ` @ ${seg.spindleSpeed}` : ""}.` : ""}
      </p>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="inline-flex size-11 items-center justify-center rounded-md border border-border bg-bg text-fg"
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
  const builtin = BUILT_IN_PROFILES.some((item) => item.id === profile.id);

  return (
    <div className="flex flex-col gap-5 p-3">
      <section>
        <h2 className="text-xs font-medium tracking-wide text-muted">Programs</h2>
        <ul className="mt-2 flex flex-col gap-1">
          {SAMPLES.map((sample) => (
            <li key={sample.id}>
              <button type="button" className="w-full rounded-md px-2 py-2 text-left hover:bg-raised" onClick={() => openSample(sample.id)}>
                <span className="block text-sm">{sample.name}</span>
                <span className="block text-xs text-muted">{sample.blurb}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium tracking-wide text-muted">Saved on this device</h2>
          <button type="button" className="inline-flex h-9 items-center gap-1 text-xs text-primary" onClick={() => void persist()}>
            <FolderOpen className="size-3.5" />
            Save
          </button>
        </div>
        {projects.length === 0 && <p className="mt-2 text-xs text-muted">Nothing saved yet. Files stay in IndexedDB.</p>}
        <ul className="mt-2 flex flex-col gap-1">
          {projects.map((project) => (
            <li key={project.id} className="flex items-center gap-2">
              <button type="button" className="min-w-0 flex-1 truncate rounded-md px-2 py-2 text-left text-sm hover:bg-raised" onClick={() => void openProject(project.id)}>
                {project.name}
              </button>
              <button type="button" className="h-9 px-2 text-xs text-muted" onClick={() => void removeProject(project.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="text-xs font-medium tracking-wide text-muted">Machine profile</h2>
        <p className="mt-1 text-xs leading-5 text-muted">{profile.note}</p>
        <label className="mt-2 block text-xs text-muted">
          Profile
          <select
            className="mt-1 h-11 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg"
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
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="h-9 rounded-md border border-border px-2 text-xs" onClick={duplicate}>
            Duplicate
          </button>
          <button type="button" className="inline-flex h-9 items-center gap-1 rounded-md border border-border px-2 text-xs" onClick={resetBuiltins}>
            <RotateCcw className="size-3.5" />
            Reset samples
          </button>
          {!builtin && (
            <button type="button" className="h-9 px-2 text-xs text-danger" onClick={() => remove(profile.id)}>
              Delete
            </button>
          )}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Num label="X min mm" value={profile.xMin} onChange={(xMin) => patch({ xMin })} />
          <Num label="X max mm" value={profile.xMax} onChange={(xMax) => patch({ xMax })} />
          <Num label="Y min mm" value={profile.yMin} onChange={(yMin) => patch({ yMin })} />
          <Num label="Y max mm" value={profile.yMax} onChange={(yMax) => patch({ yMax })} />
          <Num label="Z min mm" value={profile.zMin} onChange={(zMin) => patch({ zMin })} />
          <Num label="Z max mm" value={profile.zMax} onChange={(zMax) => patch({ zMax })} />
          <Num label="Rapid mm/min" value={profile.rapidRate} onChange={(rapidRate) => patch({ rapidRate })} />
          <Num label="Max feed" value={profile.maxFeed} onChange={(maxFeed) => patch({ maxFeed })} />
          <Num label="Clearance Z" value={profile.clearanceZ} onChange={(clearanceZ) => patch({ clearanceZ })} />
          <Num
            label="Accel mm/s²"
            value={profile.acceleration ?? Number.NaN}
            allowEmpty
            onChange={(acceleration) => patch({ acceleration: Number.isFinite(acceleration) ? acceleration : null })}
          />
        </div>
        <label className="mt-2 block text-xs text-muted">
          Preset
          <select
            className="mt-1 h-11 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg"
            value={profile.controllerPreset}
            onChange={(event) => patch({ controllerPreset: event.target.value as MachineConfig["controllerPreset"] })}
          >
            <option value="grbl">GRBL-style startup assumption</option>
            <option value="generic">Generic, same defaults, not controller-verified</option>
          </select>
        </label>
        <label className="mt-2 block text-xs text-muted">
          If the file never sets units
          <select
            className="mt-1 h-11 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg"
            value={profile.defaultUnits}
            onChange={(event) => patch({ defaultUnits: event.target.value as MachineConfig["defaultUnits"] })}
          >
            <option value="mm">Millimeters</option>
            <option value="inch">Inches</option>
          </select>
        </label>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={profile.requireSpindle} onChange={(event) => patch({ requireSpindle: event.target.checked })} />
          Flag cuts before M3/M4
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={profile.flagLowRapid} onChange={(event) => patch({ flagLowRapid: event.target.checked })} />
          Flag rapids below clearance
        </label>
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
    <label className="text-xs text-muted">
      {label}
      <input
        className="mt-1 h-9 w-full rounded-md border border-border bg-bg px-2 font-mono text-sm text-fg outline-none focus:border-primary"
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

  const findings = (analysis?.findings ?? []).filter((finding) => severity === "all" || finding.severity === severity);
  const selectedSource = selected ? source.split(/\r?\n/)[selected.line - 1] : null;

  return (
    <div className="flex flex-col gap-4 p-3">
      <section className="grid grid-cols-2 gap-2">
        <Stat label="File" value={formatBytes(fileSize)} />
        <Stat label="Lines" value={analysis ? String(analysis.lineCount) : "—"} />
        <Stat label="Segments" value={analysis ? String(analysis.segmentCount) : "—"} />
        <Stat label="Path" value={analysis ? `${formatMm(analysis.stats.totalDistanceMm)} mm` : "—"} />
        <Stat label="Estimate" value={analysis ? formatDuration(analysis.time.totalTimeS) : "—"} />
        <Stat label="Errors" value={analysis ? String(analysis.stats.errorCount) : "—"} tone={analysis && analysis.stats.errorCount > 0 ? "danger" : "ok"} />
      </section>
      {analysis && (
        <p className="text-xs leading-5 text-muted">
          Rapid {formatMm(analysis.stats.rapidDistanceMm)} mm / {formatDuration(analysis.time.rapidTimeS)}. Cutting{" "}
          {formatMm(analysis.stats.cutDistanceMm)} mm / {formatDuration(analysis.time.cutTimeS)}.
          {analysis.time.trapezoidTotalS != null
            ? ` Stop-start model ${formatDuration(analysis.time.trapezoidTotalS)}.`
            : " No acceleration model."}{" "}
          {analysis.time.unestimatedSegments > 0
            ? `${analysis.time.unestimatedSegments} ${analysis.time.unestimatedSegments === 1 ? "block has" : "blocks have"} no time.`
            : "All timed blocks used a programmed feed or rapid rate."}
        </p>
      )}
      {analysis && (
        <p className="font-mono text-xs text-muted">
          Bounds {formatMm(analysis.bbox.size[0])} × {formatMm(analysis.bbox.size[1])} × {formatMm(analysis.bbox.size[2])} mm
          {analysis.positionUntrustedFrom ? ` · position uncertain from line ${analysis.positionUntrustedFrom}` : ""}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <ExportButton kind="json" />
        <ExportButton kind="csv" />
        <ExportButton kind="pdf" />
      </div>
      {selected && (
        <section className="rounded-md border border-border bg-surface p-3">
          <h2 className="text-xs font-medium text-muted">Selected block</h2>
          <p className="mt-1 font-mono text-xs text-fg">{selectedSource}</p>
          <p className="mt-2 text-xs text-muted">
            {selected.kind} · {formatMm(selected.lengthMm)} mm
            {selected.timeS != null ? ` · ${formatDuration(selected.timeS)} est.` : " · time not estimated"}
          </p>
        </section>
      )}
      <section>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-medium tracking-wide text-muted">Findings</h2>
          <select
            aria-label="Filter findings"
            className="h-9 rounded-md border border-border bg-bg px-2 text-xs"
            value={severity}
            onChange={(event) => setSeverity(event.target.value as "all" | "error" | "warning" | "info")}
          >
            <option value="all">All</option>
            <option value="error">Errors</option>
            <option value="warning">Warnings</option>
            <option value="info">Info</option>
          </select>
        </div>
        <ul className="mt-2 flex flex-col gap-2">
          {findings.length === 0 && <li className="text-xs text-muted">No findings in this filter.</li>}
          {findings.map((finding) => (
            <li key={finding.id}>
              <button
                type="button"
                className="w-full rounded-md border border-border bg-surface p-2 text-left hover:border-primary"
                onClick={() => {
                  if (finding.segmentId != null) selectSegment(finding.segmentId);
                  else if (finding.line != null) selectLine(finding.line);
                }}
              >
                <span className="flex items-center gap-2 text-xs">
                  {finding.severity === "error" ? (
                    <AlertTriangle className="size-3.5 text-danger" />
                  ) : finding.severity === "warning" ? (
                    <AlertTriangle className="size-3.5 text-primary" />
                  ) : (
                    <Info className="size-3.5 text-rapid" />
                  )}
                  <span className="font-medium uppercase">{finding.severity}</span>
                  <span className="text-muted">{finding.line ? `line ${finding.line}` : "file"}</span>
                  <span className="font-mono text-muted">{finding.code}</span>
                </span>
                <span className="mt-1 block text-sm">{finding.message}</span>
                <span className="mt-1 block text-xs leading-5 text-muted">{finding.explanation}</span>
                <span className="mt-1 block text-xs text-fg">{finding.suggestion}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {analysis && (
        <section>
          <h2 className="text-xs font-medium tracking-wide text-muted">Commands</h2>
          <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs">
            {analysis.commands.map((command) => (
              <li key={command.code} className={command.supported ? "text-fg" : "text-danger"}>
                {command.code} × {command.count}
                {command.supported ? "" : " unsupported"}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">Profile used: {profile.name}. Engine {analysis.engineVersion}.</p>
          <p className="mt-1 text-xs text-muted">File {fileName}.</p>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "danger" | "ok" }) {
  return (
    <div className="rounded-md border border-border bg-surface px-2 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className={cn("truncate font-mono text-sm", tone === "danger" && "text-danger", tone === "ok" && "text-ok")}>{value}</p>
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
      className="inline-flex h-9 items-center gap-1 rounded-md border border-border px-2 text-xs disabled:opacity-40"
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
