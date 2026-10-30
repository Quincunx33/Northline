import { create } from "zustand";
import { inspectProgram } from "@/lib/engine-client";
import { BUILT_IN_PROFILES, cloneProfile, loadProfiles, saveProfiles } from "@/lib/machines";
import { sampleById } from "@/lib/samples";
import { cursorOf, distancePrefix, locate, timePrefix } from "@/lib/simulate";
import { deleteProject, listProjects, saveProject } from "@/lib/storage";
import type { Analysis, MachineConfig, MobileTab, PlayMode, ProjectRecord, ViewPreset } from "@/lib/types";
import { MAX_FILE_BYTES } from "@/lib/utils";

type Status = "idle" | "running" | "ready" | "error";

type State = {
  booted: boolean;
  fileName: string;
  fileSize: number;
  source: string;
  profiles: MachineConfig[];
  profileId: string;
  analysis: Analysis | null;
  status: Status;
  progressLabel: string;
  error: string | null;
  log: string[];
  projects: ProjectRecord[];
  selectedSegmentId: number | null;
  selectedLine: number | null;
  hoverSegmentId: number | null;
  playing: boolean;
  playMode: PlayMode;
  speed: number;
  playIndex: number;
  playT: number;
  ortho: boolean;
  viewToken: number;
  viewPreset: ViewPreset;
  mobileTab: MobileTab;
  bottomTab: "program" | "log";
  search: string;
  severity: "all" | "error" | "warning" | "info";
  plansOpen: boolean;
  limitsOpen: boolean;
  boot: () => Promise<void>;
  openText: (name: string, source: string) => void;
  openFile: (file: File) => Promise<void>;
  openSample: (id: string) => void;
  setProfileId: (id: string) => void;
  patchProfile: (patch: Partial<MachineConfig>) => void;
  duplicateProfile: () => void;
  removeProfile: (id: string) => void;
  resetBuiltins: () => void;
  reinspect: () => void;
  selectSegment: (id: number | null) => void;
  selectLine: (line: number) => void;
  setHover: (id: number | null) => void;
  togglePlay: () => void;
  restart: () => void;
  step: (dir: 1 | -1) => void;
  setSpeed: (speed: number) => void;
  setPlayMode: (mode: PlayMode) => void;
  scrub: (cursor: number) => void;
  advance: (dt: number) => void;
  requestView: (preset: ViewPreset) => void;
  setOrtho: (ortho: boolean) => void;
  setMobileTab: (tab: MobileTab) => void;
  setBottomTab: (tab: "program" | "log") => void;
  setSearch: (search: string) => void;
  setSeverity: (severity: State["severity"]) => void;
  setPlansOpen: (open: boolean) => void;
  setLimitsOpen: (open: boolean) => void;
  persistProject: () => Promise<void>;
  openProject: (id: string) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
};

let runToken = 0;
let debounce: ReturnType<typeof setTimeout> | null = null;

function activeProfile(profiles: MachineConfig[], id: string): MachineConfig {
  return profiles.find((p) => p.id === id) ?? profiles[0] ?? BUILT_IN_PROFILES[0];
}

async function runInspect(
  get: () => State,
  set: (partial: Partial<State> | ((state: State) => Partial<State>)) => void,
  source: string,
  config: MachineConfig,
) {
  const token = ++runToken;
  set({ status: "running", progressLabel: "Inspecting in a local worker…", error: null });
  try {
    const { promise } = inspectProgram(source, config);
    const analysis = await promise;
    if (token !== runToken) return;
    const note = `${analysis.segmentCount} segments · ${analysis.stats.errorCount} errors · ${analysis.stats.warningCount} warnings`;
    set((state) => ({
      analysis,
      status: "ready",
      progressLabel: note,
      playIndex: 0,
      playT: 0,
      playing: false,
      selectedSegmentId: null,
      selectedLine: analysis.segments[0]?.line ?? null,
      log: [`${new Date().toLocaleTimeString()}  ${note}`, ...state.log].slice(0, 40),
    }));
    if (token === runToken && get().viewToken === 0) {
      set({ viewPreset: "fit", viewToken: 1 });
    } else if (token === runToken) {
      set((state) => ({ viewPreset: "fit", viewToken: state.viewToken + 1 }));
    }
  } catch (error) {
    if (token !== runToken) return;
    const message = error instanceof Error ? error.message : "Inspection failed";
    set((state) => ({
      status: "error",
      error: message,
      progressLabel: "Inspection failed",
      log: [`${new Date().toLocaleTimeString()}  ${message}`, ...state.log].slice(0, 40),
    }));
  }
}

export const useInspector = create<State>((set, get) => ({
  booted: false,
  fileName: "rounded-plate.nc",
  fileSize: 0,
  source: "",
  profiles: BUILT_IN_PROFILES,
  profileId: BUILT_IN_PROFILES[0].id,
  analysis: null,
  status: "idle",
  progressLabel: "Starting local engine…",
  error: null,
  log: [],
  projects: [],
  selectedSegmentId: null,
  selectedLine: null,
  hoverSegmentId: null,
  playing: false,
  playMode: "preview",
  speed: 1,
  playIndex: 0,
  playT: 0,
  ortho: false,
  viewToken: 0,
  viewPreset: "iso",
  mobileTab: "view",
  bottomTab: "program",
  search: "",
  severity: "all",
  plansOpen: false,
  limitsOpen: false,

  boot: async () => {
    if (get().booted) return;
    const profiles = loadProfiles();
    const sample = sampleById("plate");
    let projects: ProjectRecord[] = [];
    try {
      projects = await listProjects();
    } catch {
      projects = [];
    }
    set({
      booted: true,
      profiles,
      profileId: profiles[0]?.id ?? BUILT_IN_PROFILES[0].id,
      projects,
      fileName: "rounded-plate.nc",
      fileSize: new Blob([sample.source]).size,
      source: sample.source,
    });
    await runInspect(get, set, sample.source, activeProfile(profiles, profiles[0]?.id ?? ""));
  },

  openText: (name, source) => {
    if (new Blob([source]).size > MAX_FILE_BYTES) {
      set({ error: "File is over 8 MB. Northline refuses it so the tab does not run out of memory.", status: "error" });
      return;
    }
    set({
      fileName: name,
      fileSize: new Blob([source]).size,
      source,
      error: null,
      mobileTab: "view",
    });
    const { profiles, profileId } = get();
    void runInspect(get, set, source, activeProfile(profiles, profileId));
  },

  openFile: async (file) => {
    const ok = /\.(gcode|nc|tap|cnc|txt)$/i.test(file.name) || file.type.startsWith("text/");
    if (!ok) {
      set({ error: "Use a .gcode, .nc, .tap, .cnc, or .txt file.", status: "error" });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      set({
        error: "That file is over 8 MB. Split it before inspecting. Nothing was uploaded.",
        status: "error",
      });
      return;
    }
    const source = await file.text();
    get().openText(file.name, source);
  },

  openSample: (id) => {
    const sample = sampleById(id);
    get().openText(`${sample.id}.nc`, sample.source);
  },

  setProfileId: (id) => {
    set({ profileId: id });
    const { source, profiles } = get();
    if (source) void runInspect(get, set, source, activeProfile(profiles, id));
  },

  patchProfile: (patch) => {
    const { profiles, profileId, source } = get();
    const next = profiles.map((p) => (p.id === profileId ? { ...p, ...patch, start: patch.start ?? p.start } : p));
    set({ profiles: next });
    saveProfiles(next);
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (source) void runInspect(get, set, source, activeProfile(get().profiles, get().profileId));
    }, 220);
  },

  duplicateProfile: () => {
    const { profiles, profileId } = get();
    const current = activeProfile(profiles, profileId);
    const copy = cloneProfile(current, `custom-${Date.now()}`, `${current.name} copy`);
    const next = [...profiles, copy];
    set({ profiles: next, profileId: copy.id });
    saveProfiles(next);
  },

  removeProfile: (id) => {
    if (BUILT_IN_PROFILES.some((p) => p.id === id)) return;
    const next = get().profiles.filter((p) => p.id !== id);
    const profileId = next[0]?.id ?? BUILT_IN_PROFILES[0].id;
    set({ profiles: next, profileId });
    saveProfiles(next);
    const { source } = get();
    if (source) void runInspect(get, set, source, activeProfile(next, profileId));
  },

  resetBuiltins: () => {
    const custom = get().profiles.filter((p) => !BUILT_IN_PROFILES.some((b) => b.id === p.id));
    const next = [...BUILT_IN_PROFILES.map((p) => ({ ...p, start: [...p.start] as [number, number, number] })), ...custom];
    set({ profiles: next });
    saveProfiles(next);
    const { source, profileId } = get();
    if (source) void runInspect(get, set, source, activeProfile(next, profileId));
  },

  reinspect: () => {
    const { source, profiles, profileId } = get();
    if (source) void runInspect(get, set, source, activeProfile(profiles, profileId));
  },

  selectSegment: (id) => {
    const seg = get().analysis?.segments.find((s) => s.id === id);
    set({
      selectedSegmentId: id,
      selectedLine: seg?.line ?? get().selectedLine,
      playIndex: seg ? get().analysis!.segments.findIndex((s) => s.id === id) : get().playIndex,
      playT: 0,
      playing: false,
      mobileTab: get().mobileTab === "setup" ? "view" : get().mobileTab,
    });
  },

  selectLine: (line) => {
    const segments = get().analysis?.segments ?? [];
    const index = segments.findIndex((s) => s.line === line);
    set({
      selectedLine: line,
      selectedSegmentId: index >= 0 ? segments[index].id : null,
      playIndex: index >= 0 ? index : get().playIndex,
      playT: 0,
      playing: false,
    });
  },

  setHover: (id) => set({ hoverSegmentId: id }),
  togglePlay: () => set({ playing: !get().playing }),
  restart: () => set({ playIndex: 0, playT: 0, playing: false }),
  step: (dir) => {
    const segments = get().analysis?.segments ?? [];
    if (!segments.length) return;
    const index = Math.max(0, Math.min(segments.length - 1, get().playIndex + dir));
    set({
      playIndex: index,
      playT: 0,
      playing: false,
      selectedSegmentId: segments[index].id,
      selectedLine: segments[index].line,
    });
  },
  setSpeed: (speed) => set({ speed }),
  setPlayMode: (playMode) => set({ playMode, playIndex: 0, playT: 0 }),
  scrub: (cursor) => {
    const segments = get().analysis?.segments ?? [];
    if (!segments.length) return;
    const table = get().playMode === "estimate" ? timePrefix(segments) : distancePrefix(segments);
    const { index, t } = locate(table.prefix, table.total, cursor);
    set({
      playIndex: index,
      playT: t,
      playing: false,
      selectedSegmentId: segments[index]?.id ?? null,
      selectedLine: segments[index]?.line ?? null,
    });
  },
  advance: (dt) => {
    const { analysis, playMode, speed, playIndex, playT, playing } = get();
    if (!playing || !analysis?.segments.length) return;
    const segments = analysis.segments;
    const visualMmPerSec = Math.min(400, Math.max(30, (distancePrefix(segments).total || 120) / 12));
    let index = playIndex;
    let remain =
      playMode === "estimate"
        ? dt * speed
        : (dt * speed * visualMmPerSec);
    let t = playT;
    let guard = 0;
    while (remain > 0 && guard < 10000 && index < segments.length) {
      guard += 1;
      const seg = segments[index];
      const span = playMode === "estimate" ? Math.max(seg.timeS ?? 0, 0) : Math.max(seg.lengthMm, 1e-9);
      if (span <= 1e-9) {
        index += 1;
        t = 0;
        continue;
      }
      const left = (1 - t) * span;
      if (remain < left) {
        t += remain / span;
        remain = 0;
      } else {
        remain -= left;
        index += 1;
        t = 0;
      }
    }
    if (index >= segments.length) {
      set({
        playIndex: segments.length - 1,
        playT: 1,
        playing: false,
        selectedSegmentId: segments[segments.length - 1].id,
        selectedLine: segments[segments.length - 1].line,
      });
      return;
    }
    set({
      playIndex: index,
      playT: t,
      selectedSegmentId: segments[index].id,
      selectedLine: segments[index].line,
    });
  },
  requestView: (preset) => set((state) => ({ viewPreset: preset, viewToken: state.viewToken + 1 })),
  setOrtho: (ortho) => set((state) => ({ ortho, viewToken: state.viewToken + 1 })),
  setMobileTab: (mobileTab) => set({ mobileTab }),
  setBottomTab: (bottomTab) => set({ bottomTab }),
  setSearch: (search) => set({ search }),
  setSeverity: (severity) => set({ severity }),
  setPlansOpen: (plansOpen) => set({ plansOpen }),
  setLimitsOpen: (limitsOpen) => set({ limitsOpen }),

  persistProject: async () => {
    const { fileName, source, profileId } = get();
    const record: ProjectRecord = {
      id: `${fileName}-${Date.now()}`,
      name: fileName,
      source,
      profileId,
      savedAt: new Date().toISOString(),
    };
    await saveProject(record);
    set({ projects: await listProjects() });
  },

  openProject: async (id) => {
    const project = get().projects.find((p) => p.id === id);
    if (!project) return;
    if (get().profiles.some((p) => p.id === project.profileId)) set({ profileId: project.profileId });
    get().openText(project.name, project.source);
  },

  removeProject: async (id) => {
    await deleteProject(id);
    set({ projects: await listProjects() });
  },
}));

export function playbackCursor(state: Pick<State, "analysis" | "playMode" | "playIndex" | "playT">): number {
  const segments = state.analysis?.segments ?? [];
  const table = state.playMode === "estimate" ? timePrefix(segments) : distancePrefix(segments);
  return cursorOf(table.prefix, table.total, state.playIndex, state.playT);
}

export function currentProfile(state: Pick<State, "profiles" | "profileId">): MachineConfig {
  return activeProfile(state.profiles, state.profileId);
}
