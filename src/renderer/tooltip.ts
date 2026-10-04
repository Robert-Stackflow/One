type TooltipSide = 'top' | 'right' | 'bottom' | 'left';

/** One delegated tooltip for dynamic controls, including controls inside modal dialogs. */
export function setupTooltips() {
 const tip = document.createElement('div');
 tip.id = 'one-tooltip'; tip.className = 'one-tooltip'; tip.role = 'tooltip';
 let target: HTMLElement | null = null, timer: ReturnType<typeof setTimeout>, last = -1000;
 const convert = (el: Element) => {
  if (!el.hasAttribute('title')) return;
  const text = el.getAttribute('title') || ''; el.removeAttribute('title');
  if (text) el.setAttribute('data-tooltip', text); else el.removeAttribute('data-tooltip');
 };
 document.querySelectorAll('[title]').forEach(convert);
 new MutationObserver(records => {
  for (const record of records) {
   if (record.type === 'attributes') {
    if (record.attributeName === 'title') convert(record.target as Element);
    else if (record.target === target) {
     const label = target.dataset.tooltip || '';
     if (!label) hide(); else if (tip.classList.contains('visible')) {tip.textContent = label; position(target);}
    }
   }
   else for (const node of record.addedNodes) if (node instanceof Element) {
    convert(node); node.querySelectorAll('[title]').forEach(convert);
   }
  }
  if (target && !target.isConnected) hide();
 }).observe(document.documentElement, {subtree: true, childList: true, attributes: true, attributeFilter: ['title', 'data-tooltip']});

 const hide = () => {
  clearTimeout(timer);
  if (target) {
   const ids = (target.getAttribute('aria-describedby') || '').split(' ').filter(id => id && id !== tip.id);
   if (ids.length) target.setAttribute('aria-describedby', ids.join(' ')); else target.removeAttribute('aria-describedby');
  }
  target = null; tip.classList.remove('visible'); last = performance.now();
 };
 const position = (el: HTMLElement) => {
  const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect(), margin = 8, gap = 12;
  const requested = el.dataset.tooltipSide;
  const preferred: TooltipSide = requested === 'top' || requested === 'right' || requested === 'bottom' || requested === 'left'
   ? requested : el.matches('.sidebar .nav') ? 'right' : 'top';
  const space = {top: r.top - margin, right: innerWidth - r.right - margin, bottom: innerHeight - r.bottom - margin, left: r.left - margin};
  const fits = (side: TooltipSide) => space[side] >= (side === 'left' || side === 'right' ? t.width : t.height) + gap;
  const opposite: Record<TooltipSide, TooltipSide> = {top: 'bottom', right: 'left', bottom: 'top', left: 'right'};
  const sides: TooltipSide[] = [preferred, opposite[preferred], ...(['top', 'right', 'bottom', 'left'] as TooltipSide[])
   .filter(side => side !== preferred && side !== opposite[preferred]).sort((a, b) => space[b] - space[a])];
  const side = sides.find(fits) || sides.reduce((best, next) => space[next] > space[best] ? next : best);
  const clamp = (value: number, size: number, available: number) => Math.max(margin, Math.min(available - size - margin, value));
  let x = r.left + (r.width - t.width) / 2, y = r.top + (r.height - t.height) / 2;
  if (side === 'right') x = r.right + gap;
  else if (side === 'left') x = r.left - t.width - gap;
  else if (side === 'top') y = r.top - t.height - gap;
  else y = r.bottom + gap;
  x = Math.round(clamp(x, t.width, innerWidth)); y = Math.round(clamp(y, t.height, innerHeight));
  const vertical = side === 'right' || side === 'left';
  const arrow = Math.max(10, Math.min((vertical ? t.height : t.width) - 10,
   vertical ? r.top + r.height / 2 - y : r.left + r.width / 2 - x));
  tip.dataset.side = side; tip.style.left = x + 'px'; tip.style.top = y + 'px';
  tip.style.setProperty('--tooltip-arrow', arrow + 'px');
 };
 const show = (el: HTMLElement) => {
  if (el === target) return;
  const fast = performance.now() - last < 200; hide(); target = el;
  timer = setTimeout(() => {
   if (target !== el || !el.isConnected) return;
   const label = el.dataset.tooltip || (el.matches('button.icon-button,.nav') ? el.getAttribute('aria-label') : '');
   if (!label) return;
   const bounds = el.getBoundingClientRect();
   if (!bounds.width || !bounds.height || bounds.bottom <= 0 || bounds.top >= innerHeight || bounds.right <= 0 || bounds.left >= innerWidth) return;
   tip.textContent = label; (el.closest('dialog[open]') || document.body).append(tip);
   tip.classList.remove('visible'); tip.style.left = '0px'; tip.style.top = '0px'; position(el);
   el.setAttribute('aria-describedby', [el.getAttribute('aria-describedby') || '', tip.id].filter(Boolean).join(' '));
   requestAnimationFrame(() => {if (target === el) tip.classList.add('visible');});
  }, fast ? 90 : 380);
 };
 const candidate = (event: Event) => {
  const el = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tooltip],button.icon-button[aria-label],.nav[aria-label]') : null;
  if (el) show(el);
 };
 document.addEventListener('pointerover', candidate);
 document.addEventListener('pointerout', event => {
  if (target && event.target instanceof Node && target.contains(event.target) && (!event.relatedTarget || !target.contains(event.relatedTarget as Node))) hide();
 });
 document.addEventListener('focusin', event => {if (event.target instanceof Element && event.target.matches(':focus-visible')) candidate(event);});
 document.addEventListener('focusout', hide); document.addEventListener('pointerdown', hide, true);
 document.addEventListener('keydown', hide, true); document.addEventListener('scroll', hide, true);
 window.addEventListener('blur', hide); window.addEventListener('resize', hide);
}
