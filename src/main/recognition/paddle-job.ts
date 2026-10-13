export interface PaddleArtifact { path: string; bytes: number; sha256: string }
export interface PaddleModelFiles {
  id: string;
  revision: string;
  detection: PaddleArtifact;
  recognition: PaddleArtifact;
  detectionConfig: PaddleArtifact;
  recognitionConfig: PaddleArtifact;
  orientation?: PaddleArtifact;
  orientationConfig?: PaddleArtifact;
}
export interface PaddlePreferences { device: 'auto' | 'cpu' | 'gpu'; deviceId: number; memoryMiB?: number }
export interface PaddleJob {
  id: number;
  png: Buffer;
  language: 'eng' | 'chi_sim+eng';
  model: PaddleModelFiles;
  backend: 'cpu' | 'dml';
  deviceId: number;
  memoryMiB: number;
}
