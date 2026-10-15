import type { LocalModelDescriptor } from '../shared/local-models';
import { deepseekOCRPresets } from './recognition/deepseek-models';
import {formulaProfiles} from './recognition/formula-model-catalog';

const paddle = (repository: string, revision: string, name: string, role: string, remote: string, bytes: number, sha256: string) =>
  ({ name, role, bytes, sha256, url: `https://huggingface.co/PaddlePaddle/${repository}/resolve/${revision}/${remote}` });

/** Only adapted presets enter this catalog; other planned families remain in the implementation plan. */
export interface PaddleOCRPreset extends LocalModelDescriptor { memoryBudgetMiB: number }
export const paddleTinyModel: PaddleOCRPreset = {
  id: 'pp-ocrv6-tiny', revision: 'det-2ba1506-rec-2612ab3', title: 'PP-OCRv6', size: 'tiny', purpose: 'ocr',
  languages: ['中文', 'English'], precision: 'fp32', runtime: 'onnxruntime-node@1.30.0', backends: ['cpu', 'dml'],
  memoryBudgetMiB: 1536,
  weightLicense: { name: 'Apache-2.0', source: 'https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_rec_onnx' },
  artifacts: [
    paddle('PP-OCRv6_tiny_det_onnx', '2ba1506c0380b8f0b03dd142459aac66d4421f6c', 'det.onnx', 'detection', 'inference.onnx', 1780590, '193bab7a04fca699a6c82e6abb5b81bdb28177f0abd4062552b04908dafb19f8'),
    paddle('PP-OCRv6_tiny_det_onnx', '2ba1506c0380b8f0b03dd142459aac66d4421f6c', 'det.yml', 'detectionConfig', 'inference.yml', 883, '3ac018be6f97499a08faa3bbdeb33640968d9307f6736d152902747a9f259593'),
    paddle('PP-OCRv6_tiny_rec_onnx', '2612ab37152ae0a677521bae4e1e3d4fb4cf7c30', 'rec.onnx', 'recognition', 'inference.onnx', 4462639, '9ef676d6ed3c88256a2d92c640c44f25b0c40947e111b14b8be8f594091563e6'),
    paddle('PP-OCRv6_tiny_rec_onnx', '2612ab37152ae0a677521bae4e1e3d4fb4cf7c30', 'rec.yml', 'recognitionConfig', 'inference.yml', 55571, '66170210bad538e83fff3c4a3867e547d6bf20b50d64b20347c4b913f3034ea1'),
  ],
};
const orientationArtifacts = () => [
  paddle('PP-LCNet_x1_0_textline_ori_onnx', '7fdcf3cf7061163eda7183b224aa334bd33068f7', 'orientation.onnx', 'orientation', 'inference.onnx', 6777816, '38aa97cd4be591e0ad304e659f07ba30d946f27a63315433f6659c69c8778345'),
  paddle('PP-LCNet_x1_0_textline_ori_onnx', '7fdcf3cf7061163eda7183b224aa334bd33068f7', 'orientation.yml', 'orientationConfig', 'inference.yml', 735, '8d5120d0e1a30a9df7ed46aa9119da3796ed066777089d1c1d705f132d5e90f9'),
];
export const paddleSmallModel: PaddleOCRPreset = {
  id: 'pp-ocrv6-small', revision: 'det-28fe589-rec-b8f84f0-ori-7fdcf3c', title: 'PP-OCRv6', size: 'small', purpose: 'ocr',
  languages: ['中文', 'English'], precision: 'fp32', runtime: 'onnxruntime-node@1.30.0', backends: ['cpu', 'dml'],
  memoryBudgetMiB: 1536, measuredMemoryMiB: 1126,
  weightLicense: { name: 'Apache-2.0', source: 'https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx' },
  artifacts: [
    paddle('PP-OCRv6_small_det_onnx', '28fe5895c24fd108c19eb3e8479f4ab385fbfc62', 'det.onnx', 'detection', 'inference.onnx', 9880512, 'd73e0058b7a8086bbd57f3d10b8bcd4ff95363f67e06e2762b5e814fe9c9410e'),
    paddle('PP-OCRv6_small_det_onnx', '28fe5895c24fd108c19eb3e8479f4ab385fbfc62', 'det.yml', 'detectionConfig', 'inference.yml', 885, '193f435274bf9f0b5f71a929bbfbcf148282df7e633b34e7c373e8f44741b516'),
    paddle('PP-OCRv6_small_rec_onnx', 'b8f84f0b80c529de40b4fbb3544b84fa7233a513', 'rec.onnx', 'recognition', 'inference.onnx', 21159378, '5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634'),
    paddle('PP-OCRv6_small_rec_onnx', 'b8f84f0b80c529de40b4fbb3544b84fa7233a513', 'rec.yml', 'recognitionConfig', 'inference.yml', 150579, 'ab078671bb49f06228eadccd34f1bb501e157f7a047095ffb943ba81512c77d1'),
    ...orientationArtifacts(),
  ],
};
export const paddleMediumModel: PaddleOCRPreset = {
  id: 'pp-ocrv6-medium', revision: 'det-6132380-rec-50c7eac-ori-7fdcf3c', title: 'PP-OCRv6', size: 'medium', purpose: 'ocr',
  languages: ['中文', 'English'], precision: 'fp32', runtime: 'onnxruntime-node@1.30.0', backends: ['cpu', 'dml'],
  memoryBudgetMiB: 3072, measuredMemoryMiB: 2046,
  weightLicense: { name: 'Apache-2.0', source: 'https://huggingface.co/PaddlePaddle/PP-OCRv6_medium_rec_onnx' },
  artifacts: [
    paddle('PP-OCRv6_medium_det_onnx', '61323801669c338b7891481ec7bac61ce31b576a', 'det.onnx', 'detection', 'inference.onnx', 62032837, 'eb13b44b25bb36f89528b68720af8a61d9cf381176107f465db1757b65d086e1'),
    paddle('PP-OCRv6_medium_det_onnx', '61323801669c338b7891481ec7bac61ce31b576a', 'det.yml', 'detectionConfig', 'inference.yml', 886, '7298d5ead546584af2504d03355f881ac7a7bc0eb1e282d3e159277c1d0af871'),
    paddle('PP-OCRv6_medium_rec_onnx', '50c7eacafc52fa7bcf4194e8cd08e46f8558504b', 'rec.onnx', 'recognition', 'inference.onnx', 76554979, '9c09abf0957f7968c7586464b7397b84ad2387a0497a351af40e9acc71b673ba'),
    paddle('PP-OCRv6_medium_rec_onnx', '50c7eacafc52fa7bcf4194e8cd08e46f8558504b', 'rec.yml', 'recognitionConfig', 'inference.yml', 150580, '991b700facf5b50a7de193468207d5f4255b538dde0d312ae3b7c7a9b6873129'),
    ...orientationArtifacts(),
  ],
};
export const paddleOCRPresets: readonly PaddleOCRPreset[] = [paddleTinyModel, paddleSmallModel, paddleMediumModel];
export const miganModel: LocalModelDescriptor = {
  id: 'migan-pipeline-v2', revision: '406830d0fa60666da0071c342ad2fbc8f30c5c64', title: 'MI-GAN', size: 'pipeline v2', purpose: 'repair',
  languages: [], precision: 'fp32', runtime: 'onnxruntime-node@1.30.0', backends: ['cpu'],
  weightLicense: { name: 'MIT', source: 'https://huggingface.co/andraniksargsyan/migan' },
  artifacts: [{ name: 'migan.onnx', role: 'repair', bytes: 28079181, sha256: '6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b',
    url: 'https://huggingface.co/andraniksargsyan/migan/resolve/406830d0fa60666da0071c342ad2fbc8f30c5c64/migan_pipeline_v2.onnx' }],
};
export const localModelCatalog: readonly LocalModelDescriptor[] = [...paddleOCRPresets, ...deepseekOCRPresets, miganModel,...formulaProfiles.map(profile=>profile.source)];
