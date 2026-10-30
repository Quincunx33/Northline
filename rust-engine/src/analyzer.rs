//! Pipeline: parse → interpret → time → report.

use crate::geometry::{max3, min3};
use crate::motion_interpreter::interpret;
use crate::parser::parse;
use crate::report_generator::report_lines;
use crate::time_estimator::estimate;
use crate::types::{
    dialect, fmt_num, Analysis, BBox, CommandCount, Finding, MachineConfig, Stats, ENGINE_VERSION,
};

const MAX_LINES: usize = 200_000;

pub fn inspect(source: &str, config: &MachineConfig) -> Analysis {
    let mut config = config.clone();
    let mut preface = normalize_config(&mut config);

    let mut blocks = parse(source);
    let line_count = blocks.len();
    let mut truncated = false;
    if blocks.len() > MAX_LINES {
        blocks.truncate(MAX_LINES);
        truncated = true;
        preface.push(Finding::new(
            "error",
            Some(MAX_LINES),
            "TRUNCATED",
            format!("Only the first {MAX_LINES} lines were inspected"),
            "Larger files are refused so the tab stays responsive. The rest of the program is unknown, including program-end and later risks.",
            "Split the program or inspect it in sections.",
        ));
    }

    let mut out = interpret(&blocks, &config);
    preface.append(&mut out.findings);
    out.findings = preface;
    if truncated {
        // already in preface
    }
    if out.checksum_lines > 0 {
        out.findings.push(
            Finding::new(
                "info",
                None,
                "CHECKSUM",
                "Block checksums were stripped and not verified",
                "A *nn checksum is a transport check. Northline does not recompute it.",
                "If a controller rejects the file, regenerate it from the CAM system.",
            )
            .val("lines", out.checksum_lines.to_string()),
        );
    }
    if out.percent_lines > 0 {
        out.findings.push(
            Finding::new(
                "info",
                None,
                "PERCENT",
                "Percent delimiters were ignored",
                "A line that is only % is a program wrapper on some controls. It does not move the tool.",
                "No action if the rest of the file parsed.",
            )
            .val("lines", out.percent_lines.to_string()),
        );
    }

    let (time, time_findings) = estimate(&mut out.segments, &config);
    out.findings.extend(time_findings);

    for (i, f) in out.findings.iter_mut().enumerate() {
        f.id = format!("F{i}");
    }

    let mut error_count = 0;
    let mut warning_count = 0;
    let mut info_count = 0;
    let mut unsupported = 0;
    for f in &out.findings {
        match f.severity.as_str() {
            "error" => error_count += 1,
            "warning" => warning_count += 1,
            _ => info_count += 1,
        }
        if f.code == "UNSUPPORTED" || f.code == "MACRO" {
            unsupported += 1;
        }
    }

    let mut rapid_d = 0.0;
    let mut cut_d = 0.0;
    let mut min = [f64::INFINITY; 3];
    let mut max = [f64::NEG_INFINITY; 3];
    if out.segments.is_empty() {
        min = config.start;
        max = config.start;
    }
    for seg in &out.segments {
        if seg.kind == "rapid" {
            rapid_d += seg.length_mm;
        } else {
            cut_d += seg.length_mm;
        }
        // Include samples so arc bulge is inside the reported bounds.
        let mut i = 0;
        while i + 2 < seg.points.len() {
            let p = [seg.points[i], seg.points[i + 1], seg.points[i + 2]];
            min = min3(min, p);
            max = max3(max, p);
            i += 3;
        }
        min = min3(min, seg.start);
        max = max3(max, seg.end);
        min = min3(min, seg.start);
    }
    if !min[0].is_finite() {
        min = [0.0; 3];
        max = [0.0; 3];
    }
    let size = [
        (max[0] - min[0]).abs(),
        (max[1] - min[1]).abs(),
        (max[2] - min[2]).abs(),
    ];

    let commands = out
        .commands
        .into_iter()
        .map(|(code, (count, supported))| CommandCount {
            code,
            count,
            supported,
        })
        .collect::<Vec<_>>();

    let stats = Stats {
        rapid_distance_mm: rapid_d,
        cut_distance_mm: cut_d,
        total_distance_mm: rapid_d + cut_d,
        motion_blocks: out.segments.len(),
        error_count,
        warning_count,
        info_count,
        unsupported_count: unsupported,
    };

    let mut analysis = Analysis {
        engine_version: ENGINE_VERSION.into(),
        dialect: dialect(),
        truncated,
        line_count,
        segment_count: out.segments.len(),
        render_simplified: out.render_simplified,
        position_untrusted_from: out.untrusted_from,
        segments: out.segments,
        findings: out.findings,
        stats,
        time,
        commands,
        bbox: BBox { min, max, size },
        assumptions: out.assumptions,
        report_lines: Vec::new(),
    };
    analysis.report_lines = report_lines(&config, &analysis);
    // Counts above didn't include nothing else. Report is derived.
    let _ = fmt_num(0.0);
    analysis
}

fn normalize_config(config: &mut MachineConfig) -> Vec<Finding> {
    let mut notes = Vec::new();
    for (name, lo, hi) in [
        ("X", &mut config.x_min, &mut config.x_max),
        ("Y", &mut config.y_min, &mut config.y_max),
        ("Z", &mut config.z_min, &mut config.z_max),
    ] {
        if !lo.is_finite() || !hi.is_finite() {
            notes.push(Finding::new(
                "error",
                None,
                "CONFIG",
                format!("{name} travel limits are not finite"),
                "Travel checks on this axis were left in place only if the other end is finite. Non-finite limits do not mean unlimited travel.",
                "Enter numeric millimeter limits.",
            ));
        } else if *lo > *hi {
            notes.push(
                Finding::new(
                    "info",
                    None,
                    "CONFIG",
                    format!("{name} limits were reversed and have been swapped"),
                    "The profile had the minimum above the maximum.",
                    "Save the profile so the order stays low to high.",
                )
                .val("min", format!("{lo}"))
                .val("max", format!("{hi}")),
            );
            std::mem::swap(lo, hi);
        }
    }
    if config.chord_tolerance < 0.01 || !config.chord_tolerance.is_finite() {
        config.chord_tolerance = 0.05;
    }
    if config.chord_tolerance > 2.0 {
        config.chord_tolerance = 2.0;
    }
    config.default_units = if config.default_units.eq_ignore_ascii_case("inch") {
        "inch".into()
    } else {
        "mm".into()
    };
    config.default_distance = if config.default_distance.eq_ignore_ascii_case("incremental") {
        "incremental".into()
    } else {
        "absolute".into()
    };
    notes
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> MachineConfig {
        let mut c = MachineConfig::default();
        c.x_min = 0.0;
        c.x_max = 300.0;
        c.y_min = 0.0;
        c.y_max = 180.0;
        c.z_min = -80.0;
        c.z_max = 20.0;
        c.rapid_rate = 3000.0;
        c.max_feed = 2000.0;
        c.clearance_z = 5.0;
        c.require_spindle = true;
        c.acceleration = None;
        c
    }

    fn codes(a: &Analysis) -> Vec<&str> {
        a.findings.iter().map(|f| f.code.as_str()).collect()
    }

    #[test]
    fn absolute_square_and_time() {
        let src = "G21\nG90\nG94\nM3 S1000\nG1 X10 F600\nG1 Y10\nG1 X0\nG1 Y0\nM5\nM2\n";
        let a = inspect(src, &cfg());
        assert_eq!(a.segment_count, 4);
        assert!((a.stats.cut_distance_mm - 40.0).abs() < 1e-6);
        // 40 mm at 600 mm/min = 4 seconds.
        assert!((a.time.cut_time_s - 4.0).abs() < 1e-6, "{}", a.time.cut_time_s);
        assert!(!codes(&a).contains(&"SPINDLE_OFF"));
    }

    #[test]
    fn incremental_and_inches() {
        let src = "G20\nG91\nG94\nM3\nG1 X1 F10\nG1 X1\n";
        let a = inspect(src, &cfg());
        assert!((a.segments.last().unwrap().end[0] - 50.8).abs() < 1e-6);
        // each inch at 10 in/min = 25.4 mm at 254 mm/min = 6 s. Two moves = 12 s.
        assert!((a.time.total_time_s - 12.0).abs() < 1e-4, "{}", a.time.total_time_s);
    }

    #[test]
    fn modal_g1_persists() {
        let src = "G21 G90 G94\nM3\nG1 X5 F100\nY5\n";
        let a = inspect(src, &cfg());
        assert_eq!(a.segment_count, 2);
        assert_eq!(a.segments[1].kind, "linear");
        assert!((a.segments[1].end[1] - 5.0).abs() < 1e-9);
    }

    #[test]
    fn semicircle_length() {
        let src = "G21 G90 G17 G94\nM3\nG0 X0 Y0\nG1 Z0 F100\nG2 X10 Y0 I5 J0 F100\n";
        let a = inspect(src, &cfg());
        let arc = a.segments.iter().find(|s| s.kind == "arcCw").unwrap();
        assert!((arc.length_mm - std::f64::consts::PI * 5.0).abs() < 1e-3, "{}", arc.length_mm);
    }

    #[test]
    fn invalid_arc_does_not_move() {
        let src = "G21 G90 G17\nG0 X0 Y0\nG2 X10 Y0 R2\nG1 X12 F100\n";
        let a = inspect(src, &cfg());
        assert!(codes(&a).contains(&"ARC"));
        // G1 still starts from X0 because the arc was rejected.
        let cut = a.segments.iter().find(|s| s.kind == "linear").unwrap();
        assert!(cut.start[0].abs() < 1e-6, "{}", cut.start[0]);
    }

    #[test]
    fn unsupported_cycle_is_an_error() {
        let src = "G21 G90\nG81 X10 Y10 Z-5 R2 F100\nG1 X12 F100\n";
        let a = inspect(src, &cfg());
        assert!(a.stats.error_count >= 1);
        assert!(codes(&a).iter().any(|c| *c == "UNSUPPORTED"));
        assert!(a.position_untrusted_from.is_some());
        // No invented hole.
        assert!(a.segments.iter().all(|s| s.kind != "arcCw" && s.kind != "arcCcw"));
    }

    #[test]
    fn travel_violation() {
        let src = "G21 G90\nG0 X400\n";
        let a = inspect(src, &cfg());
        assert!(codes(&a).contains(&"TRAVEL"));
    }

    #[test]
    fn malformed_and_low_rapid_and_spindle() {
        let src = "G21 G90\nG0 Z-2\nG0 X20\nG1 X30\nG1 X..\n";
        let a = inspect(src, &cfg());
        assert!(codes(&a).contains(&"LOW_RAPID"));
        assert!(codes(&a).contains(&"SPINDLE_OFF") || codes(&a).contains(&"FEED_MISSING"));
        assert!(codes(&a).contains(&"SYNTAX"));
    }

    #[test]
    fn rapid_time() {
        let src = "G21 G90\nG0 X60\n";
        let a = inspect(src, &cfg());
        // 60 mm at 3000 mm/min = 1.2 s
        assert!((a.time.rapid_time_s - 1.2).abs() < 1e-6, "{}", a.time.rapid_time_s);
    }

    #[test]
    fn g18_arc_and_full_circle() {
        let src = "G21 G90 G18 G94\nM3\nG0 X0 Y0 Z0\nG2 X10 Z0 I5 K0 F100\nG17\nG3 X10 Z0 I5 J0 F100\n";
        let a = inspect(src, &cfg());
        assert!(a.segments.iter().any(|s| s.kind == "arcCw"));
        assert!(a.segments.iter().any(|s| (s.length_mm - std::f64::consts::TAU * 5.0).abs() < 1e-2));
    }
}
