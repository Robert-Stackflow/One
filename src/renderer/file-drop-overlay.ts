import {api,icon,toast} from './ui';
import './file-drop-overlay.css';

interface FileDropOptions {
  title: string | (() => string);
  detail: string | (() => string);
  onDrop: (paths: string[], event: DragEvent) => void | Promise<void>;
  placement?: 'window' | 'host';
  spacious?: boolean;
  enabled?: () => boolean;
}

export function installFileDropOverlay(host: HTMLElement, options: FileDropOptions) {
  const overlay = document.createElement('div');
  overlay.className = 'file-drop-overlay'+(options.placement==='host'?' local'+(options.spacious?' spacious':''):'');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `<div class="file-drop-card"><span class="file-drop-icon">${icon('folder')}</span><strong></strong><span class="file-drop-detail"></span></div>`;
  const label = (value:string|(()=>string)) => typeof value === 'function' ? value() : value;
  if(options.placement==='host')host.classList.add('file-drop-zone');
  (options.placement==='host'?host:document.body).append(overlay);

  const files = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
  const enabled=()=>options.enabled?.()??true;
  const show = () => { if(!overlay.classList.contains('visible')){overlay.querySelector('strong')!.textContent=label(options.title);overlay.querySelector('.file-drop-detail')!.textContent=label(options.detail);}overlay.classList.add('visible'); overlay.setAttribute('aria-hidden', 'false'); };
  const hide = () => { overlay.classList.remove('visible'); overlay.setAttribute('aria-hidden', 'true'); };
  host.addEventListener('dragenter', event => { if (files(event)&&enabled()) show(); }, true);
  host.addEventListener('dragover', event => {
    if (!files(event)) return;
    event.preventDefault();
    if(!enabled()){if(event.dataTransfer)event.dataTransfer.dropEffect='none';hide();return;}
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    show();
  }, true);
  host.addEventListener('dragleave', event => {
    if (event.relatedTarget instanceof Node && host.contains(event.relatedTarget)) return;
    if (event.target !== host) {
      const bounds = host.getBoundingClientRect();
      if (event.clientX > bounds.left && event.clientX < bounds.right && event.clientY > bounds.top && event.clientY < bounds.bottom) return;
    }
    hide();
  }, true);
  host.addEventListener('drop', event => {
    if (!files(event)) return;
    event.preventDefault();
    if(!enabled()){hide();return;}
    event.stopPropagation();
    hide();
    const paths = Array.from(event.dataTransfer?.files || [], file => api.droppedFile(file)).filter(Boolean);
    if (paths.length) try { void Promise.resolve(options.onDrop(paths,event)).catch(toast); } catch (error) { toast(error); }
  }, true);
  window.addEventListener('blur', hide);
  window.addEventListener('dragend', hide);
  return hide;
}
