export interface InferenceGPU {
  /** Current-session DXGI LUID; a missing identity after driver/reboot changes requires a new selection. */
  id: string;
  deviceId: number;
  name: string;
  vendorId: number;
  pciDeviceId: number;
  dedicatedMemory: number;
  sharedMemory: number;
  d3d12: boolean;
}
export interface InferenceDevices { gpus: InferenceGPU[]; error?: string }
export interface InferencePreference { mode: 'auto' | 'cpu' | 'gpu'; gpu?: string }

export function inferenceDevices(value: unknown): InferenceGPU[] {
  if (!Array.isArray(value) || value.length > 32) throw Error('显卡枚举结果无效');
  const indexes = new Set<number>(), identities = new Set<string>();
  return value.map(raw => {
    if (!raw || typeof raw !== 'object') throw Error('显卡枚举结果无效');
    const v = raw as InferenceGPU;
    if (!/^[a-f0-9]{8}:[a-f0-9]{8}$/.test(v.id) || !Number.isSafeInteger(v.deviceId) || v.deviceId < 0 || v.deviceId > 31 ||
        typeof v.name !== 'string' || !v.name.trim() || v.name.length > 256 || typeof v.d3d12 !== 'boolean' ||
        ![v.vendorId, v.pciDeviceId, v.dedicatedMemory, v.sharedMemory].every(n => Number.isSafeInteger(n) && n >= 0) ||
        indexes.has(v.deviceId) || identities.has(v.id)) throw Error('显卡枚举结果无效');
    indexes.add(v.deviceId); identities.add(v.id);
    return { id: v.id, deviceId: v.deviceId, name: v.name, vendorId: v.vendorId, pciDeviceId: v.pciDeviceId,
      dedicatedMemory: v.dedicatedMemory, sharedMemory: v.sharedMemory, d3d12: v.d3d12 };
  });
}
export function inferencePreference(value: unknown): InferencePreference {
  const v = value as InferencePreference;
  if (!v || !['auto', 'cpu', 'gpu'].includes(v.mode) || v.gpu !== undefined && (typeof v.gpu !== 'string' || !/^[a-f0-9]{8}:[a-f0-9]{8}$/.test(v.gpu))) throw Error('推理设备设置无效');
  return { mode: v.mode, ...(v.gpu ? { gpu: v.gpu } : {}) };
}
