import {api,q,esc,icon,iconButton,action,toast,size} from './ui';
import './system-information.css';
import {informationCacheMs,informationTabs,type InformationKind,type InformationReport,type InformationGroup} from '../shared/system-info';
import {proxySites,type ProxyDiagnostics,type ProxyDiagnosticsProgress,type ProxyExit,type ProxySiteResult} from '../shared/proxy-info';
import type {DnsCheckReport} from '../shared/dns';
import {isWindowVisible,onWindowVisibility} from './window-visibility';

type InformationRecord=InformationGroup['records'][number];
type Highlight={group:InformationGroup;record:InformationRecord;fields:InformationRecord['fields']};

const highlightPatterns:Partial<Record<InformationKind,RegExp[]>>={
 overview:[/计算机名|型号|制造商|核心数|线程数|容量|版本名称|内部版本/i],
 cpu:[/型号|制造商|核心数|线程数|架构|频率/i],
 memory:[/插槽|容量|标称速率|配置速率|类型|形态/i],
 board:[/制造商|型号|固件版本|版本|发布日期|状态/i],
 display:[/型号|制造商|当前宽度|当前高度|当前刷新率|显示模式/i],
 storage:[/型号|名称|容量|剩余|介质|健康|文件系统/i],
 network:[/IPAddress|IP 地址|IPSubnet|子网|DefaultIPGateway|网关|DNSServer|DNS/i],
 bluetooth:[/名称|制造商|状态|驱动服务/i],
 devices:[/名称|制造商|类型|状态/i],
 battery:[/名称|剩余电量|满充容量|设计容量|正在充电|正在放电|循环次数/i],
 os:[/版本名称|内部版本|架构|启动时间|系统时间|进程数/i],
 drivers:[/设备|类型|制造商|提供者|版本|已签名/i]
};
const highlightLimits:Partial<Record<InformationKind,number>>={overview:4,memory:4,display:4,storage:4,network:6,devices:4,drivers:4};
const useful=(value:string)=>Boolean(value&&value!=='未报告');
const pickHighlights=(kind:InformationKind,groups:InformationGroup[]):Highlight[]=>{
 const ipGroup=groups.find(group=>group.id==='ip');
 const entries=kind==='network'&&ipGroup
  ?ipGroup.records.map(record=>({group:ipGroup,record}))
  :groups.flatMap(group=>group.records.map(record=>({group,record})));
 const patterns=highlightPatterns[kind]||[];
 const limit=highlightLimits[kind]||3;
 return entries.filter(({record})=>record.fields.some(field=>useful(field.value))).slice(0,limit).map(({group,record})=>{
  const preferred=record.fields.filter(field=>useful(field.value)&&patterns.some(pattern=>pattern.test(`${field.key} ${field.label}`)));
  const fields=[...preferred,...record.fields.filter(field=>useful(field.value)&&!preferred.includes(field))].slice(0,4);
  return {group,record,fields};
 }).filter(highlight=>highlight.fields.length);
};
const renderHighlights=(kind:InformationKind,groups:InformationGroup[])=>{
 const highlights=pickHighlights(kind,groups);
 if(!highlights.length)return '';
 return `<section class="information-highlights" aria-label="关键信息"><div class="information-highlights-heading"><h3>关键信息</h3><span>${highlights.length} 项</span></div><div class="information-key-grid">${highlights.map(({group,record,fields})=>`<article class="information-key-card"><div class="information-key-heading"><span>${esc(group.title)}</span><h4 title="${esc(record.title)}">${esc(record.title)}</h4></div><dl>${fields.map(field=>`<div><dt>${esc(field.label)}</dt><dd title="${esc(field.value)}">${esc(field.value)}</dd></div>`).join('')}</dl></article>`).join('')}</div></section>`;
};

export function systemInformationPage(){return `<div class="information-layout"><nav class="information-nav" role="tablist" aria-label="系统信息类别">${informationTabs.map(([id,name,glyph])=>`<button id="information-tab-${id}" role="tab" aria-selected="${id==='overview'}" data-information-tab="${id}" class="quiet ${id==='overview'?'active':''}">${icon(glyph)}<span>${name}</span><small data-information-count="${id}"></small></button>`).join('')}</nav><div class="information-content"><div class="information-toolbar"><h2 id="information-title">概览</h2><div class="spacer"></div><div class="filter-field">${icon('search')}<input id="information-query" aria-label="筛选系统信息" placeholder="筛选信息">${iconButton('information-clear-query','清除筛选','close')}</div>${iconButton('information-export','导出已读取的信息','download')}${iconButton('information-refresh','刷新当前页签','refresh')}</div><div id="information-live" class="information-live" hidden></div><section id="information-dns" class="information-dns" hidden><div class="proxy-section-heading"><h3>DNS 快速检查</h3><span>查询系统配置的 DNS 服务器</span></div><form id="information-dns-form" class="information-dns-form"><input id="information-dns-domain" aria-label="要查询的域名" placeholder="例如 github.com" spellcheck="false" autocomplete="off"><button id="information-dns-run" type="submit">查询</button></form><div id="information-dns-result" class="information-dns-result" role="status"></div></section><div id="information-proxy" class="information-proxy" hidden></div><div id="information-highlights" hidden></div><div id="information-progress" class="information-progress" role="status"></div><div id="information-groups"></div><div id="information-footer" class="information-footer"></div></div></div>`;}

interface TabState {report?:InformationReport;groups:InformationGroup[];busy:boolean;status:string;error?:string;limit:number;query:string}

export function setupSystemInformation(){
 const states=Object.fromEntries(informationTabs.map(([id])=>[id,{groups:[],busy:false,status:'',limit:30,query:''}])) as unknown as Record<InformationKind,TabState>;
 let kind:InformationKind='overview',visible=false,needsRender=true;
 let proxyReport:ProxyDiagnostics|undefined,proxyBusy=false,proxyError='';
 let dnsBusy=false,dnsReport:DnsCheckReport|undefined,dnsError='';
 const drawDns=()=>{const section=q<HTMLElement>('information-dns');section.hidden=kind!=='proxy';if(kind!=='proxy')return;const result=q<HTMLElement>('information-dns-result');if(dnsBusy){result.textContent='正在查询…';return;}if(dnsError){result.textContent=dnsError;return;}if(!dnsReport){result.textContent='输入域名后查看 A、AAAA、CNAME 记录及各 DNS 服务器的响应时间。';return;}result.innerHTML=`<div class="information-dns-domain">${esc(dnsReport.domain)} · ${new Date(dnsReport.created).toLocaleTimeString()}</div>${dnsReport.results.map(item=>`<article class="information-dns-server"><div><strong>${esc(item.server)}</strong><span>${item.latencyMs} ms</span></div>${item.error?`<p class="proxy-failed">${esc(item.error)}</p>`:''}${([['A',item.addresses4],['AAAA',item.addresses6],['CNAME',item.aliases]] as const).filter(([,records])=>records.length).map(([label,records])=>`<dl><dt>${label}</dt><dd>${records.map(record=>esc(record)).join('<br>')}</dd></dl>`).join('')}</article>`).join('')}`;};
 const proxyExits=new Map<ProxyExit['mode'],ProxyExit>(),proxyResults=new Map<string,ProxySiteResult>();
 const status=(result?:ProxySiteResult)=>!result?`<span class="proxy-pending">${proxyBusy?'检测中…':'尚未检测'}</span>`:result.status==='unavailable'?'<span class="proxy-muted">未配置</span>':result.status==='failed'?`<span class="proxy-failed" title="${esc(result.detail||'')}">连接失败</span>`:`<span class="${result.status==='ok'?'proxy-ok':'proxy-restricted'}" title="${esc(result.detail||'')}">${result.status==='ok'?'已连接':'已连接 · 受限'}</span><small>${result.http?`HTTP ${result.http} · `:''}${result.latencyMs??'—'} ms</small>`;
 const exitCard=(mode:ProxyExit['mode'])=>{
  const value=proxyExits.get(mode),title=mode==='direct'?'不使用显式代理':'经过代理';
  const pending=!value&&proxyBusy;
  const label=value?.status==='ok'?esc(value.ip||'—'):value?.status==='failed'?'查询失败':value?.status==='unavailable'?'未配置':pending?'正在查询':'尚未检测';
  return `<article class="proxy-exit-card${pending?' pending':''}"><div class="proxy-exit-heading"><span>${title}</span><strong>${pending?'<i class="proxy-exit-spinner" aria-hidden="true"></i>':''}${label}</strong></div>${value?.status==='ok'?`<dl><div><dt>国家 / 地区</dt><dd>${esc([value.country,value.region,value.city].filter(Boolean).join(' · ')||'未知')}</dd></div><div><dt>坐标（约）</dt><dd>${value.latitude!==undefined&&value.longitude!==undefined?`${value.latitude.toFixed(4)}, ${value.longitude.toFixed(4)}`:'未提供'}</dd></div><div><dt>ASN / 组织</dt><dd>${esc([value.asn,value.organization].filter(Boolean).join(' · ')||'未提供')}</dd></div></dl>`:!pending&&value?.detail?`<p title="${esc(value.detail)}">${esc(value.detail)}</p>`:''}</article>`;
 };
 const drawProxy=()=>{const host=q<HTMLElement>('information-proxy');host.hidden=kind!=='proxy';if(kind!=='proxy'||!visible||!isWindowVisible())return;const query=states.proxy.query.trim().toLowerCase(),sites=proxySites.filter(site=>!query||`${site.name} ${site.category} ${site.url}`.toLowerCase().includes(query)),complete=proxyResults.size;host.innerHTML=`<section class="proxy-egress"><div class="proxy-section-heading"><h3>公网出口</h3><span>IP 位置为估算值</span></div><div class="proxy-exit-grid">${exitCard('direct')}${exitCard('proxy')}</div></section><section class="proxy-connectivity"><div class="proxy-section-heading"><h3>网站连通性</h3><span>${proxyBusy?`检测中 · ${complete} / ${proxySites.length*2}`:proxyError?esc(proxyError):proxyReport?`已完成 · ${proxyReport.sites.length} 项`:'等待检测'}</span></div><div class="proxy-site-table"><div class="proxy-site-head"><span>网站</span><span>直连</span><span>代理</span></div>${sites.map(site=>`<div class="proxy-site-row"><div><strong>${esc(site.name)}</strong><small>${esc(site.category)} · ${esc(new URL(site.url).hostname)}</small></div><div>${status(proxyResults.get(`${site.id}:direct`))}</div><div>${status(proxyResults.get(`${site.id}:proxy`))}</div></div>`).join('')}</div></section><p class="proxy-note">直连会绕过 HTTP / SOCKS 代理，但仍可能经过 TUN 或 VPN 虚拟网卡。公网 IP 查询使用 ipapi.co，必要时回退到 ipinfo.io；仅打开代理页时请求。</p>`;};
 const loadProxy=async(refresh=false)=>{if(proxyBusy||!refresh&&proxyReport&&Date.now()-proxyReport.created<120000)return;proxyBusy=true;proxyError='';proxyExits.clear();proxyResults.clear();drawProxy();updateStatus();try{proxyReport=await api.proxyDiagnostics(refresh);for(const exit of proxyReport.exits)proxyExits.set(exit.mode,exit);for(const result of proxyReport.sites)proxyResults.set(`${result.site}:${result.mode}`,result);}catch(error){proxyError=String(error).replace(/^Error.*?: /,'');toast(error);}finally{proxyBusy=false;drawProxy();updateStatus();}};
 const unavailable=(group:InformationGroup)=>group.error?/拒绝访问|access.*denied|0x80041003/i.test(group.error)?'需要管理员权限':/无效类|invalid class|not supported|不支持/i.test(group.error)?'当前设备未提供此信息':'暂时无法读取此信息':group.id==='wifi'?'当前没有可读取的 Wi-Fi 连接':'未检测到设备';
 const fields=(group:InformationGroup,record:InformationRecord)=>`<dl class="information-fields">${record.fields.map(field=>`<div><dt>${esc(field.label)}</dt><dd class="${field.value==='未报告'?'unreported':''}" title="${esc(field.value)}">${esc(field.value)}</dd></div>`).join('')}</dl>`;
 const updateStatus=()=>{const state=states[kind],progress=q<HTMLElement>('information-progress');progress.textContent=kind==='proxy'&&!state.busy&&!state.error?'':state.error||state.status;progress.hidden=!progress.textContent;progress.classList.toggle('task-running',state.busy||kind==='proxy'&&proxyBusy);q<HTMLButtonElement>('information-refresh').disabled=state.busy||kind==='proxy'&&proxyBusy;q('information-footer').textContent=state.report?`更新于 ${new Date(state.report.created).toLocaleTimeString()} · ${(state.report.elapsed/1000).toFixed(1)} 秒`:'';};
 const draw=()=>{
  if(!visible||!isWindowVisible()){needsRender=true;return;}
  needsRender=false;
  for(const [id]of informationTabs){const state=states[id];if(!state.report&&!state.groups.length)continue;const count=q('information-tab-'+id).querySelector('small')!,value=String(state.groups.reduce((total,group)=>total+group.records.length,0));if(count.textContent!==value)count.textContent=value;}
  const state=states[kind],query=state.query.trim().toLowerCase();
  q('information-title').textContent=informationTabs.find(tab=>tab[0]===kind)![1];
  q('information-live').hidden=kind!=='overview';
  drawProxy();
  drawDns();
  q('information-clear-query').hidden=!query;
  const groups=state.groups.map(group=>({...group,records:group.records.filter(record=>!query||[group.title,record.title,...record.fields.flatMap(field=>[field.label,field.value])].join(' ').toLowerCase().includes(query))})).filter(group=>!query||group.records.length||group.title.includes(query));
  const highlightHost=q<HTMLElement>('information-highlights');
  highlightHost.innerHTML=kind==='proxy'?'':renderHighlights(kind,groups);
  highlightHost.hidden=!highlightHost.innerHTML;
  if(!groups.length){q('information-groups').innerHTML=`<div class="information-empty">${icon(state.busy?'refresh':query?'search':'info')}<span>${state.busy?'正在读取系统信息…':state.error||(query?'没有符合条件的信息':'正在准备系统信息…')}</span></div>`;updateStatus();return;}
  q('information-groups').innerHTML=groups.map(group=>`<section class="information-group"><div class="information-group-heading"><h3>${esc(group.title)}</h3><span>${group.records.length?group.records.length+' 项':''}</span>${kind==='overview'?`<button class="quiet icon-button" data-information-link="${group.id==='computer'||group.id==='os'?'os':['gpu','dxgi','display-modes'].includes(group.id)?'display':group.id==='volume'?'storage':group.id}" aria-label="查看${esc(group.title)}详情" title="查看详情">${icon('arrow')}</button>`:''}</div>${group.records.length?group.records.slice(0,state.limit).map(record=>kind==='drivers'||kind==='devices'?`<details class="information-record information-device"><summary>${icon(kind==='drivers'?'system':'devices')}<div><strong>${esc(record.title)}</strong><span>${esc(record.fields.find(field=>field.key==='DriverVersion'||field.key==='Manufacturer')?.value||'')}</span></div>${icon('chevron')}</summary>${fields(group,record)}</details>`:`<article class="information-record"><h4>${esc(record.title)}</h4>${fields(group,kind==='overview'?{...record,fields:record.fields.filter(field=>field.value!=='未报告').slice(0,6)}:record)}</article>`).join(''):`<div class="information-unavailable" title="${esc(group.error||'')}">${icon('info')}<span>${unavailable(group)}</span></div>`}${group.records.length>state.limit?`<button class="quiet information-more" data-information-more="${group.id}">显示更多 · ${state.limit} / ${group.records.length}</button>`:''}</section>`).join('');
  q('information-groups').querySelectorAll<HTMLButtonElement>('[data-information-more]').forEach(button=>button.onclick=()=>{state.limit+=30;draw();});
  q('information-groups').querySelectorAll<HTMLButtonElement>('[data-information-link]').forEach(button=>button.onclick=()=>q('information-tab-'+button.dataset.informationLink)?.click());
  updateStatus();
 };
 const load=async(target:InformationKind,refresh=false)=>{
  const state=states[target];
  if(state.busy||(!refresh&&state.report&&Date.now()-state.report.created<informationCacheMs))return;
  state.busy=true;state.error=undefined;state.status='正在读取…';if(refresh)state.groups=[];if(target===kind)draw();
  try{state.report=await api.systemInformation(target,refresh);state.groups=state.report.groups;state.status=`${state.groups.reduce((total,group)=>total+group.records.length,0)} 项 · ${state.groups.reduce((total,group)=>total+group.records.reduce((count,record)=>count+record.fields.length,0),0)} 个字段`;const count=q<HTMLElement>('information-tab-'+target).querySelector('small')!;if(visible&&isWindowVisible())count.textContent=String(state.groups.reduce((total,group)=>total+group.records.length,0));}
  catch(error){state.error=String(error).replace(/^Error.*?: /,'');toast(error);}
  finally{state.busy=false;if(kind===target)draw();}
 };
 api.onSystemInformationGroup(({kind:target,group})=>{const state=states[target];if(!state.busy)return;state.groups=state.groups.filter(item=>item.id!==group.id);state.groups.push(group);if(kind===target)draw();});
 api.onSystemInformationProgress(progress=>{const state=states[progress.kind];if(!state.busy)return;state.status=`读取中 · ${progress.completed} / ${progress.total}${progress.group?' · '+progress.group:''}`;if(kind===progress.kind&&visible&&isWindowVisible())updateStatus();});
 api.onProxyDiagnosticsProgress((progress:ProxyDiagnosticsProgress)=>{if(!proxyBusy)return;if(progress.kind==='exit')proxyExits.set(progress.value.mode,progress.value);else proxyResults.set(`${progress.value.site}:${progress.value.mode}`,progress.value);drawProxy();});
 document.querySelectorAll<HTMLButtonElement>('[data-information-tab]').forEach(button=>button.onclick=()=>{states[kind].query=q<HTMLInputElement>('information-query').value;kind=button.dataset.informationTab as InformationKind;document.querySelector('.content')!.scrollTop=0;q<HTMLInputElement>('information-query').value=states[kind].query;document.querySelectorAll<HTMLElement>('[data-information-tab]').forEach(tab=>{const active=tab===button;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));});draw();void load(kind);if(kind==='proxy')void loadProxy();});
 q('page-hardware').querySelector('.information-nav')!.addEventListener('wheel',event=>{const wheel=event as WheelEvent,nav=wheel.currentTarget as HTMLElement;if(nav.scrollWidth>nav.clientWidth&&wheel.deltaY){nav.scrollLeft+=wheel.deltaY;wheel.preventDefault();}},{passive:false});
 let filterTimer:ReturnType<typeof setTimeout>;
 q('information-query').oninput=()=>{clearTimeout(filterTimer);filterTimer=setTimeout(()=>{states[kind].query=q<HTMLInputElement>('information-query').value;draw();},120);};
 action('information-clear-query',()=>{q<HTMLInputElement>('information-query').value='';states[kind].query='';draw();});
 q<HTMLFormElement>('information-dns-form').onsubmit=event=>{event.preventDefault();if(dnsBusy)return;const domain=q<HTMLInputElement>('information-dns-domain').value.trim();dnsBusy=true;dnsError='';drawDns();q<HTMLButtonElement>('information-dns-run').disabled=true;void api.dnsCheck(domain).then(report=>{dnsReport=report;}).catch(error=>{dnsError=String(error).replace(/^Error.*?: /,'');}).finally(()=>{dnsBusy=false;q<HTMLButtonElement>('information-dns-run').disabled=false;drawDns();});};
 action('information-refresh',()=>{void load(kind,true);if(kind==='proxy')void loadProxy(true);});
 action('information-export',async()=>{const reports=Object.values(states).flatMap(state=>state.report?[state.report]:[]);if(!reports.length)return toast('请先读取系统信息');if(await api.exportSystemInformation(reports))toast('已导出');});
 api.onDiskMonitor(snapshot=>{if(!visible||!isWindowVisible()||kind!=='overview')return;q('information-live').innerHTML=`<div>${icon('cpu')}<span>CPU</span><strong>${snapshot.cpuPercent.toFixed(1)}<small>%</small></strong></div><div>${icon('memory')}<span>已用内存</span><strong>${size(snapshot.memoryTotal-snapshot.memoryFree)}<small> / ${size(snapshot.memoryTotal)}</small></strong></div><div>${icon('awake')}<span>运行时间</span><strong>${Math.floor(snapshot.uptimeSeconds/86400)?Math.floor(snapshot.uptimeSeconds/86400)+' 天 ':''}${Math.floor(snapshot.uptimeSeconds%86400/3600)}<small>小时</small></strong></div>`;});
 const sync=()=>{if(visible&&isWindowVisible()){if(needsRender)draw();void load(kind);if(kind==='proxy')void loadProxy();}void api.diskMonitor(visible&&isWindowVisible(),'information').catch(toast);};
 // Startup has already begun fetching these reports. Populate all local tab
 // states on mount so opening any category never begins a new visible wait.
 for(const [target]of informationTabs)void load(target);
 onWindowVisibility(sync);
 return {activate(active:boolean){visible=active;sync();}};
}
