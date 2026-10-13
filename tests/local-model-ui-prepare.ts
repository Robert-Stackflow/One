import { mkdir, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { LocalModelStore } from '../src/main/local-model-store';
import { paddleTinyModel } from '../src/main/local-model-catalog';
const profile = process.env.ONE_MODEL_UI_PROFILE!;
await mkdir(join(profile, 'recognition', 'models'), { recursive: true });
for (const language of ['eng', 'chi_sim']) await copyFile(resolve('work/current/fixtures/recognition-models', language + '.traineddata'), join(profile, 'recognition', 'models', language + '.traineddata'));
const suffixes: Record<string, string> = { detection: 'det.onnx', detectionConfig: 'det.yml', recognition: 'rec.onnx', recognitionConfig: 'rec.yml' };
await new LocalModelStore(join(profile, 'models', 'library'), async () => { throw Error('UI fixture must not download'); }).install(paddleTinyModel, new AbortController().signal,
  () => {}, Object.fromEntries(Object.entries(suffixes).map(([role, suffix]) => [role, resolve('work/current/capture-reconstruction', 'pp-ocrv6-tiny-' + suffix)])));
