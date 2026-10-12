export interface RecordingCountdownAPI {
  state(): Promise<number>;
  cancel(): Promise<void>;
  onTick(callback: (seconds: number) => void): () => void;
}
