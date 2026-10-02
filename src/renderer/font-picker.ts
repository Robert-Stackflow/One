import {fontPresets, fontStack, validFont, type InstalledFont, type UIFont} from '../shared/fonts';
import {openControl, releaseControl} from './controls';
import {api, icon} from './ui';
import './font-picker.css';
import {loadUIFont,refreshUIFontCache} from './font-runtime';
import {focusOption,revealOption} from './option-list';

interface FontOption {value: UIFont; label: string; family: string; search: string; missing?: boolean}
export function setupFontPicker(button: HTMLButtonElement) {
  let value: UIFont = 'system';
  let fonts: InstalledFont[] = [];
  let loaded = false, loading = false, error = '';
  let menu: HTMLDivElement | null = null, list: HTMLDivElement | null = null;
  let search: HTMLInputElement | null = null, sample: HTMLDivElement | null = null, status: HTMLDivElement | null = null;
  let refresh: HTMLButtonElement | null = null;
  let visible: FontOption[] = [], active = 0;
  let sampleTimer:ReturnType<typeof setTimeout>|undefined, sampleRevision=0,sampleFrame=0;
  let focused:HTMLElement|null=null;
  const label = button.querySelector('span')!;
  const display = () => {
    label.textContent = fontPresets.find(p => p.value === value)?.label || fonts.find(f => 'installed:' + f.family === value)?.label || value.slice(10);
    button.title = label.textContent;
  };
  Object.defineProperty(button, 'value', {get: () => value, set: (next: string) => {if (validFont(next)) {value = next; display();}}});
  display();
  const options = (): FontOption[] => {
    const result: FontOption[] = fontPresets.map(p => ({...p, family: '', search: p.label}));
    for (const font of fonts) result.push({value: `installed:${font.family}`, label: font.label, family: font.family, search: [font.label, font.family, ...font.aliases].join(' ').normalize('NFKC').toLocaleLowerCase()});
    if (loaded && value.startsWith('installed:') && !result.some(o => o.value === value)) result.push({value, label: value.slice(10), family: value.slice(10), search: value.slice(10).toLocaleLowerCase(), missing: true});
    return result;
  };
  const close = () => {
    clearTimeout(sampleTimer);cancelAnimationFrame(sampleFrame);sampleFrame=0;++sampleRevision;focused=null;
    menu?.remove(); menu = list = sample = status = null; search = null; refresh = null;
    button.setAttribute('aria-expanded', 'false'); button.removeAttribute('aria-controls');
    document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', close);
    document.removeEventListener('scroll', onScroll, true); releaseControl(close);
  };
  const outside = (event: PointerEvent) => {if (!button.contains(event.target as Node) && !menu?.contains(event.target as Node)) close();};
  const position = () => {
    if (!menu) return;
    const rect = button.getBoundingClientRect(), width = Math.min(360, window.innerWidth - 16);
    menu.style.width = width + 'px';
    menu.style.left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)) + 'px';
    const height = menu.getBoundingClientRect().height;
    menu.style.top = Math.max(8, Math.min(rect.bottom + height + 6 <= window.innerHeight ? rect.bottom + 6 : rect.top - height - 6, window.innerHeight - height - 8)) + 'px';
  };
  const onScroll = (event: Event) => {if (!menu?.contains(event.target as Node)) position();};
  const activate = (index: number, scroll = true) => {
    active = Math.max(0, Math.min(visible.length - 1, index));
    const item = list?.children[active] as HTMLElement | undefined;
    focused=focusOption(focused,visible.length&&item?item:null);
    if (item && visible.length) {search?.setAttribute('aria-activedescendant', item.id); if (scroll&&list) revealOption(list,item);}
    else search?.removeAttribute('aria-activedescendant');
    const selected=visible[active]?.value||value,revision=++sampleRevision;
    cancelAnimationFrame(sampleFrame);sampleFrame=requestAnimationFrame(()=>{sampleFrame=0;if(sample&&revision===sampleRevision)sample.style.fontFamily=fontStack(selected);});
    clearTimeout(sampleTimer);sampleTimer=setTimeout(()=>{void loadUIFont(selected).then(stack=>{if(sample&&revision===sampleRevision)sample.style.fontFamily=stack;}).catch(()=>{});},160);
  };
  const choose = (index: number) => {
    const option = visible[index]; if (!option || option.missing) return;
    value = option.value; display(); close(); button.focus(); button.dispatchEvent(new Event('change', {bubbles: true}));
  };
  const draw = () => {
    if (!list || !search || !status) return;
    const tokens = search.value.normalize('NFKC').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    visible = options().filter(o => tokens.every(token => o.search.includes(token)));
    const nodes = document.createDocumentFragment();
    visible.forEach((option, index) => {
      const node = document.createElement('div'); node.className = 'font-option'; node.id = `appearance-font-option-${index}`;
      node.setAttribute('role', 'option'); node.setAttribute('aria-label', option.label); node.setAttribute('aria-selected', String(option.value === value));
      if (option.missing) node.setAttribute('aria-disabled', 'true');
      const text = document.createElement('span'); text.textContent = option.label; node.append(text);
      if (option.missing || option.family && option.family !== option.label) {
        const secondary = document.createElement('small'); secondary.textContent = option.missing ? '未安装' : option.family; node.append(secondary);
      }
      node.insertAdjacentHTML('beforeend', icon('check'));
      node.addEventListener('pointerdown', e => e.preventDefault()); node.addEventListener('pointerenter', () => activate(index, false)); node.addEventListener('click', () => choose(index)); nodes.append(node);
    });
    if (!visible.length) {const empty = document.createElement('div'); empty.className = 'font-empty'; empty.textContent = loading ? '正在读取系统字体…' : error || '没有匹配的字体'; nodes.append(empty);}
    list.replaceChildren(nodes);
    status.textContent = loading ? '正在读取系统字体…' : error || (loaded && value.startsWith('installed:') && !fonts.some(f => 'installed:' + f.family === value) ? '当前字体未安装，使用系统默认字体。' : '');
    status.hidden = !status.textContent;
    if (refresh) refresh.disabled = loading;
    position(); activate(Math.max(0, visible.findIndex(o => o.value === value)));
  };
  const load = async (force: boolean) => {
    if (loading) return;
    loading = true; error = ''; draw();
    try {if(force)refreshUIFontCache();fonts = await api.installedFonts(force); loaded = true; display();}
    catch {error = '无法读取系统字体，点击刷新重试。';}
    finally {loading = false; draw();}
  };
  const open = () => {
    if (menu) return;
    openControl(close);
    menu = document.createElement('div'); menu.className = 'select-popup font-popup'; menu.popover = 'manual';
    const header = document.createElement('div'); header.className = 'font-search'; header.innerHTML = icon('search');
    search = document.createElement('input'); search.type = 'text'; search.id = 'appearance-font-search'; search.placeholder = '搜索字体'; search.setAttribute('aria-label', '搜索已安装字体'); search.setAttribute('role', 'combobox'); search.setAttribute('aria-autocomplete', 'list'); search.setAttribute('aria-controls', 'appearance-font-options'); search.setAttribute('aria-expanded', 'true');
    refresh = document.createElement('button'); refresh.className = 'icon-button quiet'; refresh.type = 'button'; refresh.title = '刷新字体列表'; refresh.setAttribute('aria-label', refresh.title); refresh.innerHTML = icon('refresh'); refresh.onclick = () => void load(true);
    header.append(search, refresh); list = document.createElement('div'); list.className = 'font-options'; list.id = 'appearance-font-options'; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', '界面字体');
    sample = document.createElement('div'); sample.className = 'font-sample'; sample.textContent = '字体预览 Aa 0123456789';
    status = document.createElement('div'); status.className = 'font-status'; status.setAttribute('role', 'status');
    menu.append(header, list, status, sample); document.body.append(menu); menu.showPopover();
    button.setAttribute('aria-expanded', 'true'); button.setAttribute('aria-controls', list.id);
    search.addEventListener('input', draw);
    menu.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (event.key === 'Escape') {event.preventDefault(); close(); button.focus();}
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {event.preventDefault(); activate(active + (event.key === 'ArrowDown' ? 1 : -1));}
      else if (event.key === 'Enter' && event.target === search) {event.preventDefault(); choose(active);}
      else if (event.key === 'Tab' && (event.shiftKey && event.target === search || !event.shiftKey && event.target === refresh)) {event.preventDefault(); close(); button.focus();}
    });
    document.addEventListener('pointerdown', outside, true); window.addEventListener('resize', close); document.addEventListener('scroll', onScroll, true);
    draw(); search.focus(); void load(false);
  };
  button.addEventListener('click', () => menu ? close() : open());
  button.addEventListener('keydown', event => {if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {event.preventDefault(); open();}});
}
