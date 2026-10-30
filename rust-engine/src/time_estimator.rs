//! Machining-time estimates.
//!
//! Two models, both labeled as estimates:
//! - Distance / programmed speed. Rapids use the profile rapid rate and are
//!   treated as straight-line coordinated moves, not per-axis dogleg rapids.
//! - Optional per-block trapezoid that accelerates from a full stop to the
//!   programmed speed and stops again. Real controllers blend corners, so this
//!   number is intentionally conservative and usually slower than the machine.

use crate::types::{Finding, MachineConfig, Segment, TimeEstimate};

pub fn estimate(segments: &mut [Segment], config: &MachineConfig) -> (TimeEstimate, Vec<Finding>) {
    let mut findings = Vec::new();
    let mut rapid_t = 0.0;
    let mut cut_t = 0.0;
    let mut unestimated = 0usize;
    let mut trap = 0.0;
    let mut trap_ok = config.acceleration.filter(|a| a.is_finite() && *a > 0.0);
    let rapid_ok = config.rapid_rate.is_finite() && config.rapid_rate > 0.0;

    if !rapid_ok {
        findings.push(Finding::new(
            "error",
            None,
            "RAPID_RATE",
            "Rapid rate is missing or not positive, so rapid time is not estimated",
            "Northline will not substitute a guessed machine speed.",
            "Enter the rapid traverse you want used, in mm/min, on the profile.",
        ));
    }
    if let Some(a) = config.acceleration {
        if !a.is_finite() || a <= 0.0 {
            findings.push(Finding::new(
                "warning",
                None,
                "ACCEL",
                "Acceleration is set but not a positive number. The stop-start estimate was skipped.",
                "Only the distance/feed estimate is shown.",
                "Clear acceleration or enter a positive value in mm/s².",
            ));
            trap_ok = None;
        }
    }

    for seg in segments.iter_mut() {
        let is_rapid = seg.kind == "rapid";
        let block_time = if is_rapid {
            if rapid_ok {
                Some(seg.length_mm / config.rapid_rate * 60.0)
            } else {
                None
            }
        } else if seg.feed_mode == "inverseTime" {
            match seg.inverse_time {
                Some(f) if f.is_finite() && f > 0.0 => Some(60.0 / f),
                _ => None,
            }
        } else {
            match seg.feed_mm_min {
                Some(f) if f.is_finite() && f > 0.0 => Some(seg.length_mm / f * 60.0),
                _ => None,
            }
        };

        if let Some(t) = block_time {
            seg.time_s = Some(t);
            if is_rapid {
                rapid_t += t;
            } else {
                cut_t += t;
            }
            if let Some(a) = trap_ok {
                if seg.feed_mode == "inverseTime" {
                    trap += t;
                } else {
                    let speed = if is_rapid {
                        config.rapid_rate
                    } else {
                        seg.feed_mm_min.unwrap_or(0.0)
                    };
                    trap += trapezoid_seconds(seg.length_mm, speed, a);
                }
            }
        } else {
            seg.time_s = None;
            unestimated += 1;
        }
    }

    let mut assumptions = vec![
        "Times are estimates from the programmed path, not a control replay.".into(),
        "Cutting time uses path length divided by feed. Feed is mm/min after unit conversion.".into(),
        "G93 inverse time uses 60/F seconds for that block and ignores path length, which is what inverse time means.".into(),
        "Rapids use the profile rapid rate along the straight 3D path. Machines that rapid each axis independently can be faster.".into(),
        "Corner blending, look-ahead, spindle ramp, tool change, and dwell are not included.".into(),
        "A geometric playback in the viewer is not this time estimate and is not machine behavior.".into(),
    ];
    if trap_ok.is_some() {
        assumptions.push(
            "The stop-start figure accelerates from rest to the block speed and stops at the end of every block. It is a lower-bound style overestimate of time (the part usually finishes sooner). It is not the machine's trajectory planner.".into(),
        );
    } else {
        assumptions.push(
            "No acceleration figure is applied. The primary total is distance/speed only.".into(),
        );
    }
    if unestimated > 0 {
        assumptions.push(format!(
            "{unestimated} motion block(s) have no time because feed or rapid rate was missing or invalid. They are omitted, not filled with a guess."
        ));
    }

    (
        TimeEstimate {
            label: "estimate".into(),
            rapid_time_s: rapid_t,
            cut_time_s: cut_t,
            total_time_s: rapid_t + cut_t,
            unestimated_segments: unestimated,
            trapezoid_total_s: trap_ok.map(|_| trap),
            assumptions,
        },
        findings,
    )
}

fn trapezoid_seconds(distance_mm: f64, speed_mm_min: f64, accel_mm_s2: f64) -> f64 {
    if distance_mm <= 0.0 {
        return 0.0;
    }
    if speed_mm_min <= 0.0 || accel_mm_s2 <= 0.0 {
        return 0.0;
    }
    let v = speed_mm_min / 60.0;
    let d_both = v * v / accel_mm_s2;
    if distance_mm >= d_both {
        (2.0 * v / accel_mm_s2) + (distance_mm - d_both) / v
    } else {
        2.0 * (distance_mm / accel_mm_s2).sqrt()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trapezoid_has_cruise() {
        // 100 mm, 600 mm/min = 10 mm/s, accel 100 mm/s^2.
        // ramp distance each side v^2/2a = 0.5, both = 1 mm. Cruise 99 mm at 10 mm/s = 9.9 s.
        // ramps: 2 * v/a = 0.2 s. Total 10.1 s.
        let t = trapezoid_seconds(100.0, 600.0, 100.0);
        assert!((t - 10.1).abs() < 1e-6, "{t}");
    }
}
