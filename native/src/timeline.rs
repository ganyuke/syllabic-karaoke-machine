//! Waveform timeline, overview strip and pitch roll.
//!
//! Everything is painted as egui shapes, which the wgpu backend draws on the GPU
//! each frame. The waveform is one mesh of thin quads, so zooming and scrolling
//! never rebuild bitmaps.

use crate::app::{note_name, App, Drag, Focus, Surface};
use crate::model::*;
use crate::theme;
use eframe::egui::{
    self, epaint::Mesh, Align2, Color32, CornerRadius, CursorIcon, FontId, Painter, Pos2, Rect, Sense, Shape, Stroke,
    StrokeKind, Ui, Vec2,
};

const TRACK_HEIGHT: f32 = 32.0;
const BLOCK_INSET: f32 = 4.0;
const PITCH_GUTTER: f32 = 42.0;
const SNAP_PX: f32 = 8.0;

fn alpha(c: Color32, a: u8) -> Color32 {
    Color32::from_rgba_unmultiplied(c.r(), c.g(), c.b(), a)
}

fn radius(px: u8) -> CornerRadius {
    CornerRadius::same(px)
}

impl App {
    fn t2x(&self, rect: Rect, gutter: f32, t: f64) -> f32 {
        let usable = (rect.width() - gutter).max(1.0);
        rect.left() + gutter + ((t - self.view.start) / self.view.duration) as f32 * usable
    }

    fn x2t(&self, rect: Rect, gutter: f32, x: f32) -> f64 {
        let usable = (rect.width() - gutter).max(1.0);
        self.view.start + ((x - rect.left() - gutter) / usable) as f64 * self.view.duration
    }

    fn snap_time(&self, raw: f64, exclude: usize, width: f32) -> f64 {
        let window = (SNAP_PX / width.max(1.0)) as f64 * self.view.duration;
        let mut best = raw;
        let mut best_dist = window;
        for &(t, g) in &self.doc.index.snap_points {
            if g == exclude {
                continue;
            }
            let d = (t - raw).abs();
            if d <= best_dist {
                best = t;
                best_dist = d;
            }
        }
        best
    }

    /// Wheel zoom and pan shared by the timeline and the pitch roll.
    fn view_wheel(&mut self, ui: &Ui, rect: Rect, gutter: f32, hovered: bool) {
        if !hovered {
            return;
        }
        let (scroll, zoom, pointer) = ui.input(|i| (i.raw_scroll_delta, i.zoom_delta(), i.pointer.hover_pos()));
        let usable = (rect.width() - gutter).max(1.0);
        let ratio = pointer
            .map(|p| ((p.x - rect.left() - gutter) / usable).clamp(0.0, 1.0) as f64)
            .unwrap_or(0.5);
        let full = self.full_duration();
        if scroll.x != 0.0 {
            let delta = (scroll.x / usable) as f64 * self.view.duration * -1.0;
            self.view.start = (self.view.start + delta).clamp(0.0, (full - self.view.duration).max(0.0));
        }
        if scroll.y != 0.0 {
            self.zoom_view(0.8f64.powf(scroll.y as f64 / 50.0), ratio);
        }
        if zoom != 1.0 {
            self.zoom_view(1.0 / zoom as f64, ratio);
        }
    }

    fn edge_scroll(&mut self, rect: Rect, gutter: f32, x: f32, dt: f64) -> bool {
        if self.view.duration >= self.full_duration() - 1e-9 {
            return false;
        }
        let usable = (rect.width() - gutter).max(1.0);
        let local = x - rect.left() - gutter;
        let zone = (usable * 0.12).clamp(24.0, 72.0);
        let (dir, intensity) = if local < zone {
            (-1.0, ((zone - local) / zone).clamp(0.0, 1.4))
        } else if local > usable - zone {
            (1.0, ((local - (usable - zone)) / zone).clamp(0.0, 1.4))
        } else {
            return false;
        };
        let speed = self.view.duration * (0.45 + (intensity as f64).powf(1.6) * 4.5);
        let before = self.view.start;
        self.view.start += dir * speed * dt.min(0.064);
        self.clamp_view();
        self.view.start != before
    }

    // --- timeline -------------------------------------------------------------

    pub fn timeline_ui(&mut self, ui: &mut Ui) {
        let lyrics_open = !self.is_collapsed("collapsedSections", "lyrics", false);
        let share = if lyrics_open { 0.30 } else { 0.60 };
        let height = (ui.available_height() * share).clamp(150.0, 520.0);
        let (rect, response) = ui.allocate_exact_size(Vec2::new(ui.available_width(), height), Sense::click_and_drag());
        let painter = ui.painter_at(rect);
        painter.rect_filled(rect, radius(4), theme::PAPER);

        let wave_rect = Rect::from_min_max(rect.min, Pos2::new(rect.right(), rect.bottom() - TRACK_HEIGHT));
        self.paint_grid(&painter, rect, 0.0, true);
        self.paint_waveform(&painter, wave_rect);
        self.paint_target_band(&painter, rect, 0.0);
        let track_top = rect.bottom() - TRACK_HEIGHT + BLOCK_INSET;
        let track_h = TRACK_HEIGHT - BLOCK_INSET * 2.0;
        painter.line_segment(
            [Pos2::new(rect.left(), rect.bottom() - TRACK_HEIGHT), Pos2::new(rect.right(), rect.bottom() - TRACK_HEIGHT)],
            Stroke::new(1.0_f32, theme::RULE),
        );

        let selected = self.doc.selected();
        let sounding = self.doc.sounding_at(self.now);
        let view_end = self.view.start + self.view.duration;
        for g in 0..self.doc.len() {
            let (Some(start), Some(end)) = (self.doc.syl(g).start, self.doc.effective_end(g)) else { continue };
            if end < self.view.start || start > view_end {
                continue;
            }
            let x1 = self.t2x(rect, 0.0, start);
            let x2 = self.t2x(rect, 0.0, end);
            let w = (x2 - x1).max(3.0);
            let block = Rect::from_min_size(Pos2::new(x1, track_top), Vec2::new(w, track_h));
            let is_selected = selected == Some(g);
            let is_sounding = sounding == Some(g);
            let (fill, edge) = if is_selected {
                (alpha(theme::AMBER, 224), alpha(Color32::from_rgb(138, 66, 0), 235))
            } else if is_sounding {
                (alpha(theme::INDIGO, 209), alpha(Color32::from_rgb(25, 52, 153), 230))
            } else {
                (alpha(Color32::from_rgb(20, 160, 100), 140), alpha(Color32::BLACK, 30))
            };
            painter.rect(block, radius(7), fill, Stroke::new(if is_selected { 1.8_f32 } else { 1.0 }, edge), StrokeKind::Inside);
            if self.doc.syl(g).end.is_none() {
                painter.extend(Shape::dashed_line(
                    &[Pos2::new(x2, track_top + 3.0), Pos2::new(x2, track_top + track_h - 3.0)],
                    Stroke::new(1.0_f32, alpha(Color32::BLACK, 70)),
                    4.0,
                    4.0,
                ));
            }
            if w > 20.0 {
                painter.with_clip_rect(block).text(
                    Pos2::new(x1 + 6.0, block.center().y),
                    Align2::LEFT_CENTER,
                    &self.doc.syl(g).text,
                    FontId::proportional(12.0),
                    Color32::from_white_alpha(240),
                );
            }
            if is_selected {
                painter.rect_filled(Rect::from_min_size(Pos2::new(x1 - 1.0, track_top - 1.0), Vec2::new(2.0, track_h + 2.0)), 0.0, alpha(Color32::from_rgb(158, 108, 8), 242));
                painter.rect_filled(Rect::from_min_size(Pos2::new(x2 - 1.0, track_top - 1.0), Vec2::new(2.0, track_h + 2.0)), 0.0, alpha(Color32::from_rgb(158, 108, 8), 242));
            }
        }

        if let Some(Drag::Start(drag_g) | Drag::End(drag_g)) = self.drag {
            let stroke = Stroke::new(1.0_f32, Color32::from_rgba_unmultiplied(255, 150, 0, 180));
            for &(t, g) in &self.doc.index.snap_points {
                if g == drag_g || t < self.view.start || t > view_end {
                    continue;
                }
                let x = self.t2x(rect, 0.0, t);
                painter.extend(Shape::dashed_line(
                    &[Pos2::new(x, rect.top()), Pos2::new(x, rect.bottom() - TRACK_HEIGHT)],
                    stroke,
                    3.0,
                    3.0,
                ));
            }
        }

        self.paint_playhead(&painter, rect, 0.0);
        self.timeline_input(ui, rect, &response, track_top, track_h);
    }

    fn timeline_input(&mut self, ui: &Ui, rect: Rect, response: &egui::Response, track_top: f32, track_h: f32) {
        self.view_wheel(ui, rect, 0.0, response.hovered());
        let (pressed, down, pos, dt) = ui.input(|i| {
            (i.pointer.primary_pressed(), i.pointer.primary_down(), i.pointer.latest_pos(), i.stable_dt as f64)
        });
        let in_track = |p: Pos2| p.y >= track_top && p.y <= track_top + track_h;

        // Pointer cursor hints.
        if self.drag.is_none() {
            if let Some(p) = pos.filter(|p| response.hovered() && rect.contains(*p)) {
                match self.hit_timeline(rect, p, in_track(p)) {
                    Some((_, Hit::StartHandle | Hit::EndHandle)) => ui.ctx().set_cursor_icon(CursorIcon::ResizeHorizontal),
                    Some((_, Hit::Block)) => ui.ctx().set_cursor_icon(CursorIcon::Grab),
                    None => ui.ctx().set_cursor_icon(CursorIcon::Crosshair),
                }
            }
        }

        if pressed && response.hovered() && self.drag.is_none() {
            if let Some(p) = pos {
                self.focus = Focus::Timing;
                let selected_before = self.doc.selected();
                let hit = if in_track(p) { self.hit_timeline(rect, p, true) } else { None };
                let mut next = None;
                if let Some((g, kind)) = hit {
                    self.select(g, TargetKind::Syllable, false, false);
                    match kind {
                        Hit::StartHandle => next = Some(Drag::Start(g)),
                        Hit::EndHandle => next = Some(Drag::End(g)),
                        Hit::Block if selected_before == Some(g) => {
                            let s = self.doc.syl(g);
                            next = s.start.map(|start0| Drag::MoveBlock {
                                g,
                                origin: self.x2t(rect, 0.0, p.x),
                                start0,
                                end0: s.end,
                            });
                        }
                        Hit::Block => {}
                    }
                    if next.is_some() {
                        self.doc.push_undo();
                    }
                }
                match next {
                    Some(d) => self.drag = Some(d),
                    None => {
                        self.drag = Some(Drag::Scrub(Surface::Timeline));
                        let t = self.x2t(rect, 0.0, p.x);
                        self.last_scrub_x = Some(p.x);
                        self.seek(t, None);
                    }
                }
            }
        }

        let Some(drag) = self.drag else { return };
        if !down {
            if matches!(drag, Drag::Start(_) | Drag::End(_) | Drag::MoveBlock { .. }) {
                self.changed_at_now();
            }
            if is_timeline_drag(drag) {
                self.drag = None;
            }
            return;
        }
        let Some(p) = pos else { return };
        let raw = self.x2t(rect, 0.0, p.x);
        match drag {
            Drag::Scrub(Surface::Timeline) => {
                if self.edge_scroll(rect, 0.0, p.x, dt) {
                    let t = self.x2t(rect, 0.0, p.x.clamp(rect.left(), rect.right()));
                    self.seek(t, None);
                } else {
                    self.scrub_to(p.x, raw);
                }
            }
            Drag::Start(g) => {
                let t = self.snap_time(raw, g, rect.width());
                if let Some(stored) = self.doc.drag_start(g, t) {
                    self.ensure_time_in_view(stored);
                }
            }
            Drag::End(g) => {
                let t = self.snap_time(raw, g, rect.width());
                if let Some(stored) = self.doc.drag_end(g, t) {
                    self.ensure_time_in_view(stored);
                }
            }
            Drag::MoveBlock { g, origin, start0, end0 } => {
                if self.doc.drag_block(g, start0, end0, raw - origin) {
                    if let Some(start) = self.doc.syl(g).start {
                        self.ensure_time_in_view(start);
                    }
                }
            }
            _ => {}
        }
    }

    fn hit_timeline(&self, rect: Rect, p: Pos2, in_track: bool) -> Option<(usize, Hit)> {
        if !in_track {
            return None;
        }
        let selected = self.doc.selected();
        if let Some(g) = selected {
            if let (Some(start), Some(end)) = (self.doc.syl(g).start, self.doc.effective_end(g)) {
                let x1 = self.t2x(rect, 0.0, start);
                let x2 = self.t2x(rect, 0.0, end).max(x1 + 3.0);
                if (p.x - x1).abs() <= 4.0 {
                    return Some((g, Hit::StartHandle));
                }
                if (p.x - x2).abs() <= 4.0 {
                    return Some((g, Hit::EndHandle));
                }
            }
        }
        let t = self.x2t(rect, 0.0, p.x);
        // Blocks never overlap, so the one starting at or before the pointer is the candidate.
        let starts = &self.doc.index.timed_starts;
        let upper = starts.partition_point(|&s| s <= t);
        for i in (upper.saturating_sub(2)..(upper + 1).min(starts.len())).rev() {
            let g = self.doc.index.timed[i];
            let start = starts[i];
            let end = self.doc.index.timed_ends[i];
            let x1 = self.t2x(rect, 0.0, start);
            let x2 = self.t2x(rect, 0.0, end).max(x1 + 3.0);
            if p.x >= x1 && p.x <= x2 {
                return Some((g, Hit::Block));
            }
        }
        None
    }

    /// Moves the playhead for a held-down scrub. Holding the pointer still must not seek again,
    /// or playback would restart the same instant every frame.
    fn scrub_to(&mut self, x: f32, time: f64) {
        if self.last_scrub_x == Some(x) {
            return;
        }
        self.last_scrub_x = Some(x);
        self.seek(time, None);
    }

    fn changed_at_now(&mut self) {
        self.timing_changed(None);
    }

    fn paint_waveform(&self, painter: &Painter, rect: Rect) {
        let Some(peaks) = &self.peaks else {
            painter.text(rect.center(), Align2::CENTER_CENTER, "Open an audio file to see its waveform", FontId::proportional(14.0), theme::INK_SOFT);
            return;
        };
        let total = peaks.duration.max(1e-6);
        let base_count = peaks.levels[0].min.len() as f64;
        let ppp = painter.ctx().pixels_per_point();
        let step = 1.0 / ppp;
        let columns = (rect.width() / step).ceil() as usize;
        let base_per_px = (self.view.duration / total * base_count) / (rect.width() * ppp) as f64;
        let level = peaks.level_for(base_per_px * 1.0, 1.25);
        let count = level.min.len();
        let per_sec = count as f64 / total;
        let mid = rect.center().y;
        let amp = rect.height() * 0.46;
        let color = alpha(theme::INDIGO, 120);
        let mut mesh = Mesh::default();
        mesh.reserve_vertices(columns * 4);
        mesh.reserve_triangles(columns * 2);
        for c in 0..columns {
            let x = rect.left() + c as f32 * step;
            let t0 = self.x2t(rect, 0.0, x);
            let t1 = self.x2t(rect, 0.0, x + step);
            if t1 < 0.0 || t0 > total {
                continue;
            }
            let i0 = ((t0.max(0.0) * per_sec).floor() as usize).min(count - 1);
            let i1 = ((t1 * per_sec).ceil() as usize).clamp(i0 + 1, count);
            let (mut lo, mut hi) = (0f32, 0f32);
            for i in i0..i1 {
                lo = lo.min(level.min[i]);
                hi = hi.max(level.max[i]);
            }
            let top = mid - hi * amp;
            let bottom = (mid - lo * amp).max(top + 1.0);
            mesh.add_colored_rect(Rect::from_min_max(Pos2::new(x, top), Pos2::new(x + step, bottom)), color);
        }
        painter.add(Shape::mesh(mesh));
        painter.line_segment(
            [Pos2::new(rect.left(), mid), Pos2::new(rect.right(), mid)],
            Stroke::new(1.0_f32, alpha(theme::INK, 24)),
        );
    }

    fn paint_grid(&self, painter: &Painter, rect: Rect, gutter: f32, labels: bool) {
        let usable = (rect.width() - gutter).max(1.0);
        let px_per_sec = usable as f64 / self.view.duration;
        let steps = [0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 15.0, 30.0, 60.0, 120.0, 300.0];
        let step = steps.iter().copied().find(|s| s * px_per_sec >= 80.0).unwrap_or(600.0);
        let first = (self.view.start / step).floor() as i64;
        let font = FontId::monospace(10.0);
        let mut i = first;
        loop {
            let t = i as f64 * step;
            if t > self.view.start + self.view.duration {
                break;
            }
            let x = self.t2x(rect, gutter, t);
            if x >= rect.left() + gutter {
                painter.line_segment([Pos2::new(x, rect.top()), Pos2::new(x, rect.bottom())], Stroke::new(1.0_f32, alpha(theme::INK, 14)));
                if labels {
                    painter.text(Pos2::new(x + 3.0, rect.top() + 2.0), Align2::LEFT_TOP, crate::app::clock(t.max(0.0), step < 1.0), font.clone(), theme::INK_SOFT);
                }
            }
            i += 1;
        }
        let m = &self.doc.project.settings.metronome;
        if m.enabled {
            let interval = 60.0 / m.bpm.clamp(20.0, 300.0);
            let bars = m.beats_per_bar.clamp(1, 12) as i64;
            let first = ((self.view.start - m.offset) / interval).floor() as i64 - 1;
            let mut beat = first;
            for _ in 0..800 {
                let t = m.offset + beat as f64 * interval;
                if t > self.view.start + self.view.duration + interval {
                    break;
                }
                let x = self.t2x(rect, gutter, t);
                if x >= rect.left() + gutter && x <= rect.right() {
                    let major = beat.rem_euclid(bars) == 0;
                    let color = if major { Color32::from_rgba_unmultiplied(200, 100, 30, 100) } else { alpha(Color32::BLACK, 46) };
                    painter.line_segment([Pos2::new(x, rect.top()), Pos2::new(x, rect.bottom())], Stroke::new(if major { 1.4_f32 } else { 1.0 }, color));
                }
                beat += 1;
            }
        }
    }

    fn paint_target_band(&self, painter: &Painter, rect: Rect, gutter: f32) {
        if let Some((start, end)) = self.doc.target_range() {
            let band = Rect::from_min_max(
                Pos2::new(self.t2x(rect, gutter, start).max(rect.left() + gutter), rect.top()),
                Pos2::new(self.t2x(rect, gutter, end).min(rect.right()), rect.bottom()),
            );
            if band.width() > 0.0 {
                painter.rect_filled(band, 0.0, alpha(theme::AMBER, 20));
            }
        }
    }

    fn paint_playhead(&self, painter: &Painter, rect: Rect, gutter: f32) {
        let x = self.t2x(rect, gutter, self.now);
        if x >= rect.left() + gutter - 1.0 && x <= rect.right() + 1.0 {
            painter.line_segment([Pos2::new(x, rect.top()), Pos2::new(x, rect.bottom())], Stroke::new(2.0_f32, alpha(theme::RED, 230)));
        }
    }

    // --- overview ------------------------------------------------------------

    pub fn overview_ui(&mut self, ui: &mut Ui) {
        let (rect, response) = ui.allocate_exact_size(Vec2::new(ui.available_width(), 38.0), Sense::click_and_drag());
        let painter = ui.painter_at(rect);
        painter.rect_filled(rect, radius(4), theme::PAPER_2);
        let full = self.full_duration();

        if let Some(peaks) = &self.peaks {
            let level = peaks.levels.last().unwrap();
            let count = level.min.len();
            let total = peaks.duration.max(1e-6);
            let columns = rect.width().floor() as usize;
            let mid = rect.center().y;
            let amp = rect.height() * 0.42;
            let mut mesh = Mesh::default();
            for c in 0..columns {
                let t0 = c as f64 / columns as f64 * full;
                let t1 = (c + 1) as f64 / columns as f64 * full;
                if t0 > total {
                    break;
                }
                let i0 = ((t0 / total * count as f64) as usize).min(count - 1);
                let i1 = (((t1 / total * count as f64).ceil()) as usize).clamp(i0 + 1, count);
                let (mut lo, mut hi) = (0f32, 0f32);
                for i in i0..i1 {
                    lo = lo.min(level.min[i]);
                    hi = hi.max(level.max[i]);
                }
                let x = rect.left() + c as f32;
                mesh.add_colored_rect(
                    Rect::from_min_max(Pos2::new(x, mid - hi * amp), Pos2::new(x + 1.0, (mid - lo * amp).max(mid - hi * amp + 1.0))),
                    alpha(theme::INDIGO, 90),
                );
            }
            painter.add(Shape::mesh(mesh));
        }
        for g in 0..self.doc.len() {
            let (Some(start), Some(end)) = (self.doc.syl(g).start, self.doc.effective_end(g)) else { continue };
            let x1 = rect.left() + (start / full) as f32 * rect.width();
            let x2 = rect.left() + (end / full) as f32 * rect.width();
            painter.rect_filled(
                Rect::from_min_max(Pos2::new(x1, rect.bottom() - 6.0), Pos2::new(x2.max(x1 + 1.0), rect.bottom() - 2.0)),
                0.0,
                alpha(Color32::from_rgb(20, 160, 100), 170),
            );
        }
        let vx1 = rect.left() + (self.view.start / full) as f32 * rect.width();
        let vx2 = rect.left() + ((self.view.start + self.view.duration) / full) as f32 * rect.width();
        let viewport = Rect::from_min_max(Pos2::new(vx1, rect.top()), Pos2::new(vx2.max(vx1 + 4.0), rect.bottom()));
        painter.rect(viewport, radius(3), alpha(theme::INDIGO, 28), Stroke::new(1.5_f32, alpha(theme::INDIGO, 160)), StrokeKind::Inside);
        let px = rect.left() + (self.now / full) as f32 * rect.width();
        painter.line_segment([Pos2::new(px, rect.top()), Pos2::new(px, rect.bottom())], Stroke::new(1.5_f32, alpha(theme::RED, 220)));

        let (pressed, down, pos) = ui.input(|i| (i.pointer.primary_pressed(), i.pointer.primary_down(), i.pointer.latest_pos()));
        if response.hovered() {
            ui.ctx().set_cursor_icon(CursorIcon::Grab);
        }
        if pressed && response.hovered() && self.drag.is_none() {
            if let Some(p) = pos {
                self.focus = Focus::Timing;
                let t = ((p.x - rect.left()) / rect.width()) as f64 * full;
                let inside = p.x >= viewport.left() && p.x <= viewport.right();
                if !inside {
                    self.view.start = t - self.view.duration / 2.0;
                    self.clamp_view();
                }
                self.drag = Some(Drag::Overview { grab_offset: t - self.view.start });
            }
        }
        if let Some(Drag::Overview { grab_offset }) = self.drag {
            if down {
                if let Some(p) = pos {
                    let t = ((p.x - rect.left()) / rect.width()) as f64 * full;
                    self.view.start = t - grab_offset;
                    self.clamp_view();
                }
            } else {
                self.drag = None;
            }
        }
    }

    // --- pitch roll -----------------------------------------------------------

    fn pitch_bounds(&self) -> (f64, f64) {
        let r = &self.doc.project.settings.pitch_range;
        (r.min.min(r.max).round(), r.min.max(r.max).round())
    }

    fn pitch_to_y(&self, rect: Rect, pitch: f64) -> f32 {
        let (lo, hi) = self.pitch_bounds();
        let rows = (hi - lo + 1.0).max(1.0) as f32;
        let row_h = (rect.height() - 16.0) / rows;
        rect.top() + 8.0 + (hi - pitch) as f32 * row_h
    }

    fn y_to_pitch(&self, rect: Rect, y: f32) -> f64 {
        let (lo, hi) = self.pitch_bounds();
        let rows = (hi - lo + 1.0).max(1.0) as f32;
        let row_h = (rect.height() - 16.0) / rows;
        let local = (y - rect.top()).clamp(8.0, rect.height() - 8.0) - 8.0;
        (hi - (local / row_h).floor() as f64).clamp(lo, hi)
    }

    pub fn pitch_ui(&mut self, ui: &mut Ui) {
        let size = Vec2::new(ui.available_width(), ui.available_height().max(60.0));
        let (rect, response) = ui.allocate_exact_size(size, Sense::click_and_drag());
        let painter = ui.painter_at(rect);
        painter.rect_filled(rect, radius(4), theme::PAPER);
        let (lo, hi) = self.pitch_bounds();
        let rows = (hi - lo + 1.0).max(1.0);
        let row_h = (rect.height() - 16.0) / rows as f32;

        // Rows and note labels.
        let mut pitch = lo;
        while pitch <= hi {
            let y = self.pitch_to_y(rect, pitch);
            let black = matches!((pitch as i64).rem_euclid(12), 1 | 3 | 6 | 8 | 10);
            let row = Rect::from_min_size(Pos2::new(rect.left() + PITCH_GUTTER, y), Vec2::new(rect.width() - PITCH_GUTTER, row_h));
            if black {
                painter.rect_filled(row, 0.0, alpha(theme::INK, 10));
            }
            painter.line_segment([Pos2::new(row.left(), y), Pos2::new(row.right(), y)], Stroke::new(1.0_f32, alpha(theme::INK, 12)));
            if (pitch as i64).rem_euclid(12) == 0 || row_h >= 11.0 {
                painter.text(
                    Pos2::new(rect.left() + PITCH_GUTTER - 6.0, y + row_h / 2.0),
                    Align2::RIGHT_CENTER,
                    note_name(Some(pitch)),
                    FontId::monospace(9.5),
                    theme::INK_SOFT,
                );
            }
            pitch += 1.0;
        }
        self.paint_grid(&painter.with_clip_rect(Rect::from_min_max(Pos2::new(rect.left() + PITCH_GUTTER, rect.top()), rect.max)), rect, PITCH_GUTTER, false);

        let selected = self.doc.selected();
        let sounding = self.doc.sounding_at(self.now);
        let view_end = self.view.start + self.view.duration;
        let notes = painter.with_clip_rect(Rect::from_min_max(Pos2::new(rect.left() + PITCH_GUTTER, rect.top()), rect.max));
        let mut hits: Vec<(usize, Rect)> = Vec::new();
        for g in 0..self.doc.len() {
            let (Some(start), Some(end)) = (self.doc.syl(g).start, self.doc.effective_end(g)) else { continue };
            let has_pitch = self.doc.syl(g).pitch.is_some();
            let ghost = selected == Some(g) && !has_pitch;
            if !has_pitch && !ghost {
                continue;
            }
            if end < self.view.start || start > view_end {
                continue;
            }
            let pitch = self.doc.syl(g).pitch.unwrap_or_else(|| self.ghost_pitch());
            let x1 = self.t2x(rect, PITCH_GUTTER, start);
            let x2 = self.t2x(rect, PITCH_GUTTER, end);
            let y = self.pitch_to_y(rect, pitch) + row_h * 0.14;
            let note = Rect::from_min_size(Pos2::new(x1, y), Vec2::new((x2 - x1).max(4.0), row_h * 0.72));
            let is_selected = selected == Some(g);
            let is_sounding = sounding == Some(g);
            if ghost {
                notes.rect_filled(note, radius(6), alpha(Color32::BLACK, 20));
                let outline = [note.left_top(), note.right_top(), note.right_bottom(), note.left_bottom(), note.left_top()];
                notes.extend(Shape::dashed_line(&outline, Stroke::new(1.5_f32, alpha(Color32::BLACK, 128)), 6.0, 4.0));
            } else {
                let (fill, edge) = if is_selected {
                    (alpha(theme::AMBER, 224), alpha(Color32::from_rgb(138, 66, 0), 235))
                } else if is_sounding {
                    (alpha(theme::INDIGO, 217), alpha(Color32::from_rgb(25, 52, 153), 230))
                } else {
                    (alpha(Color32::from_rgb(20, 160, 100), 166), Color32::from_white_alpha(180))
                };
                notes.rect(note, radius(6), fill, Stroke::new(1.0_f32, edge), StrokeKind::Inside);
            }
            if note.width() > 28.0 {
                notes.with_clip_rect(note).text(
                    Pos2::new(note.left() + 6.0, note.center().y),
                    Align2::LEFT_CENTER,
                    format!("{} · {}", self.doc.syl(g).text, note_name(Some(pitch))),
                    FontId::proportional(11.0),
                    if ghost { theme::INK_SOFT } else { Color32::from_white_alpha(240) },
                );
            }
            hits.push((g, note));
        }
        if self.drag.is_none() || !matches!(self.drag, Some(Drag::Scrub(Surface::Pitch))) {
            self.paint_playhead(&painter.with_clip_rect(Rect::from_min_max(Pos2::new(rect.left() + PITCH_GUTTER, rect.top()), rect.max)), rect, PITCH_GUTTER);
        } else {
            self.paint_playhead(&painter, rect, PITCH_GUTTER);
        }

        // Input
        let gutter_rect = Rect::from_min_max(rect.min, Pos2::new(rect.left() + PITCH_GUTTER, rect.bottom()));
        let _ = gutter_rect;
        self.view_wheel(ui, rect, PITCH_GUTTER, response.hovered());
        let (pressed, down, pos, dt) = ui.input(|i| {
            (i.pointer.primary_pressed(), i.pointer.primary_down(), i.pointer.latest_pos(), i.stable_dt as f64)
        });
        if pressed && response.hovered() && self.drag.is_none() {
            if let Some(p) = pos {
                self.focus = Focus::Pitch;
                if let Some(&(g, _)) = hits.iter().rev().find(|(_, r)| r.contains(p)) {
                    self.select(g, TargetKind::Syllable, false, false);
                    self.drag = Some(Drag::Pitch);
                    self.doc.push_undo();
                    self.apply_pitch_drag(rect, p.y);
                } else {
                    self.drag = Some(Drag::Scrub(Surface::Pitch));
                    let t = self.x2t(rect, PITCH_GUTTER, p.x);
                    self.last_scrub_x = Some(p.x);
                    self.seek(t, None);
                }
            }
        }
        match self.drag {
            Some(Drag::Pitch) => {
                if down {
                    if let Some(p) = pos {
                        self.apply_pitch_drag(rect, p.y);
                    }
                } else {
                    self.drag = None;
                }
            }
            Some(Drag::Scrub(Surface::Pitch)) => {
                if down {
                    if let Some(p) = pos {
                        if self.edge_scroll(rect, PITCH_GUTTER, p.x, dt) {
                            let t = self.x2t(rect, PITCH_GUTTER, p.x.clamp(rect.left() + PITCH_GUTTER, rect.right()));
                            self.seek(t, None);
                        } else {
                            let t = self.x2t(rect, PITCH_GUTTER, p.x);
                            self.scrub_to(p.x, t);
                        }
                    }
                } else {
                    self.drag = None;
                }
            }
            _ => {}
        }
    }

    fn apply_pitch_drag(&mut self, rect: Rect, y: f32) {
        let pitch = self.y_to_pitch(rect, y);
        if let Some(g) = self.doc.selected() {
            // The undo entry was taken when the drag began, so edit the note directly.
            if self.doc.syl(g).pitch != Some(pitch) {
                self.doc.syl_mut(g).pitch = Some(pitch);
                self.doc.revision += 1;
                self.doc.mark_dirty();
                self.pitch_ghost = pitch;
            }
        }
    }
}

enum Hit {
    StartHandle,
    EndHandle,
    Block,
}

fn is_timeline_drag(d: Drag) -> bool {
    matches!(d, Drag::Start(_) | Drag::End(_) | Drag::MoveBlock { .. } | Drag::Scrub(Surface::Timeline))
}
