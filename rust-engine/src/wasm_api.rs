use wasm_bindgen::prelude::*;

use crate::analyzer::inspect;
use crate::types::{MachineConfig, ENGINE_VERSION};

#[wasm_bindgen]
pub fn engine_version() -> String {
    ENGINE_VERSION.into()
}

/// Inspect G-code. `config_json` is a MachineConfig object.
/// Always returns a JSON Analysis string. Parse failures become findings.
#[wasm_bindgen]
pub fn inspect_gcode(source: &str, config_json: &str) -> String {
    let config = match serde_json::from_str::<MachineConfig>(config_json) {
        Ok(c) => c,
        Err(err) => MachineConfig {
            name: format!("Unreadable profile ({err})"),
            ..MachineConfig::default()
        },
    };
    let analysis = inspect(source, &config);
    match serde_json::to_string(&analysis) {
        Ok(s) => s,
        Err(err) => format!(
            "{{\"engineVersion\":\"{ENGINE_VERSION}\",\"fatal\":{}}}",
            serde_json::to_string(&err.to_string()).unwrap_or_else(|_| "\"serialize\"".into())
        ),
    }
}
