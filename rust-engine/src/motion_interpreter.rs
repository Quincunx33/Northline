//! Modal interpreter. Produces millimeter toolpath segments.
//!
//! Block order used here (a documented simplification of RS-274, not a claim
//! that every controller matches it):
//! 1. Skip block-delete and macro lines (they are not executed).
//! 2. Apply plane, units, distance, arc-center, and feed-mode words.
//! 3. Apply F and S.
//! 4. Apply M words.
//! 5. Execute at most one motion using the modes now in effect.

use std::collections::BTreeMap;

use crate::arc_interpolation::build_arc;
use crate::geometry::{dist3, finite3};
use crate::modal_state::{
    initial_state, ArcCenterMode, DistanceMode, FeedMode, MotionMode, Spindle, Units, ModalState,
};
use crate::parser::{fmt_g, g_key, Block};
use crate::risk_detector::{
    check_excessive, check_feed, check_limits, check_low_rapid, check_spindle, classify_g,
    classify_m, envelope_diagonal, letter_effect,
};
use crate::types::{fmt_num, Finding, MachineConfig, Segment};

const POINT_BUDGET: usize = 180_000;

pub struct InterpretOut {
    pub segments: Vec<Segment>,
    pub findings: Vec<Finding>,
    pub commands: BTreeMap<String, (u32, bool)>,
    pub untrusted_from: Option<usize>,
    pub render_simplified: bool,
    pub assumptions: Vec<String>,
    pub checksum_lines: usize,
    pub percent_lines: usize,
}

pub fn interpret(blocks: &[Block], config: &MachineConfig) -> InterpretOut {
    let units = if config.default_units.eq_ignore_ascii_case("inch") {
        Units::Inch
    } else {
        Units::Mm
    };
    let distance = if config.default_distance.eq_ignore_ascii_case("incremental") {
        DistanceMode::Incremental
    } else {
        DistanceMode::Absolute
    };
    let mut state = initial_state(true, units, distance, config.start);
    let mut segments = Vec::new();
    let mut findings = Vec::new();
    let mut commands: BTreeMap<String, (u32, bool)> = BTreeMap::new();
    let mut budget = POINT_BUDGET;
    let mut simplified = false;
    let mut next_id: u32 = 1;
    let mut checksum_lines = 0;
    let mut percent_lines = 0;
    let mut noted_untrusted_motion = false;
    let long_limit = envelope_diagonal(config) * 1.5;

    let preset = if config.controller_preset.eq_ignore_ascii_case("grbl") {
        "GRBL-style"
    } else {
        "generic"
    };
    let mut assumptions = vec![
        format!(
            "{preset} startup assumption, used only where the file has not yet stated a mode: motion G0, plane G17, arc centers G91.1, feed mode G94, distance {}, units {}.",
            if distance == DistanceMode::Absolute { "G90 absolute" } else { "G91 incremental" },
            units.as_str()
        ),
        "Startup assumptions are not a substitute for reading a controller manual. A finding is raised if motion happens before the file confirms units or distance mode.".into(),
        format!(
            "Tool start is assumed at X{} Y{} Z{} mm. G90 coordinates are absolute in that same millimeter frame. No work offset (G54) is applied.",
            fmt_num(config.start[0]),
            fmt_num(config.start[1]),
            fmt_num(config.start[2])
        ),
        "Feed numbers are interpreted in the length units active when the move executes, not when F was first written.".into(),
        "Arc direction uses the GRBL plane-axis convention: clockwise is a negative sweep in G17 XY, G18 XZ, or G19 YZ.".into(),
    ];

    if !finite3(config.start)
        || config.start.iter().any(|v| v.abs() > 1.0e7)
    {
        findings.push(Finding::new(
            "error",
            None,
            "CONFIG",
            "Start position is not a usable finite coordinate",
            "The profile start was rejected. Inspection continued from 0,0,0.",
            "Set a finite start position in millimeters.",
        ));
        state.position = [0.0, 0.0, 0.0];
    }

    for block in blocks {
        if block.percent {
            percent_lines += 1;
            continue;
        }
        if block.checksum {
            checksum_lines += 1;
        }
        for err in &block.lex_errors {
            findings.push(Finding::new(
                "error",
                Some(block.line),
                "SYNTAX",
                err.clone(),
                "The rest of a partially readable block is still inspected. Nothing on this line is sent to a machine.",
                "Fix the line so a controller can parse it the same way.",
            ));
        }
        for note in &block.duplicate_notes {
            findings.push(Finding::new(
                "info",
                Some(block.line),
                "DUPLICATE_WORD",
                note.clone(),
                "RS-274 uses the last value when an axis word is repeated in one block.",
                "Keep a single word per axis.",
            ));
        }
        if block.block_delete {
            findings.push(Finding::new(
                "info",
                Some(block.line),
                "BLOCK_DELETE",
                "Block-delete line was not executed",
                "Lines beginning with / are skipped, which matches a controller running with block delete on. Northline does not offer the opposite switch.",
                "Remove the slash if the line should run.",
            ));
            continue;
        }
        if block.macro_hint {
            findings.push(Finding::new(
                "error",
                Some(block.line),
                "MACRO",
                "Parametric or control-flow code was not executed",
                "Words like #, IF, WHILE, GOTO, and subprograms can change every later coordinate. Northline does not evaluate them and did not apply this block.",
                "Post a fully expanded program, or inspect the expanded output from the CAM system.",
            ));
            mark_untrusted(&mut state, block.line);
            continue;
        }
        if block.empty && block.g.is_empty() && block.m.is_empty() && block.t.is_none() && block.other.is_empty()
        {
            continue;
        }

        let skip_g = apply_g_modes(block, &mut state, &mut findings, &mut commands);
        apply_feed_speed(block, &mut state, &mut findings);
        let skip_m = apply_m(block, &mut state, &mut findings, &mut commands);
        if let Some(t) = block.t {
            findings.push(
                Finding::new(
                    "warning",
                    Some(block.line),
                    "TOOL",
                    "Tool number is not modeled",
                    "Northline does not load a tool assembly, holder, or length. T does not move the toolpath.",
                    "Account for tool length outside this inspector.",
                )
                .val("T", fmt_num(t)),
            );
        }
        let mut skip_word = false;
        for (letter, value) in &block.other {
            if let Some(effect) = letter_effect(*letter) {
                findings.push(
                    Finding::new(
                        effect.severity,
                        Some(block.line),
                        "WORD",
                        format!("{letter}{}", fmt_num(*value)),
                        effect.message,
                        "Remove the word or post-process to the supported subset.",
                    )
                    .val("word", format!("{letter}{}", fmt_num(*value))),
                );
                if effect.moves_axes {
                    mark_untrusted(&mut state, block.line);
                    skip_word = true;
                }
            }
        }

        let has_motion_words = block.x.is_some()
            || block.y.is_some()
            || block.z.is_some()
            || block.i.is_some()
            || block.j.is_some()
            || block.k.is_some()
            || block.r.is_some();
        if skip_g || skip_m || skip_word {
            if has_motion_words {
                findings.push(Finding::new(
                    "error",
                    Some(block.line),
                    "MOTION_SUPPRESSED",
                    "Axis words on this block were not turned into a move",
                    "The block contains a command whose effect on position is unsupported. Executing the axis words as an ordinary G0/G1 would invent a path the controller will not take.",
                    "Expand or remove the unsupported command, then re-inspect.",
                ));
            }
            continue;
        }

        if let Some(seg) = execute_motion(
            block,
            &mut state,
            config,
            &mut findings,
            &mut budget,
            &mut simplified,
            &mut next_id,
            long_limit,
            &mut noted_untrusted_motion,
            &mut assumptions,
        ) {
            segments.push(seg);
        }
    }

    if segments.is_empty() {
        findings.push(Finding::new(
            "warning",
            None,
            "NO_MOTION",
            "No motion segments were produced",
            "The file may be empty, comments only, or entirely unsupported. Nothing was silently converted into a path.",
            "Load a 3-axis program that uses G0/G1/G2/G3.",
        ));
    }

    InterpretOut {
        segments,
        findings,
        commands,
        untrusted_from: state.untrusted_from,
        render_simplified: simplified,
        assumptions,
        checksum_lines,
        percent_lines,
    }
}

fn mark_untrusted(state: &mut ModalState, line: usize) {
    if state.position_trusted {
        state.position_trusted = false;
        state.untrusted_from = Some(line);
    }
}

fn bump(map: &mut BTreeMap<String, (u32, bool)>, code: &str, supported: bool) {
    let entry = map.entry(code.to_string()).or_insert((0, supported));
    entry.0 += 1;
    if !supported {
        entry.1 = false;
    }
}

fn apply_g_modes(
    block: &Block,
    state: &mut ModalState,
    findings: &mut Vec<Finding>,
    commands: &mut BTreeMap<String, (u32, bool)>,
) -> bool {
    let mut motion_hits = 0;
    let mut plane_hits = 0;
    let mut unit_hits = 0;
    let mut dist_hits = 0;
    let mut arc_hits = 0;
    let mut feed_hits = 0;
    let mut suppress_motion = false;
    for g in &block.g {
        let name = fmt_g(*g);
        let class = classify_g(*g);
        bump(commands, &name, class.supported);
        if !class.supported {
            findings.push(
                Finding::new(
                    class.severity,
                    Some(block.line),
                    "UNSUPPORTED",
                    format!("{name} is not applied"),
                    class.message,
                    "Delete it or expand it with a post processor this inspector understands. Do not assume the following coordinates are still valid.",
                )
                .val("code", name),
            );
            if class.moves_axes {
                mark_untrusted(state, block.line);
                suppress_motion = true;
            }
            continue;
        }
        match g_key(*g) {
            Some(0) => {
                motion_hits += 1;
                state.motion = MotionMode::Rapid;
                state.motion_confirmed = true;
            }
            Some(10) => {
                motion_hits += 1;
                state.motion = MotionMode::Linear;
                state.motion_confirmed = true;
            }
            Some(20) => {
                motion_hits += 1;
                state.motion = MotionMode::ArcCw;
                state.motion_confirmed = true;
            }
            Some(30) => {
                motion_hits += 1;
                state.motion = MotionMode::ArcCcw;
                state.motion_confirmed = true;
            }
            Some(170) => {
                plane_hits += 1;
                state.plane = crate::types::Plane::Xy;
                state.plane_confirmed = true;
            }
            Some(180) => {
                plane_hits += 1;
                state.plane = crate::types::Plane::Xz;
                state.plane_confirmed = true;
            }
            Some(190) => {
                plane_hits += 1;
                state.plane = crate::types::Plane::Yz;
                state.plane_confirmed = true;
            }
            Some(200) => {
                unit_hits += 1;
                if state.units != Units::Inch && state.feed_raw.is_some() {
                    state.unit_switch_pending_feed_note = true;
                }
                state.units = Units::Inch;
                state.units_confirmed = true;
            }
            Some(210) => {
                unit_hits += 1;
                if state.units != Units::Mm && state.feed_raw.is_some() {
                    state.unit_switch_pending_feed_note = true;
                }
                state.units = Units::Mm;
                state.units_confirmed = true;
            }
            Some(900) => {
                dist_hits += 1;
                state.distance = DistanceMode::Absolute;
                state.distance_confirmed = true;
            }
            Some(910) => {
                dist_hits += 1;
                state.distance = DistanceMode::Incremental;
                state.distance_confirmed = true;
            }
            Some(901) => {
                arc_hits += 1;
                state.arc_centers = ArcCenterMode::Absolute;
                state.arc_centers_confirmed = true;
            }
            Some(911) => {
                arc_hits += 1;
                state.arc_centers = ArcCenterMode::Incremental;
                state.arc_centers_confirmed = true;
            }
            Some(930) => {
                feed_hits += 1;
                state.feed_mode = FeedMode::InverseTime;
                state.feed_mode_confirmed = true;
            }
            Some(940) => {
                feed_hits += 1;
                state.feed_mode = FeedMode::UnitsPerMin;
                state.feed_mode_confirmed = true;
            }
            _ => {}
        }
    }
    if motion_hits > 1 || plane_hits > 1 || unit_hits > 1 || dist_hits > 1 || arc_hits > 1 || feed_hits > 1
    {
        findings.push(Finding::new(
            "info",
            Some(block.line),
            "MODAL_CONFLICT",
            "More than one code from the same modal group appears in this block",
            "The last code in the block wins, which is the usual RS-274 rule. Controllers that reject the block will not match this interpretation.",
            "Split the codes across blocks.",
        ));
    }
    suppress_motion
}

fn apply_feed_speed(block: &Block, state: &mut ModalState, findings: &mut Vec<Finding>) {
    if let Some(s) = block.s {
        if !s.is_finite() || s < 0.0 {
            findings.push(
                Finding::new(
                    "error",
                    Some(block.line),
                    "SPINDLE_SPEED",
                    "Spindle speed S is not a usable number",
                    "S was not stored. S does not by itself turn the spindle on.",
                    "Use a finite S greater than or equal to zero, and M3 or M4 to start.",
                )
                .val("S", format!("{s}")),
            );
        } else {
            state.spindle_rpm = Some(s);
        }
    }
    if let Some(f) = block.f {
        if !f.is_finite() {
            findings.push(Finding::new(
                "error",
                Some(block.line),
                "FEED_INVALID",
                "Feed word F is not finite",
                "The previous feed, if any, was left unchanged.",
                "Replace F with a finite number.",
            ));
        } else {
            state.feed_raw = Some(f);
            state.unit_switch_pending_feed_note = false;
        }
    }
}

fn apply_m(
    block: &Block,
    state: &mut ModalState,
    findings: &mut Vec<Finding>,
    commands: &mut BTreeMap<String, (u32, bool)>,
) -> bool {
    let mut suppress = false;
    for m in &block.m {
        let name = format!("M{m}");
        let class = classify_m(*m);
        bump(commands, &name, class.supported);
        if !class.message.is_empty() {
            findings.push(
                Finding::new(
                    if class.supported { "info" } else { class.severity },
                    Some(block.line),
                    "MCODE",
                    format!("{name}: {}", class.message),
                    "M-codes other than spindle and program-end do not change the drawn toolpath.",
                    "Confirm the code against the machine manual.",
                )
                .val("code", name),
            );
        } else if !class.supported {
            findings.push(
                Finding::new(
                    class.severity,
                    Some(block.line),
                    "UNSUPPORTED",
                    format!("{name} is not applied"),
                    class.message,
                    "Remove the code or accept that it has no effect in this inspector.",
                )
                .val("code", name),
            );
        }
        if class.moves_axes {
            mark_untrusted(state, block.line);
            suppress = true;
        }
        match *m {
            3 => state.spindle = Spindle::Cw,
            4 => state.spindle = Spindle::Ccw,
            5 => state.spindle = Spindle::Off,
            _ => {}
        }
    }
    suppress
}

fn execute_motion(
    block: &Block,
    state: &mut ModalState,
    config: &MachineConfig,
    findings: &mut Vec<Finding>,
    budget: &mut usize,
    simplified: &mut bool,
    next_id: &mut u32,
    long_limit: f64,
    noted_untrusted: &mut bool,
    _assumptions: &mut Vec<String>,
) -> Option<Segment> {
    let has_axis = block.x.is_some() || block.y.is_some() || block.z.is_some();
    let has_arc = block.i.is_some() || block.j.is_some() || block.k.is_some() || block.r.is_some();
    let arc_motion = matches!(state.motion, MotionMode::ArcCw | MotionMode::ArcCcw);
    if !arc_motion && has_arc {
        findings.push(Finding::new(
            "warning",
            Some(block.line),
            "ARC_WORDS",
            "I/J/K/R on a non-arc block were ignored",
            "Center words only apply to G2/G3. They were not used to move the tool.",
            "Remove them or put them on an arc block.",
        ));
    }
    let wants = if arc_motion {
        has_axis || has_arc
    } else {
        has_axis
    };
    if !wants {
        return None;
    }

    if !state.units_confirmed && !state.warned_units {
        state.warned_units = true;
        findings.push(
            Finding::new(
                "warning",
                Some(block.line),
                "UNITS_ASSUMED",
                format!("Units were not set before motion; using the profile default ({})", state.units.as_str()),
                "G20 and G21 are not universal defaults. The profile default is an assumption you can change. Inch/millimeter mistakes dominate real setup errors.",
                "Put G20 or G21 in the program header.",
            )
            .val("assumed", state.units.as_str()),
        );
    }
    if !state.distance_confirmed && !state.warned_distance {
        state.warned_distance = true;
        findings.push(Finding::new(
            "warning",
            Some(block.line),
            "DISTANCE_ASSUMED",
            format!(
                "Absolute/incremental mode was not set; using the profile default ({})",
                if state.distance == DistanceMode::Absolute { "absolute G90" } else { "incremental G91" }
            ),
            "A controller left in the other mode will cut a different part. This is an assumption, not a detection of the machine's current mode.",
            "State G90 or G91 before the first move.",
        ));
    }
    if !state.motion_confirmed && !state.warned_motion {
        state.warned_motion = true;
        findings.push(Finding::new(
            "warning",
            Some(block.line),
            "MOTION_ASSUMED",
            "Motion mode was not set; using the profile startup mode (G0 rapid)",
            "Some controllers reject axis words until a motion code is seen. Northline applies the profile startup mode and says so.",
            "Write G0 or G1 explicitly.",
        ));
    }
    if !state.plane_confirmed && !state.warned_plane && arc_motion {
        state.warned_plane = true;
        findings.push(Finding::new(
            "info",
            Some(block.line),
            "PLANE_ASSUMED",
            "Arc plane was not set; using G17 XY",
            "G18 and G19 programs must state the plane. The XY default is a profile assumption.",
            "Add G17, G18, or G19.",
        ));
    }
    if state.unit_switch_pending_feed_note {
        state.unit_switch_pending_feed_note = false;
        findings.push(Finding::new(
            "warning",
            Some(block.line),
            "FEED_UNITS",
            "Feed was not restated after a unit change",
            "Northline reads F in the units active on the move. A controller that converts the physical feed instead will not match this time estimate.",
            "Write F again after G20 or G21.",
        ));
    }
    if !state.position_trusted && !*noted_untrusted {
        *noted_untrusted = true;
        findings.push(Finding::new(
            "warning",
            Some(block.line),
            "POSITION_UNCERTAIN",
            "This move is drawn from the last interpreted coordinate, which may no longer match the machine",
            "An earlier unsupported command can change position, offsets, or compensation. Later geometry is still drawn so you can see the programmed words, but it is not a prediction of where the machine will be.",
            "Remove unsupported codes before trusting the preview.",
        ));
    }

    let scale = state.units.to_mm();
    let mut target = state.position;
    let axis_words = [block.x, block.y, block.z];
    for (idx, word) in axis_words.iter().enumerate() {
        if let Some(v) = word {
            if !v.is_finite() {
                findings.push(
                    Finding::new(
                        "error",
                        Some(block.line),
                        "NON_FINITE",
                        "Axis word is not a finite number",
                        "The move was not applied. Position stays where it was.",
                        "Replace the word with a finite coordinate.",
                    )
                    .val("axis", ["X", "Y", "Z"][idx])
                    .val("value", format!("{v}")),
                );
                return None;
            }
            let mm = v * scale;
            target[idx] = match state.distance {
                DistanceMode::Absolute => mm,
                DistanceMode::Incremental => state.position[idx] + mm,
            };
        }
    }
    if !finite3(target) {
        findings.push(Finding::new(
            "error",
            Some(block.line),
            "NON_FINITE",
            "Computed target is not finite",
            "The move was not applied.",
            "Check the axis words and unit mode.",
        ));
        return None;
    }

    let feed_mm = match state.feed_mode {
        FeedMode::UnitsPerMin => state.feed_raw.filter(|f| f.is_finite()).map(|f| f * scale),
        FeedMode::InverseTime => None,
    };
    let inverse = match state.feed_mode {
        FeedMode::InverseTime => state.feed_raw,
        FeedMode::UnitsPerMin => None,
    };

    let start = state.position;
    let built = if arc_motion {
        warn_unused_center(block, state, findings);
        let i_mm = block.i.map(|v| v * scale);
        let j_mm = block.j.map(|v| v * scale);
        let k_mm = block.k.map(|v| v * scale);
        let r_mm = block.r.map(|v| v * scale);
        let before = *budget;
        match build_arc(
            start,
            target,
            i_mm,
            j_mm,
            k_mm,
            r_mm,
            state.plane,
            state.motion == MotionMode::ArcCw,
            state.arc_centers,
            config.chord_tolerance,
            budget,
        ) {
            Ok(arc) => {
                if *budget < before / 2 && *budget < 1000 {
                    *simplified = true;
                }
                let warn_tol = 0.05_f64.max(0.002 * arc.param.radius);
                if arc.radius_mismatch > warn_tol {
                    findings.push(
                        Finding::new(
                            "warning",
                            Some(block.line),
                            "ARC_TOLERANCE",
                            "Arc end radius does not exactly match the start radius",
                            "The path uses the start radius and still ends on the programmed point. A controller may alarm instead of blending this.",
                            "Regenerate the arc or tighten the CAM tolerance.",
                        )
                        .val("mismatchMm", fmt_num(arc.radius_mismatch))
                        .val("radiusMm", fmt_num(arc.param.radius)),
                    );
                }
                Some((arc.length, arc.points, Some(arc.param)))
            }
            Err(msg) => {
                findings.push(Finding::new(
                    "error",
                    Some(block.line),
                    "ARC",
                    "Invalid arc geometry",
                    msg,
                    "Check the plane, the center mode (G90.1/G91.1), and the IJK or R words. The tool position was not moved.",
                ));
                return None;
            }
        }
    } else {
        let length = dist3(start, target);
        if length < 1e-6 {
            findings.push(Finding::new(
                "info",
                Some(block.line),
                "ZERO_LENGTH",
                "Motion block does not move the tool",
                "Start and end are the same within 0.000001 mm. No segment was added.",
                "Delete the block if it is accidental.",
            ));
            state.position = target;
            return None;
        }
        let points = vec![start, target];
        *budget = budget.saturating_sub(6);
        Some((length, points, None))
    };

    let (length, points, arc) = built?;
    if *budget < 64 {
        *simplified = true;
    }

    let id = *next_id;
    *next_id += 1;
    let mut flat = Vec::with_capacity(points.len() * 3);
    for p in &points {
        flat.extend_from_slice(p);
    }
    let seg = Segment {
        id,
        line: block.line,
        kind: state.motion.kind().into(),
        start,
        end: target,
        length_mm: length,
        feed_mm_min: if state.motion.is_cut() { feed_mm } else { None },
        feed_mode: if state.motion.is_cut() {
            match state.feed_mode {
                FeedMode::UnitsPerMin => "perMinute",
                FeedMode::InverseTime => "inverseTime",
            }
        } else {
            "rapid"
        }
        .into(),
        inverse_time: if state.motion.is_cut() { inverse } else { None },
        spindle: state.spindle.as_str().into(),
        spindle_speed: state.spindle_rpm,
        time_s: None,
        arc,
        points: flat,
    };

    findings.extend(check_feed(
        config,
        state.motion,
        state.feed_mode,
        state.feed_raw,
        feed_mm,
        length,
        block.line,
        Some(id),
    ));
    if state.motion.is_cut() && config.require_spindle && state.spindle == Spindle::Off {
        findings.push(check_spindle(state.spindle, block.line, id));
    }
    findings.extend(check_limits(config, &seg, block.line));
    if let Some(f) = check_low_rapid(config, &seg, block.line) {
        findings.push(f);
    }
    if let Some(f) = check_excessive(length, long_limit, block.line, id) {
        findings.push(f);
    }

    state.position = target;
    Some(seg)
}

fn warn_unused_center(block: &Block, state: &ModalState, findings: &mut Vec<Finding>) {
    let (letter, value) = match state.plane {
        crate::types::Plane::Xy => ('K', block.k),
        crate::types::Plane::Xz => ('J', block.j),
        crate::types::Plane::Yz => ('I', block.i),
    };
    if let Some(v) = value {
        if v.abs() > 1e-9 {
            findings.push(
                Finding::new(
                    "warning",
                    Some(block.line),
                    "ARC_WORD",
                    format!("{letter} is not a center offset in the {} plane and was ignored", state.plane.as_str()),
                    "Helix height comes from the linear axis word (Z in G17, Y in G18, X in G19), not from the unused center letter.",
                    "Remove the unused center word to avoid controller-specific rejection.",
                )
                .val("word", format!("{letter}{}", fmt_num(v))),
            );
        }
    }
}
