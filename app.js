const APP_ID = 'syllable-karaoke-studio';
const APP_VERSION = 4;
const DB_NAME = 'syllable-karaoke-studio-db';
const DB_STORE = 'projects';
const AUTOSAVE_STATE_KEY = 'autosave-state';
const AUTOSAVE_AUDIO_KEY = 'autosave-audio';

const FULL_VIEW_MIN = 1;
const VIEW_MIN_DURATION = 0.3;
const DEFAULT_TAIL = 0.35;
const EPSILON = 0.01;
const TIMELINE_CONFIG = {
  syllableTrackHeight: 32,
  syllableBlockInsetY: 4,
};
const PITCH_GUTTER = 42;
const KANA_RE = /[\u3040-\u30ff]/;
const LATIN_RE = /^[A-Za-z]+$/;
const SECTION_LABEL_RE = /^\s*\[[^\]]+\]\s*$/;
const EDGE_PUNCT_RE = /^[\s"'“”‘’.,!?！？。、・･:;()\[\]{}「」『』【】〈〉《》]+|[\s"'“”‘’.,!?！？。、・･:;()\[\]{}「」『』【】〈〉《》]+$/g;
const SMALL_KANA_RE = /[ゃゅょャュョぁぃぅぇぉァィゥェォゎヮゕゖ]/;
// hardcode canvas fonts so JS doesn't try probe the full computed CSS fallback list on redraw.
// should fix all the font warnings on Firefox wth resistFingerprinting enabled
const CANVAS_FONT_FAMILY = '"Geist", sans-serif';

const DEFAULT_KEYBINDS = {
  tapTiming: ['enter', 'k', 'z', 'x'],
  playPause: ['space'],
  setStart: ['s'],
  setEnd: ['e'],
  seekBackward: ['j'],
  seekForward: ['l'],
  nudgeBack: [','],
  nudgeForward: ['.'],
  clearTiming: ['delete'],
  clearOrPitch: ['backspace'],
  selectSounding: ['a'],
  jump: ['g'],
  pitchUp: ['arrowup'],
  pitchDown: ['arrowdown'],
  selectBack: ['[', 'arrowleft'],
  selectForward: [']', 'arrowright'],
};

const DEFAULT_UI_STATE = {
  collapsedPanels: {},
  collapsedSections: {},
};

const ACTION_META = [
  { id: 'tapTiming', label: 'Tap → next', description: 'Set start at playhead and advance.' },
  { id: 'playPause', label: 'Play / Pause', description: 'Toggle playback.' },
  { id: 'setStart', label: 'Set start', description: 'Set the selected syllable start.' },
  { id: 'setEnd', label: 'Set end', description: 'Set the selected syllable end.' },
  { id: 'seekBackward', label: 'Seek backward', description: 'Move the playhead backward by the seek step.' },
  { id: 'seekForward', label: 'Seek forward', description: 'Move the playhead forward by the seek step.' },
  { id: 'nudgeBack', label: 'Nudge start backward', description: 'Move the selected start backward.' },
  { id: 'nudgeForward', label: 'Nudge start forward', description: 'Move the selected start forward.' },
  { id: 'clearTiming', label: 'Clear timing', description: 'Clear timing on the selected syllable.' },
  { id: 'clearOrPitch', label: 'Clear timing / pitch', description: 'Clear timing, or clear pitch in pitch mode.' },
  { id: 'selectSounding', label: 'Select sounding', description: 'Select the syllable sounding at the playhead.' },
  { id: 'jump', label: 'Jump', description: 'Jump to the current practice target.' },
  { id: 'pitchUp', label: 'Pitch up', description: 'Raise pitch by 1, or 12 with Shift.' },
  { id: 'pitchDown', label: 'Pitch down', description: 'Lower pitch by 1, or 12 with Shift.' },
  { id: 'selectBack', label: 'Select previous', description: 'Select the previous syllable.' },
  { id: 'selectForward', label: 'Select next', description: 'Select the next syllable.' },
];

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
    autoScrollWindow: false,
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
    followSounding: false,
    selectWithoutSeek: false,
    keybinds: createDefaultKeybinds(),
    ui: createDefaultUiState(),
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
  metronomeNode: null,
  metronomeWorkletReady: null,
  metronomeWorkletFailed: false,
  waveformWorker: null,
  waveformWorkerJobs: new Map(),
  waveformJobId: 0,
  transport: {
    buffer: null,
    sourceNode: null,
    musicGain: null,
    startContextTime: 0,
    startOffset: 0,
    pauseOffset: 0,
    playing: false,
    playToken: 0,
  },
  dom: {
    lines: new Map(),
    words: new Map(),
    syllables: new Map(),
    linesByIndex: [],
    wordsByIndex: [],
    syllablesByIndex: [],
  },
  index: {
    lines: [],
    words: [],
    syllables: [],
    lineById: new Map(),
    wordById: new Map(),
    syllableById: new Map(),
    timedEntries: [],
    timedStarts: [],
    timedEnds: [],
    prevTimedStartByIndex: [],
    nextTimedStartByIndex: [],
    effectiveEnds: [],
    snapPoints: [],
    snapPointTimes: [],
    syncedCount: 0,
    maxTime: FULL_VIEW_MIN,
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
  stickyTransportResizeObserver: null,
  loadingProject: false,
  drawDirty: true,
  selectedPitchGhost: 60,
  undoStack: [],
  snapThreshold: 8, // px distance for snapping
  artworkObjectUrl: '',
  lastFollowSoundingId: null, // tracks last syllable follow-sounding snapped to
  audioOverlay: {
    metronomeCursorAudioTime: null,
  },
  edgeScroll: {
    active: false,
    pointerX: 0,
    width: 0,
    gutter: 0,
    lastTs: 0,
  },
  lastAutoScrolledLineId: null,
  lyricsRender: {
    forceFull: true,
    lastCurrentTime: null,
    lastSelectedSyllableId: null,
    lastSelectedWordId: null,
    lastSelectedLineId: null,
    lastPracticeTargetKind: 'syllable',
    lastPracticeTargetId: null,
    lastSoundingSyllableId: null,
    lastActiveLineId: null,
    lastCompletedTimedIndex: -1,
  },
  renderCache: {
    timelineBase: { canvas: null, key: '' },
    overviewBase: { canvas: null, key: '' },
    pitchBase: { canvas: null, key: '' },
    timelineWaveformTiles: { key: '', entries: new Map() },
    timelineWaveformLevels: { key: '', levels: null },
    waveformVersion: 0,
  },
  lastDrawnTime: null,
  keyActionLookup: new Map(),
  keybindConflicts: new Map(),
  lastSetEndGesture: null,
};

const els = {
  transport: document.querySelector('.transport'),
  projectName: document.getElementById('projectName'),
  audioFileInput: document.getElementById('audioFileInput'),
  importProjectBtn: document.getElementById('importProjectBtn'),
  importProjectInput: document.getElementById('importProjectInput'),
  importProjectMenuBtn: document.getElementById('importProjectMenuBtn'),
  importProjectMenu: document.getElementById('importProjectMenu'),
  importDemoProjectBtn: document.getElementById('importDemoProjectBtn'),
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
  autoScrollWindow: document.getElementById('autoScrollWindow'),
  selectedSummary: document.getElementById('selectedSummary'),
  currentTimeLabel: document.getElementById('currentTimeLabel'),
  scrubInput: document.getElementById('scrubInput'),
  remainingTimeLabel: document.getElementById('remainingTimeLabel'),

  buildLyricsBtn: document.getElementById('buildLyricsBtn'),
  lyricsInput: document.getElementById('lyricsInput'),
  splitModeSelect: document.getElementById('splitModeSelect'),
  excludeDoubleNewlines: document.getElementById('excludeDoubleNewlines'),
  excludeSectionLabels: document.getElementById('excludeSectionLabels'),

  selectedSummaryDetail: document.getElementById('selectedSummaryDetail'),
  selectedStartInput: document.getElementById('selectedStartInput'),
  selectedEndInput: document.getElementById('selectedEndInput'),
  selectedPitchInput: document.getElementById('selectedPitchInput'),
  selectedPitchLabel: document.getElementById('selectedPitchLabel'),
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
  undoBtn: document.getElementById('undoBtn'),
  followSoundingCheckbox: document.getElementById('followSoundingCheckbox'),
  selectWithoutSeekCheckbox: document.getElementById('selectWithoutSeekCheckbox'),
  keybindEditor: document.getElementById('keybindEditor'),
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


function createDefaultKeybinds() {
  return Object.fromEntries(Object.entries(DEFAULT_KEYBINDS).map(([actionId, tokens]) => [actionId, [...tokens]]));
}

function createDefaultUiState() {
  return deepClone(DEFAULT_UI_STATE);
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));
}

function normalizeKeyToken(token) {
  if (token === null || token === undefined) {
    return '';
  }
  const raw = String(token).toLowerCase();
  if (raw === ' ') {
    return 'space';
  }
  let value = raw.trim();
  if (!value) {
    return '';
  }
  const aliases = {
    spacebar: 'space',
    space: 'space',
    return: 'enter',
    del: 'delete',
    esc: 'escape',
    left: 'arrowleft',
    right: 'arrowright',
    up: 'arrowup',
    down: 'arrowdown',
    comma: ',',
    period: '.',
    dot: '.',
    fullstop: '.',
    bracketleft: '[',
    bracketright: ']',
  };
  value = aliases[value] || value;
  if (/^[a-z0-9]$/.test(value)) {
    return value;
  }
  if (['space', 'enter', 'delete', 'backspace', 'escape', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', '[', ']', ',', '.'].includes(value)) {
    return value;
  }
  return '';
}

function formatKeyToken(token) {
  const normalized = normalizeKeyToken(token);
  if (!normalized) {
    return '';
  }
  const labels = {
    space: 'Space',
    enter: 'Enter',
    delete: 'Delete',
    backspace: 'Backspace',
    escape: 'Esc',
    arrowleft: 'ArrowLeft',
    arrowright: 'ArrowRight',
    arrowup: 'ArrowUp',
    arrowdown: 'ArrowDown',
  };
  if (labels[normalized]) {
    return labels[normalized];
  }
  return normalized.length === 1 ? normalized.toUpperCase() : normalized;
}

function serializeKeyTokenForInput(token) {
  const normalized = normalizeKeyToken(token);
  if (normalized === ',') {
    return 'comma';
  }
  if (normalized === '.') {
    return 'period';
  }
  return normalized;
}

function parseKeybindInputValue(value) {
  return [...new Set(String(value || '')
    .split(',')
    .map((token) => normalizeKeyToken(token))
    .filter(Boolean))];
}

function sanitizeKeybinds(keybinds) {
  const defaults = createDefaultKeybinds();
  const safe = {};
  ACTION_META.forEach(({ id }) => {
    if (Array.isArray(keybinds?.[id])) {
      safe[id] = [...new Set(keybinds[id].map((token) => normalizeKeyToken(token)).filter(Boolean))];
    } else {
      safe[id] = [...defaults[id]];
    }
  });
  return safe;
}

function sanitizeUiSettings(ui) {
  return {
    ...createDefaultUiState(),
    ...(ui || {}),
    collapsedPanels: { ...(ui?.collapsedPanels || {}) },
    collapsedSections: { ...(ui?.collapsedSections || {}) },
  };
}

function rebuildKeybindLookup() {
  state.settings.keybinds = sanitizeKeybinds(state.settings.keybinds);
  const lookup = new Map();
  const conflicts = new Map();
  ACTION_META.forEach(({ id }) => {
    (state.settings.keybinds[id] || []).forEach((token) => {
      if (!lookup.has(token)) {
        lookup.set(token, id);
        return;
      }
      const owners = conflicts.get(token) || [lookup.get(token)];
      if (!owners.includes(id)) {
        owners.push(id);
      }
      conflicts.set(token, owners);
    });
  });
  runtime.keyActionLookup = lookup;
  runtime.keybindConflicts = conflicts;
}

function getActionMeta(actionId) {
  return ACTION_META.find((meta) => meta.id === actionId) || null;
}

function getActionConflictWarnings(actionId) {
  const warnings = [];
  const tokens = state.settings.keybinds?.[actionId] || [];
  tokens.forEach((token) => {
    const owners = runtime.keybindConflicts.get(token) || [];
    if (!owners.includes(actionId)) {
      return;
    }
    const otherLabels = owners
      .filter((ownerId) => ownerId !== actionId)
      .map((ownerId) => getActionMeta(ownerId)?.label || ownerId);
    if (otherLabels.length) {
      warnings.push(`${formatKeyToken(token)} is also bound to ${otherLabels.join(', ')}.`);
    }
  });
  return warnings;
}

function renderKeybindEditor() {
  if (!els.keybindEditor) {
    return;
  }
  rebuildKeybindLookup();
  const fields = ACTION_META.map((meta) => {
    const tokens = state.settings.keybinds?.[meta.id] || [];
    const warnings = getActionConflictWarnings(meta.id);
    const warningTitle = warnings.length ? ` title="${escapeHtml(warnings.join('\n'))}"` : '';
    const warningGlyph = warnings.length ? `<span class="keybind-warning-glyph" aria-label="Conflicting keybind"${warningTitle}>⚠</span>` : '';
    const inputTitle = `${meta.description} Use commas for multiple keys.`;
    return `
      <label class="field-stacked keybind-field" title="${escapeHtml(meta.description)}">
        <span class="field-label field-label--with-warning">
          <span>${escapeHtml(meta.label)}</span>
          ${warningGlyph}
        </span>
        <input type="text" data-keybind-action="${meta.id}" value="${escapeHtml(tokens.map((token) => serializeKeyTokenForInput(token)).join(', '))}" placeholder="keys" title="${escapeHtml(inputTitle)}" />
      </label>`;
  }).join('');
  els.keybindEditor.innerHTML = fields;
  els.keybindEditor.querySelectorAll('[data-keybind-action]').forEach((input) => {
    input.addEventListener('change', onKeybindInputChange);
    input.addEventListener('blur', onKeybindInputChange);
  });
}

function onKeybindInputChange(event) {
  const actionId = event.target.dataset.keybindAction;
  if (!actionId || !state.settings.keybinds) {
    return;
  }
  state.settings.keybinds[actionId] = parseKeybindInputValue(event.target.value);
  renderKeybindEditor();
  scheduleAutosave();
}

function applyUiState() {
  state.settings.ui = sanitizeUiSettings(state.settings.ui);
  document.querySelectorAll('details.panel[data-panel-id]').forEach((panel) => {
    const panelId = panel.dataset.panelId;
    panel.open = !state.settings.ui.collapsedPanels?.[panelId];
  });
  document.querySelectorAll('.main-section[data-section-id]').forEach((section) => {
    const sectionId = section.dataset.sectionId;
    section.classList.toggle('is-open', !state.settings.ui.collapsedSections?.[sectionId]);
  });
  window.dispatchEvent(new Event('resize'));
}

function updateStickyTransportOffset() {
  if (!els.transport) {
    return;
  }

  // The transport wraps on narrow screens, so CSS needs the measured height
  // rather than the desktop token when positioning sticky section headers.
  const height = Math.ceil(els.transport.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--sticky-transport-h', `${height}px`);
}

function setupStickyTransportOffset() {
  updateStickyTransportOffset();

  if (window.ResizeObserver && els.transport) {
    runtime.stickyTransportResizeObserver = new ResizeObserver(updateStickyTransportOffset);
    runtime.stickyTransportResizeObserver.observe(els.transport);
  }

  window.addEventListener('resize', updateStickyTransportOffset);
  window.addEventListener('orientationchange', updateStickyTransportOffset);
}

function confirmDestructiveAction(message) {
  return window.confirm(message);
}

function runJumpAction() {
  return jumpToTarget().catch((error) => console.warn(error));
}

function updateLastSetEndGesture(entry, time) {
  runtime.lastSetEndGesture = {
    syllableId: entry.id,
    time,
    at: performance.now(),
  };
}

function getNextStartedEntry(globalIndex) {
  for (let i = globalIndex + 1; i < runtime.index.syllables.length; i += 1) {
    const next = runtime.index.syllables[i];
    if (isFiniteNumber(next?.syllable?.start)) {
      return next;
    }
  }
  return null;
}

function shouldAutoClearEndOnRepeat(entry, nextEntry, requestedEnd) {
  const last = runtime.lastSetEndGesture;
  if (!last || !nextEntry || !isFiniteNumber(nextEntry.syllable.start)) {
    return false;
  }
  const quickRepeat = performance.now() - last.at <= 800;
  const sameSyllable = last.syllableId === entry.id;
  const sameTime = Math.abs(last.time - requestedEnd) <= 0.075;
  const collides = requestedEnd >= nextEntry.syllable.start - EPSILON;
  return quickRepeat && sameSyllable && sameTime && collides;
}

const MAX_UNDO = 60;

function pushUndoSnapshot() {
  // Store a lightweight snapshot — only structure (timing/pitch data)
  runtime.undoStack.push(deepClone(state.structure));
  if (runtime.undoStack.length > MAX_UNDO) {
    runtime.undoStack.shift();
  }
  updateUndoButton();
}

function performUndo() {
  if (!runtime.undoStack.length) return;
  state.structure = runtime.undoStack.pop();
  rebuildIndex();
  renderLyrics();
  updateSelectedEditor();
  updateSyncStatus();
  markLyricsDirty();
  updateLyricsDynamic();
  markDirty();
  scheduleAutosave();
  updateUndoButton();
}

function updateUndoButton() {
  if (els.undoBtn) {
    els.undoBtn.disabled = runtime.undoStack.length === 0;
    els.undoBtn.title = runtime.undoStack.length > 0
      ? `Undo (${runtime.undoStack.length} steps, Ctrl+Z)`
      : 'Nothing to undo';
  }
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

function markLyricsDirty() {
  runtime.lyricsRender.forceFull = true;
}

function upperBound(sortedValues, target) {
  let low = 0;
  let high = sortedValues.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sortedValues[mid] <= target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function invalidateRenderCaches(...keys) {
  if (!keys.length || keys.includes('timeline')) {
    runtime.renderCache.timelineBase.key = '';
    runtime.renderCache.timelineWaveformTiles.key = '';
    runtime.renderCache.timelineWaveformTiles.entries = new Map();
  }
  if (!keys.length || keys.includes('overview')) {
    runtime.renderCache.overviewBase.key = '';
  }
  if (!keys.length || keys.includes('pitch')) {
    runtime.renderCache.pitchBase.key = '';
  }
  runtime.drawDirty = true;
}

function createRenderBuffer(width, height, existingCanvas = null, dpr = 1) {
  const canvas = existingCanvas || document.createElement('canvas');
  const pixelWidth = Math.max(1, Math.round(width * dpr));
  const pixelHeight = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return canvas;
}

function getAudioDuration() {
  if (runtime.transport.buffer?.duration) {
    return runtime.transport.buffer.duration;
  }
  if (isFiniteNumber(els.audioPlayer.duration) && els.audioPlayer.duration > 0) {
    return els.audioPlayer.duration;
  }
  return isFiniteNumber(state.audioMeta.duration) ? state.audioMeta.duration : 0;
}

function getIsPlaying() {
  return !!runtime.transport.playing;
}

function getCurrentTime() {
  if (runtime.transport.playing && runtime.audioContext) {
    const rate = Math.max(0.1, state.settings.playbackRate);
    const elapsed = Math.max(0, runtime.audioContext.currentTime - runtime.transport.startContextTime);
    return clamp(runtime.transport.startOffset + elapsed * rate, 0, getAudioDuration());
  }
  return clamp(runtime.transport.pauseOffset || 0, 0, getAudioDuration());
}

function mirrorMediaElementTime(time) {
  try {
    els.audioPlayer.currentTime = clamp(time, 0, Math.max(getAudioDuration(), 0));
  } catch (error) {
    console.warn(error);
  }
}

function clearTransportSource() {
  const source = runtime.transport.sourceNode;
  runtime.transport.sourceNode = null;
  if (!source) {
    return;
  }
  source.onended = null;
  try {
    source.stop();
  } catch {}
  try {
    source.disconnect();
  } catch {}
}

function setTransportPausedTime(time) {
  runtime.transport.pauseOffset = clamp(time, 0, getAudioDuration());
  mirrorMediaElementTime(runtime.transport.pauseOffset);
}

function handleTransportEnded(token) {
  if (token !== runtime.transport.playToken || !runtime.transport.playing) {
    return;
  }
  runtime.transport.playing = false;
  runtime.transport.sourceNode = null;
  setTransportPausedTime(getAudioDuration());
  stopGuideVoice();
  updateTransportUi();
  resetAudioOverlayState();
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
}

function restartTransportPlayback(time = getCurrentTime()) {
  if (!runtime.audioContext || !runtime.transport.buffer) {
    setTransportPausedTime(time);
    return false;
  }
  const duration = getAudioDuration();
  const startTime = clamp(time, 0, duration);
  if (!(duration > 0) || startTime >= duration - 1e-4) {
    runtime.transport.playing = false;
    setTransportPausedTime(duration);
    syncMetronomeTransport(true);
    updateTransportUi();
    return false;
  }
  clearTransportSource();
  const source = runtime.audioContext.createBufferSource();
  const token = ++runtime.transport.playToken;
  source.buffer = runtime.transport.buffer;
  source.playbackRate.value = Math.max(0.1, state.settings.playbackRate);
  source.connect(runtime.transport.musicGain);
  source.onended = () => handleTransportEnded(token);
  runtime.transport.sourceNode = source;
  runtime.transport.startContextTime = runtime.audioContext.currentTime;
  runtime.transport.startOffset = startTime;
  runtime.transport.pauseOffset = startTime;
  runtime.transport.playing = true;
  mirrorMediaElementTime(startTime);
  source.start(0, startTime);
  syncMetronomeTransport(true);
  updateTransportUi();
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  return true;
}

async function playTransport({ seekTime = null } = {}) {
  await ensureAudioContext(true);
  if (!runtime.transport.buffer) {
    return false;
  }
  const startTime = seekTime === null ? getCurrentTime() : seekTime;
  return restartTransportPlayback(startTime);
}

function pauseTransport({ time = getCurrentTime() } = {}) {
  runtime.transport.playing = false;
  ++runtime.transport.playToken;
  clearTransportSource();
  setTransportPausedTime(time);
  resetAudioOverlayState();
  stopGuideVoice();
  updateTransportUi();
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
}

function clearTransportBuffer() {
  pauseTransport({ time: 0 });
  runtime.transport.buffer = null;
  runtime.transport.pauseOffset = 0;
  runtime.transport.startContextTime = 0;
  runtime.transport.startOffset = 0;
}

function getProjectMaxTime() {
  return Math.max(FULL_VIEW_MIN, runtime.index.maxTime || getAudioDuration() || FULL_VIEW_MIN);
}

function createRuntimeAudioMeta(audioMeta = {}) {
  return {
    name: audioMeta.name || '',
    type: audioMeta.type || '',
    size: isFiniteNumber(audioMeta.size) ? Number(audioMeta.size) : 0,
    // Duration is derived from the decoded AudioBuffer/current media element.
    // Keep it in runtime state for UI only; never trust or persist it.
    duration: 0,
  };
}

function createPersistableAudioMeta(audioMeta = {}) {
  return {
    name: audioMeta.name || '',
    type: audioMeta.type || '',
    size: isFiniteNumber(audioMeta.size) ? Number(audioMeta.size) : 0,
  };
}

function mergeStateDefaults(project) {
  const base = defaultState();
  const incoming = project || {};
  return {
    ...base,
    ...incoming,
    audioMeta: createRuntimeAudioMeta({
      ...base.audioMeta,
      ...(incoming.audioMeta || {}),
    }),
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
      followSounding: incoming.settings?.followSounding ?? base.settings.followSounding,
      selectWithoutSeek: incoming.settings?.selectWithoutSeek ?? base.settings.selectWithoutSeek,
      autoScrollWindow: incoming.settings?.autoScrollWindow ?? base.settings.autoScrollWindow,
      keybinds: sanitizeKeybinds(incoming.settings?.keybinds),
      ui: sanitizeUiSettings(incoming.settings?.ui),
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
    playback: {
      currentTime: getCurrentTime(),
      wasPlaying: getIsPlaying(),
    },
    project: createSerializableProjectState(),
  };
}

function createSerializableProjectState() {
  const project = {
    projectName: state.projectName,
    lyricsMarkup: state.lyricsMarkup,
    structure: state.structure.map((line) => ({
      id: line.id,
      raw: line.raw,
      words: line.words.map((word) => ({
        id: word.id,
        raw: word.raw,
        text: word.text,
        showJoiners: !!word.showJoiners,
        syllables: word.syllables.map((syllable) => ({
          id: syllable.id,
          text: syllable.text,
          start: isFiniteNumber(syllable.start) ? syllable.start : null,
          end: isFiniteNumber(syllable.end) ? syllable.end : null,
          pitch: isFiniteNumber(syllable.pitch) ? syllable.pitch : null,
        })),
      })),
    })),
    audioMeta: createPersistableAudioMeta(state.audioMeta),
    settings: deepClone(state.settings),
    selection: { ...state.selection },
    practiceTarget: { ...state.practiceTarget },
  };
  // Derived decode/waveform data is intentionally excluded. It is rebuilt
  // from the stored/restored audio blob on load so autosave/export only contain
  // cold-start source data.
  return project;
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

function createAutosaveAudioRecord(blob, savedAt = Date.now()) {
  if (!blob) {
    return null;
  }
  return {
    id: AUTOSAVE_AUDIO_KEY,
    savedAt,
    audioBlob: blob,
    name: blob.name || state.audioMeta.name || '',
    type: blob.type || state.audioMeta.type || 'audio/*',
    size: blob.size || 0,
  };
}

async function putAutosaveSnapshot({ audioAction = 'keep', audio = audioBlob } = {}) {
  if (runtime.loadingProject && audioAction !== 'replace') {
    return;
  }
  const db = await openDb();
  const savedAt = Date.now();
  const statePayload = {
    id: AUTOSAVE_STATE_KEY,
    savedAt,
    project: serializeProject(),
  };
  const audioPayload = audioAction === 'replace' ? createAutosaveAudioRecord(audio, savedAt) : null;

  await new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    store.put(statePayload);
    if (audioAction === 'replace') {
      if (audioPayload) {
        store.put(audioPayload);
      } else {
        store.delete(AUTOSAVE_AUDIO_KEY);
      }
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  updateSaveStatus(`Autosaved locally at ${new Date().toLocaleTimeString()}.`);
}

async function putAutosaveState() {
  await putAutosaveSnapshot();
}

async function replaceAutosaveAudio(blob) {
  await putAutosaveSnapshot({ audioAction: 'replace', audio: blob });
}

function scheduleAutosave() {
  clearTimeout(runtime.autosaveTimer);
  runtime.autosaveTimer = setTimeout(() => {
    putAutosaveState().catch((error) => {
      console.error(error);
      updateSaveStatus('Autosave failed.');
    });
  }, 450);
}

async function loadAutosave() {
  try {
    const db = await openDb();

    // Load state and audio records in parallel
    const [stateRecord, audioRecord] = await Promise.all([
      new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readonly');
        const req = tx.objectStore(DB_STORE).get(AUTOSAVE_STATE_KEY);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
      new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readonly');
        const req = tx.objectStore(DB_STORE).get(AUTOSAVE_AUDIO_KEY);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
    ]);

    if (!stateRecord || !stateRecord.project) {
      updateSaveStatus('No autosaved project yet.');
      return;
    }

    // Firefox can return a Blob from IndexedDB that is technically readable
    // but still flaky when used directly as media src. Materialize the full
    // byte payload into a fresh Blob/File before handing it to <audio>.
    let safeAudioBlob = null;
    if (audioRecord?.audioBlob) {
      safeAudioBlob = await validateBlob(audioRecord.audioBlob);
      const projectState = stateRecord.project?.project || stateRecord.project;
      const expectedSize = Number(projectState?.audioMeta?.size || 0);
      if (safeAudioBlob && expectedSize > 0 && safeAudioBlob.size !== expectedSize) {
        const audioLooksNewer = Number(audioRecord?.savedAt || 0) >= Number(stateRecord.savedAt || 0);
        if (audioLooksNewer && projectState?.audioMeta) {
          console.warn('Repairing autosave audio metadata from newer audio blob.', { expectedSize, actualSize: safeAudioBlob.size });
          projectState.audioMeta = {
            ...projectState.audioMeta,
            name: audioRecord?.name || projectState.audioMeta.name || '',
            type: audioRecord?.type || projectState.audioMeta.type || safeAudioBlob.type || 'audio/*',
            size: safeAudioBlob.size,
          };
        } else {
          console.warn('Ignoring autosaved audio blob with unexpected size.', { expectedSize, actualSize: safeAudioBlob.size });
          safeAudioBlob = null;
        }
      }
      if (safeAudioBlob) {
        const projectState = stateRecord.project?.project || stateRecord.project;
        safeAudioBlob = await reviveStoredAudioBlob(safeAudioBlob, {
          name: audioRecord?.name || projectState?.audioMeta?.name || '',
          type: audioRecord?.type || projectState?.audioMeta?.type || safeAudioBlob.type || 'audio/*',
        });
      }
    }

    await hydrateProject(stateRecord.project, safeAudioBlob, { fromAutosave: true });
    const savedAt = new Date(stateRecord.savedAt).toLocaleString();
    const audioNote = safeAudioBlob ? '' : audioRecord?.audioBlob ? ' (audio could not be restored)' : '';
    updateSaveStatus(`Loaded autosaved project from ${savedAt}.${audioNote}`);
  } catch (error) {
    console.error(error);
    updateSaveStatus('Could not access local project storage.');
  }
}

/**
 * Returns the blob if it's readable, or null if it appears corrupted/truncated.
 * Reads the first and last 4 KB to catch truncated writes.
 */
async function validateBlob(blob) {
  if (!blob || blob.size === 0) return null;
  try {
    const checkSize = Math.min(4096, blob.size);
    // Read start
    await blob.slice(0, checkSize).arrayBuffer();
    // Read end (catches truncation)
    await blob.slice(Math.max(0, blob.size - checkSize)).arrayBuffer();
    return blob;
  } catch {
    return null;
  }
}


async function reviveStoredAudioBlob(blob, { name = '', type = '' } = {}) {
  if (!blob) {
    return null;
  }
  const buffer = await blob.arrayBuffer();
  const mimeType = type || blob.type || 'audio/*';
  if (name) {
    return new File([buffer], name, { type: mimeType, lastModified: Date.now() });
  }
  return new Blob([buffer], { type: mimeType });
}

async function clearAutosave() {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      const store = tx.objectStore(DB_STORE);
      store.delete(AUTOSAVE_STATE_KEY);
      store.delete(AUTOSAVE_AUDIO_KEY);
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

function applyAudioContextSettings() {
  if (runtime.transport.musicGain) {
    runtime.transport.musicGain.gain.value = clamp(state.settings.musicVolume, 0, 1);
  }
  if (runtime.metronomeGain) {
    runtime.metronomeGain.gain.value = clamp(state.settings.metronome.volume, 0, 1);
  }
  if (runtime.guideGain) {
    runtime.guideGain.gain.value = clamp(state.settings.guideSynth.volume, 0, 1);
  }
}

async function ensureAudioContext(resume = false) {
  if (!runtime.audioContext) {
    if (!resume) {
      return null;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    runtime.audioContext = new Ctx();
    runtime.transport.musicGain = runtime.audioContext.createGain();
    runtime.metronomeGain = runtime.audioContext.createGain();
    runtime.guideGain = runtime.audioContext.createGain();
    runtime.transport.musicGain.connect(runtime.audioContext.destination);
    runtime.metronomeGain.connect(runtime.audioContext.destination);
    runtime.guideGain.connect(runtime.audioContext.destination);
    ensureMetronomeWorklet().catch((error) => console.warn(error));
  }
  applyAudioContextSettings();
  if (resume && runtime.audioContext.state === 'suspended') {
    await runtime.audioContext.resume();
  }
  await ensureMetronomeWorklet();
  return runtime.audioContext;
}

async function decodeAudioBlobForWaveform(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (OfflineCtx) {
    const offlineContext = new OfflineCtx(1, 1, 44100);
    return offlineContext.decodeAudioData(arrayBuffer.slice(0));
  }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) {
    throw new Error('Web Audio API is unavailable.');
  }
  const tempContext = new Ctx();
  try {
    return await tempContext.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    if (typeof tempContext.close === 'function') {
      try {
        await tempContext.close();
      } catch (error) {
        console.warn(error);
      }
    }
  }
}

function computeWaveformPeaks(audioBuffer) {
  const channelCount = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const duration = Math.max(audioBuffer.duration || 0, 1);
  const targetSamples = clamp(Math.round(duration * 120), 4000, 48000);
  const blockSize = Math.max(1, Math.floor(length / targetSamples));
  const actualSamples = Math.max(1, Math.ceil(length / blockSize));
  const min = new Float32Array(actualSamples);
  const max = new Float32Array(actualSamples);
  for (let i = 0; i < actualSamples; i += 1) {
    const start = i * blockSize;
    const end = Math.min(start + blockSize, length);
    let blockMin = 1;
    let blockMax = -1;
    for (let channel = 0; channel < channelCount; channel += 1) {
      const data = audioBuffer.getChannelData(channel);
      for (let j = start; j < end; j += 1) {
        const value = data[j];
        if (value < blockMin) blockMin = value;
        if (value > blockMax) blockMax = value;
      }
    }
    min[i] = blockMin === 1 ? 0 : blockMin;
    max[i] = blockMax === -1 ? 0 : blockMax;
  }
  return { min, max };
}

function normalizeWaveformPeaks(peaks) {
  if (!peaks) {
    return null;
  }
  if (Array.isArray(peaks)) {
    const max = Float32Array.from(peaks.map((value) => Math.max(0, value || 0)));
    const min = Float32Array.from(max, (value) => -value);
    return { min, max };
  }
  const hasMin = Array.isArray(peaks.min) || ArrayBuffer.isView(peaks.min);
  const hasMax = Array.isArray(peaks.max) || ArrayBuffer.isView(peaks.max);
  if (hasMin && hasMax && peaks.min.length && peaks.max.length) {
    return {
      min: ArrayBuffer.isView(peaks.min) ? peaks.min : Float32Array.from(peaks.min),
      max: ArrayBuffer.isView(peaks.max) ? peaks.max : Float32Array.from(peaks.max),
    };
  }
  return null;
}

function getWaveformRangeAtTime(peaks, time, duration) {
  const count = Math.min(peaks.min.length, peaks.max.length);
  if (!count || duration <= 0) {
    return { min: 0, max: 0 };
  }
  const index = clamp(Math.floor((time / duration) * count), 0, count - 1);
  return {
    min: peaks.min[index] || 0,
    max: peaks.max[index] || 0,
  };
}

function getWaveformRangeAtIndices(peaks, startIndex, endIndex) {
  const count = Math.min(peaks.min.length, peaks.max.length);
  if (!count) {
    return { min: 0, max: 0 };
  }
  const start = clamp(Math.floor(startIndex), 0, count - 1);
  const end = clamp(Math.ceil(endIndex), start + 1, count);
  let min = 0;
  let max = 0;
  for (let i = start; i < end; i += 1) {
    const lo = peaks.min[i] || 0;
    const hi = peaks.max[i] || 0;
    if (i === start || lo < min) min = lo;
    if (i === start || hi > max) max = hi;
  }
  return { min, max };
}

function buildWaveformLevels(peaks) {
  const baseCount = Math.min(peaks.min.length, peaks.max.length);
  if (!baseCount) {
    return [];
  }
  const levels = [];
  let current = {
    min: ArrayBuffer.isView(peaks.min) ? new Float32Array(peaks.min) : Float32Array.from(peaks.min.slice(0, baseCount)),
    max: ArrayBuffer.isView(peaks.max) ? new Float32Array(peaks.max) : Float32Array.from(peaks.max.slice(0, baseCount)),
    stride: 1,
  };
  levels.push(current);
  while (current.min.length > 512) {
    const nextCount = Math.ceil(current.min.length / 2);
    const nextMin = new Float32Array(nextCount);
    const nextMax = new Float32Array(nextCount);
    for (let i = 0; i < nextCount; i += 1) {
      const left = i * 2;
      const right = Math.min(left + 1, current.min.length - 1);
      nextMin[i] = Math.min(current.min[left], current.min[right]);
      nextMax[i] = Math.max(current.max[left], current.max[right]);
    }
    current = { min: nextMin, max: nextMax, stride: current.stride * 2 };
    levels.push(current);
  }
  return levels;
}

function serializeWaveformLevelsForTransfer(levels) {
  return (levels || []).map((level) => ({
    stride: level.stride,
    min: ArrayBuffer.isView(level.min) ? level.min.buffer : Float32Array.from(level.min).buffer,
    max: ArrayBuffer.isView(level.max) ? level.max.buffer : Float32Array.from(level.max).buffer,
  }));
}

function deserializeWaveformLevels(levels) {
  return (levels || []).map((level) => ({
    stride: level.stride,
    min: level.min instanceof Float32Array ? level.min : new Float32Array(level.min),
    max: level.max instanceof Float32Array ? level.max : new Float32Array(level.max),
  }));
}

function initWaveformWorker() {
  if (runtime.waveformWorker) {
    return runtime.waveformWorker;
  }
  const worker = new Worker('waveform-worker.js');
  worker.addEventListener('message', (event) => {
    const { id, ok, error, peaks, levels, dataUrl } = event.data || {};
    const pending = runtime.waveformWorkerJobs.get(id);
    if (!pending) {
      return;
    }
    runtime.waveformWorkerJobs.delete(id);
    if (!ok) {
      pending.reject(new Error(error || 'Waveform analysis failed.'));
      return;
    }
    if (typeof dataUrl === 'string') {
      pending.resolve(dataUrl);
      return;
    }
    pending.resolve({
      peaks: {
        min: peaks?.min instanceof Float32Array ? peaks.min : new Float32Array(peaks?.min || 0),
        max: peaks?.max instanceof Float32Array ? peaks.max : new Float32Array(peaks?.max || 0),
      },
      levels: deserializeWaveformLevels(levels),
    });
  });
  runtime.waveformWorker = worker;
  return worker;
}

async function analyzeWaveformInWorker(audioBuffer) {
  const worker = initWaveformWorker();
  const id = ++runtime.waveformJobId;
  const channelBuffers = [];
  const transferList = [];
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const copy = new Float32Array(audioBuffer.length);
    copy.set(audioBuffer.getChannelData(channel));
    channelBuffers.push(copy.buffer);
    transferList.push(copy.buffer);
  }
  return new Promise((resolve, reject) => {
    runtime.waveformWorkerJobs.set(id, { resolve, reject });
    worker.postMessage({
      id,
      type: 'analyze-waveform',
      channels: channelBuffers,
      length: audioBuffer.length,
      duration: audioBuffer.duration,
    }, transferList);
  });
}

async function blobToDataUrlViaWorker(blob) {
  const worker = initWaveformWorker();
  const id = ++runtime.waveformJobId;
  return new Promise((resolve, reject) => {
    runtime.waveformWorkerJobs.set(id, { resolve, reject });
    worker.postMessage({
      id,
      type: 'blob-to-data-url',
      blob,
    });
  });
}

function seedTimelineWaveformLevels(levels) {
  const peaks = normalizeWaveformPeaks(state.waveformPeaks);
  if (!peaks || !levels) {
    runtime.renderCache.timelineWaveformLevels.key = '';
    runtime.renderCache.timelineWaveformLevels.levels = null;
    return;
  }
  const count = Math.min(peaks.min.length, peaks.max.length);
  runtime.renderCache.timelineWaveformLevels.key = [runtime.renderCache.waveformVersion, count].join('|');
  runtime.renderCache.timelineWaveformLevels.levels = levels;
}

function ensureTimelineWaveformLevels() {
  const cache = runtime.renderCache.timelineWaveformLevels;
  const peaks = normalizeWaveformPeaks(state.waveformPeaks);
  if (!peaks) {
    cache.key = '';
    cache.levels = null;
    return null;
  }
  const count = Math.min(peaks.min.length, peaks.max.length);
  const key = [runtime.renderCache.waveformVersion, count].join('|');
  if (cache.key === key && cache.levels) {
    return cache.levels;
  }
  cache.levels = buildWaveformLevels(peaks);
  cache.key = key;
  return cache.levels;
}

function getWaveformLevelForDensity(levels, basePeaksPerPixel, targetPeaksPerPixel = 1.25) {
  if (!levels || !levels.length) {
    return null;
  }
  let best = levels[0];
  let bestScore = Number.POSITIVE_INFINITY;
  levels.forEach((level) => {
    const reducedPeaksPerPixel = basePeaksPerPixel / Math.max(1, level.stride);
    const score = Math.abs(Math.log2(Math.max(EPSILON, reducedPeaksPerPixel) / targetPeaksPerPixel));
    if (score < bestScore) {
      best = level;
      bestScore = score;
    }
  });
  return best;
}

function drawWaveformShape(ctx, width, height, sampleAtX, { fillStyle, strokeStyle, gain = 0.46 } = {}) {
  if (width <= 0 || height <= 0) {
    return;
  }
  const mid = height / 2;
  const amplitudeScale = height * gain;
  ctx.save();
  ctx.fillStyle = fillStyle || 'rgba(43, 74, 203, 0.26)';
  ctx.strokeStyle = strokeStyle || 'rgba(43, 74, 203, 0.72)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  let firstTop = mid;
  let firstBottom = mid;
  for (let x = 0; x < width; x += 1) {
    const range = sampleAtX(x);
    const top = mid - Math.max(0, range.max) * amplitudeScale;
    if (x === 0) {
      firstTop = top;
      firstBottom = mid - Math.min(0, range.min) * amplitudeScale;
      ctx.moveTo(0, top);
    } else {
      ctx.lineTo(x, top);
    }
  }
  for (let x = width - 1; x >= 0; x -= 1) {
    const range = sampleAtX(x);
    const bottom = mid - Math.min(0, range.min) * amplitudeScale;
    ctx.lineTo(x, bottom);
  }
  ctx.lineTo(0, firstBottom);
  ctx.lineTo(0, firstTop);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

async function loadAudioBlob(blob, { restoreTime = null } = {}) {
  if (blob && !(blob instanceof File) && !(blob instanceof Blob)) {
    throw new Error('Invalid audio blob provided.');
  }
  if (!blob) {
    audioBlob = null;
    parsedAudioMeta = null;
    if (runtime.artworkObjectUrl) {
      URL.revokeObjectURL(runtime.artworkObjectUrl);
      runtime.artworkObjectUrl = '';
    }
    state.audioMeta = createRuntimeAudioMeta();
    state.waveformPeaks = [];
    runtime.transport.buffer = null;
    runtime.renderCache.waveformVersion += 1;
    seedTimelineWaveformLevels(null);
    invalidateRenderCaches();
    rebuildTimingCaches();
    markLyricsDirty();
    revokeCurrentObjectUrl();
    els.audioPlayer.removeAttribute('src');
    els.audioPlayer.load();
    setTransportPausedTime(0);
    refreshAudioMeta();
    fitViewToSong();
    resetAudioOverlayState();
    updateMediaSession();
    document.title = 'Syllable Karaoke Studio';
    // Clear the stored audio blob and save the matching empty audio metadata in one transaction.
    try {
      await replaceAutosaveAudio(null);
    } catch (error) {
      console.error('Audio autosave replacement failed:', error);
      updateSaveStatus('Autosave failed.');
    }
    return;
  }

  const seekTime = isFiniteNumber(restoreTime) && restoreTime > 0 ? restoreTime : 0;
  try {
    pauseTransport({ time: 0 });
  } catch (error) {
    console.warn('Audio reset before load failed:', error);
  }
  audioBlob = blob;
  revokeCurrentObjectUrl();
  runtime.objectUrl = URL.createObjectURL(blob);
  els.audioPlayer.preload = 'metadata';
  els.audioPlayer.src = runtime.objectUrl;
  els.audioPlayer.playbackRate = state.settings.playbackRate;
  els.audioPlayer.volume = state.settings.musicVolume;
  els.audioPlayer.load();

  state.audioMeta = createRuntimeAudioMeta({
    name: blob.name || state.audioMeta.name || 'audio-file',
    type: blob.type || state.audioMeta.type || 'audio/*',
    size: blob.size || state.audioMeta.size || 0,
  });

  setTransportPausedTime(seekTime);
  refreshAudioMeta();

  let autosaveAudioReplaced = false;
  try {
    await replaceAutosaveAudio(blob);
    autosaveAudioReplaced = true;
  } catch (error) {
    console.error('Audio autosave replacement failed:', error);
    updateSaveStatus('Autosave failed.');
  }

  // Wait for metadata so duration is available, then restore position.
  // On Firefox, using a restored Blob too early can transiently report a bad
  // duration and jump playback to the end, so we also wait for loadeddata.
  if (seekTime > 0) {
    const applySeek = () => {
      try {
        const dur = isFiniteNumber(els.audioPlayer.duration) && els.audioPlayer.duration > 0
          ? els.audioPlayer.duration
          : (getAudioDuration() || seekTime);
        els.audioPlayer.currentTime = Math.min(seekTime, dur);
      } catch (err) {
        console.warn('Seek after load failed:', err);
      }
    };
    if (isFiniteNumber(els.audioPlayer.duration) && els.audioPlayer.duration > 0 && els.audioPlayer.readyState >= 1) {
      applySeek();
    } else {
      const onReady = () => {
        els.audioPlayer.removeEventListener('loadedmetadata', onReady);
        els.audioPlayer.removeEventListener('loadeddata', onReady);
        applySeek();
      };
      els.audioPlayer.addEventListener('loadedmetadata', onReady);
      els.audioPlayer.addEventListener('loadeddata', onReady);
    }
  }

  try {
    const decoded = await decodeAudioBlobForWaveform(blob);
    runtime.transport.buffer = decoded;
    state.audioMeta.duration = decoded.duration;
    setTransportPausedTime(Math.min(seekTime, decoded.duration || seekTime));
    rebuildTimingCaches();
    updateSaveStatus('Analyzing waveform…');
    try {
      const analysis = await analyzeWaveformInWorker(decoded);
      state.waveformPeaks = analysis.peaks;
      runtime.renderCache.waveformVersion += 1;
      seedTimelineWaveformLevels(analysis.levels);
      invalidateRenderCaches();
    } catch (workerError) {
      console.warn('Waveform worker failed, falling back to main thread.', workerError);
      state.waveformPeaks = computeWaveformPeaks(decoded);
      runtime.renderCache.waveformVersion += 1;
      seedTimelineWaveformLevels(buildWaveformLevels(state.waveformPeaks));
      invalidateRenderCaches();
    }
  } catch (error) {
    console.warn('Could not decode waveform.', error);
    runtime.transport.buffer = null;
    state.waveformPeaks = [];
    seedTimelineWaveformLevels(null);
  }

  // Parse ID3/metadata tags and expose via Media Session API
  parseAudioFileMeta(blob).catch(console.warn);

  refreshAudioMeta();
  rebuildTimingCaches();
  fitViewToSong();
  resetAudioOverlayState();
  markDirty();

  if (!autosaveAudioReplaced) {
    // Retry as a full replacement so audioMeta and the audio blob still land atomically.
    try {
      await replaceAutosaveAudio(blob);
    } catch (error) {
      console.error('Audio autosave replacement failed:', error);
      updateSaveStatus('Autosave failed.');
    }
  }
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
    timedEntries: [],
    timedStarts: [],
    timedEnds: [],
    prevTimedStartByIndex: [],
    nextTimedStartByIndex: [],
    effectiveEnds: [],
    snapPoints: [],
    snapPointTimes: [],
    syncedCount: 0,
    maxTime: FULL_VIEW_MIN,
  };
  rebuildTimingCaches();

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

function rebuildTimingCaches() {
  const syllables = runtime.index.syllables;
  const prevTimedStartByIndex = new Array(syllables.length).fill(null);
  const nextTimedStartByIndex = new Array(syllables.length).fill(null);
  const effectiveEnds = new Array(syllables.length).fill(null);
  const timedEntries = [];
  const timedStarts = [];
  const snapPoints = [];
  let syncedCount = 0;
  let maxTime = Math.max(FULL_VIEW_MIN, getAudioDuration());

  let previousTimedStart = null;
  for (let i = 0; i < syllables.length; i += 1) {
    const entry = syllables[i];
    prevTimedStartByIndex[i] = previousTimedStart;
    if (isFiniteNumber(entry.syllable.start)) {
      previousTimedStart = entry.syllable.start;
      timedEntries.push(entry);
      timedStarts.push(entry.syllable.start);
      snapPoints.push({ time: entry.syllable.start, syllableId: entry.id });
      syncedCount += 1;
      maxTime = Math.max(maxTime, entry.syllable.start);
    }
    if (isFiniteNumber(entry.syllable.end)) {
      snapPoints.push({ time: entry.syllable.end, syllableId: entry.id });
      maxTime = Math.max(maxTime, entry.syllable.end);
    }
  }

  let nextTimedStart = null;
  for (let i = syllables.length - 1; i >= 0; i -= 1) {
    nextTimedStartByIndex[i] = nextTimedStart;
    const start = syllables[i].syllable.start;
    if (isFiniteNumber(start)) {
      nextTimedStart = start;
    }
  }

  const duration = getAudioDuration();
  for (let i = 0; i < syllables.length; i += 1) {
    const entry = syllables[i];
    const start = entry.syllable.start;
    if (!isFiniteNumber(start)) {
      continue;
    }
    let end = null;
    if (isFiniteNumber(entry.syllable.end) && entry.syllable.end > start) {
      end = entry.syllable.end;
    } else if (isFiniteNumber(nextTimedStartByIndex[i])) {
      end = nextTimedStartByIndex[i];
    } else if (isFiniteNumber(duration) && duration > start) {
      end = duration;
    } else {
      end = start + DEFAULT_TAIL;
    }
    effectiveEnds[i] = end;
    maxTime = Math.max(maxTime, end);
  }

  const timedEnds = timedEntries.map((entry) => effectiveEnds[entry.globalIndex]);
  snapPoints.sort((a, b) => a.time - b.time);

  runtime.index = {
    ...runtime.index,
    timedEntries,
    timedStarts,
    timedEnds,
    prevTimedStartByIndex,
    nextTimedStartByIndex,
    effectiveEnds,
    snapPoints,
    snapPointTimes: snapPoints.map((point) => point.time),
    syncedCount,
    maxTime: Math.max(FULL_VIEW_MIN, maxTime || FULL_VIEW_MIN),
  };
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
  return runtime.index.prevTimedStartByIndex[globalIndex] ?? null;
}

function findNextTimedSyllableStart(globalIndex) {
  return runtime.index.nextTimedStartByIndex[globalIndex] ?? null;
}

function getEffectiveSyllableEnd(globalIndex) {
  return runtime.index.effectiveEnds[globalIndex] ?? null;
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
  return runtime.index.syncedCount || 0;
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

function setPlayheadTimeImmediate(time) {
  const clampedTime = clamp(time, 0, Math.max(getProjectMaxTime(), getAudioDuration()));
  if (getIsPlaying()) {
    restartTransportPlayback(clampedTime);
  } else {
    setTransportPausedTime(clampedTime);
    resetAudioOverlayState();
    updateTransportUi();
  }
  markLyricsDirty();
  updateLyricsDynamic();
  markDirty();
}

function updateViewRangeLabel() {
  els.viewRangeLabel.textContent = `${formatClock(runtime.view.start, { hundredths: true })} → ${formatClock(runtime.view.start + runtime.view.duration, { hundredths: true })}`;
}

function setSelectionSyllableById(id, { practiceKind = 'syllable', practiceId = id, scroll = true, ensureView = true, fromFollowSounding = false } = {}) {
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
  markLyricsDirty();
  updateLyricsDynamic();
  if (scroll) {
    scrollSelectionIntoView();
  }
  // "Select without seek" — don't move view or playhead when selecting
  const noSeek = state.settings.selectWithoutSeek && !fromFollowSounding;
  if (!noSeek && ensureView && entry && isFiniteNumber(entry.syllable.start)) {
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
  els.playPauseBtn.textContent = getIsPlaying() ? 'Pause' : 'Play';
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
  if (els.autoScrollWindow) els.autoScrollWindow.checked = state.settings.autoScrollWindow ?? false;
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
  if (els.followSoundingCheckbox) els.followSoundingCheckbox.checked = state.settings.followSounding ?? false;
  if (els.selectWithoutSeekCheckbox) els.selectWithoutSeekCheckbox.checked = state.settings.selectWithoutSeek ?? false;
  state.settings.keybinds = sanitizeKeybinds(state.settings.keybinds);
  state.settings.ui = sanitizeUiSettings(state.settings.ui);
  renderKeybindEditor();
  applyUiState();
  updateUndoButton();
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
  // Only push undo if we already have timing data worth preserving
  if (runtime.index.syllables.some(e => isFiniteNumber(e.syllable.start))) {
    pushUndoSnapshot();
  }
  state.lyricsMarkup = els.lyricsInput.value;
  state.structure = parseLyricsMarkup(state.lyricsMarkup, state.structure);
  runtime.lastSetEndGesture = null;
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
  runtime.dom.linesByIndex = [];
  runtime.dom.wordsByIndex = [];
  runtime.dom.syllablesByIndex = [];
  els.lyricsStage.innerHTML = '';

  if (!state.structure.some((line) => line.words.length > 0)) {
    els.lyricsStage.appendChild(els.emptyLyricsTemplate.content.cloneNode(true));
    markLyricsDirty();
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
      const wordEntry = runtime.index.wordById.get(word.id);
      if (wordEntry) {
        runtime.dom.wordsByIndex[wordEntry.globalWordIndex] = wordNode;
      }

      word.syllables.forEach((syllable, syllableIndex) => {
        const syllableNode = document.createElement('span');
        syllableNode.className = 'syllable';
        syllableNode.dataset.syllableId = syllable.id;
        syllableNode.textContent = syllable.text;
        syllableNode.title = `Jump to syllable “${syllable.text}”`;
        runtime.dom.syllables.set(syllable.id, syllableNode);
        const syllableEntry = runtime.index.syllableById.get(syllable.id);
        if (syllableEntry) {
          runtime.dom.syllablesByIndex[syllableEntry.globalIndex] = syllableNode;
        }
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
    runtime.dom.linesByIndex[lineIndex] = lineNode;
  });

  markLyricsDirty();
  updateLyricsDynamic();
  updateSyncStatus();
}

function getCurrentSoundingEntryAtTime(time) {
  const starts = runtime.index.timedStarts;
  if (!starts.length) {
    return null;
  }
  const timedIndex = upperBound(starts, time) - 1;
  if (timedIndex < 0) {
    return null;
  }
  const entry = runtime.index.timedEntries[timedIndex];
  const end = runtime.index.timedEnds[timedIndex];
  if (!entry || !isFiniteNumber(end) || time < entry.syllable.start || time >= end) {
    return null;
  }
  return entry;
}

function getCurrentSoundingEntry() {
  return getCurrentSoundingEntryAtTime(getCurrentTime());
}

function getCompletedTimedIndexAtTime(time) {
  const ends = runtime.index.timedEnds;
  if (!ends.length) {
    return -1;
  }
  return upperBound(ends, time) - 1;
}

function applySyllableVisualState(entry, currentTime) {
  const node = runtime.dom.syllablesByIndex[entry.globalIndex] || runtime.dom.syllables.get(entry.id);
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
  const fillLabel = `${fill.toFixed(2)}%`;
  if (node.dataset.fill !== fillLabel) {
    node.style.setProperty('--fill', fillLabel);
    node.dataset.fill = fillLabel;
  }
  const isSelected = entry.id === state.selection.syllableId;
  node.classList.toggle('is-selected', isSelected);
  node.classList.toggle('is-sounding', isSounding);
  node.classList.toggle('is-complete', isComplete || fill >= 100);
  node.classList.toggle('is-unsynced', !isFiniteNumber(start));
}

function applyWordVisualState(wordEntry) {
  const node = runtime.dom.wordsByIndex[wordEntry.globalWordIndex] || runtime.dom.words.get(wordEntry.id);
  if (!node) {
    return;
  }
  const first = runtime.index.syllableById.get(wordEntry.firstSyllableId);
  const start = first?.syllable.start;
  const isSelectedWord = state.practiceTarget.kind === 'word' && state.practiceTarget.id === wordEntry.id;
  const hasSelectedSyllable = wordEntry.id === getSelectionEntry()?.wordId;
  node.classList.toggle('selected-word', isSelectedWord);
  node.classList.toggle('unsynced', !isFiniteNumber(start));
  node.classList.toggle('has-selected-syllable', hasSelectedSyllable);
}

function applyLineVisualState(lineEntry, activeLineId) {
  const node = runtime.dom.linesByIndex[lineEntry.lineIndex] || runtime.dom.lines.get(lineEntry.id);
  if (!node) {
    return;
  }
  node.classList.toggle('active', lineEntry.id === activeLineId);
  node.classList.toggle('selected-line', state.practiceTarget.kind === 'line' && state.practiceTarget.id === lineEntry.id);
}

function refreshLyricsDynamicAll(currentTime, soundingEntry, activeLineId) {
  runtime.index.syllables.forEach((entry) => applySyllableVisualState(entry, currentTime));
  runtime.index.words.forEach((entry) => applyWordVisualState(entry));
  runtime.index.lines.forEach((entry) => applyLineVisualState(entry, activeLineId));
  runtime.lyricsRender.lastCompletedTimedIndex = getCompletedTimedIndexAtTime(currentTime);
}

function updateLyricsDynamic() {
  const currentTime = getCurrentTime();
  const selectedEntry = getSelectionEntry();
  const practiceTarget = getPracticeTarget();
  const soundingEntry = getCurrentSoundingEntryAtTime(currentTime);
  const activeLineId = soundingEntry?.lineId || null;
  const selectedWordId = selectedEntry?.wordId || null;
  const selectedLineId = selectedEntry?.lineId || null;
  const renderState = runtime.lyricsRender;
  const timeMovedBackward = isFiniteNumber(renderState.lastCurrentTime) && currentTime + EPSILON < renderState.lastCurrentTime;
  const timeJumped = !isFiniteNumber(renderState.lastCurrentTime) || Math.abs(currentTime - renderState.lastCurrentTime) > 0.35;
  const selectionChanged = renderState.lastSelectedSyllableId !== state.selection.syllableId
    || renderState.lastPracticeTargetKind !== practiceTarget.kind
    || renderState.lastPracticeTargetId !== practiceTarget.id;
  const shouldFullRefresh = renderState.forceFull || timeMovedBackward || timeJumped || selectionChanged;

  if (shouldFullRefresh) {
    refreshLyricsDynamicAll(currentTime, soundingEntry, activeLineId);
    renderState.forceFull = false;
  } else {
    const completedTimedIndex = getCompletedTimedIndexAtTime(currentTime);
    if (renderState.lastCompletedTimedIndex !== completedTimedIndex) {
      const from = Math.min(renderState.lastCompletedTimedIndex, completedTimedIndex) + 1;
      const to = Math.max(renderState.lastCompletedTimedIndex, completedTimedIndex);
      for (let i = from; i <= to; i += 1) {
        const entry = runtime.index.timedEntries[i];
        if (entry) {
          applySyllableVisualState(entry, currentTime);
        }
      }
      renderState.lastCompletedTimedIndex = completedTimedIndex;
    }

    if (renderState.lastSoundingSyllableId && renderState.lastSoundingSyllableId !== soundingEntry?.id) {
      const previousEntry = runtime.index.syllableById.get(renderState.lastSoundingSyllableId);
      if (previousEntry) {
        applySyllableVisualState(previousEntry, currentTime);
      }
    }
    if (soundingEntry) {
      applySyllableVisualState(soundingEntry, currentTime);
    }

    if (renderState.lastSelectedSyllableId !== state.selection.syllableId) {
      const previousSelected = runtime.index.syllableById.get(renderState.lastSelectedSyllableId);
      if (previousSelected) {
        applySyllableVisualState(previousSelected, currentTime);
      }
      if (selectedEntry) {
        applySyllableVisualState(selectedEntry, currentTime);
      }
    }

    if (renderState.lastSelectedWordId !== selectedWordId) {
      const previousWord = runtime.index.wordById.get(renderState.lastSelectedWordId);
      if (previousWord) applyWordVisualState(previousWord);
      const currentWord = runtime.index.wordById.get(selectedWordId);
      if (currentWord) applyWordVisualState(currentWord);
    }

    if (renderState.lastPracticeTargetKind === 'word' && renderState.lastPracticeTargetId !== practiceTarget.id) {
      const previousPracticeWord = runtime.index.wordById.get(renderState.lastPracticeTargetId);
      if (previousPracticeWord) applyWordVisualState(previousPracticeWord);
    }
    if (practiceTarget.kind === 'word') {
      const currentPracticeWord = runtime.index.wordById.get(practiceTarget.id);
      if (currentPracticeWord) applyWordVisualState(currentPracticeWord);
    }

    if (renderState.lastActiveLineId !== activeLineId) {
      const previousLine = runtime.index.lineById.get(renderState.lastActiveLineId);
      if (previousLine) applyLineVisualState(previousLine, activeLineId);
      const currentLine = runtime.index.lineById.get(activeLineId);
      if (currentLine) applyLineVisualState(currentLine, activeLineId);
    }

    if (renderState.lastPracticeTargetKind === 'line' && renderState.lastPracticeTargetId !== practiceTarget.id) {
      const previousPracticeLine = runtime.index.lineById.get(renderState.lastPracticeTargetId);
      if (previousPracticeLine) applyLineVisualState(previousPracticeLine, activeLineId);
    }
    if (practiceTarget.kind === 'line') {
      const currentPracticeLine = runtime.index.lineById.get(practiceTarget.id);
      if (currentPracticeLine) applyLineVisualState(currentPracticeLine, activeLineId);
    }
  }

  if (selectedEntry && state.settings.autoScrollLyrics && activeLineId && runtime.lastAutoScrolledLineId !== activeLineId) {
    const activeLine = runtime.dom.lines.get(activeLineId);
    if (activeLine) {
      activeLine.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      runtime.lastAutoScrolledLineId = activeLineId;
    }
  }

  if (state.settings.followSounding) {
    if (getIsPlaying() && soundingEntry && soundingEntry.id !== runtime.lastFollowSoundingId) {
      runtime.lastFollowSoundingId = soundingEntry.id;
      if (soundingEntry.id !== state.selection.syllableId) {
        setSelectionSyllableById(soundingEntry.id, {
          practiceKind: 'syllable',
          practiceId: soundingEntry.id,
          scroll: false,
          ensureView: false,
          fromFollowSounding: true,
        });
      }
    } else if (!getIsPlaying()) {
      runtime.lastFollowSoundingId = null;
    }
  }

  renderState.lastCurrentTime = currentTime;
  renderState.lastSelectedSyllableId = state.selection.syllableId;
  renderState.lastSelectedWordId = selectedWordId;
  renderState.lastSelectedLineId = selectedLineId;
  renderState.lastPracticeTargetKind = practiceTarget.kind;
  renderState.lastPracticeTargetId = practiceTarget.id;
  renderState.lastSoundingSyllableId = soundingEntry?.id || null;
  renderState.lastActiveLineId = activeLineId;
}

function resizeCanvasToDisplaySize(canvas) {
  const rect = canvas.getBoundingClientRect();

  // If the canvas is collapsed/hidden, skip rendering entirely.
  if (rect.width === 0 || rect.height === 0) {
    return { ctx: null, width: 0, height: 0, dpr: 1 };
  }

  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const pixelWidth = Math.max(1, Math.round(width * dpr));
  const pixelHeight = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext('2d');
  // Keep all drawing and hit testing in CSS pixels. The backing store is still
  // scaled for HiDPI sharpness, but block geometry no longer changes with DPR.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height, dpr };
}

function getCanvasPoint(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
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
  ctx.fillStyle = '#faf7f2';
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
    ctx.strokeStyle = major ? `rgba(200, 100, 30, ${alpha + 0.22})` : `rgba(0, 0, 0, ${alpha})`;
    ctx.lineWidth = major ? 1.4 : 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  ctx.restore();
}

function getTimelineBaseKey(width, height, dpr = 1) {
  const m = state.settings.metronome;
  return [
    width,
    height,
    dpr,
    runtime.view.start.toFixed(4),
    runtime.view.duration.toFixed(4),
    runtime.renderCache.waveformVersion,
    Number(!!m.enabled),
    m.bpm,
    Number(m.offset || 0),
    m.beatsPerBar,
  ].join('|');
}

function renderTimelineBase(ctx, width, height, dpr = 1) {
  drawBackground(ctx, width, height);
  drawTimelineSelectionRange(ctx, width, height);
  const waveformHeight = height - TIMELINE_CONFIG.syllableTrackHeight;
  drawBeatGrid(ctx, width, waveformHeight, { alpha: 0.12 });
  drawWaveform(ctx, width, waveformHeight, dpr);
}

function drawTimelineBase(ctx, width, height, dpr = 1) {
  const key = getTimelineBaseKey(width, height, dpr);
  const cache = runtime.renderCache.timelineBase;
  if (cache.key !== key || !cache.canvas) {
    cache.canvas = createRenderBuffer(width, height, cache.canvas, dpr);
    const cacheCtx = cache.canvas.getContext('2d');
    cacheCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderTimelineBase(cacheCtx, width, height, dpr);
    cache.key = key;
  }
  ctx.drawImage(cache.canvas, 0, 0, width, height);
}

function getOverviewBaseKey(width, height, fullDuration, dpr = 1) {
  return [
    width,
    height,
    dpr,
    fullDuration.toFixed(4),
    runtime.renderCache.waveformVersion,
  ].join('|');
}

function renderOverviewBase(ctx, width, height, fullDuration) {
  drawBackground(ctx, width, height);
  const peaks = normalizeWaveformPeaks(state.waveformPeaks);
  if (peaks) {
    drawWaveformShape(ctx, width, height, (x) => getWaveformRangeAtTime(peaks, (x / Math.max(1, width)) * fullDuration, fullDuration), {
      fillStyle: 'rgba(43, 74, 203, 0.18)',
      strokeStyle: 'rgba(43, 74, 203, 0.6)',
      gain: 0.43,
    });
  }
}

function drawOverviewBase(ctx, width, height, fullDuration, dpr = 1) {
  const key = getOverviewBaseKey(width, height, fullDuration, dpr);
  const cache = runtime.renderCache.overviewBase;
  if (cache.key !== key || !cache.canvas) {
    cache.canvas = createRenderBuffer(width, height, cache.canvas, dpr);
    const cacheCtx = cache.canvas.getContext('2d');
    cacheCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderOverviewBase(cacheCtx, width, height, fullDuration);
    cache.key = key;
  }
  ctx.drawImage(cache.canvas, 0, 0, width, height);
}

function getPitchBaseKey(width, height, dpr = 1) {
  const m = state.settings.metronome;
  const minPitch = Math.min(state.settings.pitchRange.min, state.settings.pitchRange.max);
  const maxPitch = Math.max(state.settings.pitchRange.min, state.settings.pitchRange.max);
  return [
    width,
    height,
    dpr,
    runtime.view.start.toFixed(4),
    runtime.view.duration.toFixed(4),
    minPitch,
    maxPitch,
    Number(!!m.enabled),
    m.bpm,
    Number(m.offset || 0),
    m.beatsPerBar,
  ].join('|');
}

function renderPitchBase(ctx, width, height) {
  drawBackground(ctx, width, height);
  const minPitch = Math.min(state.settings.pitchRange.min, state.settings.pitchRange.max);
  const maxPitch = Math.max(state.settings.pitchRange.min, state.settings.pitchRange.max);
  const rowCount = Math.max(1, maxPitch - minPitch + 1);
  const rowHeight = (height - 16) / rowCount;
  ctx.save();
  for (let pitch = maxPitch; pitch >= minPitch; pitch -= 1) {
    const y = pitchToY(pitch, minPitch, maxPitch, height);
    const isBlack = [1, 3, 6, 8, 10].includes(((pitch % 12) + 12) % 12);
    ctx.fillStyle = isBlack ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.02)';
    ctx.fillRect(PITCH_GUTTER, y, width - PITCH_GUTTER, rowHeight);
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.font = `10px ${CANVAS_FONT_FAMILY}`;
    ctx.fillText(noteNameFromMidi(pitch), 6, y + rowHeight * 0.72);
  }
  ctx.restore();
  drawBeatGrid(ctx, width, height, { gutter: PITCH_GUTTER, alpha: 0.12 });
}

function drawPitchBase(ctx, width, height, dpr = 1) {
  const key = getPitchBaseKey(width, height, dpr);
  const cache = runtime.renderCache.pitchBase;
  if (cache.key !== key || !cache.canvas) {
    cache.canvas = createRenderBuffer(width, height, cache.canvas, dpr);
    const cacheCtx = cache.canvas.getContext('2d');
    cacheCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderPitchBase(cacheCtx, width, height);
    cache.key = key;
  }
  ctx.drawImage(cache.canvas, 0, 0, width, height);
}


const TIMELINE_WAVEFORM_TILE_MIN_WIDTH = 1024;
const TIMELINE_WAVEFORM_TILE_MAX_WIDTH = 2048;
const TIMELINE_WAVEFORM_TILE_OVERSCAN = 2;
const TIMELINE_WAVEFORM_MIN_PX_PER_SECOND = 32;
const TIMELINE_WAVEFORM_MAX_PX_PER_SECOND = 8192;
const TIMELINE_WAVEFORM_MAX_TILES = 48;
const TIMELINE_WAVEFORM_DIRECT_MAX_PEAKS_PER_PIXEL = 6;

function getTimelineWaveformTileCacheKey(height, duration, dpr = 1) {
  return [
    height,
    dpr,
    duration.toFixed(4),
    runtime.renderCache.waveformVersion,
  ].join('|');
}

function quantizeTimelineWaveformPxPerSecond(targetPxPerSecond) {
  const clamped = clamp(targetPxPerSecond, TIMELINE_WAVEFORM_MIN_PX_PER_SECOND, TIMELINE_WAVEFORM_MAX_PX_PER_SECOND);
  const exponent = Math.round(Math.log2(Math.max(1, clamped)));
  return clamp(2 ** exponent, TIMELINE_WAVEFORM_MIN_PX_PER_SECOND, TIMELINE_WAVEFORM_MAX_PX_PER_SECOND);
}

function quantizeTimelineWaveformTileWidth(width) {
  const target = clamp(Math.max(TIMELINE_WAVEFORM_TILE_MIN_WIDTH, width * 1.25), TIMELINE_WAVEFORM_TILE_MIN_WIDTH, TIMELINE_WAVEFORM_TILE_MAX_WIDTH);
  return 2 ** Math.round(Math.log2(Math.max(1, target)));
}

function getTimelineWaveformTileConfig(width, height, visibleDuration, duration, dpr = 1) {
  const tileWidth = quantizeTimelineWaveformTileWidth(Math.max(1, width));
  const targetPxPerSecond = (Math.max(1, width) / Math.max(VIEW_MIN_DURATION, visibleDuration)) * TIMELINE_WAVEFORM_TILE_OVERSCAN;
  const pxPerSecond = quantizeTimelineWaveformPxPerSecond(targetPxPerSecond);
  const tileDuration = Math.max(VIEW_MIN_DURATION, tileWidth / pxPerSecond);
  const tileCount = Math.max(1, Math.ceil(duration / tileDuration));
  return {
    pxPerSecond,
    tileDuration,
    tileCount,
    width: tileWidth,
    height,
    dpr,
  };
}

function getTimelineWaveformTile(cacheKey, tileIndex, config) {
  const cache = runtime.renderCache.timelineWaveformTiles;
  if (cache.key !== cacheKey) {
    cache.key = cacheKey;
    cache.entries = new Map();
  }
  const entryKey = [config.pxPerSecond, tileIndex].join('|');
  const existing = cache.entries.get(entryKey);
  if (existing) {
    return existing;
  }
  const duration = Math.max(getAudioDuration(), getProjectMaxTime());
  const levels = ensureTimelineWaveformLevels();
  const peaks = normalizeWaveformPeaks(state.waveformPeaks);
  if (!levels || !peaks || duration <= 0) {
    return null;
  }
  const basePeakCount = Math.min(peaks.min.length, peaks.max.length);
  const viewPeakSpan = Math.max(1, (config.tileDuration / duration) * basePeakCount);
  const basePeaksPerPixel = viewPeakSpan / Math.max(1, config.width);
  const level = getWaveformLevelForDensity(levels, basePeaksPerPixel) || levels[0];
  const tileStart = tileIndex * config.tileDuration;
  const tileEnd = Math.min(duration, tileStart + config.tileDuration);
  const canvas = createRenderBuffer(config.width, Math.max(1, config.height), null, config.dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(config.dpr, 0, 0, config.dpr, 0, 0);
  ctx.clearRect(0, 0, config.width, config.height);
  drawWaveformFromLevel(ctx, config.width, config.height, level, tileStart, Math.max(VIEW_MIN_DURATION, tileEnd - tileStart), duration);
  const entry = {
    canvas,
    start: tileStart,
    end: tileEnd,
    pxPerSecond: config.pxPerSecond,
  };
  cache.entries.set(entryKey, entry);
  while (cache.entries.size > TIMELINE_WAVEFORM_MAX_TILES) {
    const oldestKey = cache.entries.keys().next().value;
    cache.entries.delete(oldestKey);
  }
  return entry;
}

function drawWaveformDirect(ctx, width, height, peaks, visibleStart, visibleDuration, totalDuration) {
  const count = Math.min(peaks.min.length, peaks.max.length);
  if (!count || totalDuration <= 0) {
    return;
  }
  const viewPeakStart = (visibleStart / totalDuration) * count;
  const viewPeakSpan = Math.max(1, (visibleDuration / totalDuration) * count);
  drawWaveformShape(ctx, width, height, (x) => {
    const xStart = viewPeakStart + (x / Math.max(1, width)) * viewPeakSpan;
    const xEnd = viewPeakStart + ((x + 1) / Math.max(1, width)) * viewPeakSpan;
    return getWaveformRangeAtIndices(peaks, xStart, xEnd);
  }, {
    fillStyle: 'rgba(43, 74, 203, 0.2)',
    strokeStyle: 'rgba(43, 74, 203, 0.72)',
    gain: 0.45,
  });
}

function drawWaveformFromLevel(ctx, width, height, level, visibleStart, visibleDuration, totalDuration) {
  const count = Math.min(level.min.length, level.max.length);
  if (!count || totalDuration <= 0) {
    return;
  }
  const viewPeakStart = (visibleStart / totalDuration) * count;
  const viewPeakSpan = Math.max(1, (visibleDuration / totalDuration) * count);
  drawWaveformShape(ctx, width, height, (x) => {
    const xStart = viewPeakStart + (x / Math.max(1, width)) * viewPeakSpan;
    const xEnd = viewPeakStart + ((x + 1) / Math.max(1, width)) * viewPeakSpan;
    return getWaveformRangeAtIndices(level, xStart, xEnd);
  }, {
    fillStyle: 'rgba(43, 74, 203, 0.2)',
    strokeStyle: 'rgba(43, 74, 203, 0.72)',
    gain: 0.45,
  });
}

function drawWaveform(ctx, width, height, dpr = 1) {
  const peaks = normalizeWaveformPeaks(state.waveformPeaks);
  if (!peaks) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.font = `12px ${CANVAS_FONT_FAMILY}`;
    ctx.fillText('Load audio to show the waveform.', 16, height / 2);
    ctx.restore();
    return;
  }
  const duration = Math.max(getAudioDuration(), getProjectMaxTime());
  const visibleStart = clamp(runtime.view.start, 0, duration);
  const visibleDuration = clamp(runtime.view.duration, VIEW_MIN_DURATION, duration);
  const basePeakCount = Math.min(peaks.min.length, peaks.max.length);
  const visiblePeakSpan = Math.max(1, (visibleDuration / Math.max(EPSILON, duration)) * basePeakCount);
  const visiblePeaksPerPixel = visiblePeakSpan / Math.max(1, width);

  if (visiblePeaksPerPixel <= TIMELINE_WAVEFORM_DIRECT_MAX_PEAKS_PER_PIXEL) {
    drawWaveformDirect(ctx, width, height, peaks, visibleStart, visibleDuration, duration);
    return;
  }

  const config = getTimelineWaveformTileConfig(width, height, visibleDuration, duration, dpr);
  const cacheKey = getTimelineWaveformTileCacheKey(height, duration, dpr);
  const startTile = Math.max(0, Math.floor(visibleStart / config.tileDuration) - 1);
  const endTile = Math.min(config.tileCount - 1, Math.ceil((visibleStart + visibleDuration) / config.tileDuration));

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;

  for (let tileIndex = startTile; tileIndex <= endTile; tileIndex += 1) {
    const tile = getTimelineWaveformTile(cacheKey, tileIndex, config);
    if (!tile) {
      continue;
    }
    const overlapStart = Math.max(tile.start, visibleStart);
    const overlapEnd = Math.min(tile.end, visibleStart + visibleDuration);
    if (overlapEnd <= overlapStart) {
      continue;
    }
    const tileDuration = Math.max(EPSILON, tile.end - tile.start);
    const srcX = ((overlapStart - tile.start) / tileDuration) * tile.canvas.width;
    const srcW = ((overlapEnd - overlapStart) / tileDuration) * tile.canvas.width;
    const destX = ((overlapStart - visibleStart) / visibleDuration) * width;
    const destW = ((overlapEnd - overlapStart) / visibleDuration) * width;
    if (destX > width || destX + destW < 0 || srcW <= 0 || destW <= 0) {
      continue;
    }
    ctx.drawImage(tile.canvas, srcX, 0, srcW, tile.canvas.height, destX, 0, destW, height);
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
  ctx.fillStyle = 'rgba(30, 90, 200, 0.09)';
  ctx.fillRect(x1, 0, Math.max(1, x2 - x1), height);
  ctx.restore();
}

function drawTimelineBlocks(ctx, width, height, { rebuildHitboxes = true } = {}) {
  if (rebuildHitboxes) {
    runtime.timelineHitboxes = [];
  }
  const trackY = height - TIMELINE_CONFIG.syllableTrackHeight + TIMELINE_CONFIG.syllableBlockInsetY;
  const trackHeight = TIMELINE_CONFIG.syllableTrackHeight - TIMELINE_CONFIG.syllableBlockInsetY * 2;
  const selected = getSelectionEntry();
  const soundingEntry = getCurrentSoundingEntry();
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
    const isSounding = soundingEntry?.id === entry.id;
    ctx.save();
    ctx.fillStyle = isSelected ? 'rgba(184, 92, 0, 0.88)' : isSounding ? 'rgba(43, 74, 203, 0.82)' : 'rgba(20, 160, 100, 0.55)';
    ctx.strokeStyle = isSelected ? 'rgba(138, 66, 0, 0.92)' : isSounding ? 'rgba(25, 52, 153, 0.9)' : 'rgba(0,0,0,0.12)';
    ctx.lineWidth = isSelected ? 1.8 : 1;
    roundRect(ctx, x1, y, w, trackHeight, 7);
    ctx.fill();
    ctx.stroke();
    if (!isFiniteNumber(entry.syllable.end)) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.beginPath();
      ctx.moveTo(x2, y + 3);
      ctx.lineTo(x2, y + trackHeight - 3);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (w > 20) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.font = `11px ${CANVAS_FONT_FAMILY}`;
      ctx.fillText(entry.syllable.text, x1 + 6, y + trackHeight / 2 + 4);
    }
    ctx.restore();

    if (rebuildHitboxes) {
      runtime.timelineHitboxes.push({
        type: 'block',
        syllableId: entry.id,
        x: x1,
        y,
        w,
        h: trackHeight,
      });
    }

    if (isSelected) {
      const handleSize = 8;
      if (rebuildHitboxes) {
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
      }
      ctx.save();
      ctx.fillStyle = 'rgba(158, 108, 8, 0.95)';
      ctx.fillRect(x1 - 1, y - 1, 2, trackHeight + 2);
      ctx.fillRect(x2 - 1, y - 1, 2, trackHeight + 2);
      ctx.restore();
    }
  });

  // Draw snap-point indicators when dragging a handle
  if (runtime.drag && (runtime.drag.type === 'start' || runtime.drag.type === 'end')) {
    const excludeId = runtime.drag.syllableId;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 150, 0, 0.7)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    runtime.index.syllables.forEach((entry) => {
      if (entry.id === excludeId) return;
      [entry.syllable.start, entry.syllable.end].forEach((t) => {
        if (!isFiniteNumber(t)) return;
        if (t < runtime.view.start || t > runtime.view.start + runtime.view.duration) return;
        const sx = timeToX(t, width);
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, height - TIMELINE_CONFIG.syllableTrackHeight);
        ctx.stroke();
      });
    });
    ctx.setLineDash([]);
    ctx.restore();
  }
}

function drawPlayhead(ctx, width, height, { gutter = 0 } = {}) {
  const x = timeToX(getCurrentTime(), width, gutter);
  ctx.save();
  ctx.strokeStyle = 'rgba(200, 30, 30, 0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, height);
  ctx.stroke();
  ctx.restore();
}

function drawTimeline({ rebuildHitboxes = true } = {}) {
  const { ctx, width, height, dpr } = resizeCanvasToDisplaySize(els.timelineCanvas);
  if (!ctx) return; // Exit if hidden

  drawTimelineBase(ctx, width, height, dpr);
  drawTimelineBlocks(ctx, width, height, { rebuildHitboxes });
  drawPlayhead(ctx, width, height);
}

function drawOverview() {
  const { ctx, width, height, dpr } = resizeCanvasToDisplaySize(els.overviewCanvas);
  if (!ctx) return; // Exit if hidden

  const fullDuration = getProjectMaxTime();
  drawOverviewBase(ctx, width, height, fullDuration, dpr);
  const viewportX = (runtime.view.start / fullDuration) * width;
  const viewportW = Math.max(12, (runtime.view.duration / fullDuration) * width);
  runtime.overviewViewportHitbox = {
    x: viewportX,
    y: 0,
    w: viewportW,
    h: height,
  };
  ctx.save();
  ctx.fillStyle = 'rgba(30, 90, 200, 0.1)';
  ctx.fillRect(viewportX, 0, viewportW, height);
  ctx.strokeStyle = 'rgba(30, 90, 200, 0.8)';
  ctx.lineWidth = 2;
  ctx.strokeRect(viewportX, 1, viewportW, height - 2);
  const playheadX = (getCurrentTime() / fullDuration) * width;
  ctx.strokeStyle = 'rgba(200, 30, 30, 0.9)';
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

function drawPitchGuide({ rebuildHitboxes = true } = {}) {
  const { ctx, width, height, dpr } = resizeCanvasToDisplaySize(els.pitchCanvas);
  if (!ctx) return; // Exit if hidden

  drawPitchBase(ctx, width, height, dpr);
  const minPitch = Math.min(state.settings.pitchRange.min, state.settings.pitchRange.max);
  const maxPitch = Math.max(state.settings.pitchRange.min, state.settings.pitchRange.max);
  const rowCount = Math.max(1, maxPitch - minPitch + 1);
  const rowHeight = (height - 16) / rowCount;
  const selectedEntry = getSelectionEntry();
  if (rebuildHitboxes) {
    runtime.pitchHitboxes = [];
  }

  const soundingEntry = getCurrentSoundingEntry();
  runtime.index.syllables.forEach((entry) => {
    const start = entry.syllable.start;
    const end = getEffectiveSyllableEnd(entry.globalIndex);
    const hasPitch = isFiniteNumber(entry.syllable.pitch);
    const shouldShowGhost = selectedEntry?.id === entry.id && !hasPitch && isFiniteNumber(start) && isFiniteNumber(end);
    if (!isFiniteNumber(start) || !isFiniteNumber(end) || (!hasPitch && !shouldShowGhost)) {
      return;
    }
    if (end < runtime.view.start || start > runtime.view.start + runtime.view.duration) {
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
      ? 'rgba(0,0,0,0.08)'
      : isSelected
        ? 'rgba(184, 92, 0, 0.88)'
        : isSounding
          ? 'rgba(43, 74, 203, 0.85)'
          : 'rgba(20, 160, 100, 0.65)';
    ctx.strokeStyle = shouldShowGhost
      ? 'rgba(0,0,0,0.5)'
      : isSelected
        ? 'rgba(138, 66, 0, 0.92)'
        : isSounding
          ? 'rgba(25, 52, 153, 0.9)'
          : 'rgba(255,255,255,0.7)';
    ctx.lineWidth = shouldShowGhost ? 1.8 : 1;
    if (shouldShowGhost) {
      ctx.setLineDash([6, 4]);
    }
    roundRect(ctx, x1, y, w, h, 6);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    if (w > 28) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.font = `11px ${CANVAS_FONT_FAMILY}`;
      ctx.fillText(`${entry.syllable.text} · ${noteNameFromMidi(pitch)}`, x1 + 6, y + h * 0.66);
    }
    ctx.restore();
    if (rebuildHitboxes) {
      runtime.pitchHitboxes.push({
        type: shouldShowGhost ? 'ghost-note' : 'note',
        syllableId: entry.id,
        x: x1,
        y,
        w,
        h,
        pitch,
      });
    }
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
  pushUndoSnapshot();
  runtime.lastSetEndGesture = null;
  const newStart = roundTime(clampSyllableStart(entry.globalIndex, time));
  entry.syllable.start = newStart;
  if (isFiniteNumber(entry.syllable.end) && entry.syllable.end <= entry.syllable.start + EPSILON) {
    entry.syllable.end = null;
  }
  // If start moved past previous explicit end, clear that previous end
  resolveOverlapAfterStartMove(entry.globalIndex);
  afterTimingMutation({ ensureViewTime: entry.syllable.start });
}

function setSelectedEndTime(time) {
  const entry = getSelectionEntry();
  if (!entry || !isFiniteNumber(time) || !isFiniteNumber(entry.syllable.start)) {
    return;
  }
  const requestedEnd = roundTime(clampSyllableEnd(entry.globalIndex, time));
  const nextEntry = getNextStartedEntry(entry.globalIndex);
  const autoClear = shouldAutoClearEndOnRepeat(entry, nextEntry, requestedEnd);
  pushUndoSnapshot();
  if (autoClear) {
    entry.syllable.end = null;
    updateLastSetEndGesture(entry, requestedEnd);
    afterTimingMutation({ ensureViewTime: entry.syllable.start });
    return;
  }
  entry.syllable.end = requestedEnd;
  updateLastSetEndGesture(entry, requestedEnd);
  resolveOverlapAfterEndMove(entry.globalIndex);
  afterTimingMutation({ ensureViewTime: entry.syllable.end });
}

function setSyllableStartById(id, time) {
  const entry = runtime.index.syllableById.get(id);
  if (!entry || !isFiniteNumber(time)) {
    return;
  }
  runtime.lastSetEndGesture = null;
  const newStart = roundTime(clampSyllableStart(entry.globalIndex, time));
  entry.syllable.start = newStart;
  if (isFiniteNumber(entry.syllable.end) && entry.syllable.end <= entry.syllable.start + EPSILON) {
    entry.syllable.end = null;
  }
  resolveOverlapAfterStartMove(entry.globalIndex);
  afterTimingMutation({ ensureViewTime: entry.syllable.start, skipSelectionUpdate: true });
}

function setSyllableEndById(id, time) {
  const entry = runtime.index.syllableById.get(id);
  if (!entry || !isFiniteNumber(time) || !isFiniteNumber(entry.syllable.start)) {
    return;
  }
  runtime.lastSetEndGesture = null;
  entry.syllable.end = roundTime(clampSyllableEnd(entry.globalIndex, time));
  resolveOverlapAfterEndMove(entry.globalIndex);
  afterTimingMutation({ ensureViewTime: entry.syllable.end, skipSelectionUpdate: true });
}

/**
 * After moving a syllable's start:
 * If the start is now >= the previous syllable's explicit end, clear that end
 * (the previous syllable will use the implicit end = next start).
 */
function resolveOverlapAfterStartMove(globalIndex) {
  if (globalIndex <= 0) return;
  const entry = runtime.index.syllables[globalIndex];
  const prev = runtime.index.syllables[globalIndex - 1];
  if (!entry || !prev) return;
  if (isFiniteNumber(prev.syllable.end) && isFiniteNumber(entry.syllable.start)) {
    if (prev.syllable.end > entry.syllable.start) {
      prev.syllable.end = null;
    }
  }
}

/**
 * After moving a syllable's end:
 * If end >= next syllable's start, clear current end and move next start to
 * just after the drag point (the end becomes implicit via next start).
 */
function resolveOverlapAfterEndMove(globalIndex) {
  const entry = runtime.index.syllables[globalIndex];
  if (!entry || !isFiniteNumber(entry.syllable.end)) return;
  for (let i = globalIndex + 1; i < runtime.index.syllables.length; i++) {
    const next = runtime.index.syllables[i];
    if (!isFiniteNumber(next.syllable.start)) continue;
    if (entry.syllable.end > next.syllable.start) {
      // Move next start to end position, clear current explicit end
      next.syllable.start = roundTime(entry.syllable.end + EPSILON);
      entry.syllable.end = null;
    }
    break;
  }
}

function clearSelectedEnd() {
  const entry = getSelectionEntry();
  if (!entry) {
    return;
  }
  pushUndoSnapshot();
  runtime.lastSetEndGesture = null;
  entry.syllable.end = null;
  afterTimingMutation({ ensureViewTime: entry.syllable.start });
}

function clearSelectedTiming({ movePrev = false } = {}) {
  const entry = getSelectionEntry();
  if (!entry) {
    return;
  }
  pushUndoSnapshot();
  runtime.lastSetEndGesture = null;
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
  pushUndoSnapshot();
  runtime.lastSetEndGesture = null;
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
  // Coalesce rapid nudges: only snapshot when the undo stack is empty or last
  // snapshot's value for this syllable differs meaningfully (>10× nudge step)
  const coalesceThreshold = Math.abs(delta) * 10;
  const lastSnap = runtime.undoStack[runtime.undoStack.length - 1];
  let shouldPush = true;
  if (lastSnap) {
    const lastEntry = flattenSyllables(lastSnap).find(e => e.syllable.id === entry.id || e.id === entry.id);
    // flattenSyllables gives {syllable, id} structure — handle both
    const lastStart = lastEntry?.syllable?.start ?? lastEntry?.start;
    if (isFiniteNumber(lastStart) && Math.abs(lastStart - entry.syllable.start) < coalesceThreshold) {
      shouldPush = false;
    }
  }
  if (shouldPush) pushUndoSnapshot();

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
  const newPitch = isFiniteNumber(value) ? clamp(Math.round(value), 24, 108) : null;
  const oldPitch = entry.syllable.pitch;
  // Only push undo when pitch actually changes (avoids flooding stack on held key)
  if (newPitch !== oldPitch) {
    pushUndoSnapshot();
  }
  if (!isFiniteNumber(value)) {
    entry.syllable.pitch = null;
  } else {
    entry.syllable.pitch = newPitch;
    runtime.selectedPitchGhost = newPitch;
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
  pushUndoSnapshot();
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

  runtime.lastSetEndGesture = null;

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
  rebuildTimingCaches();
  updateSelectedEditor();
  updateSyncStatus();
  resetAudioOverlayState();
  if (isFiniteNumber(ensureViewTime)) {
    ensureTimeInView(ensureViewTime);
  }
  markLyricsDirty();
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
  // setSelectedStartTime will push undo snapshot
  setSelectedStartTime(getCurrentTime());
  if (entry.globalIndex < runtime.index.syllables.length - 1) {
    selectSyllableByIndex(entry.globalIndex + 1, { scroll: true });
  }
}

async function seekToTime(time, { play = null } = {}) {
  const clampedTime = clamp(time, 0, Math.max(getProjectMaxTime(), getAudioDuration()));
  if (play === true) {
    try {
      await playTransport({ seekTime: clampedTime });
    } catch (error) {
      console.warn(error);
    }
  } else if (play === false) {
    pauseTransport({ time: clampedTime });
  } else if (getIsPlaying()) {
    restartTransportPlayback(clampedTime);
  } else {
    setTransportPausedTime(clampedTime);
    resetAudioOverlayState();
    updateTransportUi();
  }
  markLyricsDirty();
  updateLyricsDynamic();
  markDirty();
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
  if (!state.settings.loopSelection || !getIsPlaying()) {
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
  runtime.audioOverlay.lastMetronomeSyncMs = 0;
  stopGuideVoice();
  syncMetronomeTransport(true);
}

async function ensureMetronomeWorklet() {
  if (!runtime.audioContext || runtime.metronomeWorkletFailed) {
    return null;
  }
  if (runtime.metronomeNode) {
    return runtime.metronomeNode;
  }
  if (!runtime.audioContext.audioWorklet) {
    runtime.metronomeWorkletFailed = true;
    return null;
  }
  if (!runtime.metronomeWorkletReady) {
    runtime.metronomeWorkletReady = runtime.audioContext.audioWorklet.addModule('metronome-worklet.js')
      .then(() => {
        const node = new AudioWorkletNode(runtime.audioContext, 'karaoke-metronome-processor', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        node.connect(runtime.metronomeGain);
        runtime.metronomeNode = node;
        syncMetronomeTransport(true);
        return node;
      })
      .catch((error) => {
        console.warn('AudioWorklet unavailable, using metronome fallback.', error);
        runtime.metronomeWorkletFailed = true;
        runtime.metronomeWorkletReady = null;
        return null;
      });
  }
  return runtime.metronomeWorkletReady;
}

function syncMetronomeTransport(force = false) {
  if (!runtime.metronomeNode || !runtime.audioContext) {
    return;
  }
  runtime.metronomeNode.port.postMessage({
    type: 'transport',
    forceResync: force,
    playing: !!state.settings.metronome.enabled && getIsPlaying() && runtime.audioContext.state === 'running',
    bpm: clamp(state.settings.metronome.bpm, 20, 300),
    offset: Number(state.settings.metronome.offset) || 0,
    beatsPerBar: clamp(state.settings.metronome.beatsPerBar, 1, 12),
    playbackRate: Math.max(0.1, state.settings.playbackRate),
    anchorContextTime: getIsPlaying() ? runtime.transport.startContextTime : runtime.audioContext.currentTime,
    anchorAudioTime: getIsPlaying() ? runtime.transport.startOffset : getCurrentTime(),
  });
}

function scheduleMetronomeClicks() {
  const metronomeActive = !!state.settings.metronome.enabled && getIsPlaying();
  if (runtime.metronomeNode) {
    if (!metronomeActive) {
      runtime.audioOverlay.metronomeCursorAudioTime = getCurrentTime();
    }
    return;
  }
  if (!metronomeActive || !runtime.audioContext || runtime.audioContext.state !== 'running') {
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
  gain.gain.linearRampToValueAtTime(accent ? 0.9 : 0.55, when + 0.004);
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
  const entry = getCurrentSoundingEntryAtTime(time);
  return entry && isFiniteNumber(entry.syllable.pitch) ? entry : null;
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
  if (!state.settings.guideSynth.enabled || !getIsPlaying() || !runtime.audioContext || runtime.audioContext.state !== 'running') {
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
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  window.requestAnimationFrame(() => {
    if (anchor.isConnected) {
      anchor.remove();
    }
    URL.revokeObjectURL(url);
  });
}

async function exportProject() {
  updateSaveStatus('Preparing export…');
  const payload = serializeProject();
  if (els.embedAudioInExport.checked && audioBlob) {
    updateSaveStatus('Embedding audio for export…');
    let dataUrl;
    try {
      dataUrl = await blobToDataUrlViaWorker(audioBlob);
    } catch (error) {
      console.warn('Worker export packaging failed, falling back on main thread.', error);
      dataUrl = await blobToDataUrl(audioBlob);
    }
    payload.audio = {
      dataUrl,
      name: state.audioMeta.name,
      type: state.audioMeta.type,
    };
  }
  payload.exportMeta = {
    includesEmbeddedAudio: !!payload.audio,
    syncedStarts: getSyncedCount(),
    totalSyllables: runtime.index.syllables.length,
  };
  const filename = `${sanitizeFilename(state.projectName || state.audioMeta.name || 'karaoke-project')}.json`;
  exportJson(filename, payload);
  updateSaveStatus(`Exported ${filename}${payload.audio ? ' with audio.' : '.'}`);
}

async function importSerializedProject(serialized, { sourceLabel = 'project' } = {}) {
  let importedBlob = null;
  if (serialized.audio?.dataUrl) {
    importedBlob = await dataUrlToBlob(serialized.audio.dataUrl);
    if (serialized.audio.name) {
      importedBlob = new File([importedBlob], serialized.audio.name, {
        type: serialized.audio.type || importedBlob.type || 'audio/*',
      });
    }
  }
  await hydrateProject(serialized, importedBlob, { fromAutosave: false });
  updateSaveStatus(`Imported ${sourceLabel}.`);
}

async function importProjectFile(file) {
  if (!file) {
    return;
  }
  const text = await file.text();
  const parsed = JSON.parse(text);
  await importSerializedProject(parsed, { sourceLabel: file.name });
}

async function importDemoProject() {
  updateSaveStatus('Loading demo project…');
  const response = await fetch('./examples/demo.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load demo project (${response.status}).`);
  }
  const parsed = await response.json();
  await importSerializedProject(parsed, { sourceLabel: 'demo project' });
}

async function hydrateProject(serialized, providedAudioBlob = null, { fromAutosave = false } = {}) {
  runtime.loadingProject = true;
  try {
    const payload = serialized || {};
    const incomingProject = mergeStateDefaults(payload.project || payload);
    const restoreTime = isFiniteNumber(payload.playback?.currentTime) ? payload.playback.currentTime : 0;
    uidCounter = 0;
    state = incomingProject;
    state.settings.keybinds = sanitizeKeybinds(state.settings.keybinds);
    state.settings.ui = sanitizeUiSettings(state.settings.ui);
    state.structure = normalizeStructure(state.structure);
    rebuildIndex();
    renderLyrics();
    syncInputsFromState();
    fitViewToSong();
    if (providedAudioBlob) {
      await loadAudioBlob(providedAudioBlob, { restoreTime: fromAutosave ? restoreTime : 0 });
    } else {
      audioBlob = null;
      revokeCurrentObjectUrl();
      clearTransportBuffer();
      els.audioPlayer.removeAttribute('src');
      els.audioPlayer.load();
      els.audioPlayer.playbackRate = state.settings.playbackRate;
      els.audioPlayer.volume = state.settings.musicVolume;
      refreshAudioMeta();
      resetAudioOverlayState();
    }
    rebuildTimingCaches();
    updateSelectedEditor();
    markLyricsDirty();
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
  clearTransportBuffer();
  els.audioPlayer.removeAttribute('src');
  els.audioPlayer.load();
  resetAudioOverlayState();
  runtime.undoStack = [];
  runtime.lastSetEndGesture = null;
  rebuildIndex();
  markLyricsDirty();
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
    if (!state.settings.selectWithoutSeek) {
      jumpToTarget({ kind: 'syllable', id: syllableId }).catch((error) => console.warn(error));
    }
    return;
  }
  const wordNode = event.target.closest('.lyric-word');
  if (wordNode) {
    const wordId = wordNode.dataset.wordId;
    const firstSyllableId = runtime.index.wordById.get(wordId)?.firstSyllableId;
    if (firstSyllableId) {
      setSelectionSyllableById(firstSyllableId, { practiceKind: 'word', practiceId: wordId, scroll: false });
      if (!state.settings.selectWithoutSeek) {
        jumpToTarget({ kind: 'word', id: wordId }).catch((error) => console.warn(error));
      }
    }
    return;
  }
  const lineButton = event.target.closest('.line-jump');
  if (lineButton) {
    const lineId = lineButton.dataset.lineId;
    const firstSyllableId = runtime.index.lineById.get(lineId)?.firstSyllableId;
    if (firstSyllableId) {
      setSelectionSyllableById(firstSyllableId, { practiceKind: 'line', practiceId: lineId, scroll: false });
      if (!state.settings.selectWithoutSeek) {
        jumpToTarget({ kind: 'line', id: lineId }).catch((error) => console.warn(error));
      }
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
      pushUndoSnapshot();
      runtime.drag = { surface: 'timeline', type: 'start', syllableId: hit.syllableId };
      return;
    }
    if (hit.type === 'end-handle') {
      pushUndoSnapshot();
      runtime.drag = { surface: 'timeline', type: 'end', syllableId: hit.syllableId };
      return;
    }
    if (selectedEntry?.id === entry.id) {
      pushUndoSnapshot();
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
  updateEdgeScrollState(point, 0);
  setPlayheadTimeImmediate(xToTime(point.x, point.width));
}

function getSnapTime(rawTime, excludeSyllableId, width) {
  const snapPx = runtime.snapThreshold;
  const snapSeconds = (snapPx / Math.max(1, width)) * runtime.view.duration;
  const points = runtime.index.snapPoints;
  const pointTimes = runtime.index.snapPointTimes;
  if (!points.length) {
    return rawTime;
  }
  const insertion = upperBound(pointTimes, rawTime);
  let best = rawTime;
  let bestDist = snapSeconds;
  let left = insertion - 1;
  let right = insertion;
  while (left >= 0 || right < points.length) {
    let progressed = false;
    if (left >= 0) {
      const candidate = points[left];
      const dist = Math.abs(candidate.time - rawTime);
      if (dist <= bestDist) {
        progressed = true;
        if (candidate.syllableId !== excludeSyllableId) {
          best = candidate.time;
          bestDist = dist;
        }
        left -= 1;
      }
    }
    if (right < points.length) {
      const candidate = points[right];
      const dist = Math.abs(candidate.time - rawTime);
      if (dist <= bestDist) {
        progressed = true;
        if (candidate.syllableId !== excludeSyllableId) {
          best = candidate.time;
          bestDist = dist;
        }
        right += 1;
      }
    }
    if (!progressed) {
      break;
    }
  }
  return best;
}

function moveTimelineInteraction(event) {
  if (!runtime.drag || runtime.drag.surface !== 'timeline') {
    return;
  }
  const point = getCanvasPoint(event, els.timelineCanvas);
  const rawTime = xToTime(point.x, point.width);
  if (runtime.drag.type === 'scrub') {
    updateEdgeScrollState(point, 0);
    setPlayheadTimeImmediate(rawTime);
    return;
  }
  if (runtime.drag.type === 'start') {
    const snapped = getSnapTime(rawTime, runtime.drag.syllableId, point.width);
    setSyllableStartById(runtime.drag.syllableId, snapped);
    return;
  }
  if (runtime.drag.type === 'end') {
    const snapped = getSnapTime(rawTime, runtime.drag.syllableId, point.width);
    setSyllableEndById(runtime.drag.syllableId, snapped);
    return;
  }
  if (runtime.drag.type === 'move-block') {
    const entry = runtime.index.syllableById.get(runtime.drag.syllableId);
    if (!entry || !isFiniteNumber(runtime.drag.startAtDragStart)) {
      return;
    }
    const delta = rawTime - runtime.drag.originTime;
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
    runtime.edgeScroll.active = false;
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
  updateEdgeScrollState(point, PITCH_GUTTER);
  setPlayheadTimeImmediate(xToTime(point.x, point.width, PITCH_GUTTER));
}

function movePitchInteraction(event) {
  if (!runtime.drag || runtime.drag.surface !== 'pitch') {
    return;
  }
  const point = getCanvasPoint(event, els.pitchCanvas);
  if (runtime.drag.type === 'scrub') {
    updateEdgeScrollState(point, PITCH_GUTTER);
    setPlayheadTimeImmediate(xToTime(point.x, point.width, PITCH_GUTTER));
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
    runtime.edgeScroll.active = false;
    scheduleAutosave();
  }
}

function updateEdgeScrollState(point, gutter = 0) {
  runtime.edgeScroll.active = runtime.view.duration < Math.max(FULL_VIEW_MIN, getProjectMaxTime());
  runtime.edgeScroll.pointerX = point.x;
  runtime.edgeScroll.width = point.width;
  runtime.edgeScroll.gutter = gutter;
  if (!runtime.edgeScroll.active) {
    runtime.edgeScroll.lastTs = 0;
  }
}

function applyEdgeScroll(ts) {
  if (!runtime.drag || runtime.drag.type !== 'scrub' || !runtime.edgeScroll.active) {
    runtime.edgeScroll.lastTs = ts;
    return;
  }

  const { pointerX, width, gutter } = runtime.edgeScroll;
  const usableWidth = Math.max(1, width - gutter);
  const localX = pointerX - gutter;
  const edgeZone = Math.max(24, Math.min(usableWidth * 0.12, 72));

  let direction = 0;
  let intensity = 0;
  if (localX < edgeZone) {
    direction = -1;
    intensity = (edgeZone - localX) / edgeZone;
  } else if (localX > usableWidth - edgeZone) {
    direction = 1;
    intensity = (localX - (usableWidth - edgeZone)) / edgeZone;
  }

  if (!direction || intensity <= 0) {
    runtime.edgeScroll.lastTs = ts;
    return;
  }

  const dt = runtime.edgeScroll.lastTs ? Math.min(64, ts - runtime.edgeScroll.lastTs) / 1000 : 0;
  runtime.edgeScroll.lastTs = ts;
  if (dt <= 0) {
    return;
  }

  const secondsPerSecond = runtime.view.duration * (0.45 + Math.pow(Math.min(1.4, intensity), 1.6) * 4.5);
  const previousStart = runtime.view.start;
  panViewTo(previousStart + direction * secondsPerSecond * dt);

  if (runtime.view.start !== previousStart) {
    const clampedX = clamp(pointerX, gutter, width);
    setPlayheadTimeImmediate(xToTime(clampedX, width, gutter));
  }
}

function onViewWheel(event) {
  event.preventDefault();
  const canvas = event.currentTarget;
  const point = getCanvasPoint(event, canvas);
  const gutter = canvas === els.pitchCanvas ? PITCH_GUTTER : 0;
  const usableWidth = Math.max(1, point.width - gutter);

  if (event.deltaX) {
    const panSeconds = (event.deltaX / usableWidth) * runtime.view.duration;
    panViewTo(runtime.view.start + panSeconds);
  }

  if (event.deltaY) {
    const anchorTime = xToTime(point.x, point.width, gutter);
    const factor = event.deltaY < 0 ? 0.8 : 1.25;
    zoomView(factor, anchorTime);
  }
}

async function togglePlayPause() {
  await ensureAudioContext(true);
  if (getIsPlaying()) {
    pauseTransport();
  } else {
    try {
      await playTransport();
      resetAudioOverlayState();
    } catch (error) {
      console.warn(error);
    }
  }
  updateTransportUi();
}

/* INPUT HOTKEY HANDLING */

const ACTION_HANDLER_BY_ID = {
  tapTiming: () => tapFromSelected(),
  playPause: () => togglePlayPause().catch(console.warn),
  setStart: () => setSelectedStartTime(getCurrentTime()),
  setEnd: () => setSelectedEndTime(getCurrentTime()),
  seekBackward: () => seekToTime(getCurrentTime() - state.settings.seekStep, { play: false }).catch(console.warn),
  seekForward: () => seekToTime(getCurrentTime() + state.settings.seekStep, { play: false }).catch(console.warn),
  nudgeBack: () => nudgeSelectedStart(-state.settings.nudgeStep),
  nudgeForward: () => nudgeSelectedStart(state.settings.nudgeStep),
  clearTiming: () => clearSelectedTiming({ movePrev: false }),
  clearOrPitch: (event) => {
    if (runtime.focusRegion === 'pitch') return clearSelectedPitch();
    if (event.shiftKey) return clearTimingsFromSelectedForward();
    clearSelectedTiming({ movePrev: true });
  },
  selectSounding: () => {
    const soundingEntry = getCurrentSoundingEntry();
    if (soundingEntry) {
      setSelectionSyllableById(soundingEntry.id, { scroll: true, ensureView: true });
    }
  },
  jump: () => runJumpAction(),
  pitchUp: (event) => adjustSelectedPitch(event.shiftKey ? 12 : 1),
  pitchDown: (event) => adjustSelectedPitch(event.shiftKey ? -12 : -1),
  selectBack: () => selectSyllableByIndex((getSelectionEntry()?.globalIndex ?? 0) - 1, { scroll: true }),
  selectForward: () => selectSyllableByIndex((getSelectionEntry()?.globalIndex ?? 0) + 1, { scroll: true }),
};

function keyTokenFromEvent(event) {
  if (event.code === 'Space') {
    return 'space';
  }
  return normalizeKeyToken(event.key);
}

function isEditableTarget(target) {
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
    || target.isContentEditable;
}

function handleKeydown(event) {
  if (isEditableTarget(event.target)) return;

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    performUndo();
    return;
  }

  if (event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }

  const token = keyTokenFromEvent(event);
  if (!token) {
    return;
  }
  const actionId = runtime.keyActionLookup.get(token);
  const action = ACTION_HANDLER_BY_ID[actionId];
  if (action) {
    event.preventDefault();
    action(event, state);
  }
}

function attachEventListeners() {
  els.projectName.addEventListener('input', () => {
    state.projectName = els.projectName.value;
    updateMediaSession();
    updateTitleFromMeta();
    scheduleAutosave();
  });

  els.audioFileInput.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) {
      loadAudioBlob(file).catch((error) => console.warn(error));
    }
    event.target.value = '';
  });

  if (els.importProjectBtn) {
    els.importProjectBtn.addEventListener('click', () => {
      els.importProjectInput?.click();
    });
  }

  if (els.importProjectMenuBtn) {
    els.importProjectMenuBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      const isHidden = els.importProjectMenu?.hidden !== false;
      if (els.importProjectMenu) {
        els.importProjectMenu.hidden = !isHidden;
      }
      els.importProjectMenuBtn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
    });
  }

  document.addEventListener('click', (event) => {
    if (!els.importProjectMenu || !els.importProjectMenuBtn) {
      return;
    }
    if (event.target.closest('#importProjectSplit')) {
      return;
    }
    els.importProjectMenu.hidden = true;
    els.importProjectMenuBtn.setAttribute('aria-expanded', 'false');
  });

  els.importProjectInput.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    if (!confirmDestructiveAction('Import project? This replaces the current project.')) {
      event.target.value = '';
      return;
    }
    importProjectFile(file).catch((error) => console.warn(error));
    event.target.value = '';
  });

  els.importDemoProjectBtn.addEventListener('click', () => {
    if (els.importProjectMenu) {
      els.importProjectMenu.hidden = true;
    }
    if (els.importProjectMenuBtn) {
      els.importProjectMenuBtn.setAttribute('aria-expanded', 'false');
    }
    if (!confirmDestructiveAction('Import demo project? This replaces the current project.')) {
      return;
    }
    importDemoProject().catch((error) => console.warn(error));
  });

  els.exportProjectBtn.addEventListener('click', () => {
    exportProject().catch((error) => console.warn(error));
  });

  els.clearProjectBtn.addEventListener('click', () => {
    if (confirmDestructiveAction('Reset project? This clears the current project and local autosave.')) {
      resetProject().catch((error) => console.warn(error));
    }
  });

  els.audioPlayer.addEventListener('loadedmetadata', () => {
    if (isFiniteNumber(els.audioPlayer.duration)) {
      state.audioMeta.duration = els.audioPlayer.duration;
      rebuildTimingCaches();
      markLyricsDirty();
      refreshAudioMeta();
      updateTransportUi();
      fitViewToSong();
      scheduleAutosave();
    }
  });

  // Playback now runs through Web Audio so the song, guide tone, and metronome share one clock.

  els.playPauseBtn.addEventListener('click', () => togglePlayPause().catch((error) => console.warn(error)));
  els.rewindBtn.addEventListener('click', () => seekToTime(getCurrentTime() - state.settings.seekStep, { play: false }).catch((error) => console.warn(error)));
  els.forwardBtn.addEventListener('click', () => seekToTime(getCurrentTime() + state.settings.seekStep, { play: false }).catch((error) => console.warn(error)));
  els.jumpToSelectionBtn.addEventListener('click', () => runJumpAction());
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
    if (getIsPlaying()) {
      restartTransportPlayback(getCurrentTime());
    } else {
      setTransportPausedTime(getCurrentTime());
      syncMetronomeTransport(true);
    }
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
    applyAudioContextSettings();
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

  if (els.autoScrollWindow) {
    els.autoScrollWindow.addEventListener('change', () => {
      state.settings.autoScrollWindow = els.autoScrollWindow.checked;
      scheduleAutosave();
    });
  }

  els.scrubInput.addEventListener('input', () => {
    seekToTime(Number(els.scrubInput.value), { play: false }).catch((error) => console.warn(error));
  });

  els.buildLyricsBtn.addEventListener('click', () => {
    const hasExistingLyrics = state.structure.length > 0 || !!state.lyricsMarkup.trim();
    if (hasExistingLyrics && !confirmDestructiveAction('Build lyrics from source? This replaces existing lyrics and cannot be undone.')) {
      return;
    }
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
    ensureAudioContext(false)
      .then(() => ensureMetronomeWorklet())
      .then(() => syncMetronomeTransport(true))
      .catch((error) => console.warn(error));
    resetAudioOverlayState();
    invalidateRenderCaches('timeline', 'pitch');
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
    invalidateRenderCaches('pitch');
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

  // Undo button
  if (els.undoBtn) {
    els.undoBtn.addEventListener('click', () => performUndo());
  }

  // Follow sounding checkbox
  if (els.followSoundingCheckbox) {
    els.followSoundingCheckbox.addEventListener('change', () => {
      state.settings.followSounding = els.followSoundingCheckbox.checked;
      // Reset tracker so enabling mid-playback immediately snaps to sounding syllable
      runtime.lastFollowSoundingId = null;
      scheduleAutosave();
    });
  }

  // Select without seek checkbox
  if (els.selectWithoutSeekCheckbox) {
    els.selectWithoutSeekCheckbox.addEventListener('change', () => {
      state.settings.selectWithoutSeek = els.selectWithoutSeekCheckbox.checked;
      scheduleAutosave();
    });
  }


  document.querySelectorAll('details.panel[data-panel-id]').forEach((panel) => {
    panel.addEventListener('toggle', () => {
      state.settings.ui = sanitizeUiSettings(state.settings.ui);
      state.settings.ui.collapsedPanels[panel.dataset.panelId] = !panel.open;
      scheduleAutosave();
    });
  });

  document.querySelectorAll('.main-section[data-section-id] .section-bar--clickable').forEach((bar) => {
    bar.addEventListener('click', () => {
      const section = bar.closest('.main-section');
      if (!section) {
        return;
      }
      queueMicrotask(() => {
        state.settings.ui = sanitizeUiSettings(state.settings.ui);
        state.settings.ui.collapsedSections[section.dataset.sectionId] = !section.classList.contains('is-open');
        scheduleAutosave();
      });
    });
  });

  runtime.resizeObserver = new ResizeObserver(() => {
    invalidateRenderCaches();
  });
  runtime.resizeObserver.observe(els.timelineCanvas);
  runtime.resizeObserver.observe(els.overviewCanvas);
  runtime.resizeObserver.observe(els.pitchCanvas);
}

// ════════════════════════════════════════════
// MEDIA SESSION API + ID3 METADATA
// ════════════════════════════════════════════

// Cached parsed metadata from the audio file
let parsedAudioMeta = null;

async function parseAudioFileMeta(blob) {
  parsedAudioMeta = null;
  if (!blob) return;

  // Try jsmediatags (loaded via CDN on demand)
  try {
    await ensureJsMediaTags();
    parsedAudioMeta = await new Promise((resolve) => {
      window.jsmediatags.read(blob, {
        onSuccess: (tag) => resolve(tag.tags || {}),
        onError: () => resolve({}),
      });
    });
  } catch {
    parsedAudioMeta = {};
  }

  updateMediaSession();
  updateTitleFromMeta();
}

function ensureJsMediaTags() {
  if (window.jsmediatags) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jsmediatags/3.9.5/jsmediatags.min.js';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function getMetaTitle() {
  const t = parsedAudioMeta?.title;
  if (t) return t;
  // Fall back to projectName or audio filename (strip extension)
  return state.projectName || (state.audioMeta.name || '').replace(/\.[^.]+$/, '') || 'Karaoke project';
}

function getMetaArtist() {
  return parsedAudioMeta?.artist || parsedAudioMeta?.TPE1 || '';
}

function getMetaAlbum() {
  return parsedAudioMeta?.album || '';
}

function getMetaArtworkUrl() {
  const pic = parsedAudioMeta?.picture;
  if (!pic || !pic.data) return null;
  try {
    const bytes = new Uint8Array(pic.data);
    const blob = new Blob([bytes], { type: pic.format || 'image/jpeg' });
    if (runtime.artworkObjectUrl) URL.revokeObjectURL(runtime.artworkObjectUrl);
    runtime.artworkObjectUrl = URL.createObjectURL(blob);
    return runtime.artworkObjectUrl;
  } catch {
    return null;
  }
}

function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;

  const artworkUrl = getMetaArtworkUrl();
  const artwork = artworkUrl
    ? [{ src: artworkUrl, sizes: '512x512', type: 'image/jpeg' }]
    : [];

  navigator.mediaSession.metadata = new MediaMetadata({
    title: getMetaTitle(),
    artist: getMetaArtist(),
    album: getMetaAlbum(),
    artwork,
  });

  const duration = getAudioDuration();

  navigator.mediaSession.setActionHandler('play', () => {
    playTransport().catch(console.warn);
  });
  navigator.mediaSession.setActionHandler('pause', () => {
    pauseTransport();
  });
  navigator.mediaSession.setActionHandler('seekbackward', (details) => {
    const step = details.seekOffset ?? state.settings.seekStep;
    seekToTime(getCurrentTime() - step, { play: null }).catch(console.warn);
  });
  navigator.mediaSession.setActionHandler('seekforward', (details) => {
    const step = details.seekOffset ?? state.settings.seekStep;
    seekToTime(getCurrentTime() + step, { play: null }).catch(console.warn);
  });
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    seekToTime(details.seekTime, { play: getIsPlaying() ? null : false }).catch(console.warn);
  });
  navigator.mediaSession.setActionHandler('previoustrack', () => {
    seekToTime(0, { play: null }).catch(console.warn);
  });
  navigator.mediaSession.setActionHandler('nexttrack', null);
}

function updateMediaSessionPosition() {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  const duration = getAudioDuration();
  if (!duration || !isFiniteNumber(duration) || duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({
      duration,
      playbackRate: state.settings.playbackRate,
      position: clamp(getCurrentTime(), 0, duration),
    });
  } catch {
    // setPositionState throws if duration isn't ready yet — ignore
  }
}

function updateTitleFromMeta() {
  // Auto-fill project name from ID3 if still blank
  if (!state.projectName && parsedAudioMeta?.title) {
    const parts = [parsedAudioMeta.artist, parsedAudioMeta.title].filter(Boolean);
    state.projectName = parts.join(' — ');
    els.projectName.value = state.projectName;
    scheduleAutosave();
  }
  // Update browser tab title
  const name = getMetaTitle();
  document.title = name ? `${name} · Syllable KS` : 'Syllable Karaoke Studio';
}

function applyPlayheadWindowAutoscroll() {
  if (!state.settings.autoScrollWindow || !getIsPlaying()) {
    return;
  }
  const fullDuration = Math.max(FULL_VIEW_MIN, getProjectMaxTime());
  if (runtime.view.duration >= fullDuration) {
    return;
  }
  const currentTime = getCurrentTime();
  const viewEnd = runtime.view.start + runtime.view.duration;
  if (currentTime >= viewEnd - EPSILON) {
    const nextStart = clamp(currentTime, 0, Math.max(0, fullDuration - runtime.view.duration));
    if (nextStart !== runtime.view.start) {
      runtime.view.start = nextStart;
      clampView();
      markDirty();
    }
  }
}

function animate(ts) {
  applyEdgeScroll(ts);
  applyPlayheadWindowAutoscroll();
  applyLooping();
  scheduleMetronomeClicks();
  updateGuideVoice();
  updateTransportUi();
  updateLyricsDynamic();
  updateMediaSessionPosition();
  const currentTime = getCurrentTime();
  const isPlaying = getIsPlaying();
  const timeAdvanced = runtime.lastDrawnTime === null || Math.abs(currentTime - runtime.lastDrawnTime) > 1 / 240;
  const needsInteractiveRedraw = Boolean(runtime.drawDirty || runtime.drag);
  if (needsInteractiveRedraw) {
    drawTimeline({ rebuildHitboxes: true });
    drawOverview();
    drawPitchGuide({ rebuildHitboxes: true });
    runtime.drawDirty = false;
    runtime.lastDrawnTime = currentTime;
  } else if (isPlaying && timeAdvanced) {
    drawTimeline({ rebuildHitboxes: false });
    drawOverview();
    drawPitchGuide({ rebuildHitboxes: false });
    runtime.lastDrawnTime = currentTime;
  }
  requestAnimationFrame(animate);
}

async function init() {
  rebuildIndex();
  fitViewToSong();
  syncInputsFromState();
  renderLyrics();
  setupStickyTransportOffset();
  attachEventListeners();
  await loadAutosave();
  updateTransportUi();
  setFocusRegion('timing');
  updateMediaSession();
  updateTitleFromMeta();
  updateUndoButton();
  markDirty();
  requestAnimationFrame(animate);
}

init().catch((error) => {
  console.error(error);
  updateSaveStatus('App failed to initialize.');
});