function buildWaveformLevels(peaks) {
  const baseCount = Math.min(peaks.min.length, peaks.max.length);
  if (!baseCount) {
    return [];
  }
  const levels = [];
  let current = {
    min: peaks.min,
    max: peaks.max,
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
    current = {
      min: nextMin,
      max: nextMax,
      stride: current.stride * 2,
    };
    levels.push(current);
  }
  return levels;
}

function computeWaveformPeaks(channels, length, duration) {
  const channelCount = channels.length;
  const safeDuration = Math.max(duration || 0, 1);
  const targetSamples = Math.max(4000, Math.min(48000, Math.round(safeDuration * 120)));
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
      const data = channels[channel];
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

self.onmessage = (event) => {
  const data = event.data || {};

  try {
    if (data.type === 'blob-to-data-url') {
      const reader = new FileReaderSync();
      const dataUrl = reader.readAsDataURL(data.blob);
      self.postMessage({ id: data.id, ok: true, dataUrl });
      return;
    }

    if (data.type !== 'analyze-waveform') {
      return;
    }

    const channels = (data.channels || []).map((buffer) => new Float32Array(buffer));
    const peaks = computeWaveformPeaks(channels, data.length || 0, data.duration || 0);
    const levels = buildWaveformLevels(peaks);
    const transfer = [];
    const seenBuffers = new Set();
    const addTransfer = (buffer) => {
      if (!buffer || seenBuffers.has(buffer)) {
        return;
      }
      seenBuffers.add(buffer);
      transfer.push(buffer);
    };
    addTransfer(peaks.min.buffer);
    addTransfer(peaks.max.buffer);
    const serializedLevels = levels.map((level) => {
      addTransfer(level.min.buffer);
      addTransfer(level.max.buffer);
      return {
        stride: level.stride,
        min: level.min.buffer,
        max: level.max.buffer,
      };
    });

    self.postMessage({
      id: data.id,
      ok: true,
      peaks: {
        min: peaks.min.buffer,
        max: peaks.max.buffer,
      },
      levels: serializedLevels,
    }, transfer);
  } catch (error) {
    self.postMessage({
      id: data.id,
      ok: false,
      error: error && error.message ? error.message : String(error),
    });
  }
};
