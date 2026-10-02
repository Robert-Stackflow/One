import {dialogMarkup,openDialog,closeDialog} from './dialog';
import {systemInformationPage,setupSystemInformation} from './system-info-view';
import {overviewPage,setupOverview} from './overview-view';
import {fileToolsPage,setupFileTools} from './file-tools-view';
import './system-information.css';
import {maintenancePage,setupMaintenance} from './maintenance-view';
import {renderSearchMenu} from './search-menu';
import {textPage,setupText,receiveText} from './text-view';
import './text.css';
import {searchPage,setupSearchPage,renderSearch} from './search-view';
import './search.css';

import './styles.css';
import './disk.css';
import './preview.css';
import './preview-chrome.css';
import './refinement.css';
import './color.css';
import './hud.css';
import './echo.css';
import './preview-redesign.css';
import './selection.css';
import './interface-refinement.css';
import {setupTooltips} from './tooltip';
import {setupTextSelection} from './selection';
import {setupAppearance} from './appearance';
import {settingsPage,setupSettingsPage} from './settings-view';
import {bindPreference} from './preferences';
import {colorPage,setupColorPage,renderColorPicker} from './color-view';
import {renderHUD} from './hud';
import appIconURL from '../../assets/icons/one-small.svg?url';
import { windowControls, setupChrome } from './chrome';
import { diskPage, setupDisk } from './disk-view';
import { inputPage, setupInput } from './enhancement-view';
import type { MaintenanceRow, Operation, PickerData } from '../shared/types';
import { customControls, closeControls } from './controls';
import { api, q, esc, icon, button, switchControl, toast, action } from './ui';
const app = document.querySelector<HTMLDivElement>('#app')!;
const settingRow = (title: string, description: string, control: string) => `<div class="setting-row"><div><h2>${title}</h2><p>${description}</p></div>${control}</div>`;
export function renderMain() {
  const modules = [['home','概览'],['tools','文件工具'],['text','文本处理'],['disk','空间分析'],['system','系统维护'],['hardware','系统信息'],['input','操作增强'],['preview','快速预览'],['color','屏幕取色'],['search','文件搜索'],['settings','设置']];
  app.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand drag-region"><img class="brand-mark" src="${appIconURL}" width="24" height="24" alt=""><span class="brand-name">One</span></div>${modules.map(([id,name]) => `<button class="nav ${id === 'home' ? 'active' : ''}" data-page="${id}" title="${name}" aria-label="${name}" ${id==='home'?'aria-current="page"':''}>${icon(id)}<span class="nav-label">${name}</span></button>`).join('')}</aside><main class="workspace"><header class="workspace-header drag-region"><button class="quiet icon-button" id="sidebar-toggle" title="收起侧边栏" aria-label="收起侧边栏" aria-expanded="true">${icon('panel-left')}</button><div class="spacer"></div>${windowControls()}</header><div class="content" data-current-page="home"><div class="page-heading"><h1 id="page-name">概览</h1><div id="disk-heading-actions" data-heading-for="disk" hidden></div><div id="color-heading-actions" data-heading-for="color" hidden></div></div>
  <section class="page" id="page-home">${overviewPage()}</section><section class="page" id="page-tools" hidden>${fileToolsPage()}</section><section class="page" id="page-text" hidden>${textPage()}</section><section class="page" id="page-disk" hidden>${diskPage()}</section><section class="page" id="page-system" hidden>${maintenancePage()}</section><section class="page" id="page-hardware" hidden>${systemInformationPage()}</section><section class="page" id="page-input" hidden>${inputPage()}</section><section class="page" id="page-preview" hidden>${previewPage()}</section><section class="page" id="page-color" hidden>${colorPage()}</section><section class="page" id="page-search" hidden>${searchPage()}</section><section class="page" id="page-settings" hidden>${settingsPage()}</section>
  </div><div class="toast-layer"><div class="toast" id="toast" hidden role="status"></div></div></main></div>${dialogMarkup({id:"issues-dialog",title:"未完成的扫描项目",closeId:"issues-dismiss",className:"dialog-wide",body:`<pre id="issues-text"></pre>`,actions:`${button('close-issues','关闭')}`})}`;
  setupChrome(); customControls(app);
  const content=document.querySelector<HTMLElement>('.content')!;
  const navigate = (id: string) => { overviewController.activate(id==='home');toolsController.activate(id==='tools');textController.activate(id==='text');diskController.activate(id==='disk'); maintenanceController.activate(id==='system');informationController.activate(id==='hardware');closeControls();content.scrollTop=0;content.dataset.currentPage=id;document.querySelectorAll<HTMLElement>('[data-heading-for]').forEach(actions=>actions.hidden=actions.dataset.headingFor!==id); document.querySelectorAll<HTMLElement>('.page').forEach(page => page.hidden = page.id !== 'page-' + id); document.querySelectorAll('.nav').forEach(node => {const active=node.getAttribute('data-page')===id;node.classList.toggle('active',active);if(active)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');}); q('page-name').textContent = modules.find(item => item[0] === id)?.[1] || 'One'; };
  document.querySelectorAll<HTMLButtonElement>('.nav[data-page]').forEach(node => node.addEventListener('click', () => navigate(node.dataset.page!)));
  const collapse=(collapsed:boolean)=>{document.querySelector('.shell')!.classList.toggle('sidebar-collapsed',collapsed);const toggle=q('sidebar-toggle');toggle.setAttribute('aria-expanded',String(!collapsed));toggle.setAttribute('aria-label',collapsed?'展开侧边栏':'收起侧边栏');toggle.title=toggle.getAttribute('aria-label')!;};
  collapse(localStorage.getItem('sidebar-collapsed')==='true');
  action('sidebar-toggle',()=>{const collapsed=q('sidebar-toggle').getAttribute('aria-expanded')==='true';collapse(collapsed);localStorage.setItem('sidebar-collapsed',String(collapsed));});
  q('disk-heading-actions').append(q('disk-actions'));q('color-heading-actions').append(q('color-actions'));const textController=setupText();const diskController=setupDisk(); const maintenanceController=setupMaintenance();const informationController=setupSystemInformation(); setupInput(); setupPreviewPage(); setupColorPage(); setupSettingsPage();setupSearchPage();
  const toolsController=setupFileTools();const overviewController=setupOverview((id,report)=>{if(['duplicates','diff','rename','documents'].includes(id)){navigate('tools');void toolsController.select(id as any,report).catch(toast);}else{navigate(id);if(id==='system')q('alerts-tab').click();if(id==='disk'&&report){q<HTMLInputElement>('disk-path').value=report;q('scan').click();}}});overviewController.activate(true);
  api.onDiskAlert(value=>toast(value.drive+' 剩余 '+(value.free/1024**3).toFixed(2)+' GB'));
  api.onDiskAlertOpen(()=>{navigate('system');q('alerts-tab').click();});
  api.onSearchSettings(()=>{navigate('search');q('search-tab-menu').click();});
  api.onLockTarget(()=>{navigate('input');q('enhancement-tab-locksmith').click();});
  api.onReceiveText(text => { navigate('text'); receiveText(text); });
}
function previewPage() {
  return `<div class="empty" id="dropzone"><div class="big-icon">${icon('preview')}</div><h2>拖入文件或文件夹</h2><div class="toolbar">${button('pick-preview','选择文件','file',true)}${button('pick-preview-folder','选择文件夹','folder')}</div></div><div class="settings-card">${settingRow('用空格快速预览','资源管理器文件列表中选中文件后，按空格查看。',switchControl('preview-enabled','开启空格预览'))}</div>`;
}
function setupPreviewPage() {
  const enabled = q<HTMLInputElement>('preview-enabled');
  enabled.disabled = true;
  void api.settings().then(settings => { enabled.checked = settings.explorerPreview; }).catch(toast).finally(() => { enabled.disabled = false; });
  bindPreference(enabled,()=>({explorerPreview:enabled.checked}),async()=>{enabled.checked=(await api.settings()).explorerPreview;});
  action('pick-preview-folder',async()=>{const path=await api.pickDirectory();if(path)await api.preview(path);});
  action('pick-preview', async () => { const path = await api.pickFile(); if (path) await api.preview(path); });
  const zone = q('dropzone'); zone.addEventListener('dragover', event => { event.preventDefault(); zone.classList.add('dragging'); }); zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
  zone.addEventListener('drop', event => { event.preventDefault(); zone.classList.remove('dragging'); const file = event.dataTransfer?.files[0]; if (file) { const path = api.droppedFile(file); if (path) void api.preview(path).catch(toast); } });
}
