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
  uiScale?: import('./settings').CapturePreferences['uiScale'];
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
  selectFont(token:string,family:string):Promise<boolean>;
  onPreferences(callback:(value:Pick<import('./settings').CapturePreferences,'uiScale'>)=>void):()=>void;
  onCloseRequest(callback:(token:string)=>void):()=>void;
  answerClose(token:string,accepted:boolean):Promise<void>;
  saveWatermark(token: string, value: WatermarkPreset): Promise<void>;
  chooseWatermarkImage(token: string): Promise<import('./watermark').WatermarkImage | null>;
}
