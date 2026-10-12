import type { Rectangle } from './region';
import type { SensitiveAPI } from '../recognition/sensitive-api';
import type { CandidateUpdate, CaptureCandidate } from './capture-detection';
import type { Point, ImageDocument, ImageHistoryState } from './image-document';
import {
  validSelection,
  validateImageDocument,
  transformImage,
  imageHistoryState,
} from './image-document';
import { IMAGE_BASE64 } from './image-limits';
import type { WatermarkPreset } from './watermark';
import type { CaptureSelectionMode } from './capture-selection';
import {
  captureActions,
  type CaptureAction,
  type CaptureWorkflow,
  type CaptureResult,
} from './capture-workflow';
import { outputEffects, type OutputEffects } from './image-output';
export type { CaptureAction } from './capture-workflow';
export interface CaptureData {
  token: string;
  image: string;
  name: string;
  width: number;
  height: number;
  purpose: 'capture' | 'region';
  regionHint?: 'recording' | 'scroll';
  selected: boolean;
  initialSelection?: Rectangle;
  autoCopy?: boolean;
  selectionMode?: CaptureSelectionMode;
  composition?: 'windows' | 'desktop';
  layers?: { image: string; name: string; x: number; y: number; width: number; height: number }[];
  workflows: CaptureWorkflow[];
  workflowId: string;
  detection: boolean;
  pointer: Point | null;
  origin?: Point;
  capturedAt: number;
  watermark: WatermarkPreset;
  uiScale:import('./settings').CapturePreferences['uiScale'];
}
export interface CaptureRequest {
  token: string;
  selection: Rectangle;
  actions: CaptureAction[];
  png?: string;
  effects?: OutputEffects;
  workflowId?: string;
  document?: ImageDocument;
  history?: ImageHistoryState;
  originalPng?: string;
}
export interface CaptureAPI extends SensitiveAPI {
  data(): Promise<CaptureData>;
  ready(token: string, failure?: string): Promise<void>;
  complete(request: CaptureRequest | null): Promise<CaptureResult>;
  refresh(token: string): Promise<CaptureData>;
  detect(token: string, point: Point): Promise<CaptureCandidate[]>;
  cursorTarget(token: string, point: Point): Promise<Point>;
  moveCursor(token: string, point: Point): Promise<void>;
  copyColor(token: string, value: string): Promise<void>;
  fonts(): Promise<import('../fonts').InstalledFont[]>;
  selectFont(token:string,family:string):Promise<boolean>;
  onPreferences(callback:(value:Pick<import('./settings').CapturePreferences,'uiScale'>)=>void):()=>void;
  saveWatermark(token: string, preset: WatermarkPreset): Promise<void>;
  chooseWatermarkImage(token: string): Promise<import('./watermark').WatermarkImage | null>;
  onCandidates(callback: (update: CandidateUpdate) => void): () => void;
}
export function captureRequest(
  value: unknown,
  token: string,
  width: number,
  height: number,
  regionOnly: boolean,
): CaptureRequest {
  const v = value as CaptureRequest;
  if (
    !v ||
    (v.workflowId !== undefined &&
      (typeof v.workflowId !== 'string' || !/^[\w-]{1,64}$/.test(v.workflowId))) ||
    v.token !== token ||
    !Array.isArray(v.actions) ||
    v.actions.length > captureActions.length ||
    new Set(v.actions).size !== v.actions.length ||
    v.actions.some((a) => !captureActions.includes(a)) ||
    (!regionOnly &&
      (!v.actions.length || typeof v.png !== 'string' || v.png.length > IMAGE_BASE64)) ||
    (regionOnly &&
      (v.png !== undefined ||
        v.actions.length ||
        v.effects !== undefined ||
        v.workflowId !== undefined))
  )
    throw Error('截图请求无效');
  return {
    token,
    selection: validSelection(v.selection, width, height),
    actions: [...v.actions],
    ...(v.workflowId !== undefined ? { workflowId: v.workflowId } : {}),
    png: v.png,
    ...(!regionOnly && v.document
      ? {
          document: transformImage(
            validateImageDocument(v.document, { width, height }),
            'crop',
            validSelection(v.selection, width, height),
          ),
        }
      : {}),
    ...(!regionOnly && v.history && v.document
      ? {
          history: (() => {
            const history = imageHistoryState(v.history, { width, height });
            const crop = (document: ImageDocument) =>
              transformImage(
                document,
                'crop',
                document.selection || {
                  x: 0,
                  y: 0,
                  width: document.width,
                  height: document.height,
                },
              );
            return { past: history.past.map(crop), future: history.future.map(crop) };
          })(),
        }
      : {}),
    ...(!regionOnly && v.originalPng
      ? {
          originalPng:
            typeof v.originalPng === 'string' && v.originalPng.length <= IMAGE_BASE64
              ? v.originalPng
              : (() => {
                  throw Error('截图原图无效');
                })(),
        }
      : {}),
    ...(!regionOnly ? { effects: outputEffects(v.effects) } : {}),
  };
}
