//! Northline G-code engine.
//!
//! The library is a pure interpreter for a documented 3-axis milling subset.
//! `inspect` never panics on malformed text. The wasm export is a thin JSON
//! wrapper so the same function is what `cargo test` exercises.

pub mod analyzer;
pub mod arc_interpolation;
pub mod geometry;
pub mod lexer;
pub mod modal_state;
pub mod motion_interpreter;
pub mod parser;
pub mod report_generator;
pub mod risk_detector;
pub mod time_estimator;
pub mod types;

pub use analyzer::inspect;
pub use types::{Analysis, MachineConfig, ENGINE_VERSION};

#[cfg(target_arch = "wasm32")]
mod wasm_api;
