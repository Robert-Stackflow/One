const {app, BrowserWindow, dialog, ipcMain} = require('electron');
// Electron's regular fs treats app.asar as a virtual directory. Installer
// integrity checks and backup must handle the archive as an ordinary file.
const fs = require('original-fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {spawn, execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {runningProcessIds,elevationCommand} = require('./setup-actions.cjs');

const execute = promisify(execFile);
const root = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '.dev-resources');
const info = JSON.parse(fs.readFileSync((!app.isPackaged && process.env.ONE_INSTALLER_BUILD_INFO) || path.join(root, 'build-info.json'), 'utf8'));
const payload = (!app.isPackaged && process.env.ONE_INSTALLER_PAYLOAD) || path.join(root, 'engine', 'One-Setup-Engine.exe');
const normalLauncher = (!app.isPackaged && process.env.ONE_INSTALLER_LAUNCH_HELPER) || (app.isPackaged ? path.join(root,'launch-normal.exe') : path.resolve(__dirname,'../dist/native/One.LaunchNormal.exe'));
const uninstallKey = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${info.guid}`;
const appKey = `HKCU\\Software\\${info.guid}`;
let window;
let installing = false;
let installedDirectory = '';
const resumedArgument = process.argv.find(value => value.startsWith('--one-setup-directory='));
let resumedDirectory = '';
if (resumedArgument) {
  try {resumedDirectory = Buffer.from(resumedArgument.slice('--one-setup-directory='.length), 'base64url').toString('utf8');}
  catch {resumedDirectory = '';}
}

function send(value) {if (window && !window.isDestroyed()) window.webContents.send('setup:progress', value);}
async function registry() {
  const script = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $v=Get-ItemProperty -LiteralPath 'Registry::${uninstallKey}' -ErrorAction SilentlyContinue; if($v){[pscustomobject]@{version=$v.DisplayVersion;icon=$v.DisplayIcon}|ConvertTo-Json -Compress}`;
  try {const {stdout} = await execute('powershell.exe', ['-NoProfile','-NonInteractive','-EncodedCommand', Buffer.from(script,'utf16le').toString('base64')], {windowsHide:true,timeout:10000}); return stdout.trim() ? JSON.parse(stdout.trim()) : null;}
  catch {return null;}
}
function registeredDirectory(value) {
  if (!value?.icon) return '';
  const icon = value.icon.replace(/,\d+$/, '').replace(/^"|"$/g, '');
  return path.dirname(icon);
}
async function hash(file) {
  const digest = crypto.createHash('sha256');
  await new Promise((resolve,reject) => {const stream=fs.createReadStream(file);stream.on('data',chunk=>digest.update(chunk));stream.once('end',resolve);stream.once('error',reject);});
  return digest.digest('hex');
}
async function checkedCopy(source, destination, expectedHash, expectedSize) {
  const input=fs.createReadStream(source,{highWaterMark:256*1024});
  const output=fs.createWriteStream(destination,{flags:'wx'});
  const digest=crypto.createHash('sha256'); let size=0;
  await new Promise((resolve,reject) => {
    input.on('data',chunk=>{size+=chunk.length;digest.update(chunk);send({stage:'extracting',detail:'正在准备安装文件',percent:Math.min(92,Math.round(size/expectedSize*92)),caption:`${Math.round(size/1048576)} / ${Math.round(expectedSize/1048576)} MB`});if(!output.write(chunk))input.pause();});
    output.on('drain',()=>input.resume());input.once('end',()=>output.end());output.once('finish',resolve);input.once('error',reject);output.once('error',reject);
  });
  if(size!==expectedSize || digest.digest('hex')!==expectedHash) throw Object.assign(Error('安装包校验失败'),{reason:'integrity'});
}
async function run(file,args,env=process.env) {
  return new Promise((resolve,reject)=>{const child=spawn(file,args,{windowsHide:true,stdio:'ignore',env});child.once('error',reject);child.once('exit',code=>resolve(code));});
}
async function runningOne() {
  const {stdout}=await execute('tasklist.exe',['/FI',`IMAGENAME eq ${info.product}.exe`,'/FO','CSV','/NH'],{windowsHide:true,timeout:10000,maxBuffer:1024*1024});
  return runningProcessIds(stdout,info.product);
}
async function waitForOneToExit(milliseconds) {
  const deadline=Date.now()+milliseconds;
  do {if(!(await runningOne()).length)return true;await new Promise(resolve=>setTimeout(resolve,400));} while(Date.now()<deadline);
  return !(await runningOne()).length;
}
async function quitOne(directory,force=false) {
  if(installing)return;
  try {
    const pids=await runningOne();
    if(!pids.length){send({stage:'ready'});return;}
    if(force) {
      for(const pid of pids) await run('taskkill.exe',['/PID',String(pid),'/T','/F']);
      if(!(await waitForOneToExit(5000)))throw Error('One 仍在运行，请从托盘退出后重试');
    } else {
      send({stage:'closing',detail:'正在退出 One'});
      const existing=registeredDirectory(await registry());
      const candidate=[existing,directory].filter(Boolean).map(folder=>path.join(folder,`${info.product}.exe`)).find(file=>fs.existsSync(file));
      if(!candidate){send({stage:'running',canForce:true});return;}
      await Promise.race([
        new Promise((resolve,reject)=>{const child=spawn(candidate,['--one-quit-for-install'],{windowsHide:true,stdio:'ignore'});child.once('error',reject);child.once('exit',resolve);}),
        new Promise(resolve=>setTimeout(resolve,3000))
      ]);
      if(!(await waitForOneToExit(8000))){send({stage:'running',canForce:true});return;}
    }
    send({stage:'ready'});
  } catch(error) {console.error('Unable to quit One before installation:',error);send({stage:'running',canForce:true,message:'One 仍在运行，请从托盘退出后重试。'});}
}
async function administrator() {
  const {stdout}=await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command','([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'],{windowsHide:true,timeout:10000,maxBuffer:1024});
  return stdout.trim().toLowerCase()==='true';
}
async function requestElevation(directory) {
  const executable=process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const command=elevationCommand(executable,directory);
  await execute('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{windowsHide:true,timeout:60000,maxBuffer:4096});
}
async function prepare(directory) {
  if(installing)return;
  if(!validDirectory(directory)){send({stage:'failed',reason:'invalidPath'});return;}
  try {
    if(app.isPackaged && !(await administrator())) {
      send({stage:'elevating'});
      await requestElevation(directory);
      app.quit();
      return;
    }
    if((await runningOne()).length){send({stage:'running'});return;}
    await install(directory);
  } catch(error) {console.error('Unable to prepare One installation:',error);send({stage:'failed',reason:'elevation'});}
}
async function backupPrevious(previous,scratch) {
  const exe=path.join(previous,`${info.product}.exe`);
  if(!fs.existsSync(exe)) return null;
  const backup=path.join(scratch,'previous-app');
  await fsp.cp(previous,backup,{recursive:true,errorOnExist:true,force:false,filter:source=>{if(fs.lstatSync(source).isSymbolicLink())throw Error('原有安装包含链接文件，无法安全备份');return true;}});
  const records=[];
  for(const [name,key] of [['uninstall',uninstallKey],['app',appKey]]) {
    const file=path.join(scratch,`${name}.reg`);
    if(await run('reg.exe',['export',key,file,'/y'])!==0) throw Error('无法保存原有安装记录');
    records.push(file);
  }
  const shortcut=path.join(app.getPath('appData'),'Microsoft','Windows','Start Menu','Programs',`${info.product}.lnk`);
  if(fs.existsSync(shortcut)) await fsp.copyFile(shortcut,path.join(scratch,'shortcut.lnk'));
  return {previous,backup,records,shortcut};
}
async function removePrevious(saved,scratch) {
  const original=path.join(saved.previous,`Uninstall ${info.product}.exe`);
  if(!fs.existsSync(original)) throw Error('找不到原有版本的卸载程序');
  const copy=path.join(scratch,'Previous-Uninstall.exe');
  await fsp.copyFile(original,copy);
  const code=await run(copy,['/S','/KEEP_APP_DATA','/currentuser',`_?=${saved.previous}`],{...process.env,TEMP:scratch,TMP:scratch});
  if(code!==0) throw Object.assign(Error(`无法移除旧版：${code}`),{reason:code===1602?'running':'engine'});
  // NSIS can hand off its final cleanup to a temporary process after its
  // original executable exits. Wait for both files and registration.
  for(let attempt=0;attempt<100;attempt++) {
    if(!fs.existsSync(path.join(saved.previous,`${info.product}.exe`)) && !(await registry())) break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(fs.existsSync(path.join(saved.previous,`${info.product}.exe`)) || (await registry())) throw Error('旧版移除后仍有残留');
}
async function restorePrevious(saved) {
  if(!saved) return;
  await fsp.mkdir(saved.previous,{recursive:true});
  await fsp.cp(saved.backup,saved.previous,{recursive:true,force:true});
  for(const file of saved.records) await run('reg.exe',['import',file]);
  const shortcut=path.join(path.dirname(saved.backup),'shortcut.lnk');
  if(fs.existsSync(shortcut)){await fsp.mkdir(path.dirname(saved.shortcut),{recursive:true});await fsp.copyFile(shortcut,saved.shortcut);}
}
function normalizeVersion(value) {return String(value||'0').split('.').map(part=>Number(part)||0);}
function newerThan(left,right) {const a=normalizeVersion(left),b=normalizeVersion(right);for(let i=0;i<Math.max(a.length,b.length);i++){if((a[i]||0)!==(b[i]||0))return (a[i]||0)>(b[i]||0);}return false;}
function validDirectory(input) {
  if(typeof input!=='string'||! /^[a-z]:\\[^<>"|?*]+$/i.test(input)||input.length>220) return false;
  const resolved=path.win32.resolve(input);
  return resolved.toLowerCase()!==path.win32.parse(resolved).root.toLowerCase();
}
async function install(directory) {
  if(installing) return;
  if(!validDirectory(directory)) {send({stage:'failed',reason:'invalidPath'});return;}
  installing=true;let scratch='',saved=null,changed=false,keepScratch=false,result=null;
  try {
    send({stage:'checking',detail:'正在验证安装位置',caption:'准备中'});
    if(os.arch()!=='x64'&&os.arch()!=='arm64') throw Object.assign(Error('当前系统不受支持'),{reason:'unsupported'});
    if((await runningOne()).length){result={stage:'running'};return;}
    const existing=await registry();
    if(newerThan(existing?.version,info.version)) throw Object.assign(Error('已有更新版本'),{reason:'newer'});
    const old=registeredDirectory(existing);
    if(old && old.toLowerCase()!==directory.toLowerCase()) {
      const inside=(child,parent)=>{const relative=path.relative(parent,child);return relative!==''&&!relative.startsWith('..')&&!path.isAbsolute(relative);};
      if(inside(directory,old)||inside(old,directory)) throw Object.assign(Error('安装位置不能包含原有目录'),{reason:'invalidPath'});
    }
    const parent=path.dirname(directory);
    await fsp.mkdir(parent,{recursive:true});
    const drive=path.parse(directory).root;
    const {stdout}=await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',`(Get-PSDrive -Name '${drive[0]}').Free`],{windowsHide:true,timeout:10000});
    if(Number(stdout.trim())<1024**3) throw Object.assign(Error('磁盘空间不足'),{reason:'space'});
    scratch=path.join(parent,`cs-${crypto.randomBytes(8).toString('hex')}`);
    await fsp.mkdir(scratch);
    const copied=path.join(scratch,'One-Install-Engine.exe');
    await checkedCopy(payload,copied,info.engineHash,info.engineBytes);
    if(old && fs.existsSync(path.join(old,`${info.product}.exe`))) {
      send({stage:'checking',detail:'正在保留当前安装',caption:'准备升级'});
      saved=await backupPrevious(old,scratch);
    }
    send({stage:'installing',detail:'正在写入程序文件',caption:'安装中',percent:null});
    changed=true;
    if(saved) await removePrevious(saved,scratch);
    if(saved && !app.isPackaged && process.env.ONE_INSTALLER_TEST_FAIL_AFTER_REMOVE==='1') throw Object.assign(Error('模拟安装核心失败'),{reason:'engine'});
    const code=await run(copied,['/S','/currentuser',`/D=${directory}`],{...process.env,TEMP:scratch,TMP:scratch});
    if(code!==0) throw Object.assign(Error(`安装核心返回 ${code}`),{reason:code===1602?'running':'engine'});
    send({stage:'verifying',detail:'正在确认文件完整性',caption:'即将完成',percent:null});
    const asar=path.join(directory,'resources','app.asar');
    if(!fs.existsSync(path.join(directory,`${info.product}.exe`))||!fs.existsSync(asar)||await hash(asar)!==info.asarHash) throw Object.assign(Error('安装文件校验失败'),{reason:'installed-integrity'});
    installedDirectory=directory;
    result={stage:'done',directory};
  } catch(error) {
    console.error('One installer failed:',error);
    if(changed&&saved) {
      try {await restorePrevious(saved);} catch(restoreError) {keepScratch=true;error=Object.assign(Error(`无法恢复旧版，备份位置：${scratch}`),{reason:'restore'});}
    }
    result={stage:'failed',reason:error.reason||'engine',message:error.message};
  } finally {
    if(scratch&&!keepScratch) await fsp.rm(scratch,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});
    installing=false;
    if(result) send(result);
  }
}

app.whenReady().then(async()=>{
  app.setAppUserModelId('local.one.desktop.setup');
  window=new BrowserWindow({width:620,height:420,minWidth:620,minHeight:420,maxWidth:620,maxHeight:420,frame:true,titleBarStyle:'hidden',titleBarOverlay:false,thickFrame:true,hasShadow:true,backgroundColor:'#ffffff',resizable:false,show:false,roundedCorners:true,icon:path.join(__dirname,'icon.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  window.on('close',event=>{if(installing)event.preventDefault();});
  ipcMain.handle('setup:state',async()=>{const existing=await registry();return {version:info.version,directory:resumedDirectory||registeredDirectory(existing)||path.join(process.env.LOCALAPPDATA,'Programs',info.product),installed:!!existing,resumed:!!resumedDirectory};});
  ipcMain.handle('setup:choose-directory',async()=>{const result=await dialog.showOpenDialog(window,{title:'选择安装位置',properties:['openDirectory','createDirectory']});if(result.canceled)return '';const selected=result.filePaths[0];return path.basename(selected).toLowerCase()===info.product.toLowerCase()?selected:path.join(selected,info.product);});
  ipcMain.handle('setup:install',(_event,directory)=>prepare(directory));
  ipcMain.handle('setup:quit-one',(_event,directory,force)=>quitOne(directory,force));
  ipcMain.handle('setup:launch',async()=>{
    if(installedDirectory){
      const code=await run(normalLauncher,[path.join(installedDirectory,`${info.product}.exe`)]);
      if(code!==0)throw new Error(`无法以普通权限打开 One（${code}）。请从开始菜单手动打开。`);
    }
    window.close();
  });
  ipcMain.handle('setup:minimize',()=>window.minimize());
  ipcMain.handle('setup:close',()=>{if(!installing)window.close();});
  await window.loadFile(path.join(__dirname,'index.html'));
  window.show();
});
app.on('window-all-closed',()=>app.quit());
