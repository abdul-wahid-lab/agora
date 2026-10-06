// Shared by the voice-message recorder and the chat-bubble player - turns
// real audio samples into a fixed-length array of 0..1 peak values a
// <WaveformBars> can render as bars, instead of decorative random heights.
// Real waveforms, not fake ones: this project's pattern throughout this
// session has been to verify things actually work, not just look like they
// might - a waveform that doesn't reflect the real recording would be the
// one place in this feature that's quietly fake.
const BUCKET_COUNT = 27;

export async function decodeAudioPeaks(arrayBuffer, bucketCount = BUCKET_COUNT) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const channel = audioBuffer.getChannelData(0);
    const bucketSize = Math.max(1, Math.floor(channel.length / bucketCount));
    const peaks = [];
    for (let i = 0; i < bucketCount; i++) {
      const start = i * bucketSize;
      const end = Math.min(channel.length, start + bucketSize);
      let max = 0;
      for (let j = start; j < end; j++) {
        const v = Math.abs(channel[j]);
        if (v > max) max = v;
      }
      peaks.push(max);
    }
    const loudest = Math.max(...peaks, 0.01);
    return { peaks: peaks.map((p) => Math.min(1, p / loudest)), duration: audioBuffer.duration };
  } finally {
    ctx.close().catch(() => {});
  }
}

// A live recording's amplitude sampler - polls an AnalyserNode on the
// microphone stream itself (not the eventual encoded file, which doesn't
// exist until the recording stops) via requestAnimationFrame, keeping a
// rolling window of the most recent bucketCount samples so the bar chart
// visibly scrolls as it fills, the same live-meter feeling the design
// reference's 9.1 screen shows.
export function createLiveAmplitudeSampler(stream, bucketCount, onSample) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  const samples = [];
  let rafId = null;

  function tick() {
    analyser.getByteTimeDomainData(data);
    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sumSquares += v * v;
    }
    const rms = Math.sqrt(sumSquares / data.length);
    samples.push(Math.min(1, rms * 4));
    if (samples.length > bucketCount) samples.shift();
    onSample(samples.slice());
    rafId = requestAnimationFrame(tick);
  }
  tick();

  return function stop() {
    if (rafId != null) cancelAnimationFrame(rafId);
    source.disconnect();
    ctx.close().catch(() => {});
  };
}

export { BUCKET_COUNT };
