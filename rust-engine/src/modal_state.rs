//! Modal groups for the supported 3-axis subset.
//!
//! Startup values come from the machine profile and are marked unconfirmed
//! until the program states them. Northline does not pretend every controller
//! boots into the same modes.

use crate::types::Plane;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MotionMode {
    Rapid,
    Linear,
    ArcCw,
    ArcCcw,
}

impl MotionMode {
    pub fn kind(self) -> &'static str {
        match self {
            MotionMode::Rapid => "rapid",
            MotionMode::Linear => "linear",
            MotionMode::ArcCw => "arcCw",
            MotionMode::ArcCcw => "arcCcw",
        }
    }

    pub fn is_cut(self) -> bool {
        !matches!(self, MotionMode::Rapid)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Units {
    Mm,
    Inch,
}

impl Units {
    pub fn to_mm(self) -> f64 {
        match self {
            Units::Mm => 1.0,
            Units::Inch => 25.4,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Units::Mm => "mm",
            Units::Inch => "inch",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DistanceMode {
    Absolute,
    Incremental,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArcCenterMode {
    /// G91.1 — IJK offsets from the start point. This is the usual mill default.
    Incremental,
    /// G90.1 — IJK are absolute positions in the current length units.
    /// They are not affected by G91 on XYZ.
    Absolute,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FeedMode {
    /// G94 — F is length-units per minute, interpreted in the units active when the move runs.
    UnitsPerMin,
    /// G93 — F is inverse time: minutes to complete the block = 1/F.
    InverseTime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Spindle {
    Off,
    Cw,
    Ccw,
}

impl Spindle {
    pub fn as_str(self) -> &'static str {
        match self {
            Spindle::Off => "off",
            Spindle::Cw => "cw",
            Spindle::Ccw => "ccw",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ModalState {
    pub motion: MotionMode,
    pub motion_confirmed: bool,
    pub plane: Plane,
    pub plane_confirmed: bool,
    pub units: Units,
    pub units_confirmed: bool,
    pub distance: DistanceMode,
    pub distance_confirmed: bool,
    pub arc_centers: ArcCenterMode,
    pub arc_centers_confirmed: bool,
    pub feed_mode: FeedMode,
    pub feed_mode_confirmed: bool,
    pub feed_raw: Option<f64>,
    pub spindle: Spindle,
    pub spindle_rpm: Option<f64>,
    pub position: [f64; 3],
    pub position_trusted: bool,
    pub untrusted_from: Option<usize>,
    pub warned_units: bool,
    pub warned_distance: bool,
    pub warned_motion: bool,
    pub warned_plane: bool,
    pub unit_switch_pending_feed_note: bool,
}

pub fn initial_state(preset_grbl: bool, units: Units, distance: DistanceMode, start: [f64; 3]) -> ModalState {
    let _ = preset_grbl;
    ModalState {
        // GRBL powers up in G0 / G17 / G90 / G94 / G91.1 / G21. Those are
        // profile assumptions until the file states them.
        motion: MotionMode::Rapid,
        motion_confirmed: false,
        plane: Plane::Xy,
        plane_confirmed: false,
        units,
        units_confirmed: false,
        distance,
        distance_confirmed: false,
        arc_centers: ArcCenterMode::Incremental,
        arc_centers_confirmed: false,
        feed_mode: FeedMode::UnitsPerMin,
        feed_mode_confirmed: false,
        feed_raw: None,
        spindle: Spindle::Off,
        spindle_rpm: None,
        position: start,
        position_trusted: true,
        untrusted_from: None,
        warned_units: false,
        warned_distance: false,
        warned_motion: false,
        warned_plane: false,
        unit_switch_pending_feed_note: false,
    }
}
