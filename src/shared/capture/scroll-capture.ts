export type ScrollAxis = 'vertical' | 'horizontal';
export type ScrollMode='manual'|'auto';
export interface ScrollDynamicRegion {x:number;y:number;width:number;height:number}
export class ScrollCaptureLimit extends Error {}
interface ControlRect {x:number;y:number;width:number;height:number}
export function scrollMaskShape(width:number,height:number,selection:ControlRect){
  const x=Math.max(0,selection.x-1),y=Math.max(0,selection.y-1),right=Math.min(width,selection.x+selection.width+1),bottom=Math.min(height,selection.y+selection.height+1);
  return [{x:0,y:0,width,height:y},{x:0,y:bottom,width,height:height-bottom},{x:0,y,width:x,height:bottom-y},{x:right,y,width:width-right,height:bottom-y}].filter(rect=>rect.width>0&&rect.height>0);
}
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
/** Overlay coordinates are display-local DIPs. Fit the complete image beside
 * the selection; the preview never grows a separate scrolling surface. */
export function scrollOverlayLayout(area:ControlRect,selection:ControlRect,image:{width:number;height:number},height:number,compact=true,previewExpanded=true){
  const gap=12,leftSpace=selection.x-area.x-gap*2,rightSpace=area.x+area.width-selection.x-selection.width-gap*2;
  const left=leftSpace>=160||rightSpace<160&&(leftSpace>=80||rightSpace<80);
  const maxWidth=Math.max(40,Math.min(320,left?leftSpace:rightSpace));
  const fit=(top:number,available:number)=>{
    const scale=Math.min(1,maxWidth/Math.max(1,image.width),Math.max(1,available)/Math.max(1,image.height));
    const width=Math.max(1,Math.floor(image.width*scale)),h=Math.max(1,Math.floor(image.height*scale));
    return {x:Math.max(area.x+gap,Math.min(left?selection.x-gap-width:selection.x+selection.width+gap,area.x+area.width-width-gap)),y:Math.max(top,Math.min(selection.y+selection.height-h,top+available-h)),width,height:h};
  };
  const preview=fit(area.y+gap,Math.max(1,Math.min(area.y+area.height,selection.y+selection.height)-area.y-gap));
  const controls=scrollControlBounds(area,selection,height,500);
  const below=area.y+area.height-selection.y-selection.height-gap*2;
  if(below>=height||compact&&below>=160){
    controls.height=Math.min(height,below);controls.y=selection.y+selection.height+gap;
    controls.x=Math.max(area.x+gap,Math.min(selection.x+selection.width-controls.width,area.x+area.width-controls.width-gap));
  }
  const intersects=(a:ControlRect,b:ControlRect)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
  if(previewExpanded&&intersects(preview,controls)){
    const beside=left?preview.x-controls.width-gap:preview.x+preview.width+gap;
    if(beside>=area.x+gap&&beside+controls.width<=area.x+area.width-gap&&!intersects({...controls,x:beside},selection))controls.x=beside;
    else if(selection.y-area.y>=height+gap*2)controls.y=selection.y-height-gap;
  }
  return {selection,controls,preview,overlap:intersects(controls,selection)||previewExpanded&&intersects(preview,selection)};
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
  overlay?:{selection:ControlRect;controls:ControlRect;preview:ControlRect;panel?:ControlRect;overlap:boolean};
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
  | {kind:'layout';preview:boolean;settings?:boolean;repair?:boolean}
  | {kind:'restart';options:ScrollOptions}
  | { kind: 'configure'; options: ScrollOptions }
  | { kind: 'sample' | 'manual' | 'auto' | 'pause' | 'undo' | 'finish' | 'edit' | 'copy' | 'save' | 'cancel' }
  | { kind: 'join'; offset: number };
export interface ScrollAPI {
  tooltip(rect:{x:number;y:number;width:number;height:number}|null):Promise<void>;
  ready():Promise<void>;
  interactive(value:boolean):Promise<void>;
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
