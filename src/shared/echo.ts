export type EchoChannel='keys'|'ime'|'caps'|'num'|'scroll';
export interface EchoPlacement {enabled:boolean;x:number;y:number;display:string;duration:number}
export type EchoSettings=Record<EchoChannel,EchoPlacement>;
export const echoNames:Record<EchoChannel,string>={keys:'键盘操作',ime:'输入法',caps:'Caps Lock',num:'Num Lock',scroll:'Scroll Lock'};
export function defaultEcho():EchoSettings{return Object.fromEntries(Object.keys(echoNames).map(key=>[key,{enabled:key==='keys',x:.5,y:.86,display:'cursor',duration:1300}])) as EchoSettings;}
export function validateEcho(value:unknown):EchoSettings{const d=defaultEcho();if(value===undefined)return d;for(const key of Object.keys(d) as EchoChannel[]){const v=(value as EchoSettings)?.[key];if(!v||typeof v.enabled!=='boolean'||!Number.isFinite(v.x)||v.x<0||v.x>1||!Number.isFinite(v.y)||v.y<0||v.y>1||typeof v.display!=='string'||v.display.length>40||!Number.isInteger(v.duration)||v.duration<300||v.duration>10000)throw new Error('回显位置或持续时间无效');d[key]={...v};}
 // Upgrade earlier per-channel positions to the shared keyboard hint position.
 const {x,y,display}=d.keys;for(const key of Object.keys(d) as EchoChannel[])Object.assign(d[key],{x,y,display});return d;}
