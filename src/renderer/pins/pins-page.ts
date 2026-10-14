import type {PinsAPI,PinWorkspace} from '../../shared/pins';
import type { PinAction } from '../../shared/pins';
import { icon, toast, registerIcons } from '../ui';
import { Eye, EyeOff, MousePointer2, Copy, Download, Folder, Images, MoreHorizontal, Pencil, Pin, Plus, Settings2, Trash2 } from 'lucide';
import { ActionScope } from '../action-scope';
import { customControls, closeControls, openControl } from '../controls';
import {dialogMarkup,openDialog,closeDialog,lockDialogDismiss,confirmDialog} from '../dialog';
import {positionAnchoredPopover} from '../anchored-popover';
import {searchField,setupSearchField} from '../search-field';
import './pins-page.css';
registerIcons({eye:Eye,'eye-off':EyeOff,pointer:MousePointer2,copy:Copy,download:Download,folder:Folder,images:Images,more:MoreHorizontal,pencil:Pencil,pin:Pin,plus:Plus,settings:Settings2,trash:Trash2});
const escape = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function mountPinsPage(root: HTMLElement, api: PinsAPI, get: () => PinWorkspace) {
  let group = 'all',
    signature = '',
    disposed = false,
    active=true,
    query = '',
    visibility = 'all';
  let observer: IntersectionObserver | undefined;
  const previews = new Map<string, string>();
  let loading = 0;
  const pending: HTMLImageElement[] = [];
  function loadPreviews() {
    while (!disposed && active && loading < 4 && pending.length) {
      const img = pending.shift()!;
      if (!img.isConnected) continue;
      loading++;
      void api
        .pinsPreview(img.dataset.preview!)
        .then((url) => {
          if (!url || disposed) return;
          if (previews.size >= 80) previews.delete(previews.keys().next().value!);
          previews.set(img.dataset.hash!, url);
          if (active && img.isConnected) {
            img.src = url;
            img.hidden = false;
            img.parentElement!.classList.add('loaded');
          }
        })
        .catch(() => {
          if (img.isConnected) {
            const host = img.parentElement!.querySelector('.pin-preview-placeholder');
            if (host) host.textContent = '预览读取失败';
          }
        })
        .finally(() => {
          loading--;
          loadPreviews();
        });
    }
  }
  const selected = new Set<string>(),
    actions = new ActionScope();
  const error = (e: unknown) => toast(e instanceof Error ? e.message : e);
  function nameDialog(title:string,initial:string,save:(name:string)=>Promise<void>){
    const holder=document.createElement('div');holder.innerHTML=dialogMarkup({id:'pin-name-dialog',title,className:'pins-name-dialog',body:'<form id="pin-name-form"><label for="pin-name">名称</label><input id="pin-name" name="name" maxlength="120" autofocus autocomplete="off"><p class="dialog-error" id="pin-name-error" role="alert"></p></form>',actions:'<button type="button" id="pin-name-cancel" class="quiet">取消</button><button class="primary" type="submit" form="pin-name-form">保存</button>'});
    const dialog=holder.firstElementChild as HTMLDialogElement,input=dialog.querySelector<HTMLInputElement>('input')!;
    input.value=initial;document.body.append(dialog);let busy=false;
    dialog.addEventListener('close',()=>dialog.remove(),{once:true});
    dialog.querySelector('#pin-name-cancel')!.addEventListener('click',()=>void closeDialog(dialog));
    dialog.querySelector('form')!.onsubmit=async event=>{
      event.preventDefault();if(busy)return;const name=input.value.trim();
      if(!name){dialog.querySelector('#pin-name-error')!.textContent='请输入名称';input.focus();return;}
      busy=true;const release=lockDialogDismiss(dialog),button=dialog.querySelector<HTMLButtonElement>('[type=submit]')!;button.disabled=true;
      try{await save(name);release();await closeDialog(dialog);}catch(reason){dialog.querySelector('#pin-name-error')!.textContent=reason instanceof Error?reason.message:String(reason);}finally{release();busy=false;button.disabled=false;}
    };openDialog(dialog);
  }
  const pinsInGroup = () =>
    get().pins.filter(
      (p) => group === 'all' || (group === 'none' ? p.group === null : p.group === group),
    );
  const bind = (
    selector: string,
    work: (button: HTMLButtonElement) => unknown | Promise<unknown>,
    key = selector,
  ) =>
    root.querySelectorAll<HTMLButtonElement>(selector).forEach((b) =>
      actions.bind(
        b,
        () => {
          closeControls();
          return work(b);
        },
        error,
        key + (b.dataset.id || ''),
      ),
    );
  const groupIds = () => pinsInGroup().map((p) => p.id);
  const many = async (ids: string[], action: PinAction) => {
    for (const id of ids) await api.pinsAction(id, action);
  };
  const removeSelected = async (ids:string[]) => {
    if(!ids.length||!await confirmDialog({title:'删除所选贴图',message:`删除这 ${ids.length} 个贴图？素材工程会保留。`,confirm:'删除',danger:true}))return;
    let completed=0;const failures:string[]=[];
    for(const id of ids){try{await api.pinsAction(id,{kind:'remove'});selected.delete(id);completed++;}catch(reason){failures.push(reason instanceof Error?reason.message:String(reason));}}
    update();toast(failures.length?`已删除 ${completed} 项，${failures.length} 项未完成：${failures[0]}`:`已删除 ${completed} 个贴图`);
  };
  function update() {
    if (disposed||!active) return;
    const workspace = get();
    if (group !== 'all' && group !== 'none' && !workspace.groups.some((g) => g.id === group))
      group = 'all';
    for (const id of selected) if (!workspace.pins.some((p) => p.id === id)) selected.delete(id);
    const next = JSON.stringify([workspace, group, visibility, query, [...selected]]);
    if (next === signature) return;
    signature = next;
    const focused = document.activeElement?.id === 'pins-search',
      caret = focused ? root.querySelector<HTMLInputElement>('#pins-search')?.selectionStart : null;
    closeControls();
    observer?.disconnect();
    pending.length = 0;
    const pins = pinsInGroup().filter(
        (p) =>
          (visibility === 'all' || (visibility === 'visible') === p.view.visible) &&
          (!query ||
            (
              p.title +
              ' ' +
              (p.content.kind === 'text'
                ? p.content.text
                : p.content.kind === 'files'
                  ? p.content.files.map((f) => f.name).join(' ')
                  : '')
            )
              .toLocaleLowerCase()
              .includes(query.toLocaleLowerCase())),
      ),
      checked = pins.filter((p) => selected.has(p.id)).length;
    root.innerHTML = `<div class="pins-controls"><div class="pins-overview"><h2>${escape(group==='all'?'全部贴图':group==='none'?'未分组':workspace.groups.find(item=>item.id===group)?.name||'贴图')}</h2><p>${pinsInGroup().length} 个贴图<span>·</span>${pinsInGroup().filter(p=>p.view.visible).length} 个正在显示</p></div><div class="pins-toolbar">${searchField('pins-search', '搜索贴图', '搜索贴图')}<select id="pins-group-filter" aria-label="贴图分组"><option value="all">全部分组</option><option value="none">未分组</option>${workspace.groups.map((g) => `<option value="${g.id}">${escape(g.name)}</option>`).join('')}</select><select id="pins-visibility" aria-label="显示状态"><option value="all">全部状态</option><option value="visible">正在显示</option><option value="hidden">已隐藏</option></select><button type="button" class="quiet icon-button" data-pin-menu="pins-manage-menu" aria-label="管理贴图与分组" aria-expanded="false">${icon('lucide:more')}</button>
      <div id="pins-manage-menu" class="select-popup pins-action-menu" popover="manual"><button class="quiet" id="pins-new-group">${icon('lucide:plus')}新建分组</button>${group !== 'all' && group !== 'none' ? '<button class="quiet" id="pins-rename-group">重命名分组</button><button class="quiet" id="pins-remove-group">解散分组</button>' : ''}<hr><button class="quiet" id="pins-show-group">显示当前分组</button><button class="quiet" id="pins-hide-group">隐藏当前分组</button><button class="quiet" id="pins-restore-group">恢复当前分组交互</button><hr><button class="quiet" id="pins-toggle-all">隐藏 / 显示全部贴图</button><button class="quiet" id="pins-next-group">切换到另一贴图组</button></div></div>
      <div class="pins-selection" aria-label="贴图选择与批量操作" ${pins.length?'':'hidden'}><label><input id="pins-select-all" type="checkbox" ${pins.length && checked === pins.length ? 'checked' : ''} ${pins.length ? '' : 'disabled'}><span>${checked ? '已选 ' + checked + ' 项' : pins.length + ' 个贴图'}</span></label>${checked ? '' : `<span class="pins-visible-count">${pins.filter((p) => p.view.visible).length} 个正在显示</span>`}<div class="actions" ${checked ? '' : 'hidden'}><button class="quiet icon-button" data-batch="show" title="显示所选贴图" aria-label="显示所选贴图">${icon('lucide:eye')}</button><button class="quiet icon-button" data-batch="hide" title="隐藏所选贴图" aria-label="隐藏所选贴图">${icon('lucide:eye-off')}</button><button class="quiet icon-button" data-batch="restore" title="恢复所选贴图交互" aria-label="恢复所选贴图交互">${icon('lucide:pointer')}</button><button class="quiet icon-button danger" data-batch="remove" title="删除所选贴图" aria-label="删除所选贴图">${icon('lucide:trash')}</button><select id="pins-batch-group" aria-label="移动所选贴图"><option value="choose">移动到分组</option><option value="">未分组</option>${workspace.groups.map((g) => `<option value="${g.id}">${escape(g.name)}</option>`).join('')}</select></div></div></div>
      ${
        pins.length
          ? `<section class="pins-grid">${pins
              .map(
                (
                  p,
                ) => `<article class="pin-card ${selected.has(p.id) ? 'is-selected' : ''}" data-id="${p.id}">
        <div class="pin-card-preview ${p.content.kind}"><label class="pin-card-check"><input type="checkbox" data-select-pin="${p.id}" aria-label="选择 ${escape(p.title)}" ${selected.has(p.id) ? 'checked' : ''}></label>${p.view.visible ? '<span class="pin-state visible"><i></i>显示中</span>' : ''}
        ${p.content.kind === 'image' ? `<span class="pin-preview-placeholder">${icon('lucide:images')}</span><img data-preview="${p.id}" data-hash="${p.content.hash}" alt="${escape(p.title)}" hidden>` : p.content.kind === 'text' ? `<p class="pin-text-preview">${escape(p.content.text.slice(0, 600))}</p>` : `<div class="pin-files-preview">${icon('lucide:folder')}<span>${escape(p.content.files[0]?.name || '文件')} ${p.content.files.length > 1 ? '等 ' + p.content.files.length + ' 项' : ''}</span></div>`}</div>
        <div class="pin-card-copy"><h3 title="${escape(p.title)}">${escape(p.title)}</h3><p>${p.content.kind === 'image' ? p.content.width + ' × ' + p.content.height : p.content.kind === 'text' ? '文字 · ' + p.content.text.length + ' 字' : p.content.files.length + ' 个文件'}${p.group ? '<span>·</span>' + escape(workspace.groups.find((g) => g.id === p.group)?.name || '') : ''}${p.view.passThrough ? '<span>·</span>穿透' : ''}</p></div>
        <div class="pin-card-actions"><button class="quiet pin-show" data-pin-action="${p.view.visible ? 'hide' : 'show'}" data-id="${p.id}">${icon(p.view.visible ? 'lucide:eye-off' : 'lucide:eye')}${p.view.visible ? '隐藏' : '显示'}</button><span></span><button class="quiet icon-button pin-secondary" data-pin-action="copy" data-id="${p.id}" aria-label="复制原内容">${icon('lucide:copy')}</button><button class="quiet icon-button pin-secondary" data-pin-action="controls" data-id="${p.id}" aria-label="贴图设置">${icon('lucide:settings')}</button><button type="button" class="quiet icon-button" data-pin-menu="pin-menu-${p.id}" aria-label="更多贴图操作" aria-expanded="false">${icon('lucide:more')}</button><div id="pin-menu-${p.id}" class="select-popup pins-action-menu" popover="manual">${p.view.passThrough ? `<button class="quiet" data-pin-action="restore" data-id="${p.id}">恢复交互</button>` : ''}<button class="quiet" data-pin-rename="${p.id}" data-id="${p.id}">${icon('lucide:pencil')}重命名</button>${p.content.kind !== 'files' ? `<button class="quiet" data-pin-action="export" data-id="${p.id}">${icon('lucide:download')}保存原内容</button>` : ''}<hr><button class="quiet pin-remove" data-pin-action="remove" data-id="${p.id}">${icon('lucide:trash')}删除贴图</button></div></div></article>`,
              )
              .join('')}</section>`
          : `<section class="pins-empty"><div class="pins-empty-icon" aria-hidden="true">${icon('lucide:pin')}</div><p>${query || visibility !== 'all' ? '没有符合筛选条件的贴图' : group==='all'?'暂无贴图':'当前分组暂无贴图'}</p></section>`
      }`;
    root.querySelectorAll<HTMLButtonElement>('[data-pin-menu]').forEach(
      (button) =>
        (button.onclick = () => {
          const menu = document.getElementById(button.dataset.pinMenu!)!;
          if (menu.matches(':popover-open')) {
            closeControls();
            return;
          }
          const close = () => {
            menu.hidePopover();
            button.setAttribute('aria-expanded', 'false');
            document.removeEventListener('pointerdown', outside, true);
            window.removeEventListener('resize', close);
            document.removeEventListener('scroll', close, true);
          };
          const outside = (e: PointerEvent) => {
            if (!menu.contains(e.target as Node) && !button.contains(e.target as Node))
              closeControls();
          };
          openControl(close);
          menu.showPopover();
          button.setAttribute('aria-expanded', 'true');
          positionAnchoredPopover(button,menu,{preferred:'below',gap:6,maxHeight:()=>innerHeight-16});
          document.addEventListener('pointerdown', outside, true);
          window.addEventListener('resize', close);
          document.addEventListener('scroll', close, true);
          const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button')];
          buttons[0]?.focus({ preventScroll: true });
          menu.onkeydown = (e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              closeControls();
              button.focus();
            } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
              e.preventDefault();
              const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
              buttons[
                e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? buttons.length - 1
                    : (i + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length
              ]?.focus({ preventScroll: true });
            }
          };
        }),
    );
    const search = root.querySelector<HTMLInputElement>('#pins-search')!;
    search.value=query;
    setupSearchField(search);
    search.oninput = () => {
      query = search.value;
      update();
    };
    if (focused) {
      search.focus({ preventScroll: true });
      if (caret !== null && caret !== undefined) search.setSelectionRange(caret, caret);
    }
    const status = root.querySelector<HTMLSelectElement>('#pins-visibility')!;
    status.value = visibility;
    status.onchange = () => {
      visibility = status.value;
      selected.clear();
      update();
    };
    bind('#pins-toggle-all', () => api.pinsToggle());
    bind('#pins-next-group', () => api.pinsNextGroup());
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            const img = entry.target.querySelector<HTMLImageElement>('[data-preview]')!;
            observer?.unobserve(entry.target);
            pending.push(img);
          }
        loadPreviews();
      },
      { root: root.closest('#page-pins'), rootMargin: '200px' },
    );
    for (const img of root.querySelectorAll<HTMLImageElement>('[data-preview]')) {
      const cached = previews.get(img.dataset.hash!);
      if (cached) {
        img.src = cached;
        img.hidden = false;
        img.parentElement!.classList.add('loaded');
      } else observer.observe(img.parentElement!);
    }
    const select = root.querySelector<HTMLSelectElement>('#pins-group-filter')!;
    select.value = group;
    select.onchange = () => {
      group = select.value;
      selected.clear();
      update();
    };
    const all = root.querySelector<HTMLInputElement>('#pins-select-all');
    if (all) {
      all.indeterminate = checked > 0 && checked < pins.length;
      all.onchange = () => {
        for (const p of pins) {
          if (all.checked) selected.add(p.id);
          else selected.delete(p.id);
        }
        update();
      };
    }
    root.querySelectorAll<HTMLInputElement>('[data-select-pin]').forEach(
      (b) =>
        (b.onchange = () => {
          if (b.checked) selected.add(b.dataset.selectPin!);
          else selected.delete(b.dataset.selectPin!);
          update();
        }),
    );
    bind('#pins-new-group', () =>
      nameDialog('新建贴图分组', '', (name) => api.pinsGroup(null, { kind: 'create', name })),
    );
    bind('#pins-rename-group', () =>
      nameDialog('重命名分组', workspace.groups.find((g) => g.id === group)!.name, (name) =>
        api.pinsGroup(group, { kind: 'rename', name }),
      ),
    );
    bind('#pins-remove-group', () => api.pinsGroup(group, { kind: 'remove' }));
    bind('#pins-show-group', () =>
      group === 'none'
        ? many(groupIds(), { kind: 'show' })
        : api.pinsGroup(group === 'all' ? null : group, { kind: 'show' }),
    );
    bind('#pins-hide-group', () =>
      group === 'none'
        ? many(groupIds(), { kind: 'hide' })
        : api.pinsGroup(group === 'all' ? null : group, { kind: 'hide' }),
    );
    bind('#pins-restore-group', () =>
      group === 'none'
        ? many(groupIds(), { kind: 'restore' })
        : api.pinsGroup(group === 'all' ? null : group, { kind: 'restore' }),
    );
    bind('[data-pin-action]', (b) =>
      api.pinsAction(b.dataset.id!, {
        kind: b.dataset.pinAction as
          | 'show'
          | 'hide'
          | 'restore'
          | 'copy'
          | 'controls'
          | 'remove'
          | 'export',
      }),
    );
    bind('[data-pin-rename]', (b) =>
      nameDialog('重命名贴图', workspace.pins.find((p) => p.id === b.dataset.id)!.title, (title) =>
        api.pinsAction(b.dataset.id!, { kind: 'rename', title }),
      ),
    );
    bind('[data-batch]', (b) => b.dataset.batch==='remove'?removeSelected(pins.filter(p=>selected.has(p.id)).map(p=>p.id)):
      many(
        pins.filter((p) => selected.has(p.id)).map((p) => p.id),
        { kind: b.dataset.batch as 'show' | 'hide' | 'restore' },
      ),
    );
    const move = root.querySelector<HTMLSelectElement>('#pins-batch-group');
    if (move)
      move.onchange = () => {
        if (move.value === 'choose') return;
        const target = move.value || null;
        void many(
          pins.filter((p) => selected.has(p.id)).map((p) => p.id),
          { kind: 'group', group: target },
        ).catch(error);
      };
    customControls(root);
  }
  update();
  return {
    update,
    activate(value:boolean){active=value;if(value){signature='';update();}else{observer?.disconnect();pending.length=0;closeControls();}},
    dispose() {
      disposed = true;
      closeControls();
      observer?.disconnect();
      pending.length = 0;
      previews.clear();
    },
  };
}
