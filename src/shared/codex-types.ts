import type {AIModel,AIProfile} from './ai';
export type {AIModel,AIProfile};
export interface CodexStatus {available:boolean;loggedIn:boolean;email?:string;planType?:string;login:'idle'|'starting'|'pending'|'complete'|'error';verificationUrl?:string;userCode?:string;error?:string;executablePath?:string;customExecutable?:string}
export interface AIResult {text:string;model:string;inputTokens?:number;outputTokens?:number;truncated:boolean}
export const MAX_TOOL_OUTPUT=1024*1024;
export function toolText(value:unknown,limit=MAX_TOOL_OUTPUT){if(typeof value!=='string'||!value.trim()||Buffer.byteLength(value)>limit)throw Error('Codex 返回文字为空或过长');return value;}
export function reasoningEffort(value:unknown){if(value===undefined)return '';if(typeof value!=='string'||value.length>40||value!==''&&!/^[a-z][a-z0-9_-]*$/.test(value))throw Error('推理强度无效');return value;}
