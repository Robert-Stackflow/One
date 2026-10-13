import type { LocalModelDescriptor } from '../../shared/local-models';
import { LocalModelStore, localModelIdentity } from '../local-model-store';
import { paddleTinyModel, paddleOCRPresets } from '../local-model-catalog';
import type { PaddleArtifact, PaddleModelFiles } from './paddle-job';

/** Only a preset whose detector/recognizer/config combination has been adapted may reach the runtime. */
export async function acquirePaddleModel(store: LocalModelStore, descriptor: LocalModelDescriptor | string = paddleTinyModel) {
  const identity = typeof descriptor === 'string' ? undefined : localModelIdentity(descriptor);
  const preset = paddleOCRPresets.find(model => typeof descriptor === 'string' ? model.id === descriptor : localModelIdentity(model) === identity);
  if (!preset) throw Error('此 OCR 模型尚未适配当前推理运行时');
  const lease = await store.acquire(preset);
  try {
    const artifact = (role: string): PaddleArtifact => {
      const matches = lease.files.filter(file => file.role === role);
      if (matches.length !== 1) throw Error('OCR 模型预设缺少匹配的权重或配置');
      const { path, bytes, sha256 } = matches[0]; return { path, bytes, sha256 };
    };
    const model: PaddleModelFiles = { id: lease.model.id, revision: lease.model.revision, detection: artifact('detection'),
      recognition: artifact('recognition'), detectionConfig: artifact('detectionConfig'), recognitionConfig: artifact('recognitionConfig'),
      ...(preset.artifacts.some(file => file.role === 'orientation' || file.role === 'orientationConfig') ? { orientation: artifact('orientation'), orientationConfig: artifact('orientationConfig') } : {}) };
    return { model, preset, release: lease.release };
  } catch (error) { lease.release(); throw error; }
}
