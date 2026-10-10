import {execFile} from 'node:child_process';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {proxySites,proxyDiagnosticsJob,type ProxyConnectivityRequest,type ProxyFailure,type ProxyMode,type ProxySite,type ProxySiteResult} from '../shared/proxy-info';

import {normalizeProxyTarget,publicProxyUrl} from '../shared/proxy-target';

const run=promisify(execFile);
export const proxyConcurrency=4;
export {normalizeProxyTarget,publicProxyUrl} from '../shared/proxy-target';
export function validateConnectivityRequest(value:unknown):{request:ProxyConnectivityRequest;targets:ProxySite[]} {
 const item=value as ProxyConnectivityRequest;
 if(!item||typeof item!=='object'||typeof item.id!=='string'||!/^test-[\w-]{1,80}$/.test(item.id)||item.id===proxyDiagnosticsJob)throw Error('检测请求无效');
 if(!Array.isArray(item.modes)||!item.modes.length||item.modes.length>2||item.modes.some(mode=>mode!=='direct'&&mode!=='proxy')||new Set(item.modes).size!==item.modes.length)throw Error('请选择直连、代理或两者对比');
 const hasUrl=item.url!==undefined,hasSites=item.sites!==undefined;
 if(hasUrl===hasSites)throw Error('请选择网站或输入一个自定义地址');
 let targets:ProxySite[];
 if(hasUrl){const url=normalizeProxyTarget(item.url);targets=[{id:'custom',name:new URL(url).hostname,category:'自定义',url}];}
 else{
  if(!Array.isArray(item.sites)||!item.sites.length||item.sites.length>proxySites.length||new Set(item.sites).size!==item.sites.length)throw Error('网站列表无效');
  targets=item.sites.map(id=>{const site=proxySites.find(site=>site.id===id);if(!site)throw Error('网站列表无效');return site;});
 }
 return {request:{id:item.id,modes:[...item.modes]},targets};
}
export function proxyFailure(error:unknown):{failure:ProxyFailure;detail:string} {
 const value=error as {code?:number|string;killed?:boolean};
 const code=Number(value?.code);
 if(code===5)return {failure:'dns',detail:'代理服务器的域名无法解析'};
 if(code===6)return {failure:'dns',detail:'网站域名无法解析'};
 if(code===7)return {failure:'connect',detail:'无法建立连接，请检查地址、端口或代理服务'};
 if(code===28||value?.killed)return {failure:'timeout',detail:'连接或响应超时（网络请求最多 7 秒）'};
 if([35,51,53,54,58,59,60,64,66,77,80,82,83,90,91,98].includes(code))return {failure:'tls',detail:'TLS 握手或证书验证失败'};
 if(code===47)return {failure:'redirect',detail:'重定向超过 5 次，未到达最终地址'};
 if(code===97)return {failure:'proxy',detail:'代理握手失败，请检查代理协议与认证设置'};
 return {failure:'network',detail:code>0?`未能完成 HTTP 请求（网络错误 ${code}）`:'未能完成 HTTP 请求，请检查网络或代理设置'};
}
export async function proxyCurl(url:string,mode:ProxyMode,proxy:string|null,signal:AbortSignal,body=false):Promise<string> {
 signal.throwIfAborted();
 const args=['--disable','--silent','--show-error','--globoff','--location','--max-redirs','5','--connect-timeout','3','--max-time','7','--proto','=http,https','--proto-redir','=http,https'];
 if(mode==='direct')args.push('--proxy','','--noproxy','*');
 else if(proxy)args.push('--proxy',proxy,'--noproxy','');
 else throw Error('未检测到可用的显式代理');
 if(body)args.push('--output','-','--max-filesize','131072');
 else args.push('--head','--output',process.platform==='win32'?'NUL':'/dev/null','--write-out','%{http_code}\t%{time_total}\t%{url_effective}\t%{http_connect}');
 args.push('--url',url);
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^(?:all|https?|no)_proxy$/i.test(key)));
 const result=await run(process.platform==='win32'?join(process.env.SystemRoot||'C:\\Windows','System32/curl.exe'):'curl',args,{windowsHide:true,timeout:8500,maxBuffer:body?128*1024:16384,encoding:'utf8',env,signal});
 return result.stdout;
}
export async function checkProxySite(site:ProxySite,mode:ProxyMode,proxy:string|null,signal:AbortSignal):Promise<ProxySiteResult> {
 const route=mode==='direct'?'直连（绕过 HTTP / SOCKS 代理）':proxy?`代理 · ${publicProxyUrl(proxy)}`:'未配置显式代理';
 const base={site:site.id,mode,url:publicProxyUrl(site.url),route};
 if(mode==='proxy'&&!proxy)return {...base,status:'unavailable',detail:'此地址没有可用的显式代理；TUN / VPN 无法单独隔离检测'};
 try{
  const stdout=await proxyCurl(site.url,mode,proxy,signal),[code,seconds,effective]=stdout.trim().split('\t'),http=Number(code),latencyMs=Math.round(Number(seconds)*1000);
  if(!http||!Number.isFinite(latencyMs))return {...base,status:'failed',failure:'network',detail:'未收到有效的 HTTP 响应'};
  const restricted=[401,403,407,429,451].includes(http),status=http<400?'ok':restricted?'restricted':'http-error';
  const detail=http===401?'服务器要求登录或认证':http===403?'服务器拒绝访问，可能存在地区或访问限制':http===407?'代理服务器要求认证':http===429?'服务器限制请求频率':http===451?'服务器限制当前地区或法律管辖区的访问':http>=400?`已收到 HTTP ${http} 响应${http===405?'（网站不接受 HEAD 检测）':''}`:'已收到 HTTP 响应';
  return {...base,status,http,latencyMs,detail,effectiveUrl:publicProxyUrl(effective||site.url),failure:http>=400&&!restricted?'http':undefined};
 }catch(error){
  signal.throwIfAborted();
  const stdout=String((error as {stdout?:string}).stdout||''),[,seconds,,connect]=stdout.trim().split('\t');
  const connectHttp=Number(connect);
  if(mode==='proxy'&&connectHttp>=300&&connectHttp<=599)return {...base,status:[401,403,407,429,451].includes(connectHttp)?'restricted':'http-error',http:connectHttp,responseFrom:'proxy',latencyMs:Number.isFinite(Number(seconds))?Math.round(Number(seconds)*1000):undefined,detail:connectHttp===407?'代理服务器要求认证':`代理服务器拒绝建立隧道（HTTP ${connectHttp}），未到达目标网站`};
  return {...base,status:'failed',...proxyFailure(error)};
 }
}

export async function runProxyWorkers<T>(tasks:T[],signal:AbortSignal,visit:(task:T)=>Promise<void>):Promise<void> {
 let cursor=0,failure:unknown;
 await Promise.all(Array.from({length:Math.min(proxyConcurrency,tasks.length)},async()=>{
  while(cursor<tasks.length&&!signal.aborted&&!failure){const task=tasks[cursor++];try{await visit(task);}catch(error){if(!signal.aborted)failure=error;}}
 }));
 if(failure)throw failure;
}
