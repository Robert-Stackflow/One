import { mkdir, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { LocalModelStore } from '../src/main/local-model-store';
import { paddleTinyModel, paddleOCRPresets } from '../src/main/local-model-catalog';
const profile = process.env.ONE_MODEL_UI_PROFILE!;
await mkdir(join(profile, 'recognition', 'models'), { recursive: true });
for (const language of ['eng', 'chi_sim']) await copyFile(resolve('work/current/fixtures/recognition-models', language + '.traineddata'), join(profile, 'recognition', 'models', language + '.traineddata'));
const suffixes: Record<string, string> = { detection: 'det.onnx', detectionConfig: 'det.yml', recognition: 'rec.onnx', recognitionConfig: 'rec.yml' };
const store=new LocalModelStore(join(profile,'models','library'),async()=>{throw Error('UI fixture must not download');});
for(const preset of process.env.ONE_MODEL_UI_PRESETS==='1'?paddleOCRPresets:[paddleTinyModel])await store.install(preset,new AbortController().signal,()=>{},
  Object.fromEntries(preset.artifacts.map(file=>[file.role,resolve('work/current/capture-reconstruction',file.role==='orientation'?'pp-textline-orientation.onnx':file.role==='orientationConfig'?'pp-textline-orientation.yml':`pp-ocrv6-${preset.size}-${suffixes[file.role]}`)])));
