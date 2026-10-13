import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { inferenceDevices, inferencePreference, supportsCUDAInference, type InferenceDevices, type InferencePreference } from '../shared/inference-devices';

export async function readInferenceDevices(signal?: AbortSignal, executable = join(__dirname, '../native/One.Monitor.exe').replace('app.asar\\', 'app.asar.unpacked\\')): Promise<InferenceDevices> {
  if (process.platform !== 'win32') return { gpus: [], error: '当前系统尚未适配本地 GPU 推理' };
  try {
    const { stdout } = await promisify(execFile)(executable, ['inference-devices'], { windowsHide: true, timeout: 10000, maxBuffer: 32 * 1024, signal });
    return { gpus: inferenceDevices(JSON.parse(stdout)) };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { gpus: [], error: '无法读取显卡，自动模式将使用 CPU；可刷新设备后重试 GPU' };
  }
}
/** Resolve the selected identity against fresh DXGI order, never silently reuse a stale adapter index. */
export function resolveInferenceDevice(value: InferencePreference, devices: InferenceDevices, pixels: number) {
  const preference = inferencePreference(value);
  if (!Number.isSafeInteger(pixels) || pixels < 1) throw Error('推理图片尺寸无效');
  if (preference.mode === 'cpu') return { backend: 'cpu' as const };
  if (preference.mode === 'auto' && pixels < 1_000_000 && !preference.gpu) return { backend: 'cpu' as const };
  const gpus = inferenceDevices(devices.gpus).filter(gpu => gpu.d3d12);
  const selected = preference.gpu ? gpus.find(gpu => gpu.id === preference.gpu) : [...gpus].sort((a, b) => b.dedicatedMemory - a.dedicatedMemory || a.deviceId - b.deviceId)[0];
  if (!selected) {
    const reason = preference.gpu ? '所选显卡已不可用，请刷新设备或切换 CPU' : devices.error || '没有可用的 DirectML 显卡，请切换 CPU';
    if (preference.mode === 'gpu') throw Error(reason);
    return { backend: 'cpu' as const, reason };
  }
  // Current tiny-model measurements show that small inputs do not repay GPU startup overhead.
  if (preference.mode === 'auto' && pixels < 1_000_000) return { backend: 'cpu' as const };
  return { backend: 'dml' as const, gpu: selected };
}

/** Large language OCR uses CUDA's driver ordinal, independently of the DirectML ordering. */
export function resolveCUDAInferenceDevice(value: InferencePreference, devices: InferenceDevices) {
  const preference=inferencePreference(value);
  if(preference.mode==='cpu')return {backend:'cpu' as const};
  const all=inferenceDevices(devices.gpus),compatible=all.filter(supportsCUDAInference);
  const selected=preference.gpu?compatible.find(gpu=>gpu.id===preference.gpu):[...compatible].sort((a,b)=>b.dedicatedMemory-a.dedicatedMemory||a.cudaDeviceId!-b.cudaDeviceId!)[0];
  if(selected)return {backend:'cuda' as const,gpu:selected,deviceId:selected.cudaDeviceId!};
  const reason=preference.gpu?(all.some(gpu=>gpu.id===preference.gpu)?'所选显卡或驱动不支持此模型的 CUDA 推理，请切换 CPU':'所选显卡已不可用，请刷新设备或切换 CPU'):devices.error||'没有可用的 CUDA 显卡或驱动，请切换 CPU';
  if(preference.mode==='gpu')throw Error(reason);
  return {backend:'cpu' as const,reason};
}
