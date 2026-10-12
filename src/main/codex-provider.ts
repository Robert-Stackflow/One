import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
const tr=(text:string)=>text;
import {MAX_TOOL_OUTPUT,toolText,reasoningEffort,type AIModel,type AIProfile,type AIResult,type CodexStatus} from '../shared/codex-types';
import {codexExecutables,CodexRuntimeError,codexUnavailable} from './codex-runtime';
export {codexExecutable,codexExecutables} from './codex-runtime';

type Message={role:string;content:string;images?:{png:string;name:string}[]};
type GenerationOptions={chat?:boolean;delta?:(text:string)=>void};
type Event={method:string;params:any};
export interface CodexBackend {
 status():Promise<CodexStatus>;login():Promise<CodexStatus>;cancelLogin():Promise<void>;logout():Promise<void>;
 models(signal:AbortSignal):Promise<string[]>;catalog?(signal:AbortSignal):Promise<AIModel[]>;generate(profile:AIProfile,messages:Message[],signal:AbortSignal,png?:string,options?:GenerationOptions):Promise<AIResult>;dispose():void;
}
const unavailable=codexUnavailable;
const failed=(error?:any,method?:string)=>{
 const info=error?.codexErrorInfo||error?.data?.codexErrorInfo,kind=typeof info==='string'?info:info&&typeof info==='object'?Object.keys(info)[0]:undefined;
 const http=kind&&typeof info==='object'?info[kind]?.httpStatusCode:undefined,code=Number.isSafeInteger(error?.code)?error.code:undefined;
 let hint=tr('Codex 请求失败，请检查登录状态、网络、额度和模型');
 if(kind==='unauthorized'||http===401||http===403)hint=tr('Codex 认证失败，请重新登录');
 else if(kind==='usageLimitExceeded'||kind==='sessionBudgetExceeded')hint=tr('Codex 账户额度不足，请稍后重试');
 else if(kind==='rateLimitExceeded'||http===429)hint=tr('Codex 请求过于频繁或额度不足，请稍后重试');
 else if(kind==='contextWindowExceeded')hint=tr('内容超过 Codex 模型的上下文上限');
 else if(kind==='badRequest'||code===-32600||code===-32602)hint=tr('Codex 接口参数无效');
 else if(kind==='sandboxError')hint=tr('Codex 只读会话启动失败');
 else if(kind==='serverOverloaded'||kind==='internalServerError'||(http>=500&&http<=599))hint=tr('Codex 服务暂时不可用，请稍后重试');
 else if(['httpConnectionFailed','responseStreamConnectionFailed','responseStreamDisconnected','responseTooManyFailedAttempts'].includes(kind||''))hint=tr('Codex 连接中断，请检查网络后重试');
 const details=[method,code===undefined?undefined:'RPC '+code,Number.isSafeInteger(http)?'HTTP '+http:undefined].filter(Boolean).join(' · ');
 return new Error(details?`${hint} (${details})`:hint);
};
const aborted=()=>new Error('cancelled');
const config=['cli_auth_credentials_store="file"','features.shell_tool=false','web_search="disabled"','mcp_servers={}'];
function environment(home:string,proxy:string){
 const env:NodeJS.ProcessEnv={...process.env,CODEX_HOME:home};delete env.OPENAI_API_KEY;delete env.CODEX_API_KEY;
 // Native Codex does not read Windows Internet Settings. Forward Chromium's resolved route.
 const first=proxy.split(';').map(value=>value.trim()).find(Boolean)||'DIRECT',match=/^(PROXY|HTTP|HTTPS|SOCKS|SOCKS5)\s+([^\s/?#@]+:\d{1,5})$/.exec(first);
 if(match){const scheme=match[1]==='HTTPS'?'https':match[1].startsWith('SOCKS')?'socks5h':'http';try{const url=new URL(`${scheme}://${match[2]}`);if(url.hostname&&+match[2].slice(match[2].lastIndexOf(':')+1)>0){const value=url.href.replace(/\/$/,'');if(!env.HTTPS_PROXY&&!env.https_proxy&&!env.ALL_PROXY&&!env.all_proxy)env.HTTPS_PROXY=value;if(!env.HTTP_PROXY&&!env.http_proxy&&!env.ALL_PROXY&&!env.all_proxy)env.HTTP_PROXY=value;}}catch{}}
 return env;
}
/** The same local app-server protocol used by Pixal's Python SDK, without a Python dependency. */
export class CodexConnection {
 private child:ChildProcessWithoutNullStreams;private sequence=0;private ended=false;private buffer='';
 private pending=new Map<number,{method:string;resolve:(value:any)=>void;reject:(error:Error)=>void;clean:()=>void}>();
 private listeners=new Set<(event:Event)=>void>();private failures=new Set<(error:Error)=>void>();
 constructor(executable:string,home:string,cwd:string,proxy='DIRECT'){
  const env=environment(home,proxy);
  this.child=spawn(executable,['app-server',...config.flatMap(value=>['-c',value])],{cwd,env,windowsHide:true,stdio:['pipe','pipe','pipe'],shell:false});
  this.child.stdout.setEncoding('utf8');this.child.stdout.on('data',(chunk:string)=>this.receive(chunk));
  this.child.stderr.on('data',()=>{});this.child.on('error',()=>this.fail(unavailable()));this.child.on('exit',()=>this.fail(unavailable()));this.child.stdin.on('error',()=>this.fail(unavailable()));
 }
 private send(value:unknown){if(this.ended)throw unavailable();this.child.stdin.write(JSON.stringify(value)+'\n');}
 private receive(chunk:string){
  if(this.ended)return;
  this.buffer+=chunk;if(Buffer.byteLength(this.buffer)>24*1024*1024){this.fail(failed());this.close();return;}
  for(;;){if(this.ended)return;const at=this.buffer.indexOf('\n');if(at<0)return;const line=this.buffer.slice(0,at);this.buffer=this.buffer.slice(at+1);if(!line.trim())continue;
   let value:any;try{value=JSON.parse(line);}catch{this.fail(failed());this.close();return;}
   if(value.method&&value.id!==undefined){this.send({id:value.id,error:{code:-32601,message:'This client does not provide tools or approvals.'}});continue;}
   if(value.id!==undefined){const job=this.pending.get(value.id);if(job){this.pending.delete(value.id);job.clean();value.error?job.reject(failed(value.error,job.method)):job.resolve(value.result);}continue;}
   if(typeof value.method==='string')for(const listener of this.listeners)listener(value);
  }
 }
 private fail(error:Error){if(this.ended)return;this.ended=true;for(const job of this.pending.values()){job.clean();job.reject(error);}this.pending.clear();for(const listener of this.failures)listener(error);}
 on(listener:(event:Event)=>void){this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}
 onFailure(listener:(error:Error)=>void){this.failures.add(listener);return ()=>{this.failures.delete(listener);};}
 request(method:string,params:unknown={},signal?:AbortSignal):Promise<any>{
  if(signal?.aborted)return Promise.reject(aborted());if(this.ended)return Promise.reject(unavailable());const id=++this.sequence;
  return new Promise((resolve,reject)=>{
   const cancel=()=>{this.pending.delete(id);clean();reject(aborted());},timer=setTimeout(()=>{this.pending.delete(id);clean();reject(failed());},30000),clean=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);};
   this.pending.set(id,{method,resolve,reject,clean});signal?.addEventListener('abort',cancel,{once:true});try{this.send({id,method,params});}catch(error){this.pending.delete(id);clean();reject(error);}
  });
 }
 async initialize(signal?:AbortSignal){await this.request('initialize',{clientInfo:{name:'one',title:'One',version:'0.50.15'}},signal);this.send({method:'initialized',params:{}});}
 close(){this.fail(aborted());this.listeners.clear();this.failures.clear();this.child.kill();}
}
export class CodexProvider implements CodexBackend {
 private connection?:Promise<CodexConnection>;private loginState:CodexStatus={available:false,loggedIn:false,login:'idle'};private loginId='';private loginTimer?:ReturnType<typeof setTimeout>;private starting?:Promise<CodexStatus>;private disposed=false;
 private resolvedExecutable='';
 private catalogs=new Set<CodexConnection>();
 constructor(private home:()=>string,private executable:()=>string|string[]=codexExecutables,private proxy:()=>Promise<string>=async()=>'DIRECT'){}
 private async connect(home:string,cwd:string,signal?:AbortSignal){
  let proxy:string;try{proxy=await this.proxy();}catch{throw new Error(tr('无法读取系统代理，请检查网络设置后重试'));}if(this.disposed)throw unavailable();if(signal?.aborted)throw aborted();
  const found=this.executable(),candidates=typeof found==='string'?[found]:found;
  if(!candidates.length)throw new CodexRuntimeError(tr('未找到本机 Codex，请先安装 Codex 或选择已安装的程序'));
  const ordered=this.resolvedExecutable&&candidates.includes(this.resolvedExecutable)?[this.resolvedExecutable,...candidates.filter(file=>file!==this.resolvedExecutable)]:candidates;
  for(const file of ordered){
   const connection=new CodexConnection(file,home,cwd,proxy),controller=new AbortController(),cancel=()=>controller.abort(),timer=setTimeout(cancel,5000);signal?.addEventListener('abort',cancel,{once:true});
   try{await connection.initialize(controller.signal);await connection.request('account/read',{refreshToken:false},controller.signal);if(this.disposed)throw unavailable();if(signal?.aborted)throw aborted();this.resolvedExecutable=file;return connection;}
   catch{connection.close();if(this.disposed)throw unavailable();if(signal?.aborted)throw aborted();}
   finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
  this.resolvedExecutable='';throw unavailable();
 }
 private async control(){
  if(this.disposed)throw unavailable();
  if(!this.connection)this.connection=(async()=>{const home=resolve(this.home());await mkdir(home,{recursive:true,mode:0o700});const connection=await this.connect(home,home);
   connection.on(event=>{if(event.method==='account/login/completed'&&event.params.loginId===this.loginId){clearTimeout(this.loginTimer);this.loginId='';this.loginState={available:true,loggedIn:!!event.params.success,login:event.params.success?'complete':'error',...(!event.params.success?{error:tr('Codex 登录未完成，请重试')}: {})};}});
   connection.onFailure(()=>{this.connection=undefined;clearTimeout(this.loginTimer);this.loginId='';this.loginState={available:false,loggedIn:false,login:'error',error:unavailable().message};});return connection;
  })().catch(error=>{this.connection=undefined;throw error;});
  return this.connection;
 }
 async status():Promise<CodexStatus>{try{const result=await(await this.control()).request('account/read',{refreshToken:false});const account=result.account;return {...this.loginState,available:true,loggedIn:!!account,executablePath:this.resolvedExecutable,email:typeof account?.email==='string'?account.email:undefined,planType:typeof account?.planType==='string'?account.planType:undefined};}catch(error){return {available:false,loggedIn:false,login:'error',error:error instanceof CodexRuntimeError?error.message:unavailable().message};}}
 login():Promise<CodexStatus>{
  if(this.starting)return this.starting;if(this.loginId)return this.status();this.loginState={available:true,loggedIn:false,login:'starting'};
  this.starting=(async()=>{try{const result=await(await this.control()).request('account/login/start',{type:'chatgptDeviceCode'});const url=new URL(result.verificationUrl);if(url.protocol!=='https:'||url.hostname!=='auth.openai.com'||typeof result.userCode!=='string'||!/^[A-Z0-9-]{4,32}$/.test(result.userCode)||typeof result.loginId!=='string')throw failed();
   this.loginId=result.loginId;this.loginState={available:true,loggedIn:false,login:'pending',verificationUrl:url.href,userCode:result.userCode};this.loginTimer=setTimeout(()=>void this.cancelLogin().then(()=>{this.loginState={available:true,loggedIn:false,login:'error',error:tr('Codex 登录超时，请重试')};}).catch(()=>{}),600000);return {...this.loginState};
  }catch(error){this.loginState={available:!(error instanceof CodexRuntimeError),loggedIn:false,login:'error',error:error instanceof CodexRuntimeError?error.message:tr('Codex 登录未完成，请重试')};return {...this.loginState};}finally{this.starting=undefined;}})();return this.starting;
 }
 async cancelLogin(){clearTimeout(this.loginTimer);if(this.starting)await this.starting;const id=this.loginId;this.loginId='';this.loginState={available:true,loggedIn:false,login:'idle'};if(id)await(await this.control()).request('account/login/cancel',{loginId:id});}
 async logout(){await this.cancelLogin();await(await this.control()).request('account/logout');this.loginState={available:true,loggedIn:false,login:'idle'};}
 async models(signal:AbortSignal){return (await this.catalog(signal)).map(model=>model.id);}
 async catalog(signal:AbortSignal){
  // A fresh process reads the currently installed binary and refreshes version-specific model data.
  const home=resolve(this.home());await mkdir(home,{recursive:true,mode:0o700});const connection=await this.connect(home,home,signal);this.catalogs.add(connection);
  try{let cursor:string|undefined;const models=new Map<string,AIModel>();for(let page=0;page<5;page++){const result=await connection.request('model/list',{limit:100,includeHidden:false,...(cursor?{cursor}:{})},signal);if(!Array.isArray(result.data))throw failed();for(const item of result.data){const id=item.model||item.id;if(typeof id!=='string'||!id.length||id.length>200||/[\r\n]/.test(id))continue;const name=typeof item.displayName==='string'&&item.displayName.trim()?item.displayName.trim().slice(0,120):id;const efforts=Array.isArray(item.supportedReasoningEfforts)?item.supportedReasoningEfforts.flatMap((option:any)=>{try{const effort=reasoningEffort(option.reasoningEffort);return effort?[effort]:[];}catch{return [];}}):undefined;models.set(id,{id,name,...(efforts?{reasoningEfforts:[...new Set<string>(efforts)].slice(0,16)}:{})});}if(typeof result.nextCursor!=='string'||!result.nextCursor||result.nextCursor===cursor)break;cursor=result.nextCursor;}return [...models.values()].slice(0,100);}finally{this.catalogs.delete(connection);connection.close();}
 }
 async generate(profile:AIProfile,messages:Message[],signal:AbortSignal,png?:string,options:GenerationOptions={}):Promise<AIResult>{
  if(signal.aborted)throw aborted();if(this.loginId||this.starting)throw new Error(tr('请先完成 Codex 账户授权'));const home=resolve(this.home());await mkdir(home,{recursive:true,mode:0o700});const directory=await mkdtemp(join(tmpdir(),'one-codex-'));let connection:CodexConnection|undefined;
  try{
   connection=await this.connect(home,directory,signal);if(signal.aborted)throw aborted();const account=await connection.request('account/read',{refreshToken:false},signal);if(!account.account)throw new Error(tr('请先在 AI 服务中登录 Codex'));
   const instructions=messages.filter(message=>message.role==='system').map(message=>message.content).join('\n')+(options.chat?'\nContinue the conversation encoded as JSON messages in the user input. Preserve the user and assistant roles. Answer the final user message. Images are labelled by their message and attachment index.':'\nOnly transform the provided text or image.')+' Do not execute commands, browse, access other files, or use tools.';
   const thread=await connection.request('thread/start',{model:profile.model||null,cwd:directory,ephemeral:true,sandbox:'read-only',approvalPolicy:'never',baseInstructions:instructions},signal),threadId=thread.thread?.id;if(typeof threadId!=='string')throw failed();
   const conversation=messages.filter(message=>message.role!=='system'),input:any[]=[{type:'text',text:options.chat?JSON.stringify(conversation.map(({role,content,images},index)=>({role,content,...(images?.length?{images:images.map((_image,attachment)=>`message-${index}-image-${attachment}.png`)}:{})}))):conversation.map(message=>message.content).join('\n'),text_elements:[]}];if(png){const image=join(directory,'input.png');await writeFile(image,Buffer.from(png,'base64'),{mode:0o600});input.push({type:'localImage',path:image});}
   if(options.chat)for(const [index,message]of conversation.entries())for(const [attachment,value]of (message.images||[]).entries()){const image=join(directory,`message-${index}-image-${attachment}.png`);await writeFile(image,Buffer.from(value.png,'base64'),{mode:0o600});input.push({type:'localImage',path:image});}
   if(signal.aborted)throw aborted();const client=connection;
   return await new Promise<AIResult>((resolve,reject)=>{
    let turnId='',settled=false,bytes=0,text='',inputTokens:number|undefined,outputTokens:number|undefined;const finals=new Map<string,string>(),commentary=new Set<string>();
    const finish=(error?:Error,result?:AIResult)=>{if(settled)return;settled=true;off();offFailure();signal.removeEventListener('abort',cancel);error?reject(error):resolve(result!);};
    const cancel=()=>{if(turnId)void client.request('turn/interrupt',{threadId,turnId}).catch(()=>{});finish(aborted());client.close();};
    const offFailure=client.onFailure(error=>finish(error)),off=client.on(event=>{const p=event.params;if(p?.threadId!==threadId||(turnId&&p.turnId&&p.turnId!==turnId))return;
     if(event.method==='item/started'&&p.item?.type==='agentMessage'&&p.item.phase==='commentary')commentary.add(p.item.id);
     if(event.method==='item/agentMessage/delta'&&typeof p.delta==='string'&&!commentary.has(p.itemId)&&p.phase!=='commentary'){bytes+=Buffer.byteLength(p.delta);if(bytes>MAX_TOOL_OUTPUT){finish(new Error(tr('Codex 返回文字超过 1 MiB')));client.close();return;}text+=p.delta;options.delta?.(p.delta);}
     if(event.method==='item/completed'&&p.item?.type==='agentMessage'&&p.item.phase!=='commentary'&&typeof p.item.text==='string'){if(Buffer.byteLength(p.item.text)>MAX_TOOL_OUTPUT){finish(new Error(tr('Codex 返回文字超过 1 MiB')));client.close();return;}finals.set(p.item.id,p.item.text);}
     if(event.method==='thread/tokenUsage/updated'){const last=p.tokenUsage?.last;inputTokens=Number.isSafeInteger(last?.inputTokens)?last.inputTokens:undefined;outputTokens=Number.isSafeInteger(last?.outputTokens)?last.outputTokens:undefined;}
     if(event.method==='turn/completed'){if(turnId&&p.turn?.id!==turnId)return;if(p.turn?.status!=='completed'){finish(p.turn?.status==='interrupted'?aborted():failed(p.turn?.error));return;}try{const completed=p.turn.items?.filter((item:any)=>item.type==='agentMessage'&&item.phase!=='commentary').map((item:any)=>item.text).filter((value:any)=>typeof value==='string');const result=completed?.length?completed.join('\n\n'):finals.size?[...finals.values()].join('\n\n'):text;finish(undefined,{text:toolText(result,MAX_TOOL_OUTPUT),model:thread.model||profile.model||'Codex',inputTokens,outputTokens,truncated:false});}catch(error){finish(error as Error);}}
    });signal.addEventListener('abort',cancel,{once:true});if(signal.aborted){cancel();return;}void client.request('turn/start',{threadId,input,...(profile.reasoningEffort?{effort:profile.reasoningEffort}:{})},signal).then(result=>{turnId=result.turn?.id||'';if(!turnId)finish(failed());},error=>finish(error));
   });
  }finally{connection?.close();if(dirname(resolve(directory))===resolve(tmpdir())&&directory.startsWith(join(resolve(tmpdir()),'one-codex-')))await rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
 }
 dispose(){this.disposed=true;clearTimeout(this.loginTimer);for(const connection of this.catalogs)connection.close();this.catalogs.clear();void this.connection?.then(connection=>connection.close()).catch(()=>{});this.connection=undefined;}
}
