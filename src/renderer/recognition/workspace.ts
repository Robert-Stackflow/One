import { q, icon, registerIcons } from '../ui';
import { PanelRightClose, PanelRightOpen } from 'lucide';
export function mountImageWorkspace(root:HTMLElement,divider:HTMLElement,toggle:HTMLButtonElement,visible=true) {
  registerIcons({ 'panel-right-close': PanelRightClose, 'panel-right-open': PanelRightOpen });
  let ratio = 0.67, hidden = false;
  try { const saved = Number(localStorage.getItem('ocr-image-ratio')); if (saved >= 0.3 && saved <= 0.8) ratio = saved; } catch {}
  function layout() {
    const width = root.clientWidth;
    const minimum=width?Math.max(0.3,Math.min(240/width,0.5)):0.3,maximum=width?Math.min(0.8,Math.max(0.5,1-228/width)):0.8;
    const current = Math.max(minimum,Math.min(ratio,maximum));
    root.style.setProperty('--ocr-image-width', (current * 100).toFixed(2) + '%'); divider.setAttribute('aria-valuenow', String(Math.round(current * 100)));
    divider.setAttribute('aria-valuemin',String(Math.round(minimum*100)));divider.setAttribute('aria-valuemax',String(Math.round(maximum*100)));
  }
  function show(value: boolean) {
    hidden = !value; root.classList.toggle('results-hidden', hidden); toggle.ariaExpanded = String(value);
    toggle.ariaLabel = toggle.title = hidden ? '展开结果栏' : '收起结果栏'; toggle.innerHTML = icon(hidden ? 'lucide:panel-right-open' : 'lucide:panel-right-close'); layout();
  }
  toggle.onclick = () => show(hidden);
  const save = () => { try { localStorage.setItem('ocr-image-ratio', String(ratio)); } catch {} };
  divider.onpointerdown = event => {
    if (event.button !== 0) return; event.preventDefault(); divider.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) => { const rect = root.getBoundingClientRect(); ratio = Math.max(0.3, Math.min(0.8, (next.clientX - rect.left) / rect.width)); layout(); };
    const finish = () => { divider.removeEventListener('pointermove', move); divider.removeEventListener('lostpointercapture', finish); save(); };
    divider.addEventListener('pointermove', move); divider.addEventListener('lostpointercapture', finish, { once: true });
    divider.addEventListener('pointerup', () => { if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId); }, { once: true });
  };
  divider.onkeydown = event => { if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return; event.preventDefault(); ratio = Math.max(0.3, Math.min(0.8, Number(divider.getAttribute('aria-valuenow'))/100 + (event.key === 'ArrowLeft' ? -0.02 : 0.02))); layout(); save(); };
  divider.ondblclick = () => { ratio = 0.67; layout(); save(); };
  const observer = new ResizeObserver(layout); observer.observe(root); show(visible);
  const dispose=()=>{observer.disconnect();window.removeEventListener('beforeunload',dispose);};
  window.addEventListener('beforeunload',dispose,{once:true});
  return { show,dispose };
}
export function mountOCRWorkspace(){return mountImageWorkspace(q('ocr-workspace'),q('ocr-divider'),q<HTMLButtonElement>('result-panel-toggle'));}
