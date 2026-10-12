export type ScrollAxis = 'vertical' | 'horizontal';
export interface ScrollOptions {
  axis: ScrollAxis;
  trimStart: number;
  trimEnd: number;
  ignoreStart: number;
  ignoreEnd: number;
}
export type ScrollMatch = 'first' | 'accepted' | 'unchanged' | 'ambiguous' | 'backwards';
export interface ScrollView {
  token: string;
  uiScale:100|110|125|150;
  phase: 'setup' | 'ready' | 'running' | 'paused' | 'review' | 'failed';
  source: { width: number; height: number };
  options: ScrollOptions;
  width: number;
  height: number;
  count: number;
  undo: boolean;
  pending: boolean;
  canEdit: boolean;
  offset: number;
  match: ScrollMatch;
  message: string;
  preview: string;
}
export type ScrollCommand =
  | { kind: 'configure'; options: ScrollOptions }
  | { kind: 'sample' | 'auto' | 'pause' | 'undo' | 'finish' | 'edit' | 'cancel' }
  | { kind: 'join'; offset: number };
export interface ScrollAPI {
  state(): Promise<ScrollView>;
  command(token: string, command: ScrollCommand): Promise<ScrollView | null>;
  onChange(fn: (state: ScrollView) => void): () => void;
  onCloseRequest(fn:(token:string)=>void):()=>void;
  answerClose(token:string,accepted:boolean):Promise<void>;
}
export const scrollDefaults = (): ScrollOptions => ({
  axis: 'vertical',
  trimStart: 0,
  trimEnd: 0,
  ignoreStart: 0,
  ignoreEnd: 0,
});
export function scrollOptions(value: unknown, width: number, height: number): ScrollOptions {
  const v = value as ScrollOptions;
  if (!v || !['vertical', 'horizontal'].includes(v.axis)) throw Error('长截图方向无效');
  const axis = v.axis === 'vertical' ? height : width,
    cross = v.axis === 'vertical' ? width : height;
  for (const key of ['trimStart', 'trimEnd', 'ignoreStart', 'ignoreEnd'] as const)
    if (!Number.isSafeInteger(v[key]) || v[key] < 0) throw Error('排除区域无效');
  if (axis - v.trimStart - v.trimEnd < 64 || cross - v.ignoreStart - v.ignoreEnd < 32)
    throw Error('请至少保留 64 像素滚动区域和 32 像素匹配宽度');
  return {
    axis: v.axis,
    trimStart: v.trimStart,
    trimEnd: v.trimEnd,
    ignoreStart: v.ignoreStart,
    ignoreEnd: v.ignoreEnd,
  };
}
