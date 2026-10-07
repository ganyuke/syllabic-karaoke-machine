//! Turns pasted lyrics into lines, words and syllables.
//!
//! Timings and pitches from a previous build carry over by syllable position,
//! the same way the browser version does it.

use crate::model::{Line, Preprocessing, Syllable, Word};

const SEPARATORS: &[char] = &['-', '·', '•', '/', '・'];
const SMALL_KANA: &str = "ゃゅょャュョぁぃぅぇぉァィゥェォゎヮゕゖ";
const EDGE_PUNCT: &str = "\"'“”‘’.,!?！？。、・･:;()[]{}「」『』【】〈〉《》";

fn is_edge(c: char) -> bool {
    c.is_whitespace() || EDGE_PUNCT.contains(c)
}

pub fn trim_edge_punctuation(text: &str) -> &str {
    text.trim_matches(is_edge)
}

fn contains_kana(text: &str) -> bool {
    text.chars().any(|c| ('\u{3040}'..='\u{30ff}').contains(&c))
}

fn is_latin(text: &str) -> bool {
    !text.is_empty() && text.chars().all(|c| c.is_ascii_alphabetic())
}

fn is_section_label(line: &str) -> bool {
    let t = line.trim();
    t.len() >= 3 && t.starts_with('[') && t.ends_with(']') && !t[1..t.len() - 1].contains(']')
}

fn split_manual(word: &str) -> Vec<String> {
    let parts: Vec<String> = word
        .split(|c| SEPARATORS.contains(&c))
        .filter(|p| !p.is_empty())
        .map(str::to_string)
        .collect();
    if parts.is_empty() { vec![word.to_string()] } else { parts }
}

fn split_kana(word: &str) -> Vec<String> {
    let token = trim_edge_punctuation(word);
    let mut out: Vec<String> = Vec::new();
    for c in token.chars() {
        if (c == 'ー' || SMALL_KANA.contains(c)) && !out.is_empty() {
            out.last_mut().unwrap().push(c);
        } else {
            out.push(c.to_string());
        }
    }
    out
}

fn is_vowel(c: u8) -> bool {
    matches!(c, b'a' | b'i' | b'u' | b'e' | b'o')
}

fn attach_trailing_vowel(prev: u8, next: u8) -> bool {
    matches!(
        (prev, next),
        (b'a', b'a') | (b'i', b'i') | (b'u', b'u') | (b'e', b'e') | (b'o', b'o') | (b'o', b'u') | (b'e', b'i')
    )
}

fn split_romaji(word: &str) -> Vec<String> {
    let token = trim_edge_punctuation(word);
    if token.is_empty() {
        return Vec::new();
    }
    if !is_latin(token) {
        return split_manual(token);
    }
    let lower = token.to_ascii_lowercase();
    let b = lower.as_bytes();
    let n = b.len();
    let lone_n = |i: usize| b[i] == b'n' && (i == n - 1 || (!is_vowel(b[i + 1]) && b[i + 1] != b'y'));
    let mut out = Vec::new();
    let mut i = 0;
    while i < n {
        let start = i;
        if is_vowel(b[i]) {
            i += 1;
        } else {
            while i < n && !is_vowel(b[i]) {
                if lone_n(i) {
                    i += 1;
                    break;
                }
                i += 1;
                if i < n && is_vowel(b[i]) {
                    break;
                }
            }
            if i < n && is_vowel(b[i]) {
                i += 1;
            }
        }
        if i < n && is_vowel(b[i]) && attach_trailing_vowel(b[i - 1], b[i]) {
            i += 1;
        }
        if i < n && lone_n(i) {
            i += 1;
        }
        out.push(token[start..i].to_string());
    }
    out
}

struct Split {
    parts: Vec<String>,
    show_joiners: bool,
    text: String,
}

fn split_word(word: &str, mode: &str) -> Split {
    let trimmed = trim_edge_punctuation(word);
    let fallback = if trimmed.is_empty() { word } else { trimmed };
    if word.contains(SEPARATORS) {
        return Split {
            parts: split_manual(word),
            show_joiners: true,
            text: trimmed.replace(SEPARATORS, ""),
        };
    }
    if mode == "auto-japanese" {
        if contains_kana(word) {
            let parts = split_kana(word);
            return Split {
                parts: if parts.is_empty() { vec![fallback.to_string()] } else { parts },
                show_joiners: false,
                text: fallback.to_string(),
            };
        }
        if is_latin(trimmed) {
            let parts = split_romaji(word);
            return Split {
                parts: if parts.is_empty() { vec![fallback.to_string()] } else { parts },
                show_joiners: false,
                text: fallback.to_string(),
            };
        }
    }
    Split { parts: vec![fallback.to_string()], show_joiners: false, text: fallback.to_string() }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Carry {
    pub start: Option<f64>,
    pub end: Option<f64>,
    pub pitch: Option<f64>,
}

pub fn snapshot(structure: &[Line]) -> Vec<Carry> {
    structure
        .iter()
        .flat_map(|l| &l.words)
        .flat_map(|w| &w.syllables)
        .map(|s| Carry { start: s.start, end: s.end, pitch: s.pitch })
        .collect()
}

pub fn parse(markup: &str, options: &Preprocessing, previous: &[Carry]) -> Vec<Line> {
    let mut counter = 0usize;
    let mut uid = |prefix: &str| {
        counter += 1;
        format!("{prefix}-{counter}")
    };
    let mut carried = previous.iter();
    let text = markup.replace('\r', "");
    text.split('\n')
        .filter(|line| {
            if options.exclude_section_labels && is_section_label(line) {
                return false;
            }
            !(options.exclude_double_newlines && line.trim().is_empty())
        })
        .map(|line| {
            let id = uid("line");
            let words = line
                .trim()
                .split_whitespace()
                .map(|raw| {
                    let split = split_word(raw, &options.split_mode);
                    let id = uid("word");
                    let syllables = split
                        .parts
                        .iter()
                        .map(|part| {
                            let c = carried.next().copied().unwrap_or_default();
                            Syllable {
                                id: uid("sy"),
                                text: part.clone(),
                                start: c.start,
                                end: c.end,
                                pitch: c.pitch,
                            }
                        })
                        .collect();
                    Word {
                        id,
                        raw: raw.to_string(),
                        text: split.text,
                        show_joiners: split.show_joiners,
                        syllables,
                    }
                })
                .collect();
            Line { id, raw: line.to_string(), words }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(markup: &str, mode: &str) -> Vec<Vec<String>> {
        let options = Preprocessing { split_mode: mode.into(), ..Preprocessing::default() };
        parse(markup, &options, &[])
            .into_iter()
            .flat_map(|l| l.words)
            .map(|w| w.syllables.into_iter().map(|s| s.text).collect())
            .collect()
    }

    #[test]
    fn manual_separators() {
        assert_eq!(texts("ka-ra-o-ke ga su·ki", "manual"), vec![
            vec!["ka", "ra", "o", "ke"],
            vec!["ga"],
            vec!["su", "ki"],
        ]);
    }

    #[test]
    fn section_labels_and_blank_lines_are_skipped() {
        let lines = parse("[Verse 1]\nhello\n\nworld", &Preprocessing::default(), &[]);
        assert_eq!(lines.len(), 2);
    }

    #[test]
    fn romaji_chunks() {
        let got = texts("kokoro shinjite tto ryo kou", "auto-japanese");
        assert_eq!(got[0], vec!["ko", "ko", "ro"]);
        assert_eq!(got[1], vec!["shin", "ji", "te"]);
        assert_eq!(got[3], vec!["ryo"]);
        assert_eq!(got[4], vec!["kou"]);
    }

    #[test]
    fn kana_small_and_long_attach() {
        let got = texts("きょうー", "auto-japanese");
        assert_eq!(got[0], vec!["きょ", "うー"]);
    }

    #[test]
    fn timings_carry_over_by_position() {
        let options = Preprocessing::default();
        let mut first = parse("a-b c", &options, &[]);
        first[0].words[0].syllables[1].start = Some(2.0);
        let carried = snapshot(&first);
        let second = parse("a-b c d", &options, &carried);
        assert_eq!(second[0].words[0].syllables[1].start, Some(2.0));
    }
}
