const APP_ID = 'syllable-karaoke-studio';
const APP_VERSION = 2;
const DB_NAME = 'syllable-karaoke-studio-db';
const DB_STORE = 'projects';
const AUTOSAVE_KEY = 'autosave';

const DEMO_LYRICS = `[Verse]
ka-ra-o-ke ga su-ki

[Chorus]
kokoro no uta
カラオケが好き`;

const FULL_VIEW_MIN = 1;
const VIEW_MIN_DURATION = 0.3;
const DEFAULT_TAIL = 0.35;
const EPSILON = 0.01;
const TIMELINE_TRACK_HEIGHT = 46;
const PITCH_GUTTER = 42;
const KANA_RE = /[\u3040-\u30ff]/;
const LATIN_RE = /^[A-Za-z]+$/;
const SECTION_LABEL_RE = /^\s*\[[^\]]+\]\s*$/;
const EDGE_PUNCT_RE = /^[\s"'“”‘’.,!?！？。、・･:;()\[\]{}「」『』【】〈〉《》]+|[\s"'“”‘’.,!?！？。、・･:;()\[\]{}「」『』【】〈〉《》]+$/g;
const SMALL_KANA_RE = /[ゃゅょャュョぁぃぅぇぉァィゥェォゎヮゕゖ]/;

const defaultState = () => ({
  projectName: '',
  lyricsMarkup: '',
  structure: [],
  audioMeta: {
    name: '',
    type: '',
    size: 0,
    duration: 0,
  },
  waveformPeaks: [],
  settings: {
    playbackRate: 0.8,
    preRoll: 0.18,
    postRoll: 0.08,
    seekStep: 2,
    nudgeStep: 0.025,
    musicVolume: 1,
    autoPlayOnJump: true,
    autoScrollLyrics: true,
    loopSelection: false,
    preprocessing: {
      splitMode: 'manual',
      excludeDoubleNewlines: true,
      excludeSectionLabels: true,
    },
    metronome: {
      enabled: false,
      bpm: 96,
      offset: 0,
      beatsPerBar: 4,
      volume: 0.35,
    },
    pitchRange: {
      min: 48,
      max: 76,
    },
    guideSynth: {
      enabled: false,
      volume: 0.25,
    },
  },
  selection: {
    syllableId: null,
  },
  practiceTarget: {
    kind: 'syllable',
    id: null,
  },
});

let state = defaultState();
let audioBlob = null;
let uidCounter = 0;

const runtime = {
  objectUrl: '',
  audioContext: null,
  metronomeGain: null,
  guideGain: null,
  guideVoice: null,
  dom: {
    lines: new Map(),
    words: new Map(),
    syllables: new Map(),
  },
  index: {
    lines: [],
    words: [],
    syllables: [],
    lineById: new Map(),
    wordById: new Map(),
    syllableById: new Map(),
  },
  view: {
    start: 0,
    duration: 10,
  },
  timelineHitboxes: [],
  pitchHitboxes: [],
  overviewViewportHitbox: null,
  drag: null,
  focusRegion: 'timing',
  autosaveTimer: null,
  resizeObserver: null,
  loadingProject: false,
  drawDirty: true,
  selectedPitchGhost: 60,
  audioOverlay: {
    metronomeCursorAudioTime: null,
  },
  lastAutoScrolledLineId: null,
};

const els = {
  projectName: document.getElementById('projectName'),
  audioFileInput: document.getElementById('audioFileInput'),
  importProjectInput: document.getElementById('importProjectInput'),
  exportProjectBtn: document.getElementById('exportProjectBtn'),
  clearProjectBtn: document.getElementById('clearProjectBtn'),
  embedAudioInExport: document.getElementById('embedAudioInExport'),
  audioFileName: document.getElementById('audioFileName'),
  audioDurationLabel: document.getElementById('audioDurationLabel'),
  keyboardModePill: document.getElementById('keyboardModePill'),
  saveStatus: document.getElementById('saveStatus'),
  audioPlayer: document.getElementById('audioPlayer'),

  playPauseBtn: document.getElementById('playPauseBtn'),
  rewindBtn: document.getElementById('rewindBtn'),
  forwardBtn: document.getElementById('forwardBtn'),
  jumpToSelectionBtn: document.getElementById('jumpToSelectionBtn'),
  loopSelectionBtn: document.getElementById('loopSelectionBtn'),
  prevSyllableBtn: document.getElementById('prevSyllableBtn'),
  nextSyllableBtn: document.getElementById('nextSyllableBtn'),
  setStartBtn: document.getElementById('setStartBtn'),
  setEndBtn: document.getElementById('setEndBtn'),
  tapFromSelectedBtn: document.getElementById('tapFromSelectedBtn'),
  clearSelectedTimeBtn: document.getElementById('clearSelectedTimeBtn'),
  clearFollowingTimesBtn: document.getElementById('clearFollowingTimesBtn'),
  clearSelectedPitchBtn: document.getElementById('clearSelectedPitchBtn'),
  playbackRateInput: document.getElementById('playbackRateInput'),
  playbackRateLabel: document.getElementById('playbackRateLabel'),
  preRollInput: document.getElementById('preRollInput'),
  preRollLabel: document.getElementById('preRollLabel'),
  postRollInput: document.getElementById('postRollInput'),
  postRollLabel: document.getElementById('postRollLabel'),
  seekStepInput: document.getElementById('seekStepInput'),
  nudgeStepInput: document.getElementById('nudgeStepInput'),
  musicVolumeInput: document.getElementById('musicVolumeInput'),
  musicVolumeLabel: document.getElementById('musicVolumeLabel'),
  guideVolumeInput: document.getElementById('guideVolumeInput'),
  guideVolumeLabel: document.getElementById('guideVolumeLabel'),
  autoPlayOnJump: document.getElementById('autoPlayOnJump'),
  autoScrollLyrics: document.getElementById('autoScrollLyrics'),
  selectedSummary: document.getElementById('selectedSummary'),
  currentTimeLabel: document.getElementById('currentTimeLabel'),
  scrubInput: document.getElementById('scrubInput'),
  remainingTimeLabel: document.getElementById('remainingTimeLabel'),

  buildLyricsBtn: document.getElementById('buildLyricsBtn'),
  sampleLyricsBtn: document.getElementById('sampleLyricsBtn'),
  lyricsInput: document.getElementById('lyricsInput'),
  splitModeSelect: document.getElementById('splitModeSelect'),
  excludeDoubleNewlines: document.getElementById('excludeDoubleNewlines'),
  excludeSectionLabels: document.getElementById('excludeSectionLabels'),

  jumpSelectedMiniBtn: document.getElementById('jumpSelectedMiniBtn'),
  copyPlayheadStartBtn: document.getElementById('copyPlayheadStartBtn'),
  copyPlayheadEndBtn: document.getElementById('copyPlayheadEndBtn'),
  selectedSummaryDetail: document.getElementById('selectedSummaryDetail'),
  selectedStartInput: document.getElementById('selectedStartInput'),
  selectedEndInput: document.getElementById('selectedEndInput'),
  selectedPitchInput: document.getElementById('selectedPitchInput'),
  selectedPitchLabel: document.getElementById('selectedPitchLabel'),
  applySelectedValuesBtn: document.getElementById('applySelectedValuesBtn'),
  clearSelectedEndBtn: document.getElementById('clearSelectedEndBtn'),
  nudgeBackLargeBtn: document.getElementById('nudgeBackLargeBtn'),
  nudgeBackBtn: document.getElementById('nudgeBackBtn'),
  nudgeForwardBtn: document.getElementById('nudgeForwardBtn'),
  nudgeForwardLargeBtn: document.getElementById('nudgeForwardLargeBtn'),

  metronomeEnabled: document.getElementById('metronomeEnabled'),
  metronomeBpm: document.getElementById('metronomeBpm'),
  metronomeOffset: document.getElementById('metronomeOffset'),
  metronomeBeatsPerBar: document.getElementById('metronomeBeatsPerBar'),
  metronomeVolume: document.getElementById('metronomeVolume'),
  metronomeVolumeLabel: document.getElementById('metronomeVolumeLabel'),

  zoomOutBtn: document.getElementById('zoomOutBtn'),
  zoomInBtn: document.getElementById('zoomInBtn'),
  fitSongBtn: document.getElementById('fitSongBtn'),
  fitSelectionBtn: document.getElementById('fitSelectionBtn'),
  viewRangeLabel: document.getElementById('viewRangeLabel'),
  timelineCanvas: document.getElementById('timelineCanvas'),
  overviewCanvas: document.getElementById('overviewCanvas'),
  syncStatusPill: document.getElementById('syncStatusPill'),
  lyricsStage: document.getElementById('lyricsStage'),
  guideSynthEnabled: document.getElementById('guideSynthEnabled'),
  pitchMinInput: document.getElementById('pitchMinInput'),
  pitchMaxInput: document.getElementById('pitchMaxInput'),
  pitchCanvas: document.getElementById('pitchCanvas'),
  emptyLyricsTemplate: document.getElementById('emptyLyricsTemplate'),
};

function uid(prefix) {
  uidCounter += 1;
  return `${prefix}-${uidCounter}`;
}

function deepClone(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function roundTime(value) {
  if (!isFiniteNumber(value)) {
    return null;
  }
  return Math.round(value * 1000) / 1000;
}

function formatClock(seconds, { hundredths = false, signed = false } = {}) {
  const safe = isFiniteNumber(seconds) ? seconds : 0;
  const sign = signed && safe > 0 ? '+' : signed && safe < 0 ? '-' : '';
  const absolute = Math.abs(safe);
  const mins = Math.floor(absolute / 60);
  const secs = Math.floor(absolute % 60);
  const hundredthsValue = Math.floor((absolute % 1) * 100);
  if (hundredths) {
    return `${sign}${mins}:${String(secs).padStart(2, '0')}.${String(hundredthsValue).padStart(2, '0')}`;
  }
  return `${sign}${mins}:${String(secs).padStart(2, '0')}`;
}

function formatMs(seconds) {
  return `${Math.round((seconds || 0) * 1000)} ms`;
}

function formatPercent(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

function noteNameFromMidi(midi) {
  if (!isFiniteNumber(midi)) {
    return '—';
  }
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const note = names[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

function midiToFrequency(midi) {
  return 440 * (2 ** ((midi - 69) / 12));
}

function sanitizeFilename(name) {
  return (name || 'karaoke-project')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'karaoke-project';
}

function trimEdgePunctuation(text) {
  return (text || '').replace(EDGE_PUNCT_RE, '');
}

function containsKana(text) {
  return KANA_RE.test(text || '');
}

function setFocusRegion(region) {
  runtime.focusRegion = region === 'pitch' ? 'pitch' : 'timing';
  els.keyboardModePill.textContent = runtime.focusRegion === 'pitch' ? 'Pitch keys' : 'Timing keys';
}

function markDirty() {
  runtime.drawDirty = true;
}

function getAudioDuration() {
  if (isFiniteNumber(els.audioPlayer.duration) && els.audioPlayer.duration > 0) {
    return els.audioPlayer.duration;
  }
  return isFiniteNumber(state.audioMeta.duration) ? state.audioMeta.duration : 0;
}

function getCurrentTime() {
  return isFiniteNumber(els.audioPlayer.currentTime) ? els.audioPlayer.currentTime : 0;
}

function getProjectMaxTime() {
  let max = getAudioDuration();
  runtime.index.syllables.forEach((entry) => {
    if (isFiniteNumber(entry.syllable.start)) {
      max = Math.max(max, entry.syllable.start);
    }
    if (isFiniteNumber(entry.syllable.end)) {
      max = Math.max(max, entry.syllable.end);
    }
  });
  return Math.max(FULL_VIEW_MIN, max || FULL_VIEW_MIN);
}

function mergeStateDefaults(project) {
  const base = defaultState();
  const incoming = project || {};
  return {
    ...base,
    ...incoming,
    audioMeta: {
      ...base.audioMeta,
      ...(incoming.audioMeta || {}),
    },
    settings: {
      ...base.settings,
      ...(incoming.settings || {}),
      preprocessing: {
        ...base.settings.preprocessing,
        ...((incoming.settings && incoming.settings.preprocessing) || {}),
      },
      metronome: {
        ...base.settings.metronome,
        ...((incoming.settings && incoming.settings.metronome) || {}),
      },
      pitchRange: {
        ...base.settings.pitchRange,
        ...((incoming.settings && incoming.settings.pitchRange) || {}),
      },
      guideSynth: {
        ...base.settings.guideSynth,
        ...((incoming.settings && incoming.settings.guideSynth) || {}),
      },
    },
    selection: {
      ...base.selection,
      ...(incoming.selection || {}),
    },
    practiceTarget: {
      ...base.practiceTarget,
      ...(incoming.practiceTarget || {}),
    },
  };
}

function normalizeStructure(structure = []) {
  return (structure || []).map((line) => ({
    id: line.id || uid('line'),
    raw: line.raw || '',
    words: (line.words || []).map((word) => ({
      id: word.id || uid('word'),
      raw: word.raw || '',
      text: word.text || '',
      showJoiners: !!word.showJoiners,
      syllables: (word.syllables || []).map((syllable) => ({
        id: syllable.id || uid('sy'),
        text: syllable.text || '',
        start: isFiniteNumber(syllable.start) ? Number(syllable.start) : null,
        end: isFiniteNumber(syllable.end) ? Number(syllable.end) : null,
        pitch: isFiniteNumber(syllable.pitch) ? Number(syllable.pitch) : null,
      })),
    })),
  }));
}

function serializeProject() {
  return {
    appId: APP_ID,
    version: APP_VERSION,
    updatedAt: new Date().toISOString(),
    project: deepClone(state),
  };
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

async function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putAutosave() {
  if (runtime.loadingProject) {
    return;
  }
  const db = await openDb();
  const payload = {
    id: AUTOSAVE_KEY,
    savedAt: Date.now(),
    project: serializeProject(),
    audioBlob,
  };
  await new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(payload);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  updateSaveStatus(`Autosaved locally at ${new Date().toLocaleTimeString()}.`);
}

function scheduleAutosave() {
  clearTimeout(runtime.autosaveTimer);
  runtime.autosaveTimer = setTimeout(() => {
    putAutosave().catch((error) => {
      console.error(error);
      updateSaveStatus('Autosave failed.');
    });
  }, 450);
}

async function loadAutosave() {
  try {
    const db = await openDb();
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const request = tx.objectStore(DB_STORE).get(AUTOSAVE_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!record || !record.project) {
      updateSaveStatus('No autosaved project yet.');
      return;
    }
    await hydrateProject(record.project, record.audioBlob || null, { fromAutosave: true });
    updateSaveStatus(`Loaded autosaved project from ${new Date(record.savedAt).toLocaleString()}.`);
  } catch (error) {
    console.error(error);
    updateSaveStatus('Could not access local project storage.');
  }
}

async function clearAutosave() {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(AUTOSAVE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (error) {
    console.error(error);
  }
}

function updateSaveStatus(text) {
  els.saveStatus.textContent = text;
}

function revokeCurrentObjectUrl() {
  if (runtime.objectUrl) {
    URL.revokeObjectURL(runtime.objectUrl);
    runtime.objectUrl = '';
  }
}

async function ensureAudioContext(resume = false) {
  if (!runtime.audioContext) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    runtime.audioContext = new Ctx();
    runtime.metronomeGain = runtime.audioContext.createGain();
    runtime.guideGain = runtime.audioContext.createGain();
    runtime.metronomeGain.connect(runtime.audioContext.destination);
    runtime.guideGain.connect(runtime.audioContext.destination);
  }
  runtime.metronomeGain.gain.value = clamp(state.settings.metronome.volume, 0, 1);
  runtime.guideGain.gain.value = clamp(state.settings.guideSynth.volume, 0, 1);
  if (resume && runtime.audioContext.state === 'suspended') {
    await runtime.audioContext.resume();
  }
  return runtime.audioContext;
}

function computeWaveformPeaks(audioBuffer, samples = 2600) {
  const channelCount = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const blockSize = Math.max(1, Math.floor(length / samples));
  const peaks = new Array(samples).fill(0);
  for (let i = 0; i < samples; i += 1) {
    const start = i * blockSize;
    const end = Math.min(start + blockSize, length);
    let peak = 0;
    for (let channel = 0; channel < channelCount; channel += 1) {
      const data = audioBuffer.getChannelData(channel);
      for (let j = start; j < end; j += 1) {
        const value = Math.abs(data[j]);
        if (value > peak) {
          peak = value;
        }
      }
    }
    peaks[i] = peak;
  }
  return peaks;
}

async function loadAudioBlob(blob, { preservePlaybackPosition = false } = {}) {
  if (!blob) {
    audioBlob = null;
    state.audioMeta = {
      name: '',
      type: '',
      size: 0,
      duration: 0,
    };
    state.waveformPeaks = [];
    revokeCurrentObjectUrl();
    els.audioPlayer.removeAttribute('src');
    els.audioPlayer.load();
    refreshAudioMeta();
    fitViewToSong();
    resetAudioOverlayState();
    scheduleAutosave();
    return;
  }

  const previousTime = preservePlaybackPosition ? getCurrentTime() : 0;
  audioBlob = blob;
  revokeCurrentObjectUrl();
  runtime.objectUrl = URL.createObjectURL(blob);
  els.audioPlayer.src = runtime.objectUrl;
  els.audioPlayer.playbackRate = state.settings.playbackRate;
  els.audioPlayer.volume = state.settings.musicVolume;
  els.audioPlayer.load();

  state.audioMeta = {
    name: blob.name || state.audioMeta.name || 'audio-file',
    type: blob.type || state.audioMeta.type || 'audio/*',
    size: blob.size || state.audioMeta.size || 0,
    duration: state.audioMeta.duration || 0,
  };

  refreshAudioMeta();

  try {
    const context = await ensureAudioContext(false);
    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await context.decodeAudioData(arrayBuffer.slice(0));
    state.waveformPeaks = computeWaveformPeaks(decoded);
    state.audioMeta.duration = decoded.duration;
  } catch (error) {
    console.warn('Could not decode waveform.', error);
    state.waveformPeaks = [];
  }

  if (preservePlaybackPosition && isFiniteNumber(previousTime)) {
    try {
      els.audioPlayer.currentTime = Math.min(previousTime, getAudioDuration() || previousTime);
    } catch (error) {
      console.warn(error);
    }
  }

  refreshAudioMeta();
  fitViewToSong();
  resetAudioOverlayState();
  markDirty();
  scheduleAutosave();
}

function getFlattenedTimingSnapshot(previousStructure = []) {
  return flattenSyllables(previousStructure).map((entry) => ({
    start: entry.syllable.start,
    end: entry.syllable.end,
    pitch: entry.syllable.pitch,
  }));
}

function preprocessLyricsLines(markup) {
  const safeText = (markup || '').replace(/\r/g, '');
  const lines = safeText.split('\n');
  return lines.filter((lineText) => {
    if (state.settings.preprocessing.excludeSectionLabels && SECTION_LABEL_RE.test(lineText)) {
      return false;
    }
    if (state.settings.preprocessing.excludeDoubleNewlines && !lineText.trim()) {
      return false;
    }
    return true;
  });
}

function splitManualWord(wordRaw) {
  const parts = (wordRaw || '').split(/[-·•/・]+/).filter(Boolean);
  return parts.length ? parts : [wordRaw];
}

function splitKanaWord(wordRaw) {
  const token = trimEdgePunctuation(wordRaw);
  if (!token) {
    return [];
  }
  const chars = Array.from(token);
  const result = [];
  chars.forEach((char) => {
    if (char === 'ー' && result.length) {
      result[result.length - 1] += char;
      return;
    }
    if (SMALL_KANA_RE.test(char) && result.length) {
      result[result.length - 1] += char;
      return;
    }
    result.push(char);
  });
  return result.filter(Boolean);
}

function shouldAttachTrailingVowel(previousVowel, nextVowel) {
  return ['aa', 'ii', 'uu', 'ee', 'oo', 'ou', 'ei'].includes(`${previousVowel}${nextVowel}`);
}

function isVowel(char) {
  return ['a', 'i', 'u', 'e', 'o'].includes(char);
}

function splitRomajiJapaneseWord(wordRaw) {
  const token = trimEdgePunctuation(wordRaw);
  if (!token) {
    return [];
  }
  if (!LATIN_RE.test(token)) {
    return splitManualWord(token);
  }
  const lower = token.toLowerCase();
  const result = [];
  let i = 0;
  while (i < lower.length) {
    const start = i;
    if (isVowel(lower[i])) {
      i += 1;
    } else {
      while (i < lower.length && !isVowel(lower[i])) {
        if (
          lower[i] === 'n'
          && (i === lower.length - 1 || (!isVowel(lower[i + 1]) && lower[i + 1] !== 'y'))
        ) {
          i += 1;
          break;
        }
        i += 1;
        if (i < lower.length && isVowel(lower[i])) {
          break;
        }
      }
      if (i < lower.length && isVowel(lower[i])) {
        i += 1;
      }
    }
    if (i < lower.length && isVowel(lower[i]) && shouldAttachTrailingVowel(lower[i - 1], lower[i])) {
      i += 1;
    }
    if (
      i < lower.length
      && lower[i] === 'n'
      && (i === lower.length - 1 || (!isVowel(lower[i + 1]) && lower[i + 1] !== 'y'))
    ) {
      i += 1;
    }
    result.push(token.slice(start, i));
  }
  return result.filter(Boolean);
}

function splitWordIntoSyllables(wordRaw, splitMode) {
  const hasVisibleSeparators = /[-·•/・]/.test(wordRaw || '');
  if (hasVisibleSeparators) {
    return {
      parts: splitManualWord(wordRaw),
      showJoiners: true,
      text: trimEdgePunctuation(wordRaw).replace(/[-·•/・]+/g, ''),
    };
  }

  if (splitMode === 'auto-japanese') {
    if (containsKana(wordRaw)) {
      const parts = splitKanaWord(wordRaw);
      return {
        parts: parts.length ? parts : [trimEdgePunctuation(wordRaw) || wordRaw],
        showJoiners: false,
        text: trimEdgePunctuation(wordRaw) || wordRaw,
      };
    }
    if (LATIN_RE.test(trimEdgePunctuation(wordRaw))) {
      const parts = splitRomajiJapaneseWord(wordRaw);
      return {
        parts: parts.length ? parts : [trimEdgePunctuation(wordRaw) || wordRaw],
        showJoiners: false,
        text: trimEdgePunctuation(wordRaw) || wordRaw,
      };
    }
  }

  return {
    parts: [trimEdgePunctuation(wordRaw) || wordRaw],
    showJoiners: false,
    text: trimEdgePunctuation(wordRaw) || wordRaw,
  };
}

function parseLyricsMarkup(markup, previousStructure = []) {
  uidCounter = 0;
  const previousSyllables = getFlattenedTimingSnapshot(previousStructure);
  let previousSyllableIndex = 0;
  const lines = preprocessLyricsLines(markup);

  return lines.map((lineText) => {
    const trimmedLine = lineText.trim();
    const wordsRaw = trimmedLine.length ? trimmedLine.split(/\s+/) : [];
    return {
      id: uid('line'),
      raw: lineText,
      words: wordsRaw.map((wordRaw) => {
        const split = splitWordIntoSyllables(wordRaw, state.settings.preprocessing.splitMode);
        const syllableTexts = split.parts.length ? split.parts : [wordRaw];
        return {
          id: uid('word'),
          raw: wordRaw,
          text: split.text || syllableTexts.join(''),
          showJoiners: split.showJoiners,
          syllables: syllableTexts.map((text) => {
            const previous = previousSyllables[previousSyllableIndex] || {};
            previousSyllableIndex += 1;
            return {
              id: uid('sy'),
              text,
              start: isFiniteNumber(previous.start) ? previous.start : null,
              end: isFiniteNumber(previous.end) ? previous.end : null,
              pitch: isFiniteNumber(previous.pitch) ? previous.pitch : null,
            };
          }),
        };
      }),
    };
  });
}

function flattenSyllables(structure = state.structure) {
  const rows = [];
  structure.forEach((line, lineIndex) => {
    line.words.forEach((word, wordIndex) => {
      word.syllables.forEach((syllable, syllableIndex) => {
        rows.push({
          id: syllable.id,
          syllable,
          syllableIndex,
          word,
          wordId: word.id,
          wordIndex,
          line,
          lineId: line.id,
          lineIndex,
        });
      });
    });
  });
  return rows;
}

function rebuildIndex() {
  const lineById = new Map();
  const wordById = new Map();
  const syllableById = new Map();
  const lines = [];
  const words = [];
  const syllables = [];

  state.structure.forEach((line, lineIndex) => {
    const lineEntry = {
      id: line.id,
      line,
      lineIndex,
      firstSyllableId: null,
      lastSyllableId: null,
    };
    lineById.set(line.id, lineEntry);
    lines.push(lineEntry);

    line.words.forEach((word, wordIndex) => {
      const wordEntry = {
        id: word.id,
        word,
        line,
        lineEntry,
        lineId: line.id,
        lineIndex,
        wordIndex,
        globalWordIndex: words.length,
        firstSyllableId: null,
        lastSyllableId: null,
      };
      wordById.set(word.id, wordEntry);
      words.push(wordEntry);

      word.syllables.forEach((syllable, syllableIndex) => {
        const entry = {
          id: syllable.id,
          syllable,
          syllableIndex,
          globalIndex: syllables.length,
          word,
          wordId: word.id,
          wordEntry,
          wordIndex,
          line,
          lineId: line.id,
          lineEntry,
          lineIndex,
        };
        syllables.push(entry);
        syllableById.set(syllable.id, entry);
        if (!wordEntry.firstSyllableId) {
          wordEntry.firstSyllableId = syllable.id;
        }
        wordEntry.lastSyllableId = syllable.id;
        if (!lineEntry.firstSyllableId) {
          lineEntry.firstSyllableId = syllable.id;
        }
        lineEntry.lastSyllableId = syllable.id;
      });
    });
  });

  runtime.index = {
    lines,
    words,
    syllables,
    lineById,
    wordById,
    syllableById,
  };

  if (!state.selection.syllableId || !syllableById.has(state.selection.syllableId)) {
    state.selection.syllableId = syllables[0] ? syllables[0].id : null;
  }

  const practiceValid =
    (state.practiceTarget.kind === 'syllable' && syllableById.has(state.practiceTarget.id))
    || (state.practiceTarget.kind === 'word' && wordById.has(state.practiceTarget.id))
    || (state.practiceTarget.kind === 'line' && lineById.has(state.practiceTarget.id));

  if (!practiceValid) {
    state.practiceTarget = {
      kind: 'syllable',
      id: state.selection.syllableId,
    };
  }
}

function getSelectionEntry() {
  return runtime.index.syllableById.get(state.selection.syllableId) || null;
}

function getPracticeTarget() {
  return state.practiceTarget;
}

function getFirstSyllableIdForTarget(target) {
  if (!target || !target.id) {
    return null;
  }
  if (target.kind === 'syllable') {
    return target.id;
  }
  if (target.kind === 'word') {
    return runtime.index.wordById.get(target.id)?.firstSyllableId || null;
  }
  if (target.kind === 'line') {
    return runtime.index.lineById.get(target.id)?.firstSyllableId || null;
  }
  return null;
}

function getLastSyllableIdForTarget(target) {
  if (!target || !target.id) {
    return null;
  }
  if (target.kind === 'syllable') {
    return target.id;
  }
  if (target.kind === 'word') {
    return runtime.index.wordById.get(target.id)?.lastSyllableId || null;
  }
  if (target.kind === 'line') {
    return runtime.index.lineById.get(target.id)?.lastSyllableId || null;
  }
  return null;
}

function findPreviousTimedSyllableStart(globalIndex) {
  for (let i = globalIndex - 1; i >= 0; i -= 1) {
    const start = runtime.index.syllables[i].syllable.start;
    if (isFiniteNumber(start)) {
      return start;
    }
  }
  return null;
}

function findNextTimedSyllableStart(globalIndex) {
  for (let i = globalIndex + 1; i < runtime.index.syllables.length; i += 1) {
    const start = runtime.index.syllables[i].syllable.start;
    if (isFiniteNumber(start)) {
      return start;
    }
  }
  return null;
}

function getEffectiveSyllableEnd(globalIndex) {
  const entry = runtime.index.syllables[globalIndex];
  if (!entry || !isFiniteNumber(entry.syllable.start)) {
    return null;
  }
  if (isFiniteNumber(entry.syllable.end) && entry.syllable.end > entry.syllable.start) {
    return entry.syllable.end;
  }
  const next = findNextTimedSyllableStart(globalIndex);
  if (isFiniteNumber(next)) {
    return next;
  }
  const duration = getAudioDuration();
  if (isFiniteNumber(duration) && duration > entry.syllable.start) {
    return duration;
  }
  return entry.syllable.start + DEFAULT_TAIL;
}

function clampSyllableStart(globalIndex, time) {
  const entry = runtime.index.syllables[globalIndex];
  if (!entry) {
    return 0;
  }
  const previous = findPreviousTimedSyllableStart(globalIndex);
  const next = findNextTimedSyllableStart(globalIndex);
  const ownExplicitEnd = entry.syllable.end;
  const duration = getAudioDuration() || getProjectMaxTime();
  let max = isFiniteNumber(next) ? next - EPSILON : duration;
  if (isFiniteNumber(ownExplicitEnd)) {
    max = Math.min(max, ownExplicitEnd - EPSILON);
  }
  const min = isFiniteNumber(previous) ? previous + EPSILON : 0;
  return clamp(time, min, Math.max(min, max));
}

function clampSyllableEnd(globalIndex, time) {
  const entry = runtime.index.syllables[globalIndex];
  if (!entry || !isFiniteNumber(entry.syllable.start)) {
    return null;
  }
  const next = findNextTimedSyllableStart(globalIndex);
  const duration = getAudioDuration() || getProjectMaxTime() + DEFAULT_TAIL;
  const min = entry.syllable.start + EPSILON;
  const max = isFiniteNumber(next) ? next : duration;
  return clamp(time, min, Math.max(min, max));
}

function getRangeForTarget(target = getPracticeTarget()) {
  const firstId = getFirstSyllableIdForTarget(target);
  const lastId = getLastSyllableIdForTarget(target);
  if (!firstId || !lastId) {
    return null;
  }
  const firstEntry = runtime.index.syllableById.get(firstId);
  const lastEntry = runtime.index.syllableById.get(lastId);
  if (!firstEntry || !lastEntry) {
    return null;
  }
  const start = firstEntry.syllable.start;
  const end = getEffectiveSyllableEnd(lastEntry.globalIndex);
  if (!isFiniteNumber(start) || !isFiniteNumber(end)) {
    return null;
  }
  return {
    start,
    end,
  };
}

function getSyncedCount() {
  return runtime.index.syllables.filter((entry) => isFiniteNumber(entry.syllable.start)).length;
}

function ensureTimeInView(time) {
  if (!isFiniteNumber(time)) {
    return;
  }
  const leftPadding = runtime.view.duration * 0.12;
  const rightPadding = runtime.view.duration * 0.12;
  if (time < runtime.view.start + leftPadding) {
    runtime.view.start = time - leftPadding;
    clampView();
    markDirty();
    return;
  }
  const currentEnd = runtime.view.start + runtime.view.duration;
  if (time > currentEnd - rightPadding) {
    runtime.view.start = time - runtime.view.duration + rightPadding;
    clampView();
    markDirty();
  }
}

function fitViewToSong() {
  runtime.view.start = 0;
  runtime.view.duration = Math.max(FULL_VIEW_MIN, getProjectMaxTime());
  clampView();
  markDirty();
}

function fitViewToRange(range = getRangeForTarget()) {
  if (!range) {
    fitViewToSong();
    return;
  }
  const duration = Math.max(range.end - range.start, VIEW_MIN_DURATION);
  const padding = Math.max(0.12, duration * 0.35);
  runtime.view.start = range.start - padding;
  runtime.view.duration = duration + padding * 2;
  clampView();
  markDirty();
}

function clampView() {
  const full = Math.max(FULL_VIEW_MIN, getProjectMaxTime());
  runtime.view.duration = clamp(runtime.view.duration || full, VIEW_MIN_DURATION, full);
  runtime.view.start = clamp(runtime.view.start || 0, 0, Math.max(0, full - runtime.view.duration));
  updateViewRangeLabel();
}

function zoomView(factor, anchorTime = getCurrentTime()) {
  const full = Math.max(FULL_VIEW_MIN, getProjectMaxTime());
  const oldDuration = runtime.view.duration;
  const oldStart = runtime.view.start;
  const clampedAnchor = clamp(anchorTime, oldStart, oldStart + oldDuration);
  const ratio = oldDuration > 0 ? (clampedAnchor - oldStart) / oldDuration : 0.5;
  runtime.view.duration = clamp(oldDuration * factor, VIEW_MIN_DURATION, full);
  runtime.view.start = clampedAnchor - ratio * runtime.view.duration;
  clampView();
  markDirty();
}

function panViewTo(start) {
  runtime.view.start = start;
  clampView();
  markDirty();
}

function updateViewRangeLabel() {
  els.viewRangeLabel.textContent = `${formatClock(runtime.view.start, { hundredths: true })} → ${formatClock(runtime.view.start + runtime.view.duration, { hundredths: true })}`;
}

function setSelectionSyllableById(id, { practiceKind = 'syllable', practiceId = id, scroll = true, ensureView = true } = {}) {
  if (!runtime.index.syllableById.has(id)) {
    return;
  }
  state.selection.syllableId = id;
  state.practiceTarget = {
    kind: practiceKind,
    id: practiceId,
  };
  const entry = getSelectionEntry();
  if (entry && isFiniteNumber(entry.syllable.pitch)) {
    runtime.selectedPitchGhost = entry.syllable.pitch;
  }
  updateSelectedEditor();
  updateLoopButton();
  updateLyricsDynamic();
  if (scroll) {
    scrollSelectionIntoView();
  }
  if (ensureView && entry && isFiniteNumber(entry.syllable.start)) {
    ensureTimeInView(entry.syllable.start);
  }
  markDirty();
}

function selectSyllableByIndex(index, options = {}) {
  const safeIndex = clamp(index, 0, Math.max(0, runtime.index.syllables.length - 1));
  const entry = runtime.index.syllables[safeIndex];
  if (entry) {
    setSelectionSyllableById(entry.id, options);
  }
}

function scrollSelectionIntoView() {
  const selectedEntry = getSelectionEntry();
  if (!selectedEntry) {
    return;
  }
  const lineNode = runtime.dom.lines.get(selectedEntry.lineId);
  if (lineNode && state.settings.autoScrollLyrics) {
    lineNode.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function refreshAudioMeta() {
  els.audioFileName.textContent = state.audioMeta.name || 'No audio';
  els.audioDurationLabel.textContent = formatClock(getAudioDuration(), { hundredths: false });
}

function updateLoopButton() {
  els.loopSelectionBtn.textContent = state.settings.loopSelection ? 'Loop on' : 'Loop off';
}

function updateTransportUi() {
  const duration = Math.max(getProjectMaxTime(), getAudioDuration(), 1);
  const currentTime = getCurrentTime();
  els.playPauseBtn.textContent = els.audioPlayer.paused ? 'Play' : 'Pause';
  els.currentTimeLabel.textContent = formatClock(currentTime, { hundredths: true });
  els.remainingTimeLabel.textContent = `-${formatClock(Math.max(0, duration - currentTime), { hundredths: true })}`;
  els.scrubInput.max = String(duration);
  els.scrubInput.value = String(clamp(currentTime, 0, duration));
  els.rewindBtn.textContent = `-${state.settings.seekStep}s`;
  els.forwardBtn.textContent = `+${state.settings.seekStep}s`;
  updateViewRangeLabel();
}

function syncInputsFromState() {
  els.projectName.value = state.projectName || '';
  els.lyricsInput.value = state.lyricsMarkup || '';
  els.playbackRateInput.value = String(state.settings.playbackRate);
  els.playbackRateLabel.textContent = `${state.settings.playbackRate.toFixed(2)}x`;
  els.preRollInput.value = String(state.settings.preRoll);
  els.preRollLabel.textContent = formatMs(state.settings.preRoll);
  els.postRollInput.value = String(state.settings.postRoll);
  els.postRollLabel.textContent = formatMs(state.settings.postRoll);
  els.seekStepInput.value = String(state.settings.seekStep);
  els.nudgeStepInput.value = String(Math.round(state.settings.nudgeStep * 1000));
  els.musicVolumeInput.value = String(state.settings.musicVolume);
  els.musicVolumeLabel.textContent = formatPercent(state.settings.musicVolume);
  els.guideVolumeInput.value = String(state.settings.guideSynth.volume);
  els.guideVolumeLabel.textContent = formatPercent(state.settings.guideSynth.volume);
  els.autoPlayOnJump.checked = state.settings.autoPlayOnJump;
  els.autoScrollLyrics.checked = state.settings.autoScrollLyrics;
  els.splitModeSelect.value = state.settings.preprocessing.splitMode;
  els.excludeDoubleNewlines.checked = state.settings.preprocessing.excludeDoubleNewlines;
  els.excludeSectionLabels.checked = state.settings.preprocessing.excludeSectionLabels;
  els.metronomeEnabled.checked = state.settings.metronome.enabled;
  els.metronomeBpm.value = String(state.settings.metronome.bpm);
  els.metronomeOffset.value = String(state.settings.metronome.offset);
  els.metronomeBeatsPerBar.value = String(state.settings.metronome.beatsPerBar);
  els.metronomeVolume.value = String(state.settings.metronome.volume);
  els.metronomeVolumeLabel.textContent = formatPercent(state.settings.metronome.volume);
  els.guideSynthEnabled.checked = state.settings.guideSynth.enabled;
  els.pitchMinInput.value = String(state.settings.pitchRange.min);
  els.pitchMaxInput.value = String(state.settings.pitchRange.max);
  els.audioPlayer.playbackRate = state.settings.playbackRate;
  els.audioPlayer.volume = state.settings.musicVolume;
  updateLoopButton();
  refreshAudioMeta();
  updateSelectedEditor();
  updateSyncStatus();
  updateTransportUi();
}

function updateSyncStatus() {
  const total = runtime.index.syllables.length;
  const synced = getSyncedCount();
  els.syncStatusPill.textContent = `${synced} / ${total || 0} starts`; 
}

function updateSelectedEditor() {
  const entry = getSelectionEntry();
  if (!entry) {
    els.selectedSummary.textContent = 'Nothing selected';
    els.selectedSummaryDetail.textContent = 'Nothing selected';
    els.selectedStartInput.value = '';
    els.selectedEndInput.value = '';
    els.selectedPitchInput.value = '';
    els.selectedPitchLabel.textContent = '—';
    return;
  }

  const currentIndex = entry.globalIndex + 1;
  const total = runtime.index.syllables.length;
  const target = getPracticeTarget();
  let targetText = 'syllable';
  if (target.kind === 'word') {
    targetText = `word “${runtime.index.wordById.get(target.id)?.word.text || ''}”`;
  } else if (target.kind === 'line') {
    const lineIndex = runtime.index.lineById.get(target.id)?.lineIndex;
    targetText = isFiniteNumber(lineIndex) ? `line ${lineIndex + 1}` : 'line';
  }
  els.selectedSummary.textContent = `#${currentIndex}/${total} “${entry.syllable.text}” · ${targetText}`;
  els.selectedSummaryDetail.textContent = `Syllable ${currentIndex}/${total}: “${entry.syllable.text}” · line ${entry.lineIndex + 1}, word ${entry.wordIndex + 1}. Practice target: ${targetText}.`;
  els.selectedStartInput.value = isFiniteNumber(entry.syllable.start) ? entry.syllable.start.toFixed(3) : '';
  els.selectedEndInput.value = isFiniteNumber(entry.syllable.end) ? entry.syllable.end.toFixed(3) : '';
  els.selectedPitchInput.value = isFiniteNumber(entry.syllable.pitch) ? String(entry.syllable.pitch) : '';
  els.selectedPitchLabel.textContent = noteNameFromMidi(entry.syllable.pitch);
}

function buildLyricsStructure() {
  state.lyricsMarkup = els.lyricsInput.value;
  state.structure = parseLyricsMarkup(state.lyricsMarkup, state.structure);
  rebuildIndex();
  renderLyrics();
  syncInputsFromState();
  if (!getAudioDuration()) {
    fitViewToSong();
  }
  markDirty();
  scheduleAutosave();
}

function renderLyrics() {
  runtime.dom.lines.clear();
  runtime.dom.words.clear();
  runtime.dom.syllables.clear();
  els.lyricsStage.innerHTML = '';

  if (!state.structure.some((line) => line.words.length > 0)) {
    els.lyricsStage.appendChild(els.emptyLyricsTemplate.content.cloneNode(true));
    updateSyncStatus();
    return;
  }

  state.structure.forEach((line, lineIndex) => {
    const lineNode = document.createElement('div');
    lineNode.className = 'lyric-line';
    lineNode.dataset.lineId = line.id;

    const lineButton = document.createElement('button');
    lineButton.type = 'button';
    lineButton.className = 'line-jump compact';
    lineButton.dataset.lineId = line.id;
    lineButton.title = `Jump to line ${lineIndex + 1}`;
    lineButton.textContent = String(lineIndex + 1);

    const content = document.createElement('div');
    content.className = 'line-content';

    line.words.forEach((word) => {
      const wordNode = document.createElement('span');
      wordNode.className = 'lyric-word';
      wordNode.dataset.wordId = word.id;
      wordNode.title = `Jump to word “${word.text || word.raw}”`;
      runtime.dom.words.set(word.id, wordNode);

      word.syllables.forEach((syllable, syllableIndex) => {
        const syllableNode = document.createElement('span');
        syllableNode.className = 'syllable';
        syllableNode.dataset.syllableId = syllable.id;
        syllableNode.textContent = syllable.text;
        syllableNode.title = `Jump to syllable “${syllable.text}”`;
        runtime.dom.syllables.set(syllable.id, syllableNode);
        wordNode.appendChild(syllableNode);
        if (word.showJoiners && syllableIndex < word.syllables.length - 1) {
          const joiner = document.createElement('span');
          joiner.className = 'syllable-joiner';
          joiner.textContent = '-';
          wordNode.appendChild(joiner);
        }
      });

      content.appendChild(wordNode);
    });

    lineNode.append(lineButton, content);
    els.lyricsStage.appendChild(lineNode);
    runtime.dom.lines.set(line.id, lineNode);
  });

  updateLyricsDynamic();
  updateSyncStatus();
}

function getCurrentSoundingEntry() {
  const currentTime = getCurrentTime();
  for (const entry of runtime.index.syllables) {
    const start = entry.syllable.start;
    const end = getEffectiveSyllableEnd(entry.globalIndex);
    if (isFiniteNumber(start) && isFiniteNumber(end) && currentTime >= start && currentTime < end) {
      return entry;
    }
  }
  return null;
}

function updateLyricsDynamic() {
  const currentTime = getCurrentTime();
  const selectedEntry = getSelectionEntry();
  const practiceTarget = getPracticeTarget();
  const soundingEntry = getCurrentSoundingEntry();
  let activeLineId = soundingEntry?.lineId || null;

  runtime.index.syllables.forEach((entry) => {
    const node = runtime.dom.syllables.get(entry.id);
    if (!node) {
      return;
    }
    const start = entry.syllable.start;
    const end = getEffectiveSyllableEnd(entry.globalIndex);
    let fill = 0;
    let isSounding = false;
    let isComplete = false;
    if (isFiniteNumber(start) && isFiniteNumber(end) && end > start) {
      if (currentTime >= end) {
        fill = 100;
        isComplete = true;
      } else if (currentTime > start) {
        fill = clamp(((currentTime - start) / (end - start)) * 100, 0, 100);
        isSounding = true;
      }
    }
    node.style.setProperty('--fill', `${fill}%`);
    node.classList.toggle('is-selected', entry.id === state.selection.syllableId);
    node.classList.toggle('is-sounding', isSounding);
    node.classList.toggle('is-complete', isComplete || fill >= 100);
    node.classList.toggle('is-unsynced', !isFiniteNumber(start));
  });

  runtime.index.words.forEach((entry) => {
    const node = runtime.dom.words.get(entry.id);
    if (!node) {
      return;
    }
    const first = runtime.index.syllableById.get(entry.firstSyllableId);
    const start = first?.syllable.start;
    node.classList.toggle('selected-word', practiceTarget.kind === 'word' && practiceTarget.id === entry.id);
    node.classList.toggle('unsynced', !isFiniteNumber(start));
  });

  runtime.index.lines.forEach((entry) => {
    const node = runtime.dom.lines.get(entry.id);
    if (!node) {
      return;
    }
    const firstEntry = runtime.index.syllableById.get(entry.firstSyllableId);
    const lastEntry = runtime.index.syllableById.get(entry.lastSyllableId);
    const start = firstEntry?.syllable.start;
    const end = isFiniteNumber(lastEntry?.globalIndex) ? getEffectiveSyllableEnd(lastEntry.globalIndex) : null;
    const lineActive = isFiniteNumber(start) && isFiniteNumber(end) && currentTime >= start && currentTime < end;
    node.classList.toggle('active', lineActive || activeLineId === entry.id);
    node.classList.toggle('selected-line', practiceTarget.kind === 'line' && practiceTarget.id === entry.id);
  });

  if (selectedEntry && selectedEntry.lineId && state.settings.autoScrollLyrics && activeLineId && runtime.lastAutoScrolledLineId !== activeLineId) {
    const activeLine = runtime.dom.lines.get(activeLineId);
    if (activeLine) {
      activeLine.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      runtime.lastAutoScrolledLineId = activeLineId;
    }
  }
}

function resizeCanvasToDisplaySize(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return {
    ctx: canvas.getContext('2d'),
    width,
    height,
    dpr,
  };
}

function getCanvasPoint(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  return {
    x: (event.clientX - rect.left) * dpr,
    y: (event.clientY - rect.top) * dpr,
    width: rect.width * dpr,
    height: rect.height * dpr,
  };
}

function timeToX(time, width, gutter = 0) {
  const relative = (time - runtime.view.start) / runtime.view.duration;
  return gutter + relative * Math.max(1, width - gutter);
}

function xToTime(x, width, gutter = 0) {
  const effectiveWidth = Math.max(1, width - gutter);
  const clampedX = clamp(x - gutter, 0, effectiveWidth);
  return runtime.view.start + (clampedX / effectiveWidth) * runtime.view.duration;
}

function drawBackground(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#0b1020');
  gradient.addColorStop(1, '#141b32');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function drawBeatGrid(ctx, width, height, { gutter = 0, alpha = 0.18 } = {}) {
  if (!state.settings.metronome.enabled) {
    return;
  }
  const bpm = clamp(state.settings.metronome.bpm, 20, 300);
  const beatInterval = 60 / bpm;
  const offset = Number(state.settings.metronome.offset) || 0;
  const beatsPerBar = clamp(state.settings.metronome.beatsPerBar, 1, 12);
  const visibleStart = runtime.view.start;
  const visibleEnd = runtime.view.start + runtime.view.duration;
  const firstBeatIndex = Math.floor((visibleStart - offset) / beatInterval) - 1;
  ctx.save();
  for (let beatIndex = firstBeatIndex; beatIndex < firstBeatIndex + 800; beatIndex += 1) {
    const beatTime = offset + beatIndex * beatInterval;
    if (beatTime < visibleStart - beatInterval) {
      continue;
    }
    if (beatTime > visibleEnd + beatInterval) {
      break;
    }
    const x = timeToX(beatTime, width, gutter);
    const major = ((beatIndex % beatsPerBar) + beatsPerBar) % beatsPerBar === 0;
    ctx.strokeStyle = major ? `rgba(243, 181, 98, ${alpha + 0.12})` : `rgba(255, 255, 255, ${alpha})`;
    ctx.lineWidth = major ? 1.4 : 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWaveform(ctx, width, height) {
  const peaks = state.waveformPeaks || [];
  if (!peaks.length) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = `${12 * (window.devicePixelRatio || 1)}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.fillText('Load audio to show the waveform.', 16, height / 2);
    ctx.restore();
    return;
  }
  const duration = Math.max(getAudioDuration(), getProjectMaxTime());
  const mid = height / 2;
  ctx.save();
  ctx.strokeStyle = 'rgba(115, 164, 255, 0.8)';
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 1) {
    const time = xToTime(x, width, 0);
    const peakIndex = clamp(Math.floor((time / duration) * peaks.length), 0, peaks.length - 1);
    const peak = peaks[peakIndex] || 0;
    const amplitude = peak * (height * 0.46);
    ctx.beginPath();
    ctx.moveTo(x + 0.5, mid - amplitude);
    ctx.lineTo(x + 0.5, mid + amplitude);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTimelineSelectionRange(ctx, width, height) {
  const range = getRangeForTarget();
  if (!range) {
    return;
  }
  const x1 = timeToX(range.start, width);
  const x2 = timeToX(range.end, width);
  ctx.save();
  ctx.fillStyle = 'rgba(115, 164, 255, 0.12)';
  ctx.fillRect(x1, 0, Math.max(1, x2 - x1), height);
  ctx.restore();
}

function drawTimelineBlocks(ctx, width, height) {
  runtime.timelineHitboxes = [];
  const trackY = height - TIMELINE_TRACK_HEIGHT;
  const trackHeight = TIMELINE_TRACK_HEIGHT - 8;
  const selected = getSelectionEntry();
  runtime.index.syllables.forEach((entry) => {
    if (!isFiniteNumber(entry.syllable.start)) {
      return;
    }
    const start = entry.syllable.start;
    const end = getEffectiveSyllableEnd(entry.globalIndex);
    if (!isFiniteNumber(end)) {
      return;
    }
    if (end < runtime.view.start || start > runtime.view.start + runtime.view.duration) {
      return;
    }
    const x1 = timeToX(start, width);
    const x2 = timeToX(end, width);
    const w = Math.max(3, x2 - x1);
    const y = trackY;
    const isSelected = selected?.id === entry.id;
    const isSounding = getCurrentSoundingEntry()?.id === entry.id;
    ctx.save();
    ctx.fillStyle = isSounding ? 'rgba(243, 181, 98, 0.8)' : isSelected ? 'rgba(115, 164, 255, 0.82)' : 'rgba(87, 215, 178, 0.52)';
    ctx.strokeStyle = isSelected ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = isSelected ? 1.8 : 1;
    roundRect(ctx, x1, y, w, trackHeight, 7);
    ctx.fill();
    ctx.stroke();
    if (!isFiniteNumber(entry.syllable.end)) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.38)';
      ctx.beginPath();
      ctx.moveTo(x2, y + 3);
      ctx.lineTo(x2, y + trackHeight - 3);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (w > 20) {
      ctx.fillStyle = 'rgba(7, 11, 22, 0.8)';
      ctx.font = `${11 * (window.devicePixelRatio || 1)}px ${getComputedStyle(document.body).fontFamily}`;
      ctx.fillText(entry.syllable.text, x1 + 6, y + trackHeight / 2 + 4);
    }
    ctx.restore();

    runtime.timelineHitboxes.push({
      type: 'block',
      syllableId: entry.id,
      x: x1,
      y,
      w,
      h: trackHeight,
    });

    if (isSelected) {
      const handleSize = 8 * (window.devicePixelRatio || 1);
      runtime.timelineHitboxes.push({
        type: 'start-handle',
        syllableId: entry.id,
        x: x1 - handleSize / 2,
        y,
        w: handleSize,
        h: trackHeight,
      });
      runtime.timelineHitboxes.push({
        type: 'end-handle',
        syllableId: entry.id,
        x: x2 - handleSize / 2,
        y,
        w: handleSize,
        h: trackHeight,
      });
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillRect(x1 - 1, y - 1, 2, trackHeight + 2);
      ctx.fillRect(x2 - 1, y - 1, 2, trackHeight + 2);
      ctx.restore();
    }
  });
}

function drawPlayhead(ctx, width, height, { gutter = 0 } = {}) {
  const x = timeToX(getCurrentTime(), width, gutter);
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 108, 108, 0.95)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, height);
  ctx.stroke();
  ctx.restore();
}

function drawTimeline() {
  const { ctx, width, height } = resizeCanvasToDisplaySize(els.timelineCanvas);
  drawBackground(ctx, width, height);
  drawTimelineSelectionRange(ctx, width, height);
  drawBeatGrid(ctx, width, height - TIMELINE_TRACK_HEIGHT, { alpha: 0.12 });
  drawWaveform(ctx, width, height - TIMELINE_TRACK_HEIGHT);
  drawTimelineBlocks(ctx, width, height);
  drawPlayhead(ctx, width, height);
}

function drawOverview() {
  const { ctx, width, height } = resizeCanvasToDisplaySize(els.overviewCanvas);
  drawBackground(ctx, width, height);
  const fullDuration = getProjectMaxTime();
  const peaks = state.waveformPeaks || [];
  if (peaks.length) {
    const mid = height / 2;
    ctx.save();
    ctx.strokeStyle = 'rgba(115, 164, 255, 0.75)';
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 1) {
      const peakIndex = clamp(Math.floor((x / width) * peaks.length), 0, peaks.length - 1);
      const peak = peaks[peakIndex] || 0;
      const amplitude = peak * (height * 0.44);
      ctx.beginPath();
      ctx.moveTo(x + 0.5, mid - amplitude);
      ctx.lineTo(x + 0.5, mid + amplitude);
      ctx.stroke();
    }
    ctx.restore();
  }
  const viewportX = (runtime.view.start / fullDuration) * width;
  const viewportW = Math.max(12, (runtime.view.duration / fullDuration) * width);
  runtime.overviewViewportHitbox = {
    x: viewportX,
    y: 0,
    w: viewportW,
    h: height,
  };
  ctx.save();
  ctx.fillStyle = 'rgba(115, 164, 255, 0.18)';
  ctx.fillRect(viewportX, 0, viewportW, height);
  ctx.strokeStyle = 'rgba(255,255,255,0.82)';
  ctx.lineWidth = 2;
  ctx.strokeRect(viewportX, 1, viewportW, height - 2);
  const playheadX = (getCurrentTime() / fullDuration) * width;
  ctx.strokeStyle = 'rgba(255, 108, 108, 0.95)';
  ctx.beginPath();
  ctx.moveTo(playheadX, 0);
  ctx.lineTo(playheadX, height);
  ctx.stroke();
  ctx.restore();
}

function pitchToY(pitch, minPitch, maxPitch, height) {
  const rowCount = Math.max(1, maxPitch - minPitch + 1);
  const rowHeight = (height - 16) / rowCount;
  return 8 + (maxPitch - pitch) * rowHeight;
}

function yToPitch(y, minPitch, maxPitch, height) {
  const rowCount = Math.max(1, maxPitch - minPitch + 1);
  const rowHeight = (height - 16) / rowCount;
  const raw = maxPitch - Math.floor((clamp(y, 8, height - 8) - 8) / rowHeight);
  return clamp(raw, minPitch, maxPitch);
}

function getGhostPitchForSelected() {
  const entry = getSelectionEntry();
  if (entry && isFiniteNumber(entry.syllable.pitch)) {
    return entry.syllable.pitch;
  }
  return clamp(runtime.selectedPitchGhost || Math.round((state.settings.pitchRange.min + state.settings.pitchRange.max) / 2), 24, 108);
}

function drawPitchGuide() {
  const { ctx, width, height } = resizeCanvasToDisplaySize(els.pitchCanvas);
  drawBackground(ctx, width, height);
  const minPitch = Math.min(state.settings.pitchRange.min, state.settings.pitchRange.max);
  const maxPitch = Math.max(state.settings.pitchRange.min, state.settings.pitchRange.max);
  const rowCount = Math.max(1, maxPitch - minPitch + 1);
  const rowHeight = (height - 16) / rowCount;
  const selectedEntry = getSelectionEntry();
  runtime.pitchHitboxes = [];

  ctx.save();
  for (let pitch = maxPitch; pitch >= minPitch; pitch -= 1) {
    const y = pitchToY(pitch, minPitch, maxPitch, height);
    const isBlack = [1, 3, 6, 8, 10].includes(((pitch % 12) + 12) % 12);
    ctx.fillStyle = isBlack ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.08)';
    ctx.fillRect(PITCH_GUTTER, y, width - PITCH_GUTTER, rowHeight);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = `${10 * (window.devicePixelRatio || 1)}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.fillText(noteNameFromMidi(pitch), 6, y + rowHeight * 0.72);
  }
  ctx.restore();

  drawBeatGrid(ctx, width, height, { gutter: PITCH_GUTTER, alpha: 0.12 });

  const soundingEntry = getCurrentSoundingEntry();
  runtime.index.syllables.forEach((entry) => {
    const start = entry.syllable.start;
    const end = getEffectiveSyllableEnd(entry.globalIndex);
    const hasPitch = isFiniteNumber(entry.syllable.pitch);
    const shouldShowGhost = selectedEntry?.id === entry.id && !hasPitch && isFiniteNumber(start) && isFiniteNumber(end);
    if (!isFiniteNumber(start) || !isFiniteNumber(end) || (!hasPitch && !shouldShowGhost)) {
      return;
    }
    const pitch = hasPitch ? entry.syllable.pitch : getGhostPitchForSelected();
    const x1 = timeToX(start, width, PITCH_GUTTER);
    const x2 = timeToX(end, width, PITCH_GUTTER);
    const y = pitchToY(pitch, minPitch, maxPitch, height) + rowHeight * 0.14;
    const h = rowHeight * 0.72;
    const w = Math.max(4, x2 - x1);
    const isSelected = selectedEntry?.id === entry.id;
    const isSounding = soundingEntry?.id === entry.id;
    ctx.save();
    ctx.fillStyle = shouldShowGhost
      ? 'rgba(255,255,255,0.12)'
      : isSounding
        ? 'rgba(243, 181, 98, 0.85)'
        : isSelected
          ? 'rgba(115, 164, 255, 0.85)'
          : 'rgba(87, 215, 178, 0.62)';
    ctx.strokeStyle = shouldShowGhost ? 'rgba(255,255,255,0.65)' : 'rgba(7, 11, 22, 0.6)';
    ctx.lineWidth = shouldShowGhost ? 1.8 : 1;
    if (shouldShowGhost) {
      ctx.setLineDash([6, 4]);
    }
    roundRect(ctx, x1, y, w, h, 6);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    if (w > 28) {
      ctx.fillStyle = 'rgba(6, 10, 22, 0.82)';
      ctx.font = `${11 * (window.devicePixelRatio || 1)}px ${getComputedStyle(document.body).fontFamily}`;
      ctx.fillText(`${entry.syllable.text} · ${noteNameFromMidi(pitch)}`, x1 + 6, y + h * 0.66);
    }
    ctx.restore();
    runtime.pitchHitboxes.push({
      type: shouldShowGhost ? 'ghost-note' : 'note',
      syllableId: entry.id,
      x: x1,
      y,
      w,
      h,
      pitch,
    });
  });

  drawPlayhead(ctx, width, height, { gutter: PITCH_GUTTER });
}

function roundRect(ctx, x, y, w, h, radius) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function findHitbox(hitboxes, x, y) {
  for (let i = hitboxes.length - 1; i >= 0; i -= 1) {
    const hitbox = hitboxes[i];
    if (x >= hitbox.x && x <= hitbox.x + hitbox.w && y >= hitbox.y && y <= hitbox.y + hitbox.h) {
      return hitbox;
    }
  }
  return null;
}

function setSelectedStartTime(time) {
  const entry = getSelectionEntry();
  if (!entry || !isFiniteNumber(time)) {
    return;
  }
  entry.syllable.start = roundTime(clampSyllableStart(entry.globalIndex, time));
  if (isFiniteNumber(entry.syllable.end) && entry.syllable.end <= entry.syllable.start + EPSILON) {
    entry.syllable.end = null;
  }
  afterTimingMutation({ ensureViewTime: entry.syllable.start });
}

function setSelectedEndTime(time) {
  const entry = getSelectionEntry();
  if (!entry || !isFiniteNumber(time) || !isFiniteNumber(entry.syllable.start)) {
    return;
  }
  entry.syllable.end = roundTime(clampSyllableEnd(entry.globalIndex, time));
  afterTimingMutation({ ensureViewTime: entry.syllable.end });
}

function setSyllableStartById(id, time) {
  const entry = runtime.index.syllableById.get(id);
  if (!entry || !isFiniteNumber(time)) {
    return;
  }
  entry.syllable.start = roundTime(clampSyllableStart(entry.globalIndex, time));
  if (isFiniteNumber(entry.syllable.end) && entry.syllable.end <= entry.syllable.start + EPSILON) {
    entry.syllable.end = null;
  }
  afterTimingMutation({ ensureViewTime: entry.syllable.start, skipSelectionUpdate: true });
}

function setSyllableEndById(id, time) {
  const entry = runtime.index.syllableById.get(id);
  if (!entry || !isFiniteNumber(time) || !isFiniteNumber(entry.syllable.start)) {
    return;
  }
  entry.syllable.end = roundTime(clampSyllableEnd(entry.globalIndex, time));
  afterTimingMutation({ ensureViewTime: entry.syllable.end, skipSelectionUpdate: true });
}

function clearSelectedEnd() {
  const entry = getSelectionEntry();
  if (!entry) {
    return;
  }
  entry.syllable.end = null;
  afterTimingMutation({ ensureViewTime: entry.syllable.start });
}

function clearSelectedTiming({ movePrev = false } = {}) {
  const entry = getSelectionEntry();
  if (!entry) {
    return;
  }
  entry.syllable.start = null;
  entry.syllable.end = null;
  afterTimingMutation();
  if (movePrev) {
    selectSyllableByIndex(entry.globalIndex - 1, { scroll: true, ensureView: false });
  }
}

function clearTimingsFromSelectedForward() {
  const entry = getSelectionEntry();
  if (!entry) {
    return;
  }
  for (let i = entry.globalIndex; i < runtime.index.syllables.length; i += 1) {
    runtime.index.syllables[i].syllable.start = null;
    runtime.index.syllables[i].syllable.end = null;
  }
  afterTimingMutation();
}

function nudgeSelectedStart(delta) {
  const entry = getSelectionEntry();
  if (!entry || !isFiniteNumber(entry.syllable.start)) {
    return;
  }
  entry.syllable.start = roundTime(clampSyllableStart(entry.globalIndex, entry.syllable.start + delta));
  if (isFiniteNumber(entry.syllable.end) && entry.syllable.end <= entry.syllable.start + EPSILON) {
    entry.syllable.end = null;
  }
  afterTimingMutation({ ensureViewTime: entry.syllable.start });
}

function setSelectedPitch(value) {
  const entry = getSelectionEntry();
  if (!entry) {
    return;
  }
  if (!isFiniteNumber(value)) {
    entry.syllable.pitch = null;
  } else {
    const clampedPitch = clamp(Math.round(value), 24, 108);
    entry.syllable.pitch = clampedPitch;
    runtime.selectedPitchGhost = clampedPitch;
  }
  updateSelectedEditor();
  markDirty();
  scheduleAutosave();
}

function adjustSelectedPitch(delta) {
  const entry = getSelectionEntry();
  if (!entry) {
    return;
  }
  const base = isFiniteNumber(entry.syllable.pitch) ? entry.syllable.pitch : getGhostPitchForSelected();
  setSelectedPitch(base + delta);
}

function clearSelectedPitch() {
  setSelectedPitch(null);
}

function applySelectedValuesFromInputs() {
  const entry = getSelectionEntry();
  if (!entry) {
    return;
  }
  const rawStart = els.selectedStartInput.value.trim();
  const rawEnd = els.selectedEndInput.value.trim();
  const rawPitch = els.selectedPitchInput.value.trim();

  if (!rawStart) {
    entry.syllable.start = null;
    entry.syllable.end = null;
  } else {
    const start = Number(rawStart);
    if (isFiniteNumber(start)) {
      entry.syllable.start = roundTime(clampSyllableStart(entry.globalIndex, start));
      if (!rawEnd) {
        entry.syllable.end = null;
      } else {
        const end = Number(rawEnd);
        entry.syllable.end = isFiniteNumber(end) ? roundTime(clampSyllableEnd(entry.globalIndex, end)) : null;
      }
    }
  }

  if (!rawPitch) {
    entry.syllable.pitch = null;
  } else {
    const pitch = Number(rawPitch);
    if (isFiniteNumber(pitch)) {
      entry.syllable.pitch = clamp(Math.round(pitch), 24, 108);
      runtime.selectedPitchGhost = entry.syllable.pitch;
    }
  }

  afterTimingMutation({ ensureViewTime: entry.syllable.start });
}

function afterTimingMutation({ ensureViewTime = null, skipSelectionUpdate = false } = {}) {
  updateSelectedEditor();
  updateSyncStatus();
  resetAudioOverlayState();
  if (isFiniteNumber(ensureViewTime)) {
    ensureTimeInView(ensureViewTime);
  }
  if (!skipSelectionUpdate) {
    updateLyricsDynamic();
  }
  markDirty();
  scheduleAutosave();
}

function tapFromSelected() {
  const entry = getSelectionEntry();
  if (!entry) {
    return;
  }
  setSelectedStartTime(getCurrentTime());
  if (entry.globalIndex < runtime.index.syllables.length - 1) {
    selectSyllableByIndex(entry.globalIndex + 1, { scroll: true });
  }
}

async function seekToTime(time, { play = null } = {}) {
  const clampedTime = clamp(time, 0, Math.max(getProjectMaxTime(), getAudioDuration()));
  try {
    els.audioPlayer.currentTime = clampedTime;
  } catch (error) {
    console.warn(error);
  }
  resetAudioOverlayState();
  updateTransportUi();
  updateLyricsDynamic();
  markDirty();
  if (play === true) {
    await ensureAudioContext(true);
    try {
      await els.audioPlayer.play();
    } catch (error) {
      console.warn(error);
    }
  } else if (play === false) {
    els.audioPlayer.pause();
  }
}

async function jumpToTarget(target = getPracticeTarget()) {
  const range = getRangeForTarget(target);
  if (!range) {
    return;
  }
  const jumpTime = Math.max(0, range.start - state.settings.preRoll);
  ensureTimeInView(range.start);
  await seekToTime(jumpTime, { play: state.settings.autoPlayOnJump });
}

function applyLooping() {
  if (!state.settings.loopSelection || els.audioPlayer.paused) {
    return;
  }
  const range = getRangeForTarget();
  if (!range) {
    return;
  }
  const loopStart = Math.max(0, range.start - state.settings.preRoll);
  const loopEnd = Math.min(getProjectMaxTime(), range.end + state.settings.postRoll);
  if (getCurrentTime() >= loopEnd) {
    seekToTime(loopStart, { play: true }).catch((error) => console.warn(error));
  }
}

function resetAudioOverlayState() {
  runtime.audioOverlay.metronomeCursorAudioTime = getCurrentTime();
  stopGuideVoice();
}

function scheduleMetronomeClicks() {
  if (!state.settings.metronome.enabled || els.audioPlayer.paused || !runtime.audioContext || runtime.audioContext.state !== 'running') {
    runtime.audioOverlay.metronomeCursorAudioTime = getCurrentTime();
    return;
  }
  const ctx = runtime.audioContext;
  const bpm = clamp(state.settings.metronome.bpm, 20, 300);
  const interval = 60 / bpm;
  const offset = Number(state.settings.metronome.offset) || 0;
  const beatsPerBar = clamp(state.settings.metronome.beatsPerBar, 1, 12);
  const lookahead = 0.18;
  const audioNow = getCurrentTime();
  const rate = Math.max(0.1, state.settings.playbackRate);
  let cursor = isFiniteNumber(runtime.audioOverlay.metronomeCursorAudioTime)
    ? Math.max(runtime.audioOverlay.metronomeCursorAudioTime, audioNow)
    : audioNow;
  const targetAudioTime = audioNow + lookahead;
  let beatIndex = Math.ceil((cursor - offset) / interval);
  if (cursor <= offset) {
    beatIndex = 0;
  }
  let beatTime = offset + beatIndex * interval;
  while (beatTime <= targetAudioTime + 0.0001) {
    const when = ctx.currentTime + Math.max(0, (beatTime - audioNow) / rate);
    const accent = ((beatIndex % beatsPerBar) + beatsPerBar) % beatsPerBar === 0;
    scheduleClick(when, accent);
    beatIndex += 1;
    beatTime = offset + beatIndex * interval;
  }
  runtime.audioOverlay.metronomeCursorAudioTime = targetAudioTime;
}

function scheduleClick(when, accent) {
  if (!runtime.audioContext || !runtime.metronomeGain) {
    return;
  }
  const oscillator = runtime.audioContext.createOscillator();
  const gain = runtime.audioContext.createGain();
  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(accent ? 1760 : 1320, when);
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime((accent ? 0.9 : 0.55) * state.settings.metronome.volume, when + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.07);
  oscillator.connect(gain);
  gain.connect(runtime.metronomeGain);
  oscillator.start(when);
  oscillator.stop(when + 0.08);
}

function stopGuideVoice() {
  const voice = runtime.guideVoice;
  if (!voice) {
    return;
  }
  try {
    voice.gain.gain.cancelScheduledValues(runtime.audioContext.currentTime);
    voice.gain.gain.setTargetAtTime(0.0001, runtime.audioContext.currentTime, 0.02);
    voice.osc1.stop(runtime.audioContext.currentTime + 0.06);
    voice.osc2.stop(runtime.audioContext.currentTime + 0.06);
  } catch (error) {
    console.warn(error);
  }
  runtime.guideVoice = null;
}

function getSoundingPitchEntryAtTime(time) {
  for (const entry of runtime.index.syllables) {
    const start = entry.syllable.start;
    const end = getEffectiveSyllableEnd(entry.globalIndex);
    if (!isFiniteNumber(start) || !isFiniteNumber(end) || !isFiniteNumber(entry.syllable.pitch)) {
      continue;
    }
    if (time >= start && time < end) {
      return entry;
    }
  }
  return null;
}

function startGuideVoice(entry) {
  if (!runtime.audioContext || !runtime.guideGain) {
    return;
  }
  const frequency = midiToFrequency(entry.syllable.pitch);
  const ctx = runtime.audioContext;
  const gain = ctx.createGain();
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  osc1.type = 'triangle';
  osc2.type = 'sine';
  osc1.frequency.setValueAtTime(frequency, ctx.currentTime);
  osc2.frequency.setValueAtTime(frequency * 2, ctx.currentTime);
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(clamp(state.settings.guideSynth.volume, 0, 1) * 0.6, ctx.currentTime + 0.025);
  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(runtime.guideGain);
  osc1.start();
  osc2.start();
  runtime.guideVoice = {
    syllableId: entry.id,
    gain,
    osc1,
    osc2,
  };
}

function updateGuideVoice() {
  if (!state.settings.guideSynth.enabled || els.audioPlayer.paused || !runtime.audioContext || runtime.audioContext.state !== 'running') {
    stopGuideVoice();
    return;
  }
  const entry = getSoundingPitchEntryAtTime(getCurrentTime());
  if (!entry) {
    stopGuideVoice();
    return;
  }
  if (runtime.guideVoice?.syllableId === entry.id) {
    return;
  }
  stopGuideVoice();
  startGuideVoice(entry);
}

function exportJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function exportProject() {
  const payload = serializeProject();
  if (els.embedAudioInExport.checked && audioBlob) {
    payload.audio = {
      dataUrl: await blobToDataUrl(audioBlob),
      name: state.audioMeta.name,
      type: state.audioMeta.type,
    };
  }
  const filename = `${sanitizeFilename(state.projectName || state.audioMeta.name || 'karaoke-project')}.json`;
  exportJson(filename, payload);
  updateSaveStatus(`Exported ${filename}.`);
}

async function importProjectFile(file) {
  if (!file) {
    return;
  }
  const text = await file.text();
  const parsed = JSON.parse(text);
  let importedBlob = null;
  if (parsed.audio?.dataUrl) {
    importedBlob = await dataUrlToBlob(parsed.audio.dataUrl);
    if (parsed.audio.name) {
      importedBlob = new File([importedBlob], parsed.audio.name, { type: parsed.audio.type || importedBlob.type || 'audio/*' });
    }
  }
  await hydrateProject(parsed, importedBlob, { fromAutosave: false });
  updateSaveStatus(`Imported ${file.name}.`);
}

async function hydrateProject(serialized, providedAudioBlob = null, { fromAutosave = false } = {}) {
  runtime.loadingProject = true;
  try {
    const incomingProject = mergeStateDefaults(serialized.project || serialized);
    uidCounter = 0;
    state = incomingProject;
    state.structure = normalizeStructure(state.structure);
    rebuildIndex();
    renderLyrics();
    syncInputsFromState();
    fitViewToSong();
    if (providedAudioBlob) {
      await loadAudioBlob(providedAudioBlob, { preservePlaybackPosition: fromAutosave });
    } else {
      audioBlob = null;
      revokeCurrentObjectUrl();
      els.audioPlayer.pause();
      els.audioPlayer.removeAttribute('src');
      els.audioPlayer.load();
      els.audioPlayer.playbackRate = state.settings.playbackRate;
      els.audioPlayer.volume = state.settings.musicVolume;
      refreshAudioMeta();
      resetAudioOverlayState();
    }
    updateSelectedEditor();
    updateLyricsDynamic();
    markDirty();
  } finally {
    runtime.loadingProject = false;
  }
}

async function resetProject() {
  state = defaultState();
  audioBlob = null;
  revokeCurrentObjectUrl();
  els.audioPlayer.pause();
  els.audioPlayer.removeAttribute('src');
  els.audioPlayer.load();
  resetAudioOverlayState();
  rebuildIndex();
  renderLyrics();
  syncInputsFromState();
  fitViewToSong();
  markDirty();
  await clearAutosave();
  updateSaveStatus('Project reset.');
}

function getTimingTrackHit(point) {
  return findHitbox(runtime.timelineHitboxes, point.x, point.y);
}

function getPitchHit(point) {
  return findHitbox(runtime.pitchHitboxes, point.x, point.y);
}

function onLyricsStageClick(event) {
  setFocusRegion('timing');
  const syllableNode = event.target.closest('.syllable');
  if (syllableNode) {
    const syllableId = syllableNode.dataset.syllableId;
    setSelectionSyllableById(syllableId, { practiceKind: 'syllable', practiceId: syllableId, scroll: false });
    jumpToTarget({ kind: 'syllable', id: syllableId }).catch((error) => console.warn(error));
    return;
  }
  const wordNode = event.target.closest('.lyric-word');
  if (wordNode) {
    const wordId = wordNode.dataset.wordId;
    const firstSyllableId = runtime.index.wordById.get(wordId)?.firstSyllableId;
    if (firstSyllableId) {
      setSelectionSyllableById(firstSyllableId, { practiceKind: 'word', practiceId: wordId, scroll: false });
      jumpToTarget({ kind: 'word', id: wordId }).catch((error) => console.warn(error));
    }
    return;
  }
  const lineButton = event.target.closest('.line-jump');
  if (lineButton) {
    const lineId = lineButton.dataset.lineId;
    const firstSyllableId = runtime.index.lineById.get(lineId)?.firstSyllableId;
    if (firstSyllableId) {
      setSelectionSyllableById(firstSyllableId, { practiceKind: 'line', practiceId: lineId, scroll: false });
      jumpToTarget({ kind: 'line', id: lineId }).catch((error) => console.warn(error));
    }
  }
}

function beginTimelineInteraction(event) {
  setFocusRegion('timing');
  const point = getCanvasPoint(event, els.timelineCanvas);
  const hit = getTimingTrackHit(point);
  const selectedEntry = getSelectionEntry();
  els.timelineCanvas.setPointerCapture(event.pointerId);
  if (hit && hit.syllableId) {
    setSelectionSyllableById(hit.syllableId, { practiceKind: 'syllable', practiceId: hit.syllableId, scroll: false, ensureView: false });
    const entry = runtime.index.syllableById.get(hit.syllableId);
    if (hit.type === 'start-handle') {
      runtime.drag = { surface: 'timeline', type: 'start', syllableId: hit.syllableId };
      return;
    }
    if (hit.type === 'end-handle') {
      runtime.drag = { surface: 'timeline', type: 'end', syllableId: hit.syllableId };
      return;
    }
    if (selectedEntry?.id === entry.id) {
      runtime.drag = {
        surface: 'timeline',
        type: 'move-block',
        syllableId: hit.syllableId,
        originTime: xToTime(point.x, point.width),
        startAtDragStart: entry.syllable.start,
        endAtDragStart: entry.syllable.end,
      };
      return;
    }
  }
  runtime.drag = { surface: 'timeline', type: 'scrub' };
  seekToTime(xToTime(point.x, point.width), { play: false }).catch((error) => console.warn(error));
}

function moveTimelineInteraction(event) {
  if (!runtime.drag || runtime.drag.surface !== 'timeline') {
    return;
  }
  const point = getCanvasPoint(event, els.timelineCanvas);
  const time = xToTime(point.x, point.width);
  if (runtime.drag.type === 'scrub') {
    seekToTime(time, { play: false }).catch((error) => console.warn(error));
    return;
  }
  if (runtime.drag.type === 'start') {
    setSyllableStartById(runtime.drag.syllableId, time);
    return;
  }
  if (runtime.drag.type === 'end') {
    setSyllableEndById(runtime.drag.syllableId, time);
    return;
  }
  if (runtime.drag.type === 'move-block') {
    const entry = runtime.index.syllableById.get(runtime.drag.syllableId);
    if (!entry || !isFiniteNumber(runtime.drag.startAtDragStart)) {
      return;
    }
    const delta = time - runtime.drag.originTime;
    entry.syllable.start = roundTime(clampSyllableStart(entry.globalIndex, runtime.drag.startAtDragStart + delta));
    if (isFiniteNumber(runtime.drag.endAtDragStart)) {
      entry.syllable.end = roundTime(clampSyllableEnd(entry.globalIndex, runtime.drag.endAtDragStart + delta));
    }
    afterTimingMutation({ ensureViewTime: entry.syllable.start, skipSelectionUpdate: true });
  }
}

function endTimelineInteraction() {
  if (runtime.drag?.surface === 'timeline') {
    runtime.drag = null;
    scheduleAutosave();
  }
}

function beginOverviewInteraction(event) {
  setFocusRegion('timing');
  const point = getCanvasPoint(event, els.overviewCanvas);
  const viewport = runtime.overviewViewportHitbox;
  els.overviewCanvas.setPointerCapture(event.pointerId);
  if (viewport && point.x >= viewport.x && point.x <= viewport.x + viewport.w) {
    runtime.drag = {
      surface: 'overview',
      type: 'pan',
      startX: point.x,
      startViewStart: runtime.view.start,
    };
    return;
  }
  const fullDuration = getProjectMaxTime();
  const time = (point.x / point.width) * fullDuration;
  runtime.view.start = time - runtime.view.duration / 2;
  clampView();
  runtime.drag = {
    surface: 'overview',
    type: 'pan',
    startX: point.x,
    startViewStart: runtime.view.start,
  };
  markDirty();
}

function moveOverviewInteraction(event) {
  if (!runtime.drag || runtime.drag.surface !== 'overview') {
    return;
  }
  const point = getCanvasPoint(event, els.overviewCanvas);
  const fullDuration = getProjectMaxTime();
  const deltaRatio = (point.x - runtime.drag.startX) / Math.max(1, point.width);
  runtime.view.start = runtime.drag.startViewStart + deltaRatio * fullDuration;
  clampView();
  markDirty();
}

function endOverviewInteraction() {
  if (runtime.drag?.surface === 'overview') {
    runtime.drag = null;
  }
}

function beginPitchInteraction(event) {
  setFocusRegion('pitch');
  const point = getCanvasPoint(event, els.pitchCanvas);
  const hit = getPitchHit(point);
  els.pitchCanvas.setPointerCapture(event.pointerId);
  if (hit && hit.syllableId) {
    setSelectionSyllableById(hit.syllableId, { practiceKind: 'syllable', practiceId: hit.syllableId, scroll: false, ensureView: false });
    runtime.drag = { surface: 'pitch', type: 'pitch', syllableId: hit.syllableId };
    movePitchInteraction(event);
    return;
  }
  runtime.drag = { surface: 'pitch', type: 'scrub' };
  seekToTime(xToTime(point.x, point.width, PITCH_GUTTER), { play: false }).catch((error) => console.warn(error));
}

function movePitchInteraction(event) {
  if (!runtime.drag || runtime.drag.surface !== 'pitch') {
    return;
  }
  const point = getCanvasPoint(event, els.pitchCanvas);
  if (runtime.drag.type === 'scrub') {
    seekToTime(xToTime(point.x, point.width, PITCH_GUTTER), { play: false }).catch((error) => console.warn(error));
    return;
  }
  const minPitch = Math.min(state.settings.pitchRange.min, state.settings.pitchRange.max);
  const maxPitch = Math.max(state.settings.pitchRange.min, state.settings.pitchRange.max);
  const pitch = yToPitch(point.y, minPitch, maxPitch, point.height);
  setSelectedPitch(pitch);
}

function endPitchInteraction() {
  if (runtime.drag?.surface === 'pitch') {
    runtime.drag = null;
    scheduleAutosave();
  }
}

function onViewWheel(event) {
  event.preventDefault();
  const canvas = event.currentTarget;
  const point = getCanvasPoint(event, canvas);
  const gutter = canvas === els.pitchCanvas ? PITCH_GUTTER : 0;
  const anchorTime = xToTime(point.x, point.width, gutter);
  const factor = event.deltaY < 0 ? 0.8 : 1.25;
  zoomView(factor, anchorTime);
}

async function togglePlayPause() {
  await ensureAudioContext(true);
  if (els.audioPlayer.paused) {
    try {
      await els.audioPlayer.play();
    } catch (error) {
      console.warn(error);
    }
  } else {
    els.audioPlayer.pause();
  }
  resetAudioOverlayState();
  updateTransportUi();
}

function handleKeydown(event) {
  const tag = event.target.tagName;
  const editable = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || event.target.isContentEditable;
  if (editable) {
    return;
  }
  if (event.code === 'Space') {
    event.preventDefault();
    togglePlayPause().catch((error) => console.warn(error));
    return;
  }
  const HOTKEY_TAP = new Set(['enter', 'k', 'z', 'x']);
  const key = event.key.toLowerCase();
  if (HOTKEY_TAP.has(key)) {
    event.preventDefault();
    tapFromSelected();
    return;
  }
  if (event.key.toLowerCase() === 's') {
    event.preventDefault();
    setSelectedStartTime(getCurrentTime());
    return;
  }
  if (event.key.toLowerCase() === 'e') {
    event.preventDefault();
    setSelectedEndTime(getCurrentTime());
    return;
  }
  if (event.key === '[' || event.key === 'ArrowLeft') {
    event.preventDefault();
    const current = getSelectionEntry();
    selectSyllableByIndex((current?.globalIndex || 0) - 1, { scroll: true });
    return;
  }
  if (event.key === ']' || event.key === 'ArrowRight') {
    event.preventDefault();
    const current = getSelectionEntry();
    selectSyllableByIndex((current?.globalIndex || 0) + 1, { scroll: true });
    return;
  }
  if (event.key.toLowerCase() === 'j') {
    event.preventDefault();
    seekToTime(getCurrentTime() - state.settings.seekStep, { play: false }).catch((error) => console.warn(error));
    return;
  }
  if (event.key.toLowerCase() === 'l') {
    event.preventDefault();
    seekToTime(getCurrentTime() + state.settings.seekStep, { play: false }).catch((error) => console.warn(error));
    return;
  }
  if (event.key === ',') {
    event.preventDefault();
    nudgeSelectedStart(-state.settings.nudgeStep);
    return;
  }
  if (event.key === '.') {
    event.preventDefault();
    nudgeSelectedStart(state.settings.nudgeStep);
    return;
  }
  if (event.key === 'Delete') {
    event.preventDefault();
    clearSelectedTiming({ movePrev: false });
    return;
  }
  if (event.key === 'Backspace') {
    event.preventDefault();
    if (runtime.focusRegion === 'pitch') {
      clearSelectedPitch();
      return;
    }
    if (event.shiftKey) {
      clearTimingsFromSelectedForward();
      return;
    }
    clearSelectedTiming({ movePrev: true });
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    adjustSelectedPitch(event.shiftKey ? 12 : 1);
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    adjustSelectedPitch(event.shiftKey ? -12 : -1);
  }
}

function attachEventListeners() {
  els.projectName.addEventListener('input', () => {
    state.projectName = els.projectName.value;
    scheduleAutosave();
  });

  els.audioFileInput.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) {
      loadAudioBlob(file).catch((error) => console.warn(error));
    }
    event.target.value = '';
  });

  els.importProjectInput.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    importProjectFile(file).catch((error) => console.warn(error));
    event.target.value = '';
  });

  els.exportProjectBtn.addEventListener('click', () => {
    exportProject().catch((error) => console.warn(error));
  });

  els.clearProjectBtn.addEventListener('click', () => {
    if (window.confirm('Reset the current project and clear the local autosave?')) {
      resetProject().catch((error) => console.warn(error));
    }
  });

  els.audioPlayer.addEventListener('loadedmetadata', () => {
    if (isFiniteNumber(els.audioPlayer.duration)) {
      state.audioMeta.duration = els.audioPlayer.duration;
      refreshAudioMeta();
      updateTransportUi();
      fitViewToSong();
      scheduleAutosave();
    }
  });

  els.audioPlayer.addEventListener('ended', () => {
    stopGuideVoice();
    updateTransportUi();
  });

  els.audioPlayer.addEventListener('play', () => {
    ensureAudioContext(true).catch((error) => console.warn(error));
    resetAudioOverlayState();
  });

  els.audioPlayer.addEventListener('pause', () => {
    resetAudioOverlayState();
    stopGuideVoice();
  });

  els.playPauseBtn.addEventListener('click', () => togglePlayPause().catch((error) => console.warn(error)));
  els.rewindBtn.addEventListener('click', () => seekToTime(getCurrentTime() - state.settings.seekStep, { play: false }).catch((error) => console.warn(error)));
  els.forwardBtn.addEventListener('click', () => seekToTime(getCurrentTime() + state.settings.seekStep, { play: false }).catch((error) => console.warn(error)));
  els.jumpToSelectionBtn.addEventListener('click', () => jumpToTarget().catch((error) => console.warn(error)));
  els.jumpSelectedMiniBtn.addEventListener('click', () => jumpToTarget().catch((error) => console.warn(error)));
  els.loopSelectionBtn.addEventListener('click', () => {
    state.settings.loopSelection = !state.settings.loopSelection;
    updateLoopButton();
    markDirty();
    scheduleAutosave();
  });

  els.prevSyllableBtn.addEventListener('click', () => {
    const current = getSelectionEntry();
    selectSyllableByIndex((current?.globalIndex || 0) - 1, { scroll: true });
  });
  els.nextSyllableBtn.addEventListener('click', () => {
    const current = getSelectionEntry();
    selectSyllableByIndex((current?.globalIndex || 0) + 1, { scroll: true });
  });
  els.setStartBtn.addEventListener('click', () => setSelectedStartTime(getCurrentTime()));
  els.setEndBtn.addEventListener('click', () => setSelectedEndTime(getCurrentTime()));
  els.tapFromSelectedBtn.addEventListener('click', tapFromSelected);
  els.clearSelectedTimeBtn.addEventListener('click', () => clearSelectedTiming({ movePrev: false }));
  els.clearFollowingTimesBtn.addEventListener('click', clearTimingsFromSelectedForward);
  els.clearSelectedPitchBtn.addEventListener('click', clearSelectedPitch);

  els.playbackRateInput.addEventListener('input', () => {
    state.settings.playbackRate = Number(els.playbackRateInput.value);
    els.playbackRateLabel.textContent = `${state.settings.playbackRate.toFixed(2)}x`;
    els.audioPlayer.playbackRate = state.settings.playbackRate;
    resetAudioOverlayState();
    scheduleAutosave();
  });

  els.preRollInput.addEventListener('input', () => {
    state.settings.preRoll = Number(els.preRollInput.value);
    els.preRollLabel.textContent = formatMs(state.settings.preRoll);
    markDirty();
    scheduleAutosave();
  });

  els.postRollInput.addEventListener('input', () => {
    state.settings.postRoll = Number(els.postRollInput.value);
    els.postRollLabel.textContent = formatMs(state.settings.postRoll);
    markDirty();
    scheduleAutosave();
  });

  els.seekStepInput.addEventListener('change', () => {
    state.settings.seekStep = clamp(Number(els.seekStepInput.value) || 2, 0.1, 30);
    els.seekStepInput.value = String(state.settings.seekStep);
    updateTransportUi();
    scheduleAutosave();
  });

  els.nudgeStepInput.addEventListener('change', () => {
    state.settings.nudgeStep = clamp((Number(els.nudgeStepInput.value) || 25) / 1000, 0.001, 0.5);
    els.nudgeStepInput.value = String(Math.round(state.settings.nudgeStep * 1000));
    scheduleAutosave();
  });

  els.musicVolumeInput.addEventListener('input', () => {
    state.settings.musicVolume = clamp(Number(els.musicVolumeInput.value), 0, 1);
    els.audioPlayer.volume = state.settings.musicVolume;
    els.musicVolumeLabel.textContent = formatPercent(state.settings.musicVolume);
    scheduleAutosave();
  });

  els.guideVolumeInput.addEventListener('input', () => {
    state.settings.guideSynth.volume = clamp(Number(els.guideVolumeInput.value), 0, 1);
    els.guideVolumeLabel.textContent = formatPercent(state.settings.guideSynth.volume);
    ensureAudioContext(false).catch((error) => console.warn(error));
    scheduleAutosave();
  });

  els.autoPlayOnJump.addEventListener('change', () => {
    state.settings.autoPlayOnJump = els.autoPlayOnJump.checked;
    scheduleAutosave();
  });

  els.autoScrollLyrics.addEventListener('change', () => {
    state.settings.autoScrollLyrics = els.autoScrollLyrics.checked;
    scheduleAutosave();
  });

  els.scrubInput.addEventListener('input', () => {
    seekToTime(Number(els.scrubInput.value), { play: false }).catch((error) => console.warn(error));
  });

  els.buildLyricsBtn.addEventListener('click', buildLyricsStructure);
  els.sampleLyricsBtn.addEventListener('click', () => {
    els.lyricsInput.value = DEMO_LYRICS;
    buildLyricsStructure();
  });

  const preprocessingListener = () => {
    state.settings.preprocessing.splitMode = els.splitModeSelect.value;
    state.settings.preprocessing.excludeDoubleNewlines = els.excludeDoubleNewlines.checked;
    state.settings.preprocessing.excludeSectionLabels = els.excludeSectionLabels.checked;
    scheduleAutosave();
  };
  els.splitModeSelect.addEventListener('change', preprocessingListener);
  els.excludeDoubleNewlines.addEventListener('change', preprocessingListener);
  els.excludeSectionLabels.addEventListener('change', preprocessingListener);

  els.copyPlayheadStartBtn.addEventListener('click', () => {
    els.selectedStartInput.value = getCurrentTime().toFixed(3);
  });
  els.copyPlayheadEndBtn.addEventListener('click', () => {
    els.selectedEndInput.value = getCurrentTime().toFixed(3);
  });
  els.applySelectedValuesBtn.addEventListener('click', applySelectedValuesFromInputs);
  els.clearSelectedEndBtn.addEventListener('click', clearSelectedEnd);
  els.selectedStartInput.addEventListener('change', applySelectedValuesFromInputs);
  els.selectedEndInput.addEventListener('change', applySelectedValuesFromInputs);
  els.selectedPitchInput.addEventListener('change', applySelectedValuesFromInputs);
  els.nudgeBackLargeBtn.addEventListener('click', () => nudgeSelectedStart(-state.settings.nudgeStep * 4));
  els.nudgeBackBtn.addEventListener('click', () => nudgeSelectedStart(-state.settings.nudgeStep));
  els.nudgeForwardBtn.addEventListener('click', () => nudgeSelectedStart(state.settings.nudgeStep));
  els.nudgeForwardLargeBtn.addEventListener('click', () => nudgeSelectedStart(state.settings.nudgeStep * 4));

  const metronomeListener = () => {
    state.settings.metronome.enabled = els.metronomeEnabled.checked;
    state.settings.metronome.bpm = clamp(Number(els.metronomeBpm.value), 20, 300);
    state.settings.metronome.offset = Number(els.metronomeOffset.value) || 0;
    state.settings.metronome.beatsPerBar = clamp(Number(els.metronomeBeatsPerBar.value), 1, 12);
    state.settings.metronome.volume = clamp(Number(els.metronomeVolume.value), 0, 1);
    els.metronomeVolumeLabel.textContent = formatPercent(state.settings.metronome.volume);
    ensureAudioContext(false).catch((error) => console.warn(error));
    resetAudioOverlayState();
    markDirty();
    scheduleAutosave();
  };
  els.metronomeEnabled.addEventListener('change', metronomeListener);
  els.metronomeBpm.addEventListener('change', metronomeListener);
  els.metronomeOffset.addEventListener('change', metronomeListener);
  els.metronomeBeatsPerBar.addEventListener('change', metronomeListener);
  els.metronomeVolume.addEventListener('input', metronomeListener);

  els.guideSynthEnabled.addEventListener('change', () => {
    state.settings.guideSynth.enabled = els.guideSynthEnabled.checked;
    ensureAudioContext(false).catch((error) => console.warn(error));
    resetAudioOverlayState();
    scheduleAutosave();
  });

  const pitchRangeListener = () => {
    const minValue = clamp(Number(els.pitchMinInput.value), 24, 108);
    const maxValue = clamp(Number(els.pitchMaxInput.value), 24, 108);
    state.settings.pitchRange.min = Math.min(minValue, maxValue);
    state.settings.pitchRange.max = Math.max(minValue, maxValue);
    els.pitchMinInput.value = String(state.settings.pitchRange.min);
    els.pitchMaxInput.value = String(state.settings.pitchRange.max);
    markDirty();
    scheduleAutosave();
  };
  els.pitchMinInput.addEventListener('change', pitchRangeListener);
  els.pitchMaxInput.addEventListener('change', pitchRangeListener);

  els.zoomInBtn.addEventListener('click', () => zoomView(0.8));
  els.zoomOutBtn.addEventListener('click', () => zoomView(1.25));
  els.fitSongBtn.addEventListener('click', fitViewToSong);
  els.fitSelectionBtn.addEventListener('click', () => fitViewToRange());

  els.lyricsStage.addEventListener('click', onLyricsStageClick);
  els.timelineCanvas.addEventListener('pointerdown', beginTimelineInteraction);
  els.overviewCanvas.addEventListener('pointerdown', beginOverviewInteraction);
  els.pitchCanvas.addEventListener('pointerdown', beginPitchInteraction);
  window.addEventListener('pointermove', (event) => {
    moveTimelineInteraction(event);
    moveOverviewInteraction(event);
    movePitchInteraction(event);
  });
  window.addEventListener('pointerup', () => {
    endTimelineInteraction();
    endOverviewInteraction();
    endPitchInteraction();
  });
  els.timelineCanvas.addEventListener('wheel', onViewWheel, { passive: false });
  els.pitchCanvas.addEventListener('wheel', onViewWheel, { passive: false });
  window.addEventListener('keydown', handleKeydown);

  runtime.resizeObserver = new ResizeObserver(() => {
    markDirty();
  });
  runtime.resizeObserver.observe(els.timelineCanvas);
  runtime.resizeObserver.observe(els.overviewCanvas);
  runtime.resizeObserver.observe(els.pitchCanvas);
}

function animate() {
  applyLooping();
  scheduleMetronomeClicks();
  updateGuideVoice();
  updateTransportUi();
  updateLyricsDynamic();
  if (runtime.drawDirty || !els.audioPlayer.paused || runtime.drag) {
    drawTimeline();
    drawOverview();
    drawPitchGuide();
    runtime.drawDirty = false;
  }
  requestAnimationFrame(animate);
}

async function init() {
  rebuildIndex();
  fitViewToSong();
  syncInputsFromState();
  renderLyrics();
  attachEventListeners();
  await loadAutosave();
  updateTransportUi();
  setFocusRegion('timing');
  markDirty();
  requestAnimationFrame(animate);
}

init().catch((error) => {
  console.error(error);
  updateSaveStatus('App failed to initialize.');
});
