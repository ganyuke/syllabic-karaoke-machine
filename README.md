# Syllable Karaoke Studio

A local-first browser app for syncing lyrics to audio at syllable granularity.

## What changed in this version

- Explicit **start** and **end** timing per syllable.
- A denser UI with the important sync controls pinned near the top.
- `Tap start → next` now always starts from the **currently selected syllable** and moves forward one syllable at a time.
- Better hotkeys, including **Backspace** for fast correction.
- A zoomable waveform timeline with a draggable playhead and a draggable overview viewport.
- A shared time view for the waveform and the pitch roll.
- A working audible metronome that runs while the song plays.
- Heuristic **Auto Japanese** splitting for kana and romaji.
- Toggleable preprocessing exclusions for blank lines and section labels like `[Chorus]`.
- Draggable pitch blocks in the piano roll, plus a ghost block for the selected syllable when timing exists but pitch is unset.

## Running it

You can usually open `index.html` directly in a browser, but a tiny local server is more reliable.

```bash
cd karaoke-lyric-lab
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Recommended workflow

1. Load an audio file.
2. Paste lyrics.
3. Choose preprocessing options:
   - `Manual markup` for arbitrary languages where you type syllable separators yourself.
   - `Auto Japanese` for kana / romaji splitting.
4. Click **Build**.
5. Select the syllable where you want to begin.
6. Press **Play**.
7. Use **Tap start → next** while listening.
8. Use **End @ playhead** when a syllable should stop sounding before the next syllable starts.
9. Fine-tune by dragging the selected timing block in the waveform timeline, dragging its start/end handles, or using the numeric Start/End fields.
10. Add pitch values in the selected editor or drag note blocks up and down in the pitch roll.
11. Export the project when you want a portable copy.

## Important controls

### Timing

- **Start @ playhead**: set the selected syllable start to the current playhead.
- **End @ playhead**: set the selected syllable end to the current playhead.
- **Tap start → next**: stamp the selected syllable start, then advance to the next syllable.
- **Clear timing**: clear the selected start/end.
- **Clear → end**: clear the selected syllable and every later syllable timing.
- **Use next start for end**: remove the explicit end so the syllable stretches until the next start.

### Timeline

- Mouse wheel on the waveform or pitch roll: zoom horizontally.
- Drag in the waveform: scrub the playhead.
- Drag the selected timing block: move it.
- Drag the selected block handles: edit start/end.
- Drag the overview viewport below the waveform: pan when zoomed in.

### Pitch roll

- Click a note block: select that syllable.
- Drag a note block up/down: change pitch.
- If the selected syllable has timing but no pitch, a dashed ghost block appears so you can place it quickly.
- **Guide synth** plays a lightweight pitch reference while the song runs.

## Hotkeys

- `Space`: play / pause
- `Enter` or `K`: tap selected start and move to next syllable
- `S`: set selected start at the playhead
- `E`: set selected end at the playhead
- `[` or `ArrowLeft`: previous syllable
- `]` or `ArrowRight`: next syllable
- `J` / `L`: seek backward / forward by the current seek step
- `,` / `.`: nudge selected start earlier / later by the current nudge step
- `Delete`: clear selected timing
- `Backspace`: clear selected timing and move to the previous syllable in **Timing keys** mode, or clear pitch in **Pitch keys** mode
- `Shift+Backspace`: clear selected timing and all following timings
- `ArrowUp` / `ArrowDown`: raise / lower pitch by one semitone
- `Shift+ArrowUp` / `Shift+ArrowDown`: raise / lower pitch by an octave

The keyboard mode pill in the top bar shows which set of destructive keys is active. Click the waveform or lyrics to return to **Timing keys** mode. Click the pitch roll to switch to **Pitch keys** mode.

## Preprocessing notes

### Manual markup

Use spaces between words and separators like `-`, `·`, `•`, `/`, or `・` inside a word.

Example:

```text
ka-ra-o-ke ga su-ki
```

### Auto Japanese

This mode uses simple heuristics:

- kana are split into mora-like units,
- small kana like `ゃ` / `ュ` are attached to the preceding kana,
- `ー` is attached to the preceding kana,
- romaji are split into Japanese-style chunks like `ko-ko-ro`, `shin-ji-te`, `tto`, `ryo`, `kou`.

It is meant to be practical, not perfect. If the automatic split is not what you want, switch back to manual markup.

## Design choices in this build

- **Single-page, no-build app**: plain HTML/CSS/JS for easy local use and editing.
- **Explicit syllable ends**: gaps and held notes are now distinct in the data model.
- **Shared zoom model**: waveform and pitch roll always show the same visible time window.
- **Heuristic Japanese splitter instead of language-wide NLP**: keeps the app offline and simple.
- **Lightweight synth guide instead of a sampled soundfont**: avoids external assets while still giving audible pitch reference.
- **Waveform + overview instead of a full spectrogram**: this keeps the app responsive while still giving practical fine-timing controls.

## Limitations

- The Japanese auto-splitter is heuristic and may need manual correction.
- The pitch guide is manual; it does not detect sung pitch automatically.
- The guide synth is a simple Web Audio tone, not a sampled instrument.
- Exporting with embedded audio can create a large JSON file.
