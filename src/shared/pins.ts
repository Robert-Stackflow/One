import { imageDimensions, IMAGE_PIXELS } from './capture/image-limits';
import { ImageHistory, transformImage, type ImageDocument } from './capture/image-document';
import type { Rectangle } from './capture/region';

export type PinContent =
  | { kind: 'image'; hash: string; width: number; height: number }
  | { kind: 'text'; text: string }
  | { kind: 'files'; files: { path: string; name: string; directory: boolean }[] };
export type PinPlacement=Rectangle&{scale?:number};
export interface PinView {
  x: number;
  y: number;
  scale: number;
  rotation: 0 | 1 | 2 | 3;
  flipX: boolean;
  flipY: boolean;
  opacity: number;
  passThrough: boolean;
  visible: boolean;
}
export interface PinRecord {
  id: string;
  title: string;
  group: string | null;
  created: number;
  content: PinContent;
  view: PinView;
}
export interface PinGroup {
  id: string;
  name: string;
}
export interface PinWorkspace {
  format:'one-pin-workspace';
  version: 1;
  pins: PinRecord[];
  groups: PinGroup[];
}
export type PinAction =
  | {
      kind:
        | 'show'
        | 'hide'
        | 'remove'
        | 'restore'
        | 'reset'
        | 'rotate'
        | 'flipX'
        | 'flipY'
        | 'copy'
        | 'export'
        | 'controls';
    }
  | { kind: 'opacity'; value: number }
  | { kind: 'pass'; value: boolean }
  | { kind: 'zoom'; direction: 1 | -1; x: number; y: number }
  | { kind: 'rename'; title: string }
  | { kind: 'group'; group: string | null }
  | { kind: 'open-file' | 'locate-file' | 'drag-file'; index: number };
export type PinGroupAction =
  | { kind: 'create' | 'rename'; name: string }
  | { kind: 'remove' | 'show' | 'hide' | 'restore' };
export interface PinWindowState {
  uiScale:import('./capture/settings').CapturePreferences['uiScale'];
  record: PinRecord;
  image?: string;
  groups: PinGroup[];
}
export interface PinAPI {
  state(): Promise<PinWindowState>;
  action(action: PinAction): Promise<void>;
  drag(phase: 'start' | 'move' | 'end', group?: boolean): Promise<void>;
  controlsHeight(height: number): Promise<void>;
  onChange(callback: (state: PinWindowState) => void): () => void;
}
export const PIN_LIMIT = 200,
  PIN_VISIBLE_LIMIT = 20,
  PIN_FILE_LIMIT = 64;
export const pinId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
export function pinName(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > 120 || /[\x00-\x1f]/.test(value))
    throw Error('名称需为 1–120 个字符');
  return value.trim();
}
export function pinBase(content: PinContent) {
  if (content.kind === 'image') return imageDimensions(content.width, content.height);
  if (content.kind === 'files')
    return { width: 420, height: 78 + Math.min(content.files.length, 6) * 64 };
  const lines = content.text
    .split('\n')
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 24)), 0);
  return { width: 360, height: Math.max(100, Math.min(600, 48 + lines * 24)) };
}
/** Capture bounds are desktop DIPs; image pixels remain unchanged. */
export function initialPinView(content:PinContent,point:{x:number;y:number},area:Rectangle,captured?:PinPlacement):PinView{
 const base=pinBase(content),scale=captured?(captured.scale??captured.width/base.width):Math.min(1,600/base.width,500/base.height,(area.width-32)/base.width,(area.height-32)/base.height);
 return {x:captured?.x??point.x,y:captured?.y??point.y,scale:Math.max(.01,scale),rotation:0,flipX:false,flipY:false,opacity:1,passThrough:false,visible:false};
}
export function pinSize(content: PinContent, view: PinView) {
  const base = pinBase(content),
    rotated = view.rotation % 2;
  return {
    width: Math.max(1, Math.round((rotated ? base.height : base.width) * view.scale)),
    height: Math.max(1, Math.round((rotated ? base.width : base.height) * view.scale)),
  };
}
export function pinDocument(content: PinContent, view: PinView): ImageDocument {
  const base = pinBase(content);
  let document = new ImageHistory(base.width, base.height, true).value;
  if (view.flipX) document = transformImage(document, 'flipX');
  if (view.flipY) document = transformImage(document, 'flipY');
  for (let i = 0; i < view.rotation; i++) document = transformImage(document, 'rotate');
  return document;
}
export function pinBounds(content: PinContent, view: PinView): Rectangle {
  return { x: view.x, y: view.y, ...pinSize(content, view) };
}
export function clampPin(bounds: Rectangle, area: Rectangle): Rectangle {
  // Keep an accessible edge when a large pin or disconnected display goes off-screen.
  const edge = Math.min(32, bounds.width, bounds.height);
  return {
    ...bounds,
    x: Math.round(
      Math.max(area.x - bounds.width + edge, Math.min(bounds.x, area.x + area.width - edge)),
    ),
    y: Math.round(
      Math.max(area.y - bounds.height + edge, Math.min(bounds.y, area.y + area.height - edge)),
    ),
  };
}
export function zoomPin(record: PinRecord, direction: 1 | -1, x: number, y: number): PinView {
  if (![1, -1].includes(direction) || ![x, y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1))
    throw Error('缩放参数无效');
  const previous = pinSize(record.content, record.view),
    scale = record.view.scale * (direction === 1 ? 1.1 : 1 / 1.1),
    next = pinSize(record.content, { ...record.view, scale });
  if (
    scale < 0.01 ||
    scale > 8 ||
    next.width > 8192 ||
    next.height > 8192 ||
    next.width * next.height > IMAGE_PIXELS ||
    next.width < 16 ||
    next.height < 16
  )
    return record.view;
  return {
    ...record.view,
    scale,
    x: Math.round(record.view.x - (next.width - previous.width) * x),
    y: Math.round(record.view.y - (next.height - previous.height) * y),
  };
}
export function workspaceFrom(value: unknown): PinWorkspace {
  if (!value || typeof value !== 'object') throw Error('贴图工作区无效');
  const v = value as PinWorkspace;
  if (
    v.format !== 'one-pin-workspace' || v.version !== 1 ||
    !Array.isArray(v.pins) ||
    v.pins.length > PIN_LIMIT ||
    !Array.isArray(v.groups) ||
    v.groups.length > 24
  )
    throw Error('贴图工作区无效');
  const ids = new Set<string>();
  const groups = v.groups.map((g) => {
    if (!g || !pinId(g.id) || ids.has(g.id)) throw Error('贴图分组无效');
    ids.add(g.id);
    return { id: g.id, name: pinName(g.name) };
  });
  const pins = v.pins.map((p) => {
    if (
      !p ||
      !pinId(p.id) ||
      ids.has(p.id) ||
      (p.group !== null && !groups.some((g) => g.id === p.group)) ||
      !Number.isSafeInteger(p.created) ||
      p.created <= 0
    )
      throw Error('贴图记录无效');
    ids.add(p.id);
    const c = p.content,
      w = p.view;
    let content: PinContent;
    if (c?.kind === 'image') {
      imageDimensions(c.width, c.height);
      if (!/^[a-f0-9]{64}$/.test(c.hash)) throw Error('贴图图片无效');
      content = { kind: 'image', hash: c.hash, width: c.width, height: c.height };
    } else if (c?.kind === 'text') {
      if (
        typeof c.text !== 'string' ||
        !c.text.trim() ||
        c.text.length > 50000 ||
        c.text.includes('\0')
      )
        throw Error('贴图文字无效');
      content = { kind: 'text', text: c.text };
    } else if (c?.kind === 'files') {
      if (!Array.isArray(c.files) || !c.files.length || c.files.length > PIN_FILE_LIMIT)
        throw Error('贴图文件无效');
      content = {
        kind: 'files',
        files: c.files.map((f) => {
          if (
            !f ||
            typeof f.path !== 'string' ||
            !/^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+\\)/i.test(f.path) ||
            f.path.length > 32760 ||
            /[\x00-\x1f]/.test(f.path) ||
            typeof f.directory !== 'boolean'
          )
            throw Error('贴图文件路径无效');
          if (
            typeof f.name !== 'string' ||
            !f.name.trim() ||
            f.name.length > 255 ||
            /[\x00-\x1f]/.test(f.name)
          )
            throw Error('贴图文件名无效');
          return { path: f.path, name: f.name, directory: f.directory };
        }),
      };
    } else throw Error('贴图内容无效');
    if (
      !w ||
      ![w.x, w.y].every((n) => Number.isSafeInteger(n) && Math.abs(n) <= 100000) ||
      !Number.isFinite(w.scale) ||
      w.scale < 0.01 ||
      w.scale > 8 ||
      ![0, 1, 2, 3].includes(w.rotation) ||
      !Number.isFinite(w.opacity) ||
      w.opacity < 0.2 ||
      w.opacity > 1 ||
      ![w.flipX, w.flipY, w.visible, w.passThrough].every((n) => typeof n === 'boolean')
    )
      throw Error('贴图显示设置无效');
    const size = pinSize(content, w);
    if (size.width > 8192 || size.height > 8192 || size.width * size.height > IMAGE_PIXELS)
      throw Error('贴图显示尺寸过大');
    return {
      id: p.id,
      title: pinName(p.title),
      group: p.group,
      created: p.created,
      content,
      view: {
        x: w.x,
        y: w.y,
        scale: w.scale,
        rotation: w.rotation,
        flipX: w.flipX,
        flipY: w.flipY,
        opacity: w.opacity,
        passThrough: w.passThrough,
        visible: w.visible,
      },
    };
  });
  if (pins.filter((p) => p.view.visible).length > PIN_VISIBLE_LIMIT)
    throw Error('最多同时显示 20 个贴图');
  return { format:'one-pin-workspace', version: 1, pins, groups };
}

export interface PinsAPI {
  pinsState():Promise<PinWorkspace>;
  pinsOpenMaterial(id:string):Promise<string>;
  pinsClipboard():Promise<string>;
  pinsFiles():Promise<string|undefined>;
  pinsAction(id:string,action:PinAction):Promise<void>;
  pinsGroup(id:string|null,action:PinGroupAction):Promise<void>;
  pinsToggle():Promise<void>;
  pinsNextGroup():Promise<void>;
  pinsPreview(id:string):Promise<string|null>;
  onPinsChanged(callback:()=>void):()=>void;
}
