//! Colors and fonts. The palette follows the browser version.

use eframe::egui::{self, Color32, FontData, FontDefinitions, FontFamily};

pub const PAPER: Color32 = Color32::from_rgb(0xfa, 0xf7, 0xf2);
pub const PAPER_2: Color32 = Color32::from_rgb(0xf1, 0xed, 0xe4);
pub const INK: Color32 = Color32::from_rgb(0x1a, 0x16, 0x0f);
pub const INK_SOFT: Color32 = Color32::from_rgb(0x6b, 0x64, 0x58);
pub const RULE: Color32 = Color32::from_rgba_premultiplied(5, 4, 3, 30);
pub const INDIGO: Color32 = Color32::from_rgb(0x2b, 0x4a, 0xcb);
pub const TEAL: Color32 = Color32::from_rgb(0x0d, 0x8f, 0x6f);
pub const AMBER: Color32 = Color32::from_rgb(0xb8, 0x5c, 0x00);
pub const RED: Color32 = Color32::from_rgb(0xb8, 0x20, 0x20);

pub fn install(ctx: &egui::Context) {
    let mut visuals = egui::Visuals::light();
    visuals.panel_fill = PAPER;
    visuals.window_fill = PAPER;
    visuals.extreme_bg_color = Color32::WHITE;
    visuals.override_text_color = Some(INK);
    visuals.selection.bg_fill = Color32::from_rgba_unmultiplied(0x2b, 0x4a, 0xcb, 70);
    ctx.set_visuals(visuals);
    ctx.style_mut(|s| {
        s.spacing.item_spacing = egui::vec2(8.0, 6.0);
        s.spacing.button_padding = egui::vec2(9.0, 4.0);
    });
    install_fonts(ctx);
}

/// egui's bundled fonts have no kana, so look for one the system already has.
fn install_fonts(ctx: &egui::Context) {
    let candidates: &[&str] = &[
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/google-noto-sans-cjk-fonts/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
        "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "C:\\Windows\\Fonts\\YuGothR.ttc",
        "C:\\Windows\\Fonts\\meiryo.ttc",
        "C:\\Windows\\Fonts\\msgothic.ttc",
    ];
    let mut found = candidates.iter().find_map(|p| std::fs::read(p).ok());
    if found.is_none() {
        found = scan_for_cjk(std::path::Path::new("/usr/share/fonts"), 0);
    }
    let Some(bytes) = found else { return };
    let mut fonts = FontDefinitions::default();
    fonts.font_data.insert("cjk".into(), std::sync::Arc::new(FontData::from_owned(bytes)));
    for family in [FontFamily::Proportional, FontFamily::Monospace] {
        fonts.families.entry(family).or_default().push("cjk".into());
    }
    ctx.set_fonts(fonts);
}

fn scan_for_cjk(dir: &std::path::Path, depth: usize) -> Option<Vec<u8>> {
    if depth > 4 {
        return None;
    }
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = scan_for_cjk(&path, depth + 1) {
                return Some(found);
            }
        } else if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            let lower = name.to_ascii_lowercase();
            let cjk = lower.contains("cjk") || lower.contains("notosansjp") || lower.contains("ipag");
            if cjk && (lower.ends_with(".ttc") || lower.ends_with(".ttf") || lower.ends_with(".otf")) {
                if let Ok(bytes) = std::fs::read(&path) {
                    return Some(bytes);
                }
            }
        }
    }
    None
}
