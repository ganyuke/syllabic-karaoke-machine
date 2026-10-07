//! Audio decoding, waveform summaries and the real-time engine.
//!
//! The engine mixes the song, the metronome and the guide synth inside a single
//! output callback. Every sound is placed on the same sample clock, and the
//! playhead the UI shows is derived from that clock, so what is drawn and what
//! is heard never drift apart.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample};
use std::io::Cursor;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::{MediaSource, MediaSourceStream};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

// --- decoding -------------------------------------------------------------

pub struct Track {
    /// Interleaved 16-bit samples. Half the memory of floats, and not audibly different.
    /// Exports never use these: they carry the original file.
    pub samples: Vec<i16>,
    pub channels: usize,
    pub sample_rate: u32,
}

impl Track {
    pub fn frames(&self) -> usize {
        self.samples.len() / self.channels.max(1)
    }

    pub fn duration(&self) -> f64 {
        self.frames() as f64 / self.sample_rate.max(1) as f64
    }
}

pub fn decode_bytes(bytes: Vec<u8>, extension: Option<&str>) -> Result<Track, String> {
    decode_source(Box::new(Cursor::new(bytes)), extension)
}

pub fn decode_file(path: &std::path::Path) -> Result<Track, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("Could not open {}: {e}", path.display()))?;
    decode_source(Box::new(file), path.extension().and_then(|e| e.to_str()))
}

fn decode_source(source: Box<dyn MediaSource>, extension: Option<&str>) -> Result<Track, String> {
    let stream = MediaSourceStream::new(source, Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = extension {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, stream, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| format!("Unsupported audio file: {e}"))?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
        .ok_or("No audio track found")?;
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("Unsupported codec: {e}"))?;

    let mut samples: Vec<i16> = Vec::new();
    let mut channels = track.codec_params.channels.map_or(0, |c| c.count());
    let mut sample_rate = track.codec_params.sample_rate.unwrap_or(0);
    let mut scratch: Option<SampleBuffer<i16>> = None;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(SymphoniaError::ResetRequired) => break,
            Err(e) => return Err(format!("Could not read audio: {e}")),
        };
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(decoded) => {
                let spec = *decoded.spec();
                channels = spec.channels.count();
                sample_rate = spec.rate;
                let needed = decoded.capacity() as u64;
                if scratch.as_ref().map_or(true, |s| (s.capacity() as u64) < needed * channels as u64) {
                    scratch = Some(SampleBuffer::new(needed, spec));
                }
                let buf = scratch.as_mut().unwrap();
                buf.copy_interleaved_ref(decoded);
                samples.extend_from_slice(buf.samples());
            }
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(e) => return Err(format!("Could not decode audio: {e}")),
        }
    }
    if channels == 0 || sample_rate == 0 || samples.is_empty() {
        return Err("The file has no playable audio".into());
    }
    samples.shrink_to_fit();
    Ok(Track { samples, channels, sample_rate })
}

// --- waveform summary ----------------------------------------------------

pub struct PeakLevel {
    pub min: Vec<f32>,
    pub max: Vec<f32>,
    /// How many base peaks one entry covers.
    pub stride: usize,
}

pub struct Peaks {
    pub levels: Vec<PeakLevel>,
    pub duration: f64,
}

impl Peaks {
    pub fn build(track: &Track) -> Self {
        let frames = track.frames();
        let duration = track.duration();
        let target = ((duration.max(1.0) * 120.0).round() as usize).clamp(4000, 48000);
        let block = (frames / target).max(1);
        let count = frames.div_ceil(block).max(1);
        let ch = track.channels;
        let mut min = vec![0f32; count];
        let mut max = vec![0f32; count];
        for i in 0..count {
            let start = i * block;
            let end = (start + block).min(frames);
            let (mut lo, mut hi) = (1f32, -1f32);
            for frame in start..end {
                for c in 0..ch {
                    let v = track.samples[frame * ch + c] as f32 / 32768.0;
                    lo = lo.min(v);
                    hi = hi.max(v);
                }
            }
            min[i] = if lo == 1.0 { 0.0 } else { lo };
            max[i] = if hi == -1.0 { 0.0 } else { hi };
        }
        let mut levels = vec![PeakLevel { min, max, stride: 1 }];
        while levels.last().unwrap().min.len() > 512 {
            let prev = levels.last().unwrap();
            let next_count = prev.min.len().div_ceil(2);
            let mut nmin = Vec::with_capacity(next_count);
            let mut nmax = Vec::with_capacity(next_count);
            for i in 0..next_count {
                let l = i * 2;
                let r = (l + 1).min(prev.min.len() - 1);
                nmin.push(prev.min[l].min(prev.min[r]));
                nmax.push(prev.max[l].max(prev.max[r]));
            }
            levels.push(PeakLevel { min: nmin, max: nmax, stride: prev.stride * 2 });
        }
        Self { levels, duration }
    }

    /// Picks the coarsest level that still gives about `target` entries per pixel.
    pub fn level_for(&self, base_per_pixel: f64, target: f64) -> &PeakLevel {
        let mut chosen = &self.levels[0];
        for level in &self.levels {
            if base_per_pixel / level.stride as f64 >= target {
                chosen = level;
            } else {
                break;
            }
        }
        chosen
    }
}

// --- engine ---------------------------------------------------------------

#[derive(Clone, Copy, Debug)]
pub struct GuideNote {
    pub start: f64,
    pub end: f64,
    pub midi: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MixSettings {
    pub rate: f64,
    pub music_volume: f64,
    pub metronome_enabled: bool,
    pub bpm: f64,
    pub offset: f64,
    pub beats_per_bar: u32,
    pub metronome_volume: f64,
    pub guide_enabled: bool,
    pub guide_volume: f64,
}

impl Default for MixSettings {
    fn default() -> Self {
        Self {
            rate: 0.8,
            music_volume: 1.0,
            metronome_enabled: false,
            bpm: 96.0,
            offset: 0.0,
            beats_per_bar: 4,
            metronome_volume: 0.35,
            guide_enabled: false,
            guide_volume: 0.25,
        }
    }
}

enum Command {
    SetTrack(Option<Arc<Track>>),
    Play,
    Pause,
    Seek(f64),
    Settings(MixSettings),
    Notes(Arc<Vec<GuideNote>>),
    Loop(Option<(f64, f64)>),
}

/// What the callback last reported, plus when it did so.
#[derive(Clone, Copy)]
struct Clock {
    /// Song position (seconds) that is leaving the speakers at `at`.
    position: f64,
    at: Instant,
    playing: bool,
    rate: f64,
    ended: bool,
}

pub struct Engine {
    tx: Sender<Command>,
    /// Commands sent so far. The callback only publishes its clock once it has applied all of them,
    /// so a report from before a seek or play can never overwrite the newer state.
    sent: Arc<AtomicU64>,
    clock: Arc<Mutex<Clock>>,
    duration: f64,
    pub device_name: String,
    pub error: Option<String>,
    _stream: Option<cpal::Stream>,
    // Local mirror used so the UI can answer instantly without waiting for the callback.
    local_pos: f64,
}

impl Engine {
    pub fn start() -> Self {
        let (tx, rx) = channel();
        let clock = Arc::new(Mutex::new(Clock {
            position: 0.0,
            at: Instant::now(),
            playing: false,
            rate: 1.0,
            ended: false,
        }));
        let sent = Arc::new(AtomicU64::new(0));
        let mut engine = Engine {
            tx,
            sent: sent.clone(),
            clock: clock.clone(),
            duration: 0.0,
            device_name: String::new(),
            error: None,
            _stream: None,
            local_pos: 0.0,
        };
        match open_stream(rx, clock, sent) {
            Ok((stream, name)) => {
                engine._stream = Some(stream);
                engine.device_name = name;
            }
            Err(e) => engine.error = Some(e),
        }
        engine
    }

    fn send(&self, cmd: Command) {
        self.sent.fetch_add(1, Ordering::SeqCst);
        let _ = self.tx.send(cmd);
    }

    pub fn set_track(&mut self, track: Option<Arc<Track>>) {
        self.duration = track.as_ref().map_or(0.0, |t| t.duration());
        self.local_pos = 0.0;
        self.send(Command::SetTrack(track));
        if let Ok(mut c) = self.clock.lock() {
            c.position = 0.0;
            c.at = Instant::now();
            c.playing = false;
            c.ended = false;
        }
    }

    pub fn duration(&self) -> f64 {
        self.duration
    }

    pub fn play(&mut self) {
        if self.duration <= 0.0 || self._stream.is_none() {
            return;
        }
        if self.position() >= self.duration - 1e-4 {
            self.seek(0.0);
        }
        self.send(Command::Play);
        if let Ok(mut c) = self.clock.lock() {
            c.at = Instant::now();
            c.playing = true;
            c.ended = false;
        }
    }

    pub fn pause(&mut self) {
        let pos = self.position();
        self.send(Command::Pause);
        self.send(Command::Seek(pos));
        self.local_pos = pos;
        if let Ok(mut c) = self.clock.lock() {
            c.position = pos;
            c.at = Instant::now();
            c.playing = false;
        }
    }

    pub fn seek(&mut self, time: f64) {
        let time = time.clamp(0.0, self.duration.max(0.0));
        self.send(Command::Seek(time));
        self.local_pos = time;
        if let Ok(mut c) = self.clock.lock() {
            c.position = time;
            c.at = Instant::now();
            c.ended = false;
        }
    }

    pub fn set_settings(&self, settings: MixSettings) {
        self.send(Command::Settings(settings));
    }

    pub fn set_notes(&self, notes: Vec<GuideNote>) {
        self.send(Command::Notes(Arc::new(notes)));
    }

    pub fn set_loop(&self, region: Option<(f64, f64)>) {
        self.send(Command::Loop(region));
    }

    pub fn is_playing(&self) -> bool {
        self.clock.lock().map(|c| c.playing).unwrap_or(false)
    }

    /// Current song position, extrapolated from the audio clock to this instant.
    pub fn position(&self) -> f64 {
        let Ok(c) = self.clock.lock() else { return self.local_pos };
        let mut pos = c.position;
        if c.playing {
            pos += c.at.elapsed().as_secs_f64() * c.rate;
        }
        pos.clamp(0.0, self.duration)
    }

    /// True once after the song played to its end.
    pub fn take_ended(&self) -> bool {
        match self.clock.lock() {
            Ok(mut c) if c.ended => {
                c.ended = false;
                true
            }
            _ => false,
        }
    }
}

fn open_stream(rx: Receiver<Command>, clock: Arc<Mutex<Clock>>, sent: Arc<AtomicU64>) -> Result<(cpal::Stream, String), String> {
    let host = cpal::default_host();
    let device = host.default_output_device().ok_or("No audio output device found")?;
    let name = device.name().unwrap_or_else(|_| "Default output".into());
    let supported = device.default_output_config().map_err(|e| format!("Audio output unavailable: {e}"))?;
    let format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    let mixer = Mixer::new(rx, clock, sent, config.sample_rate.0, config.channels as usize);
    let stream = match format {
        SampleFormat::F32 => build::<f32>(&device, &config, mixer),
        SampleFormat::I16 => build::<i16>(&device, &config, mixer),
        SampleFormat::U16 => build::<u16>(&device, &config, mixer),
        SampleFormat::I32 => build::<i32>(&device, &config, mixer),
        other => Err(format!("Unsupported sample format {other:?}")),
    }?;
    stream.play().map_err(|e| format!("Could not start audio: {e}"))?;
    Ok((stream, name))
}

fn build<T>(device: &cpal::Device, config: &cpal::StreamConfig, mut mixer: Mixer) -> Result<cpal::Stream, String>
where
    T: SizedSample + FromSample<f32>,
{
    let mut scratch: Vec<f32> = Vec::new();
    device
        .build_output_stream(
            config,
            move |data: &mut [T], info: &cpal::OutputCallbackInfo| {
                scratch.resize(data.len(), 0.0);
                let ts = info.timestamp();
                let latency = ts.playback.duration_since(&ts.callback).map_or(0.0, |d| d.as_secs_f64());
                mixer.render(&mut scratch, latency);
                for (out, v) in data.iter_mut().zip(scratch.iter()) {
                    *out = T::from_sample(*v);
                }
            },
            |err| eprintln!("audio stream error: {err}"),
            None,
        )
        .map_err(|e| format!("Could not open audio output: {e}"))
}

struct Pulse {
    age: f64,
    freq: f64,
    amp: f64,
}

struct Mixer {
    rx: Receiver<Command>,
    clock: Arc<Mutex<Clock>>,
    sent: Arc<AtomicU64>,
    applied: u64,
    out_rate: f64,
    out_channels: usize,
    track: Option<Arc<Track>>,
    pos: f64,
    playing: bool,
    settings: MixSettings,
    gain: f64,
    notes: Arc<Vec<GuideNote>>,
    note_cache: Option<usize>,
    loop_region: Option<(f64, f64)>,
    // metronome
    beat_cursor: Option<i64>,
    pulses: Vec<Pulse>,
    // guide voice
    voice_midi: Option<f64>,
    voice_env: f64,
    voice_phase: f64,
    ended_flag: bool,
}

impl Mixer {
    fn new(rx: Receiver<Command>, clock: Arc<Mutex<Clock>>, sent: Arc<AtomicU64>, out_rate: u32, out_channels: usize) -> Self {
        Self {
            rx,
            clock,
            sent,
            applied: 0,
            out_rate: out_rate as f64,
            out_channels: out_channels.max(1),
            track: None,
            pos: 0.0,
            playing: false,
            settings: MixSettings::default(),
            gain: 1.0,
            notes: Arc::new(Vec::new()),
            note_cache: None,
            loop_region: None,
            beat_cursor: None,
            pulses: Vec::new(),
            voice_midi: None,
            voice_env: 0.0,
            voice_phase: 0.0,
            ended_flag: false,
        }
    }

    fn drain_commands(&mut self) {
        while let Ok(cmd) = self.rx.try_recv() {
            self.applied += 1;
            match cmd {
                Command::SetTrack(t) => {
                    self.track = t;
                    self.pos = 0.0;
                    self.playing = false;
                    self.beat_cursor = None;
                    self.pulses.clear();
                }
                Command::Play => {
                    self.playing = true;
                    self.beat_cursor = None;
                }
                Command::Pause => {
                    self.playing = false;
                    self.pulses.clear();
                }
                Command::Seek(t) => {
                    self.pos = t;
                    self.beat_cursor = None;
                    self.pulses.clear();
                }
                Command::Settings(s) => {
                    let beat_changed = s.bpm != self.settings.bpm
                        || s.offset != self.settings.offset
                        || s.beats_per_bar != self.settings.beats_per_bar
                        || s.metronome_enabled != self.settings.metronome_enabled;
                    if beat_changed {
                        self.beat_cursor = None;
                    }
                    self.settings = s;
                }
                Command::Notes(n) => {
                    self.notes = n;
                    self.note_cache = None;
                }
                Command::Loop(l) => self.loop_region = l,
            }
        }
    }

    fn note_at(&mut self, t: f64) -> Option<f64> {
        if let Some(i) = self.note_cache {
            if let Some(n) = self.notes.get(i) {
                if t >= n.start && t < n.end {
                    return Some(n.midi);
                }
            }
        }
        let upper = self.notes.partition_point(|n| n.start <= t);
        if upper == 0 {
            self.note_cache = None;
            return None;
        }
        let n = self.notes[upper - 1];
        if t >= n.start && t < n.end {
            self.note_cache = Some(upper - 1);
            Some(n.midi)
        } else {
            self.note_cache = None;
            None
        }
    }

    fn render(&mut self, out: &mut [f32], latency: f64) {
        self.drain_commands();
        out.fill(0.0);
        let ch = self.out_channels;
        let frames = out.len() / ch;
        let rate = self.settings.rate.clamp(0.1, 4.0);
        let duration = self.track.as_ref().map_or(0.0, |t| t.duration());
        let pos_start = self.pos;

        if self.playing {
            let track = self.track.clone();
            let step_audio = rate / self.out_rate; // song seconds per output frame
            let interval = 60.0 / self.settings.bpm.clamp(20.0, 300.0);
            let bars = self.settings.beats_per_bar.clamp(1, 12) as i64;
            let target_gain = self.settings.music_volume.clamp(0.0, 1.5);
            let guide_gain = self.settings.guide_volume.clamp(0.0, 1.0) * 0.6;
            let metro_gain = self.settings.metronome_volume.clamp(0.0, 1.0);
            let sr_track = track.as_ref().map_or(1.0, |t| t.sample_rate as f64);

            for f in 0..frames {
                let t = self.pos;
                // Music, linear interpolation at the varispeed position.
                let (mut l, mut r) = (0.0f64, 0.0f64);
                if let Some(track) = &track {
                    let src = t * sr_track;
                    let i0 = src.floor() as usize;
                    let frac = src - i0 as f64;
                    let n = track.frames();
                    if i0 < n {
                        let c = track.channels;
                        let i1 = (i0 + 1).min(n - 1);
                        let s = |i: usize, k: usize| track.samples[i * c + k.min(c - 1)] as f64 / 32768.0;
                        let (a_l, a_r) = (s(i0, 0), s(i0, 1));
                        let (b_l, b_r) = (s(i1, 0), s(i1, 1));
                        l = a_l + (b_l - a_l) * frac;
                        r = a_r + (b_r - a_r) * frac;
                    }
                }
                self.gain += (target_gain - self.gain) * 0.002;
                l *= self.gain;
                r *= self.gain;

                // Metronome clicks, placed on the exact frame the beat falls in.
                if self.settings.metronome_enabled {
                    let cursor = *self.beat_cursor.get_or_insert_with(|| {
                        if t <= self.settings.offset {
                            0
                        } else {
                            ((t - self.settings.offset) / interval).ceil() as i64
                        }
                    });
                    let beat_time = self.settings.offset + cursor as f64 * interval;
                    if t >= beat_time {
                        let accent = cursor.rem_euclid(bars) == 0;
                        self.pulses.push(Pulse {
                            age: 0.0,
                            freq: if accent { 1760.0 } else { 1320.0 },
                            amp: if accent { 0.9 } else { 0.55 },
                        });
                        self.beat_cursor = Some(cursor + 1);
                    }
                }
                let dt = 1.0 / self.out_rate;
                let mut click = 0.0;
                for p in &mut self.pulses {
                    click += (std::f64::consts::TAU * p.freq * p.age).sin() * (-p.age * 70.0).exp() * p.amp;
                    p.age += dt;
                }
                self.pulses.retain(|p| p.age < 0.08);
                l += click * metro_gain;
                r += click * metro_gain;

                // Guide voice: triangle plus an octave sine, with short fades between notes.
                let wanted = if self.settings.guide_enabled { self.note_at(t) } else { None };
                if wanted != self.voice_midi {
                    self.voice_env = (self.voice_env - dt / 0.012).max(0.0);
                    if self.voice_env <= 0.0 {
                        self.voice_midi = wanted;
                    }
                } else if self.voice_midi.is_some() {
                    self.voice_env = (self.voice_env + dt / 0.025).min(1.0);
                }
                if let Some(midi) = self.voice_midi {
                    if self.voice_env > 0.0 {
                        let freq = 440.0 * 2f64.powf((midi - 69.0) / 12.0);
                        self.voice_phase = (self.voice_phase + freq * dt).fract();
                        let tri = 4.0 * (self.voice_phase - 0.5).abs() - 1.0;
                        let oct = (std::f64::consts::TAU * self.voice_phase * 2.0).sin();
                        let v = (tri * 0.7 + oct * 0.3) * self.voice_env * guide_gain;
                        l += v;
                        r += v;
                    }
                }

                let base = f * ch;
                if ch == 1 {
                    out[base] = ((l + r) * 0.5) as f32;
                } else {
                    out[base] = l as f32;
                    out[base + 1] = r as f32;
                }

                self.pos += step_audio;
                if let Some((a, b)) = self.loop_region {
                    if self.pos >= b && b > a {
                        self.pos = a;
                        self.beat_cursor = None;
                        self.pulses.clear();
                    }
                }
                if self.pos >= duration {
                    self.pos = duration;
                    self.playing = false;
                    self.ended_flag = true;
                    break;
                }
            }
        } else {
            self.gain = self.settings.music_volume.clamp(0.0, 1.5);
            self.voice_env = 0.0;
            self.voice_midi = None;
        }

        // Soft limiter so stacked layers cannot wrap the converter.
        for v in out.iter_mut() {
            *v = v.clamp(-1.0, 1.0);
        }

        if self.applied == self.sent.load(Ordering::SeqCst) {
            if let Ok(mut c) = self.clock.try_lock() {
                // The first sample of this buffer reaches the speakers `latency` from now, so
                // the position leaving them right now is that far behind the buffer's start.
                c.position = if self.playing || self.ended_flag {
                    (pos_start - latency * rate).max(0.0)
                } else {
                    self.pos
                };
                c.at = Instant::now();
                c.rate = rate;
                c.playing = self.playing;
                if self.ended_flag {
                    c.ended = true;
                    c.position = self.pos;
                    self.ended_flag = false;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav_bytes(rate: u32, samples: &[i16]) -> Vec<u8> {
        let data_len = (samples.len() * 2) as u32;
        let mut out = Vec::new();
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(36 + data_len).to_le_bytes());
        out.extend_from_slice(b"WAVEfmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes()); // PCM
        out.extend_from_slice(&1u16.to_le_bytes()); // mono
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&(rate * 2).to_le_bytes());
        out.extend_from_slice(&2u16.to_le_bytes());
        out.extend_from_slice(&16u16.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&data_len.to_le_bytes());
        for s in samples {
            out.extend_from_slice(&s.to_le_bytes());
        }
        out
    }

    fn silent_track(rate: u32, seconds: f64) -> Arc<Track> {
        Arc::new(Track { samples: vec![0; (rate as f64 * seconds) as usize], channels: 1, sample_rate: rate })
    }

    fn mixer() -> (Mixer, Sender<Command>, Arc<Mutex<Clock>>, Arc<AtomicU64>) {
        let (tx, rx) = channel();
        let clock = Arc::new(Mutex::new(Clock { position: 0.0, at: Instant::now(), playing: false, rate: 1.0, ended: false }));
        let sent = Arc::new(AtomicU64::new(0));
        (Mixer::new(rx, clock.clone(), sent.clone(), 8000, 2), tx, clock, sent)
    }

    fn send(tx: &Sender<Command>, sent: &AtomicU64, cmd: Command) {
        sent.fetch_add(1, Ordering::SeqCst);
        tx.send(cmd).unwrap();
    }

    #[test]
    fn decodes_wav() {
        let samples: Vec<i16> = (0..8000).map(|i| ((i as f32 * 0.1).sin() * 12000.0) as i16).collect();
        let track = decode_bytes(wav_bytes(8000, &samples), Some("wav")).unwrap();
        assert_eq!(track.sample_rate, 8000);
        assert_eq!(track.channels, 1);
        assert_eq!(track.frames(), 8000);
        assert!((track.duration() - 1.0).abs() < 1e-9);
        let peaks = Peaks::build(&track);
        assert!(peaks.levels[0].max.iter().cloned().fold(0.0, f32::max) > 0.3);
    }

    #[test]
    fn rejects_garbage() {
        assert!(decode_bytes(vec![1, 2, 3, 4, 5, 6, 7, 8], Some("mp3")).is_err());
    }

    #[test]
    fn plays_at_the_chosen_speed_and_reports_position() {
        let (mut m, tx, clock, sent) = mixer();
        send(&tx, &sent, Command::SetTrack(Some(silent_track(8000, 4.0))));
        send(&tx, &sent, Command::Settings(MixSettings { rate: 0.5, ..MixSettings::default() }));
        send(&tx, &sent, Command::Play);
        let mut buf = vec![0.0f32; 800 * 2];
        for _ in 0..10 {
            m.render(&mut buf, 0.0);
        }
        // 8000 output frames at half speed is half a second of song.
        assert!((m.pos - 0.5).abs() < 1e-6, "pos {}", m.pos);
        let c = clock.lock().unwrap();
        assert!(c.playing);
        // The clock shows the start of the last buffer, which is what is audible right now.
        assert!((c.position - (0.5 - 0.05)).abs() < 1e-6, "clock {}", c.position);
    }

    #[test]
    fn reported_position_lags_by_device_latency() {
        let (mut m, tx, clock, sent) = mixer();
        send(&tx, &sent, Command::SetTrack(Some(silent_track(8000, 4.0))));
        send(&tx, &sent, Command::Settings(MixSettings { rate: 1.0, ..MixSettings::default() }));
        send(&tx, &sent, Command::Play);
        let mut buf = vec![0.0f32; 800 * 2];
        for _ in 0..10 {
            m.render(&mut buf, 0.04);
        }
        let c = clock.lock().unwrap();
        assert!((c.position - (1.0 - 0.1 - 0.04)).abs() < 1e-6, "clock {}", c.position);
    }

    #[test]
    fn metronome_clicks_land_on_the_beat_frame() {
        let (mut m, tx, _clock, sent) = mixer();
        send(&tx, &sent, Command::SetTrack(Some(silent_track(8000, 4.0))));
        send(
            &tx,
            &sent,
            Command::Settings(MixSettings {
                rate: 1.0,
                metronome_enabled: true,
                bpm: 120.0,
                offset: 0.25,
                metronome_volume: 1.0,
                ..MixSettings::default()
            }),
        );
        send(&tx, &sent, Command::Play);
        let mut all = Vec::new();
        let mut buf = vec![0.0f32; 1000 * 2];
        for _ in 0..8 {
            m.render(&mut buf, 0.0);
            all.extend_from_slice(&buf);
        }
        let loud: Vec<usize> = (0..all.len() / 2).filter(|&f| all[f * 2].abs() > 0.05).collect();
        // First beat at 0.25 s = frame 2000, next at 0.75 s = frame 6000.
        let first = *loud.first().unwrap();
        assert!((2000..2010).contains(&first), "first click at {first}");
        let second = *loud.iter().find(|&&f| f > 4000).unwrap();
        assert!((6000..6010).contains(&second), "second click at {second}");
        assert!(loud.iter().all(|&f| (2000..2700).contains(&f) || (6000..6700).contains(&f)));
    }

    #[test]
    fn metronome_follows_song_time_not_wall_time() {
        let (mut m, tx, _clock, sent) = mixer();
        send(&tx, &sent, Command::SetTrack(Some(silent_track(8000, 4.0))));
        send(
            &tx,
            &sent,
            Command::Settings(MixSettings {
                rate: 0.5,
                metronome_enabled: true,
                bpm: 120.0,
                offset: 0.0,
                metronome_volume: 1.0,
                ..MixSettings::default()
            }),
        );
        send(&tx, &sent, Command::Play);
        let mut all = Vec::new();
        let mut buf = vec![0.0f32; 1000 * 2];
        for _ in 0..12 {
            m.render(&mut buf, 0.0);
            all.extend_from_slice(&buf);
        }
        // Half speed: beats every 0.5 song seconds are 1 real second (8000 frames) apart.
        let loud: Vec<usize> = (0..all.len() / 2).filter(|&f| all[f * 2].abs() > 0.05).collect();
        let second = *loud.iter().find(|&&f| f > 4000).unwrap();
        assert!((8000..8010).contains(&second), "second click at {second}");
    }

    #[test]
    fn loop_wraps_and_end_stops() {
        let (mut m, tx, clock, sent) = mixer();
        send(&tx, &sent, Command::SetTrack(Some(silent_track(8000, 1.0))));
        send(&tx, &sent, Command::Settings(MixSettings { rate: 1.0, ..MixSettings::default() }));
        send(&tx, &sent, Command::Loop(Some((0.2, 0.4))));
        send(&tx, &sent, Command::Seek(0.3));
        send(&tx, &sent, Command::Play);
        let mut buf = vec![0.0f32; 800 * 2];
        for _ in 0..10 {
            m.render(&mut buf, 0.0);
            assert!(m.pos < 0.4 + 1e-6 && m.pos >= 0.2 - 1e-6 || m.pos < 0.2, "pos {}", m.pos);
        }
        assert!(m.playing);
        send(&tx, &sent, Command::Loop(None));
        for _ in 0..20 {
            m.render(&mut buf, 0.0);
        }
        assert!(!m.playing);
        let c = clock.lock().unwrap();
        assert!(c.ended && !c.playing);
        assert!((c.position - 1.0).abs() < 1e-9);
    }

    #[test]
    fn stale_reports_never_overwrite_newer_commands() {
        let (mut m, tx, clock, sent) = mixer();
        send(&tx, &sent, Command::SetTrack(Some(silent_track(8000, 4.0))));
        let mut buf = vec![0.0f32; 800 * 2];
        m.render(&mut buf, 0.0);
        // A command is in flight (counted but not yet applied): the report must be skipped.
        clock.lock().unwrap().position = 3.0;
        sent.fetch_add(1, Ordering::SeqCst);
        m.render(&mut buf, 0.0);
        assert_eq!(clock.lock().unwrap().position, 3.0);
    }

    #[test]
    fn guide_voice_sounds_only_inside_a_note() {
        let (mut m, tx, _clock, sent) = mixer();
        send(&tx, &sent, Command::SetTrack(Some(silent_track(8000, 2.0))));
        send(&tx, &sent, Command::Settings(MixSettings { rate: 1.0, guide_enabled: true, guide_volume: 1.0, ..MixSettings::default() }));
        send(&tx, &sent, Command::Notes(Arc::new(vec![GuideNote { start: 0.5, end: 1.0, midi: 69.0 }])));
        send(&tx, &sent, Command::Play);
        let mut all = Vec::new();
        let mut buf = vec![0.0f32; 1000 * 2];
        for _ in 0..16 {
            m.render(&mut buf, 0.0);
            all.extend_from_slice(&buf);
        }
        let energy = |a: usize, b: usize| (a..b).map(|f| all[f * 2].abs()).fold(0.0, f32::max);
        assert!(energy(0, 3900) < 1e-6, "sound before the note");
        assert!(energy(4400, 7900) > 0.1, "no sound inside the note");
        assert!(energy(8600, 16000) < 1e-3, "sound after the note");
    }
}
