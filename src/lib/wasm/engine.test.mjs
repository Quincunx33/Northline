// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { inspect_gcode, engine_version } = require("./pkg-node/cnc_engine.cjs");

const profile = {
  name: "test",
  controllerPreset: "grbl",
  xMin: 0,
  xMax: 300,
  yMin: 0,
  yMax: 180,
  zMin: -80,
  zMax: 20,
  maxFeed: 2000,
  rapidRate: 3000,
  clearanceZ: 5,
  defaultUnits: "mm",
  defaultDistance: "absolute",
  start: [0, 0, 0],
  requireSpindle: true,
  flagLowRapid: true,
  chordTolerance: 0.05,
};

test("wasm engine inspects a real move", () => {
  assert.match(engine_version(), /0\.1\.0/);
  const raw = inspect_gcode("G21\nG90\nG94\nM3 S1000\nG1 X10 F600\n", JSON.stringify(profile));
  const analysis = JSON.parse(raw);
  assert.equal(analysis.segmentCount, 1);
  assert.ok(Math.abs(analysis.stats.cutDistanceMm - 10) < 1e-6);
  assert.ok(Math.abs(analysis.time.cutTimeS - 1) < 1e-6);
  assert.equal(analysis.segments[0].kind, "linear");
  assert.ok(analysis.reportLines.some((line) => line.includes("Advisory")));
});

test("wasm flags an unsupported canned cycle instead of inventing a hole", () => {
  const raw = inspect_gcode("G21\nG90\nG81 X10 Y10 Z-5 R1 F80\n", JSON.stringify(profile));
  const analysis = JSON.parse(raw);
  assert.ok(analysis.findings.some((f) => f.code === "UNSUPPORTED" && f.severity === "error"));
  assert.equal(analysis.segmentCount, 0);
});
