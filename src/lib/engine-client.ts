import type { Analysis, MachineConfig } from "@/lib/types";

type Ok = { id: number; ok: true; result: Analysis };
type Fail = { id: number; ok: false; error: string };

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
let wasmReady: Promise<{ inspect_gcode: (source: string, config: string) => string }> | null = null;

async function inlineInspect(source: string, config: MachineConfig): Promise<Analysis> {
  if (!wasmReady) {
    wasmReady = import("./wasm/pkg/cnc_engine.js").then(async (mod) => {
      await mod.default();
      return mod;
    });
  }
  const mod = await wasmReady;
  const json = mod.inspect_gcode(source, JSON.stringify(config));
  return JSON.parse(json) as Analysis;
}

export function inspectProgram(source: string, config: MachineConfig): { id: number; promise: Promise<Analysis> } {
  const id = ++seq;
  if (typeof Worker === "undefined" || workerBroken) {
    return { id, promise: inlineInspect(source, config) };
  }
  if (!worker) {
    worker = new Worker(new URL("./workers/inspect.worker.ts", import.meta.url), { type: "module" });
  }
  const promise = new Promise<Analysis>((resolve, reject) => {
    const onMessage = (event: MessageEvent<Ok | Fail>) => {
      if (event.data.id !== id) return;
      worker?.removeEventListener("message", onMessage);
      if (event.data.ok) resolve(event.data.result);
      else reject(new Error(event.data.error));
    };
    worker?.addEventListener("message", onMessage);
    worker?.addEventListener(
      "error",
      () => {
        workerBroken = true;
        worker?.terminate();
        worker = null;
        inlineInspect(source, config).then(resolve, reject);
      },
      { once: true },
    );
  });
  worker.postMessage({ id, source, config });
  return { id, promise };
}

export function latestInspectId(): number {
  return seq;
}
