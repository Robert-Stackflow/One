export type ScrollAxis = 'vertical' | 'horizontal';
export type ScrollMode='manual'|'auto';
export class ScrollCaptureLimit extends Error {}
interface ControlRect {x:number;y:number;width:number;height:number}
/** Prefer usable space outside the selection; constrained screens retain a movable control. */
export function scrollControlBounds(area:ControlRect,selection:ControlRect,height=268,requestedWidth=460):ControlRect {
  const gap=12,left=area.x+gap,top=area.y+gap,right=area.x+area.width-gap,bottom=area.y+area.height-gap;
  const spaces:ControlRect[]=[
    {x:Math.max(left,selection.x+selection.width+gap),y:top,width:right-Math.max(left,selection.x+selection.width+gap),height:bottom-top},
    {x:left,y:top,width:Math.min(right,selection.x-gap)-left,height:bottom-top},
    {x:left,y:Math.max(top,selection.y+selection.height+gap),width:right-left,height:bottom-Math.max(top,selection.y+selection.height+gap)},
    {x:left,y:top,width:right-left,height:Math.min(bottom,selection.y-gap)-top},
  ];
  const space=spaces.find(space=>space.width>=Math.min(320,requestedWidth)&&space.height>=Math.min(height,230));
  if(space){const width=Math.min(requestedWidth,space.width),h=Math.min(height,space.height);return {x:Math.round(Math.max(space.x,Math.min(selection.x,space.x+space.width-width))),y:Math.round(Math.max(space.y,Math.min(selection.y,space.y+space.height-h))),width:Math.round(width),height:Math.round(h)};}
  const width=Math.min(requestedWidth,area.width),h=Math.min(height,area.height);
  return {x:Math.round(area.x+Math.max(0,area.width-width-gap)),y:Math.round(area.y+Math.min(gap,Math.max(0,area.height-h))),width,height:h};
}
export interface ScrollOptions {
  autoFixed?:boolean;
  retainStart?:number;
  retainEnd?:number;
  axis: ScrollAxis;
  trimStart: number;
  trimEnd: number;
  ignoreStart: number;
  ignoreEnd: number;
}
export type ScrollMatch = 'first' | 'accepted' | 'unchanged' | 'ambiguous' | 'backwards';
export interface ScrollView {
  fixed?:{start:number;end:number};
  recovering:boolean;
  mode:ScrollMode;
  previewExpanded:boolean;
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
  | {kind:'layout';preview:boolean;settings?:boolean}
  | {kind:'restart';options:ScrollOptions}
  | { kind: 'configure'; options: ScrollOptions }
  | { kind: 'sample' | 'manual' | 'auto' | 'pause' | 'undo' | 'finish' | 'edit' | 'cancel' }
  | { kind: 'join'; offset: number };
export interface ScrollAPI {
  state(): Promise<ScrollView>;
  command(token: string, command: ScrollCommand): Promise<ScrollView | null>;
  onChange(fn: (state: ScrollView) => void): () => void;
  onCloseRequest(fn:(token:string)=>void):()=>void;
  answerClose(token:string,accepted:boolean):Promise<void>;
}
export const scrollDefaults = (): ScrollOptions => ({
  autoFixed:true,
  retainStart:0,
  retainEnd:0,
  axis: 'vertical',
  trimStart: 0,
  trimEnd: 0,
  ignoreStart: 0,
  ignoreEnd: 0,
});
export function scrollOptions(value: unknown, width: number, height: number): ScrollOptions {
  const v = value as ScrollOptions;
  if(v?.autoFixed!==undefined&&typeof v.autoFixed!=='boolean')throw Error('固定栏检测设置无效');
  if (!v || !['vertical', 'horizontal'].includes(v.axis)) throw Error('长截图方向无效');
  const axis = v.axis === 'vertical' ? height : width,
    cross = v.axis === 'vertical' ? width : height;
  for (const key of ['trimStart', 'trimEnd', 'ignoreStart', 'ignoreEnd'] as const)
    if (!Number.isSafeInteger(v[key]) || v[key] < 0) throw Error('排除区域无效');
  const retainStart=v.retainStart??0,retainEnd=v.retainEnd??0;
  if(!Number.isSafeInteger(retainStart)||!Number.isSafeInteger(retainEnd)||retainStart<0||retainEnd<0)throw Error('固定栏区域无效');
  if (axis - v.trimStart - v.trimEnd-retainStart-retainEnd < 64 || cross - v.ignoreStart - v.ignoreEnd < 32)
    throw Error('请至少保留 64 像素滚动区域和 32 像素匹配宽度');
  return {
    autoFixed:v.autoFixed!==false,
    retainStart,
    retainEnd,
    axis: v.axis,
    trimStart: v.trimStart,
    trimEnd: v.trimEnd,
    ignoreStart: v.ignoreStart,
    ignoreEnd: v.ignoreEnd,
  };
}
