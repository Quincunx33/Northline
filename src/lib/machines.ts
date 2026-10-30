import type { MachineConfig } from "@/lib/types";

/**
 * Travel numbers below are illustrative teaching profiles.
 * They are not measured specifications for any commercial machine.
 */
export const BUILT_IN_PROFILES: MachineConfig[] = [
  {
    id: "illustrative-desktop",
    name: "Illustrative desktop mill",
    illustrative: true,
    note: "Teaching envelope only. Not a verified 3018, 3040, or other model spec.",
    controllerPreset: "grbl",
    xMin: 0,
    xMax: 300,
    yMin: 0,
    yMax: 180,
    zMin: -80,
    zMax: 20,
    maxFeed: 2000,
    rapidRate: 3000,
    acceleration: 300,
    clearanceZ: 5,
    defaultUnits: "mm",
    defaultDistance: "absolute",
    start: [0, 0, 0],
    requireSpindle: true,
    flagLowRapid: true,
    chordTolerance: 0.05,
  },
  {
    id: "illustrative-router",
    name: "Illustrative mid router",
    illustrative: true,
    note: "A made-up 1200 mm router envelope for scale checks. Acceleration is intentionally unset.",
    controllerPreset: "grbl",
    xMin: 0,
    xMax: 1200,
    yMin: 0,
    yMax: 1200,
    zMin: -150,
    zMax: 40,
    maxFeed: 5000,
    rapidRate: 8000,
    acceleration: null,
    clearanceZ: 8,
    defaultUnits: "mm",
    defaultDistance: "absolute",
    start: [0, 0, 0],
    requireSpindle: true,
    flagLowRapid: true,
    chordTolerance: 0.1,
  },
];

const STORAGE_KEY = "northline.profiles.v1";

export function loadProfiles(): MachineConfig[] {
  if (typeof localStorage === "undefined") return BUILT_IN_PROFILES.map(clone);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return BUILT_IN_PROFILES.map(clone);
    const parsed = JSON.parse(raw) as MachineConfig[];
    if (!Array.isArray(parsed) || parsed.length === 0) return BUILT_IN_PROFILES.map(clone);
    const byId = new Map(parsed.filter((p) => p && typeof p.id === "string").map((p) => [p.id, p]));
    const builtins = BUILT_IN_PROFILES.map((base) => {
      const saved = byId.get(base.id);
      return saved ? { ...clone(base), ...saved, illustrative: true } : clone(base);
    });
    const custom = parsed.filter((p) => p && !BUILT_IN_PROFILES.some((b) => b.id === p.id));
    return [...builtins, ...custom];
  } catch {
    return BUILT_IN_PROFILES.map(clone);
  }
}

export function saveProfiles(profiles: MachineConfig[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

export function cloneProfile(source: MachineConfig, id: string, name: string): MachineConfig {
  return { ...clone(source), id, name, illustrative: false, note: "Personal copy stored in this browser." };
}

function clone(p: MachineConfig): MachineConfig {
  return { ...p, start: [...p.start] as [number, number, number] };
}
