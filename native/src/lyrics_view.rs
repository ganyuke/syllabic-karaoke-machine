//! The lyrics stage: every syllable laid out as a chip that fills in as it is sung.

use crate::app::{App, Focus};
use crate::model::*;
use crate::theme;
use eframe::egui::{
    self, epaint::Mesh, epaint::Vertex, Align, Color32, CornerRadius, FontId, Pos2, Rect, Sense, Shape, Stroke,
    StrokeKind, Ui, Vec2,
};
use std::sync::Arc;

const FONT_SIZE: f32 = 26.0;
const ROW_HEIGHT: f32 = 42.0;
const LINE_GAP: f32 = 10.0;
const WORD_GAP: f32 = 12.0;
const JOINER_GAP: f32 = 10.0;
const PAD_X: f32 = 4.0;
const MARGIN_LEFT: f32 = 38.0;

struct SylBox {
    g: usize,
    /// The whole chip, relative to the top-left of the stage content.
    rect: Rect,
    galley: Arc<egui::Galley>,
    /// Draw a joiner dot in the gap after this chip.
    joiner_after: bool,
}

struct LineBox {
    rect: Rect,
    syls: Vec<SylBox>,
    first: Option<usize>,
}

#[derive(Default)]
pub struct Cache {
    key: Option<(i32, u64, u32)>,
    lines: Vec<LineBox>,
    height: f32,
}

fn fade(c: Color32, a: u8) -> Color32 {
    Color32::from_rgba_unmultiplied(c.r(), c.g(), c.b(), a)
}

/// Filled part of a syllable: a gradient from teal to indigo that stretches with the fill.
fn gradient_fill(painter: &egui::Painter, rect: Rect) {
    let left = fade(theme::TEAL, 115);
    let right = fade(theme::INDIGO, 90);
    let mut mesh = Mesh::default();
    let uv = egui::epaint::WHITE_UV;
    for (pos, color) in [
        (rect.left_top(), left),
        (rect.right_top(), right),
        (rect.right_bottom(), right),
        (rect.left_bottom(), left),
    ] {
        mesh.vertices.push(Vertex { pos, uv, color });
    }
    mesh.indices.extend_from_slice(&[0, 1, 2, 0, 2, 3]);
    painter.add(Shape::mesh(mesh));
}

impl App {
    fn layout_lyrics(&mut self, ui: &Ui, width: f32) {
        let key = (width.round() as i32, self.doc.structure_revision, ui.ctx().pixels_per_point().to_bits());
        if self.lyrics_cache.key == Some(key) {
            return;
        }
        let font = FontId::proportional(FONT_SIZE);
        let mut lines = Vec::new();
        let mut y = 8.0;
        let mut g = 0usize;
        for line in &self.doc.project.structure {
            let top = y;
            let mut x = MARGIN_LEFT;
            let mut row_y = y;
            let mut syls = Vec::new();
            let first = line.words.iter().any(|w| !w.syllables.is_empty()).then_some(g);
            for word in &line.words {
                let galleys: Vec<Arc<egui::Galley>> = word
                    .syllables
                    .iter()
                    .map(|s| ui.painter().layout_no_wrap(s.text.clone(), font.clone(), Color32::PLACEHOLDER))
                    .collect();
                let gap = if word.show_joiners { JOINER_GAP } else { 0.0 };
                let count = galleys.len();
                let word_w: f32 = galleys.iter().map(|g| g.size().x + PAD_X * 2.0).sum::<f32>()
                    + gap * count.saturating_sub(1) as f32;
                if x + word_w > width - 12.0 && x > MARGIN_LEFT {
                    x = MARGIN_LEFT;
                    row_y += ROW_HEIGHT;
                }
                for (i, galley) in galleys.into_iter().enumerate() {
                    let size = galley.size();
                    let chip = Vec2::new(size.x + PAD_X * 2.0, size.y + 2.0);
                    let rect = Rect::from_min_size(Pos2::new(x, row_y + (ROW_HEIGHT - chip.y) / 2.0), chip);
                    x += chip.x;
                    let joiner_after = word.show_joiners && i + 1 < count;
                    if joiner_after {
                        x += gap;
                    }
                    syls.push(SylBox { g, rect, galley, joiner_after });
                    g += 1;
                }
                x += WORD_GAP;
            }
            let bottom = row_y + ROW_HEIGHT;
            lines.push(LineBox { rect: Rect::from_min_max(Pos2::new(0.0, top), Pos2::new(width, bottom)), syls, first });
            y = bottom + LINE_GAP;
        }
        self.lyrics_cache = Cache { key: Some(key), lines, height: y + 24.0 };
    }

    pub fn lyrics_ui(&mut self, ui: &mut Ui) {
        if self.doc.project.structure.is_empty() {
            ui.add_space(24.0);
            ui.vertical_centered(|ui| {
                ui.label(egui::RichText::new("Paste lyrics in the panel on the left, then press Build.").color(theme::INK_SOFT));
            });
            return;
        }
        let width = ui.available_width();
        self.layout_lyrics(ui, width - 14.0);

        let selected = self.doc.selected();
        let selected_word = selected.map(|g| self.doc.syl_ref(g).global_word_of(&self.doc));
        let target_span = match self.doc.project.practice_target.kind {
            TargetKind::Syllable => None,
            _ => self.doc.target_span(),
        };
        let sounding = self.doc.sounding_at(self.now);
        let active_line = sounding
            .map(|g| self.doc.syl_ref(g).line)
            .or_else(|| {
                self.doc
                    .completed_timed_index(self.now)
                    .map(|i| self.doc.syl_ref(self.doc.index.timed[i]).line)
            });
        let playing = self.engine.is_playing();
        let auto = self.doc.project.settings.auto_scroll_lyrics;
        let follow_active = playing && auto && active_line != self.last_active_line && active_line.is_some();
        if playing {
            self.last_active_line = active_line;
        }
        let want_scroll_selected = std::mem::take(&mut self.scroll_to_active) && auto;
        let selected_line = selected.map(|g| self.doc.syl_ref(g).line);
        let scroll_line = if follow_active { active_line } else if want_scroll_selected { selected_line } else { None };

        let mut click: Option<(usize, TargetKind)> = None;
        let mut jump_line: Option<usize> = None;
        let mut pressed_here = false;
        let now = self.now;

        egui::ScrollArea::vertical().auto_shrink([false, false]).show_viewport(ui, |ui, viewport| {
            let (area, response) =
                ui.allocate_exact_size(Vec2::new(self.lyrics_cache.key.map_or(width, |k| k.0 as f32), self.lyrics_cache.height), Sense::click());
            let origin = area.min.to_vec2();
            let painter = ui.painter_at(area.intersect(ui.clip_rect()));
            let pointer = ui.input(|i| i.pointer.latest_pos()).filter(|_| response.hovered());
            let modifiers = ui.input(|i| i.modifiers);

            if let Some(line) = scroll_line {
                if let Some(l) = self.lyrics_cache.lines.get(line) {
                    ui.scroll_to_rect(l.rect.translate(origin).expand2(Vec2::new(0.0, 40.0)), Some(Align::Center));
                }
            }

            for (li, line) in self.lyrics_cache.lines.iter().enumerate() {
                if line.rect.bottom() < viewport.top() - 40.0 || line.rect.top() > viewport.bottom() + 40.0 {
                    continue;
                }
                let abs = line.rect.translate(origin);
                if active_line == Some(li) {
                    painter.rect_filled(
                        Rect::from_min_max(Pos2::new(abs.left() + 2.0, abs.top()), Pos2::new(abs.left() + 5.0, abs.bottom())),
                        CornerRadius::same(2),
                        theme::INDIGO,
                    );
                }
                // Line jump button.
                let button = Rect::from_min_size(Pos2::new(abs.left() + 12.0, abs.top() + (ROW_HEIGHT - 22.0) / 2.0), Vec2::splat(22.0));
                let hover_button = pointer.is_some_and(|p| button.contains(p));
                painter.rect(
                    button,
                    CornerRadius::same(5),
                    if hover_button { theme::PAPER_2 } else { Color32::TRANSPARENT },
                    Stroke::new(1.0_f32, theme::RULE),
                    StrokeKind::Inside,
                );
                painter.text(button.center(), egui::Align2::CENTER_CENTER, format!("{}", li + 1), FontId::monospace(10.0), theme::INK_SOFT);
                if response.clicked() && pointer.is_some_and(|p| button.contains(p)) {
                    jump_line = Some(li);
                }

                for b in &line.syls {
                    let chip = b.rect.translate(origin);
                    let s = self.doc.syl(b.g);
                    let is_selected = selected == Some(b.g);
                    let in_target = target_span.is_some_and(|(a, z)| (a..=z).contains(&b.g));
                    let word_index = self.doc.syl_ref(b.g).global_word_of(&self.doc);
                    let word_synced = self.doc.word_of(b.g).syllables.first().is_some_and(|f| f.start.is_some());
                    let word_visible = word_synced || selected_word == Some(word_index);
                    let start = s.start;
                    let end = self.doc.effective_end(b.g);
                    let hovered = pointer.is_some_and(|p| chip.expand2(Vec2::new(3.0, 4.0)).contains(p));
                    let round = CornerRadius::same(4);

                    if in_target {
                        painter.rect_filled(chip.expand2(Vec2::new(2.0, 1.0)), round, fade(theme::INDIGO, 28));
                    }
                    if hovered && !is_selected {
                        painter.rect_filled(chip, round, Color32::from_rgba_unmultiplied(0, 0, 0, 12));
                    }

                    // The expanding background: grows left to right as the syllable is sung.
                    let mut progress = 0.0f32;
                    if let (Some(start), Some(end)) = (start, end) {
                        if end > start {
                            progress = ((now - start) / (end - start)).clamp(0.0, 1.0) as f32;
                        }
                    }
                    if progress > 0.0 {
                        let inner = chip.shrink2(Vec2::new(0.0, 2.0));
                        let filled = Rect::from_min_size(inner.min, Vec2::new(inner.width() * progress, inner.height()));
                        gradient_fill(&painter, filled);
                    }

                    // Borders: selected beats sounding, and unsynced syllables get a dashed outline.
                    let sounding_now = progress > 0.0 && progress < 1.0;
                    if is_selected {
                        painter.rect(chip.expand(2.0), CornerRadius::same(6), fade(theme::AMBER, 26), Stroke::NONE, StrokeKind::Outside);
                        painter.rect_stroke(chip, round, Stroke::new(1.5_f32, theme::AMBER), StrokeKind::Inside);
                    } else if sounding_now {
                        painter.rect(chip.expand(2.0), CornerRadius::same(6), fade(theme::INDIGO, 26), Stroke::NONE, StrokeKind::Outside);
                        painter.rect_stroke(chip, round, Stroke::new(1.5_f32, theme::INDIGO), StrokeKind::Inside);
                    } else if start.is_none() {
                        let o = [chip.left_top(), chip.right_top(), chip.right_bottom(), chip.left_bottom(), chip.left_top()];
                        painter.extend(Shape::dashed_line(&o, Stroke::new(1.0_f32, theme::RULE), 3.0, 3.0));
                    }

                    let base = if start.is_none() {
                        Color32::from_rgb(0x9a, 0x93, 0x86)
                    } else if progress >= 1.0 {
                        theme::TEAL
                    } else {
                        theme::INK
                    };
                    let text_color = if word_visible { base } else { fade(base, 115) };
                    painter.galley_with_override_text_color(
                        Pos2::new(chip.left() + PAD_X, chip.top() + 1.0),
                        b.galley.clone(),
                        text_color,
                    );
                    if b.joiner_after {
                        painter.text(
                            Pos2::new(chip.right() + JOINER_GAP / 2.0, chip.center().y),
                            egui::Align2::CENTER_CENTER,
                            "·",
                            FontId::proportional(16.0),
                            theme::INK_SOFT,
                        );
                    }

                    if response.clicked() && pointer.is_some_and(|p| chip.expand2(Vec2::new(3.0, 4.0)).contains(p)) {
                        let kind = if modifiers.shift { TargetKind::Word } else { TargetKind::Syllable };
                        click = Some((b.g, kind));
                    }
                }
            }
            if response.hovered() && ui.input(|i| i.pointer.primary_pressed()) {
                pressed_here = true;
            }
        });
        if pressed_here {
            self.focus = Focus::Timing;
        }

        if let Some(li) = jump_line {
            if let Some(first) = self.lyrics_cache.lines[li].first {
                self.select(first, TargetKind::Line, true, false);
                if !self.doc.project.settings.select_without_seek {
                    self.jump_to_target();
                }
            }
        } else if let Some((g, kind)) = click {
            self.select(g, kind, true, false);
            if !self.doc.project.settings.select_without_seek {
                self.jump_to_target();
            }
        }
    }
}

impl SylRef {
    /// Global word number, so words can be compared across lines.
    fn global_word_of(&self, doc: &Doc) -> usize {
        doc.project.structure[..self.line].iter().map(|l| l.words.len()).sum::<usize>() + self.word
    }
}
