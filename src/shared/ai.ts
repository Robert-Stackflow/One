export type AIKind='openai'|'ollama'|'lmstudio'|'codex';
export interface AIModel {id:string;name:string;reasoningEfforts?:string[]}
export interface AIProfile {id:string;name:string;kind:AIKind;baseUrl:string;model:string;models:AIModel[];reasoningEffort?:string;maxTokens:number;timeoutSeconds:number;temperature:number|null;tokenField:'max_tokens'|'max_completion_tokens';hasKey:boolean}
export interface AIProfileInput extends Omit<AIProfile,'id'|'hasKey'> {id?:string;apiKey?:string;clearKey?:boolean}
export type AIModelCatalogDraft=Pick<AIProfileInput,'kind'|'baseUrl'|'timeoutSeconds'|'apiKey'|'id'>;
export interface AICommand {id:string;name:string;prompt:string;builtin:boolean}
export interface AIImage {name:string;png:string}
export interface AIMessage {id:string;role:'user'|'assistant';text:string;images?:AIImage[];status:'complete'|'running'|'failed'|'cancelled';time:number;error?:string;model?:string}
export interface AIConversation {id:string;title:string;profileId:string;modelId?:string;reasoningEffort?:string;updated:number;messages:AIMessage[]}
export interface AIHistoryEntry {id:string;query:string;command:string;time:number;result?:string;engineId?:string}
export interface AIState {profiles:AIProfile[];defaultId:string;commands:AICommand[];conversations:AIConversation[];shortcut:string;shortcutError:string;history:AIHistoryEntry[];chatOptions:{onTop:boolean;keepOpen:boolean}}
export type AIEvent={kind:'changed'}|{kind:'delta';conversationId:string;messageId:string;text:string;offset:number}|{kind:'inline-delta';requestId:string;text:string;offset:number};

export const builtinAICommands:AICommand[]=[
 {id:'translate',name:'翻译',prompt:'将以下内容翻译为简体中文。保留原意、专有名词、格式和代码。只返回译文。\n\n{{text}}',builtin:true},
 {id:'summarize',name:'总结',prompt:'简洁总结以下内容，保留关键事实和不确定性。只返回总结。\n\n{{text}}',builtin:true},
 {id:'rewrite',name:'改写',prompt:'改善以下内容的表达和语法，保留原意、事实和语气。只返回改写后的文字。\n\n{{text}}',builtin:true},
 {id:'search',name:'搜索',prompt:'根据以下问题给出可靠的检索思路和已知信息，标明不确定的内容。没有实时网页访问时，不要声称已完成联网搜索。\n\n{{text}}',builtin:true}
];
export function validateAIImages(value:unknown):AIImage[]{
 if(!Array.isArray(value)||value.length>4)throw Error('每条消息最多添加 4 张图片');let total=0;
 return value.map(item=>{if(!item||typeof item.name!=='string'||item.name.length>120||typeof item.png!=='string'||!/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(item.png))throw Error('图片格式无效');total+=item.png.length;if(total>22*1024*1024)throw Error('图片总大小超过 16 MiB');return {name:item.name,png:item.png};});
}
export function validateAIProfile(value:unknown):AIProfileInput{
 const v=value as AIProfileInput;
 if(!v||typeof v.name!=='string'||!v.name.trim()||v.name.length>60||!['openai','ollama','lmstudio','codex'].includes(v.kind)||typeof v.model!=='string'||v.model.length>200||/[\r\n]/.test(v.model))throw Error('AI 服务名称、类型或模型无效');
 const models=v.models??[];if(!Array.isArray(models)||models.length>100||models.some(item=>!item||typeof item.id!=='string'||!item.id.trim()||item.id.length>200||/[\r\n]/.test(item.id)||typeof item.name!=='string'||!item.name.trim()||item.name.length>120))throw Error('模型列表无效');
 if(v.model&&models.length&&!models.some(item=>item.id===v.model))throw Error('默认模型不在模型列表中');
 if(v.reasoningEffort!==undefined&&(typeof v.reasoningEffort!=='string'||v.reasoningEffort.length>40||v.reasoningEffort!==''&&!/^[a-z][a-z0-9_-]*$/.test(v.reasoningEffort)))throw Error('推理强度无效');
 if(!Number.isInteger(v.maxTokens)||v.maxTokens<64||v.maxTokens>16384||!Number.isInteger(v.timeoutSeconds)||v.timeoutSeconds<5||v.timeoutSeconds>300||v.temperature!==null&&(!Number.isFinite(v.temperature)||v.temperature<0||v.temperature>2)||!['max_tokens','max_completion_tokens'].includes(v.tokenField))throw Error('输出上限、等待时间或温度无效');
 if(v.id!==undefined&&(typeof v.id!=='string'||!/^[-a-f0-9]{36}$/i.test(v.id)))throw Error('服务 ID 无效');
 if(models.some(item=>item.reasoningEfforts!==undefined&&(!Array.isArray(item.reasoningEfforts)||item.reasoningEfforts.length>16||item.reasoningEfforts.some(effort=>typeof effort!=='string'||!/^[a-z][a-z0-9_-]*$/.test(effort)))))throw Error('模型推理强度无效');
 if(v.kind==='codex'){if(v.baseUrl!=='codex://local')throw Error('Codex 服务地址无效');return {...v,name:v.name.trim(),model:v.model.trim(),models:models.map(item=>({id:item.id.trim(),name:item.name.trim(),...(item.reasoningEfforts?{reasoningEfforts:item.reasoningEfforts}:{})})),apiKey:undefined,clearKey:true};}
 if(typeof v.baseUrl!=='string'||v.baseUrl.length>2048)throw Error('服务地址无效');
 let url:URL;try{url=new URL(v.baseUrl);}catch{throw Error('请输入完整服务地址');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('服务地址不能包含凭据、参数或锚点');
 const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if(!local&&url.protocol!=='https:')throw Error('远程 AI 服务必须使用 HTTPS');
 if(v.kind!=='openai'&&!local)throw Error('本地模型服务只允许本机地址');
 if(v.apiKey!==undefined&&(typeof v.apiKey!=='string'||v.apiKey.length>8192||/[\r\n]/.test(v.apiKey)))throw Error('密钥无效');
 return {id:v.id,name:v.name.trim(),kind:v.kind,baseUrl:url.toString().replace(/\/$/,''),model:v.model.trim(),models:models.map(item=>({id:item.id.trim(),name:item.name.trim(),...(item.reasoningEfforts?{reasoningEfforts:item.reasoningEfforts}:{})})),reasoningEffort:v.reasoningEffort,maxTokens:v.maxTokens,timeoutSeconds:v.timeoutSeconds,temperature:v.temperature,tokenField:v.tokenField,apiKey:v.apiKey,clearKey:v.clearKey};
}
export function aiEndpoint(profile:Pick<AIProfile,'baseUrl'|'kind'>,models=false){return profile.baseUrl.replace(/\/$/,'')+(profile.kind==='ollama'?(models?'/api/tags':'/api/chat'):(models?'/models':'/chat/completions'));}
export function renderAIPrompt(command:AICommand,text:string){return command.prompt.replaceAll('{{text}}',text);}
