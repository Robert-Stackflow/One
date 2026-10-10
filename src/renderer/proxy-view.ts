import {api,esc} from './ui';
import {proxySites,proxyDiagnosticsJob,type ProxyMode,type ProxyExit,type ProxySite,type ProxySiteResult,type ProxyConnectivityRequest} from '../shared/proxy-info';
import {normalizeProxyTarget,publicProxyUrl} from '../shared/proxy-target';
import {customControls} from './controls';

export function setupProxyInformation(host:HTMLElement,changed:()=>void,canRender:()=>boolean){
 let busy=false,job='',loadedAt=0,query='',cancelled=false,error='';
 const exits=new Map<ProxyMode,ProxyExit>(),results=new Map<string,ProxySiteResult>(),currentKeys=new Set<string>();
 let custom:ProxySite|undefined,customUrl='';
 const tableHeader='<div class="proxy-site-head"><span>网站 / 请求地址</span><span>直连</span><span>代理</span><span>操作</span></div>';
 host.innerHTML=`<section class="proxy-egress"><div class="proxy-section-heading"><h3>公网出口</h3><span>IP 位置为估算值</span></div><div class="proxy-exit-grid"></div></section>
 <section class="proxy-connectivity"><div class="proxy-section-heading"><h3>网站连通性</h3><span id="proxy-test-summary" role="status" aria-live="polite"></span></div>
 <form id="proxy-test-form" class="proxy-test-panel"><div class="proxy-test-fields"><div class="proxy-address-field"><label for="proxy-test-url">自定义地址</label><input id="proxy-test-url" type="text" placeholder="输入域名或完整网址" maxlength="4096" autocomplete="off" spellcheck="false"></div><div class="proxy-mode-field"><label for="proxy-test-mode">检测方式</label><select id="proxy-test-mode" aria-label="检测方式"><option value="both">直连与代理对比</option><option value="direct">仅直连</option><option value="proxy">仅代理</option></select></div></div><div class="proxy-test-footer"><p id="proxy-test-address" class="proxy-test-address"></p><div class="proxy-test-actions"><button id="proxy-test-custom" type="submit" class="btn primary">检测地址</button><button id="proxy-test-batch" class="btn" type="button" title="按所选方式检测当前筛选的网站列表">检测列表</button><button id="proxy-test-cancel" class="btn" type="button" disabled>取消检测</button></div></div></form>
 <div id="proxy-test-custom-result"></div><div class="proxy-site-table">${tableHeader}<div id="proxy-test-sites"></div></div></section>
 <p class="proxy-note">使用 HEAD 请求查看 HTTP 状态和响应时间，最多跟随 5 次重定向。收到登录、访问限制或其他 HTTP 错误仍表示服务器有响应，不代表页面和账号功能可用。查询参数只用于本次请求，结果中隐藏且不保存。</p>
 <p class="proxy-note">直连绕过 HTTP / SOCKS 代理，仍可能经过 TUN / VPN。代理列使用进程代理环境变量或系统针对该网址解析出的显式代理；系统返回直连时显示未配置。公网 IP 使用 ipapi.co，必要时回退到 ipinfo.io。</p>`;
 customControls(host);
 const element=<T extends HTMLElement=HTMLElement>(id:string)=>host.querySelector<T>('#'+id)!;
 const urlInput=element<HTMLInputElement>('proxy-test-url'),modeInput=element<HTMLButtonElement>('proxy-test-mode');
 const filtered=()=>proxySites.filter(site=>!query||`${site.name} ${site.category} ${site.url}`.toLowerCase().includes(query));
 const status=(site:string,mode:ProxyMode)=>{
  const key=`${site}:${mode}`,result=results.get(key),selected=currentKeys.has(key);
  if(!result)return `<span class="proxy-pending">${selected&&busy?'检测中…':selected&&cancelled?'已取消':'尚未检测'}</span>`;
  const label=result.responseFrom==='proxy'?'代理拒绝连接':result.status==='ok'?'已连接':result.status==='restricted'?'已连接 · 受限':result.status==='http-error'?'已响应 · HTTP 错误':result.status==='unavailable'?'未配置显式代理':'连接失败';
  const color=result.status==='ok'?'ok':result.status==='failed'?'failed':result.status==='unavailable'?'muted':'restricted';
  const redirected=result.effectiveUrl&&result.effectiveUrl!==result.url;
  return `<span class="proxy-${color}">${label}</span>${result.http?`<small>HTTP ${result.http} · ${result.latencyMs??'—'} ms</small>`:''}<small class="proxy-result-detail">${esc(result.detail||'')}</small><small class="proxy-result-route">${esc(result.route||'')}</small>${redirected?`<small class="proxy-result-address">最终地址：${esc(result.effectiveUrl!)}</small>`:''}`;
 };
 const row=(site:ProxySite,button=true)=>`<div class="proxy-site-row" data-proxy-site="${esc(site.id)}"><div><strong>${esc(site.name)}</strong><small>${esc(site.category)}</small><small class="proxy-result-address">${esc(site.url)}</small></div><div>${status(site.id,'direct')}</div><div>${status(site.id,'proxy')}</div><div>${button?`<button type="button" class="btn" data-proxy-test="${esc(site.id)}"${busy?' disabled':''}>检测</button>`:''}</div></div>`;
 const exitCard=(mode:ProxyMode)=>{
  const value=exits.get(mode),pending=!value&&busy&&job===proxyDiagnosticsJob;
  const label=value?.status==='ok'?esc(value.ip||'—'):value?.status==='failed'?'查询失败':value?.status==='unavailable'?'未配置':pending?'正在查询':cancelled?'已取消':'尚未查询';
  return `<article class="proxy-exit-card${pending?' pending':''}"><div class="proxy-exit-heading"><span>${mode==='direct'?'不使用显式代理':'经过代理'}</span><strong>${pending?'<i class="proxy-exit-spinner" aria-hidden="true"></i>':''}${label}</strong></div>${value?.status==='ok'?`<dl><div><dt>国家 / 地区</dt><dd>${esc([value.country,value.region,value.city].filter(Boolean).join(' · ')||'未知')}</dd></div><div><dt>坐标（约）</dt><dd>${value.latitude!==undefined&&value.longitude!==undefined?`${value.latitude.toFixed(4)}, ${value.longitude.toFixed(4)}`:'未提供'}</dd></div><div><dt>ASN / 组织</dt><dd>${esc([value.asn,value.organization].filter(Boolean).join(' · ')||'未提供')}</dd></div></dl>`:value?.detail?`<p>${esc(value.detail)}</p>`:''}</article>`;
 };
 function render(){
  const complete=[...currentKeys].filter(key=>results.has(key)).length,total=currentKeys.size;
  element('proxy-test-summary').textContent=error||(busy?`检测中 · ${complete} / ${total}`:cancelled?`已取消 · 完成 ${complete} / ${total}`:loadedAt?`已完成 · ${complete} 项`:'等待检测');
  host.querySelector('.proxy-exit-grid')!.innerHTML=exitCard('direct')+exitCard('proxy');
  element('proxy-test-sites').innerHTML=filtered().map(site=>row(site)).join('');
  element('proxy-test-custom-result').innerHTML=custom?`<section class="proxy-custom-result"><h4>自定义地址结果</h4><div class="proxy-site-table">${tableHeader}${row(custom)}</div></section>`:'';
  element<HTMLButtonElement>('proxy-test-custom').disabled=busy;
  element<HTMLButtonElement>('proxy-test-batch').disabled=busy||!filtered().length;
  element<HTMLButtonElement>('proxy-test-cancel').disabled=!busy;
  modeInput.disabled=busy;
 }
 function begin(id:string,targets:ProxySite[],selected:ProxyMode[]){
  busy=true;job=id;error='';cancelled=false;currentKeys.clear();
  for(const site of targets)for(const mode of selected){const key=`${site.id}:${mode}`;currentKeys.add(key);results.delete(key);}
  render();changed();
 }
 function end(){busy=false;loadedAt=Date.now();render();changed();}
 async function load(refresh=false){
  if(busy||!refresh&&loadedAt&&Date.now()-loadedAt<120000)return;
  exits.clear();begin(proxyDiagnosticsJob,proxySites,['direct','proxy']);
  try{const report=await api.proxyDiagnostics(refresh);cancelled=!!report.cancelled;for(const exit of report.exits)exits.set(exit.mode,exit);for(const result of report.sites)results.set(`${result.site}:${result.mode}`,result);}
  catch(value){error=String(value).replace(/^Error.*?: /,'');}finally{end();}
 }
 async function test(sites?:string[],address=urlInput.value){
  if(busy)return;
  const selected:ProxyMode[]=modeInput.value==='direct'?['direct']:modeInput.value==='proxy'?['proxy']:['direct','proxy'];
  let request:ProxyConnectivityRequest,targets:ProxySite[];
  try{
   const id='test-'+crypto.randomUUID();
   if(sites){targets=proxySites.filter(site=>sites.includes(site.id));request={id,sites,modes:selected};}
   else{const url=normalizeProxyTarget(address);if(url!==customUrl){results.delete('custom:direct');results.delete('custom:proxy');}customUrl=url;custom={id:'custom',name:new URL(url).hostname,category:'自定义',url:publicProxyUrl(url)};targets=[custom];request={id,url,modes:selected};}
  }catch(value){error=String(value).replace(/^Error.*?: /,'');render();return;}
  begin(request.id,targets,selected);
  try{const report=await api.proxyConnectivity(request);cancelled=report.cancelled;for(const result of report.results)results.set(`${result.site}:${result.mode}`,result);}
  catch(value){error=String(value).replace(/^Error.*?: /,'');}finally{end();}
 }
 element<HTMLFormElement>('proxy-test-form').onsubmit=event=>{event.preventDefault();void test();};
 element('proxy-test-batch').onclick=()=>void test(filtered().map(site=>site.id));
 element('proxy-test-cancel').onclick=()=>{element<HTMLButtonElement>('proxy-test-cancel').disabled=true;void api.cancelProxyConnectivity(job).catch(()=>{error='暂时无法取消，请稍后重试';render();});};
 host.addEventListener('click',event=>{const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-proxy-test]');if(button&&!button.disabled){if(button.dataset.proxyTest==='custom')void test(undefined,customUrl);else void test([button.dataset.proxyTest!]);}});
 urlInput.oninput=()=>{
  const preview=element('proxy-test-address');
  try{preview.textContent=urlInput.value.trim()?`请求地址：${publicProxyUrl(normalizeProxyTarget(urlInput.value))}`:'未填写协议时使用 HTTPS';}
  catch{preview.textContent='请输入 HTTP / HTTPS 地址或域名';}
 };
 api.onProxyDiagnosticsProgress(progress=>{
  if(!busy)return;
  if(progress.kind==='connectivity'){if(progress.id!==job)return;results.set(`${progress.value.site}:${progress.value.mode}`,progress.value);}
  else if(job===proxyDiagnosticsJob){if(progress.kind==='exit')exits.set(progress.value.mode,progress.value);else results.set(`${progress.value.site}:${progress.value.mode}`,progress.value);}
  else return;
  if(canRender())render();
 });
 urlInput.oninput(new Event('input'));render();
 return {get busy(){return busy;},load,draw(value:string){query=value.trim().toLowerCase();render();}};
}
