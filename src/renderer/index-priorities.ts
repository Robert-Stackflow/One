import {api,icon,button,esc,toast} from './ui';
import {customControls,closeControls} from './controls';
import type {SearchSettings} from '../shared/search';
import {indexPriorityKey,indexedUnder,type IndexPriority} from '../shared/search-priority';
import {installFileDropOverlay} from './file-drop-overlay';
import './index-priorities.css';
const groups=[['high','高优先级','index-high-add','index-high'],['normal','正常','index-add','index-roots'],['uncommon','不常用','index-uncommon-add','index-uncommon'],['excluded','不索引','index-exclude','index-excluded']] as const;
type Choice=IndexPriority|'excluded';
export function indexPrioritySections(){return `<div class="index-priority-groups">${groups.map(([priority,title,add,list])=>`<section class="search-path-section index-priority-section" data-priority="${priority}"><div class="search-path-heading section-heading"><h2 class="section-label">${title}</h2>${button(add,'添加','plus')}</div><div class="settings-card"><div id="${list}" class="index-priority-paths"></div></div></section>`).join('')}</div>`;}
export function setupIndexPriorities(get:()=>SearchSettings,update:(patch:Partial<SearchSettings>)=>Promise<unknown>){
 let busy=false;
 const lock=(value:boolean)=>{busy=value;document.querySelectorAll<HTMLButtonElement>('.index-priority-groups button').forEach(b=>b.disabled=value);};
 const entries=()=>{
  const config=get(),rules=config.priorities??[],explicit=new Map(rules.map(rule=>[indexPriorityKey(rule.path),rule.priority]));
  const rows=new Map<string,{path:string;priority:Choice}>();
  for(const path of config.roots)rows.set(indexPriorityKey(path),{path,priority:explicit.get(indexPriorityKey(path))??'normal'});
  for(const rule of rules)rows.set(indexPriorityKey(rule.path),rule);
  for(const path of config.excluded)rows.set(indexPriorityKey(path),{path,priority:'excluded'});
  return [...rows.values()];
 };
 const save=(path:string,priority:Choice)=>{
  const config=get(),key=indexPriorityKey(path),priorities=(config.priorities??[]).filter(rule=>indexPriorityKey(rule.path)!==key),excluded=config.excluded.filter(p=>indexPriorityKey(p)!==key);
  if(priority==='excluded')excluded.push(path);else priorities.push({path,priority});
  const roots=priority==='excluded'||config.roots.some(root=>indexedUnder(path,root))?config.roots:[...config.roots,path];
  return update({priorities,excluded,roots});
 };
 const draw=()=>{
  if(!get())return;closeControls();const rows=entries();
  for(const [priority,, ,id] of groups){
   const host=document.getElementById(id)!;host.innerHTML=rows.filter(row=>row.priority===priority).map(({path})=>`<div class="index-priority-row" data-path="${esc(path)}"><span class="index-priority-path" title="${esc(path)}">${icon('folder')}<span>${esc(path)}</span></span><select aria-label="${esc(path)} 的优先级">${groups.map(([value,label])=>`<option value="${value}" ${priority===value?'selected':''}>${label}</option>`).join('')}</select><button class="icon-button quiet" aria-label="移除 ${esc(path)}" data-remove>${icon('close')}</button></div>`).join('')||'<p class="path-empty">未添加</p>';
   host.querySelectorAll<HTMLElement>('[data-path]').forEach((row,index)=>{
    const path=row.dataset.path!,select=row.querySelector<HTMLSelectElement>('select')!;
    select.id='index-priority-'+priority+'-'+index;
    row.onchange=event=>{const next=(event.target as HTMLSelectElement).value as Choice;lock(true);void save(path,next).then(()=>{lock(false);const moved=[...document.querySelectorAll<HTMLElement>('.index-priority-row')].find(r=>indexPriorityKey(r.dataset.path!)===indexPriorityKey(path));moved?.querySelector<HTMLElement>('[role=combobox]')?.focus();}).catch(error=>{draw();toast(error);}).finally(()=>lock(false));};
    row.querySelector<HTMLButtonElement>('[data-remove]')!.onclick=()=>{const config=get(),key=indexPriorityKey(path);lock(true);void update({roots:config.roots.filter(p=>indexPriorityKey(p)!==key),priorities:(config.priorities??[]).filter(p=>indexPriorityKey(p.path)!==key),excluded:config.excluded.filter(p=>indexPriorityKey(p)!==key)}).catch(toast).finally(()=>{lock(false);draw();});};
   });
   customControls(host);
  }
  lock(busy);
 };
 for(const [priority,,add] of groups)document.getElementById(add)!.onclick=()=>{if(busy)return;lock(true);void api.pickDirectory().then(path=>path&&save(path,priority)).catch(toast).finally(()=>{lock(false);draw();});};
 for(const [priority,title] of groups)installFileDropOverlay(document.querySelector<HTMLElement>(`.index-priority-section[data-priority=${priority}]`)!,{placement:'host',title:`加入${title}`,detail:'松开以添加文件夹',onDrop:async paths=>{if(busy||!get())return;const items=await api.dropPathKinds(paths),folders=items.filter(item=>item.kind==='directory');if(!folders.length)return toast('索引优先级仅支持文件夹');lock(true);try{for(const folder of folders)await save(folder.path,priority);}finally{lock(false);draw();}}});
 return draw;
}
