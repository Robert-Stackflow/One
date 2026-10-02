import type {EchoChannel} from './echo';
export interface EchoFrame {text:string;channel:EchoChannel|'level';enter:boolean}
export type HUDContent={kind:'level';action:'volume'|'brightness';value:number}|{kind:'lock';label:string;enabled:boolean}|{kind:'keys';keys:string[]}|{kind:'ime';mode:string;language:string}|{kind:'message';text:string};
export function hudContent(text:string,channel?:EchoFrame['channel']):HUDContent{
 const level=/^(音量|亮度)\s+(\d+)%$/.exec(text);if(level)return {kind:'level',action:level[1]==='音量'?'volume':'brightness',value:Math.max(0,Math.min(100,Number(level[2])))};
 const lock=/^(Caps Lock|Num Lock|Scroll Lock)\s*·\s*(开启|关闭)$/.exec(text);if(lock)return {kind:'lock',label:lock[1],enabled:lock[2]==='开启'};
 const ime=/^(中|A)\s*·\s*(.+)$/.exec(text);if(ime&&channel!=='keys')return {kind:'ime',mode:ime[1],language:ime[2]};
 if(channel==='keys'||text.includes(' + '))return {kind:'keys',keys:text.split(' + ').map(key=>({Escape:'Esc',Control:'Ctrl',CapsLock:'Caps Lock',NumLock:'Num Lock',ScrollLock:'Scroll Lock',ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→',Backspace:'Backspace',NumpadEnter:'Num Enter'} as Record<string,string>)[key]||key)};
 return {kind:'message',text};
}
