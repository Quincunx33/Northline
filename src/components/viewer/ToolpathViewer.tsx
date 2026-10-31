import { OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { currentProfile, useInspector } from "@/lib/store";
import { cncToThree, displaySamples, pointOnSegment } from "@/lib/simulate";
import type { Finding, MachineConfig, Segment } from "@/lib/types";

// Silence THREE.Clock deprecation warning emitted by @react-three/fiber internal clock initialization
if (typeof (THREE as unknown as { setConsoleFunction?: unknown }).setConsoleFunction === "function") {
  const threeWithConsole = THREE as unknown as {
    setConsoleFunction: (fn: (type: string, message: unknown, ...params: unknown[]) => void) => void;
    getConsoleFunction?: () => ((type: string, message: unknown, ...params: unknown[]) => void) | null;
  };
  const prevFn = typeof threeWithConsole.getConsoleFunction === "function" ? threeWithConsole.getConsoleFunction() : null;
  threeWithConsole.setConsoleFunction((type, message, ...params) => {
    if (
      type === "warn" &&
      typeof message === "string" &&
      message.includes("Clock: This module has been deprecated")
    ) {
      return;
    }
    if (prevFn) {
      prevFn(type, message, ...params);
    } else {
      const logger = (console as unknown as Record<string, (...args: unknown[]) => void>)[type];
      if (typeof logger === "function") {
        logger(message, ...params);
      }
    }
  });
}

const RAPID = "#8eadd8";
const CUT = "#7dbe9a";
const WARN = "#e2a53a";
const ERR = "#d36b62";
const FG = "#e7ebf0";
const MUTED = "#93a0b0";
const GRID = "#313846";
const SURFACE = "#181d26";

type Layers = {
  hit: THREE.BufferGeometry;
  ids: Uint32Array;
  rapid: Float32Array;
  cut: Float32Array;
  warn: Float32Array;
  err: Float32Array;
};

function worstSeverity(findings: Finding[]): Map<number, "error" | "warning"> {
  const map = new Map<number, "error" | "warning">();
  for (const finding of findings) {
    if (finding.segmentId == null) continue;
    if (finding.severity !== "error" && finding.severity !== "warning") continue;
    const prev = map.get(finding.segmentId);
    if (finding.severity === "error" || !prev) map.set(finding.segmentId, finding.severity);
  }
  return map;
}

function gridStep(span: number): number {
  if (span > 1200) return 100;
  if (span > 400) return 50;
  if (span > 150) return 10;
  if (span > 40) return 5;
  return 1;
}

function buildLayers(segments: Segment[], findings: Finding[]): Layers {
  const severity = worstSeverity(findings);
  const rapid: number[] = [];
  const cut: number[] = [];
  const warn: number[] = [];
  const err: number[] = [];
  const hit: number[] = [];
  const idList: number[] = [];
  for (const seg of segments) {
    const samples = displaySamples(seg);
    const level = severity.get(seg.id);
    const dest = level === "error" ? err : level === "warning" ? warn : seg.kind === "rapid" ? rapid : cut;
    for (let i = 0; i + 5 < samples.length; i += 3) {
      const a = cncToThree(samples[i], samples[i + 1], samples[i + 2]);
      const b = cncToThree(samples[i + 3], samples[i + 4], samples[i + 5]);
      const dx = a[0] - b[0];
      const dy = a[1] - b[1];
      const dz = a[2] - b[2];
      if (dx * dx + dy * dy + dz * dz < 1e-12) continue;
      dest.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      hit.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      idList.push(seg.id);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(hit, 3));
  return {
    hit: geometry,
    ids: Uint32Array.from(idList),
    rapid: Float32Array.from(rapid),
    cut: Float32Array.from(cut),
    warn: Float32Array.from(warn),
    err: Float32Array.from(err),
  };
}

function frameCamera(
  camera: THREE.Camera,
  controls: { target: THREE.Vector3; update: () => void } | null,
  preset: string,
  min: [number, number, number],
  max: [number, number, number],
  aspect: number,
) {
  const cx = (min[0] + max[0]) / 2;
  const cy = (min[1] + max[1]) / 2;
  const cz = (min[2] + max[2]) / 2;
  const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 30);
  const dist = span * 2.05;
  const target = new THREE.Vector3(...cncToThree(cx, cy, cz));
  const up = new THREE.Vector3(0, 1, 0);
  let position: THREE.Vector3;
  if (preset === "top") {
    position = new THREE.Vector3(...cncToThree(cx, cy, cz + dist));
    up.set(0, 0, -1);
  } else if (preset === "front") {
    position = new THREE.Vector3(...cncToThree(cx, cy - dist, cz));
  } else if (preset === "side") {
    position = new THREE.Vector3(...cncToThree(cx + dist, cy, cz));
  } else {
    position = new THREE.Vector3(...cncToThree(cx + dist * 0.9, cy - dist * 0.72, cz + dist * 0.62));
  }
  camera.up.copy(up);
  camera.position.copy(position);
  camera.lookAt(target);
  if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
    const persp = camera as THREE.PerspectiveCamera;
    persp.fov = 38;
    persp.near = Math.max(span / 800, 0.02);
    persp.far = dist * 40 + 2000;
    persp.updateProjectionMatrix();
  } else if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
    const ortho = camera as THREE.OrthographicCamera;
    const half = span * 0.68;
    const safeAspect = aspect > 0 ? aspect : 1;
    ortho.left = -half * safeAspect;
    ortho.right = half * safeAspect;
    ortho.top = half;
    ortho.bottom = -half;
    ortho.near = -dist * 8;
    ortho.far = dist * 8;
    ortho.zoom = 1;
    ortho.updateProjectionMatrix();
  }
  if (controls) {
    controls.target.copy(target);
    controls.update();
  }
}

function FatLines({
  positions,
  color,
  width,
  dashed = false,
}: {
  positions: Float32Array;
  color: string;
  width: number;
  dashed?: boolean;
}) {
  const size = useThree((s) => s.size);
  const line = useMemo(() => {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    const material = new LineMaterial({
      color,
      linewidth: width,
      dashed,
      dashSize: 2,
      gapSize: 1.4,
      transparent: true,
      opacity: 1,
      alphaToCoverage: true,
    });
    const object = new LineSegments2(geometry, material);
    if (dashed) object.computeLineDistances();
    object.raycast = () => {};
    object.renderOrder = 2;
    return object;
  }, [positions, color, width, dashed]);

  useEffect(() => {
    (line.material as LineMaterial).resolution.set(size.width, size.height);
  }, [line, size.width, size.height]);

  useEffect(
    () => () => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    },
    [line],
  );

  return <primitive object={line} />;
}

function WorkGrid({ profile }: { profile: MachineConfig }) {
  const span = Math.max(profile.xMax - profile.xMin, profile.yMax - profile.yMin, 1);
  const step = gridStep(span);
  const geometry = useMemo(() => {
    const x0 = Math.floor(profile.xMin / step) * step;
    const y0 = Math.floor(profile.yMin / step) * step;
    const nx = Math.max(1, Math.round((profile.xMax - x0) / step));
    const ny = Math.max(1, Math.round((profile.yMax - y0) / step));
    const x1 = x0 + nx * step;
    const y1 = y0 + ny * step;
    const majorEvery = 5;
    const minor: number[] = [];
    const major: number[] = [];
    for (let i = 0; i <= nx; i++) {
      const x = x0 + i * step;
      const dest = i % majorEvery === 0 ? major : minor;
      dest.push(...cncToThree(x, y0, 0), ...cncToThree(x, y1, 0));
    }
    for (let i = 0; i <= ny; i++) {
      const y = y0 + i * step;
      const dest = i % majorEvery === 0 ? major : minor;
      dest.push(...cncToThree(x0, y, 0), ...cncToThree(x1, y, 0));
    }
    const build = (values: number[]) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(values, 3));
      return geometry;
    };
    return { minor: build(minor), major: build(major) };
  }, [profile, step]);

  useEffect(
    () => () => {
      geometry.minor.dispose();
      geometry.major.dispose();
    },
    [geometry],
  );

  const center = cncToThree((profile.xMin + profile.xMax) / 2, (profile.yMin + profile.yMax) / 2, 0);
  return (
    <group>
      <mesh position={center} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <planeGeometry args={[Math.max(profile.xMax - profile.xMin, 1), Math.max(profile.yMax - profile.yMin, 1)]} />
        <meshBasicMaterial color={SURFACE} transparent opacity={0.55} depthWrite={false} />
      </mesh>
      <lineSegments geometry={geometry.minor}>
        <lineBasicMaterial color={GRID} />
      </lineSegments>
      <lineSegments geometry={geometry.major}>
        <lineBasicMaterial color={RAPID} transparent opacity={0.45} />
      </lineSegments>
    </group>
  );
}

function Envelope({ profile }: { profile: MachineConfig }) {
  const edges = useMemo(() => {
    const w = Math.max(profile.xMax - profile.xMin, 1);
    const d = Math.max(profile.yMax - profile.yMin, 1);
    const h = Math.max(profile.zMax - profile.zMin, 1);
    const box = new THREE.BoxGeometry(w, h, d);
    const geometry = new THREE.EdgesGeometry(box);
    box.dispose();
    return geometry;
  }, [profile]);
  useEffect(() => () => edges.dispose(), [edges]);
  const position = cncToThree(
    (profile.xMin + profile.xMax) / 2,
    (profile.yMin + profile.yMax) / 2,
    (profile.zMin + profile.zMax) / 2,
  );
  return (
    <lineSegments geometry={edges} position={position}>
      <lineBasicMaterial color={RAPID} transparent opacity={0.32} />
    </lineSegments>
  );
}

function makeSprite(text: string, color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, 128, 64);
    ctx.fillStyle = color;
    ctx.font = "600 48px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 64, 34);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  return new THREE.Sprite(material);
}

function AxisTriad({ length }: { length: number }) {
  const geometry = useMemo(() => {
    const points = [
      ...cncToThree(0, 0, 0),
      ...cncToThree(length, 0, 0),
      ...cncToThree(0, 0, 0),
      ...cncToThree(0, length, 0),
      ...cncToThree(0, 0, 0),
      ...cncToThree(0, 0, length),
    ];
    const colors = [0.56, 0.68, 0.85, 0.56, 0.68, 0.85, 0.49, 0.75, 0.6, 0.49, 0.75, 0.6, 0.89, 0.65, 0.23, 0.89, 0.65, 0.23];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return geometry;
  }, [length]);
  const labels = useMemo(() => {
    const specs: [string, string, [number, number, number]][] = [
      ["X", RAPID, cncToThree(length * 1.18, 0, 0)],
      ["Y", CUT, cncToThree(0, length * 1.18, 0)],
      ["Z", WARN, cncToThree(0, 0, length * 1.18)],
    ];
    return specs.map(([text, color, pos]) => {
      const sprite = makeSprite(text, color);
      sprite.position.set(pos[0], pos[1], pos[2]);
      sprite.scale.set(length * 0.38, length * 0.19, 1);
      return sprite;
    });
  }, [length]);
  useEffect(
    () => () => {
      geometry.dispose();
      for (const sprite of labels) {
        const material = sprite.material as THREE.SpriteMaterial;
        material.map?.dispose();
        material.dispose();
      }
    },
    [geometry, labels],
  );
  return (
    <group renderOrder={4}>
      <lineSegments geometry={geometry}>
        <lineBasicMaterial vertexColors />
      </lineSegments>
      {labels.map((sprite, index) => (
        <primitive key={index} object={sprite} />
      ))}
    </group>
  );
}

function ToolMarker({ tool, span }: { tool: [number, number, number]; span: number }) {
  const tip = cncToThree(tool[0], tool[1], tool[2]);
  const floor = cncToThree(tool[0], tool[1], 0);
  const toolR = Math.max(span * 0.008, 0.35);
  const toolH = Math.max(span * 0.09, 3.2);
  const leader = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    return geometry;
  }, []);
  const cross = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
    return geometry;
  }, []);
  useEffect(
    () => () => {
      leader.dispose();
      cross.dispose();
    },
    [leader, cross],
  );

  const lead = leader.getAttribute("position") as THREE.BufferAttribute;
  lead.setXYZ(0, tip[0], tip[1], tip[2]);
  lead.setXYZ(1, floor[0], floor[1], floor[2]);
  lead.needsUpdate = true;
  const arm = Math.max(span * 0.035, toolR * 3);
  const crossPos = cross.getAttribute("position") as THREE.BufferAttribute;
  const x0 = cncToThree(tool[0] - arm, tool[1], 0);
  const x1 = cncToThree(tool[0] + arm, tool[1], 0);
  const y0 = cncToThree(tool[0], tool[1] - arm, 0);
  const y1 = cncToThree(tool[0], tool[1] + arm, 0);
  crossPos.setXYZ(0, x0[0], x0[1], x0[2]);
  crossPos.setXYZ(1, x1[0], x1[1], x1[2]);
  crossPos.setXYZ(2, y0[0], y0[1], y0[2]);
  crossPos.setXYZ(3, y1[0], y1[1], y1[2]);
  crossPos.needsUpdate = true;

  return (
    <group>
      <lineSegments geometry={leader}>
        <lineBasicMaterial color={WARN} transparent opacity={0.8} />
      </lineSegments>
      <lineSegments geometry={cross}>
        <lineBasicMaterial color={WARN} transparent opacity={0.9} />
      </lineSegments>
      <mesh position={floor} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[toolR * 1.15, toolR * 1.55, 28]} />
        <meshBasicMaterial color={WARN} transparent opacity={0.85} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <group position={tip}>
        <mesh position={[0, toolH * 0.16, 0]}>
          <cylinderGeometry args={[toolR * 0.72, toolR * 0.56, toolH * 0.32, 20]} />
          <meshStandardMaterial color={WARN} metalness={0.35} roughness={0.4} />
        </mesh>
        <mesh position={[0, toolH * 0.64, 0]}>
          <cylinderGeometry args={[toolR * 0.4, toolR * 0.4, toolH * 0.64, 20]} />
          <meshStandardMaterial color={MUTED} metalness={0.55} roughness={0.32} />
        </mesh>
        <mesh>
          <sphereGeometry args={[Math.max(toolR * 0.16, 0.12), 16, 12]} />
          <meshStandardMaterial color={FG} metalness={0.1} roughness={0.35} />
        </mesh>
      </group>
    </group>
  );
}

function PartialMove({ segment, t }: { segment: Segment | null; t: number }) {
  const line = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(96), 3));
    geometry.setDrawRange(0, 0);
    const material = new THREE.LineBasicMaterial({ color: FG });
    const object = new THREE.Line(geometry, material);
    object.renderOrder = 3;
    return object;
  }, []);
  useEffect(
    () => () => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    },
    [line],
  );

  const samples = segment && t > 0.001 ? displaySamples(segment, t) : [];
  let attr = line.geometry.getAttribute("position") as THREE.BufferAttribute;
  if (attr.array.length < samples.length) {
    line.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(samples.length + 48), 3));
    attr = line.geometry.getAttribute("position") as THREE.BufferAttribute;
  }
  for (let i = 0; i < samples.length; i += 3) {
    const p = cncToThree(samples[i], samples[i + 1], samples[i + 2]);
    attr.setXYZ(i / 3, p[0], p[1], p[2]);
  }
  attr.needsUpdate = true;
  line.geometry.setDrawRange(0, samples.length / 3);
  return <primitive object={line} />;
}

function Scene() {
  const analysis = useInspector((s) => s.analysis);
  const profile = useInspector(currentProfile);
  const ortho = useInspector((s) => s.ortho);
  const token = useInspector((s) => s.viewToken);
  const preset = useInspector((s) => s.viewPreset);
  const playIndex = useInspector((s) => s.playIndex);
  const playT = useInspector((s) => s.playT);
  const selectedId = useInspector((s) => s.selectedSegmentId);
  const hoverId = useInspector((s) => s.hoverSegmentId);
  const selectSegment = useInspector((s) => s.selectSegment);
  const setHover = useInspector((s) => s.setHover);
  const controlsRef = useRef<{ target: THREE.Vector3; update: () => void } | null>(null);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const ray = useThree((s) => s.raycaster);

  const layers = useMemo(
    () => buildLayers(analysis?.segments ?? [], analysis?.findings ?? []),
    [analysis],
  );
  useEffect(() => () => layers.hit.dispose(), [layers]);

  useEffect(() => {
    const span = Math.max(analysis?.bbox.size[0] ?? 40, analysis?.bbox.size[1] ?? 40, analysis?.bbox.size[2] ?? 20, 20);
    ray.params.Line.threshold = Math.max(span * 0.02, 0.8);
  }, [analysis, ray]);

  useEffect(() => {
    const bbox = analysis && analysis.segmentCount > 0 ? analysis.bbox : null;
    const min: [number, number, number] = bbox ? bbox.min : [profile.xMin, profile.yMin, profile.zMin];
    const max: [number, number, number] = bbox ? bbox.max : [profile.xMax, profile.yMax, profile.zMax];
    frameCamera(camera, controlsRef.current, preset === "fit" ? "iso" : preset, min, max, size.width / Math.max(size.height, 1));
  }, [token, preset, camera, size.width, size.height, analysis, profile]);

  useFrame(() => {
    const persp = camera as THREE.PerspectiveCamera;
    if (!persp.isPerspectiveCamera) return;
    const target = controlsRef.current?.target;
    if (!target) return;
    const dist = persp.position.distanceTo(target);
    const nextNear = Math.min(Math.max(dist / 250, 0.01), 2);
    if (Math.abs(persp.near - nextNear) / persp.near > 0.25) {
      persp.near = nextNear;
      persp.far = Math.max(dist * 30, 2000);
      persp.updateProjectionMatrix();
    }
  });

  const segments = analysis?.segments ?? [];
  const current = segments[Math.min(playIndex, Math.max(segments.length - 1, 0))];
  const tool = current ? pointOnSegment(current, playT) : profile.start;
  const span = Math.max(analysis?.bbox.size[0] ?? 80, analysis?.bbox.size[1] ?? 80, analysis?.bbox.size[2] ?? 20, 40);
  const selected = segments.find((s) => s.id === selectedId) ?? null;
  const hovered = segments.find((s) => s.id === hoverId && s.id !== selectedId) ?? null;
  const selectedPts = useMemo(() => (selected ? Float32Array.from(pairsOf(selected)) : null), [selected]);
  const hoveredPts = useMemo(() => (hovered ? Float32Array.from(pairsOf(hovered)) : null), [hovered]);

  return (
    <>
      {ortho ? (
        <OrthographicCamera makeDefault near={-5000} far={5000} position={[80, 80, 80]} />
      ) : (
        <PerspectiveCamera makeDefault fov={38} near={0.05} far={100000} position={[80, 90, 120]} />
      )}
      <OrbitControls
        key={ortho ? "ortho" : "persp"}
        ref={(node) => {
          controlsRef.current = node;
        }}
        makeDefault
        enableDamping
        dampingFactor={0.12}
        zoomToCursor
        screenSpacePanning
      />
      <color attach="background" args={["#101318"]} />
      <hemisphereLight args={["#e7ebf0", "#181d26", 0.72]} />
      <directionalLight position={[80, 140, 40]} intensity={0.85} />
      <WorkGrid profile={profile} />
      <Envelope profile={profile} />
      <AxisTriad length={Math.max(span * 0.2, 14)} />
      {layers.rapid.length >= 6 && <FatLines positions={layers.rapid} color={RAPID} width={1.6} dashed />}
      {layers.cut.length >= 6 && <FatLines positions={layers.cut} color={CUT} width={2.6} />}
      {layers.warn.length >= 6 && <FatLines positions={layers.warn} color={WARN} width={2.8} />}
      {layers.err.length >= 6 && <FatLines positions={layers.err} color={ERR} width={3} />}
      {layers.ids.length > 0 && (
        <lineSegments
          geometry={layers.hit}
          onPointerMove={(event) => {
            event.stopPropagation();
            const index = event.index ?? -1;
            if (index < 0) return;
            const id = layers.ids[Math.floor(index / 2)];
            if (id != null && id !== hoverId) setHover(id);
          }}
          onPointerOut={() => {
            if (hoverId != null) setHover(null);
          }}
          onClick={(event) => {
            event.stopPropagation();
            const index = event.index ?? -1;
            if (index < 0) return;
            const id = layers.ids[Math.floor(index / 2)];
            if (id != null) selectSegment(id);
          }}
        >
          <lineBasicMaterial transparent opacity={0} depthWrite={false} />
        </lineSegments>
      )}
      {hoveredPts && hoveredPts.length >= 6 && <FatLines positions={hoveredPts} color={FG} width={3.4} />}
      {selectedPts && selectedPts.length >= 6 && <FatLines positions={selectedPts} color={WARN} width={3.8} />}
      <PartialMove segment={current ?? null} t={playT} />
      <ToolMarker tool={tool} span={span} />
    </>
  );
}

function pairsOf(segment: Segment): number[] {
  const samples = displaySamples(segment);
  const out: number[] = [];
  for (let i = 0; i + 5 < samples.length; i += 3) {
    const a = cncToThree(samples[i], samples[i + 1], samples[i + 2]);
    const b = cncToThree(samples[i + 3], samples[i + 4], samples[i + 5]);
    out.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  }
  return out;
}

export function ToolpathViewer() {
  const analysis = useInspector((s) => s.analysis);
  const status = useInspector((s) => s.status);
  const profile = useInspector(currentProfile);
  const playIndex = useInspector((s) => s.playIndex);
  const playT = useInspector((s) => s.playT);
  const seg = analysis?.segments[playIndex] ?? null;
  const tool = useMemo(() => {
    if (seg) return pointOnSegment(seg, playT);
    return analysis?.segments[0]?.start ?? profile.start;
  }, [analysis, seg, playT, profile.start]);
  const grid = gridStep(Math.max(profile.xMax - profile.xMin, profile.yMax - profile.yMin, 1));

  return (
    <div className="relative h-full min-h-64 bg-bg">
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance", toneMapping: THREE.NoToneMapping }}
        camera={{ position: [90, 110, 140], fov: 38 }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
        }}
      >
        <Scene />
      </Canvas>
      {/* Top Floating Controls Bar: HUD on Left, View Presets on Right. Flex-wrap guarantees zero collision on any screen width! */}
      <div className="pointer-events-none absolute inset-x-2.5 top-2.5 z-10 flex flex-wrap items-start justify-between gap-2">
        {/* Frosted HUD Readout */}
        <div className="pointer-events-auto flex max-w-full sm:max-w-xs flex-col gap-1 rounded-lg border border-border/80 bg-surface/90 px-2.5 py-1.5 sm:px-3 sm:py-2 shadow-md backdrop-blur-md">
          <div className="flex items-center gap-2 font-mono text-xs tabular-nums tracking-wide text-fg">
            <span><span className="text-primary font-semibold">X</span> {tool[0].toFixed(3)}</span>
            <span className="text-muted/60">·</span>
            <span><span className="text-ok font-semibold">Y</span> {tool[1].toFixed(3)}</span>
            <span className="text-muted/60">·</span>
            <span><span className="text-rapid font-semibold">Z</span> {tool[2].toFixed(3)}</span>
          </div>
          <p className="truncate text-[11px] text-muted">
            {seg
              ? `Line ${seg.line} · ${kindLabel(seg.kind)}${seg.arc ? ` ${seg.arc.plane} R${seg.arc.radius.toFixed(2)}` : ""} · ${seg.feedMode === "rapid" ? "rapid" : seg.feedMmMin ? `${seg.feedMmMin.toFixed(0)} mm/min` : "feed n/a"}`
              : status === "running"
                ? "Inspecting…"
                : "No motion yet"}
          </p>
        </div>

        {/* Camera View Presets Toolbar */}
        <div className="pointer-events-auto flex items-center gap-0.5 sm:gap-1 overflow-x-auto rounded-lg border border-border/80 bg-surface/90 p-1 shadow-md backdrop-blur-md">
          <ViewButton preset="fit" label="Fit" />
          <ViewButton preset="iso" label="Iso" />
          <ViewButton preset="top" label="Top" />
          <ViewButton preset="front" label="Front" />
          <ViewButton preset="side" label="Side" />
          <OrthoButton />
        </div>
      </div>

      {/* Grid and Shank Legend (Spacious Desktop only) */}
      <div className="pointer-events-none absolute bottom-2.5 left-2.5 z-10 hidden max-w-xs rounded-md border border-border/50 bg-bg/70 px-2 py-1 text-[11px] text-muted backdrop-blur-sm xl:block">
        Dashed rapid · Solid cut · {grid} mm grid on Z0.
        {analysis?.renderSimplified ? " Simplified display sampling." : ""}
      </div>
    </div>
  );
}

function ViewButton({ preset, label }: { preset: "fit" | "iso" | "top" | "front" | "side"; label: string }) {
  const request = useInspector((s) => s.requestView);
  return (
    <button
      type="button"
      className="inline-flex h-7 sm:h-8 items-center justify-center rounded-md px-1.5 sm:px-2.5 text-[11px] sm:text-xs font-medium text-fg transition-colors hover:bg-raised active:scale-95"
      onClick={() => request(preset)}
    >
      {label}
    </button>
  );
}

function OrthoButton() {
  const ortho = useInspector((s) => s.ortho);
  const setOrtho = useInspector((s) => s.setOrtho);
  return (
    <button
      type="button"
      className="inline-flex h-7 sm:h-8 items-center justify-center rounded-md px-1.5 sm:px-2.5 text-[11px] sm:text-xs font-medium text-muted transition-colors hover:bg-raised hover:text-fg active:scale-95"
      onClick={() => setOrtho(!ortho)}
      aria-pressed={ortho}
      title={ortho ? "Switch to Perspective View" : "Switch to Orthographic View"}
    >
      {ortho ? "Ortho" : "Persp"}
    </button>
  );
}

function kindLabel(kind: string): string {
  if (kind === "rapid") return "G0 rapid";
  if (kind === "linear") return "G1 cut";
  if (kind === "arcCw") return "G2 arc";
  if (kind === "arcCcw") return "G3 arc";
  return kind;
}
