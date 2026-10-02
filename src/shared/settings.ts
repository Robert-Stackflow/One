import {defaultDiskMonitor,validateDiskMonitor} from './disk-monitor';
import {defaultEcho,validateEcho} from './echo';
import {defaultQuickActions,validateQuickActions,defaultCapsPreferences,validateCapsPreferences} from './quick-actions';
import {defaultPreview,validatePreview} from './preview';
import {defaultUtilities,validateUtilities} from './utilities';
import {validFont} from './fonts';
import {defaultSearch,validateSearch} from './search';
import type { Settings, Appearance } from './types';
import {colorFormatNames,type ColorFormat} from './colors';
/** Merge only known preference keys; arrays are replaced as a unit. */
export function mergeSettings(current:Settings, patch:unknown):Settings {
  const merge=(base:any,delta:any):any=>{
    if(!delta||typeof delta!=='object'||Array.isArray(delta))throw new Error('设置变更格式无效');
    const result={...base};
    for(const key of Object.keys(delta)){
      if(!Object.hasOwn(base,key)||['__proto__','prototype','constructor'].includes(key))throw new Error('未知设置项');
      const value=delta[key];
      result[key]=base[key]&&typeof base[key]==='object'&&!Array.isArray(base[key])?merge(base[key],value):value;
    }
    return result;
  };
  return validateSettings(merge(current,patch));
}
export const defaultAppearance = (): Appearance => ({mode:'system',accent:'#303030',font:'system',density:'comfortable',radius:10,lightBackground:'#ffffff',lightForeground:'#202020',darkBackground:'#181818',darkForeground:'#ededed',toastPosition:'bottom-center'});
const binding = () => ({shortcut:'',command:'',args:[] as string[],cwd:''});
export const defaultSettings = (): Settings => ({ quickActions:defaultQuickActions(),capsLock:defaultCapsPreferences(),diskMonitor:defaultDiskMonitor(),preview:defaultPreview(),echo:defaultEcho(),general:{launchAtLogin:false,closeToTray:true},search:defaultSearch(),utilities:defaultUtilities(),keyEcho: false, onlyCombinations: true, edgeScroll: false, copyMenu: false, explorerPreview: false, pauseFullscreen: true, excludedApps: '', dwellMs: 650, cornerPixels: 12, cooldownMs: 1200, copyIntervalMs: 450, volumeStep: 2, edgePixels: 8, corners: { TL: 'off', TR: 'off', BL: 'off', BR: 'off' }, edges: { top: { action: 'off', step: 2 }, right: { action: 'volume', step: 2 }, bottom: { action: 'off', step: 2 }, left: { action: 'volume', step: 2 } }, cornerBindings:{TL:binding(),TR:binding(),BL:binding(),BR:binding()},appearance:defaultAppearance(),colorShortcut:'Control+Alt+C',colorHistory:[],colorFormat:'hex',colorVisibleFormats:['hex','rgb','hsl','hsv','oklch','cmyk'],colorShowEditor:true });
export function validateSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object') throw new Error('设置格式无效');
  const v = value as Settings; const d = defaultSettings();d.quickActions=validateQuickActions(v.quickActions);d.capsLock=validateCapsPreferences(v.capsLock);d.diskMonitor=validateDiskMonitor(v.diskMonitor);d.echo=validateEcho(v.echo);d.preview=validatePreview(v.preview);
  if(v.general !== undefined){if(!v.general||typeof v.general.launchAtLogin!=='boolean'||typeof v.general.closeToTray!=='boolean')throw new Error('基本设置无效');d.general={...v.general};}
  for (const k of ['keyEcho','onlyCombinations','edgeScroll','copyMenu','explorerPreview','pauseFullscreen'] as const) { if (typeof v[k] !== 'boolean') throw new Error('开关格式无效'); d[k] = v[k]; }
  for (const [k, min, max] of [['dwellMs',150,5000],['cornerPixels',2,100],['cooldownMs',200,10000],['copyIntervalMs',150,1000],['volumeStep',1,20],['edgePixels',2,50]] as const) { if (!Number.isInteger(v[k]) || v[k] < min || v[k] > max) throw new Error(`${k} 参数超出范围`); d[k] = v[k]; }
  if (typeof v.excludedApps !== 'string' || v.excludedApps.length > 2000) throw new Error('排除列表格式无效'); d.excludedApps = v.excludedApps;
  for (const k of ['TL','TR','BL','BR'] as const) {
    if (!['off','desktop','tasks','lock','one','start','explorer','screenshot','color','hotkey','command'].includes(v.corners?.[k])) throw new Error('角部动作无效'); d.corners[k] = v.corners[k];
    const b = v.cornerBindings?.[k];
    if (b) { if (typeof b.shortcut !== 'string' || b.shortcut.length > 100 || typeof b.command !== 'string' || b.command.length > 32768 || /[\r\n\0]/.test(b.command) || typeof b.cwd !== 'string' || b.cwd.length > 32768 || !Array.isArray(b.args) || b.args.length > 64 || b.args.some(a => typeof a !== 'string' || a.length > 32768 || a.includes('\0'))) throw new Error('自定义动作参数无效'); d.cornerBindings[k] = {shortcut:b.shortcut,command:b.command,args:[...b.args],cwd:b.cwd}; }
    if (d.corners[k] === 'hotkey' && !/^(?:(?:Ctrl|Control|Alt|Shift|Win|Meta)\+)*(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Space|Tab|Enter|Escape|Backspace|Delete|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/i.test(d.cornerBindings[k].shortcut)) throw new Error('快捷键格式无效，例如 Ctrl+Shift+S');
    if (d.corners[k] === 'command' && !d.cornerBindings[k].command.trim()) throw new Error('请填写要执行的程序');
  }
  for (const k of ['top','right','bottom','left'] as const) {
    // Upgrade 0.1 preferences without changing the original left/right behavior.
    if (v.edges === undefined) { d.edges[k].step = d.volumeStep; continue; }
    const edge = v.edges?.[k];
    if (!edge || !['off','volume','brightness'].includes(edge.action) || !Number.isInteger(edge.step) || edge.step < 1 || edge.step > 20) throw new Error('边缘动作或步长无效');
    d.edges[k] = { action: edge.action, step: edge.step };
  }
  if (v.appearance !== undefined) {
    const a = v.appearance;
    if (!a || !['system','light','dark'].includes(a.mode) || !validFont(a.font) || !['comfortable','compact'].includes(a.density) || !Number.isInteger(a.radius) || a.radius < 4 || a.radius > 16) throw new Error('外观参数无效');
    for (const key of ['accent','lightBackground','lightForeground','darkBackground','darkForeground'] as const) if (!/^#[0-9a-f]{6}$/i.test(a[key])) throw new Error('请输入六位十六进制颜色');
    if(a.toastPosition!==undefined&&!['top-left','top-center','top-right','bottom-left','bottom-center','bottom-right'].includes(a.toastPosition))throw new Error('提示位置无效');
    d.appearance = {...d.appearance,...a,toastPosition:a.toastPosition??d.appearance.toastPosition};
  }
  if (v.colorShortcut !== undefined) { if (typeof v.colorShortcut !== 'string' || v.colorShortcut.length > 100 || (v.colorShortcut && !/^(?:(?:Control|Ctrl|Alt|Shift|Super|Meta|Win)\+)+(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4]))$/i.test(v.colorShortcut))) throw new Error('取色快捷键格式无效'); d.colorShortcut = v.colorShortcut; }
  if (Array.isArray(v.colorHistory)) d.colorHistory = [...new Set(v.colorHistory.filter(x => typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x)).map(x=>x.toUpperCase()))].slice(0,20);
  if(v.colorShowEditor!==undefined){if(typeof v.colorShowEditor!=='boolean')throw new Error('取色弹窗设置无效');d.colorShowEditor=v.colorShowEditor;}
  if(v.colorFormat!==undefined){if(!Object.hasOwn(colorFormatNames,v.colorFormat))throw new Error('颜色格式无效');d.colorFormat=v.colorFormat;}
  if(v.colorVisibleFormats!==undefined){if(!Array.isArray(v.colorVisibleFormats)||v.colorVisibleFormats.some(key=>!Object.hasOwn(colorFormatNames,key)))throw new Error('颜色格式无效');d.colorVisibleFormats=[...new Set(v.colorVisibleFormats)] as ColorFormat[];}
  d.copyMenu=false;d.utilities=validateUtilities(v.utilities);d.search=validateSearch(v.search);
  return d;
}
