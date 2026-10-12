export interface AudioDevice {
  id: string;
  name: string;
  kind: 'system' | 'microphone';
}
export interface AudioCapabilities {
  devices: AudioDevice[];
  bitrates: number[];
  rate: 48000;
  channels: 2;
}
export interface AudioProgress {
  kind: 'progress';
  samples: number;
  bytes: number;
  paused: boolean;
  system: number;
  microphone: number;
  mixed: number;
  clipped: boolean;
}
export interface AudioResult {
  kind: 'done';
  samples: number;
  bytes: number;
  warning: string;
  discontinuities: number;
  late: number;
}
export interface AudioDraft {
  id: string;
  createdAt: number;
  format: 'wav' | 'm4a';
  samples: number;
  bytes: number;
  systemAudio: boolean;
  microphone: boolean;
}
export function audioCapabilities(value: unknown): AudioCapabilities {
  const v = value as AudioCapabilities;
  if (
    !v ||
    v.rate !== 48000 ||
    v.channels !== 2 ||
    !Array.isArray(v.devices) ||
    v.devices.length > 256 ||
    !Array.isArray(v.bitrates) ||
    v.bitrates.some((b) => ![96000, 128000, 160000, 192000].includes(b))
  )
    throw Error('声音设备响应无效');
  const ids = new Set<string>();
  for (const d of v.devices) {
    if (
      !d ||
      !['system', 'microphone'].includes(d.kind) ||
      typeof d.id !== 'string' ||
      !d.id ||
      d.id.length > 1000 ||
      /[\x00-\x1f]/.test(d.id) ||
      ids.has(d.id) ||
      typeof d.name !== 'string' ||
      !d.name ||
      d.name.length > 1000
    )
      throw Error('声音设备响应无效');
    ids.add(d.id);
  }
  return structuredClone(v);
}
export function audioEvent(value: unknown): AudioProgress | AudioResult {
  const v = value as AudioProgress | AudioResult;
  if (
    !v ||
    !['progress', 'done'].includes(v.kind) ||
    !Number.isSafeInteger(v.samples) ||
    v.samples < 0 ||
    v.samples > 48000 * 3600 ||
    !Number.isSafeInteger(v.bytes) ||
    v.bytes < 0 ||
    v.bytes > 1024 ** 3
  )
    throw Error('录音状态响应无效');
  if (v.kind === 'progress') {
    if (
      typeof v.paused !== 'boolean' ||
      typeof v.clipped !== 'boolean' ||
      ![v.system, v.microphone, v.mixed].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)
    )
      throw Error('录音电平响应无效');
  } else if (
    typeof v.warning !== 'string' ||
    v.warning.length > 1000 ||
    ![v.discontinuities, v.late].every((n) => Number.isSafeInteger(n) && n >= 0)
  )
    throw Error('录音结果响应无效');
  return value as AudioProgress | AudioResult;
}
