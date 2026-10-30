/* tslint:disable */
/* eslint-disable */
export function engine_version(): string;
/**
 * Inspect G-code. `config_json` is a MachineConfig object.
 * Always returns a JSON Analysis string. Parse failures become findings.
 */
export function inspect_gcode(source: string, config_json: string): string;
