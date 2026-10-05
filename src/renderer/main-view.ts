import {dialogMarkup,openDialog,closeDialog} from './dialog';
import {overviewPage,setupOverview} from './overview-view';
import './styles.css';
import './refinement.css';
import './selection.css';
import './interface-refinement.css';
// Main-workspace views mount on demand, but their layout is visible immediately
// after navigation. Keep their compact structural sheets eager so a page never
// paints with generic controls and then reflows when a dynamic module's CSS
// arrives. Heavy document/preview styles remain in their feature chunks.
import './file-tools.css';
import './text.css';
import './disk.css';
import './file-action.css';
import './path-field.css';
import './color.css';
import './maintenance-list.css';
import './system-information.css';
import './ports.css';
import {setupTooltips} from './tooltip';
import {setupTextSelection} from './selection';
import {setupAppearance} from './appearance';
import {bindPreference} from './preferences';
import appIconURL from '../../assets/icons/one.svg?url';
import { windowControls, setupChrome } from './chrome';
import type { MaintenanceRow, Operation, PickerData } from '../shared/types';
import {informationTabs} from '../shared/system-info';
import { customControls, closeControls } from './controls';
import { api, q, esc, icon, button, switchControl, toast, action } from './ui';
const app = document.querySelector<HTMLDivElement>('#app')!;
const settingRow = (title: string, description: string, control: string) => `<div class="setting-row"><div><h2>${title}</h2><p>${description}</p></div>${control}</div>`;
export function renderMain() {
  const groups = [
    {name:'文件',items:[['tools','文件工具'],['text','文本处理'],['search','文件搜索'],['disk','空间分析'],['locksmith','文件占用']]},
    {name:'工具',items:[['input','操作增强'],['preview','快速预览'],['color','屏幕取色']]},
    {name:'系统',items:[['system','系统维护'],['hardware','系统信息'],['ports','端口与服务']]}
  ];
  const modules = [['home','概览'],...groups.flatMap(group=>group.items),['settings','设置']];
  const nav = ([id,name]:string[]) => `<button class="nav ${id==='home'?'active':''}" data-page="${id}" title="${name}" aria-label="${name}" ${id==='home'?'aria-current="page"':''}>${icon(id)}<span class="nav-label">${name}</span></button>`;
  const navigation = `<nav class="sidebar-navigation" aria-label="功能导航">${nav(['home','概览'])}${groups.map(group=>`<section class="sidebar-group" aria-label="${group.name}"><h2 class="sidebar-group-caption" aria-hidden="true">${group.name}</h2>${group.items.map(nav).join('')}</section>`).join('')}</nav>${nav(['settings','设置'])}`;
  app.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand drag-region"><img class="brand-mark" src="${appIconURL}" width="24" height="24" alt=""><span class="brand-name">One</span></div>${navigation}</aside><main class="workspace"><header class="workspace-header drag-region"><button class="quiet icon-button" id="sidebar-toggle" title="收起侧边栏" aria-label="收起侧边栏" aria-expanded="true">${icon('panel-left')}</button><div class="spacer"></div>${windowControls()}</header><div class="content" data-current-page="home"><div class="page-heading"><h1 id="page-name">概览</h1><div id="disk-heading-actions" data-heading-for="disk" hidden></div><div id="color-heading-actions" data-heading-for="color" hidden></div></div>
  <section class="page" id="page-home">${overviewPage()}</section><section class="page" id="page-tools" hidden></section><section class="page" id="page-text" hidden></section><section class="page" id="page-disk" hidden></section><section class="page" id="page-system" hidden></section><section class="page" id="page-hardware" hidden></section><section class="page" id="page-ports" hidden></section><section class="page" id="page-input" hidden></section><section class="page" id="page-locksmith" hidden></section><section class="page" id="page-preview" hidden></section><section class="page" id="page-color" hidden></section><section class="page" id="page-search" hidden></section><section class="page" id="page-settings" hidden></section>
  </div><div class="toast-layer"><div class="toast" id="toast" hidden role="status"></div></div></main></div>${dialogMarkup({id:"issues-dialog",title:"未完成的扫描项目",closeId:"issues-dismiss",className:"dialog-wide",body:`<pre id="issues-text"></pre>`,actions:`${button('close-issues','关闭')}`})}`;
  setupChrome(); customControls(app);
  const content=document.querySelector<HTMLElement>('.content')!;
  let toolsController:ReturnType<typeof import('./file-tools-view').setupFileTools>|undefined,textController:ReturnType<typeof import('./text-view').setupText>|undefined,diskController:ReturnType<typeof import('./disk-view').setupDisk>|undefined;
  let maintenanceController:ReturnType<typeof import('./maintenance-view').setupMaintenance>|undefined,informationController:ReturnType<typeof import('./system-info-view').setupSystemInformation>|undefined,portsController:ReturnType<typeof import('./ports-view').setupPorts>|undefined;
  let locksmithController:ReturnType<typeof import('./locksmith-view').setupLocksmith>|undefined,settingsController:ReturnType<typeof import('./settings-view').setupSettingsPage>|undefined;
  const mounted=new Set(['home']),mounting=new Map<string,Promise<void>>();
  const mount=(id:string):Promise<void>=>{
    if(mounted.has(id))return Promise.resolve();
    const pending=mounting.get(id);if(pending)return pending;
    const work=(async()=>{
    const page=q<HTMLElement>('page-'+id);
    if(id==='tools'){const {fileToolsPage,setupFileTools}=await import('./file-tools-view');const {arrangeRenameLayout,wireRenameScopeMode}=await import('./rename-layout');const {setupRenameSidebar}=await import('./rename-sidebar');page.innerHTML=fileToolsPage();const refresh=setupRenameSidebar(false);arrangeRenameLayout(page,false);toolsController=setupFileTools();wireRenameScopeMode();refresh();}
    else if(id==='text'){const {textPage,setupText}=await import('./text-view');page.innerHTML=textPage();customControls(page);textController=setupText();}
    else if(id==='disk'){const {diskPage,setupDisk}=await import('./disk-view');page.innerHTML=diskPage();customControls(page);q('disk-heading-actions').append(q('disk-actions'));diskController=setupDisk();}
    else if(id==='system'){const {maintenancePage,setupMaintenance}=await import('./maintenance-view');page.innerHTML=maintenancePage();customControls(page);maintenanceController=setupMaintenance();}
    else if(id==='hardware'){const {systemInformationPage,setupSystemInformation}=await import('./system-info-view');page.innerHTML=systemInformationPage();informationController=setupSystemInformation();}
    else if(id==='ports'){const {portsPage,setupPorts}=await import('./ports-view');page.innerHTML=portsPage();portsController=setupPorts();}
    else if(id==='input'){const {inputPage,setupInput}=await import('./enhancement-view');page.innerHTML=inputPage();customControls(page);setupInput();}
    else if(id==='locksmith'){const {locksmithCard,setupLocksmith}=await import('./locksmith-view');const {arrangeLocksmithLayout}=await import('./locksmith-layout');page.innerHTML=locksmithCard();arrangeLocksmithLayout(page);page.classList.add('embedded-locksmith');locksmithController=setupLocksmith();}
    else if(id==='preview'){page.innerHTML=previewPage();setupPreviewPage();}
    else if(id==='color'){const {colorPage,setupColorPage}=await import('./color-view');page.innerHTML=colorPage();customControls(page);q('color-heading-actions').append(q('color-actions'));setupColorPage();}
    else if(id==='search'){const {searchPage,setupSearchPage}=await import('./search-view');page.innerHTML=searchPage();customControls(page);setupSearchPage();}
    else if(id==='settings'){const {settingsPage,setupSettingsPage}=await import('./settings-view');page.innerHTML=settingsPage();customControls(page);settingsController=setupSettingsPage();}
    else return;
    mounted.add(id);
    })().finally(()=>mounting.delete(id));
    mounting.set(id,work);return work;
  };
  let navigationRevision=0;
  const activate=(id:string,value:boolean)=>{
    if(id==='home')overviewController.activate(value);
    else if(id==='tools')toolsController?.activate(value);
    else if(id==='text')textController?.activate(value);
    else if(id==='disk')diskController?.activate(value);
    else if(id==='system')maintenanceController?.activate(value);
    else if(id==='hardware')informationController?.activate(value);
    else if(id==='ports')portsController?.activate(value);
    else if(id==='locksmith')locksmithController?.activate(value);
    else if(id==='settings')settingsController?.activate(value);
  };
  const navigate=async(id:string)=>{
    const revision=++navigationRevision,current=content.dataset.currentPage||'home';
    if(id!==current)activate(current,false);
    await mount(id);
    if(revision!==navigationRevision)return false;
    activate(id,true);closeControls();content.scrollTop=0;content.dataset.currentPage=id;
    document.querySelectorAll<HTMLElement>('[data-heading-for]').forEach(actions=>actions.hidden=actions.dataset.headingFor!==id);
    document.querySelectorAll<HTMLElement>('.page').forEach(page=>page.hidden=page.id!=='page-'+id);
    document.querySelectorAll('.nav').forEach(node=>{const active=node.getAttribute('data-page')===id;node.classList.toggle('active',active);if(active)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');});
    q('page-name').textContent=modules.find(item=>item[0]===id)?.[1]||'One';return true;
  };
  document.querySelectorAll<HTMLButtonElement>('.nav[data-page]').forEach(node => node.addEventListener('click', () => void navigate(node.dataset.page!).catch(toast)));
  const collapse=(collapsed:boolean)=>{document.querySelector('.shell')!.classList.toggle('sidebar-collapsed',collapsed);const toggle=q('sidebar-toggle');toggle.setAttribute('aria-expanded',String(!collapsed));toggle.setAttribute('aria-label',collapsed?'展开侧边栏':'收起侧边栏');toggle.title=toggle.getAttribute('aria-label')!;};
  collapse(localStorage.getItem('sidebar-collapsed')==='true');
  action('sidebar-toggle',()=>{const collapsed=q('sidebar-toggle').getAttribute('aria-expanded')==='true';collapse(collapsed);localStorage.setItem('sidebar-collapsed',String(collapsed));});
  const overviewController=setupOverview((id,report)=>{void (async()=>{if(['duplicates','diff','rename','documents','integrity'].includes(id)){if(await navigate('tools'))await toolsController!.select(id as 'duplicates'|'diff'|'rename'|'documents'|'integrity',report);}else if(await navigate(id)){if(id==='system')q('alerts-tab').click();if(id==='disk'&&report)await diskController!.openFolder(report);}})().catch(toast);});overviewController.activate(true);
  api.onDiskAlert(value=>toast(value.drive+' 剩余 '+(value.free/1024**3).toFixed(2)+' GB'));
  api.onDiskAlertOpen(()=>{void navigate('system').then(active=>{if(active)q('alerts-tab').click();}).catch(toast);});
  api.onSearchSettings(tab=>{void navigate('search').then(active=>{if(active)q(tab==='entry'?'search-tab-entry':'search-tab-menu').click();}).catch(toast);});
  api.onNavigatePage(target=>{void (async()=>{
    if(!modules.some(item=>item[0]===target.page)||!await navigate(target.page))return;
    if(target.page==='disk'&&target.folder)await diskController!.openFolder(target.folder);
    else if(target.page==='tools'&&target.tool==='rename')await toolsController!.openSelection(target.paths||[]);
    else if(target.page==='tools'&&target.tool==='diff')await toolsController!.openComparison(target.paths||[]);
    else if(target.page==='tools'&&target.tool==='integrity')await toolsController!.openIntegrity(target.folder);
    else if(target.page==='tools'&&target.folder)await toolsController!.openFolder(target.folder);
    else if(target.page==='locksmith'&&target.paths?.length)await locksmithController!.inspect(target.paths);
    else if(target.page==='home'&&target.section==='tasks')q('overview-task-center').scrollIntoView({block:'start'});
  })().catch(toast);});
  api.onLockTarget(path=>{void navigate('locksmith').then(active=>{if(active)return locksmithController!.inspect([path]);}).catch(toast);});
  api.onReceiveText(text => {void navigate('text').then(async active=>{if(active)(await import('./text-view')).receiveText(text);}).catch(toast);});
  // System information is useful immediately after opening the app, not only
  // after visiting its page. The main-process service coalesces these requests,
  // limits concurrency, and caches the results for the information view.
  void Promise.allSettled(informationTabs.map(([kind])=>api.systemInformation(kind)));
}
function previewPage() {
  return `<div class="empty" id="dropzone"><div class="big-icon">${icon('preview')}</div><h2 id="preview-drop-title">拖入文件或文件夹</h2><p id="preview-drop-detail" hidden>松开以打开预览</p><div class="toolbar">${button('pick-preview','选择文件','file',true)}${button('pick-preview-folder','选择文件夹','folder')}</div></div><div class="settings-card">${settingRow('用空格快速预览','资源管理器文件列表中选中文件后，按空格查看。',switchControl('preview-enabled','开启空格预览'))}</div>`;
}
function setupPreviewPage() {
  const enabled = q<HTMLInputElement>('preview-enabled');
  enabled.disabled = true;
  void api.settings().then(settings => { enabled.checked = settings.explorerPreview; }).catch(toast).finally(() => { enabled.disabled = false; });
  bindPreference(enabled,()=>({explorerPreview:enabled.checked}),async()=>{enabled.checked=(await api.settings()).explorerPreview;});
  action('pick-preview-folder',async()=>{const path=await api.pickDirectory();if(path)await api.preview(path);});
  action('pick-preview', async () => { const path = await api.pickFile(); if (path) await api.preview(path); });
  const zone = q('dropzone');
  const setDragging=(dragging:boolean)=>{zone.classList.toggle('dragging',dragging);q('preview-drop-title').textContent=dragging?'松开以预览文件或文件夹':'拖入文件或文件夹';q('preview-drop-detail').hidden=!dragging;};
  zone.addEventListener('dragenter',event=>{if(event.dataTransfer?.types.includes('Files'))setDragging(true);});
  zone.addEventListener('dragover', event => { if(!event.dataTransfer?.types.includes('Files'))return;event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='copy';setDragging(true); });
  zone.addEventListener('dragleave', event => {if(event.relatedTarget instanceof Node&&zone.contains(event.relatedTarget))return;const bounds=zone.getBoundingClientRect();if(event.clientX>bounds.left&&event.clientX<bounds.right&&event.clientY>bounds.top&&event.clientY<bounds.bottom)return;setDragging(false);});
  zone.addEventListener('drop', event => { event.preventDefault(); setDragging(false); const file = event.dataTransfer?.files[0]; if (file) { const path = api.droppedFile(file); if (path) void api.preview(path).catch(toast); } });
  window.addEventListener('blur',()=>setDragging(false));window.addEventListener('dragend',()=>setDragging(false));
}
