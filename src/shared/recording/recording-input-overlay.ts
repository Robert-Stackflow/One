import type { InputStyle, RecordingInput } from './recording-input';
export interface InputOverlayState {
  token: string;
  style?: InputStyle;
  width: number;
  height: number;
  sample: number;
  paused: boolean;
  events: RecordingInput[];
}
export interface InputOverlayAPI {
  state(): Promise<InputOverlayState>;
  onChange(callback: (state: InputOverlayState) => void): () => void;
}
