/** Upmix mono consistently, then apply independent physical left/right gains. */
export function recordingSourceMix(
  context: BaseAudioContext,
  sources: Partial<Record<'system' | 'microphone', AudioNode>>,
  destination: AudioNode,
) {
  const gains = Object.entries(sources).map(([key, source]) => {
    const gain = context.createGain();
    source.connect(gain);
    gain.connect(destination);
    return { key: key as 'system' | 'microphone', source, gain };
  });
  return {
    set(system: number, microphone: number) {
      if (![system, microphone].every((v) => Number.isFinite(v) && v >= 0 && v <= 2))
        throw Error('声源音量无效');
      for (const { key, gain } of gains)
        gain.gain.setValueAtTime(key === 'system' ? system : microphone, context.currentTime);
    },
    dispose() {
      for (const { source, gain } of gains) {
        source.disconnect(gain);
        gain.disconnect();
      }
    },
  };
}
export function recordingStereo(
  context: BaseAudioContext,
  source: AudioNode,
  destination: AudioNode,
) {
  const stereo = context.createGain(),
    splitter = context.createChannelSplitter(2),
    left = context.createGain(),
    right = context.createGain(),
    merge = context.createChannelMerger(2);
  stereo.channelCount = 2;
  stereo.channelCountMode = 'explicit';
  stereo.channelInterpretation = 'speakers';
  source.connect(stereo);
  stereo.connect(splitter);
  splitter.connect(left, 0);
  splitter.connect(right, 1);
  left.connect(merge, 0, 0);
  right.connect(merge, 0, 1);
  merge.connect(destination);
  return {
    set(l: number, r: number) {
      if (![l, r].every((n) => Number.isFinite(n) && n >= 0 && n <= 2)) throw Error('声道音量无效');
      left.gain.setValueAtTime(l, context.currentTime);
      right.gain.setValueAtTime(r, context.currentTime);
    },
    dispose() {
      source.disconnect(stereo);
      for (const node of [stereo, splitter, left, right, merge]) node.disconnect();
    },
  };
}
