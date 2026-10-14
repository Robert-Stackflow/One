import './scroll-capture.css';
import { customControls } from '../controls';
import type { ScrollCommand, ScrollView } from '../../shared/capture/scroll-capture';
import {applyCaptureScale} from './appearance';
import {confirmDialog} from '../dialog';
const api = window.one.scrollCapture!,
  q = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let view: ScrollView,
  pending = false;
function render(next: ScrollView) {
  view = next;
  applyCaptureScale(document.body,next.uiScale);
  q('message').textContent = next.message;
  q('setup').hidden = false;
  q('pending').hidden = !next.pending;
  q('empty').hidden = !!next.preview;
  q<HTMLImageElement>('preview').hidden = !next.preview;
  q('preview-paper').hidden=!next.preview;
  if (next.preview && q<HTMLImageElement>('preview').src !== next.preview)
    q<HTMLImageElement>('preview').src = next.preview;
  const vertical=next.options.axis==='vertical',length=vertical?next.height:next.width,viewport=(vertical?next.source.height:next.source.width)-next.options.trimStart-next.options.trimEnd;
  for(const [id,size] of [['preview-viewport',viewport],['preview-addition',next.offset]] as const){
    const node=q(id),fraction=Math.min(100,Math.max(0,size/Math.max(1,length)*100));node.style.cssText=vertical?`left:0;right:0;bottom:0;height:${fraction}%`:`top:0;bottom:0;right:0;width:${fraction}%`;
    node.hidden=!next.preview||(id==='preview-addition'&&(next.match!=='accepted'||next.pending||!next.offset));
  }
  q('dimensions').textContent = next.count
    ? `${next.width} × ${next.height} · ${next.count} 帧`
    : '尚未采集';
  q('sample').textContent = next.count ? '采集下一帧' : '采集首帧';
  q('auto').textContent = '自动滚动';q<HTMLButtonElement>('auto').ariaPressed=String(next.mode==='auto');q<HTMLButtonElement>('manual').ariaPressed=String(next.mode==='manual');
  const running = next.phase === 'running';
  q('auto').hidden = false;
  q('pause').hidden = !running;
  for (const id of ['sample', 'manual','auto', 'join'])
    q<HTMLButtonElement>(id).disabled = pending || (id==='sample'||id==='join')&&running || (next.pending && id==='sample');
  q('preview-toggle').textContent=next.previewExpanded?'收起预览':'展开预览';q<HTMLElement>('preview').closest<HTMLElement>('.scroll-preview')!.hidden=!next.previewExpanded;
  q<HTMLButtonElement>('undo').disabled = pending || running || !next.undo;
  q<HTMLButtonElement>('finish').disabled = pending || !next.count;
  q<HTMLButtonElement>('edit').disabled = pending || !next.canEdit;
  q<HTMLInputElement>('offset').value = String(next.offset || 1);
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
  if (pending && !['cancel', 'pause'].includes(command.kind)) return;
  pending = true;
  render(view);
  let failure = '';
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
    if (next) render(next);
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
}
for (const kind of ['sample','manual', 'auto', 'pause', 'undo', 'finish', 'edit', 'cancel'] as const)
  q(kind).onclick = () => {
    void send({ kind });
  };
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
