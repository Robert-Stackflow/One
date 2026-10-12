import type { RecordingState } from './recording';
import type { AnnotationCommand } from './recording-annotations';
import type { CaptureTool } from '../capture/image-document';
import type { CameraStyle } from './recording-camera';
import type { InputStyle } from './recording-input';
export interface RecordingToolbarMenu {
  kind: 'tools' | 'color' | 'stroke' | 'font' | 'weight' | 'more' | 'camera' | 'input';
  tools?: CaptureTool[];
  selected?: CaptureTool;
}

export interface RecordingToolbarAPI {
  state(): Promise<RecordingState>;
  pause(token: string, paused: boolean): Promise<void>;
  stop(token: string): Promise<void>;
  gain(token: string, system: number, microphone: number): Promise<void>;
  cancel(token: string): Promise<void>;
  camera(token: string): Promise<void>;
  cameraStyle(token: string, style: CameraStyle): Promise<void>;
  inputStyle(token: string, style: InputStyle): Promise<void>;
  region(token: string): Promise<void>;
  annotate(token: string, command: AnnotationCommand): Promise<void>;
  menu(
    token: string,
    menu: RecordingToolbarMenu,
    anchor: { x: number; y: number; width: number; height: number },
  ): Promise<void>;
  menuState(): Promise<{ menu: RecordingToolbarMenu; state: RecordingState }>;
  closeMenu(token: string): Promise<void>;
  fit(token: string, width: number): Promise<void>;
  fitMenu(token: string, height: number): Promise<void>;
  onDismissMenu(callback: () => void): () => void;
  expand(token: string, expanded: boolean, annotations?: boolean): Promise<boolean>;
  resetPosition(token: string): Promise<boolean>;
  drag(
    token: string,
    phase: 'start' | 'move' | 'end',
    point: { x: number; y: number },
  ): Promise<void>;
  onChange(callback: () => void): () => void;
}
