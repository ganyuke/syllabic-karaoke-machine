class KaraokeMetronomeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.playing = false;
    this.bpm = 96;
    this.offset = 0;
    this.beatsPerBar = 4;
    this.playbackRate = 1;
    this.anchorContextTime = 0;
    this.anchorAudioTime = 0;
    this.nextBeatIndex = null;
    this.pulses = [];

    this.port.onmessage = (event) => {
      const data = event.data || {};
      if (data.type !== 'transport') {
        return;
      }
      const needsReset = !!data.forceResync
        || this.playing !== !!data.playing
        || this.bpm !== data.bpm
        || this.offset !== data.offset
        || this.beatsPerBar !== data.beatsPerBar
        || this.playbackRate !== data.playbackRate;

      this.playing = !!data.playing;
      this.bpm = data.bpm || 96;
      this.offset = data.offset || 0;
      this.beatsPerBar = Math.max(1, data.beatsPerBar || 4);
      this.playbackRate = Math.max(0.1, data.playbackRate || 1);
      this.anchorContextTime = data.anchorContextTime || 0;
      this.anchorAudioTime = data.anchorAudioTime || 0;

      if (!this.playing || needsReset) {
        this.nextBeatIndex = null;
        this.pulses = [];
      }
    };
  }

  get interval() {
    return 60 / Math.max(20, Math.min(300, this.bpm || 96));
  }

  contextTimeForAudioTime(audioTime) {
    return this.anchorContextTime + ((audioTime - this.anchorAudioTime) / this.playbackRate);
  }

  ensureBeatCursor(blockAudioStart) {
    if (this.nextBeatIndex !== null) {
      return;
    }
    let beatIndex = Math.ceil((blockAudioStart - this.offset) / this.interval);
    if (blockAudioStart <= this.offset) {
      beatIndex = 0;
    }
    this.nextBeatIndex = beatIndex;
  }

  scheduleBlock(blockStartTime, frameCount) {
    const blockEndTime = blockStartTime + (frameCount / sampleRate);
    const blockAudioStart = this.anchorAudioTime + ((blockStartTime - this.anchorContextTime) * this.playbackRate);
    const blockAudioEnd = this.anchorAudioTime + ((blockEndTime - this.anchorContextTime) * this.playbackRate);
    this.ensureBeatCursor(blockAudioStart);

    while (this.nextBeatIndex !== null) {
      const beatAudioTime = this.offset + (this.nextBeatIndex * this.interval);
      if (beatAudioTime > blockAudioEnd + 1e-6) {
        break;
      }
      if (beatAudioTime >= blockAudioStart - 1e-6) {
        const beatContextTime = this.contextTimeForAudioTime(beatAudioTime);
        const frame = Math.max(0, Math.round((beatContextTime - blockStartTime) * sampleRate));
        this.pulses.push({
          frame,
          phase: 0,
          accent: ((this.nextBeatIndex % this.beatsPerBar) + this.beatsPerBar) % this.beatsPerBar === 0,
        });
      }
      this.nextBeatIndex += 1;
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || !output.length) {
      return true;
    }

    const channel = output[0];
    channel.fill(0);

    if (!this.playing) {
      this.pulses = [];
      return true;
    }

    this.scheduleBlock(currentTime, channel.length);

    const remaining = [];
    for (const pulse of this.pulses) {
      const frequency = pulse.accent ? 1760 : 1320;
      const amplitude = pulse.accent ? 0.9 : 0.55;
      const durationFrames = Math.floor(sampleRate * 0.08);
      for (let i = Math.max(0, pulse.frame); i < channel.length && pulse.phase < durationFrames; i += 1) {
        const t = pulse.phase / sampleRate;
        const env = Math.exp(-t * 70);
        channel[i] += Math.sin(2 * Math.PI * frequency * t) * env * amplitude;
        pulse.phase += 1;
      }
      if (pulse.phase < durationFrames) {
        pulse.frame = 0;
        remaining.push(pulse);
      }
    }
    this.pulses = remaining;
    return true;
  }
}

registerProcessor('karaoke-metronome-processor', KaraokeMetronomeProcessor);
