//! Arc geometry for G2/G3.
//!
//! Plane UV axes follow the GRBL / NIST convention:
//! G17 XY, G18 XZ, G19 YZ. Clockwise is a negative sweep in that UV plane
//! (the same cross-product test GRBL uses). Helical motion is linear along
//! the remaining axis from the start coordinate to the programmed end.
//!
//! R-word arcs use the RS-274 rule: positive R is the minor arc (≤ 180°),
//! negative R is the major arc. A full circle cannot be specified with R.

use crate::geometry::{from_uvw, hypot2};
use crate::modal_state::ArcCenterMode;
use crate::types::{ArcParam, Plane};

const TAU: f64 = std::f64::consts::TAU;

#[derive(Debug)]
pub struct BuiltArc {
    pub param: ArcParam,
    pub length: f64,
    pub points: Vec<[f64; 3]>,
    pub radius_mismatch: f64,
    pub end_programmed: [f64; 3],
}

pub fn plane_axes(plane: Plane) -> (usize, usize, usize) {
    match plane {
        Plane::Xy => (0, 1, 2),
        Plane::Xz => (0, 2, 1),
        Plane::Yz => (1, 2, 0),
    }
}

pub fn build_arc(
    start: [f64; 3],
    end: [f64; 3],
    i_mm: Option<f64>,
    j_mm: Option<f64>,
    k_mm: Option<f64>,
    r_mm: Option<f64>,
    plane: Plane,
    cw: bool,
    center_mode: ArcCenterMode,
    chord_tol: f64,
    point_budget: &mut usize,
) -> Result<BuiltArc, String> {
    let has_ijk = i_mm.is_some() || j_mm.is_some() || k_mm.is_some();
    if r_mm.is_some() && has_ijk {
        return Err(
            "Both R and IJK are present. The block is ambiguous and was not interpolated."
                .into(),
        );
    }
    if r_mm.is_none() && !has_ijk {
        return Err("Arc block has neither IJK center offsets nor an R radius.".into());
    }

    let (au, av, aw) = plane_axes(plane);
    let u0 = start[au];
    let v0 = start[av];
    let w0 = start[aw];
    let u1 = end[au];
    let v1 = end[av];
    let w1 = end[aw];

    let (cu, cv, mismatch_note) = if let Some(r_word) = r_mm {
        if !r_word.is_finite() || r_word == 0.0 {
            return Err("Arc radius R must be a finite non-zero number.".into());
        }
        let (cu, cv) = center_from_radius(u0, v0, u1, v1, r_word, cw)?;
        (cu, cv, 0.0)
    } else {
        let (off_u, off_v, unused) = match plane {
            Plane::Xy => (i_mm, j_mm, k_mm),
            Plane::Xz => (i_mm, k_mm, j_mm),
            Plane::Yz => (j_mm, k_mm, i_mm),
        };
        if off_u.is_none() && off_v.is_none() {
            return Err(format!(
                "Arc in the {} plane needs center words for both circular axes.",
                plane.as_str()
            ));
        }
        let _ = unused;
        let iu = off_u.unwrap_or(0.0);
        let iv = off_v.unwrap_or(0.0);
        if !iu.is_finite() || !iv.is_finite() {
            return Err("Arc center offsets are not finite.".into());
        }
        let (cu, cv) = match center_mode {
            ArcCenterMode::Incremental => (u0 + iu, v0 + iv),
            ArcCenterMode::Absolute => (iu, iv),
        };
        (cu, cv, 0.0_f64)
    };
    let _ = mismatch_note;

    let r_start = hypot2(u0 - cu, v0 - cv);
    let r_end = hypot2(u1 - cu, v1 - cv);
    if r_start < 1e-9 {
        return Err("Arc radius is zero — the center coincides with the start point.".into());
    }
    let mismatch = (r_start - r_end).abs();
    let error_tol = 0.5_f64.max(0.01 * r_start);
    if mismatch > error_tol {
        return Err(format!(
            "Arc does not close: radius at start is {r_start:.4} mm but radius at the end point is {r_end:.4} mm (difference {mismatch:.4} mm)."
        ));
    }

    let chord = hypot2(u1 - u0, v1 - v0);
    let full_circle = chord <= 1e-6_f64.max(1e-5 * r_start);
    if full_circle && r_mm.is_some() {
        return Err("A full circle cannot be defined with R. Use IJK offsets.".into());
    }

    let sweep = if full_circle {
        if cw {
            -TAU
        } else {
            TAU
        }
    } else {
        signed_sweep(u0, v0, u1, v1, cu, cv, cw)
    };

    if !sweep.is_finite() {
        return Err("Arc sweep is not finite.".into());
    }
    // A computed sweep of ~0 with distinct endpoints means the center math failed.
    if !full_circle && sweep.abs() < 1e-9 {
        return Err("Arc sweep is zero.".into());
    }

    let radius = r_start;
    let start_angle = (v0 - cv).atan2(u0 - cu);
    let helix = w1 - w0;
    let linear = radius * sweep.abs();
    let length = (linear * linear + helix * helix).sqrt();

    let mut center = [0.0; 3];
    center[au] = cu;
    center[av] = cv;
    center[aw] = w0;

    let param = ArcParam {
        plane: plane.as_str().into(),
        center,
        radius,
        start_angle,
        sweep,
        helix,
    };

    let tol = if chord_tol.is_finite() && chord_tol > 1e-4 {
        chord_tol
    } else {
        0.05
    };
    let points = sample(&param, start, end, au, av, aw, tol, point_budget);

    Ok(BuiltArc {
        param,
        length,
        points,
        radius_mismatch: mismatch,
        end_programmed: end,
    })
}

fn center_from_radius(
    u0: f64,
    v0: f64,
    u1: f64,
    v1: f64,
    r_signed: f64,
    cw: bool,
) -> Result<(f64, f64), String> {
    let du = u1 - u0;
    let dv = v1 - v0;
    let dist = hypot2(du, dv);
    if dist < 1e-9 {
        return Err("R cannot describe a full circle (start and end are the same).".into());
    }
    let r = r_signed.abs();
    if dist > 2.0 * r + 1e-6 {
        return Err(format!(
            "Radius {r:.4} mm is smaller than half the chord ({:.4} mm).",
            dist / 2.0
        ));
    }
    let mx = (u0 + u1) * 0.5;
    let my = (v0 + v1) * 0.5;
    let h = (r * r - dist * dist / 4.0).max(0.0).sqrt();
    let ux = -dv / dist;
    let uy = du / dist;
    let candidates = [(mx + ux * h, my + uy * h), (mx - ux * h, my - uy * h)];
    let want_minor = r_signed > 0.0;
    let mut fallback = None;
    for (cu, cv) in candidates {
        let sweep = signed_sweep(u0, v0, u1, v1, cu, cv, cw);
        let mag = sweep.abs();
        fallback = Some((cu, cv, mag));
        let ok = if want_minor {
            mag <= std::f64::consts::PI + 1e-5
        } else {
            mag >= std::f64::consts::PI - 1e-5
        };
        if ok {
            return Ok((cu, cv));
        }
    }
    // Numerical edge: an exact semicircle matches both rules.
    if let Some((cu, cv, mag)) = fallback {
        if (mag - std::f64::consts::PI).abs() < 1e-4 {
            return Ok((cu, cv));
        }
    }
    Err("Could not place an arc center for this radius and direction.".into())
}

/// Signed sweep from start to end. Clockwise sweeps are negative.
/// A near-zero CCW angle becomes a full turn in the requested direction,
/// matching GRBL when the endpoints coincide.
pub fn signed_sweep(u0: f64, v0: f64, u1: f64, v1: f64, cu: f64, cv: f64, cw: bool) -> f64 {
    let r0u = u0 - cu;
    let r0v = v0 - cv;
    let r1u = u1 - cu;
    let r1v = v1 - cv;
    let cross = r0u * r1v - r0v * r1u;
    let dot = r0u * r1u + r0v * r1v;
    let mut ccw = cross.atan2(dot);
    if cw {
        if ccw >= -1e-12 {
            ccw -= TAU;
        }
    } else if ccw <= 1e-12 {
        ccw += TAU;
    }
    ccw
}

fn sample(
    arc: &ArcParam,
    start: [f64; 3],
    end: [f64; 3],
    au: usize,
    av: usize,
    aw: usize,
    tol: f64,
    budget: &mut usize,
) -> Vec<[f64; 3]> {
    let mut pts = Vec::new();
    pts.push(start);
    if *budget < 6 {
        pts.push(end);
        return pts;
    }
    let step = if arc.radius > tol {
        let ratio = (1.0 - (tol / arc.radius)).clamp(-1.0, 1.0);
        let ang = 2.0 * ratio.acos();
        if ang.is_finite() && ang > 1e-4 {
            ang
        } else {
            0.4
        }
    } else {
        0.4
    };
    let mut n = (arc.sweep.abs() / step).ceil() as usize;
    n = n.clamp(1, 256);
    // Leave room for the rest of the file.
    let affordable = (*budget / 3).saturating_sub(2).min(n);
    n = affordable.max(1);
    for i in 1..n {
        let t = i as f64 / n as f64;
        pts.push(point_at(arc, au, av, aw, start[aw], t));
        *budget = budget.saturating_sub(3);
    }
    pts.push(end);
    *budget = budget.saturating_sub(6);
    pts
}

pub fn point_at(arc: &ArcParam, au: usize, av: usize, aw: usize, w0: f64, t: f64) -> [f64; 3] {
    let t = t.clamp(0.0, 1.0);
    let ang = arc.start_angle + arc.sweep * t;
    let u = arc.center[au] + arc.radius * ang.cos();
    let v = arc.center[av] + arc.radius * ang.sin();
    let w = w0 + arc.helix * t;
    from_uvw(au, av, aw, u, v, w)
}

/// Axis-aligned bounds of the helical arc, including bulge extrema.
pub fn arc_bounds(arc: &ArcParam, start: [f64; 3], end: [f64; 3]) -> ([f64; 3], [f64; 3]) {
    let plane = match arc.plane.as_str() {
        "XZ" => Plane::Xz,
        "YZ" => Plane::Yz,
        _ => Plane::Xy,
    };
    let (au, av, aw) = plane_axes(plane);
    let mut min = start;
    let mut max = start;
    for p in [start, end] {
        for k in 0..3 {
            min[k] = min[k].min(p[k]);
            max[k] = max[k].max(p[k]);
        }
    }
    // Circular extrema at angles 0, π/2, π, 3π/2 if they lie on the sweep.
    let anchors = [0.0, std::f64::consts::FRAC_PI_2, std::f64::consts::PI, 3.0 * std::f64::consts::FRAC_PI_2];
    for anchor in anchors {
        if sweep_contains(arc.start_angle, arc.sweep, anchor) {
            let u = arc.center[au] + arc.radius * anchor.cos();
            let v = arc.center[av] + arc.radius * anchor.sin();
            // Helix is monotonic, so the third axis extreme is an endpoint.
            // Use start w for the circular sample; expand only u/v.
            let mut p = start;
            p[au] = u;
            p[av] = v;
            let _ = aw;
            for k in 0..3 {
                min[k] = min[k].min(p[k]);
                max[k] = max[k].max(p[k]);
            }
        }
    }
    // Helix endpoints already included.
    (min, max)
}

fn sweep_contains(start: f64, sweep: f64, angle: f64) -> bool {
    let mut delta = angle - start;
    if sweep >= 0.0 {
        delta = delta.rem_euclid(TAU);
        delta <= sweep + 1e-7
    } else {
        delta = -(-delta).rem_euclid(TAU);
        delta >= sweep - 1e-7
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quarter_turn_ccw_xy() {
        let mut budget = 10_000;
        // From (0,0) center offset I0 J5? Let's do center (0,0): start (5,0) end (0,5), G3.
        let built = build_arc(
            [5.0, 0.0, 0.0],
            [0.0, 5.0, 0.0],
            Some(-5.0),
            Some(0.0),
            None,
            None,
            Plane::Xy,
            false,
            ArcCenterMode::Incremental,
            0.05,
            &mut budget,
        )
        .unwrap();
        assert!((built.length - std::f64::consts::FRAC_PI_2 * 5.0).abs() < 1e-6);
        assert!(built.param.sweep > 0.0);
    }

    #[test]
    fn r_too_small() {
        let mut budget = 1000;
        let err = build_arc(
            [0.0, 0.0, 0.0],
            [10.0, 0.0, 0.0],
            None,
            None,
            None,
            Some(2.0),
            Plane::Xy,
            true,
            ArcCenterMode::Incremental,
            0.05,
            &mut budget,
        );
        assert!(err.is_err());
    }

    #[test]
    fn full_circle_length() {
        let mut budget = 10_000;
        let built = build_arc(
            [0.0, 0.0, 0.0],
            [0.0, 0.0, 0.0],
            Some(5.0),
            Some(0.0),
            None,
            None,
            Plane::Xy,
            false,
            ArcCenterMode::Incremental,
            0.05,
            &mut budget,
        )
        .unwrap();
        let expect = TAU * 5.0;
        assert!((built.length - expect).abs() < 1e-6, "{}", built.length);
    }

    #[test]
    fn g18_clockwise_midpoint_positive_z() {
        // Start X0 Z0, end X10 Z0, I5 K0 → center X5 Z0, CW semicircle through +Z.
        let mut budget = 10_000;
        let built = build_arc(
            [0.0, 0.0, 0.0],
            [10.0, 0.0, 0.0],
            Some(5.0),
            None,
            Some(0.0),
            None,
            Plane::Xz,
            true,
            ArcCenterMode::Incremental,
            0.02,
            &mut budget,
        )
        .unwrap();
        assert!((built.length - std::f64::consts::PI * 5.0).abs() < 1e-4);
        let (au, av, aw) = plane_axes(Plane::Xz);
        let mid = point_at(&built.param, au, av, aw, 0.0, 0.5);
        assert!((mid[0] - 5.0).abs() < 1e-3, "x {}", mid[0]);
        assert!(mid[2] > 4.0, "z {}", mid[2]);
    }
}
