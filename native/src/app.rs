//! Application state, transport, file handling and the surrounding panels.

use crate::audio::{self, Engine, GuideNote, MixSettings, Peaks, Track};
use crate::lyrics;
use crate::model::*;
use crate::project;
use crate::theme;
use eframe::egui::{self, Align, Key, RichText};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver};
use std::sync::Arc;
use std::time::{Duration, Instant};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Focus {
    Timing,
    Pitch,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Surface {
    Timeline,
    Pitch,
}

#[derive(Clone, Copy, Debug)]
pub enum Drag {
    Scrub(Surface),
    Start(usize),
    End(usize),
    MoveBlock { g: usize, origin: f64, start0: f64, end0: Option<f64> },
    Pitch,
    Overview { grab_offset: f64 },
}

#[derive(Clone, Copy)]
pub struct View {
    pub start: f64,
    pub duration: f64,
}

pub struct AudioLoad {
    pub track: Arc<Track>,
    pub peaks: Arc<Peaks>,
    pub name: String,
    pub size: u64,
    pub path: Option<PathBuf>,
    pub bytes: Option<Arc<Vec<u8>>>,
    pub restore_time: f64,
}

enum AudioSource {
    Path(PathBuf),
    Bytes { bytes: Vec<u8>, name: String },
}

#[derive(Clone, Copy)]
enum DialogKind {
    OpenAudio,
    ImportProject,
    ExportProject { embed: bool },
}

#[derive(Default)]
pub struct FieldText {
    key: Option<(String, u64)>,
    pub start: String,
    pub end: String,
    pub pitch: String,
}

pub struct App {
    pub doc: Doc,
    pub engine: Engine,
    pub track: Option<Arc<Track>>,
    pub peaks: Option<Arc<Peaks>>,
    pub audio_path: Option<PathBuf>,
    pub audio_bytes: Option<Arc<Vec<u8>>>,
    pub view: View,
    pub drag: Option<Drag>,
    pub focus: Focus,
    pub pitch_ghost: f64,
    pub now: f64,
    pub status: String,
    pub fields: FieldText,
    pub lyrics_cache: crate::lyrics_view::Cache,
    pub scroll_to_active: bool,
    pub last_active_line: Option<usize>,
    pub last_follow: Option<usize>,
    pub last_scrub_x: Option<f32>,
    last_slider_seek: Option<f64>,

    loader: Option<Receiver<Result<AudioLoad, String>>>,
    dialog: Option<(DialogKind, Receiver<Option<PathBuf>>)>,
    embed_audio: bool,
    confirm_clear: bool,
    last_notes_revision: u64,
    last_mix: Option<MixSettings>,
    last_loop: Option<(f64, f64)>,
    last_save_revision: u64,
    changed_at: Instant,
    keybind_text: HashMap<String, String>,
    last_signature: String,
}

impl App {
    pub fn new(cc: &eframe::CreationContext<'_>) -> Self {
        theme::install(&cc.egui_ctx);
        let engine = Engine::start();
        let mut app = App {
            doc: Doc::default(),
            engine,
            track: None,
            peaks: None,
            audio_path: None,
            audio_bytes: None,
            view: View { start: 0.0, duration: 10.0 },
            drag: None,
            focus: Focus::Timing,
            pitch_ghost: 60.0,
            now: 0.0,
            status: String::new(),
            fields: FieldText::default(),
            lyrics_cache: Default::default(),
            scroll_to_active: false,
            last_active_line: None,
            last_follow: None,
            last_scrub_x: None,
            last_slider_seek: None,
            loader: None,
            dialog: None,
            embed_audio: true,
            confirm_clear: false,
            last_notes_revision: u64::MAX,
            last_mix: None,
            last_loop: None,
            last_save_revision: 0,
            changed_at: Instant::now(),
            keybind_text: HashMap::new(),
            last_signature: String::new(),
        };
        if let Some(err) = app.engine.error.clone() {
            app.status = format!("No sound output: {err}");
        }
        let args: Vec<PathBuf> = std::env::args_os().skip(1).map(PathBuf::from).collect();
        if args.is_empty() {
            app.restore_autosave();
        }
        // Files named on the command line: a project (.json) and/or an audio file.
        for path in args {
            let is_project = path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("json"));
            if is_project {
                app.import_project(&path);
            } else {
                app.start_audio_load(AudioSource::Path(path), 0.0);
            }
        }
        app.last_save_revision = app.doc.dirty_revision;
        app
    }

    // --- loading and saving ------------------------------------------------

    fn restore_autosave(&mut self) {
        let Some(path) = project::autosave_path() else { return };
        if !path.exists() {
            return;
        }
        match project::read_project(&path) {
            Ok(loaded) => {
                let restore = loaded.file.playback.current_time;
                let audio_path = loaded.file.audio_path.clone().map(PathBuf::from);
                self.adopt_project(loaded.file.project);
                if let Some(p) = audio_path.filter(|p| p.exists()) {
                    self.start_audio_load(AudioSource::Path(p), restore);
                }
                self.status = "Restored your last session.".into();
            }
            Err(_) => {}
        }
    }

    fn adopt_project(&mut self, project: Project) {
        self.doc = Doc::from_project(project, 0.0);
        self.track = None;
        self.peaks = None;
        self.audio_path = None;
        self.audio_bytes = None;
        self.engine.set_track(None);
        self.last_mix = None;
        self.last_notes_revision = u64::MAX;
        self.pitch_ghost = 60.0;
        self.fit_view_to_song();
        self.sync_pitch_ghost();
    }

    fn start_audio_load(&mut self, source: AudioSource, restore_time: f64) {
        let (tx, rx) = channel();
        self.loader = Some(rx);
        self.status = "Loading audio…".into();
        std::thread::spawn(move || {
            let result = (|| {
                let (track, name, size, path, bytes) = match source {
                    AudioSource::Path(path) => {
                        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                        let track = audio::decode_file(&path)?;
                        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                        (track, name, size, Some(path), None)
                    }
                    AudioSource::Bytes { bytes, name } => {
                        let ext = std::path::Path::new(&name).extension().and_then(|e| e.to_str()).map(str::to_string);
                        let size = bytes.len() as u64;
                        let track = audio::decode_bytes(bytes.clone(), ext.as_deref())?;
                        // Prefer a saved copy on disk over holding the file in memory.
                        match project::cache_audio(&bytes, &name) {
                            Some(saved) => (track, name, size, Some(saved), None),
                            None => (track, name, size, None, Some(Arc::new(bytes))),
                        }
                    }
                };
                let peaks = Peaks::build(&track);
                Ok(AudioLoad {
                    track: Arc::new(track),
                    peaks: Arc::new(peaks),
                    name,
                    size,
                    path,
                    bytes,
                    restore_time,
                })
            })();
            let _ = tx.send(result);
        });
    }

    fn finish_audio_load(&mut self, load: AudioLoad) {
        let duration = load.track.duration();
        self.engine.set_track(Some(load.track.clone()));
        self.track = Some(load.track);
        self.peaks = Some(load.peaks);
        self.audio_path = load.path;
        self.audio_bytes = load.bytes;
        self.doc.project.audio_meta = AudioMeta {
            name: load.name.clone(),
            kind: self
                .audio_path
                .as_deref()
                .map_or("audio/*", project::mime_for)
                .to_string(),
            size: load.size,
        };
        self.doc.set_audio_duration(duration);
        self.engine.seek(load.restore_time.clamp(0.0, duration));
        self.last_mix = None;
        self.last_notes_revision = u64::MAX;
        self.fit_view_to_song();
        self.status = format!("Loaded {}.", load.name);
        // Remember this audio for the next launch.
        self.doc.mark_dirty();
        self.changed_at = Instant::now();
    }

    fn spawn_dialog(&mut self, kind: DialogKind) {
        if self.dialog.is_some() {
            return;
        }
        let (tx, rx) = channel();
        let suggested = project::sanitize_filename(
            if !self.doc.project.project_name.is_empty() {
                &self.doc.project.project_name
            } else if !self.doc.project.audio_meta.name.is_empty() {
                &self.doc.project.audio_meta.name
            } else {
                "karaoke-project"
            },
        );
        std::thread::spawn(move || {
            let picked = match kind {
                DialogKind::OpenAudio => rfd::FileDialog::new()
                    .set_title("Open audio")
                    .add_filter("Audio", &["mp3", "wav", "flac", "ogg", "oga", "m4a", "aac", "mp4", "mka"])
                    .pick_file(),
                DialogKind::ImportProject => rfd::FileDialog::new()
                    .set_title("Import project")
                    .add_filter("Project", &["json"])
                    .pick_file(),
                DialogKind::ExportProject { .. } => rfd::FileDialog::new()
                    .set_title("Export project")
                    .add_filter("Project", &["json"])
                    .set_file_name(format!("{suggested}.json"))
                    .save_file(),
            };
            let _ = tx.send(picked);
        });
        self.dialog = Some((kind, rx));
    }

    fn poll_background(&mut self, ctx: &egui::Context) {
        if let Some(rx) = &self.loader {
            match rx.try_recv() {
                Ok(Ok(load)) => {
                    self.loader = None;
                    self.finish_audio_load(load);
                }
                Ok(Err(e)) => {
                    self.loader = None;
                    self.status = e;
                }
                Err(std::sync::mpsc::TryRecvError::Empty) => ctx.request_repaint_after(Duration::from_millis(80)),
                Err(_) => self.loader = None,
            }
        }
        let finished = match &self.dialog {
            Some((kind, rx)) => match rx.try_recv() {
                Ok(path) => Some((*kind, path)),
                Err(std::sync::mpsc::TryRecvError::Empty) => {
                    ctx.request_repaint_after(Duration::from_millis(120));
                    None
                }
                Err(_) => Some((*kind, None)),
            },
            None => None,
        };
        if let Some((kind, path)) = finished {
            self.dialog = None;
            if let Some(path) = path {
                match kind {
                    DialogKind::OpenAudio => self.start_audio_load(AudioSource::Path(path), 0.0),
                    DialogKind::ImportProject => self.import_project(&path),
                    DialogKind::ExportProject { embed } => self.export_project(&path, embed),
                }
            }
        }
    }

    fn import_project(&mut self, path: &std::path::Path) {
        match project::read_project(path) {
            Ok(loaded) => {
                let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                let restore = loaded.file.playback.current_time;
                let audio_path = loaded.file.audio_path.clone().map(PathBuf::from);
                self.adopt_project(loaded.file.project);
                if let Some((bytes, audio_name)) = loaded.embedded {
                    let audio_name = if audio_name.is_empty() { "embedded-audio".to_string() } else { audio_name };
                    self.start_audio_load(AudioSource::Bytes { bytes, name: audio_name }, restore);
                    self.status = format!("Imported {name}.");
                } else if let Some(p) = audio_path.filter(|p| p.exists()) {
                    self.start_audio_load(AudioSource::Path(p), restore);
                } else {
                    self.status = format!("Imported {name}. Open the audio file to play it.");
                }
            }
            Err(e) => self.status = e,
        }
    }

    fn project_file(&self) -> ProjectFile {
        let project = self.doc.project.clone();
        ProjectFile {
            updated_at: project::iso_now(),
            playback: Playback { current_time: self.now, was_playing: self.engine.is_playing() },
            project,
            audio_path: self.audio_path.as_ref().map(|p| p.to_string_lossy().into_owned()),
            ..ProjectFile::default()
        }
    }

    fn export_project(&mut self, path: &std::path::Path, embed: bool) {
        let mut file = self.project_file();
        file.audio_path = None;
        if embed {
            let name = self.doc.project.audio_meta.name.clone();
            let mime = self.doc.project.audio_meta.kind.clone();
            let bytes = match (&self.audio_bytes, &self.audio_path) {
                (Some(b), _) => Some((**b).clone()),
                (None, Some(p)) => std::fs::read(p).ok(),
                _ => None,
            };
            if let Some(bytes) = bytes {
                file.audio = Some(project::encode_audio(&bytes, &name, &mime));
            }
        }
        file.export_meta = Some(serde_json::json!({
            "includesEmbeddedAudio": file.audio.is_some(),
            "syncedStarts": self.doc.synced_count(),
            "totalSyllables": self.doc.len(),
        }));
        let with_audio = file.audio.is_some();
        match project::write_project(path, &file) {
            Ok(()) => {
                let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                self.status = format!("Exported {name}{}", if with_audio { " with audio." } else { "." });
            }
            Err(e) => self.status = e,
        }
    }

    fn save_now(&mut self) {
        self.last_save_revision = self.doc.dirty_revision;
        if let Some(path) = project::autosave_path() {
            let _ = project::write_project(&path, &self.project_file());
        }
    }

    fn autosave(&mut self) {
        if self.doc.dirty_revision == self.last_save_revision || self.changed_at.elapsed() < Duration::from_millis(900) {
            return;
        }
        self.last_save_revision = self.doc.dirty_revision;
        if let Some(path) = project::autosave_path() {
            let _ = project::write_project(&path, &self.project_file());
        }
    }

    fn clear_project(&mut self) {
        self.adopt_project(Project::default());
        self.doc.undo.clear();
        if let Some(path) = project::autosave_path() {
            let _ = std::fs::remove_file(path);
        }
        self.status = "Project cleared.".into();
    }

    // --- view ---------------------------------------------------------------

    pub fn full_duration(&self) -> f64 {
        self.doc.max_time().max(self.engine.duration())
    }

    pub fn clamp_view(&mut self) {
        let full = self.full_duration();
        self.view.duration = self.view.duration.clamp(VIEW_MIN_DURATION, full);
        self.view.start = self.view.start.clamp(0.0, (full - self.view.duration).max(0.0));
    }

    pub fn fit_view_to_song(&mut self) {
        self.view.start = 0.0;
        self.view.duration = self.full_duration();
        self.clamp_view();
    }

    pub fn fit_view_to_target(&mut self) {
        let Some((start, end)) = self.doc.target_range() else {
            self.fit_view_to_song();
            return;
        };
        let duration = (end - start).max(VIEW_MIN_DURATION);
        let padding = (duration * 0.35).max(0.12);
        self.view.start = start - padding;
        self.view.duration = duration + padding * 2.0;
        self.clamp_view();
    }

    pub fn zoom_view(&mut self, factor: f64, anchor_ratio: f64) {
        let anchor = self.view.start + anchor_ratio * self.view.duration;
        let full = self.full_duration();
        self.view.duration = (self.view.duration * factor).clamp(VIEW_MIN_DURATION, full);
        self.view.start = anchor - anchor_ratio * self.view.duration;
        self.clamp_view();
    }

    pub fn ensure_time_in_view(&mut self, time: f64) {
        let pad = self.view.duration * 0.12;
        if time < self.view.start + pad {
            self.view.start = time - pad;
        } else if time > self.view.start + self.view.duration - pad {
            self.view.start = time - self.view.duration + pad;
        }
        self.clamp_view();
    }

    // --- transport ------------------------------------------------------------

    pub fn toggle_play(&mut self) {
        self.doc.mark_dirty();
        self.changed_at = Instant::now();
        if self.engine.is_playing() {
            self.engine.pause();
        } else {
            self.engine.play();
        }
    }

    pub fn seek(&mut self, time: f64, play: Option<bool>) {
        let limit = self.engine.duration().max(0.0);
        self.doc.mark_dirty();
        self.changed_at = Instant::now();
        self.engine.seek(time.clamp(0.0, limit));
        match play {
            Some(true) => self.engine.play(),
            Some(false) => {
                if self.engine.is_playing() {
                    self.engine.pause();
                }
            }
            None => {}
        }
    }

    pub fn jump_to_target(&mut self) {
        let Some((start, _)) = self.doc.target_range() else { return };
        self.ensure_time_in_view(start);
        let play = self.doc.project.settings.auto_play_on_jump;
        let pre = self.doc.project.settings.pre_roll;
        self.seek((start - pre).max(0.0), Some(play));
    }

    // --- selection and editing hooks -----------------------------------------

    pub fn sync_pitch_ghost(&mut self) {
        if let Some(g) = self.doc.selected() {
            if let Some(p) = self.doc.syl(g).pitch {
                self.pitch_ghost = p;
            }
        }
    }

    pub fn ghost_pitch(&self) -> f64 {
        if let Some(g) = self.doc.selected() {
            if let Some(p) = self.doc.syl(g).pitch {
                return p;
            }
        }
        let range = &self.doc.project.settings.pitch_range;
        let fallback = ((range.min + range.max) / 2.0).round();
        if self.pitch_ghost.is_finite() { self.pitch_ghost.clamp(24.0, 108.0) } else { fallback }
    }

    pub fn select(&mut self, g: usize, kind: TargetKind, ensure_view: bool, scroll: bool) {
        self.doc.select(g, kind);
        self.sync_pitch_ghost();
        if scroll {
            self.scroll_to_active = true;
        }
        let settings = &self.doc.project.settings;
        if ensure_view && !settings.select_without_seek {
            if let Some(start) = self.doc.syl(g).start {
                self.ensure_time_in_view(start);
            }
        }
    }

    pub fn select_relative(&mut self, delta: isize) {
        if self.doc.len() == 0 {
            return;
        }
        let current = self.doc.selected().unwrap_or(0) as isize;
        let target = (current + delta).clamp(0, self.doc.len() as isize - 1) as usize;
        self.select(target, TargetKind::Syllable, true, true);
    }

    pub fn timing_changed(&mut self, ensure: Option<f64>) {
        if let Some(t) = ensure {
            self.ensure_time_in_view(t);
        }
        self.changed_at = Instant::now();
    }

    pub fn set_selected_start(&mut self, time: f64) {
        if let Some(g) = self.doc.selected() {
            let stored = self.doc.set_start(g, time, true);
            self.timing_changed(stored);
        }
    }

    pub fn set_selected_end(&mut self, time: f64) {
        if let Some(g) = self.doc.selected() {
            let stored = self.doc.set_end(g, time);
            self.timing_changed(stored.or(self.doc.syl(g).start));
        }
    }

    pub fn tap(&mut self) {
        let Some(g) = self.doc.selected() else { return };
        self.set_selected_start(self.now);
        if g + 1 < self.doc.len() {
            self.select(g + 1, TargetKind::Syllable, true, true);
        }
    }

    pub fn adjust_pitch(&mut self, delta: f64) {
        let Some(g) = self.doc.selected() else { return };
        let base = self.doc.syl(g).pitch.unwrap_or_else(|| self.ghost_pitch());
        self.set_pitch(g, Some(base + delta));
    }

    pub fn set_pitch(&mut self, g: usize, pitch: Option<f64>) {
        if self.doc.set_pitch(g, pitch) {
            if let Some(p) = self.doc.syl(g).pitch {
                self.pitch_ghost = p;
            }
            self.changed_at = Instant::now();
        }
    }

    pub fn build_lyrics(&mut self) {
        if self.doc.synced_count() > 0 {
            self.doc.push_undo();
        }
        let previous = lyrics::snapshot(&self.doc.project.structure);
        let markup = self.doc.project.lyrics_markup.clone();
        self.doc.project.structure = lyrics::parse(&markup, &self.doc.project.settings.preprocessing, &previous);
        self.doc.last_end_gesture = None;
        self.doc.rebuild_index();
        if self.engine.duration() <= 0.0 {
            self.fit_view_to_song();
        }
        self.changed_at = Instant::now();
    }

    pub fn undo(&mut self) {
        if self.doc.perform_undo() {
            self.sync_pitch_ghost();
            self.changed_at = Instant::now();
            self.status = "Undid the last change.".into();
        }
    }

    // --- keyboard ----------------------------------------------------------

    fn key_token(key: Key) -> String {
        match key {
            Key::Space => "space".into(),
            Key::Enter => "enter".into(),
            Key::Backspace => "backspace".into(),
            Key::Delete => "delete".into(),
            Key::ArrowUp => "arrowup".into(),
            Key::ArrowDown => "arrowdown".into(),
            Key::ArrowLeft => "arrowleft".into(),
            Key::ArrowRight => "arrowright".into(),
            Key::Tab => "tab".into(),
            Key::Escape => "escape".into(),
            other => other.symbol_or_name().to_lowercase(),
        }
    }

    fn handle_keys(&mut self, ctx: &egui::Context) {
        if ctx.wants_keyboard_input() {
            return;
        }
        let mut lookup: HashMap<String, &'static str> = HashMap::new();
        for (action, _) in ACTIONS {
            if let Some(keys) = self.doc.project.settings.keybinds.get(*action) {
                for key in keys {
                    lookup.entry(key.to_lowercase()).or_insert(*action);
                }
            }
        }
        let mut triggered: Vec<(&'static str, bool)> = Vec::new();
        let mut undo = false;
        ctx.input_mut(|input| {
            let mut consumed = Vec::new();
            for (i, event) in input.events.iter().enumerate() {
                if let egui::Event::Key { key, pressed: true, modifiers, .. } = event {
                    if modifiers.command && *key == Key::Z {
                        undo = true;
                        consumed.push(i);
                        continue;
                    }
                    if modifiers.command || modifiers.alt {
                        continue;
                    }
                    if let Some(action) = lookup.get(&Self::key_token(*key)) {
                        triggered.push((action, modifiers.shift));
                        consumed.push(i);
                    }
                }
            }
            // Take the keys away from buttons so Space cannot also press whatever was clicked last.
            for i in consumed.into_iter().rev() {
                input.events.remove(i);
            }
        });
        if undo {
            self.undo();
        }
        for (action, shift) in triggered {
            self.run_action(action, shift);
        }
    }

    fn run_action(&mut self, action: &str, shift: bool) {
        let s = self.doc.project.settings.clone();
        match action {
            "tapTiming" => self.tap(),
            "playPause" => self.toggle_play(),
            "setStart" => self.set_selected_start(self.now),
            "setEnd" => self.set_selected_end(self.now),
            "seekBackward" => self.seek(self.now - s.seek_step, Some(false)),
            "seekForward" => self.seek(self.now + s.seek_step, Some(false)),
            "nudgeBack" => self.nudge(-s.nudge_step),
            "nudgeForward" => self.nudge(s.nudge_step),
            "clearTiming" => self.clear_selected_timing(false),
            "clearOrPitch" => {
                if self.focus == Focus::Pitch {
                    if let Some(g) = self.doc.selected() {
                        self.set_pitch(g, None);
                    }
                } else if shift {
                    if let Some(g) = self.doc.selected() {
                        self.doc.clear_timings_forward(g);
                        self.timing_changed(None);
                    }
                } else {
                    self.clear_selected_timing(true);
                }
            }
            "selectSounding" => {
                if let Some(g) = self.doc.sounding_at(self.now) {
                    self.select(g, TargetKind::Syllable, true, true);
                }
            }
            "jump" => self.jump_to_target(),
            "pitchUp" => self.adjust_pitch(if shift { 12.0 } else { 1.0 }),
            "pitchDown" => self.adjust_pitch(if shift { -12.0 } else { -1.0 }),
            "selectBack" => self.select_relative(-1),
            "selectForward" => self.select_relative(1),
            _ => {}
        }
    }

    pub fn nudge(&mut self, delta: f64) {
        if let Some(g) = self.doc.selected() {
            if let Some(stored) = self.doc.nudge_start(g, delta) {
                self.timing_changed(Some(stored));
            }
        }
    }

    pub fn clear_selected_timing(&mut self, move_previous: bool) {
        let Some(g) = self.doc.selected() else { return };
        self.doc.clear_timing(g);
        self.timing_changed(None);
        if move_previous && g > 0 {
            self.select(g - 1, TargetKind::Syllable, false, true);
        }
    }

    // --- per-frame engine sync ---------------------------------------------

    fn sync_engine(&mut self) {
        let s = &self.doc.project.settings;
        let mix = MixSettings {
            rate: s.playback_rate.clamp(0.1, 2.0),
            music_volume: s.music_volume,
            metronome_enabled: s.metronome.enabled,
            bpm: s.metronome.bpm,
            offset: s.metronome.offset,
            beats_per_bar: s.metronome.beats_per_bar,
            metronome_volume: s.metronome.volume,
            guide_enabled: s.guide_synth.enabled,
            guide_volume: s.guide_synth.volume,
        };
        if self.last_mix.as_ref() != Some(&mix) {
            self.engine.set_settings(mix.clone());
            self.last_mix = Some(mix);
        }
        if self.last_notes_revision != self.doc.revision {
            self.last_notes_revision = self.doc.revision;
            let notes = self
                .doc
                .index
                .timed
                .iter()
                .filter_map(|&g| {
                    let pitch = self.doc.syl(g).pitch?;
                    let start = self.doc.syl(g).start?;
                    let end = self.doc.effective_end(g)?;
                    Some(GuideNote { start, end, midi: pitch })
                })
                .collect();
            self.engine.set_notes(notes);
        }
        let region = if s.loop_selection {
            self.doc.target_range().map(|(start, end)| {
                let a = (start - s.pre_roll).max(0.0);
                let b = (end + s.post_roll).min(self.full_duration());
                (a, b)
            })
        } else {
            None
        };
        if region != self.last_loop {
            self.engine.set_loop(region);
            self.last_loop = region;
        }
    }

    fn follow_playback(&mut self) {
        if !self.engine.is_playing() {
            self.last_follow = None;
            return;
        }
        let s = &self.doc.project.settings;
        if s.follow_sounding {
            if let Some(g) = self.doc.sounding_at(self.now) {
                if self.last_follow != Some(g) {
                    self.last_follow = Some(g);
                    self.doc.select(g, TargetKind::Syllable);
                    self.sync_pitch_ghost();
                    if let Some(start) = self.doc.syl(g).start {
                        self.ensure_time_in_view(start);
                    }
                    self.scroll_to_active = true;
                }
            }
        }
        if self.doc.project.settings.auto_scroll_window && self.drag.is_none() {
            let end = self.view.start + self.view.duration;
            if self.now > end - self.view.duration * 0.08 || self.now < self.view.start {
                self.view.start = self.now - self.view.duration * 0.1;
                self.clamp_view();
            }
        }
    }

    /// Settings, names and lyrics text are edited straight from widgets, so notice them by value.
    fn note_setting_changes(&mut self) {
        let p = &self.doc.project;
        let signature = format!(
            "{}\u{1}{}\u{1}{}\u{1}{}",
            serde_json::to_string(&p.settings).unwrap_or_default(),
            p.project_name,
            p.lyrics_markup,
            p.selection.syllable_id.as_deref().unwrap_or("")
        );
        if signature != self.last_signature {
            if !self.last_signature.is_empty() {
                self.doc.mark_dirty();
                self.changed_at = Instant::now();
            }
            self.last_signature = signature;
        }
    }

    fn refresh_fields(&mut self) {
        let key = (self.doc.project.selection.syllable_id.clone().unwrap_or_default(), self.doc.revision);
        if self.fields.key.as_ref() == Some(&key) {
            return;
        }
        self.fields.key = Some(key);
        match self.doc.selected() {
            Some(g) => {
                let s = self.doc.syl(g);
                self.fields.start = s.start.map(|v| format!("{v:.3}")).unwrap_or_default();
                self.fields.end = s.end.map(|v| format!("{v:.3}")).unwrap_or_default();
                self.fields.pitch = s.pitch.map(|v| format!("{v}")).unwrap_or_default();
            }
            None => {
                self.fields.start.clear();
                self.fields.end.clear();
                self.fields.pitch.clear();
            }
        }
    }

    fn apply_fields(&mut self) {
        let Some(g) = self.doc.selected() else { return };
        let parse = |t: &str| t.trim().parse::<f64>().ok().filter(|v| v.is_finite());
        let start = parse(&self.fields.start);
        let end = parse(&self.fields.end);
        let pitch = parse(&self.fields.pitch);
        self.doc.apply_fields(g, start, end, pitch);
        self.sync_pitch_ghost();
        self.fields.key = None;
        self.timing_changed(self.doc.syl(g).start);
    }

    // --- panels --------------------------------------------------------------

    fn top_bar(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            ui.label(RichText::new("Syllable Karaoke Studio").heading().color(theme::INK));
            ui.add_space(8.0);
            ui.add(
                egui::TextEdit::singleline(&mut self.doc.project.project_name)
                    .hint_text("Project name")
                    .desired_width(180.0),
            );
            if ui.button("Open audio").clicked() {
                self.spawn_dialog(DialogKind::OpenAudio);
            }
            if ui.button("Import project").clicked() {
                self.spawn_dialog(DialogKind::ImportProject);
            }
            if ui.button("Export project").clicked() {
                let embed = self.embed_audio;
                self.spawn_dialog(DialogKind::ExportProject { embed });
            }
            ui.checkbox(&mut self.embed_audio, "Include audio in export");
            if ui.button("Clear project").clicked() {
                self.confirm_clear = true;
            }
            ui.with_layout(egui::Layout::right_to_left(Align::Center), |ui| {
                ui.label(RichText::new(format!("Built {}", project::build_stamp())).small().color(theme::INK_SOFT));
                ui.label(RichText::new(&self.status).color(theme::INK_SOFT));
            });
        });
    }

    fn transport_bar(&mut self, ui: &mut egui::Ui) {
        let duration = self.full_duration().max(1.0);
        let step = self.doc.project.settings.seek_step;
        ui.horizontal_wrapped(|ui| {
            let label = if self.engine.is_playing() { "Pause" } else { "Play" };
            if ui.add_sized([64.0, 26.0], egui::Button::new(label)).clicked() {
                self.toggle_play();
            }
            if ui.button(format!("-{step}s")).clicked() {
                self.seek(self.now - step, Some(false));
            }
            if ui.button(format!("+{step}s")).clicked() {
                self.seek(self.now + step, Some(false));
            }
            if ui.button("Jump to selection").clicked() {
                self.jump_to_target();
            }
            ui.toggle_value(&mut self.doc.project.settings.loop_selection, "Loop selection");
            ui.separator();
            if ui.button("Previous").clicked() {
                self.select_relative(-1);
            }
            if ui.button("Next").clicked() {
                self.select_relative(1);
            }
            ui.separator();
            if ui.button("Start at playhead").clicked() {
                self.set_selected_start(self.now);
            }
            if ui.button("End at playhead").clicked() {
                self.set_selected_end(self.now);
            }
            if ui.button("Tap start, then next").clicked() {
                self.tap();
            }
            if ui.button("Clear timing").clicked() {
                self.clear_selected_timing(false);
            }
            if ui.button("Clear this and later timing").clicked() {
                if let Some(g) = self.doc.selected() {
                    self.doc.clear_timings_forward(g);
                    self.timing_changed(None);
                }
            }
            if ui.button("Clear pitch").clicked() {
                if let Some(g) = self.doc.selected() {
                    self.set_pitch(g, None);
                }
            }
        });
        ui.horizontal(|ui| {
            ui.monospace(clock(self.now, true));
            let mut t = self.now;
            // Leave room for the remaining time and the speed control on the right.
            ui.spacing_mut().slider_width = (ui.available_width() - 400.0).max(100.0);
            let slider = egui::Slider::new(&mut t, 0.0..=duration).show_value(false);
            let response = ui.add(slider);
            // Holding the handle still must not seek again: the slider reports a change every
            // frame while the playhead moves under it, and each seek restarts the same instant.
            if response.changed() && self.last_slider_seek.map_or(true, |last| (last - t).abs() > 1e-6) {
                self.last_slider_seek = Some(t);
                self.seek(t, None);
            }
            if !response.dragged() && !response.is_pointer_button_down_on() {
                self.last_slider_seek = None;
            }
            ui.monospace(format!("-{}", clock((duration - self.now).max(0.0), true)));
            ui.separator();
            ui.label("Speed");
            ui.spacing_mut().slider_width = 130.0;
            let rate = &mut self.doc.project.settings.playback_rate;
            ui.add(egui::Slider::new(rate, 0.25..=1.5).fixed_decimals(2).suffix("x"));
        });
    }


    // --- collapsible sections ----------------------------------------------

    pub fn is_collapsed(&self, group: &str, id: &str, default: bool) -> bool {
        self.doc
            .project
            .settings
            .ui
            .get(group)
            .and_then(|g| g.get(id))
            .and_then(|v| v.as_bool())
            .unwrap_or(default)
    }

    fn set_collapsed(&mut self, group: &str, id: &str, value: bool) {
        let ui = &mut self.doc.project.settings.ui;
        if !ui.is_object() {
            *ui = serde_json::json!({});
        }
        let root = ui.as_object_mut().unwrap();
        let entry = root.entry(group.to_string()).or_insert_with(|| serde_json::json!({}));
        if !entry.is_object() {
            *entry = serde_json::json!({});
        }
        entry.as_object_mut().unwrap().insert(id.to_string(), serde_json::json!(value));
    }

    /// A heading row with an open/closed arrow. Returns true while the section is open.
    fn heading(
        &mut self,
        ui: &mut egui::Ui,
        group: &str,
        id: &str,
        title: &str,
        default_collapsed: bool,
        right: impl FnOnce(&mut Self, &mut egui::Ui),
    ) -> bool {
        let collapsed = self.is_collapsed(group, id, default_collapsed);
        let mut toggled = false;
        ui.horizontal(|ui| {
            let (arrow, response) = ui.allocate_exact_size(egui::vec2(14.0, 18.0), egui::Sense::click());
            let c = arrow.center();
            let points = if collapsed {
                vec![c + egui::vec2(-3.0, -5.0), c + egui::vec2(-3.0, 5.0), c + egui::vec2(4.0, 0.0)]
            } else {
                vec![c + egui::vec2(-5.0, -3.0), c + egui::vec2(5.0, -3.0), c + egui::vec2(0.0, 4.0)]
            };
            ui.painter().add(egui::Shape::convex_polygon(points, theme::INK_SOFT, egui::Stroke::NONE));
            toggled |= response.clicked();
            let label = ui.add(egui::Button::new(RichText::new(title).strong()).frame(false));
            toggled |= label.clicked();
            right(self, ui);
        });
        if toggled {
            self.set_collapsed(group, id, !collapsed);
        }
        // After a click the section is open exactly when it was closed before.
        if toggled { collapsed } else { !collapsed }
    }

    /// A sidebar group: heading plus a body that can be folded away.
    fn panel(
        &mut self,
        ui: &mut egui::Ui,
        id: &str,
        title: &str,
        default_collapsed: bool,
        body: impl FnOnce(&mut Self, &mut egui::Ui),
    ) {
        if self.heading(ui, "collapsedPanels", id, title, default_collapsed, |_, _| {}) {
            ui.indent(id, |ui| body(self, ui));
        }
        ui.add_space(4.0);
    }

    fn side_panel(&mut self, ui: &mut egui::Ui) {
        egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
            self.panel(ui, "lyrics-source", "Lyrics", false, |app, ui| {
                ui.add(
                    egui::TextEdit::multiline(&mut app.doc.project.lyrics_markup)
                        .hint_text("Paste lyrics here. Put - between syllables, like ka-ra-o-ke.")
                        .desired_rows(10)
                        .desired_width(f32::INFINITY),
                );
                ui.horizontal(|ui| {
                    ui.label("Split words");
                    let mode = &mut app.doc.project.settings.preprocessing.split_mode;
                    egui::ComboBox::from_id_salt("split_mode")
                        .selected_text(if mode == "auto-japanese" { "Auto Japanese" } else { "Manual markup" })
                        .show_ui(ui, |ui| {
                            ui.selectable_value(mode, "manual".to_string(), "Manual markup");
                            ui.selectable_value(mode, "auto-japanese".to_string(), "Auto Japanese");
                        });
                });
                let pre = &mut app.doc.project.settings.preprocessing;
                ui.checkbox(&mut pre.exclude_double_newlines, "Skip blank lines");
                ui.checkbox(&mut pre.exclude_section_labels, "Skip [Section] labels");
                if ui.button("Build").clicked() {
                    app.build_lyrics();
                }
            });
            self.panel(ui, "playback", "Playback", false, |app, ui| {
                let s = &mut app.doc.project.settings;
                ui.add(egui::Slider::new(&mut s.pre_roll, 0.0..=2.0).text("Lead-in (s)"));
                ui.add(egui::Slider::new(&mut s.post_roll, 0.0..=2.0).text("Lead-out (s)"));
                ui.add(egui::DragValue::new(&mut s.seek_step).range(0.1..=30.0).speed(0.1).prefix("Seek step ").suffix(" s"));
                ui.add(egui::DragValue::new(&mut s.nudge_step).range(0.001..=1.0).speed(0.001).prefix("Nudge step ").suffix(" s"));
                ui.add(egui::Slider::new(&mut s.music_volume, 0.0..=1.5).text("Music volume"));
                ui.checkbox(&mut s.auto_play_on_jump, "Play after jumping");
                ui.checkbox(&mut s.auto_scroll_lyrics, "Keep lyrics in view");
                ui.checkbox(&mut s.auto_scroll_window, "Follow the playhead on the timeline");
                ui.checkbox(&mut s.follow_sounding, "Select the syllable being sung");
                ui.checkbox(&mut s.select_without_seek, "Select without moving the playhead");
            });
            self.panel(ui, "metronome", "Metronome", true, |app, ui| {
                let m = &mut app.doc.project.settings.metronome;
                ui.checkbox(&mut m.enabled, "Click on every beat");
                ui.add(egui::DragValue::new(&mut m.bpm).range(20.0..=300.0).prefix("Tempo ").suffix(" bpm"));
                ui.add(egui::DragValue::new(&mut m.offset).speed(0.005).prefix("First beat at ").suffix(" s"));
                ui.add(egui::DragValue::new(&mut m.beats_per_bar).range(1..=12).prefix("Beats per bar "));
                ui.add(egui::Slider::new(&mut m.volume, 0.0..=1.0).text("Volume"));
            });
            self.panel(ui, "guide-synth", "Guide synth", true, |app, ui| {
                let g = &mut app.doc.project.settings.guide_synth;
                ui.checkbox(&mut g.enabled, "Play the pitch of each syllable");
                ui.add(egui::Slider::new(&mut g.volume, 0.0..=1.0).text("Volume"));
            });
            self.panel(ui, "pitch-range", "Pitch range", true, |app, ui| {
                let r = &mut app.doc.project.settings.pitch_range;
                ui.add(egui::DragValue::new(&mut r.min).range(0.0..=120.0).prefix("Lowest note "));
                ui.add(egui::DragValue::new(&mut r.max).range(0.0..=127.0).prefix("Highest note "));
                if r.max < r.min + 4.0 {
                    r.max = r.min + 4.0;
                }
            });
            self.panel(ui, "keybinds", "Keys", true, |app, ui| app.keys_editor(ui));
        });
    }

    fn keys_editor(&mut self, ui: &mut egui::Ui) {
        ui.label(RichText::new("Separate keys with commas.").color(theme::INK_SOFT));
        let mut changed: Option<(String, Vec<String>)> = None;
        for (id, label) in ACTIONS {
            let current = self.doc.project.settings.keybinds.get(*id).cloned().unwrap_or_default();
            let text = self
                .keybind_text
                .entry(id.to_string())
                .or_insert_with(|| current.join(", "));
            ui.horizontal(|ui| {
                ui.label(*label);
                let response = ui.add(egui::TextEdit::singleline(text).desired_width(110.0));
                if response.lost_focus() {
                    let keys: Vec<String> = text
                        .split(',')
                        .map(|k| k.trim().to_lowercase())
                        .filter(|k| !k.is_empty())
                        .collect();
                    changed = Some((id.to_string(), keys));
                }
            });
        }
        if let Some((id, keys)) = changed {
            self.doc.project.settings.keybinds.insert(id, keys);
            self.keybind_text.clear();
        }
        if ui.button("Restore default keys").clicked() {
            self.doc.project.settings.keybinds = default_keybinds();
            self.keybind_text.clear();
        }
    }

    fn editor_row(&mut self, ui: &mut egui::Ui) {
        self.refresh_fields();
        let Some(g) = self.doc.selected() else {
            ui.label(RichText::new("Nothing selected").color(theme::INK_SOFT));
            return;
        };
        let total = self.doc.len();
        let text = self.doc.syl(g).text.clone();
        let r = self.doc.syl_ref(g);
        let target = match (self.doc.project.practice_target.kind, self.doc.project.practice_target.id.as_deref()) {
            (TargetKind::Word, _) => format!("word “{}”", self.doc.word_of(g).text),
            (TargetKind::Line, _) => format!("line {}", r.line + 1),
            _ => "syllable".to_string(),
        };
        ui.horizontal_wrapped(|ui| {
            ui.label(RichText::new(format!("#{}/{} “{}” · {}", g + 1, total, text, target)).strong());
            ui.separator();
            let mut commit = false;
            ui.label("Start");
            commit |= field(ui, &mut self.fields.start, 70.0);
            ui.label("End");
            commit |= field(ui, &mut self.fields.end, 70.0);
            ui.label("Pitch");
            commit |= field(ui, &mut self.fields.pitch, 44.0);
            let pitch = self.fields.pitch.trim().parse::<f64>().ok();
            ui.label(RichText::new(note_name(pitch)).color(theme::INK_SOFT));
            if commit {
                self.apply_fields();
            }
            if ui.button("Use next start for end").clicked() {
                self.doc.clear_end(g);
                self.timing_changed(None);
            }
            let step = self.doc.project.settings.nudge_step;
            for (label, delta) in [("-10", -step * 10.0), ("-1", -step), ("+1", step), ("+10", step * 10.0)] {
                if ui.button(label).clicked() {
                    self.nudge(delta);
                }
            }
            ui.label(RichText::new("Nudge start").color(theme::INK_SOFT));
        });
    }

    fn view_controls(&mut self, ui: &mut egui::Ui) {
        if ui.button("Zoom out").clicked() {
            self.zoom_view(1.0 / 0.8, 0.5);
        }
        if ui.button("Zoom in").clicked() {
            self.zoom_view(0.8, 0.5);
        }
        if ui.button("Fit song").clicked() {
            self.fit_view_to_song();
        }
        if ui.button("Fit selection").clicked() {
            self.fit_view_to_target();
        }
        ui.label(RichText::new(format!(
            "{} → {}",
            clock(self.view.start, true),
            clock(self.view.start + self.view.duration, true)
        ))
        .color(theme::INK_SOFT));
        if !self.engine.device_name.is_empty() {
            ui.with_layout(egui::Layout::right_to_left(Align::Center), |ui| {
                ui.label(RichText::new(format!("Sound: {}", self.engine.device_name)).color(theme::INK_SOFT));
            });
        }
    }
}

fn field(ui: &mut egui::Ui, text: &mut String, width: f32) -> bool {
    let response = ui.add(egui::TextEdit::singleline(text).desired_width(width));
    response.lost_focus()
}

pub fn clock(seconds: f64, hundredths: bool) -> String {
    let safe = if seconds.is_finite() { seconds.max(0.0) } else { 0.0 };
    let mins = (safe / 60.0).floor() as u64;
    let secs = (safe % 60.0).floor() as u64;
    if hundredths {
        let h = ((safe % 1.0) * 100.0).floor() as u64;
        format!("{mins}:{secs:02}.{h:02}")
    } else {
        format!("{mins}:{secs:02}")
    }
}

pub fn note_name(midi: Option<f64>) -> String {
    let Some(m) = midi.filter(|m| m.is_finite()) else { return "—".into() };
    let names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    let m = m.round() as i64;
    format!("{}{}", names[m.rem_euclid(12) as usize], m.div_euclid(12) - 1)
}

impl eframe::App for App {
    fn on_exit(&mut self) {
        self.now = self.engine.position();
        self.save_now();
    }

    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.poll_background(ctx);
        self.now = self.engine.position();
        if self.engine.take_ended() {
            self.now = self.engine.duration();
        }
        self.handle_keys(ctx);
        self.follow_playback();
        self.sync_engine();
        self.note_setting_changes();

        egui::TopBottomPanel::top("top_bar").show(ctx, |ui| self.top_bar(ui));
        egui::TopBottomPanel::top("transport").show(ctx, |ui| self.transport_bar(ui));
        egui::SidePanel::left("side").default_width(300.0).min_width(240.0).show(ctx, |ui| self.side_panel(ui));
        let pitch_open = !self.is_collapsed("collapsedSections", "pitch-roll", false);
        if pitch_open {
            egui::TopBottomPanel::bottom("pitch_body")
                .resizable(true)
                .default_height(240.0)
                .min_height(90.0)
                .show(ctx, |ui| self.pitch_ui(ui));
        }
        egui::TopBottomPanel::bottom("pitch_heading").show(ctx, |ui| {
            self.heading(ui, "collapsedSections", "pitch-roll", "Pitch roll", false, |_, ui| {
                ui.label(RichText::new("Drag a note up or down to change its pitch.").color(theme::INK_SOFT));
            });
        });
        egui::CentralPanel::default().show(ctx, |ui| {
            if self.heading(ui, "collapsedSections", "waveform", "Waveform", false, |app, ui| app.view_controls(ui)) {
                self.timeline_ui(ui);
                self.overview_ui(ui);
            }
            self.editor_row(ui);
            ui.separator();
            let synced = format!("{} of {} starts set", self.doc.synced_count(), self.doc.len());
            let lyrics_open = self.heading(ui, "collapsedSections", "lyrics", "Lyrics", false, |_, ui| {
                ui.label(RichText::new(synced).color(theme::INK_SOFT));
            });
            if lyrics_open {
                self.lyrics_ui(ui);
            }
        });

        if self.confirm_clear {
            egui::Window::new("Clear project")
                .collapsible(false)
                .resizable(false)
                .anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0])
                .show(ctx, |ui| {
                    ui.label("Remove the lyrics, timings and audio from the editor?");
                    ui.horizontal(|ui| {
                        if ui.button("Clear everything").clicked() {
                            self.clear_project();
                            self.confirm_clear = false;
                        }
                        if ui.button("Keep working").clicked() {
                            self.confirm_clear = false;
                        }
                    });
                });
        }

        self.autosave();
        if self.engine.is_playing() || self.drag.is_some() {
            ctx.request_repaint();
        } else if self.doc.dirty_revision != self.last_save_revision {
            ctx.request_repaint_after(Duration::from_millis(1000));
        }
    }
}
