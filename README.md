# Syllable Karaoke Studio

A local-first browser app for syncing lyrics to audio, down to the syllable.

Try it out here: https://ganyuke.github.io/syllabic-karaoke-machine/

You can listen to a cool demo that I spent an hour or two timing by opening up the dropdown beside the "Import" butotn at the top.

<img width="1280" height="619" alt="syllableui" src="https://github.com/user-attachments/assets/c39829fa-b14d-45ac-a302-9f5d4b02e20a" />

## Features

- A waveform for scrubbing through and visualizing syllable placement across the song.
- A karaoke-like visualization of the length of time that a syllable should be drawn out.
- A pitch roll with user-defined pitches for guiding how each syllable should be sung (with built-in pitch tones).
- A metronome to get a sense of the timing of a song's vocals.

## Running it

You can open `index.html` in a browser. Or access the version hosted on [Github Pages](https://ganyuke.github.io/syllabic-karaoke-machine/).

## Workflow

1. Load an audio file.
2. Paste lyrics.
3. Choose preprocessing options:
   - `Manual markup` for arbitrary languages where you type syllable separators yourself.
   - `Auto Japanese` for kana / romaji splitting.
4. Click **Build**.
5. Select the syllable where you want to begin.
6. Press **Play**.
7. Use **Tap → next** while listening to sync a syllable to that instant.
8. Use **→ end** when a syllable should stop sounding before the next syllable starts.
9. Fine-tune by dragging the selected timing block in the waveform timeline, dragging its start/end handles, or using the numeric Start/End fields.
10. Add pitch values in the selected editor or drag note blocks up and down in the pitch roll.
11. Export the project to save it to your disk.

## Controls

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
- `Enter`, `K`: tap selected start and move to next syllable (you can also use `x`, `z`!)
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

You can still use manually markup if you so choose in this mode. You cannot currently indicate to keep arbitrary syllables together.
