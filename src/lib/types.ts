export type ControllerPreset = "grbl" | "generic";

export type MachineConfig = {
  id: string;
  name: string;
  illustrative: boolean;
  note: string;
  controllerPreset: ControllerPreset;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
  maxFeed: number;
  rapidRate: number;
  acceleration: number | null;
  clearanceZ: number;
  defaultUnits: "mm" | "inch";
  defaultDistance: "absolute" | "incremental";
  start: [number, number, number];
  requireSpindle: boolean;
  flagLowRapid: boolean;
  chordTolerance: number;
};

export type ArcParam = {
  plane: "XY" | "XZ" | "YZ" | string;
  center: [number, number, number];
  radius: number;
  startAngle: number;
  sweep: number;
  helix: number;
};

export type Segment = {
  id: number;
  line: number;
  kind: "rapid" | "linear" | "arcCw" | "arcCcw" | string;
  start: [number, number, number];
  end: [number, number, number];
  lengthMm: number;
  feedMmMin: number | null;
  feedMode: "rapid" | "perMinute" | "inverseTime" | string;
  inverseTime: number | null;
  spindle: "off" | "cw" | "ccw" | string;
  spindleSpeed: number | null;
  timeS: number | null;
  arc: ArcParam | null;
  points: number[];
};

export type Finding = {
  id: string;
  severity: "error" | "warning" | "info" | string;
  line: number | null;
  code: string;
  message: string;
  explanation: string;
  values: { key: string; value: string }[];
  suggestion: string;
  segmentId: number | null;
};

export type CommandCount = { code: string; count: number; supported: boolean };

export type Analysis = {
  engineVersion: string;
  dialect: {
    name: string;
    summary: string;
    supported: string[];
    notSimulated: string[];
  };
  truncated: boolean;
  lineCount: number;
  segmentCount: number;
  renderSimplified: boolean;
  positionUntrustedFrom: number | null;
  segments: Segment[];
  findings: Finding[];
  stats: {
    rapidDistanceMm: number;
    cutDistanceMm: number;
    totalDistanceMm: number;
    motionBlocks: number;
    errorCount: number;
    warningCount: number;
    infoCount: number;
    unsupportedCount: number;
  };
  time: {
    label: string;
    rapidTimeS: number;
    cutTimeS: number;
    totalTimeS: number;
    unestimatedSegments: number;
    trapezoidTotalS: number | null;
    assumptions: string[];
  };
  commands: CommandCount[];
  bbox: { min: [number, number, number]; max: [number, number, number]; size: [number, number, number] };
  assumptions: string[];
  reportLines: string[];
};

export type ProjectRecord = {
  id: string;
  name: string;
  source: string;
  profileId: string;
  savedAt: string;
};

export type ViewPreset = "iso" | "top" | "front" | "side" | "fit";
export type MobileTab = "view" | "code" | "inspect" | "setup";
export type PlayMode = "preview" | "estimate";
