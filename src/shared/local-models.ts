export type LocalModelPurpose = 'ocr' | 'formula' | 'repair';
export type LocalModelBackend = 'cpu' | 'dml' | 'cuda';
export interface LocalModelArtifact {
  name: string;
  role: string;
  url: string;
  bytes: number;
  sha256: string;
}
/** Integrity and storage contract shared by model weights and native runtime packages. */
export interface LocalArtifactBundle {
  id: string;
  revision: string;
  artifacts: LocalModelArtifact[];
}
/** A preset owns a compatible set of weights, dictionaries and preprocessing configs. */
export interface LocalModelDescriptor extends LocalArtifactBundle {
  title: string;
  size: string;
  purpose: LocalModelPurpose;
  languages: string[];
  weightLicense: { name: string; source: string };
  backends: LocalModelBackend[];
  precision: 'fp32' | 'q8_0';
  runtime: string;
  measuredMemoryMiB?: number;
  measuredVRAMMiB?: number;
}
export interface LocalModelProgress {
  phase: 'checking' | 'downloading' | 'verifying' | 'ready';
  received: number;
  total: number;
  artifact?: string;
}
export interface LocalModelState {
  ready: boolean;
  downloadedBytes: number;
  diskBytes: number;
  totalBytes: number;
  downloading: boolean;
  inUse: boolean;
}
export interface LocalModelChoice {
  modelId: string;
  device: import('./inference-devices').InferencePreference;
}
export interface LocalModelEntry extends LocalModelState {
  id: string;
  title: string;
  size: string;
  purpose: LocalModelPurpose;
  revision: string;
  languages: string[];
  backends: LocalModelBackend[];
  weightLicense: string;
  weightLicenseSource?: string;
  source?: string;
  runtimeReady?:{cpu:boolean;cuda:boolean};
  selection?:'glyph'|'ctc'|'text';
  orientationModel?:boolean;
  runtime: string;
  precision: string;
  measuredMemoryMiB?: number;
  measuredVRAMMiB?: number;
  progress: number;
  phase?:LocalModelProgress['phase'];
  sourceReady?:boolean;
  preparationBytes?:number;
  error: string;
  note: string;
}
export interface LocalModelManagerState {
  revision: string;
  choices: { ocr: LocalModelChoice; repair: LocalModelChoice; formula?:LocalModelChoice;formulaPrevious?:LocalModelChoice };
  entries: LocalModelEntry[];
  devices: import('./inference-devices').InferenceDevices;
}
