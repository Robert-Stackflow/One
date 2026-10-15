import {icon} from './ui';
import {enabledOption, focusOption, revealOption} from './option-list';
import {onRemoval} from './dom-lifecycle';

export interface SelectOption {label:string;value:string;disabled?:boolean;icon?:string;iconSrc?:string;group?:string}
/** Return a fresh option list; it is applied only while this open request remains current. */
export type SelectLoader = (signal:AbortSignal) => Promise<readonly SelectOption[]>;
const loaders = new WeakMap<HTMLElement, SelectLoader>();
const controls = new WeakMap<HTMLElement, {source:HTMLSelectElement;update(options:readonly SelectOption[]):void;close():void;setLoader(loader:SelectLoader|undefined):void}>();
/** For business controls that need native option metadata after enhancement. */
export function selectSource(control:HTMLElement){return controls.get(control)?.source||(control instanceof HTMLSelectElement?control:undefined);}
let closeActive:(() => void)|null = null;

export function setSelectLoader(control:HTMLElement, loader:SelectLoader|undefined) {
  const state = controls.get(control);
  if (state) {state.setLoader(loader);return;}
  if (loader) loaders.set(control, loader); else loaders.delete(control);
}
function replaceOptions(select:HTMLSelectElement, options:readonly SelectOption[]) {
  const value = select.value;
  select.replaceChildren(...options.map(option => {
    const node = new Option(option.label, option.value);
    node.disabled = !!option.disabled;
    if(option.group)node.dataset.group=option.group;
    if (option.icon) node.dataset.icon = option.icon;
    if (option.iconSrc) node.dataset.iconSrc = option.iconSrc;
    return node;
  }));
  if (options.some(option => option.value === value)) select.value = value;
}
function optionContent(node:HTMLElement, option:SelectOption) {
  node.textContent = '';
  if (option.icon || option.iconSrc) {
    const image = document.createElement('span');
    image.className = 'select-option-icon';image.setAttribute('aria-hidden', 'true');
    if (option.iconSrc) {
      const img = document.createElement('img');img.src = option.iconSrc;img.alt = '';img.width = img.height = 16;
      image.append(img);
    } else image.innerHTML = icon(option.icon!);
    node.append(image);
  }
  const text = document.createElement('span');text.className = 'select-option-label';text.textContent = option.label;
  node.append(text);
}
function enhanceSelect(select:HTMLSelectElement) {
  if (controls.has(select)) return;
  const readOptions = ():SelectOption[] => [...select.options].map(option => ({
    label:option.text, value:option.value, disabled:option.disabled,
    icon:option.dataset.icon, iconSrc:option.dataset.iconSrc,group:option.dataset.group||(option.parentElement instanceof HTMLOptGroupElement?option.parentElement.label:undefined),
  }));
  let options = readOptions();
  let loader = loaders.get(select);loaders.delete(select);
  const button = document.createElement('button');button.type = 'button';
  button.className = 'custom-select' + (select.className ? ' ' + select.className : '');
  button.id = select.id || 'select-' + crypto.randomUUID();button.disabled = select.disabled;button.hidden = select.hidden;
  for (const attribute of select.attributes) {
    if (attribute.name.startsWith('data-') || ['title','name','aria-describedby','style'].includes(attribute.name))
      button.setAttribute(attribute.name, attribute.value);
  }
  button.setAttribute('role','combobox');button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');
  const associatedLabel = select.labels?.item(0);
  const labelText = associatedLabel ? [...associatedLabel.childNodes].filter(node => node.nodeType === Node.TEXT_NODE)
    .map(node => node.textContent?.trim()).filter(Boolean).join(' ') : '';
  button.setAttribute('aria-label', select.getAttribute('aria-label') || labelText || associatedLabel?.querySelector('span')?.textContent?.trim() || '选择');
  const label = document.createElement('span');button.append(label);button.insertAdjacentHTML('beforeend', icon('chevron-down'));
  let value = select.value, active = -1, prefix = '', typedAt = 0;
  let popup:HTMLDivElement|null = null, menu:HTMLDivElement|null = null, search:HTMLInputElement|null = null;
  let optionNodes:HTMLElement[]=[],groupNodes:{node:HTMLElement;indices:number[]}[]=[];
  let modal:HTMLDialogElement|null = null, focused:HTMLElement|null = null, selected:HTMLElement|null = null;
  let visible:number[] = [], disposed = false, opening = 0, abort:AbortController|undefined;
  let pendingInitial = '', pendingKey = '', pendingPrefix = '';
  const available = () => !disposed && !button.disabled && button.isConnected && button.getClientRects().length > 0;
  const searchable = () => button.dataset.searchable === 'true' || button.dataset.searchable !== 'false' && options.length >= 10;
  const renderLabel = () => {
    const option = options.find(option => option.value === value);
    optionContent(label, {...option, value, label:button.dataset.displayLabel || option?.label || '没有可选项'});
    if (menu) {
      const node = optionNodes[options.findIndex(option => option.value === value)];
      if (selected !== node) {selected?.setAttribute('aria-selected','false');node?.setAttribute('aria-selected','true');selected = node || null;}
    }
  };
  const close = () => {
    opening++;abort?.abort();abort = undefined;button.removeAttribute('aria-busy');
    popup?.remove();popup = menu = search = null;visible = [];optionNodes=[];groupNodes=[];focused = selected = null;active = -1;
    modal?.removeEventListener('close',close);modal = null;
    button.setAttribute('aria-expanded','false');button.removeAttribute('aria-controls');button.removeAttribute('aria-activedescendant');
    document.removeEventListener('pointerdown',outside,true);window.removeEventListener('resize',close);
    document.removeEventListener('scroll',position,true);releaseControl(close);
  };
  const sync = () => {
    if (disposed) return;
    const next = readOptions();
    if (menu && JSON.stringify(next) !== JSON.stringify(options)) close();
    options = next;value = select.value;renderLabel();
  };
  const setValue = (next:string) => {if (options.some(option => option.value === next)) {select.value = next;sync();}};
  Object.defineProperty(button,'value',{get:() => value, set:setValue});
  // Retained source references can update options; the visible control keeps One's existing ID and value API.
  const restoreProperties:(() => void)[] = [];
  for (const property of ['value','selectedIndex'] as const) {
    const native = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, property)!;
    const own = Object.getOwnPropertyDescriptor(select, property);
    Object.defineProperty(select, property, {configurable:true,
      get:() => native.get!.call(select), set:next => {native.set!.call(select,next);sync();}});
    restoreProperties.push(() => {if (own) Object.defineProperty(select,property,own);else Reflect.deleteProperty(select,property);});
  }
  const outside = (event:PointerEvent) => {if (!button.contains(event.target as Node) && !popup?.contains(event.target as Node)) close();};
  const activate = (index:number) => {
    active = index;const option = menu?optionNodes[index]:undefined;
    if (focused === option) return;focused = focusOption(focused,option || null);
    if (option && !option.hidden) {
      button.setAttribute('aria-activedescendant',option.id);search?.setAttribute('aria-activedescendant',option.id);
      if (menu) revealOption(menu,option);
    } else {button.removeAttribute('aria-activedescendant');search?.removeAttribute('aria-activedescendant');}
  };
  const move = (index:number,direction:1|-1) => {
    const next = enabledOption(visible.map(i => options[i]),index,direction);if (next >= 0) activate(visible[next]);
  };
  const choose = (index:number) => {
    if (!available() || !options[index] || options[index].disabled) return;
    setValue(options[index].value);close();button.focus();
    select.dispatchEvent(new Event('change',{bubbles:true}));button.dispatchEvent(new Event('change',{bubbles:true}));
  };
  const position = () => {
    if (!available()) {close();return;}if (!popup) return;
    const rect = button.getBoundingClientRect(), edge = 8, gap = 5, maxWidth = Math.max(0,Math.min(480,innerWidth-edge*2));
    popup.style.width = 'max-content';popup.style.minWidth = Math.min(Math.max(rect.width,120),maxWidth)+'px';popup.style.maxWidth = maxWidth+'px';
    const below = Math.max(0,innerHeight-rect.bottom-gap-edge), above = Math.max(0,rect.top-gap-edge);
    const opensAbove = below < Math.min(272,popup.scrollHeight) && above > below;
    popup.dataset.placement = opensAbove ? 'above' : 'below';popup.style.maxHeight = Math.min(272,opensAbove ? above : below)+'px';
    const size = popup.getBoundingClientRect();popup.style.left = Math.max(edge,Math.min(rect.left,innerWidth-edge-size.width))+'px';
    popup.style.top = (opensAbove ? Math.max(edge,rect.top-gap-size.height) : Math.min(innerHeight-edge-size.height,rect.bottom+gap))+'px';
  };
  const filter = (query:string) => {
    if (!menu) return;const needle = query.trim().toLocaleLowerCase();visible = [];
    options.forEach((option,index) => {const node = optionNodes[index];
      node.hidden = !!needle && !option.label.toLocaleLowerCase().includes(needle);if (!node.hidden) visible.push(index);});
    for(const group of groupNodes)group.node.hidden=!group.indices.some(index=>!optionNodes[index].hidden);
    (menu.lastElementChild as HTMLElement).hidden = visible.length > 0;
    activate(visible.find(index => !options[index].disabled) ?? -1);position();
  };
  const onKey = (event:KeyboardEvent) => {
    if (event.key === 'Escape') {event.preventDefault();event.stopPropagation();close();button.focus();return;}
    if (event.key === 'Tab') {close();return;}
    if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault();const at = visible.indexOf(active);
      if (event.key === 'Home') move(0,1);else if (event.key === 'End') move(visible.length-1,-1);
      else {const direction = event.key === 'ArrowDown' ? 1 : -1;move(at < 0 ? direction > 0 ? 0 : visible.length-1 : at+direction,direction);}return;
    }
    if (event.key === 'Enter' || event.key === ' ' && event.target === button) {event.preventDefault();if (active >= 0) choose(active);}
  };
  const listen = () => {
    modal = button.closest('dialog');modal?.addEventListener('close',close);
    document.addEventListener('pointerdown',outside,true);window.addEventListener('resize',close);
    document.addEventListener('scroll',position,true);
  };
  const open = (initial = '', key = '', startsWith = '') => {
    if (menu || !available()) return;
    if (closeActive !== close) openControl(close);
    popup = document.createElement('div');popup.className = 'select-popup';
    menu = document.createElement('div');menu.className = 'select-popup-options';menu.setAttribute('role','listbox');menu.id = button.id+'-options';
    button.setAttribute('aria-controls',menu.id);button.setAttribute('aria-expanded','true');
    if (searchable()) {
      search = document.createElement('input');search.type = 'search';search.className = 'select-popup-search';search.value = initial;
      search.placeholder = '筛选选项';search.setAttribute('aria-label','筛选选项');search.setAttribute('aria-controls',menu.id);
      search.addEventListener('input',() => filter(search!.value));search.addEventListener('keydown',onKey);popup.append(search);
    }
    options.forEach((option,index) => {
      if(option.group){let group=groupNodes[groupNodes.length-1];if(!group||group.node.textContent!==option.group){const header=document.createElement('div');header.className='select-option-group';header.textContent=option.group;header.role='presentation';menu!.append(header);group={node:header,indices:[]};groupNodes.push(group);}group.indices.push(index);}
      const node = document.createElement('div');node.setAttribute('role','option');node.setAttribute('aria-label',option.label);node.id = menu!.id+'-'+index;
      optionContent(node,option);node.insertAdjacentHTML('beforeend',icon('check'));
      optionNodes.push(node);
      node.setAttribute('aria-disabled',String(!!option.disabled));node.setAttribute('aria-selected',String(option.value === value));
      if (option.value === value) selected = node;
      node.addEventListener('pointerdown',event => event.preventDefault());
      node.addEventListener('pointerenter',() => {if (!option.disabled) activate(index);});node.addEventListener('click',() => choose(index));menu!.append(node);
    });
    const empty = document.createElement('div');empty.className = 'select-empty';empty.role = 'status';empty.textContent = '没有匹配项';
    menu.append(empty);popup.append(menu);popup.popover = 'manual';(button.closest('dialog') || document.body).append(popup);popup.showPopover();
    listen();filter(initial);
    if (!initial) {const at = options.findIndex(option => option.value === value);if (at >= 0 && !options[at].disabled) activate(at);}
    if (key === 'Home') move(0,1);else if (key === 'End') move(visible.length-1,-1);
    if (startsWith) {const at = options.findIndex(option => !option.disabled && option.label.toLocaleLowerCase().startsWith(startsWith));if (at >= 0) activate(at);}
    search?.focus();
  };
  const requestOpen = async (initial = '', key = '', startsWith = '') => {
    if (menu || !available()) return;
    pendingInitial = initial;pendingKey = key;pendingPrefix = startsWith;
    if (abort) return;
    const load = loader;
    if (!load) {open(initial,key,startsWith);return;}
    openControl(close);const revision = ++opening, request = new AbortController();abort = request;
    button.setAttribute('aria-busy','true');listen();
    try {
      const next = await load(request.signal);
      if (revision !== opening || request.signal.aborted || !available()) return;
      replaceOptions(select,next);sync();open(pendingInitial,pendingKey,pendingPrefix);
    } catch (error) {
      if (revision === opening && !request.signal.aborted && available())
        button.dispatchEvent(new CustomEvent('one:load-error',{detail:error,bubbles:true}));
    } finally {
      if (revision === opening) {abort = undefined;button.removeAttribute('aria-busy');if (!menu) close();}
    }
  };
  button.addEventListener('click',() => {if (menu || abort) close();else void requestOpen();});
  button.addEventListener('keydown',event => {
    if (event.isComposing || disposed) return;
    if (event.key === 'Escape' || event.key === 'Tab' || menu) {onKey(event);return;}
    if (['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(event.key)) {event.preventDefault();void requestOpen('',event.key);return;}
    if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();if (searchable()) {void requestOpen(abort ? pendingInitial+event.key : event.key);return;}
      if (Date.now()-typedAt > 700) prefix = '';prefix += event.key.toLocaleLowerCase();typedAt = Date.now();void requestOpen('','',prefix);
    }
  });
  const update = (next:readonly SelectOption[]) => {close();replaceOptions(select,next);sync();};
  const updateEvent = (event:Event) => update((event as CustomEvent<readonly SelectOption[]>).detail);
  select.addEventListener('change',sync);select.addEventListener('one:options',updateEvent);button.addEventListener('one:options',updateEvent);
  const observer = new MutationObserver(records => {
    for (const record of records) if (record.target === select && record.attributeName) {
      const name = record.attributeName;
      if (name === 'disabled') button.disabled = select.disabled;
      if (name === 'hidden') button.hidden = select.hidden;
      if (name.startsWith('data-')) {
        const value = select.getAttribute(name);if (value === null) button.removeAttribute(name);else button.setAttribute(name,value);
      }
    }
    sync();
  });
  observer.observe(select,{subtree:true,childList:true,attributes:true,characterData:true});
  const stateObserver = new MutationObserver(() => {if (!available()) close();renderLabel();});
  stateObserver.observe(button,{attributes:true,attributeFilter:['disabled','hidden','data-display-label']});
  const resize = new ResizeObserver(() => {if (menu || abort) position();});resize.observe(button);
  const state = {source:select,update,close,setLoader(next:SelectLoader|undefined){close();loader = next;}};
  controls.set(select,state);controls.set(button,state);
  select.replaceWith(button);sync();
  onRemoval(button,() => {
    disposed = true;close();observer.disconnect();stateObserver.disconnect();resize.disconnect();
    select.removeEventListener('change',sync);select.removeEventListener('one:options',updateEvent);button.removeEventListener('one:options',updateEvent);
    for (const restore of restoreProperties) restore();
    controls.delete(select);controls.delete(button);loader = undefined;
  });
}

/** Replace native selection controls with One's keyboard-accessible popup. */
export function customControls(root:HTMLElement) {
  for (const select of root.querySelectorAll<HTMLSelectElement>('select')) enhanceSelect(select);
  for (const input of root.querySelectorAll<HTMLInputElement>('input[type=number]')) {
    if (input.dataset.customControl==='true'||input.parentElement?.classList.contains('number-control')) continue;
    const wrapper = document.createElement('span');wrapper.className = 'number-control';input.replaceWith(wrapper);wrapper.append(input);
    for (const direction of [-1,1] as const) {
      const button = document.createElement('button');button.type = 'button';button.innerHTML = icon(direction < 0 ? 'minus' : 'plus');
      button.setAttribute('aria-label',(direction < 0 ? '减少' : '增加')+(input.getAttribute('aria-label') || input.closest('label')?.textContent?.trim() || '数值'));
      button.addEventListener('click',() => {
        if (input.disabled) return;
        const number = Number(input.value)+(Number(input.step) || 1)*direction;
        input.value = String(Math.max(input.min ? Number(input.min) : -Infinity,Math.min(input.max ? Number(input.max) : Infinity,number)));
        input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
      });wrapper.append(button);
    }
  }
}
export function closeControls() {closeActive?.();}
export function updateSelectOptions(control:HTMLElement, options:readonly SelectOption[]) {
  const state = controls.get(control);
  if (state) state.update(options);
  else if (control instanceof HTMLSelectElement) replaceOptions(control,options);
}
export function openControl(close:() => void) {closeActive?.();closeActive = close;}
export function releaseControl(close:() => void) {if (closeActive === close) closeActive = null;}
