import {execFile} from 'node:child_process';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {session} from 'electron';
import {proxySites,proxyDiagnosticsJob,type ProxyAdapter,type ProxyConfiguration,type ProxyConnectivityReport,type ProxyDiagnostics,type ProxyDiagnosticsProgress,type ProxyEnvironment,type ProxyExit,type ProxyMode,type ProxyProcess,type ProxySiteResult} from '../shared/proxy-info';
import {checkProxySite,proxyCurl,proxyFailure,publicProxyUrl,runProxyWorkers,validateConnectivityRequest} from './proxy-connectivity';
import type {InformationGroup} from '../shared/system-info';

const run=promisify(execFile);
const powershell=join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
const short=(value:unknown,limit=250)=>String(value??'').trim().slice(0,limit);
export function safeProxyValue(value:string){try{const url=new URL(value);if(url.username||url.password){url.username='';url.password='';}url.search='';url.hash='';return url.toString();}catch{return value.replace(/(https?:\/\/|socks\d?h?:\/\/|(?:https?|socks)=)[^@;\s]+@/gi,'$1').slice(0,300);}}
function endpoint(value:string){const raw=value.trim();if(!raw)return null;const url=new URL(/^[a-z][\w+.-]*:\/\//i.test(raw)?raw:`http://${raw}`);if(url.username||url.password||!url.hostname||!url.port&&url.protocol!=='http:'&&url.protocol!=='https:')return null;if(!['http:','https:','socks4:','socks4a:','socks5:','socks5h:'].includes(url.protocol))return null;url.pathname='/';url.search='';url.hash='';if(url.protocol==='socks5:')url.protocol='socks5h:';return url.toString().replace(/\/$/,'');}
export function manualProxy(server:string){const entries=server.split(';').map(v=>v.trim()).filter(Boolean);const pick=(name:string)=>entries.find(v=>v.toLowerCase().startsWith(name+'='))?.split('=').slice(1).join('=');const value=pick('https')||pick('http');if(value)return endpoint(value);const socks=pick('socks');if(socks)return endpoint(`socks5h://${socks}`);const single=entries.find(v=>!v.includes('='));return single?endpoint(single):null;}
export function routeFromElectron(value:string){for(const item of value.split(';')){const [kind,host]=item.trim().split(/\s+/,2);if(kind==='DIRECT')return null;if(!host)continue;const scheme=kind==='SOCKS5'?'socks5h':kind==='SOCKS'?'socks4':kind==='HTTPS'?'https':kind==='PROXY'?'http':'';if(scheme){try{return endpoint(`${scheme}://${host}`);}catch{}}}return null;}
export async function readProxyConfiguration(signal?:AbortSignal):Promise<ProxyConfiguration>{
 try{const result=await run(powershell,['-NoProfile','-NonInteractive','-File',join(__dirname,'proxy-info.ps1').replace('app.asar\\','app.asar.unpacked\\')],{windowsHide:true,timeout:20000,maxBuffer:2*1024*1024,encoding:'utf8',signal});const raw=JSON.parse(result.stdout);
  const scopes:Record<string,ProxyEnvironment['scope']>={Process:'进程',User:'用户',Machine:'系统'};
  return {environment:(Array.isArray(raw.environment)?raw.environment:[]).slice(0,40).map((item:any)=>({scope:scopes[item.scope]||'进程',name:short(item.name,40),value:safeProxyValue(short(item.value,500))})),windows:{enabled:!!raw.windows?.enabled,server:safeProxyValue(short(raw.windows?.server,500)),pac:safeProxyValue(short(raw.windows?.pac,500)),autoDetect:!!raw.windows?.autoDetect,bypass:short(raw.windows?.bypass,500),winHttp:safeProxyValue(short(raw.windows?.winHttp,1000))},processes:(Array.isArray(raw.processes)?raw.processes:[]).slice(0,80).map((item:any):ProxyProcess=>({name:short(item.name,120),pid:Number(item.pid)||0,path:short(item.path,500)})),adapters:(Array.isArray(raw.adapters)?raw.adapters:[]).slice(0,80).map((item:any):ProxyAdapter=>({name:short(item.name,120),description:short(item.description,250),status:short(item.status,80),mac:short(item.mac,80),index:Number(item.index)||0,addresses:Array.isArray(item.addresses)?item.addresses.map((v:unknown)=>short(v,100)):[],gateways:Array.isArray(item.gateways)?item.gateways.map((v:unknown)=>short(v,100)):[],dns:Array.isArray(item.dns)?item.dns.map((v:unknown)=>short(v,100)):[],virtual:!!item.virtual}))};
 }catch(error){signal?.throwIfAborted();return {environment:[],windows:{enabled:false,server:'',pac:'',autoDetect:false,bypass:'',winHttp:''},processes:[],adapters:[],error:'暂时无法读取系统代理配置'};}
}
export function proxyInformationGroups(config:ProxyConfiguration):InformationGroup[]{const field=(key:string,label:string,value:unknown)=>({key,label,value:short(value)||'未报告'});return [
 {id:'proxy-settings',title:'系统代理',records:[{title:'Windows 代理设置',fields:[field('enabled','手动代理',config.windows.enabled?'已开启':'未开启'),field('server','代理服务器',config.windows.server),field('pac','PAC 地址',config.windows.pac),field('autoDetect','自动检测',config.windows.autoDetect?'已开启':'未开启'),field('bypass','绕过地址',config.windows.bypass),field('winHttp','WinHTTP',config.windows.winHttp)]}],error:config.error},
 {id:'proxy-environment',title:'代理环境变量',records:config.environment.map(item=>({title:`${item.name} · ${item.scope}`,fields:[field('scope','作用域',item.scope),field('value','值',item.value)]}))},
 {id:'proxy-processes',title:'检测到的相关进程',records:config.processes.map(item=>({title:item.name,fields:[field('pid','PID',item.pid),field('path','程序路径',item.path)]}))},
 {id:'proxy-adapters',title:'虚拟网卡',records:config.adapters.map(item=>({title:item.name,fields:[field('status','状态',item.status),field('description','适配器',item.description),field('addresses','IP / 前缀',item.addresses.join(' · ')),field('gateways','默认网关',item.gateways.join(' · ')),field('dns','DNS',item.dns.join(' · ')),field('mac','MAC',item.mac),field('index','接口索引',item.index)]}))}
 ];}

async function geo(mode:ProxyMode,signal:AbortSignal,resolve:(url:string)=>Promise<string|null>):Promise<ProxyExit> {
 for(const [url,source] of [['https://ipapi.co/json/','ipapi.co'],['https://ipinfo.io/json','ipinfo.io']] as const){
  try{
   const proxy=mode==='proxy'?await resolve(url):null;
   if(mode==='proxy'&&!proxy)return {mode,status:'unavailable',detail:'未检测到显式代理；TUN / VPN 路由无法与直连隔离'};
   const raw=JSON.parse(await proxyCurl(url,mode,proxy,signal,true));
   if(!raw.ip||raw.error)throw Error('IP 服务未返回有效结果');
   const [latitude,longitude]=typeof raw.loc==='string'?raw.loc.split(',').map(Number):[Number(raw.latitude),Number(raw.longitude)];
   return {mode,status:'ok',ip:short(raw.ip,80),country:short(raw.country_name||raw.country,100),region:short(raw.region,100),city:short(raw.city,100),latitude:Number.isFinite(latitude)?latitude:undefined,longitude:Number.isFinite(longitude)?longitude:undefined,asn:short(raw.asn||raw.org?.match(/AS\d+/)?.[0],50),organization:short(raw.org,150),source};
  }catch(error){signal.throwIfAborted();if(source==='ipinfo.io')return {mode,status:'failed',detail:proxyFailure(error).detail};}
 }
 return {mode,status:'failed',detail:'IP 信息服务不可用'};
}

export class ProxyDiagnosticsService {
 private pending?:Promise<ProxyDiagnostics>;
 private cached?:ProxyDiagnostics;
 private stopped=false;
 private active?:{id:string;controller:AbortController};
 constructor(private progress:(value:ProxyDiagnosticsProgress)=>void){}
 private begin(id:string){
  if(this.stopped)throw Error('代理检测服务已关闭');
  if(this.active)throw Error('已有检测正在进行，请先取消或等待完成');
  const job={id,controller:new AbortController()};this.active=job;return job;
 }
 private finish(job:NonNullable<ProxyDiagnosticsService['active']>){if(this.active===job)this.active=undefined;}
 cancel(id:unknown){
  if(typeof id!=='string'||id.length>85)throw Error('取消检测请求无效');
  if(this.active?.id!==id)return false;
  this.active.controller.abort();return true;
 }
 async read(refresh=false):Promise<ProxyDiagnostics>{
  if(this.stopped)throw Error('代理检测服务已关闭');
  if(this.pending)return this.pending;
  if(!refresh&&this.cached&&Date.now()-this.cached.created<120000)return this.cached;
  const job=this.begin(proxyDiagnosticsJob),work=this.run(job.controller.signal);this.pending=work;
  try{const report=await work;if(!report.cancelled)this.cached=report;return report;}
  finally{this.pending=undefined;this.finish(job);}
 }
 private async route(url:string,signal:AbortSignal):Promise<string|null>{
  signal.throwIfAborted();
  const env=(new URL(url).protocol==='http:'?process.env.HTTP_PROXY||process.env.http_proxy:process.env.HTTPS_PROXY||process.env.https_proxy)||process.env.ALL_PROXY||process.env.all_proxy;
  if(env){try{const value=endpoint(env);if(value)return value;}catch{}throw Error('代理环境变量的地址或认证方式不受支持');}
  // Chromium's per-URL result is authoritative, including PAC / bypass DIRECT.
  // Bound PAC resolution and release listeners even when the underlying call hangs.
  return new Promise<string|null>((resolve,reject)=>{
   let done=false;
   const finish=(value:string|null,error?:unknown)=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',abort);error?reject(error):resolve(value);};
   const abort=()=>finish(null,signal.reason),timer=setTimeout(()=>finish(null,Error('系统代理解析超时')),2000);
   signal.addEventListener('abort',abort,{once:true});
   void session.defaultSession.resolveProxy(url).then(value=>finish(routeFromElectron(value)),()=>finish(null,Error('系统代理解析失败')));
  });
 }
 private async check(site:(typeof proxySites)[number],mode:ProxyMode,signal:AbortSignal):Promise<ProxySiteResult>{
  let proxy:string|null=null;
  try{if(mode==='proxy')proxy=await this.route(site.url,signal);}
  catch(error){signal.throwIfAborted();return {site:site.id,mode,status:'failed',failure:'proxy',url:publicProxyUrl(site.url),route:'代理解析失败',detail:(error as Error).message};}
  return checkProxySite(site,mode,proxy,signal);
 }
 async test(value:unknown):Promise<ProxyConnectivityReport>{
  const {request,targets}=validateConnectivityRequest(value),job=this.begin(request.id),signal=job.controller.signal,results:ProxySiteResult[]=[];
  try{
   const tasks=targets.flatMap(site=>request.modes.map(mode=>({site,mode})));
   await runProxyWorkers(tasks,signal,async({site,mode})=>{
    const result=await this.check(site,mode,signal);
    if(signal.aborted)return;results.push(result);this.progress({kind:'connectivity',id:request.id,value:result});
   });
   return {id:request.id,created:Date.now(),targets:targets.map(site=>({...site,url:publicProxyUrl(site.url)})),results,cancelled:signal.aborted};
  }finally{this.finish(job);}
 }
 private async run(signal:AbortSignal):Promise<ProxyDiagnostics>{
  let configuration:ProxyConfiguration={environment:[],windows:{enabled:false,server:'',pac:'',autoDetect:false,bypass:'',winHttp:''},processes:[],adapters:[]};
  const sites:ProxySiteResult[]=[],exits:ProxyExit[]=[];
  try{
   configuration=await readProxyConfiguration(signal);
   const tasks:({kind:'exit';mode:ProxyMode}|{kind:'site';mode:ProxyMode;site:(typeof proxySites)[number]})[]=[...(['direct','proxy'] as ProxyMode[]).map(mode=>({kind:'exit' as const,mode})),...proxySites.flatMap(site=>(['direct','proxy'] as ProxyMode[]).map(mode=>({kind:'site' as const,site,mode})))];
   await runProxyWorkers(tasks,signal,async task=>{
    if(task.kind==='exit'){
     const result=await geo(task.mode,signal,url=>this.route(url,signal));if(signal.aborted)return;exits.push(result);this.progress({kind:'exit',value:result});
    }else{
     const result=await this.check(task.site,task.mode,signal);
     if(signal.aborted)return;sites.push(result);this.progress({kind:'site',value:result});
    }
   });
  }catch(error){if(!signal.aborted)throw error;}
  return {created:Date.now(),configuration,exits,sites,proxyAvailable:sites.some(item=>item.mode==='proxy'&&item.status!=='unavailable')||exits.some(item=>item.mode==='proxy'&&item.status!=='unavailable'),cancelled:signal.aborted};
 }
 stop(){this.stopped=true;this.active?.controller.abort();}
}
