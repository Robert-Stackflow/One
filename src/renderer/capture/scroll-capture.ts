import './scroll-capture.css';
import { customControls } from '../controls';
import type { ScrollCommand, ScrollView } from '../../shared/capture/scroll-capture';
import {applyCaptureScale} from './appearance';
import {confirmDialog} from '../dialog';
import {icon,registerIcons} from '../ui';
import {Pause,Undo2,PanelRightOpen,PanelRightClose} from 'lucide';
const api = window.one.scrollCapture!,
  q = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let view: ScrollView,
  pending = false;
registerIcons({'scroll-pause':Pause,'scroll-undo':Undo2,'scroll-preview-open':PanelRightOpen,'scroll-preview-close':PanelRightClose});
q('pause').innerHTML=icon('lucide:scroll-pause');q('undo').innerHTML=icon('lucide:scroll-undo');
function render(next: ScrollView) {
  view = next;
  applyCaptureScale(document.body,next.uiScale);
  q('message').textContent = next.message;
  q('setup').hidden = false;
  q('pending').hidden = !next.pending||next.phase==='running';
  q('empty').hidden = !!next.preview;
  q<HTMLImageElement>('preview').hidden = !next.preview;
  q('preview-paper').hidden=!next.preview;
  if (next.preview && q<HTMLImageElement>('preview').src !== next.preview)
    q<HTMLImageElement>('preview').src = next.preview;
  const vertical=next.options.axis==='vertical',length=vertical?next.height:next.width,viewport=(vertical?next.source.height:next.source.width)-next.options.trimStart-next.options.trimEnd;
  for(const [id,size] of [['preview-viewport',viewport],['preview-addition',next.offset]] as const){
    const node=q(id),start=id==='preview-viewport'?length-viewport+(next.match==='backwards'?next.offset:0):length-size;
    const clipped=Math.max(0,start),fraction=Math.max(0,Math.min(length,start+size)-clipped)/Math.max(1,length)*100,position=clipped/Math.max(1,length)*100;
    node.style.cssText=vertical?`left:0;right:0;top:${position}%;height:${fraction}%`:`top:0;bottom:0;left:${position}%;width:${fraction}%`;
    node.hidden=!next.preview||(id==='preview-viewport'&&next.recovering&&next.match==='ambiguous')||(id==='preview-addition'&&(next.match!=='accepted'||next.pending||!next.offset));
    if(id==='preview-viewport')node.ariaLabel=next.match==='backwards'?'当前视口与已拼内容的重叠区域':'最后采集视口';
  }
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
  q<HTMLInputElement>('offset').value = String(Math.max(1,next.offset || 1));
  q<HTMLInputElement>('offset').disabled=pending||running;
  q<HTMLInputElement>('offset').max = String(
    (next.options.axis === 'vertical' ? next.source.height : next.source.width) -
      next.options.trimStart -
      next.options.trimEnd -
      32,
  );
  for (const id of ['trim-start', 'trim-end', 'ignore-start', 'ignore-end'])
    q<HTMLInputElement>(id).disabled = pending || running;
  q<HTMLSelectElement>('axis').disabled = pending || running;
  customControls(document.body);
}
async function send(command: ScrollCommand) {
  if (pending && !['cancel', 'pause'].includes(command.kind)) return false;
  pending = true;
  render(view);
  let failure = '',success=false;
  try {
    if (!view.count && ['sample','manual', 'auto'].includes(command.kind))
      await api.command(view.token, {
        kind: 'configure',
        options: {
          axis: q<HTMLSelectElement>('axis').value as 'vertical' | 'horizontal',
          trimStart: Number(q<HTMLInputElement>('trim-start').value),
          trimEnd: Number(q<HTMLInputElement>('trim-end').value),
          ignoreStart: Number(q<HTMLInputElement>('ignore-start').value),
          ignoreEnd: Number(q<HTMLInputElement>('ignore-end').value),
        },
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
    void send({ kind });
  };
q('edit').onclick=()=>void(async()=>{if(await send({kind:'finish'}))await send({kind:'edit'});})();
q('preview-toggle').onclick=()=>void send({kind:'layout',preview:!view.previewExpanded});
q<HTMLDetailsElement>('setup').ontoggle=()=>{const open=q<HTMLDetailsElement>('setup').open;if(!view)return;void (async()=>{if(open)await send({kind:'pause'});await send({kind:'layout',preview:view.previewExpanded,settings:open});})();};
q('apply-settings').onclick=()=>void(async()=>{
  if(view.count&&!await confirmDialog({title:'重新开始长截图',message:'应用新设置会清空本次拼接结果，选区保持不变。',confirm:'重新开始'}))return;
  await send({kind:'restart',options:{axis:q<HTMLSelectElement>('axis').value as 'vertical'|'horizontal',trimStart:Number(q<HTMLInputElement>('trim-start').value),trimEnd:Number(q<HTMLInputElement>('trim-end').value),ignoreStart:Number(q<HTMLInputElement>('ignore-start').value),ignoreEnd:Number(q<HTMLInputElement>('ignore-end').value)}});
  q<HTMLDetailsElement>('setup').open=false;
})();
q('join').onclick = () => {
  void send({ kind: 'join', offset: Number(q<HTMLInputElement>('offset').value) });
};
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape'&&!document.querySelector('dialog[open]')) {
    event.preventDefault();
    void send({ kind: 'pause' });
  }
});
api.onChange(render);
void api
  .state()
  .then(value=>{render(value);document.body.dataset.scrollReady='true';})
  .catch((e) => {
    q('message').textContent = String(e);
    document.body.dataset.scrollError=String(e);
    void window.one.diagnosticsReport('scroll-capture',String(e));
  });
