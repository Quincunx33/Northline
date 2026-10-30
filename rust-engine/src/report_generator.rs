//! Plain-text inspection report. The UI turns these lines into PDF, and the
//! structured analysis into JSON and CSV. No claim of certification.

use crate::types::{fmt_num, Analysis, MachineConfig};

pub fn report_lines(config: &MachineConfig, analysis: &Analysis) -> Vec<String> {
    let mut lines = Vec::new();
    lines.push("NORTHLINE G-CODE INSPECTION REPORT".into());
    lines.push("Advisory only. This is not a machine-vendor simulation and it does not certify a program.".into());
    lines.push("Verify with the manufacturer’s approved simulation, setup, and safety procedure before cutting.".into());
    lines.push(String::new());
    lines.push(format!("Engine {}", analysis.engine_version));
    lines.push(format!("Dialect: {}", analysis.dialect.name));
    lines.push(analysis.dialect.summary.clone());
    lines.push(String::new());
    lines.push(format!("Profile: {}", config.name));
    lines.push(format!("Controller preset: {}", config.controller_preset));
    lines.push(format!(
        "Travel mm: X {}..{}  Y {}..{}  Z {}..{}",
        fmt_num(config.x_min),
        fmt_num(config.x_max),
        fmt_num(config.y_min),
        fmt_num(config.y_max),
        fmt_num(config.z_min),
        fmt_num(config.z_max)
    ));
    lines.push(format!(
        "Rapid {} mm/min, max feed {} mm/min, clearance Z {} mm",
        fmt_num(config.rapid_rate),
        fmt_num(config.max_feed),
        fmt_num(config.clearance_z)
    ));
    if let Some(a) = config.acceleration {
        lines.push(format!("Acceleration setting {} mm/s^2 (stop-start estimate only)", fmt_num(a)));
    } else {
        lines.push("Acceleration: not set".into());
    }
    lines.push(String::new());
    lines.push("Assumptions".into());
    for a in &analysis.assumptions {
        lines.push(format!("- {a}"));
    }
    for a in &analysis.time.assumptions {
        lines.push(format!("- {a}"));
    }
    lines.push(String::new());
    lines.push("Toolpath".into());
    lines.push(format!("Lines read: {}", analysis.line_count));
    lines.push(format!("Motion segments: {}", analysis.segment_count));
    lines.push(format!("Rapid distance: {} mm", fmt_num(analysis.stats.rapid_distance_mm)));
    lines.push(format!("Cutting distance: {} mm", fmt_num(analysis.stats.cut_distance_mm)));
    lines.push(format!("Total distance: {} mm", fmt_num(analysis.stats.total_distance_mm)));
    lines.push(format!(
        "Bounds mm: X {}..{}  Y {}..{}  Z {}..{}",
        fmt_num(analysis.bbox.min[0]),
        fmt_num(analysis.bbox.max[0]),
        fmt_num(analysis.bbox.min[1]),
        fmt_num(analysis.bbox.max[1]),
        fmt_num(analysis.bbox.min[2]),
        fmt_num(analysis.bbox.max[2])
    ));
    lines.push(format!(
        "Size mm: {} × {} × {}",
        fmt_num(analysis.bbox.size[0]),
        fmt_num(analysis.bbox.size[1]),
        fmt_num(analysis.bbox.size[2])
    ));
    if analysis.render_simplified {
        lines.push("Display sampling was reduced for size. Lengths still use analytic arc math.".into());
    }
    if analysis.truncated {
        lines.push("The file was truncated at the line cap. Later blocks were not read.".into());
    }
    if let Some(line) = analysis.position_untrusted_from {
        lines.push(format!("Position is uncertain from line {line} onward."));
    }
    lines.push(String::new());
    lines.push("Time estimate".into());
    lines.push(format!("Rapid: {} s", fmt_secs(analysis.time.rapid_time_s)));
    lines.push(format!("Cutting: {} s", fmt_secs(analysis.time.cut_time_s)));
    lines.push(format!("Total (distance/speed): {} s", fmt_secs(analysis.time.total_time_s)));
    if let Some(t) = analysis.time.trapezoid_total_s {
        lines.push(format!("Stop-start acceleration model: {} s", fmt_secs(t)));
    }
    lines.push(format!(
        "Blocks with no time estimate: {}",
        analysis.time.unestimated_segments
    ));
    lines.push(String::new());
    lines.push("Commands".into());
    for c in &analysis.commands {
        lines.push(format!(
            "{} × {} ({})",
            c.code,
            c.count,
            if c.supported { "supported" } else { "not supported" }
        ));
    }
    lines.push(String::new());
    lines.push(format!(
        "Findings: {} error, {} warning, {} info",
        analysis.stats.error_count, analysis.stats.warning_count, analysis.stats.info_count
    ));
    for f in &analysis.findings {
        let at = f.line.map(|n| format!("line {n}")).unwrap_or_else(|| "file".into());
        lines.push(format!("[{}] {} {} — {}", f.severity, f.code, at, f.message));
        if !f.explanation.is_empty() {
            lines.push(format!("    {}", f.explanation));
        }
        if !f.suggestion.is_empty() {
            lines.push(format!("    Suggestion: {}", f.suggestion));
        }
    }
    lines.push(String::new());
    lines.push("Not simulated".into());
    for item in &analysis.dialect.not_simulated {
        lines.push(format!("- {item}"));
    }
    lines
}

fn fmt_secs(s: f64) -> String {
    if !s.is_finite() {
        return "n/a".into();
    }
    format!("{:.2}", s)
}
