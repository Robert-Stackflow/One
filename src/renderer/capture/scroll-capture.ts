import './scroll-capture.css';
import './capture-controls.css';
import {TOOLTIP_CHANGE_EVENT} from '../tooltip';
import { customControls } from '../controls';
import type { ScrollCommand, ScrollView, ScrollOptions } from '../../shared/capture/scroll-capture';
import {applyCaptureScale} from './appearance';
import {confirmDialog} from '../dialog';
import {icon,registerIcons} from '../ui';
import {Pause,Undo2,PanelRightOpen,PanelRightClose,Pencil,Download,Check,Settings2,Link2,X} from 'lucide';
const api = window.one.scrollCapture!,
  q = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let view: ScrollView,
  pending = false;
let interactive=false;
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
registerIcons({'scroll-pause':Pause,'scroll-undo':Undo2,'scroll-preview-open':PanelRightOpen,'scroll-preview-close':PanelRightClose});
q('pause').innerHTML=icon('lucide:scroll-pause');q('undo').innerHTML=icon('lucide:scroll-undo');
registerIcons({'scroll-edit':Pencil,'scroll-save':Download,'scroll-copy':Check});
registerIcons({'scroll-settings':Settings2,'scroll-repair':Link2,'scroll-cancel':X});
q('setup-toggle').innerHTML=icon('lucide:scroll-settings');q('repair-toggle').innerHTML=icon('lucide:scroll-repair');q('cancel').innerHTML=icon('lucide:scroll-cancel');
for(const id of ['edit','save','copy'])q(id).innerHTML=icon('lucide:scroll-'+id);
function render(next: ScrollView) {
  view = next;
  applyCaptureScale(document.body,next.uiScale);
  if(next.overlay){
    for(const [node,rect] of [[q('scroll-region'),next.overlay.selection],[q('scroll-controls'),next.overlay.controls],[document.querySelector<HTMLElement>('.scroll-preview')!,next.overlay.preview]] as const){
      Object.assign(node.style,{left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px'});
    }
    q('scroll-region').classList.toggle('hint-inside',next.overlay.selection.y<44);
    if(next.overlay.panel)for(const id of ['setup','repair'])Object.assign(q(id).style,{left:next.overlay.panel.x+'px',top:next.overlay.panel.y+'px',width:next.overlay.panel.width+'px',height:next.overlay.panel.height+'px'});
  }
  q('message').textContent = next.message;
  q('scroll-controls').title=next.message;
  q('repair-toggle').hidden=!next.pending||next.phase==='running';q('repair-toggle').title=next.message;
  if(!next.pending)q<HTMLDetailsElement>('repair').open=false;
  q('setup').hidden = false;
  q('pending').hidden = !next.pending||next.phase==='running';
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
  q('pause').hidden = !running;
  for (const id of ['sample', 'manual','auto', 'join'])
    q<HTMLButtonElement>(id).disabled = pending || (id==='sample'||id==='join')&&running || (next.pending && id==='sample');
  document.body.dataset.preview=next.previewExpanded?'expanded':'collapsed';const preview=q('preview-toggle');preview.title=preview.ariaLabel=next.previewExpanded?'收起预览':'展开预览';preview.innerHTML=icon(next.previewExpanded?'lucide:scroll-preview-close':'lucide:scroll-preview-open');q<HTMLElement>('preview').closest<HTMLElement>('.scroll-preview')!.hidden=!next.previewExpanded;
  q<HTMLButtonElement>('undo').disabled = pending || running || !next.undo;
  q<HTMLButtonElement>('finish').disabled = pending || !next.count;
  q<HTMLButtonElement>('edit').disabled = pending || !(next.canEdit||next.pending&&next.count>0&&next.phase!=='failed');
  for(const id of ['save','copy'])q<HTMLButtonElement>(id).disabled=q<HTMLButtonElement>('edit').disabled;
  q<HTMLInputElement>('offset').value = String(Math.max(1,next.offset || 1));
  q<HTMLInputElement>('offset').disabled=pending||running;
  q<HTMLInputElement>('offset').max = String(
    (next.options.axis === 'vertical' ? next.source.height : next.source.width) -
      next.options.trimStart -
      next.options.trimEnd -
      fixedStart-fixedEnd-
      32,
  );
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
for (const kind of ['sample','manual', 'auto', 'pause', 'undo', 'finish', 'cancel'] as const)
  q(kind).onclick = () => {
    if(kind==='manual'||kind==='auto'){q<HTMLDetailsElement>('setup').open=false;q<HTMLDetailsElement>('repair').open=false;}
    void send({ kind });
  };
for(const kind of ['edit','copy','save'] as const)q(kind).onclick=()=>void(async()=>{if(await send({kind:'finish'}))await send({kind});})();
q('preview-toggle').onclick=()=>void send({kind:'layout',preview:!view.previewExpanded});
for(const id of ['setup','repair']){
  q(id+'-toggle').onclick=()=>{const panel=q<HTMLDetailsElement>(id);panel.open=!panel.open;if(panel.open)q<HTMLDetailsElement>(id==='setup'?'repair':'setup').open=false;};
  q<HTMLDetailsElement>(id).ontoggle=()=>{const open=q<HTMLDetailsElement>(id).open;q(id+'-toggle').ariaExpanded=String(open);if(!view)return;void(async()=>{if(open)await send({kind:'pause'});const next=await api.command(view.token,{kind:'layout',preview:view.previewExpanded,settings:q<HTMLDetailsElement>('setup').open,repair:q<HTMLDetailsElement>('repair').open});if(next)render(next);})().catch(error=>{q('message').textContent=String(error);});};
}
q('apply-settings').onclick=()=>void(async()=>{
  if(view.count&&!await confirmDialog({title:'重新开始长截图',message:'应用新设置会清空本次拼接结果，选区保持不变。',confirm:'重新开始'}))return;
  await send({kind:'restart',options:selectedOptions()});
  q<HTMLDetailsElement>('setup').open=false;
})();
q('copy-fixed').onclick=()=>{if(!view.fixed||pending||view.phase==='running')return;q<HTMLInputElement>('retain-start').value=String(view.fixed.start);q<HTMLInputElement>('retain-end').value=String(view.fixed.end);q<HTMLInputElement>('auto-fixed').checked=false;render(view);};
q('join').onclick = () => {
  void send({ kind: 'join', offset: Number(q<HTMLInputElement>('offset').value) });
};
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape'&&!document.querySelector('dialog[open]')) {
    event.preventDefault();
    void send({ kind: 'cancel' });
  }
});
api.onChange(render);
void api
  .state()
  .then(async value=>{render(value);document.body.dataset.scrollReady='true';q('scroll-controls').getBoundingClientRect();await api.ready();})
  .catch((e) => {
    q('message').textContent = String(e);
    document.body.dataset.scrollError=String(e);
    void window.one.diagnosticsReport('scroll-capture',String(e));
  });
