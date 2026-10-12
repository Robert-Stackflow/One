import { type ImageDocument, type ImageHistoryState } from './image-document';
import type { WatermarkPreset } from './watermark';
import type { InstalledFont } from '../fonts';
import type { SensitiveAPI } from '../recognition/sensitive-api';
export interface ImageEditorState {
  token: string;
  url: string;
  name: string;
  width: number;
  height: number;
  dark: boolean;
  document?: ImageDocument;
  history?: ImageHistoryState;
  watermark?: WatermarkPreset;
  openedAt?: number;
}
export interface ImageSaveRequest {
  token: string;
  document: ImageDocument;
  history?: ImageHistoryState;
  png: string;
  mode: 'asset' | 'copy' | 'export' | 'ocr';
}
export interface ImageEditorAPI extends SensitiveAPI {
  state(): Promise<ImageEditorState>;
  dirty(token: string, value: boolean): Promise<void>;
  save(request: ImageSaveRequest): Promise<string | null>;
  saveProject(
    token: string,
    document: ImageDocument,
    history?: ImageHistoryState,
  ): Promise<string | null>;
  fonts(): Promise<InstalledFont[]>;
  saveWatermark(token: string, value: WatermarkPreset): Promise<void>;
  chooseWatermarkImage(token: string): Promise<import('./watermark').WatermarkImage | null>;
}
