import assert from "node:assert/strict";
import test from "node:test";
import type { Segment } from "./types.ts";
import { displaySamples, locate, pointOnSegment } from "./simulate.ts";

function linear(partial: Partial<Segment>): Segment {
  return {
    id: 1,
    line: 1,
    kind: "linear",
    start: [0, 0, 0],
    end: [10, 0, 0],
    lengthMm: 10,
    feedMmMin: 100,
    feedMode: "perMinute",
    inverseTime: null,
    spindle: "cw",
    spindleSpeed: null,
    timeS: 6,
    arc: null,
    points: [],
    ...partial,
  };
}

test("linear interpolation is deterministic", () => {
  const seg = linear({});
  const mid = pointOnSegment(seg, 0.5);
  assert.deepEqual(mid, [5, 0, 0]);
  assert.deepEqual(pointOnSegment(seg, 0), [0, 0, 0]);
  assert.deepEqual(pointOnSegment(seg, 1), [10, 0, 0]);
});

test("arc interpolation hits the quarter-turn midpoint", () => {
  const seg = linear({
    kind: "arcCcw",
    start: [5, 0, 0],
    end: [0, 5, 0],
    arc: {
      plane: "XY",
      center: [0, 0, 0],
      radius: 5,
      startAngle: 0,
      sweep: Math.PI / 2,
      helix: 0,
    },
  });
  const mid = pointOnSegment(seg, 0.5);
  const expect = 5 * Math.cos(Math.PI / 4);
  assert.ok(Math.abs(mid[0] - expect) < 1e-9);
  assert.ok(Math.abs(mid[1] - expect) < 1e-9);
  assert.equal(mid[2], 0);
});

test("display samples keep a quarter arc within the chord tolerance", () => {
  const seg = linear({
    kind: "arcCcw",
    start: [5, 0, 0],
    end: [0, 5, 0],
    arc: {
      plane: "XY",
      center: [0, 0, 0],
      radius: 5,
      startAngle: 0,
      sweep: Math.PI / 2,
      helix: 0,
    },
  });
  const pts = displaySamples(seg);
  assert.ok(pts.length >= 12);
  assert.deepEqual(pts.slice(0, 3), [5, 0, 0]);
  assert.ok(Math.abs(pts[pts.length - 3]) < 1e-9);
  assert.ok(Math.abs(pts[pts.length - 2] - 5) < 1e-9);
  for (let i = 0; i + 5 < pts.length; i += 3) {
    const mx = (pts[i] + pts[i + 3]) / 2;
    const my = (pts[i + 1] + pts[i + 4]) / 2;
    const sagitta = 5 - Math.hypot(mx, my);
    assert.ok(sagitta <= 0.02 + 1e-6);
    assert.ok(sagitta >= -1e-6);
  }
  const partial = displaySamples(seg, 0.5);
  const last = partial.slice(-3);
  const mid = pointOnSegment(seg, 0.5);
  assert.ok(Math.abs(last[0] - mid[0]) < 1e-9);
  assert.ok(Math.abs(last[1] - mid[1]) < 1e-9);
});

test("locate maps a cursor onto the second segment", () => {
  const found = locate([0, 10, 30], 30, 20 / 30);
  assert.equal(found.index, 1);
  assert.ok(Math.abs(found.t - 0.5) < 1e-9);
});
