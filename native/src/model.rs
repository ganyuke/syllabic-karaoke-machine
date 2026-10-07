//! Project data, timing rules and editing operations.
//!
//! The JSON layout matches the browser version (app id `syllable-karaoke-studio`,
//! version 4) so projects move between the two.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const APP_ID: &str = "syllable-karaoke-studio";
pub const APP_VERSION: u32 = 4;
pub const FULL_VIEW_MIN: f64 = 1.0;
pub const VIEW_MIN_DURATION: f64 = 0.3;
pub const DEFAULT_TAIL: f64 = 0.35;
pub const EPSILON: f64 = 0.01;
pub const MAX_UNDO: usize = 60;

pub fn round_time(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Syllable {
    pub id: String,
    pub text: String,
    pub start: Option<f64>,
    pub end: Option<f64>,
    pub pitch: Option<f64>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Word {
    pub id: String,
    pub raw: String,
    pub text: String,
    pub show_joiners: bool,
    pub syllables: Vec<Syllable>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Line {
    pub id: String,
    pub raw: String,
    pub words: Vec<Word>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Preprocessing {
    pub split_mode: String,
    pub exclude_double_newlines: bool,
    pub exclude_section_labels: bool,
}

impl Default for Preprocessing {
    fn default() -> Self {
        Self {
            split_mode: "manual".into(),
            exclude_double_newlines: true,
            exclude_section_labels: true,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct MetronomeSettings {
    pub enabled: bool,
    pub bpm: f64,
    pub offset: f64,
    pub beats_per_bar: u32,
    pub volume: f64,
}

impl Default for MetronomeSettings {
    fn default() -> Self {
        Self { enabled: false, bpm: 96.0, offset: 0.0, beats_per_bar: 4, volume: 0.35 }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PitchRange {
    pub min: f64,
    pub max: f64,
}

impl Default for PitchRange {
    fn default() -> Self {
        Self { min: 48.0, max: 76.0 }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct GuideSynth {
    pub enabled: bool,
    pub volume: f64,
}

impl Default for GuideSynth {
    fn default() -> Self {
        Self { enabled: false, volume: 0.25 }
    }
}

pub const ACTIONS: &[(&str, &str)] = &[
    ("tapTiming", "Tap → next"),
    ("playPause", "Play / Pause"),
    ("setStart", "Set start"),
    ("setEnd", "Set end"),
    ("seekBackward", "Seek backward"),
    ("seekForward", "Seek forward"),
    ("nudgeBack", "Nudge start backward"),
    ("nudgeForward", "Nudge start forward"),
    ("clearTiming", "Clear timing"),
    ("clearOrPitch", "Clear timing / pitch"),
    ("selectSounding", "Select sounding"),
    ("jump", "Jump"),
    ("pitchUp", "Pitch up"),
    ("pitchDown", "Pitch down"),
    ("selectBack", "Select previous"),
    ("selectForward", "Select next"),
];

pub fn default_keybinds() -> BTreeMap<String, Vec<String>> {
    let table: &[(&str, &[&str])] = &[
        ("tapTiming", &["enter", "k", "z", "x"]),
        ("playPause", &["space"]),
        ("setStart", &["s"]),
        ("setEnd", &["e"]),
        ("seekBackward", &["j"]),
        ("seekForward", &["l"]),
        ("nudgeBack", &[","]),
        ("nudgeForward", &["."]),
        ("clearTiming", &["delete"]),
        ("clearOrPitch", &["backspace"]),
        ("selectSounding", &["a"]),
        ("jump", &["g"]),
        ("pitchUp", &["arrowup"]),
        ("pitchDown", &["arrowdown"]),
        ("selectBack", &["[", "arrowleft"]),
        ("selectForward", &["]", "arrowright"]),
    ];
    table
        .iter()
        .map(|(k, v)| (k.to_string(), v.iter().map(|s| s.to_string()).collect()))
        .collect()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub playback_rate: f64,
    pub pre_roll: f64,
    pub post_roll: f64,
    pub seek_step: f64,
    pub nudge_step: f64,
    pub music_volume: f64,
    pub auto_play_on_jump: bool,
    pub auto_scroll_lyrics: bool,
    pub auto_scroll_window: bool,
    pub loop_selection: bool,
    pub preprocessing: Preprocessing,
    pub metronome: MetronomeSettings,
    pub pitch_range: PitchRange,
    pub guide_synth: GuideSynth,
    pub follow_sounding: bool,
    pub select_without_seek: bool,
    pub keybinds: BTreeMap<String, Vec<String>>,
    pub ui: serde_json::Value,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            playback_rate: 0.8,
            pre_roll: 0.18,
            post_roll: 0.08,
            seek_step: 2.0,
            nudge_step: 0.025,
            music_volume: 1.0,
            auto_play_on_jump: true,
            auto_scroll_lyrics: true,
            auto_scroll_window: false,
            loop_selection: false,
            preprocessing: Preprocessing::default(),
            metronome: MetronomeSettings::default(),
            pitch_range: PitchRange::default(),
            guide_synth: GuideSynth::default(),
            follow_sounding: false,
            select_without_seek: false,
            keybinds: default_keybinds(),
            ui: serde_json::json!({ "collapsedPanels": {}, "collapsedSections": {} }),
        }
    }
}

impl Settings {
    /// Fills in any action the file does not mention so old projects keep working.
    pub fn sanitize(&mut self) {
        let defaults = default_keybinds();
        for (action, keys) in defaults {
            self.keybinds.entry(action).or_insert(keys);
        }
        self.keybinds.retain(|action, _| ACTIONS.iter().any(|(id, _)| id == action));
        self.playback_rate = self.playback_rate.clamp(0.1, 2.0);
        self.pitch_range.min = self.pitch_range.min.clamp(0.0, 126.0);
        self.pitch_range.max = self.pitch_range.max.clamp(self.pitch_range.min + 4.0, 127.0);
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AudioMeta {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub size: u64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Selection {
    pub syllable_id: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum TargetKind {
    #[default]
    Syllable,
    Word,
    Line,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PracticeTarget {
    pub kind: TargetKind,
    pub id: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Project {
    pub project_name: String,
    pub lyrics_markup: String,
    pub structure: Vec<Line>,
    pub audio_meta: AudioMeta,
    pub settings: Settings,
    pub selection: Selection,
    pub practice_target: PracticeTarget,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Playback {
    pub current_time: f64,
    pub was_playing: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct EmbeddedAudio {
    pub data_url: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
}

/// File envelope: what lands on disk when a project is exported.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ProjectFile {
    pub app_id: String,
    pub version: u32,
    pub updated_at: String,
    pub playback: Playback,
    pub project: Project,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio: Option<EmbeddedAudio>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub export_meta: Option<serde_json::Value>,
    /// Where the audio lives on this computer. Used by autosave in place of embedding it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_path: Option<String>,
}

impl Default for ProjectFile {
    fn default() -> Self {
        Self {
            app_id: APP_ID.into(),
            version: APP_VERSION,
            updated_at: String::new(),
            playback: Playback::default(),
            project: Project::default(),
            audio: None,
            export_meta: None,
            audio_path: None,
        }
    }
}

/// Position of a syllable inside the nested structure.
#[derive(Clone, Copy, Debug)]
pub struct SylRef {
    pub line: usize,
    pub word: usize,
    pub syl: usize,
}

#[derive(Clone, Debug, Default)]
pub struct Index {
    pub syllables: Vec<SylRef>,
    pub by_id: std::collections::HashMap<String, usize>,
    /// First and last global syllable index per global word.
    pub word_spans: Vec<(usize, usize)>,
    /// First and last global syllable index per line.
    pub line_spans: Vec<Option<(usize, usize)>>,
    /// Global indices of syllables that have a start, in lyric order.
    pub timed: Vec<usize>,
    pub timed_starts: Vec<f64>,
    pub timed_ends: Vec<f64>,
    pub prev_timed_start: Vec<Option<f64>>,
    pub next_timed_start: Vec<Option<f64>>,
    pub effective_ends: Vec<Option<f64>>,
    /// Sorted (time, syllable global index) pairs for drag snapping.
    pub snap_points: Vec<(f64, usize)>,
    pub synced_count: usize,
    pub max_time: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct EndGesture {
    pub syllable: usize,
    pub time: f64,
    pub at: std::time::Instant,
}

pub struct Doc {
    pub project: Project,
    pub index: Index,
    pub audio_duration: f64,
    pub undo: Vec<Vec<Line>>,
    pub last_end_gesture: Option<EndGesture>,
    /// Bumped whenever lyrics are rebuilt or undone, so text layouts know to refresh.
    pub structure_revision: u64,
    /// Bumped on every change that affects timings or lyrics, for cheap cache checks.
    pub revision: u64,
    /// Bumped on any change worth saving.
    pub dirty_revision: u64,
}

impl Default for Doc {
    fn default() -> Self {
        let mut doc = Self {
            project: Project::default(),
            index: Index::default(),
            audio_duration: 0.0,
            undo: Vec::new(),
            last_end_gesture: None,
            structure_revision: 0,
            revision: 0,
            dirty_revision: 0,
        };
        doc.project.settings.sanitize();
        doc.rebuild_index();
        doc
    }
}

impl Doc {
    pub fn from_project(mut project: Project, audio_duration: f64) -> Self {
        project.settings.sanitize();
        let mut doc = Self {
            project,
            index: Index::default(),
            audio_duration,
            undo: Vec::new(),
            last_end_gesture: None,
            structure_revision: 0,
            revision: 0,
            dirty_revision: 0,
        };
        doc.normalize_ids();
        doc.rebuild_index();
        doc
    }

    fn normalize_ids(&mut self) {
        let mut counter = 0usize;
        let mut next = |prefix: &str| {
            counter += 1;
            format!("{prefix}-n{counter}")
        };
        for line in &mut self.project.structure {
            if line.id.is_empty() {
                line.id = next("line");
            }
            for word in &mut line.words {
                if word.id.is_empty() {
                    word.id = next("word");
                }
                for syl in &mut word.syllables {
                    if syl.id.is_empty() {
                        syl.id = next("sy");
                    }
                    for value in [&mut syl.start, &mut syl.end, &mut syl.pitch] {
                        if matches!(value, Some(v) if !v.is_finite()) {
                            *value = None;
                        }
                    }
                }
            }
        }
    }

    pub fn len(&self) -> usize {
        self.index.syllables.len()
    }

    pub fn syl(&self, g: usize) -> &Syllable {
        let r = self.index.syllables[g];
        &self.project.structure[r.line].words[r.word].syllables[r.syl]
    }

    pub fn syl_mut(&mut self, g: usize) -> &mut Syllable {
        let r = self.index.syllables[g];
        &mut self.project.structure[r.line].words[r.word].syllables[r.syl]
    }

    pub fn syl_ref(&self, g: usize) -> SylRef {
        self.index.syllables[g]
    }

    pub fn word_of(&self, g: usize) -> &Word {
        let r = self.index.syllables[g];
        &self.project.structure[r.line].words[r.word]
    }

    pub fn line_of(&self, g: usize) -> &Line {
        let r = self.index.syllables[g];
        &self.project.structure[r.line]
    }

    pub fn find(&self, id: &str) -> Option<usize> {
        self.index.by_id.get(id).copied()
    }

    pub fn selected(&self) -> Option<usize> {
        self.project.selection.syllable_id.as_deref().and_then(|id| self.find(id))
    }

    pub fn max_time(&self) -> f64 {
        self.index.max_time.max(self.audio_duration).max(FULL_VIEW_MIN)
    }

    pub fn set_audio_duration(&mut self, duration: f64) {
        self.audio_duration = duration;
        self.rebuild_timing_caches();
    }

    pub fn rebuild_index(&mut self) {
        let mut syllables = Vec::new();
        let mut by_id = std::collections::HashMap::new();
        let mut word_spans = Vec::new();
        let mut line_spans = Vec::new();
        for (li, line) in self.project.structure.iter().enumerate() {
            let mut line_span: Option<(usize, usize)> = None;
            for (wi, word) in line.words.iter().enumerate() {
                                let mut span: Option<(usize, usize)> = None;
                for (si, syl) in word.syllables.iter().enumerate() {
                    let g = syllables.len();
                    syllables.push(SylRef { line: li, word: wi, syl: si });
                    by_id.insert(syl.id.clone(), g);
                    span = Some(span.map_or((g, g), |(a, _)| (a, g)));
                    line_span = Some(line_span.map_or((g, g), |(a, _)| (a, g)));
                }
                word_spans.push(span.unwrap_or((usize::MAX, usize::MAX)));
            }
            line_spans.push(line_span);
        }
        self.index = Index { syllables, by_id, word_spans, line_spans, ..Index::default() };
        self.structure_revision += 1;
        self.rebuild_timing_caches();

        if self.selected().is_none() {
            self.project.selection.syllable_id =
                if self.len() > 0 { Some(self.syl(0).id.clone()) } else { None };
        }
        let valid = match (self.project.practice_target.kind, self.project.practice_target.id.as_deref()) {
            (TargetKind::Syllable, Some(id)) => self.find(id).is_some(),
            (TargetKind::Word, Some(id)) => self.word_global_index(id).is_some(),
            (TargetKind::Line, Some(id)) => self.line_index(id).is_some(),
            _ => false,
        };
        if !valid {
            self.project.practice_target = PracticeTarget {
                kind: TargetKind::Syllable,
                id: self.project.selection.syllable_id.clone(),
            };
        }
    }

    pub fn word_global_index(&self, id: &str) -> Option<usize> {
        let mut n = 0;
        for line in &self.project.structure {
            for word in &line.words {
                if word.id == id {
                    return Some(n);
                }
                n += 1;
            }
        }
        None
    }

    pub fn line_index(&self, id: &str) -> Option<usize> {
        self.project.structure.iter().position(|l| l.id == id)
    }

    pub fn rebuild_timing_caches(&mut self) {
        let n = self.len();
        let mut prev = vec![None; n];
        let mut next = vec![None; n];
        let mut effective = vec![None; n];
        let mut timed = Vec::new();
        let mut starts = Vec::new();
        let mut snaps = Vec::new();
        let mut max_time = FULL_VIEW_MIN.max(self.audio_duration);

        let mut previous: Option<f64> = None;
        for g in 0..n {
            prev[g] = previous;
            let s = self.syl(g);
            if let Some(start) = s.start {
                previous = Some(start);
                timed.push(g);
                starts.push(start);
                snaps.push((start, g));
                max_time = max_time.max(start);
            }
            if let Some(end) = s.end {
                snaps.push((end, g));
                max_time = max_time.max(end);
            }
        }
        let mut upcoming: Option<f64> = None;
        for g in (0..n).rev() {
            next[g] = upcoming;
            if let Some(start) = self.syl(g).start {
                upcoming = Some(start);
            }
        }
        for g in 0..n {
            let s = self.syl(g);
            let Some(start) = s.start else { continue };
            let end = match s.end {
                Some(e) if e > start => e,
                _ => match next[g] {
                    Some(nx) => nx,
                    None if self.audio_duration > start => self.audio_duration,
                    None => start + DEFAULT_TAIL,
                },
            };
            effective[g] = Some(end);
            max_time = max_time.max(end);
        }
        let ends: Vec<f64> = timed.iter().map(|&g| effective[g].unwrap_or(0.0)).collect();
        snaps.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

        self.index.synced_count = timed.len();
        self.index.timed = timed;
        self.index.timed_starts = starts;
        self.index.timed_ends = ends;
        self.index.prev_timed_start = prev;
        self.index.next_timed_start = next;
        self.index.effective_ends = effective;
        self.index.snap_points = snaps;
        self.index.max_time = max_time.max(FULL_VIEW_MIN);
        self.revision += 1;
        self.dirty_revision += 1;
    }

    // --- undo -------------------------------------------------------------

    pub fn push_undo(&mut self) {
        self.undo.push(self.project.structure.clone());
        if self.undo.len() > MAX_UNDO {
            self.undo.remove(0);
        }
    }

    pub fn perform_undo(&mut self) -> bool {
        let Some(snapshot) = self.undo.pop() else { return false };
        self.project.structure = snapshot;
        self.last_end_gesture = None;
        self.rebuild_index();
        true
    }

    // --- timing lookups --------------------------------------------------

    pub fn effective_end(&self, g: usize) -> Option<f64> {
        self.index.effective_ends.get(g).copied().flatten()
    }

    pub fn sounding_at(&self, time: f64) -> Option<usize> {
        let starts = &self.index.timed_starts;
        let upper = starts.partition_point(|&s| s <= time);
        if upper == 0 {
            return None;
        }
        let i = upper - 1;
        let g = self.index.timed[i];
        let end = self.index.timed_ends[i];
        let start = starts[i];
        (time >= start && time < end).then_some(g)
    }

    /// Index into `timed` of the last syllable whose end is at or before `time`.
    pub fn completed_timed_index(&self, time: f64) -> Option<usize> {
        let upper = self.index.timed_ends.partition_point(|&e| e <= time);
        upper.checked_sub(1)
    }

    pub fn target_span(&self) -> Option<(usize, usize)> {
        let target = &self.project.practice_target;
        let id = target.id.as_deref()?;
        match target.kind {
            TargetKind::Syllable => self.find(id).map(|g| (g, g)),
            TargetKind::Word => {
                let w = self.word_global_index(id)?;
                let span = self.index.word_spans.get(w).copied()?;
                (span.0 != usize::MAX).then_some(span)
            }
            TargetKind::Line => self.line_index(id).and_then(|l| self.index.line_spans[l]),
        }
    }

    pub fn target_range(&self) -> Option<(f64, f64)> {
        let (first, last) = self.target_span()?;
        let start = self.syl(first).start?;
        let end = self.effective_end(last)?;
        Some((start, end))
    }

    pub fn clamp_start(&self, g: usize, time: f64) -> f64 {
        let s = self.syl(g);
        let prev = self.index.prev_timed_start[g];
        let next = self.index.next_timed_start[g];
        let duration = if self.audio_duration > 0.0 { self.audio_duration } else { self.max_time() };
        let mut max = next.map_or(duration, |n| n - EPSILON);
        if let Some(end) = s.end {
            max = max.min(end - EPSILON);
        }
        let min = prev.map_or(0.0, |p| p + EPSILON);
        time.clamp(min, max.max(min))
    }

    pub fn clamp_end(&self, g: usize, time: f64) -> Option<f64> {
        let start = self.syl(g).start?;
        let next = self.index.next_timed_start[g];
        let duration = if self.audio_duration > 0.0 {
            self.audio_duration
        } else {
            self.max_time() + DEFAULT_TAIL
        };
        let min = start + EPSILON;
        let max = next.unwrap_or(duration);
        Some(time.clamp(min, max.max(min)))
    }

    // --- selection -------------------------------------------------------

    pub fn select(&mut self, g: usize, kind: TargetKind) {
        if g >= self.len() {
            return;
        }
        let id = self.syl(g).id.clone();
        let practice_id = match kind {
            TargetKind::Syllable => id.clone(),
            TargetKind::Word => self.word_of(g).id.clone(),
            TargetKind::Line => self.line_of(g).id.clone(),
        };
        self.project.selection.syllable_id = Some(id);
        self.project.practice_target = PracticeTarget { kind, id: Some(practice_id) };
        self.dirty_revision += 1;
    }

    // --- editing ---------------------------------------------------------

    fn after_timing_change(&mut self) {
        self.rebuild_timing_caches();
    }

    fn resolve_overlap_after_start_move(&mut self, g: usize) {
        if g == 0 {
            return;
        }
        let start = self.syl(g).start;
        let prev = self.syl_mut(g - 1);
        if let (Some(end), Some(start)) = (prev.end, start) {
            if end > start {
                prev.end = None;
            }
        }
    }

    fn resolve_overlap_after_end_move(&mut self, g: usize) {
        let Some(end) = self.syl(g).end else { return };
        for i in g + 1..self.len() {
            let Some(next_start) = self.syl(i).start else { continue };
            if end > next_start {
                self.syl_mut(i).start = Some(round_time(end + EPSILON));
                self.syl_mut(g).end = None;
            }
            break;
        }
    }

    /// Sets a start and returns the time that was stored.
    fn apply_start(&mut self, g: usize, time: f64) -> f64 {
        let start = round_time(self.clamp_start(g, time));
        let s = self.syl_mut(g);
        s.start = Some(start);
        if matches!(s.end, Some(e) if e <= start + EPSILON) {
            s.end = None;
        }
        self.resolve_overlap_after_start_move(g);
        self.after_timing_change();
        start
    }

    pub fn set_start(&mut self, g: usize, time: f64, record_undo: bool) -> Option<f64> {
        if !time.is_finite() || g >= self.len() {
            return None;
        }
        if record_undo {
            self.push_undo();
        }
        self.last_end_gesture = None;
        Some(self.apply_start(g, time))
    }

    /// Drag variant: no undo entry, no change if the stored value stays the same.
    pub fn drag_start(&mut self, g: usize, time: f64) -> Option<f64> {
        let wanted = round_time(self.clamp_start(g, time));
        if self.syl(g).start == Some(wanted) {
            return None;
        }
        self.last_end_gesture = None;
        Some(self.apply_start(g, time))
    }

    pub fn set_end(&mut self, g: usize, time: f64) -> Option<f64> {
        if !time.is_finite() || g >= self.len() || self.syl(g).start.is_none() {
            return None;
        }
        let requested = round_time(self.clamp_end(g, time)?);
        let next = (g + 1..self.len()).find(|&i| self.syl(i).start.is_some());
        let auto_clear = self.should_auto_clear_end(g, next, requested);
        self.push_undo();
        let now = std::time::Instant::now();
        if auto_clear {
            self.syl_mut(g).end = None;
            self.last_end_gesture = Some(EndGesture { syllable: g, time: requested, at: now });
            self.after_timing_change();
            return None;
        }
        self.syl_mut(g).end = Some(requested);
        self.last_end_gesture = Some(EndGesture { syllable: g, time: requested, at: now });
        self.resolve_overlap_after_end_move(g);
        self.after_timing_change();
        self.syl(g).end
    }

    fn should_auto_clear_end(&self, g: usize, next: Option<usize>, requested: f64) -> bool {
        let (Some(last), Some(next)) = (self.last_end_gesture, next) else { return false };
        let Some(next_start) = self.syl(next).start else { return false };
        last.at.elapsed().as_millis() <= 800
            && last.syllable == g
            && (last.time - requested).abs() <= 0.075
            && requested >= next_start - EPSILON
    }

    pub fn drag_end(&mut self, g: usize, time: f64) -> Option<f64> {
        self.syl(g).start?;
        let wanted = round_time(self.clamp_end(g, time)?);
        if self.syl(g).end == Some(wanted) {
            return None;
        }
        self.last_end_gesture = None;
        self.syl_mut(g).end = Some(wanted);
        self.resolve_overlap_after_end_move(g);
        self.after_timing_change();
        self.syl(g).end
    }

    /// Moves a whole block by `delta` from where the drag started.
    pub fn drag_block(&mut self, g: usize, start0: f64, end0: Option<f64>, delta: f64) -> bool {
        let prev_start = self.syl(g).start;
        let prev_end = self.syl(g).end;
        let start = round_time(self.clamp_start(g, start0 + delta));
        self.syl_mut(g).start = Some(start);
        if let Some(end0) = end0 {
            // Keep the old start-derived bounds out of the way while clamping the end.
            let end = self.clamp_end_with_start(g, start, end0 + delta);
            self.syl_mut(g).end = Some(round_time(end));
        }
        let changed = self.syl(g).start != prev_start || self.syl(g).end != prev_end;
        if changed {
            self.after_timing_change();
        }
        changed
    }

    fn clamp_end_with_start(&self, g: usize, start: f64, time: f64) -> f64 {
        let next = self.index.next_timed_start[g];
        let duration = if self.audio_duration > 0.0 {
            self.audio_duration
        } else {
            self.max_time() + DEFAULT_TAIL
        };
        let min = start + EPSILON;
        let max = next.unwrap_or(duration);
        time.clamp(min, max.max(min))
    }

    pub fn clear_end(&mut self, g: usize) {
        self.push_undo();
        self.last_end_gesture = None;
        self.syl_mut(g).end = None;
        self.after_timing_change();
    }

    pub fn clear_timing(&mut self, g: usize) {
        self.push_undo();
        self.last_end_gesture = None;
        let s = self.syl_mut(g);
        s.start = None;
        s.end = None;
        self.after_timing_change();
    }

    pub fn clear_timings_forward(&mut self, g: usize) {
        self.push_undo();
        self.last_end_gesture = None;
        for i in g..self.len() {
            let s = self.syl_mut(i);
            s.start = None;
            s.end = None;
        }
        self.after_timing_change();
    }

    pub fn nudge_start(&mut self, g: usize, delta: f64) -> Option<f64> {
        let current = self.syl(g).start?;
        // Rapid nudges share one undo entry.
        let threshold = delta.abs() * 10.0;
        let coalesce = self
            .undo
            .last()
            .and_then(|snap| {
                let id = &self.syl(g).id;
                snap.iter()
                    .flat_map(|l| l.words.iter())
                    .flat_map(|w| w.syllables.iter())
                    .find(|s| &s.id == id)
                    .and_then(|s| s.start)
            })
            .is_some_and(|old| (old - current).abs() < threshold);
        if !coalesce {
            self.push_undo();
        }
        Some(self.apply_start(g, current + delta))
    }

    pub fn set_pitch(&mut self, g: usize, pitch: Option<f64>) -> bool {
        let new = pitch.filter(|p| p.is_finite()).map(|p| p.round().clamp(24.0, 108.0));
        if self.syl(g).pitch == new {
            return false;
        }
        self.push_undo();
        self.syl_mut(g).pitch = new;
        self.dirty_revision += 1;
        self.revision += 1;
        true
    }

    /// Applies typed values from the selected-syllable editor in one undo step.
    pub fn apply_fields(&mut self, g: usize, start: Option<f64>, end: Option<f64>, pitch: Option<f64>) {
        self.push_undo();
        self.last_end_gesture = None;
        match start {
            None => {
                let s = self.syl_mut(g);
                s.start = None;
                s.end = None;
            }
            Some(start) => {
                let new_start = round_time(self.clamp_start(g, start));
                self.syl_mut(g).start = Some(new_start);
                let new_end = end.and_then(|e| {
                    // The index still holds the old start, so clamp against the new one directly.
                    Some(round_time(self.clamp_end_with_start(g, new_start, e)))
                });
                self.syl_mut(g).end = new_end;
            }
        }
        self.syl_mut(g).pitch = pitch.filter(|p| p.is_finite()).map(|p| p.round().clamp(24.0, 108.0));
        self.after_timing_change();
    }

    pub fn synced_count(&self) -> usize {
        self.index.synced_count
    }

    pub fn mark_dirty(&mut self) {
        self.dirty_revision += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lyrics;

    fn doc_with(text: &str) -> Doc {
        let mut project = Project::default();
        project.lyrics_markup = text.into();
        project.structure = lyrics::parse(text, &project.settings.preprocessing, &[]);
        Doc::from_project(project, 10.0)
    }

    #[test]
    fn start_clamps_between_neighbours() {
        let mut doc = doc_with("ka-ra-o-ke");
        doc.set_start(0, 1.0, true);
        doc.set_start(2, 3.0, true);
        let stored = doc.set_start(1, 5.0, true).unwrap();
        assert!((stored - 2.99).abs() < 1e-9, "got {stored}");
        let stored = doc.set_start(1, 0.2, true).unwrap();
        assert!((stored - 1.01).abs() < 1e-9, "got {stored}");
    }

    #[test]
    fn implicit_end_uses_next_start() {
        let mut doc = doc_with("a-b");
        doc.set_start(0, 1.0, true);
        doc.set_start(1, 2.0, true);
        assert_eq!(doc.effective_end(0), Some(2.0));
        assert_eq!(doc.effective_end(1), Some(10.0));
        assert_eq!(doc.sounding_at(1.5), Some(0));
        assert_eq!(doc.sounding_at(0.5), None);
    }

    #[test]
    fn undo_restores_timings() {
        let mut doc = doc_with("a b");
        doc.set_start(0, 1.0, true);
        doc.clear_timing(0);
        assert!(doc.syl(0).start.is_none());
        assert!(doc.perform_undo());
        assert_eq!(doc.syl(0).start, Some(1.0));
    }

    #[test]
    fn repeat_set_end_clears_it() {
        let mut doc = doc_with("a-b");
        doc.set_start(0, 1.0, true);
        doc.set_start(1, 2.0, true);
        doc.set_end(0, 1.5);
        assert_eq!(doc.syl(0).end, Some(1.5));
        // Pressing again at the next syllable's start toggles the explicit end off.
        doc.set_end(0, 2.0);
        assert_eq!(doc.syl(0).end, Some(2.0));
        doc.set_end(0, 2.0);
        assert_eq!(doc.syl(0).end, None);
    }

    #[test]
    fn project_file_roundtrip_keeps_unknown_shape() {
        let json = r#"{"appId":"syllable-karaoke-studio","version":4,"playback":{"currentTime":3.5},
            "project":{"projectName":"x","structure":[{"id":"line-1","raw":"a","words":[{"id":"word-2","raw":"a","text":"a","showJoiners":false,
            "syllables":[{"id":"sy-3","text":"a","start":1.0,"end":null,"pitch":60}]}]}],
            "settings":{"playbackRate":0.5}}}"#;
        let file: ProjectFile = serde_json::from_str(json).unwrap();
        assert_eq!(file.project.settings.playback_rate, 0.5);
        assert_eq!(file.project.structure[0].words[0].syllables[0].pitch, Some(60.0));
        let back = serde_json::to_string(&file).unwrap();
        assert!(back.contains("\"playbackRate\":0.5"));
    }
}
