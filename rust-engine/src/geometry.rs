//! Small vector helpers. All stored toolpath coordinates are millimeters.

pub fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

pub fn dist3(a: [f64; 3], b: [f64; 3]) -> f64 {
    let d = sub(a, b);
    (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt()
}

pub fn hypot2(a: f64, b: f64) -> f64 {
    (a * a + b * b).sqrt()
}

pub fn finite3(p: [f64; 3]) -> bool {
    p.iter().all(|v| v.is_finite())
}

pub fn min3(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0].min(b[0]), a[1].min(b[1]), a[2].min(b[2])]
}

pub fn max3(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0].max(b[0]), a[1].max(b[1]), a[2].max(b[2])]
}

/// Map a plane-local (u, v, w) sample back to XYZ.
pub fn from_uvw(plane_u: usize, plane_v: usize, plane_w: usize, u: f64, v: f64, w: f64) -> [f64; 3] {
    let mut p = [0.0; 3];
    p[plane_u] = u;
    p[plane_v] = v;
    p[plane_w] = w;
    p
}

pub fn axis_of(p: [f64; 3], axis: usize) -> f64 {
    p[axis]
}
