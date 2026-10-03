import {closeControls} from './controls';
import {icon,q} from './ui';

/** Organize the existing rename form without duplicating its controls or state. */
export function setupRenameSidebar(hasSelection:boolean){
 const pane=q('tool-pane-rename'),config=pane.querySelector<HTMLElement>('.rename-config')!;
 const rules=config.querySelector<HTMLElement>('.rename-rules')!,scope=config.querySelector<HTMLElement>('.rename-scope')!,format=q('rename-format-options');
 const formatPanel=document.createElement('section');formatPanel.className='file-action-format';formatPanel.innerHTML='<h2 class="rename-section-title">编号与格式</h2>';formatPanel.append(format.querySelector('.rename-format-body')!);
 const formatBody=formatPanel.querySelector('.rename-format-body')!;formatBody.insertBefore(formatBody.querySelector('.rename-enumerate-option')!,formatBody.querySelector('.rename-number-fields'));
 const tabs=document.createElement('div');tabs.className='file-action-config-tabs';tabs.innerHTML='<div class="tabs" role="tablist" aria-label="重命名设置"></div>';
 const panels=[['rules','替换',rules],['format','格式',formatPanel],['scope','项目',scope]] as const;
 const buttons=panels.map(([id,label,panel])=>{
  const button=document.createElement('button');button.type='button';button.id='rename-settings-tab-'+id;button.role='tab';button.textContent=label;button.setAttribute('aria-controls','rename-settings-panel-'+id);
  panel.id='rename-settings-panel-'+id;panel.role='tabpanel';panel.setAttribute('aria-labelledby',button.id);panel.classList.add('file-action-config-panel');tabs.firstElementChild!.append(button);return button;
 });
 const choose=(at:number)=>{
  closeControls();panels.forEach(([, ,panel],index)=>{panel.hidden=index!==at;buttons[index].classList.toggle('selected',index===at);buttons[index].setAttribute('aria-selected',String(index===at));buttons[index].tabIndex=index===at?0:-1;});
  pane.scrollTop=0;
 };
 buttons.forEach((button,index)=>{
  button.onclick=()=>choose(index);
 });
 config.replaceChildren(tabs,rules,formatPanel,scope);
 q('rename-scope-title').textContent='项目与范围';
 const selected=q<HTMLInputElement>('rename-selected');selected.closest('label')!.hidden=true;
 q('rename-scope-hint').remove();q('rename-paths').removeAttribute('aria-describedby');
 const mode=document.createElement('label');mode.className='tool-field file-action-scope-mode';mode.innerHTML='<span>处理范围</span><select id="rename-scope-mode" aria-label="处理范围"><option value="selection">所选项目</option><option value="contents">文件夹内的项目</option></select>';scope.querySelector('.rename-scope-options')!.before(mode);
 const help=document.createElement('details');help.className='file-action-variable-help';help.innerHTML=`<summary>${icon('info')}变量</summary><dl><dt>序号</dt><dd><code>\${n}</code></dd><dt>序号位数</dt><dd><code>\${padding=3}</code></dd><dt>创建日期</dt><dd><code>$YYYY-$MM-$DD</code></dd><dt>正则分组</dt><dd><code>$1</code></dd></dl>`;formatPanel.querySelector('.rename-variable-hint')!.replaceWith(help);
 const count=document.createElement('span');count.id='file-action-scope-count';count.className='file-action-tab-count';buttons[2].append(count);
 const refresh=()=>{count.textContent=String(q<HTMLTextAreaElement>('rename-paths').value.split(/\r?\n/).filter(p=>p.trim()).length);};
 q('rename-paths').addEventListener('input',refresh);q('rename-paths').addEventListener('change',refresh);
 choose(hasSelection?0:2);return refresh;
}
