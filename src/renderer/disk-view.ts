import {dialogMarkup,openDialog,closeDialog} from './dialog';
import type { DiskNode, ScanProgress } from '../shared/types';
import { ScanTree } from '../shared/scan-tree';
import type { Tile } from '../shared/treemap';
import { diskPredicate, filteredTree } from '../shared/disk-filter';
import {breadcrumbIndices} from '../shared/breadcrumbs';
import {isWindowVisible,onWindowVisibility} from './window-visibility';
import {DiskList} from './disk-list';
import {DiskMap} from './disk-map';
import { api, q, esc, icon, button, iconButton, size, toast, action } from './ui';

export function diskPage() {
 return `<div id="disk-actions" class="disk-header-actions"><input id="disk-path" class="disk-path-bridge" aria-label="扫描目录" tabindex="-1">${button('pick-directory','选择目录','folder')}${iconButton('scan','重新扫描','refresh')}${button('cancel-scan','停止','stop')}</div>
 <div id="disk-empty" class="empty disk-empty"><div class="big-icon">${icon('disk')}</div><h2>选择要分析的目录</h2></div>
 <div id="disk-results" hidden>
  <div class="disk-commandbar"><div class="map-navigation">${iconButton('disk-back','返回上一层','up')}<div class="breadcrumbs" id="breadcrumbs"></div></div><div class="disk-controls"><div class="filter-field">${icon('search')}<input id="disk-filter" maxlength="500" aria-label="筛选扫描结果" placeholder="筛选文件">${iconButton('clear-disk-filter','清除筛选','close')}</div><select id="map-depth" aria-label="显示层级"><option value="1">1 层</option><option value="2" selected>2 层</option><option value="3">3 层</option><option value="4">4 层</option></select>${iconButton('toggle-list','显示目录列表','panel-right')}${iconButton('filter-help','筛选语法','info')}</div></div>
  <div class="disk-workspace map-only" id="disk-workspace"><div class="map-frame" id="treemap"><canvas id="disk-canvas" aria-label="空间矩形图，单击选择，双击进入目录"></canvas><div id="map-empty" hidden>这个目录中还没有可显示的文件</div></div><aside class="disk-inspector"><div class="list-heading"><span id="list-title">目录内容</span><span>大小</span></div><div class="disk-list" id="disk-list"></div><div class="disk-selection" id="disk-selection"><div class="selection-title" id="selection-name"></div><div id="selection-meta"></div><div class="selection-actions">${button('selection-enter','进入目录')}${iconButton('selection-reveal','在资源管理器中定位','folder')}${iconButton('selection-copy','复制路径','copy')}</div></div></aside></div>
  <div class="disk-statusbar"><div class="disk-summary"><strong id="disk-size">0 B</strong><span><b id="disk-files">0</b> 文件</span><span><b id="disk-dirs">0</b> 目录</span></div><span id="filter-state"></span><span id="visible-count"></span><div class="spacer"></div><span class="activity-dot" id="scan-activity" hidden></span><span id="scan-state"></span><button class="quiet" id="show-issues" aria-label="查看跳过的扫描项目" hidden></button></div>
 </div><div class="scan-progress-row"><div class="progress" id="scan-progress"></div></div><div class="map-tooltip" id="map-tooltip" hidden></div>
 ${dialogMarkup({id:"filter-dialog",title:"筛选文件",closeId:"filter-dismiss",body:`<dl class="filter-examples"><dt>*.jpg</dt><dd>文件名或通配符</dd><dt>|*.zip</dt><dd>排除 ZIP 文件</dd><dt>>100mb; &lt;2gb</dt><dd>文件大小</dd><dt>>30days</dt><dd>超过 30 天未修改</dd></dl>`,actions:`${button('close-filter-help','关闭')}`})}`;
}

export function setupDisk() {
  let tree = new ScanTree(), current: DiskNode | undefined, selected: DiskNode | undefined;
  let issues: string[] = [], progress: ScanProgress | undefined, scanning = false, firstBatch = true, drawTimer: ReturnType<typeof setTimeout> | undefined;
  let hovered: Tile | undefined, filterValue = '', predicate = diskPredicate(''), predicateError = '';
  let filtered: DiskNode | undefined, filteredAt = 0;
  const canvas = q<HTMLCanvasElement>('disk-canvas'), frame = q('treemap'), map = new DiskMap(canvas);
  let visibleSize = 0,acceptUpdates=false,activeRoot='',active=false;
  const showing=()=>active&&isWindowVisible();
  const list=new DiskList(q('disk-list'),node=>{selected=node;selection();paint(drawnNodes,true);},enter,(x,y,node)=>showContextMenu(x,y,node,enter));
  const listShowing=()=>showing()&&!q('disk-results').hidden&&!q('disk-workspace').classList.contains('map-only');
  q('toggle-list').setAttribute('aria-pressed','false');
  q<HTMLButtonElement>('cancel-scan').disabled = true;
  const crumbs=q('breadcrumbs');let crumbPath='',crumbNodes:DiskNode[]=[],crumbButtons:HTMLButtonElement[]=[],crumbOverflow:HTMLButtonElement|undefined,crumbMenu:HTMLElement|undefined;
  function closeCrumbMenu(){crumbMenu?.remove();crumbMenu=undefined;crumbOverflow?.setAttribute('aria-expanded','false');}
  function fitCrumbs(){
    if(!crumbOverflow||!crumbButtons.length||!crumbs.clientWidth)return;
    crumbOverflow.hidden=true;for(const b of crumbButtons)b.hidden=false;
    const last=crumbButtons.at(-1)!;last.style.flexShrink='0';const widths=crumbButtons.map(b=>b.getBoundingClientRect().width+1);last.style.flexShrink='';
    const visible=breadcrumbIndices(widths,crumbs.clientWidth,33);for(let i=0;i<crumbButtons.length;i++)crumbButtons[i].hidden=!visible.includes(i);crumbOverflow.hidden=visible.length===crumbButtons.length;
    if(crumbOverflow.hidden)closeCrumbMenu();
  }
  function breadcrumbs(){
    if(!current||!tree.root)return;
    if(crumbPath===current.path&&crumbButtons.length)return;
    crumbPath=current.path;closeCrumbMenu();crumbNodes=[...tree.ancestors(current),current];crumbButtons=crumbNodes.map((node,i)=>{const b=document.createElement('button');b.className=i===crumbNodes.length-1?'crumb-current':i===0?'crumb-root':'';b.innerHTML=`<span>${esc(node.name)}</span>${icon('chevron')}`;b.title=node.path;b.onclick=()=>enter(node);if(i===crumbNodes.length-1)b.setAttribute('aria-current','location');return b;});
    crumbOverflow=document.createElement('button');crumbOverflow.className='crumb-overflow';crumbOverflow.innerHTML=icon('ellipsis');crumbOverflow.setAttribute('aria-label','展开中间目录');crumbOverflow.setAttribute('aria-haspopup','menu');crumbOverflow.setAttribute('aria-expanded','false');
    crumbOverflow.onclick=()=>{if(crumbMenu){closeCrumbMenu();return;}crumbMenu=document.createElement('div');crumbMenu.className='breadcrumb-menu';crumbMenu.setAttribute('role','menu');crumbNodes.forEach((node,i)=>{if(!crumbButtons[i].hidden)return;const b=document.createElement('button');b.textContent=node.name;b.title=node.path;b.setAttribute('role','menuitem');b.onclick=()=>{closeCrumbMenu();enter(node);};crumbMenu!.append(b);});document.body.append(crumbMenu);const r=crumbOverflow!.getBoundingClientRect();crumbMenu.style.left=Math.max(8,Math.min(r.left,innerWidth-crumbMenu.offsetWidth-8))+'px';crumbMenu.style.top=Math.min(r.bottom+5,innerHeight-crumbMenu.offsetHeight-8)+'px';crumbOverflow!.setAttribute('aria-expanded','true');crumbMenu.querySelector('button')?.focus();};
    crumbs.replaceChildren(...crumbButtons);if(crumbButtons.length>2)crumbButtons[0].after(crumbOverflow);fitCrumbs();
  }
  new ResizeObserver(fitCrumbs).observe(crumbs);
  document.addEventListener('pointerdown',e=>{if(crumbMenu&&!crumbMenu.contains(e.target as Node)&&!crumbOverflow?.contains(e.target as Node))closeCrumbMenu();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&crumbMenu){closeCrumbMenu();crumbOverflow?.focus();}});

  function selection() {
    const node = selected || current; if (!node) return;
    q('selection-name').textContent = node.name; q('selection-name').title = node.path;
    const selectedSize = node === current && filterValue ? visibleSize : node.size;
    q('selection-meta').textContent = `${size(selectedSize)} · ${visibleSize ? (selectedSize/visibleSize*100).toFixed(1) : '0'}%${node.issue ? ' · 已跳过' : ''}`;
    q('selection-enter').textContent = node.directory ? '进入目录' : '预览文件';
    q<HTMLButtonElement>('selection-enter').disabled = node === current;
    list.select(node.path);
  }
  function enter(node: DiskNode) {
    if (!node.directory) { void api.preview(node.path).catch(toast); return; }
    current = tree.nodes.get(node.path) || node; selected = undefined; filtered = undefined; hovered = undefined;
    q('map-tooltip').hidden = true; draw();
  }
  function schedule() {
    if (!showing()||drawTimer) return;
    drawTimer = setTimeout(() => { drawTimer = undefined; draw(); },180);
  }
  function paint(nodes: DiskNode[], reuse = false) {
    if(!showing())return;
    if (!reuse) {
      map.paint(nodes,Number(q<HTMLSelectElement>('map-depth').value));
      hovered = undefined; q('map-tooltip').hidden = true; tooltipTarget = undefined;
    }
    map.selection(selected,hovered);
  }
  let drawnNodes: DiskNode[] = [];
  function draw() {
    if(!showing())return;
    list.setActive(listShowing());
    if (progress) {
      q('disk-size').textContent = size(progress.bytes); q('disk-files').textContent = progress.files.toLocaleString(); q('disk-dirs').textContent = progress.directories.toLocaleString();
      q('show-issues').hidden=!progress.issues;q('show-issues').textContent=progress.issues?`${progress.issues} 项跳过`:'';
    }
    if (!current || !tree.root) {drawnNodes=[];paint([]);list.clear();q('breadcrumbs').replaceChildren();q('map-empty').hidden=false;q('map-empty').textContent=scanning?'正在读取目录…':'目录已不存在';q('selection-name').textContent='';q('selection-meta').textContent='';q('visible-count').textContent='0 项';q('map-tooltip').hidden=true;return;}
    q<HTMLButtonElement>('disk-back').disabled = current === tree.root;
    breadcrumbs();
    let source = current;
    if (filterValue && !predicateError) {
      if (!filtered || Date.now()-filteredAt > 800 || !scanning) { filtered = filteredTree(current,predicate); filteredAt = Date.now(); }
      source = filtered;
    }
    const nodes = source.children.slice().sort((a,b) => b.size-a.size || a.name.localeCompare(b.name)); drawnNodes = nodes; visibleSize = source.size;
    q('filter-state').textContent = predicateError || (filterValue ? `${size(source.size)} 匹配` : ''); q('filter-state').classList.toggle('error',!!predicateError);
    q('map-empty').hidden = nodes.some(n => n.size > 0); q('map-empty').textContent = filterValue ? '没有匹配的文件' : scanning ? '正在读取这个目录…' : '这个目录没有可显示的文件';
    paint(nodes);
    list.update(nodes,source.size,current.path+'\0'+filterValue);
    q('visible-count').textContent = `${nodes.length.toLocaleString()} 项`;
    selection();
  }
  new ResizeObserver(() => { if (current) paint(drawnNodes); }).observe(frame);
  let themeFrame = 0;
  new MutationObserver(()=>{if(!showing()||!current||themeFrame)return;themeFrame=requestAnimationFrame(()=>{themeFrame=0;paint(drawnNodes);});}).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','style']});
  const tileAt = (event: MouseEvent) => { const rect = canvas.getBoundingClientRect(); return map.hit(event.clientX-rect.left,event.clientY-rect.top); };
  canvas.addEventListener('click',event => { selected = tileAt(event)?.node; selection(); paint(drawnNodes,true); });
  canvas.addEventListener('dblclick',event => { const node = tileAt(event)?.node; if (node) enter(node); });
  let tooltipTarget: {node:DiskNode;x:number;y:number} | undefined, tooltipFrame = 0, tooltipKey = '', tooltipWidth = 0, tooltipHeight = 0;
  const showTooltip = () => {
    tooltipFrame = 0;
    const target = tooltipTarget, tooltip = q('map-tooltip');
    if (!target || !showing()) { tooltip.hidden = true; return; }
    const {node,x,y} = target, key = node.path+'\0'+node.size+'\0'+visibleSize;
    tooltip.hidden = false;
    if (key !== tooltipKey) {
      tooltipKey = key;
      tooltip.innerHTML = `<strong>${esc(node.name)}</strong><span>${size(node.size)}${visibleSize ? ' · '+(node.size/visibleSize*100).toFixed(1)+'%' : ''}</span><small>${esc(node.path)}</small>`;
      tooltipWidth = tooltip.offsetWidth; tooltipHeight = tooltip.offsetHeight;
    }
    tooltip.style.left = Math.max(8,Math.min(x+14,innerWidth-tooltipWidth-12))+'px'; tooltip.style.top = Math.max(8,Math.min(y+16,innerHeight-tooltipHeight-12))+'px';
  };
  canvas.addEventListener('mousemove',event => {
    const tile = tileAt(event), node = tile?.node;
    if (hovered?.node.path !== node?.path) { hovered = tile; paint(drawnNodes,true); }
    tooltipTarget = node ? {node,x:event.clientX,y:event.clientY} : undefined;
    if (!node) q('map-tooltip').hidden = true;
    else if (!tooltipFrame) tooltipFrame = requestAnimationFrame(showTooltip);
  });
  canvas.addEventListener('mouseleave',() => { hovered = undefined; tooltipTarget = undefined; q('map-tooltip').hidden = true; paint(drawnNodes,true); });
  canvas.addEventListener('contextmenu',event => { event.preventDefault(); const node = tileAt(event)?.node; if (!node) return; selected = node; selection(); paint(drawnNodes,true); showContextMenu(event.clientX,event.clientY,node,enter); });
  q('map-depth').addEventListener('change',draw);
  q('disk-filter').addEventListener('input',() => { filterValue = q<HTMLInputElement>('disk-filter').value.trim(); filtered = undefined; try { predicate = diskPredicate(filterValue); predicateError = ''; } catch (error) { predicateError = (error as Error).message; } schedule(); });
  action('clear-disk-filter',() => { q<HTMLInputElement>('disk-filter').value = ''; q('disk-filter').dispatchEvent(new Event('input')); });
  action('filter-help',() => openDialog(q<HTMLDialogElement>('filter-dialog'))); action('close-filter-help',() => closeDialog(q<HTMLDialogElement>('filter-dialog')));
  action('disk-back',() => { if (current) { const parent = tree.parentOf(current); if (parent) enter(parent); } });
  action('toggle-list',() => { const hidden = q('disk-workspace').classList.toggle('map-only'); q('toggle-list').setAttribute('aria-label',hidden ? '显示目录列表' : '收起目录列表'); q('toggle-list').setAttribute('aria-pressed',String(!hidden));list.setActive(listShowing()); });
  action('selection-enter',() => { if (selected) enter(selected); });
  action('selection-reveal',() => { const node = selected || current; if (node) return api.revealFile(node.path); });
  action('selection-copy',async () => { const node = selected || current; if (node) { await api.copyText(node.path); toast('已复制路径'); } });
  action('pick-directory',async () => { const path = await api.pickDirectory(); if(path){if(scanning){await api.cancelScan();while(scanning)await new Promise(r=>setTimeout(r,20));}q<HTMLInputElement>('disk-path').value=path;q('scan').click();} });
  action('scan',async () => {
    if (scanning) return; const path = q<HTMLInputElement>('disk-path').value.trim(); if (!path) return toast('请先选择目录');
    acceptUpdates=true;activeRoot='';scanning = true; firstBatch = true; q<HTMLButtonElement>('scan').disabled = true; q<HTMLButtonElement>('cancel-scan').disabled = false; q('scan-activity').hidden = false;
    // Remove the previous scan's rows before accepting input for a new tree.
    clearTimeout(drawTimer);drawTimer=undefined;tree=new ScanTree();current=undefined;selected=undefined;progress=undefined;map.release();drawnNodes=[];hovered=undefined;filtered=undefined;issues=[];tooltipTarget=undefined;
    list.setActive(false);list.clear();q('breadcrumbs').replaceChildren();crumbPath='';crumbButtons=[];closeCrumbMenu();q('disk-size').textContent='0 B';q('disk-files').textContent='0';q('disk-dirs').textContent='0';q('disk-results').hidden=true;q('disk-empty').hidden=true;q('map-tooltip').hidden=true;
    q('scan-state').textContent = '扫描中'; q('scan-progress').textContent = '正在读取目录…'; q('disk-results').classList.add('scanning');
    try {
      const result = await api.scan(path); issues = result.issues; q('scan-state').textContent = '实时更新'; q('scan-progress').textContent = ''; 
    } catch (error) {
      acceptUpdates=false;
      const cancelled = String(error).includes('扫描已取消'); q('scan-state').textContent = cancelled ? '已停止 · 部分结果' : '扫描未完成';
      q('scan-progress').textContent = cancelled ? '已保留扫描到的内容' : String(error).replace(/^.*Error: /,''); if (!cancelled) toast(error);
    } finally { scanning = false; q('scan-activity').hidden = true; q('disk-results').classList.remove('scanning'); q<HTMLButtonElement>('scan').disabled = false; q<HTMLButtonElement>('cancel-scan').disabled = !acceptUpdates; draw(); }
  });
  api.onProgress(value => {
    if (!acceptUpdates||activeRoot&&activeRoot!==value.rootPath) return;activeRoot=value.rootPath;
    if (firstBatch) { tree = new ScanTree(); current = undefined; selected = undefined; issues = []; filtered = undefined; firstBatch = false; }
    tree.apply(value); progress = value;current=current?tree.nodes.get(current.path)||tree.root:tree.root;selected=selected?tree.nodes.get(selected.path):undefined;filtered=undefined;if(value.phase&&value.phase!=='scan'){const label=value.error?'更新异常':value.phase==='update'||value.phase==='watch'?'实时更新':'已停止';if(q('scan-state').textContent!==label)q('scan-state').textContent=label;q('scan-activity').hidden=true;q('scan-progress').textContent=value.error||'';q('scan-progress').title=value.error||'';}
    q('disk-empty').hidden = true; q('disk-results').hidden = false; if(!value.phase||value.phase==='scan'){q('scan-progress').textContent=value.path;q('scan-progress').title=value.path;}
    schedule();
  });
  action('cancel-scan',async()=>{acceptUpdates=false;await api.cancelScan();q<HTMLButtonElement>('cancel-scan').disabled=true;q('scan-state').textContent='已停止';q('scan-activity').hidden=true;q('scan-progress').textContent='';});
  action('show-issues',() => { const messages = issues.length ? issues : [...tree.nodes.values()].filter(n => n.issue).map(n => n.path+'：'+n.issue); if (!messages.length) return; q('issues-text').textContent = messages.join('\n\n'); openDialog(q<HTMLDialogElement>('issues-dialog')); });
  action('close-issues',() => closeDialog(q<HTMLDialogElement>('issues-dialog')));
  q('page-disk').addEventListener('dragover',event => { event.preventDefault(); });
  q('page-disk').addEventListener('drop',event => { event.preventDefault(); const file = event.dataTransfer?.files[0]; if (file && !scanning) { q<HTMLInputElement>('disk-path').value = api.droppedFile(file); q('scan').click(); } });
  const refreshVisibility=()=>{clearTimeout(drawTimer);drawTimer=undefined;list.setActive(listShowing());if(showing())requestAnimationFrame(draw);else{closeCrumbMenu();dismissDiskContext?.();q('map-tooltip').hidden=true;tooltipTarget=undefined;hovered=undefined;filtered=undefined;drawnNodes=[];map.release();}};
  onWindowVisibility(refreshVisibility);
  return {activate(value:boolean){if(active===value)return;active=value;refreshVisibility();}};
}

let dismissDiskContext: (()=>void) | undefined;
function showContextMenu(x: number,y: number,node: DiskNode,enter: (node: DiskNode) => void) {
  dismissDiskContext?.();
  const menu = document.createElement('div'); menu.className = 'disk-context'; menu.setAttribute('role','menu');
  const items: [string, () => unknown][] = [[node.directory ? '进入目录' : '预览文件',() => enter(node)],['在资源管理器中定位',() => api.revealFile(node.path)],['用默认程序打开',() => api.openFile(node.path)],['检查文件占用',()=>api.inspectLocks(node.path)],['复制路径',() => api.copyText(node.path)]];
  const origin=document.activeElement instanceof HTMLElement?document.activeElement:undefined;
  const scrollPositions=new Map<EventTarget,[number,number]>([[document,[window.scrollX,window.scrollY]]]);
  for(let parent=origin;parent;parent=parent.parentElement||undefined)scrollPositions.set(parent,[parent.scrollLeft,parent.scrollTop]);
  const close = () => { const focused=menu.contains(document.activeElement);menu.remove();if(focused&&origin?.isConnected)origin.focus({preventScroll:true});document.removeEventListener('pointerdown',outside,true); window.removeEventListener('resize',close); window.removeEventListener('scroll',scrolled,true);if(dismissDiskContext===close)dismissDiskContext=undefined; };
  const scrolled = (event:Event) => {
    const target=event.target,initial=target&&scrollPositions.get(target),position=target instanceof HTMLElement?[target.scrollLeft,target.scrollTop]:target===document?[window.scrollX,window.scrollY]:undefined;
    // Scroll anchoring can correct one device pixel after virtual rows or menu focus settle.
    // Keep the menu for that rounding correction, but dismiss after real accumulated movement.
    const tolerance=Math.max(1,1/(window.devicePixelRatio||1));
    if(initial&&position&&Math.abs(position[0]-initial[0])<=tolerance&&Math.abs(position[1]-initial[1])<=tolerance)return;
    close();
  };
  const outside = (event: PointerEvent) => { if (!menu.contains(event.target as Node)) close(); };
  for (const [label,work] of items) { const button = document.createElement('button'); button.textContent = label; button.setAttribute('role','menuitem'); button.onclick = () => { close(); Promise.resolve().then(work).catch(toast); }; menu.append(button); }
  menu.onkeydown = event => { if (event.key === 'Escape' || event.key === 'Tab') close(); if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const buttons = [...menu.querySelectorAll('button')]; const i = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[(i+(event.key === 'ArrowDown' ? 1 : buttons.length-1))%buttons.length].focus({preventScroll:true}); } };
  document.body.append(menu); menu.style.left = Math.max(8,Math.min(x,window.innerWidth-menu.offsetWidth-8))+'px'; menu.style.top = Math.max(8,Math.min(y,window.innerHeight-menu.offsetHeight-8))+'px'; menu.querySelector('button')?.focus({preventScroll:true});
  dismissDiskContext=close;document.addEventListener('pointerdown',outside,true); window.addEventListener('resize',close); window.addEventListener('scroll',scrolled,true);
}

