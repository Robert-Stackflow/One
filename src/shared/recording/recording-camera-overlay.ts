import type { CameraStyle } from './recording-camera';
export interface CameraPacket {
  token: string;
  serial: number;
  url: string;
  style: CameraStyle;
  width: number;
  height: number;
  videoWidth: number;
  videoHeight: number;
}
export interface CameraOverlayAPI {
  state(): Promise<CameraPacket>;
  style(token: string, value: CameraStyle): Promise<void>;
  drag(
    token: string,
    phase: 'start' | 'move' | 'end',
    resize: boolean,
    point: { x: number; y: number },
  ): Promise<void>;
  onChange(callback: (value: CameraPacket) => void): () => void;
}
