import test from 'node:test';
import assert from 'node:assert/strict';
import { inferenceDevices, inferencePreference, type InferenceGPU } from '../src/shared/inference-devices';
import { resolveInferenceDevice,resolveCUDAInferenceDevice } from '../src/main/inference-devices';
const discrete: InferenceGPU = { id: '00000000:00000111', deviceId: 0, name: 'Discrete GPU', vendorId: 4318, pciDeviceId: 1,
  dedicatedMemory: 8 * 1024 ** 3, sharedMemory: 16 * 1024 ** 3, d3d12: true };
const integrated: InferenceGPU = { ...discrete, id: '00000000:00000222', deviceId: 1, name: 'Integrated GPU', vendorId: 4098, dedicatedMemory: 512 * 1024 ** 2 };
test('CUDA ordinals remain independent of DXGI indexes and names',()=>{
  const first={...discrete,cudaDeviceId:3,cudaDriverVersion:12040},second={...discrete,id:'00000000:00000333',deviceId:2,cudaDeviceId:0,cudaDriverVersion:13000};
  const devices={gpus:inferenceDevices([first,integrated,second])};
  assert.equal(resolveCUDAInferenceDevice({mode:'gpu',gpu:first.id},devices).deviceId,3);
  const reordered={gpus:inferenceDevices([{...first,deviceId:2,cudaDeviceId:1},{...second,deviceId:0,cudaDeviceId:3},integrated])};
  assert.equal(resolveCUDAInferenceDevice({mode:'gpu',gpu:first.id},reordered).deviceId,1);
  assert.equal(resolveCUDAInferenceDevice({mode:'gpu',gpu:second.id},reordered).deviceId,3);
  assert.equal(resolveInferenceDevice({mode:'gpu',gpu:first.id},reordered,100).gpu!.deviceId,2);
  assert.equal(resolveCUDAInferenceDevice({mode:'auto'},devices).backend,'cuda');
  assert.equal(resolveCUDAInferenceDevice({mode:'cpu',gpu:first.id},devices).backend,'cpu');
  assert.throws(()=>resolveCUDAInferenceDevice({mode:'gpu',gpu:integrated.id},devices),/不支持/);
  assert.equal(resolveCUDAInferenceDevice({mode:'auto',gpu:integrated.id},devices).backend,'cpu');
  assert.throws(()=>resolveCUDAInferenceDevice({mode:'gpu',gpu:'ffffffff:ffffffff'},devices),/不可用/);
  assert.equal(resolveCUDAInferenceDevice({mode:'auto'},{gpus:[{...first,cudaDriverVersion:12030}]}).backend,'cpu');
  for(const row of [{...first,cudaDeviceId:NaN},{...first,cudaDeviceId:32},{...first,cudaDriverVersion:undefined},{...first,vendorId:4098}])assert.throws(()=>inferenceDevices([row]),/无效/);
  assert.throws(()=>inferenceDevices([first,{...second,cudaDeviceId:3}]),/无效/);
});
test('GPU selection follows adapter identity across changing indexes', () => {
  const original = { gpus: inferenceDevices([discrete, integrated]) };
  assert.equal(resolveInferenceDevice({ mode: 'gpu', gpu: integrated.id }, original, 100).gpu?.deviceId, 1);
  const reordered = { gpus: inferenceDevices([{ ...integrated, deviceId: 0 }, { ...discrete, deviceId: 1 }]) };
  assert.equal(resolveInferenceDevice({ mode: 'gpu', gpu: integrated.id }, reordered, 100).gpu?.deviceId, 0);
  assert.equal(resolveInferenceDevice({ mode: 'auto' }, original, 2_000_000).gpu?.id, discrete.id);
  assert.equal(resolveInferenceDevice({ mode: 'auto' }, original, 100).backend, 'cpu');
  assert.equal(resolveInferenceDevice({ mode: 'cpu', gpu: integrated.id }, original, 2_000_000).backend, 'cpu');
  const missing = { gpus: [discrete] };
  assert.throws(() => resolveInferenceDevice({ mode: 'gpu', gpu: integrated.id }, missing, 2_000_000), /已不可用/);
  const fallback = resolveInferenceDevice({ mode: 'auto', gpu: integrated.id }, missing, 2_000_000);
  assert.equal(fallback.backend, 'cpu'); assert.match(fallback.reason!, /已不可用/);
  assert.throws(() => resolveInferenceDevice({ mode: 'gpu' }, { gpus: [], error: 'unavailable' }, 100), /unavailable/);
  assert.equal(resolveInferenceDevice({ mode: 'auto' }, { gpus: [{ ...discrete, d3d12: false }] }, 2_000_000).backend, 'cpu');
});
test('adapter validation preserves separate logical adapters and rejects ambiguous results', () => {
  const sameName = { ...discrete, id: '00000000:00000333', deviceId: 3 };
  assert.equal(inferenceDevices([discrete, sameName]).length, 2, 'equal GPU names do not identify the same DXGI adapter');
  for (const value of [null, [discrete, discrete], [{ ...discrete, deviceId: -1 }], [{ ...discrete, id: 'arbitrary-name' }], [{ ...discrete, sharedMemory: NaN }]])
    assert.throws(() => inferenceDevices(value), /无效/);
  assert.throws(() => inferencePreference({ mode: 'cuda' }), /无效/);
  assert.throws(() => inferencePreference({ mode: 'gpu', gpu: 'GPU 0' }), /无效/);
});
