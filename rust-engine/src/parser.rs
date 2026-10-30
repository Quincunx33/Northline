//! Groups lexed words into blocks. Last duplicate axis word wins.

use crate::lexer::{lex, LexLine};

#[derive(Debug, Clone)]
pub struct Block {
    pub line: usize,
    pub raw: String,
    pub comment: Option<String>,
    pub g: Vec<f64>,
    pub m: Vec<i32>,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub z: Option<f64>,
    pub i: Option<f64>,
    pub j: Option<f64>,
    pub k: Option<f64>,
    pub r: Option<f64>,
    pub f: Option<f64>,
    pub s: Option<f64>,
    pub n: Option<f64>,
    pub t: Option<f64>,
    pub other: Vec<(char, f64)>,
    pub lex_errors: Vec<String>,
    pub duplicate_notes: Vec<String>,
    pub block_delete: bool,
    pub percent: bool,
    pub checksum: bool,
    pub macro_hint: bool,
    pub empty: bool,
}

pub fn parse(source: &str) -> Vec<Block> {
    lex(source).into_iter().map(block_from_line).collect()
}

fn block_from_line(line: LexLine) -> Block {
    let mut b = Block {
        line: line.line_no,
        raw: line.raw,
        comment: line.comment,
        g: Vec::new(),
        m: Vec::new(),
        x: None,
        y: None,
        z: None,
        i: None,
        j: None,
        k: None,
        r: None,
        f: None,
        s: None,
        n: None,
        t: None,
        other: Vec::new(),
        lex_errors: line.errors,
        duplicate_notes: Vec::new(),
        block_delete: line.block_delete,
        percent: line.percent,
        checksum: line.checksum,
        macro_hint: line.macro_hint,
        empty: line.words.is_empty() && !line.percent,
    };
    for w in line.words {
        let assign = |slot: &mut Option<f64>, notes: &mut Vec<String>, letter: char, value: f64| {
            if slot.is_some() {
                notes.push(format!(
                    "{letter} was repeated; the last value in the block is used"
                ));
            }
            *slot = Some(value);
        };
        match w.letter {
            'G' => b.g.push(w.value),
            'M' => {
                if (w.value - w.value.round()).abs() > 1e-6 || w.value < 0.0 || w.value > 1000.0 {
                    b.lex_errors
                        .push(format!("M value {} is not an integer code", w.value));
                } else {
                    b.m.push(w.value.round() as i32);
                }
            }
            'X' => assign(&mut b.x, &mut b.duplicate_notes, 'X', w.value),
            'Y' => assign(&mut b.y, &mut b.duplicate_notes, 'Y', w.value),
            'Z' => assign(&mut b.z, &mut b.duplicate_notes, 'Z', w.value),
            'I' => assign(&mut b.i, &mut b.duplicate_notes, 'I', w.value),
            'J' => assign(&mut b.j, &mut b.duplicate_notes, 'J', w.value),
            'K' => assign(&mut b.k, &mut b.duplicate_notes, 'K', w.value),
            'R' => assign(&mut b.r, &mut b.duplicate_notes, 'R', w.value),
            'F' => assign(&mut b.f, &mut b.duplicate_notes, 'F', w.value),
            'S' => assign(&mut b.s, &mut b.duplicate_notes, 'S', w.value),
            'N' => assign(&mut b.n, &mut b.duplicate_notes, 'N', w.value),
            'T' => assign(&mut b.t, &mut b.duplicate_notes, 'T', w.value),
            other => b.other.push((other, w.value)),
        }
    }
    b
}

/// Tenth-millimeter style key: G90.1 → 901, G1 → 10, G0 → 0.
pub fn g_key(g: f64) -> Option<i32> {
    if !g.is_finite() {
        return None;
    }
    let scaled = (g * 10.0).round();
    if (scaled - g * 10.0).abs() > 1e-4 {
        return None;
    }
    Some(scaled as i32)
}

pub fn fmt_g(g: f64) -> String {
    match g_key(g) {
        Some(k) => {
            if k % 10 == 0 {
                format!("G{}", k / 10)
            } else if k < 0 {
                format!("G{:.1}", g)
            } else {
                format!("G{}.{}", k / 10, k.abs() % 10)
            }
        }
        None => format!("G{g}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn last_axis_wins() {
        let blocks = parse("G1 X1 X5 Y2");
        assert_eq!(blocks[0].x, Some(5.0));
        assert_eq!(blocks[0].y, Some(2.0));
        assert!(!blocks[0].duplicate_notes.is_empty());
    }
}
