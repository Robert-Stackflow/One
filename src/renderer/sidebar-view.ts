import {sidebarGroups,defaultSidebar,validateSidebar,type SidebarPreferences,type SidebarPage,type SidebarGroupId} from '../shared/sidebar';
import {api,esc,icon,toast} from './ui';
import {dialogMarkup,openDialog} from './dialog';
import './sidebar.css';

export function setupSidebar(){
  let preferences=defaultSidebar(),received=false;
  const motions=new Map<HTMLElement,Animation>();
  const targets=new WeakMap<HTMLElement,boolean>();
  const badgeVisibility=(badge:HTMLElement,hidden:boolean,animate:boolean)=>{
    if(targets.get(badge)===hidden)return;
    motions.get(badge)?.cancel();motions.delete(badge);targets.set(badge,hidden);
    if(!animate||matchMedia('(prefers-reduced-motion: reduce)').matches){badge.hidden=hidden;return;}
    badge.hidden=false;
    const full={width:`${badge.getBoundingClientRect().width}px`,opacity:1,transform:'scale(1)',overflow:'hidden'},empty={...full,width:'0px',opacity:0,transform:'scale(.8)'};
    const motion=badge.animate(hidden?[full,empty]:[empty,full],{duration:180,easing:'cubic-bezier(.2,.7,.2,1)'});motions.set(badge,motion);
    motion.onfinish=()=>{if(motions.get(badge)!==motion)return;badge.hidden=hidden;motions.delete(badge);};
  };
  const visibility=(button:HTMLButtonElement,hidden:boolean,animate:boolean)=>{
    if(targets.get(button)===hidden)return;
    const previous=motions.get(button),start=previous?button.getBoundingClientRect().height:undefined;
    previous?.cancel();motions.delete(button);targets.set(button,hidden);
    if(!animate||matchMedia('(prefers-reduced-motion: reduce)').matches){button.hidden=hidden;button.inert=hidden;return;}
    button.hidden=false;button.inert=hidden;
    const style=getComputedStyle(button),height=button.getBoundingClientRect().height;
    const full={height:`${height}px`,minHeight:'0',paddingTop:style.paddingTop,paddingBottom:style.paddingBottom,marginTop:style.marginTop,marginBottom:style.marginBottom,opacity:1,transform:'translateY(0)',overflow:'hidden'};
    const empty={...full,height:'0px',paddingTop:'0px',paddingBottom:'0px',marginTop:'0px',marginBottom:'0px',opacity:0,transform:'translateY(-4px)'};
    const from=hidden?{...full,...(start!==undefined?{height:`${start}px`}:{})}:{...empty,...(start!==undefined?{height:`${start}px`}:{})};
    const motion=button.animate([from,hidden?empty:full],{duration:190,easing:'cubic-bezier(.2,.7,.2,1)'});motions.set(button,motion);
    motion.onfinish=()=>{if(motions.get(button)!==motion)return;button.hidden=hidden;motions.delete(button);};
  };
  const apply=(value:SidebarPreferences,animate=true)=>{
    preferences=validateSidebar(value);
    for(const group of sidebarGroups){
      const section=document.querySelector<HTMLElement>(`[data-sidebar-group="${group.id}"]`)!;
      const collapsed=preferences.collapsed[group.id],toggle=section.querySelector<HTMLButtonElement>('[data-sidebar-group-toggle]')!;
      toggle.setAttribute('aria-expanded',String(!collapsed));
      section.classList.toggle('group-collapsed',collapsed);
      const count=group.items.filter(([id])=>!preferences.pinned.includes(id)).length,badge=section.querySelector<HTMLElement>('.sidebar-group-count')!;
      badge.textContent=String(count);badge.setAttribute('aria-label',`${count} 个功能已折叠`);badgeVisibility(badge,!collapsed||count===0,animate);
      toggle.title=toggle.ariaLabel=(collapsed?'展开':'折叠')+group.name+(collapsed?`，${count} 个功能已折叠`:'');
      const reorder=Array.from(section.querySelectorAll<HTMLButtonElement>('.nav[data-page]')).map(button=>button.dataset.page).join()!==preferences.order[group.id].join();
      for(const id of preferences.order[group.id]){
        const button=section.querySelector<HTMLButtonElement>(`[data-page="${id}"]`)!;
        visibility(button,collapsed&&!preferences.pinned.includes(id),animate);
        if(reorder)section.append(button);
      }
    }
  };
  document.querySelectorAll<HTMLButtonElement>('[data-sidebar-group-toggle]').forEach(button=>button.addEventListener('click',()=>{
    const id=button.dataset.sidebarGroupToggle as SidebarGroupId,next=!preferences.collapsed[id];
    apply({...preferences,collapsed:{...preferences.collapsed,[id]:next}});button.disabled=true;
    void api.patchSettings({sidebar:{collapsed:{[id]:next}}}).then(settings=>apply(settings.sidebar)).catch(async error=>{
      toast(error);try{apply((await api.settings()).sidebar);}catch{}
    }).finally(()=>{button.disabled=false;});
  }));
  apply(preferences,false);
  api.onSidebarChanged(value=>{received=true;apply(value);});
  void api.settings().then(settings=>{if(!received)apply(settings.sidebar,false);}).catch(toast);
}

export function sidebarSettingsRow(){
  return `<div class="settings-card"><div class="setting-row"><div class="setting-copy"><h2>侧边栏排序</h2><p>调整同组顺序，固定常用功能。</p></div><button type="button" id="appearance-sidebar-order">管理侧边栏</button></div></div>`;
}
let currentDialog:HTMLDialogElement|undefined;
export async function openSidebarOrder(){
  if(currentDialog?.isConnected){openDialog(currentDialog);return;}
  const settings=await api.settings(),draft=validateSidebar(settings.sidebar);
  if(currentDialog?.isConnected){openDialog(currentDialog);return;}
  const holder=document.createElement('template');
  holder.innerHTML=dialogMarkup({id:'sidebar-order-dialog',title:'侧边栏排序',className:'sidebar-order-dialog',body:`<div class="sidebar-sort-intro"><p class="sidebar-sort-help">拖动调整同组顺序，更改立即生效。勾选“固定”后，分组收起时仍会展示该功能。</p><button type="button" id="sidebar-order-reset" title="恢复默认排序、固定项和分组展开状态">重置为默认值</button></div><div class="sidebar-sort-groups"></div><p class="sidebar-sort-status" aria-live="polite"></p><p class="sidebar-sort-error" role="alert" hidden></p>`});
  const dialog=holder.content.firstElementChild as HTMLDialogElement;currentDialog=dialog;
  const root=dialog.querySelector<HTMLElement>('.sidebar-sort-groups')!,status=dialog.querySelector<HTMLElement>('.sidebar-sort-status')!;
  const labels=new Map(sidebarGroups.flatMap(group=>group.items.map(([id,label])=>[id,label] as const)));
  const render=()=>{
    root.innerHTML=sidebarGroups.map(group=>`<section class="sidebar-sort-group" data-sort-group="${group.id}"><h3>${esc(group.name)}</h3><div class="sidebar-sort-list">${draft.order[group.id].map(id=>`<div class="sidebar-sort-row" data-sort-page="${id}"><button type="button" class="sidebar-sort-handle" draggable="true" data-sort-handle="${id}" aria-label="调整${esc(labels.get(id)!)}顺序，可拖动或使用上下方向键">${icon('grip')}</button>${icon(id)}<span class="sidebar-sort-label">${esc(labels.get(id)!)}</span><label class="sidebar-fold-option"><input type="checkbox" data-sidebar-pin="${id}" ${draft.pinned.includes(id)?'checked':''}><span>固定</span></label></div>`).join('')}</div></section>`).join('');
  };
  let revision=0;
  const persist=(reset=false)=>{
    const request=++revision,snapshot=validateSidebar(draft),error=dialog.querySelector<HTMLElement>('.sidebar-sort-error')!;error.hidden=true;
    void api.patchSettings({sidebar:{order:snapshot.order,pinned:snapshot.pinned,...(reset?{collapsed:snapshot.collapsed}:{})}}).catch(async reason=>{
      if(request!==revision)return;
      if(!dialog.isConnected){toast(reason);return;}
      error.textContent=String(reason).replace(/^Error:\s*/,'');error.hidden=false;
      try{const settings=await api.settings();if(request!==revision||!dialog.isConnected)return;const restored=validateSidebar(settings.sidebar);draft.order=restored.order;draft.pinned=restored.pinned;draft.collapsed=restored.collapsed;render();}catch{}
    });
  };
  dialog.querySelector<HTMLButtonElement>('#sidebar-order-reset')!.onclick=()=>{
    Object.assign(draft,defaultSidebar());render();persist(true);status.textContent='已恢复默认侧边栏设置';
  };
  const move=(group:SidebarGroupId,id:SidebarPage,to:number)=>{
    const order=draft.order[group],from=order.indexOf(id);if(from<0||to<0||to>=order.length||from===to)return;
    order.splice(from,1);order.splice(to,0,id);render();
    dialog.querySelector<HTMLButtonElement>(`[data-sort-handle="${id}"]`)?.focus({preventScroll:true});
    status.textContent=`${labels.get(id)}已移至第 ${to+1} 项`;
    persist();
  };
  let dragging:{group:SidebarGroupId;id:SidebarPage}|undefined;
  dialog.addEventListener('dragstart',event=>{
    const handle=(event.target as Element).closest<HTMLElement>('[data-sort-handle]');if(!handle||!event.dataTransfer)return;
    const group=handle.closest<HTMLElement>('[data-sort-group]')!.dataset.sortGroup as SidebarGroupId,id=handle.dataset.sortHandle as SidebarPage;
    dragging={group,id};event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',id);
    handle.closest('.sidebar-sort-row')!.classList.add('is-dragging');
  });
  dialog.addEventListener('dragover',event=>{
    const row=(event.target as Element).closest<HTMLElement>('[data-sort-page]');
    if(dragging&&row?.closest<HTMLElement>('[data-sort-group]')?.dataset.sortGroup===dragging.group){event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='move';}
  });
  dialog.addEventListener('drop',event=>{
    const row=(event.target as Element).closest<HTMLElement>('[data-sort-page]'),source=dragging;dragging=undefined;
    if(!source||!row||row.closest<HTMLElement>('[data-sort-group]')?.dataset.sortGroup!==source.group)return;
    event.preventDefault();const order=draft.order[source.group],target=order.indexOf(row.dataset.sortPage as SidebarPage),from=order.indexOf(source.id),rect=row.getBoundingClientRect();
    const insertion=target+(event.clientY>rect.top+rect.height/2?1:0);move(source.group,source.id,Math.max(0,Math.min(order.length-1,insertion-(from<insertion?1:0))));
  });
  dialog.addEventListener('dragend',()=>{dragging=undefined;dialog.querySelector('.is-dragging')?.classList.remove('is-dragging');});
  dialog.addEventListener('keydown',event=>{
    const handle=(event.target as Element).closest<HTMLElement>('[data-sort-handle]');if(!handle||!['ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();const group=handle.closest<HTMLElement>('[data-sort-group]')!.dataset.sortGroup as SidebarGroupId,id=handle.dataset.sortHandle as SidebarPage;
    move(group,id,draft.order[group].indexOf(id)+(event.key==='ArrowUp'?-1:1));
  });
  dialog.addEventListener('change',event=>{
    const input=event.target as HTMLInputElement;if(!input.matches('[data-sidebar-pin]'))return;
    const id=input.dataset.sidebarPin as SidebarPage;draft.pinned=draft.pinned.filter(value=>value!==id);if(input.checked)draft.pinned.push(id);persist();
  });
  dialog.addEventListener('close',()=>{dialog.remove();if(currentDialog===dialog)currentDialog=undefined;},{once:true});
  render();document.body.append(dialog);openDialog(dialog);
}
