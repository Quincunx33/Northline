//! Line-oriented G-code lexer. Does not execute anything.

#[derive(Debug, Clone)]
pub struct Word {
    pub letter: char,
    pub value: f64,
}

#[derive(Debug, Clone)]
pub struct LexLine {
    pub line_no: usize,
    pub raw: String,
    pub words: Vec<Word>,
    pub comment: Option<String>,
    pub block_delete: bool,
    pub percent: bool,
    pub checksum: bool,
    pub macro_hint: bool,
    pub errors: Vec<String>,
}

pub fn lex(source: &str) -> Vec<LexLine> {
    let mut source = source;
    if let Some(stripped) = source.strip_prefix('\u{feff}') {
        source = stripped;
    }
    source
        .split('\n')
        .enumerate()
        .map(|(idx, raw)| lex_line(idx + 1, raw.trim_end_matches('\r')))
        .collect()
}

fn lex_line(line_no: usize, raw_in: &str) -> LexLine {
    let raw = raw_in.to_string();
    let trimmed = raw_in.trim();
    if trimmed.is_empty() {
        return LexLine {
            line_no,
            raw,
            words: Vec::new(),
            comment: None,
            block_delete: false,
            percent: false,
            checksum: false,
            macro_hint: false,
            errors: Vec::new(),
        };
    }
    if trimmed == "%" {
        return LexLine {
            line_no,
            raw,
            words: Vec::new(),
            comment: None,
            block_delete: false,
            percent: true,
            checksum: false,
            macro_hint: false,
            errors: Vec::new(),
        };
    }

    let mut block_delete = false;
    let mut body = trimmed;
    if let Some(rest) = body.strip_prefix('/') {
        block_delete = true;
        body = rest.trim();
    }

    let (code, comment, mut errors) = strip_comments(body);
    let mut macro_hint = false;
    let upper = code.to_ascii_uppercase();
    if upper.contains('#')
        || upper.contains("WHILE")
        || upper.contains("GOTO")
        || upper.contains(" IF")
        || upper.starts_with("IF")
        || upper.contains("THEN")
        || upper.contains("SUB")
    {
        macro_hint = true;
    }

    let (code, checksum) = strip_checksum(&code);

    let mut words = Vec::new();
    let chars: Vec<char> = code.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        if c == '#' {
            macro_hint = true;
            errors.push("Parameter word '#' is not executed".into());
            i += 1;
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                i += 1;
            }
            continue;
        }
        if !c.is_ascii_alphabetic() {
            errors.push(format!("Unexpected character '{c}'"));
            i += 1;
            continue;
        }
        let letter = c.to_ascii_uppercase();
        i += 1;
        let start = i;
        if i < chars.len() && (chars[i] == '+' || chars[i] == '-') {
            i += 1;
        }
        let mut saw_digit = false;
        let mut saw_dot = false;
        let num_body = i;
        while i < chars.len() {
            let ch = chars[i];
            if ch.is_ascii_digit() {
                saw_digit = true;
                i += 1;
            } else if ch == '.' && !saw_dot {
                saw_dot = true;
                i += 1;
            } else {
                break;
            }
        }
        if i < chars.len() && (chars[i] == 'e' || chars[i] == 'E') && saw_digit {
            let e_pos = i;
            i += 1;
            if i < chars.len() && (chars[i] == '+' || chars[i] == '-') {
                i += 1;
            }
            let exp_start = i;
            while i < chars.len() && chars[i].is_ascii_digit() {
                i += 1;
            }
            if i == exp_start {
                i = e_pos;
            }
        }
        if !saw_digit {
            errors.push(format!("Word {letter} is missing a number"));
            if i == num_body {
                // avoid stalling on a bare letter
            }
            continue;
        }
        let num_str: String = chars[start..i].iter().collect();
        match num_str.parse::<f64>() {
            Ok(v) if v.is_finite() => words.push(Word { letter, value: v }),
            _ => errors.push(format!("Invalid number '{num_str}' after {letter}")),
        }
    }

    LexLine {
        line_no,
        raw,
        words,
        comment,
        block_delete,
        percent: false,
        checksum,
        macro_hint,
        errors,
    }
}

fn strip_comments(input: &str) -> (String, Option<String>, Vec<String>) {
    let chars: Vec<char> = input.chars().collect();
    let mut code = String::new();
    let mut comments: Vec<String> = Vec::new();
    let mut errors = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == ';' {
            let rest: String = chars[i + 1..].iter().collect();
            let t = rest.trim();
            if !t.is_empty() {
                comments.push(t.to_string());
            }
            break;
        }
        if chars[i] == '(' {
            let start = i + 1;
            let mut j = start;
            let mut closed = false;
            while j < chars.len() {
                if chars[j] == ')' {
                    closed = true;
                    break;
                }
                j += 1;
            }
            let text: String = chars[start..j].iter().collect();
            let t = text.trim();
            if !t.is_empty() {
                comments.push(t.to_string());
            }
            if !closed {
                errors.push("Unclosed '(' comment".into());
                break;
            }
            i = j + 1;
            continue;
        }
        code.push(chars[i]);
        i += 1;
    }
    let comment = if comments.is_empty() {
        None
    } else {
        Some(comments.join(" | "))
    };
    (code, comment, errors)
}

fn strip_checksum(code: &str) -> (String, bool) {
    if let Some(idx) = code.rfind('*') {
        let tail = code[idx + 1..].trim();
        if !tail.is_empty() && tail.chars().all(|c| c.is_ascii_digit()) {
            return (code[..idx].to_string(), true);
        }
    }
    (code.to_string(), false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_words_and_comments() {
        let lines = lex("G1 X10.5 Y-2 (cut) ; note\n");
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].words.len(), 3);
        assert_eq!(lines[0].words[0].letter, 'G');
        assert!((lines[0].words[1].value - 10.5).abs() < 1e-9);
        assert!(lines[0].comment.as_ref().unwrap().contains("cut"));
        assert!(lines[0].comment.as_ref().unwrap().contains("note"));
    }

    #[test]
    fn parses_g90_1() {
        let lines = lex("G90.1");
        assert!((lines[0].words[0].value - 90.1).abs() < 1e-9);
    }

    #[test]
    fn flags_unclosed_comment() {
        let lines = lex("G1 X1 (oops");
        assert!(!lines[0].errors.is_empty());
    }
}
