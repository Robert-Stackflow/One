const $ = id => document.getElementById(id);
let stage = 'welcome';
let directory = '';
let existingDirectory = '';
let canForceExit = false;
const messages = {
  running: 'One 正在运行。请先从托盘菜单退出，然后重试。',
  newer: '电脑上已有更新版本的 One。',
  space: '所选磁盘空间不足，请更换安装位置。',
  integrity: '安装包验证失败，请重新下载安装程序。',
  'installed-integrity': '安装完成后文件验证失败，请重试。',
  cancelled: '安装已取消。',
  engine: '安装未能完成，请检查文件权限后重试。',
  invalidPath: '请选择有效的安装位置。',
  elevation: '未获得管理员权限，安装尚未开始。'
};
function show(next) {
  stage = next;
  for (const node of document.querySelectorAll('.scene')) node.classList.toggle('active', node.id === next);
  const secondary = $('secondary'), primary = $('primary');
  secondary.hidden = next === 'working';
  if (next === 'welcome') {secondary.textContent = '取消'; primary.textContent = '开始安装'; primary.disabled = false;}
  if (next === 'running') {secondary.textContent = '取消'; primary.textContent = canForceExit ? '强制退出 One' : '退出 One'; primary.disabled = false;}
  if (next === 'working') {primary.textContent = '安装中'; primary.disabled = true;}
  if (next === 'done') {secondary.textContent = '关闭'; primary.textContent = '打开 One'; primary.disabled = false;}
  if (next === 'failed') {secondary.textContent = '关闭'; primary.textContent = '重试'; primary.disabled = false;}
}
function progress(value) {
  if (value.stage === 'running') {canForceExit=!!value.canForce; show('running'); $('running-message').textContent=value.message || (canForceExit ? 'One 未能正常退出。保存工作后，可以强制退出并继续安装。' : '请先保存 One 中的工作，然后退出应用。'); return;}
  if (value.stage === 'ready') {progress({stage:'checking',detail:'正在验证安装位置',caption:'准备中'}); void window.setup.install(directory); return;}
  if (value.stage === 'done') {show('done'); $('installed-path').textContent = value.directory; $('launch-error').textContent=''; return;}
  if (value.stage === 'failed') {show('failed'); $('failure-message').textContent = messages[value.reason] || value.message || messages.engine; return;}
  show('working');
  const text = {checking:'正在检查安装包',closing:'正在退出 One',elevating:'正在请求管理员权限',extracting:'正在准备安装文件',installing:'正在安装 One',verifying:'正在完成安装'};
  $('work-title').textContent = text[value.stage] || text.checking;
  $('work-detail').textContent = value.detail || '';
  $('progress-caption').textContent = value.caption || '';
  $('progress-fill').style.width = value.percent == null ? '' : `${value.percent}%`;
  $('progress-fill').parentElement.classList.toggle('indeterminate', value.percent == null);
}
window.setup.onProgress(progress);
function normalizeDirectory(value) {
  const path = value.trim().replace(/\\+$/, '');
  if (!/^[a-z]:\\/i.test(value.trim())) return value.trim();
  if (existingDirectory && value.trim().toLowerCase() === existingDirectory.toLowerCase()) return existingDirectory;
  return /(?:^|\\)One$/i.test(path) ? path : `${path}\\One`;
}
window.setup.state().then(value => {directory = value.directory; existingDirectory = value.installed ? value.directory : ''; $('directory').value = directory; $('version').textContent = `版本 ${value.version}`; if(value.resumed){progress({stage:'checking',detail:'正在验证安装位置',caption:'准备中'});void window.setup.install(directory);}});
$('browse').addEventListener('click', async () => {const value = await window.setup.chooseDirectory(); if(value) {$('directory').value=value; directory=value; $('path-error').textContent='';}});
$('directory').addEventListener('input', () => {$('path-error').textContent='';});
$('directory').addEventListener('blur', () => {if (/^[a-z]:\\/i.test($('directory').value.trim())) $('directory').value = normalizeDirectory($('directory').value);});
$('primary').addEventListener('click', async () => {
  if(stage==='done') {$('primary').disabled=true;try{await window.setup.launch();}catch(error){$('launch-error').textContent=String(error.message||error);$('primary').disabled=false;}return;}
  if(stage==='failed') {show('welcome'); return;}
  if(stage==='running') {$('primary').disabled=true; await window.setup.quitOne(directory,canForceExit); return;}
  if(stage!=='welcome') return;
  directory=normalizeDirectory($('directory').value);
  $('directory').value=directory;
  if(!/^[a-z]:\\[^<>"|?*]+$/i.test(directory)) {$('path-error').textContent=messages.invalidPath; return;}
  progress({stage:'checking',detail:'正在验证安装位置',caption:'准备中'});
  await window.setup.install(directory);
});
$('secondary').addEventListener('click', () => {if(stage!=='working') window.setup.close();});
$('close').addEventListener('click', () => {if(stage!=='working') window.setup.close();});
$('minimize').addEventListener('click', () => window.setup.minimize());
