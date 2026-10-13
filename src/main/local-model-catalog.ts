import type { LocalModelDescriptor } from '../shared/local-models';

const paddle = (repository: string, revision: string, name: string, role: string, remote: string, bytes: number, sha256: string) =>
  ({ name, role, bytes, sha256, url: `https://huggingface.co/PaddlePaddle/${repository}/resolve/${revision}/${remote}` });

/** Only adapted presets enter this catalog; other planned families remain in the implementation plan. */
export const paddleTinyModel: LocalModelDescriptor = {
  id: 'pp-ocrv6-tiny', revision: 'det-2ba1506-rec-2612ab3', title: 'PP-OCRv6', size: 'tiny', purpose: 'ocr',
  languages: ['中文', 'English'], precision: 'fp32', runtime: 'onnxruntime-node@1.30.0', backends: ['cpu', 'dml'],
  weightLicense: { name: 'Apache-2.0', source: 'https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_rec_onnx' },
  artifacts: [
    paddle('PP-OCRv6_tiny_det_onnx', '2ba1506c0380b8f0b03dd142459aac66d4421f6c', 'det.onnx', 'detection', 'inference.onnx', 1780590, '193bab7a04fca699a6c82e6abb5b81bdb28177f0abd4062552b04908dafb19f8'),
    paddle('PP-OCRv6_tiny_det_onnx', '2ba1506c0380b8f0b03dd142459aac66d4421f6c', 'det.yml', 'detectionConfig', 'inference.yml', 883, '3ac018be6f97499a08faa3bbdeb33640968d9307f6736d152902747a9f259593'),
    paddle('PP-OCRv6_tiny_rec_onnx', '2612ab37152ae0a677521bae4e1e3d4fb4cf7c30', 'rec.onnx', 'recognition', 'inference.onnx', 4462639, '9ef676d6ed3c88256a2d92c640c44f25b0c40947e111b14b8be8f594091563e6'),
    paddle('PP-OCRv6_tiny_rec_onnx', '2612ab37152ae0a677521bae4e1e3d4fb4cf7c30', 'rec.yml', 'recognitionConfig', 'inference.yml', 55571, '66170210bad538e83fff3c4a3867e547d6bf20b50d64b20347c4b913f3034ea1'),
  ],
};
export const miganModel: LocalModelDescriptor = {
  id: 'migan-pipeline-v2', revision: '406830d0fa60666da0071c342ad2fbc8f30c5c64', title: 'MI-GAN', size: 'pipeline v2', purpose: 'repair',
  languages: [], precision: 'fp32', runtime: 'onnxruntime-node@1.30.0', backends: ['cpu'],
  weightLicense: { name: 'MIT', source: 'https://huggingface.co/andraniksargsyan/migan' },
  artifacts: [{ name: 'migan.onnx', role: 'repair', bytes: 28079181, sha256: '6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b',
    url: 'https://huggingface.co/andraniksargsyan/migan/resolve/406830d0fa60666da0071c342ad2fbc8f30c5c64/migan_pipeline_v2.onnx' }],
};
export const localModelCatalog: readonly LocalModelDescriptor[] = [paddleTinyModel, miganModel];
