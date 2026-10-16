import './scroll-capture.css';
import './capture-controls.css';
import {TOOLTIP_CHANGE_EVENT} from '../tooltip';
import { customControls } from '../controls';
import type { ScrollCommand, ScrollView, ScrollOptions } from '../../shared/capture/scroll-capture';
import {applyCaptureScale} from './appearance';
import {confirmDialog} from '../dialog';
import {scrollEditSize} from '../../shared/capture/scroll-limits';
import {icon,registerIcons} from '../ui';
import {Pause,Play,Undo2,PanelRightOpen,PanelRightClose,Pencil,Download,Check,Settings2,X} from 'lucide';
const api = window.one.scrollCapture!,
  q = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let view: ScrollView,
  pending = false;
let interactive=false;
let hoverY:number|undefined,inspectTimer:ReturnType<typeof setTimeout>|undefined;
const inspection=q('scroll-inspection'),previewSurface=document.querySelector<HTMLElement>('.scroll-preview')!;
function hideInspection(){hoverY=undefined;clearTimeout(inspectTimer);inspection.hidden=true;inspection.classList.remove('popup-enter');if(view)void api.inspect(view.token,null).catch(()=>{});}
function inspectPreview(){
  if(hoverY===undefined||!view?.count||!view.overlay||!view.previewExpanded)return;
  const preview=previewSurface.getBoundingClientRect(),selection=view.overlay.selection,position=Math.max(0,Math.min(1,(hoverY-preview.y)/preview.height));
  const left=selection.x-52,right=innerWidth-selection.x-selection.width-52,beside=Math.max(left,right)>=300;
  const width=Math.round(Math.min(960,beside?Math.max(left,right):innerWidth-24)),height=Math.round(Math.min(260,innerHeight-24));
  const x=Math.round(beside?(left>=right?Math.max(12,selection.x-width-40):selection.x+selection.width+40):Math.max(12,Math.min(preview.x,innerWidth-width-12)));
  const above=selection.y-52,below=innerHeight-selection.y-selection.height-52;
  const y=Math.round(Math.max(12,Math.min(beside?hoverY-height/2:below>=height?selection.y+selection.height+40:above>=height?selection.y-height-40:hoverY-height/2,innerHeight-height-12)));
  Object.assign(inspection.style,{left:x+'px',top:y+'px',width:width+'px',height:height+'px'});
  void api.inspect(view.token,position,{x,y,width,height}).catch(()=>{});
}
previewSurface.addEventListener('pointermove',event=>{hoverY=event.clientY;if(inspectTimer)return;inspectTimer=setTimeout(()=>{inspectTimer=undefined;inspectPreview();},60);});
previewSurface.addEventListener('pointerleave',hideInspection);
api.onInspection(value=>{if(hoverY===undefined)return;q<HTMLImageElement>('inspection-image').src=value.image;inspection.hidden=false;inspection.classList.add('popup-enter');});
const portals=new MutationObserver(()=>{
  const next=!!document.querySelector('dialog[open],:popover-open');
  if(next!==interactive){interactive=next;void api.interactive(next).catch(()=>{});}
});
portals.observe(document.body,{subtree:true,attributes:true,attributeFilter:['open'],childList:true});
document.addEventListener('toggle',()=>{const next=!!document.querySelector('dialog[open],:popover-open');if(next!==interactive){interactive=next;void api.interactive(next).catch(()=>{});}},true);
window.addEventListener('beforeunload',()=>portals.disconnect(),{once:true});
document.addEventListener(TOOLTIP_CHANGE_EVENT,event=>{
  const visible=(event as CustomEvent<boolean>).detail,tip=document.getElementById('one-tooltip');
  const r=visible&&tip?.getBoundingClientRect();
  void api.tooltip(r?{x:Math.max(0,Math.floor(r.x)-12),y:Math.max(0,Math.floor(r.y)-12),width:Math.ceil(r.width)+24,height:Math.ceil(r.height)+24}:null).catch(()=>{});
});
registerIcons({'scroll-pause':Pause,'scroll-resume':Play,'scroll-undo':Undo2,'scroll-preview-open':PanelRightOpen,'scroll-preview-close':PanelRightClose});
q('pause').innerHTML=icon('lucide:scroll-pause');q('undo').innerHTML=icon('lucide:scroll-undo');
registerIcons({'scroll-edit':Pencil,'scroll-save':Download,'scroll-copy':Check});
registerIcons({'scroll-settings':Settings2,'scroll-cancel':X});
q('setup-toggle').innerHTML=icon('lucide:scroll-settings');q('cancel').innerHTML=icon('lucide:scroll-cancel');
for(const id of ['edit','save','copy'])q(id).innerHTML=icon('lucide:scroll-'+id);
function render(next: ScrollView) {
  view = next;
  if(!next.previewExpanded||!next.count)hideInspection();
  applyCaptureScale(document.body,next.uiScale);
  if(next.overlay){
    for(const [node,rect] of [[q('scroll-region'),next.overlay.selection],[q('scroll-controls'),next.overlay.controls],[document.querySelector<HTMLElement>('.scroll-preview')!,next.overlay.preview]] as const){
      Object.assign(node.style,{left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px'});
    }
    q('scroll-region').classList.toggle('hint-inside',next.overlay.selection.y<44);
    if(next.overlay.panel)for(const id of ['setup'])Object.assign(q(id).style,{left:next.overlay.panel.x+'px',top:next.overlay.panel.y+'px',width:next.overlay.panel.width+'px',height:next.overlay.panel.height+'px'});
  }
  q('message').textContent = next.message;
  q('scroll-controls').title=next.message;
  q('setup').hidden = false;
  q('empty').hidden = !!next.preview;
  q<HTMLImageElement>('preview').hidden = !next.preview;
  q('preview-paper').hidden=!next.preview;
  if (next.preview && q<HTMLImageElement>('preview').src !== next.preview)
    q<HTMLImageElement>('preview').src = next.preview;
  const vertical=next.options.axis==='vertical',length=vertical?next.height:next.width,fixedStart=next.fixed?.start||0,fixedEnd=next.fixed?.end||0,viewport=(vertical?next.source.height:next.source.width)-next.options.trimStart-next.options.trimEnd-fixedStart-fixedEnd;
  for(const [id,size] of [['preview-viewport',viewport],['preview-addition',next.offset]] as const){
    const node=q(id),start=id==='preview-viewport'?length-fixedEnd-viewport+(next.match==='backwards'?next.offset:0):length-fixedEnd-size;
    const clipped=Math.max(0,start),fraction=Math.max(0,Math.min(length,start+size)-clipped)/Math.max(1,length)*100,position=clipped/Math.max(1,length)*100;
    node.style.cssText=vertical?`left:0;right:0;top:${position}%;height:${fraction}%`:`top:0;bottom:0;left:${position}%;width:${fraction}%`;
    node.hidden=!next.preview||(id==='preview-viewport'&&next.recovering&&next.match==='ambiguous')||(id==='preview-addition'&&(next.match!=='accepted'||next.pending||!next.offset));
    if(id==='preview-viewport')node.ariaLabel=next.match==='backwards'?'当前视口与已拼内容的重叠区域':'最后采集视口';
  }
  for(const [id,size,end] of [['preview-fixed-start',fixedStart,false],['preview-fixed-end',fixedEnd,true]] as const){const node=q(id);node.hidden=!next.preview||!size;const fraction=size/Math.max(1,length)*100;node.style.cssText=vertical?`left:0;right:0;${end?'bottom':'top'}:0;height:${fraction}%`:`top:0;bottom:0;${end?'right':'left'}:0;width:${fraction}%`;}
  q('fixed-note').hidden=!next.fixed;q('fixed-note').textContent=next.fixed?`固定开头 ${fixedStart}px、末尾 ${fixedEnd}px，各保留一次。可手动修正后重新开始。`:'';
  q('copy-fixed').hidden=!next.fixed;q<HTMLButtonElement>('copy-fixed').disabled=pending||next.phase==='running';
  q('dimensions').textContent = next.count
    ? `${next.width} × ${next.height} · ${next.count} 帧`
    : '尚未采集';
  q('sample').textContent = next.count ? '采集下一帧' : '采集首帧';
  q<HTMLButtonElement>('auto').ariaPressed=String(next.mode==='auto');q<HTMLButtonElement>('manual').ariaPressed=String(next.mode==='manual');
  const running = next.phase === 'running';
  q('auto').hidden = false;
  const pause=q('pause');pause.hidden=false;pause.title=pause.ariaLabel=running?'暂停采集':'继续采集';pause.innerHTML=icon(running?'lucide:scroll-pause':'lucide:scroll-resume');
  for (const id of ['sample', 'manual','auto'])
    q<HTMLButtonElement>(id).disabled = pending || id==='sample'&&running || (next.pending && id==='sample');
  document.body.dataset.preview=next.previewExpanded?'expanded':'collapsed';const preview=q('preview-toggle');preview.title=preview.ariaLabel=next.previewExpanded?'收起预览':'展开预览';preview.innerHTML=icon(next.previewExpanded?'lucide:scroll-preview-close':'lucide:scroll-preview-open');q<HTMLElement>('preview').closest<HTMLElement>('.scroll-preview')!.hidden=!next.previewExpanded;
  q<HTMLButtonElement>('undo').disabled = pending || running || !next.undo;
  q<HTMLButtonElement>('finish').disabled = pending || !next.count;
  q<HTMLButtonElement>('edit').disabled = pending || !(next.canEdit||next.pending&&next.count>0&&next.phase!=='failed');
  q('edit').title=q('edit').ariaLabel=next.count&&scrollEditSize(next.width,next.height).scaled?'编辑缩放副本':'编辑长截图';
  for(const id of ['save','copy'])q<HTMLButtonElement>(id).disabled=q<HTMLButtonElement>('edit').disabled;
  for (const id of ['trim-start', 'trim-end', 'ignore-start', 'ignore-end','retain-start','retain-end'])
    q<HTMLInputElement>(id).disabled = pending || running;
  q<HTMLSelectElement>('axis').disabled = pending || running;
  q<HTMLInputElement>('auto-fixed').disabled=pending||running;
  customControls(document.body);
}
function selectedOptions():ScrollOptions{return {
  autoFixed:q<HTMLInputElement>('auto-fixed').checked,
  retainStart:Number(q<HTMLInputElement>('retain-start').value),retainEnd:Number(q<HTMLInputElement>('retain-end').value),
  axis:q<HTMLSelectElement>('axis').value as 'vertical'|'horizontal',
  trimStart:Number(q<HTMLInputElement>('trim-start').value),trimEnd:Number(q<HTMLInputElement>('trim-end').value),
  ignoreStart:Number(q<HTMLInputElement>('ignore-start').value),ignoreEnd:Number(q<HTMLInputElement>('ignore-end').value),
};}
async function send(command: ScrollCommand) {
  if (pending && !['cancel', 'pause'].includes(command.kind)) return false;
  pending = true;
  render(view);
  let failure = '',success=false;
  try {
    if (!view.count && ['sample','manual', 'auto'].includes(command.kind))
      await api.command(view.token, {
        kind: 'configure',
        options: selectedOptions(),
      });
    const next = await api.command(view.token, command);
    if (next) {render(next);success=true;}
  } catch (error) {
    failure =
      error instanceof Error
        ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
        : String(error);
  } finally {
    pending = false;
    if (command.kind !== 'cancel') {
      render(view);
      if (failure) q('message').textContent = failure;
    }
  }
  return success;
}
for (const kind of ['sample','manual', 'auto', 'undo', 'finish', 'cancel'] as const)
  q(kind).onclick = () => {
    if(kind==='manual'||kind==='auto'){q<HTMLDetailsElement>('setup').open=false;}
    void send({ kind });
  };
q('pause').onclick=()=>{
  if(view.phase==='running')void send({kind:'pause'});
  else{q<HTMLDetailsElement>('setup').open=false;void send({kind:view.mode==='auto'?'auto':'manual'});}
};
for(const kind of ['edit','copy','save'] as const)q(kind).onclick=()=>void(async()=>{
  if(!await send({kind:'finish'}))return;
  if(kind==='edit'){
    const size=scrollEditSize(view.width,view.height);
    if(size.scaled&&!await confirmDialog({title:'编辑缩放副本',message:`原图为 ${view.width} × ${view.height}，编辑副本将缩小到 ${size.width} × ${size.height}。需要保留原尺寸时，请先返回并保存原图。`,confirm:'编辑副本'}))return;
  }
  await send({kind});
})();
q('preview-toggle').onclick=()=>void send({kind:'layout',preview:!view.previewExpanded});
for(const id of ['setup']){
  q(id+'-toggle').onclick=()=>{const panel=q<HTMLDetailsElement>(id);panel.open=!panel.open;};
  q<HTMLDetailsElement>(id).ontoggle=()=>{const open=q<HTMLDetailsElement>(id).open;q(id+'-toggle').ariaExpanded=String(open);if(!view)return;void(async()=>{if(open)await send({kind:'pause'});const next=await api.command(view.token,{kind:'layout',preview:view.previewExpanded,settings:q<HTMLDetailsElement>('setup').open});if(next)render(next);})().catch(error=>{q('message').textContent=String(error);});};
}
q('apply-settings').onclick=()=>void(async()=>{
  if(view.count&&!await confirmDialog({title:'重新开始长截图',message:'应用新设置会清空本次拼接结果，选区保持不变。',confirm:'重新开始'}))return;
  await send({kind:'restart',options:selectedOptions()});
  q<HTMLDetailsElement>('setup').open=false;
})();
q('copy-fixed').onclick=()=>{if(!view.fixed||pending||view.phase==='running')return;q<HTMLInputElement>('retain-start').value=String(view.fixed.start);q<HTMLInputElement>('retain-end').value=String(view.fixed.end);q<HTMLInputElement>('auto-fixed').checked=false;render(view);};
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape'&&!document.querySelector('dialog[open]')) {
    event.preventDefault();
    void send({ kind: 'cancel' });
  }
});
api.onChange(value=>{render({...value,preview:value.preview??view?.preview??''});q('scroll-controls').getBoundingClientRect();void api.ready().catch(()=>{});});
void api
  .state()
  .then(async value=>{if(value)render(value);document.body.dataset.scrollReady='true';q('scroll-controls').getBoundingClientRect();await api.ready();})
  .catch((e) => {
    q('message').textContent = String(e);
    document.body.dataset.scrollError=String(e);
    void window.one.diagnosticsReport('scroll-capture',String(e));
  });
