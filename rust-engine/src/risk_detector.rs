//! Advisory checks. These are not collision detection and not a guarantee
//! that a program is safe to run.

use crate::arc_interpolation::arc_bounds;
use crate::geometry::dist3;
use crate::modal_state::{FeedMode, MotionMode, Spindle};
use crate::parser::g_key;
use crate::types::{fmt_num, Finding, MachineConfig, Segment};

#[derive(Clone, Copy)]
pub struct Unsupported {
    pub supported: bool,
    pub moves_axes: bool,
    pub severity: &'static str,
    pub message: &'static str,
}

pub fn classify_g(g: f64) -> Unsupported {
    let key = g_key(g);
    match key {
        Some(0 | 10 | 20 | 30 | 170 | 180 | 190 | 200 | 210 | 900 | 910 | 901 | 911 | 930 | 940) => {
            Unsupported {
                supported: true,
                moves_axes: false,
                severity: "info",
                message: "",
            }
        }
        Some(40) => Unsupported {
            supported: false,
            moves_axes: false,
            severity: "warning",
            message: "G4 dwell is not simulated and is omitted from the time estimate.",
        },
        Some(800) => Unsupported {
            supported: false,
            moves_axes: false,
            severity: "warning",
            message: "G80 canned-cycle cancel has nothing to cancel here. Canned cycles are not simulated.",
        },
        Some(k) if (380..=389).contains(&k) => Unsupported {
            supported: false,
            moves_axes: true,
            severity: "error",
            message: "Probing motion is not simulated. The position after this block is unknown.",
        },
        Some(280 | 281 | 300 | 301 | 530) => Unsupported {
            supported: false,
            moves_axes: true,
            severity: "error",
            message: "Homing or machine-coordinate motion is not simulated. The position after this block is unknown.",
        },
        Some(100 | 520 | 540 | 550 | 560 | 570 | 580 | 590 | 920 | 921 | 922 | 923) => Unsupported {
            supported: false,
            moves_axes: true,
            severity: "error",
            message: "Work offsets and coordinate-system changes are not applied. Later coordinates may not match the machine.",
        },
        Some(400 | 410 | 411 | 420 | 421) => Unsupported {
            supported: false,
            moves_axes: true,
            severity: "error",
            message: "Cutter compensation is not applied. The drawn path is the programmed centerline only when compensation is off.",
        },
        Some(430 | 431 | 490) => Unsupported {
            supported: false,
            moves_axes: true,
            severity: "error",
            message: "Tool length compensation is not applied.",
        },
        Some(k) if (730..=899).contains(&k) && k % 10 == 0 => Unsupported {
            supported: false,
            moves_axes: true,
            severity: "error",
            message: "Canned cycles are not expanded. No drilling or pecking motion was invented.",
        },
        Some(510 | 511 | 680 | 681 | 690) => Unsupported {
            supported: false,
            moves_axes: true,
            severity: "error",
            message: "Scaling or coordinate rotation is not applied.",
        },
        _ => Unsupported {
            supported: false,
            moves_axes: false,
            severity: "error",
            message: "This G-code is outside the supported 3-axis subset and was not applied.",
        },
    }
}

pub fn classify_m(m: i32) -> Unsupported {
    match m {
        2 | 30 => Unsupported {
            supported: true,
            moves_axes: false,
            severity: "info",
            message: "Program end. Later lines are still inspected, but a controller would have stopped.",
        },
        3 | 4 | 5 => Unsupported {
            supported: true,
            moves_axes: false,
            severity: "info",
            message: "",
        },
        0 | 1 => Unsupported {
            supported: false,
            moves_axes: false,
            severity: "info",
            message: "Program stop is not modeled. No pause was added to the time estimate.",
        },
        6 => Unsupported {
            supported: false,
            moves_axes: true,
            severity: "error",
            message: "Tool change is not simulated. No tool geometry is loaded.",
        },
        7 | 8 | 9 => Unsupported {
            supported: false,
            moves_axes: false,
            severity: "info",
            message: "Coolant commands are ignored.",
        },
        _ => Unsupported {
            supported: false,
            moves_axes: false,
            severity: "warning",
            message: "This M-code is not simulated.",
        },
    }
}

/// Letters whose presence means a side effect we refuse to invent.
pub fn letter_effect(letter: char) -> Option<Unsupported> {
    match letter {
        'A' | 'B' | 'C' | 'U' | 'V' | 'W' => Some(Unsupported {
            supported: false,
            moves_axes: true,
            severity: "error",
            message: "Additional axes are not simulated. The extra word was not applied.",
        }),
        'H' => Some(Unsupported {
            supported: false,
            moves_axes: true,
            severity: "error",
            message: "Tool-length offset word H is not applied.",
        }),
        'D' => Some(Unsupported {
            supported: false,
            moves_axes: true,
            severity: "error",
            message: "Cutter-compensation offset word D is not applied.",
        }),
        'P' | 'Q' | 'L' | 'E' | 'O' => Some(Unsupported {
            supported: false,
            moves_axes: false,
            severity: "warning",
            message: "This word is not part of the supported subset and was ignored.",
        }),
        _ => Some(Unsupported {
            supported: false,
            moves_axes: false,
            severity: "warning",
            message: "Unrecognized word. It was not applied.",
        }),
    }
}

pub fn check_limits(
    config: &MachineConfig,
    seg: &Segment,
    line: usize,
) -> Vec<Finding> {
    let mut out = Vec::new();
    let (min_p, max_p) = bounds_of(seg);
    let axes = [
        ("X", 0, config.x_min, config.x_max),
        ("Y", 1, config.y_min, config.y_max),
        ("Z", 2, config.z_min, config.z_max),
    ];
    for (name, idx, lo, hi) in axes {
        if max_p[idx] > hi + 1e-6 || min_p[idx] < lo - 1e-6 {
            out.push(
                Finding::new(
                    "error",
                    Some(line),
                    "TRAVEL",
                    format!("{name} leaves the configured travel envelope"),
                    "The check compares the interpreted path, in millimeters, with the travel numbers in the active profile. Those numbers are operator-entered, not a probed machine specification. Soft limits, homing, and work offsets are not modeled.",
                    "Widen the profile if the envelope is wrong, or fix the program coordinates. Do not treat a pass as proof the machine can reach the move.",
                )
                .val("axis", name)
                .val("pathMin", fmt_num(min_p[idx]))
                .val("pathMax", fmt_num(max_p[idx]))
                .val("limitMin", fmt_num(lo))
                .val("limitMax", fmt_num(hi))
                .seg(seg.id),
            );
        }
    }
    out
}

pub fn check_low_rapid(config: &MachineConfig, seg: &Segment, line: usize) -> Option<Finding> {
    if !config.flag_low_rapid || seg.kind != "rapid" {
        return None;
    }
    let xy = dist3(
        [seg.start[0], seg.start[1], 0.0],
        [seg.end[0], seg.end[1], 0.0],
    );
    if xy < 1e-6 {
        return None;
    }
    let z_min = seg.start[2].min(seg.end[2]);
    if z_min < config.clearance_z - 1e-6 {
        Some(
            Finding::new(
                "warning",
                Some(line),
                "LOW_RAPID",
                "Rapid move with XY travel below the configured clearance plane",
                "A rapid below the clearance height can strike a clamp, the stock, or a fixture. Northline only compares Z with the number you set. It does not know the stock shape.",
                "Raise Z before an XY rapid, or lower the clearance value if this plunge rapid is intentional.",
            )
            .val("clearanceZ", fmt_num(config.clearance_z))
            .val("minZ", fmt_num(z_min))
            .val("xyDistance", fmt_num(xy))
            .seg(seg.id),
        )
    } else {
        None
    }
}

pub fn check_feed(
    config: &MachineConfig,
    mode: MotionMode,
    feed_mode: FeedMode,
    feed_raw: Option<f64>,
    feed_mm_min: Option<f64>,
    length: f64,
    line: usize,
    seg_id: Option<u32>,
) -> Vec<Finding> {
    let mut out = Vec::new();
    if !mode.is_cut() || length < 1e-9 {
        return out;
    }
    match feed_mode {
        FeedMode::InverseTime => {
            match feed_raw {
                None => out.push(Finding::new(
                    "error",
                    Some(line),
                    "FEED_MISSING",
                    "G93 inverse-time move has no F word",
                    "In inverse time, F is required on every motion block and means 1/minutes for that block. Northline will not invent a feed.",
                    "Add an F word to this block or switch back to G94.",
                )),
                Some(f) if !f.is_finite() || f <= 0.0 => out.push(
                    Finding::new(
                        "error",
                        Some(line),
                        "FEED_INVALID",
                        "Inverse-time F must be a positive finite number",
                        "Time for this block cannot be estimated.",
                        "Replace F with a positive inverse-time value.",
                    )
                    .val("F", format!("{f}")),
                ),
                _ => {}
            }
        }
        FeedMode::UnitsPerMin => match feed_mm_min {
            None => out.push(Finding::new(
                "error",
                Some(line),
                "FEED_MISSING",
                "Cutting move has no feed rate",
                "G1/G2/G3 need an F modal. No cutting time was estimated for this block.",
                "Program F before or on the first cutting move.",
            )),
            Some(f) if f <= 0.0 || !f.is_finite() => out.push(
                Finding::new(
                    "error",
                    Some(line),
                    "FEED_INVALID",
                    "Feed rate is not a positive finite number",
                    "A zero or negative feed is not a valid cutting speed in this dialect.",
                    "Set F to a positive units-per-minute value.",
                )
                .val("feedMmMin", format!("{f}")),
            ),
            Some(f) if config.max_feed > 0.0 && f > config.max_feed + 1e-6 => out.push(
                Finding::new(
                    "warning",
                    Some(line),
                    "FEED_HIGH",
                    "Feed is above the configured maximum",
                    "The maximum is a profile setting, not a measured machine limit. The move is still drawn.",
                    "Lower F or raise the profile maximum if the machine can take this rate.",
                )
                .val("feedMmMin", fmt_num(f))
                .val("maxFeed", fmt_num(config.max_feed))
                .seg_opt(seg_id),
            ),
            Some(f) if f < 1.0 => out.push(
                Finding::new(
                    "warning",
                    Some(line),
                    "FEED_SLOW",
                    "Feed is below 1 mm/min",
                    "Very small feeds are sometimes a units mistake (an inch value left active after G21, or a missing decimal).",
                    "Confirm units and the F word.",
                )
                .val("feedMmMin", fmt_num(f))
                .seg_opt(seg_id),
            ),
            _ => {}
        },
    }
    out
}

pub fn check_spindle(spindle: Spindle, line: usize, seg_id: u32) -> Finding {
    Finding::new(
        "warning",
        Some(line),
        "SPINDLE_OFF",
        "Cutting move while the programmed spindle is off",
        "Northline only tracks M3, M4, and M5 in the file. An operator can start the spindle manually; this check cannot see that. It also cannot see a failed spindle.",
        "Insert M3 or M4 before cutting, or turn the check off in simulation settings if the machine spins up outside the program.",
    )
    .val("spindle", spindle.as_str())
    .seg(seg_id)
}

pub fn check_excessive(length: f64, limit: f64, line: usize, seg_id: u32) -> Option<Finding> {
    if length > limit {
        Some(
            Finding::new(
                "warning",
                Some(line),
                "LONG_MOVE",
                "Unusually long motion block",
                "The threshold is derived from the configured travel envelope (1.5× its diagonal, at least 500 mm). A long block is often a missed decimal or the wrong unit.",
                "Check the axis words and G20/G21.",
            )
            .val("lengthMm", fmt_num(length))
            .val("thresholdMm", fmt_num(limit))
            .seg(seg_id),
        )
    } else {
        None
    }
}

pub fn envelope_diagonal(config: &MachineConfig) -> f64 {
    let dx = (config.x_max - config.x_min).abs();
    let dy = (config.y_max - config.y_min).abs();
    let dz = (config.z_max - config.z_min).abs();
    (dx * dx + dy * dy + dz * dz).sqrt().max(500.0)
}

fn bounds_of(seg: &Segment) -> ([f64; 3], [f64; 3]) {
    if let Some(arc) = &seg.arc {
        arc_bounds(arc, seg.start, seg.end)
    } else {
        let mut min = seg.start;
        let mut max = seg.start;
        for k in 0..3 {
            min[k] = min[k].min(seg.end[k]);
            max[k] = max[k].max(seg.end[k]);
        }
        (min, max)
    }
}

trait SegOpt {
    fn seg_opt(self, id: Option<u32>) -> Self;
}

impl SegOpt for Finding {
    fn seg_opt(self, id: Option<u32>) -> Self {
        if let Some(id) = id {
            self.seg(id)
        } else {
            self
        }
    }
}
