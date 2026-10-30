//! Shared data types for the inspector. Serialized as camelCase JSON for the UI.

use serde::{Deserialize, Serialize};

pub const ENGINE_VERSION: &str = "0.1.0";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineConfig {
    #[serde(default = "default_name")]
    pub name: String,
    /// `grbl` applies a documented GRBL-like startup modal set.
    /// `generic` uses the same numeric defaults but the report says they are not controller-verified.
    #[serde(default = "default_preset")]
    pub controller_preset: String,
    #[serde(default)]
    pub x_min: f64,
    #[serde(default = "default_x_max")]
    pub x_max: f64,
    #[serde(default)]
    pub y_min: f64,
    #[serde(default = "default_y_max")]
    pub y_max: f64,
    #[serde(default = "default_z_min")]
    pub z_min: f64,
    #[serde(default = "default_z_max")]
    pub z_max: f64,
    /// Maximum cutting feed the operator claims, mm/min. Not a measured spec.
    #[serde(default = "default_feed")]
    pub max_feed: f64,
    /// Configured rapid traverse, mm/min. Time estimates use this number as given.
    #[serde(default = "default_rapid")]
    pub rapid_rate: f64,
    /// Optional acceleration, mm/s². Used only for the conservative per-block estimate.
    #[serde(default)]
    pub acceleration: Option<f64>,
    #[serde(default = "default_clearance")]
    pub clearance_z: f64,
    /// `mm` or `inch`. Used only when the program never states G20/G21 before motion.
    #[serde(default = "default_units")]
    pub default_units: String,
    /// `absolute` or `incremental`.
    #[serde(default = "default_distance")]
    pub default_distance: String,
    /// Assumed start position in millimeters. Not read from a controller.
    #[serde(default)]
    pub start: [f64; 3],
    #[serde(default = "default_true")]
    pub require_spindle: bool,
    #[serde(default = "default_true")]
    pub flag_low_rapid: bool,
    /// Chord error budget for display sampling, millimeters.
    #[serde(default = "default_chord")]
    pub chord_tolerance: f64,
}

fn default_name() -> String {
    "Unnamed profile".into()
}
fn default_preset() -> String {
    "grbl".into()
}
fn default_x_max() -> f64 {
    300.0
}
fn default_y_max() -> f64 {
    180.0
}
fn default_z_min() -> f64 {
    -80.0
}
fn default_z_max() -> f64 {
    5.0
}
fn default_feed() -> f64 {
    2000.0
}
fn default_rapid() -> f64 {
    3000.0
}
fn default_clearance() -> f64 {
    5.0
}
fn default_units() -> String {
    "mm".into()
}
fn default_distance() -> String {
    "absolute".into()
}
fn default_true() -> bool {
    true
}
fn default_chord() -> f64 {
    0.05
}

impl Default for MachineConfig {
    fn default() -> Self {
        serde_json::from_str("{}").unwrap()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Plane {
    Xy,
    Xz,
    Yz,
}

impl Plane {
    pub fn as_str(self) -> &'static str {
        match self {
            Plane::Xy => "XY",
            Plane::Xz => "XZ",
            Plane::Yz => "YZ",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArcParam {
    pub plane: String,
    pub center: [f64; 3],
    pub radius: f64,
    pub start_angle: f64,
    pub sweep: f64,
    pub helix: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub id: u32,
    pub line: usize,
    /// `rapid` | `linear` | `arcCw` | `arcCcw`
    pub kind: String,
    pub start: [f64; 3],
    pub end: [f64; 3],
    pub length_mm: f64,
    pub feed_mm_min: Option<f64>,
    /// `rapid` | `perMinute` | `inverseTime`
    pub feed_mode: String,
    /// Raw inverse-time F (1/minutes) when feed mode is G93.
    pub inverse_time: Option<f64>,
    /// `off` | `cw` | `ccw`
    pub spindle: String,
    pub spindle_speed: Option<f64>,
    /// Distance/feed time for this block. None when the feed is unknown.
    pub time_s: Option<f64>,
    pub arc: Option<ArcParam>,
    /// Flat XYZ samples in millimeters, CNC coordinates (Z up), including endpoints.
    pub points: Vec<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub id: String,
    /// `error` | `warning` | `info`
    pub severity: String,
    pub line: Option<usize>,
    pub code: String,
    pub message: String,
    pub explanation: String,
    pub values: Vec<Kv>,
    pub suggestion: String,
    pub segment_id: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Kv {
    pub key: String,
    pub value: String,
}

impl Finding {
    pub fn new(
        severity: &str,
        line: Option<usize>,
        code: &str,
        message: impl Into<String>,
        explanation: impl Into<String>,
        suggestion: impl Into<String>,
    ) -> Self {
        Self {
            id: String::new(),
            severity: severity.into(),
            line,
            code: code.into(),
            message: message.into(),
            explanation: explanation.into(),
            values: Vec::new(),
            suggestion: suggestion.into(),
            segment_id: None,
        }
    }

    pub fn val(mut self, key: &str, value: impl ToString) -> Self {
        self.values.push(Kv {
            key: key.into(),
            value: value.to_string(),
        });
        self
    }

    pub fn seg(mut self, id: u32) -> Self {
        self.segment_id = Some(id);
        self
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandCount {
    pub code: String,
    pub count: u32,
    pub supported: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub rapid_distance_mm: f64,
    pub cut_distance_mm: f64,
    pub total_distance_mm: f64,
    pub motion_blocks: usize,
    pub error_count: usize,
    pub warning_count: usize,
    pub info_count: usize,
    pub unsupported_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeEstimate {
    /// Always an estimate. Never a measured cycle time.
    pub label: String,
    pub rapid_time_s: f64,
    pub cut_time_s: f64,
    pub total_time_s: f64,
    pub unestimated_segments: usize,
    /// Conservative model that fully stops at every block. None if acceleration is unset.
    pub trapezoid_total_s: Option<f64>,
    pub assumptions: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BBox {
    pub min: [f64; 3],
    pub max: [f64; 3],
    pub size: [f64; 3],
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DialectInfo {
    pub name: String,
    pub summary: String,
    pub supported: Vec<String>,
    pub not_simulated: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    pub engine_version: String,
    pub dialect: DialectInfo,
    pub truncated: bool,
    pub line_count: usize,
    pub segment_count: usize,
    pub render_simplified: bool,
    pub position_untrusted_from: Option<usize>,
    pub segments: Vec<Segment>,
    pub findings: Vec<Finding>,
    pub stats: Stats,
    pub time: TimeEstimate,
    pub commands: Vec<CommandCount>,
    pub bbox: BBox,
    pub assumptions: Vec<String>,
    /// Plain-text inspection report, one line per entry. No polyline data.
    pub report_lines: Vec<String>,
}

pub fn dialect() -> DialectInfo {
    DialectInfo {
        name: "Northline 3-axis mill subset (GRBL-style preset)".into(),
        summary: "A documented subset. Controllers disagree on startup modes, arc rules, feed units, and canned cycles. Anything not listed is flagged and not applied.".into(),
        supported: vec![
            "G0 rapid, G1 linear".into(),
            "G2 / G3 arcs in G17, G18, G19 with IJK (G90.1 / G91.1) or R".into(),
            "G20 inches, G21 millimeters".into(),
            "G90 absolute, G91 incremental positioning".into(),
            "G93 inverse-time feed, G94 units per minute".into(),
            "F feed, S spindle speed number".into(),
            "M3 / M4 / M5 spindle, M2 / M30 program end".into(),
            "Parentheses and semicolon comments, optional N line numbers, % delimiters".into(),
        ],
        not_simulated: vec![
            "Work coordinate systems (G54–G59), G52, G92, G10".into(),
            "G53 machine coordinates, G28 / G30 homing".into(),
            "Cutter compensation (G40–G42) and tool length (G43 / G49)".into(),
            "Canned cycles (G73, G80–G89) and drilling peck patterns".into(),
            "Tool changes (T / M6) — no tool assembly is modeled".into(),
            "Scaling, rotation, mirroring (G51, G68)".into(),
            "Dwell (G4) — excluded from the time estimate".into(),
            "Macros, parameters (#), subprograms, IF / WHILE / GOTO".into(),
            "Additional axes (A B C U V W), plasma, lathe, and 5-axis motion".into(),
            "Coolant (M7–M9) is noted and ignored".into(),
            "Corner blending, exact-stop, backlash, and servo following error".into(),
            "Stock, fixtures, tool holders, and collision geometry".into(),
        ],
    }
}

pub fn fmt_num(v: f64) -> String {
    if !v.is_finite() {
        return "non-finite".into();
    }
    let r = (v * 1000.0).round() / 1000.0;
    if (r - r.round()).abs() < 1e-9 {
        format!("{}", r as i64)
    } else {
        let s = format!("{r:.3}");
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}
