import type { Segment } from "@/lib/types";

/** CNC Z-up to Three.js Y-up. CNC +Y points toward three.js −Z. */
export function cncToThree(x: number, y: number, z: number): [number, number, number] {
  return [x, z, -y];
}

export function planeAxes(plane: string): [number, number, number] {
  if (plane === "XZ") return [0, 2, 1];
  if (plane === "YZ") return [1, 2, 0];
  return [0, 1, 2];
}

/** Geometric position along one interpreted segment. t is 0 at the start and 1 at the end. */
export function pointOnSegment(seg: Segment, t: number): [number, number, number] {
  const u = clamp01(t);
  if (u >= 1) return seg.end;
  if (u <= 0) return seg.start;
  if (seg.arc) {
    const [au, av, aw] = planeAxes(seg.arc.plane);
    const ang = seg.arc.startAngle + seg.arc.sweep * u;
    const p: [number, number, number] = [seg.start[0], seg.start[1], seg.start[2]];
    p[au] = seg.arc.center[au] + seg.arc.radius * Math.cos(ang);
    p[av] = seg.arc.center[av] + seg.arc.radius * Math.sin(ang);
    p[aw] = seg.start[aw] + seg.arc.helix * u;
    return p;
  }
  return [
    seg.start[0] + (seg.end[0] - seg.start[0]) * u,
    seg.start[1] + (seg.end[1] - seg.start[1]) * u,
    seg.start[2] + (seg.end[2] - seg.start[2]) * u,
  ];
}

/** Chord error used only for drawing. Lengths and time stay on the analytic arc. */
const DISPLAY_CHORD_MM = 0.02;
const DISPLAY_MAX_STEPS = 240;

/**
 * Polyline for the viewer. Lines use the programmed endpoints.
 * Arcs are sampled from the same center, sweep, and helix as playback,
 * with endpoints forced so the tool stays on the drawn curve.
 */
export function displaySamples(seg: Segment, until = 1): number[] {
  const tEnd = clamp01(until);
  const start = seg.start;
  if (!seg.arc || !(seg.arc.radius > 1e-6) || !Number.isFinite(seg.arc.sweep)) {
    const end = tEnd >= 1 ? seg.end : pointOnSegment(seg, tEnd);
    return [start[0], start[1], start[2], end[0], end[1], end[2]];
  }
  const arc = seg.arc;
  const [au, av, aw] = planeAxes(arc.plane);
  const ratio = Math.min(1, Math.max(-1, 1 - DISPLAY_CHORD_MM / arc.radius));
  const dTheta = 2 * Math.acos(ratio);
  const fullSteps = Math.min(
    DISPLAY_MAX_STEPS,
    Math.max(2, Math.ceil(Math.abs(arc.sweep) / Math.max(dTheta, 1e-4))),
  );
  const steps = Math.max(1, Math.ceil(fullSteps * Math.max(tEnd, 1e-6)));
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = (tEnd * i) / steps;
    if (i === 0) {
      out.push(start[0], start[1], start[2]);
      continue;
    }
    if (u >= 1) {
      out.push(seg.end[0], seg.end[1], seg.end[2]);
      continue;
    }
    const ang = arc.startAngle + arc.sweep * u;
    const p: [number, number, number] = [start[0], start[1], start[2]];
    p[au] = arc.center[au] + arc.radius * Math.cos(ang);
    p[av] = arc.center[av] + arc.radius * Math.sin(ang);
    p[aw] = start[aw] + arc.helix * u;
    out.push(p[0], p[1], p[2]);
  }
  return out;
}

export function distancePrefix(segments: Segment[]): { prefix: number[]; total: number } {
  const prefix = [0];
  let total = 0;
  for (const seg of segments) {
    total += Math.max(0, seg.lengthMm);
    prefix.push(total);
  }
  return { prefix, total };
}

export function timePrefix(segments: Segment[]): { prefix: number[]; total: number } {
  const prefix = [0];
  let total = 0;
  for (const seg of segments) {
    total += seg.timeS != null && seg.timeS > 0 ? seg.timeS : 0;
    prefix.push(total);
  }
  return { prefix, total };
}

export function locate(prefix: number[], total: number, cursor: number): { index: number; t: number } {
  if (prefix.length < 2 || total <= 0) return { index: 0, t: 0 };
  const target = clamp01(cursor) * total;
  let lo = 0;
  let hi = prefix.length - 2;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (prefix[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  const span = prefix[lo + 1] - prefix[lo];
  const t = span <= 1e-12 ? 0 : (target - prefix[lo]) / span;
  return { index: lo, t: clamp01(t) };
}

export function cursorOf(prefix: number[], total: number, index: number, t: number): number {
  if (total <= 0) return 0;
  const i = Math.max(0, Math.min(index, prefix.length - 2));
  const span = prefix[i + 1] - prefix[i];
  return clamp01((prefix[i] + span * clamp01(t)) / total);
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}
