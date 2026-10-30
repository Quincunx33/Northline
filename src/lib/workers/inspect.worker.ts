import init, { inspect_gcode } from "../wasm/pkg/cnc_engine.js";

let ready: Promise<unknown> | null = null;

self.onmessage = async (event: MessageEvent<{ id: number; source: string; config: unknown }>) => {
  const { id, source, config } = event.data;
  try {
    if (!ready) ready = init();
    await ready;
    const json = inspect_gcode(source, JSON.stringify(config));
    const result = JSON.parse(json) as unknown;
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
