# Syllable Karaoke Studio, desktop edition

The same editor as the browser version, as a native app. Playback, the metronome and the guide synth all run on one audio clock, so the playhead stays locked to what you hear. The waveform, timeline, pitch roll and lyrics are drawn on the GPU.

Projects move both ways. Export from either version and import into the other.

## Building

Install Rust, then from this folder:

```text
cargo run --release
```

On Linux you also need the ALSA development files (`libasound2-dev` on Debian and Ubuntu, `alsa-lib-devel` on Fedora). Without a C toolchain, run `./build-with-podman.sh` and use the binary it puts in `dist/`.

## Opening files

- Run with no arguments to pick up where you left off, including the audio and the playhead position. Audio that came inside an imported project is kept in the app's data folder for this.
- Pass a project file, an audio file, or both: `syllabic-karaoke-machine demo.json`.
- Use **Open audio**, **Import project** and **Export project** at the top. Tick **Include audio in export** to bundle the song into the project file.

## Workflow

1. Open an audio file.
2. Paste lyrics and choose **Manual markup** or **Auto Japanese**.
3. Press **Build**.
4. Select the syllable to begin with and press **Play**.
5. Press `Enter` (or `K`) on each syllable to stamp its start and move to the next one.
6. Press `E` where a syllable should stop before the next one starts.
7. Fine-tune by dragging blocks and their edges on the timeline, or type exact times in the editor row.
8. Drag notes up and down in the pitch roll to give syllables a pitch.

## Layout

Click the heading of Waveform, Lyrics or Pitch roll to fold it away, and do the same for each group in the side panel. Folded groups are remembered in the project. The top bar shows when the running copy was built.

## Mouse

- Drag on the timeline or pitch roll to move the playhead. Dragging near an edge scrolls. Holding still keeps playing from where you pressed.
- Mouse wheel zooms around the pointer. Horizontal scrolling pans.
- Drag the selected block to move it, or drag its edges to change start and end. Edges snap to neighbouring syllables.
- Drag the highlighted area in the strip under the timeline to pan.
- Click a syllable in the lyrics to select it and jump there. Shift-click selects its word. The number beside a line jumps to that line.

## Keys

The defaults match the browser version, and every key can be changed under **Keys** in the side panel.

- `Space`: play or pause
- `Enter`, `K`, `Z`, `X`: stamp start and move to the next syllable
- `S` and `E`: set start or end at the playhead
- `[` and `]`, or the left and right arrows: previous and next syllable
- `J` and `L`: seek backward and forward
- `,` and `.`: nudge the start earlier or later
- `Delete`: clear timing
- `Backspace`: clear timing and step back, or clear pitch while working in the pitch roll
- `Shift+Backspace`: clear this and all later timing
- `Up` and `Down`: raise or lower pitch by a semitone, or an octave with `Shift`
- `A`: select the syllable being sung
- `G`: jump to the selection
- `Ctrl+Z`: undo
