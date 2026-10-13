import {app,BrowserWindow,ipcMain,protocol,screen} from 'electron';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join,sep,extname} from 'node:path';
import assert from 'node:assert/strict';
import {RecordingToolbar} from '../../src/main/recording/recording-toolbar';
import type {RecordingWindowHost,RecordingWindowRole} from '../../src/main/recording/window-host';
import {defaultAppearance} from '../../src/shared/settings';
import type {RecordingState} from '../../src/shared/recording/recording';
import type {RecordingToolbarMenu} from '../../src/shared/recording/recording-toolbar';
import {defaultAnnotationStyle,type AnnotationCommand} from '../../src/shared/recording/recording-annotations';
import {defaultCameraStyle} from '../../src/shared/recording/recording-camera';
import {defaultInputStyle} from '../../src/shared/recording/recording-input';

const directory=process.env.ONE_RECORDING_TEST_DIRECTORY!,evidence=process.env.ONE_RECORDING_EVIDENCE!,renderer=resolve('dist/renderer');
app.setPath('userData',join(directory,'profile'));app.setPath('crashDumps',join(directory,'crashes'));app.on('window-all-closed',()=>{});
protocol.registerSchemesAsPrivileged([{scheme:'one',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const windows:BrowserWindow[]=[],roles=new Map<number,RecordingWindowRole>(),errors:string[]=[],commands:AnnotationCommand[]=[];
const calls:{name:string;args:any[]}[]=[];
const timeout=setTimeout(()=>{console.error('Toolbar page timeout');app.exit(1);},60000);
const pause=(ms=40)=>new Promise(resolve=>setTimeout(resolve,ms));
const js=(window:BrowserWindow,code:string)=>window.webContents.executeJavaScript('{'+code+'}');
async function until(check:()=>unknown|Promise<unknown>,label:string){for(let i=0;i<100;i++){if(await check())return;await pause();}throw Error('Timed out: '+label);}
const host:RecordingWindowHost={
  createWindow(role,options){
    const window=new BrowserWindow({...options,show:false,webPreferences:{preload:join(directory,'recording-toolbar.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    // Native bounds/resize calls remain real; the fixture never presents test windows.
    window.show=window.showInactive=window.focus=()=>{};
    window.webContents.on('console-message',event=>{if(event.level==='error')errors.push(role+': '+event.message);});
    roles.set(window.webContents.id,role);windows.push(window);return window;
  },
  register(name,handler,allowed){ipcMain.handle('one:'+name,(event,...args)=>{assert.ok(allowed.includes(roles.get(event.sender.id)!));calls.push({name,args});return handler(event,...args);});},
};
const state:RecordingState={phase:'recording',token:'toolbar-fixture',seconds:65,bytes:128,dark:true,message:'',options:{mode:'video',container:'mp4',sourceId:'screen:0:0',systemAudio:true,microphone:true,microphoneId:'',fps:30,maxWidth:1920},gains:{system:1,microphone:1},camera:{width:640,height:480,fps:30,encoder:'fixture'},cameraStyle:defaultCameraStyle(),inputStyle:defaultInputStyle(),regionMovable:true,annotating:false,annotationTool:'brush',annotationStyle:defaultAnnotationStyle()};
let toolbar:RecordingToolbar,stops=0,cancels=0,rejectPause=false;
const changed=()=>toolbar.changed();
async function ready(window:BrowserWindow,view:string){await until(()=>js(window,`document.body.dataset.view===${JSON.stringify(view)}`),'view '+view);}
async function click(window:BrowserWindow,id:string){await js(window,`document.getElementById(${JSON.stringify(id)}).click()`);}
async function openMenu(menu:RecordingToolbarMenu){
  const previous=windows.length,fits=calls.filter(c=>c.name==='recording-toolbar-menu-fit').length;await js(toolbar.window!,`window.one.recordingToolbar.menu(${JSON.stringify(state.token)},${JSON.stringify(menu)},{x:50,y:0,width:30,height:30})`);
  assert.equal(windows.length,previous+1);const window=windows.at(-1)!;await ready(window,'recording-toolbar-menu');
  await until(()=>js(window,"document.getElementById('menu').children.length>0"),'menu '+menu.kind);
  await until(()=>calls.filter(c=>c.name==='recording-toolbar-menu-fit').length>fits,'menu fit');
  // Let the native size change reach the renderer before opening a select;
  // the shared select correctly closes on a subsequent window resize.
  await js(window,'document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
  assert.equal(await js(window,"document.documentElement.scrollWidth>innerWidth"),false);return window;
}
async function dismiss(window:BrowserWindow){window.webContents.send('one:recording-menu-dismiss');await until(()=>window.isDestroyed(),'menu dismiss');}
async function main(){
  await app.whenReady();
  protocol.handle('one',async request=>{const url=new URL(request.url),file=resolve(renderer,'.'+decodeURIComponent(url.pathname));if(url.host!=='app'||!file.startsWith(renderer+sep))return new Response(null,{status:404});try{return new Response(new Uint8Array(await readFile(file)),{headers:{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'} as Record<string,string>)[extname(file)]||'application/octet-stream'}});}catch{return new Response(null,{status:404});}});
  ipcMain.handle('one:appearance',()=>({...defaultAppearance(),mode:'dark'}));ipcMain.handle('one:ui-font-source',()=>({local:[]}));ipcMain.handle('one:diagnostics-report',(_event,kind,detail)=>{errors.push(kind+': '+detail);});
  toolbar=new RecordingToolbar(host,{
    state:()=>structuredClone(state),blocked:()=>false,background:task=>task,failed:message=>errors.push(message),
    pause:async(_token,paused)=>{if(rejectPause){rejectPause=false;throw Error('测试暂停失败');}state.phase=paused?'paused':'recording';changed();},
    stop:async()=>{stops++;state.phase='stopping';changed();},cancel:async()=>{cancels++;},gain:async(_token,system,microphone)=>{state.gains={system,microphone};changed();},
    camera:async()=>{},cameraStyle:async(_token,style)=>{state.cameraStyle=style;changed();},inputStyle:async(_token,style)=>{state.inputStyle=style;changed();},region:async()=>{state.movingRegion=!state.movingRegion;changed();},
    annotate:async(_token,command)=>{commands.push(command);if(command.kind==='style')state.annotationStyle=command.style;if(command.kind==='tool'){state.annotationTool=command.tool;state.annotating=true;}if(command.kind==='interact')state.annotating=!state.annotating;changed();},
  });
  await toolbar.open(state.token,screen.getPrimaryDisplay().workArea);const window=toolbar.window!;await ready(window,'recording-toolbar');
  await until(()=>js(window,"document.getElementById('phase').textContent==='正在录制'&&!document.getElementById('pause').disabled"),'toolbar ready');
  assert.equal(await js(window,"document.getElementById('time').textContent"),'01:05');
  const sizes=await js(window,"['pause','stop','sound'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return [r.width,r.height]})");for(const [w,h] of sizes){assert.equal(w,36);assert.equal(h,36);}
  await click(window,'pause');await until(()=>state.phase==='paused','pause');await until(()=>js(window,"!document.getElementById('pause').disabled"),'pause settled');
  await js(window,"document.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',bubbles:true}))");await until(()=>state.phase==='recording','keyboard resume');
  await until(()=>js(window,"!document.getElementById('pause').disabled"),'resume settled');
  await click(window,'sound');await until(()=>js(window,"!document.getElementById('sound-panel').hidden"),'sound expansion');
  await js(window,"const field=document.getElementById('system-gain');field.value='35';field.dispatchEvent(new Event('input'))");await until(()=>state.gains!.system===.35,'gain');
  await click(window,'system-mute');await until(()=>state.gains!.system===0,'mute');await click(window,'system-mute');await until(()=>state.gains!.system===.35,'unmute');
  await click(window,'sound');await until(()=>js(window,"document.getElementById('sound-panel').hidden"),'collapse sound');
  await click(window,'region-move');await until(()=>state.movingRegion,'region toggle');

  let menu=await openMenu({kind:'tools',tools:['rectangle','ellipse'],selected:'rectangle'});
  await js(menu,"document.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));document.activeElement.click()");await until(()=>menu.isDestroyed(),'tool chosen');assert.equal(state.annotationTool,'ellipse');
  await until(()=>js(window,"!document.getElementById('pause').disabled"),'tool refresh');
  menu=await openMenu({kind:'stroke'});await js(menu,"document.querySelector('[data-stroke=double]').click()");await until(()=>menu.isDestroyed(),'stroke chosen');assert.equal(state.annotationStyle!.strokeStyle,'double');
  menu=await openMenu({kind:'font'});await js(menu,"[...document.querySelectorAll('.menu-item')].find(e=>e.textContent==='Consolas').click()");await until(()=>menu.isDestroyed(),'font chosen');assert.equal(state.annotationStyle!.fontFamily,'Consolas');
  menu=await openMenu({kind:'weight'});await js(menu,"document.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));document.activeElement.click()");await until(()=>menu.isDestroyed(),'weight chosen');assert.equal(state.annotationStyle!.fontWeight,700);
  menu=await openMenu({kind:'more',tools:['triangle'],selected:'ellipse'});await js(menu,"[...document.querySelectorAll('.menu-item')].find(e=>e.textContent.includes('撤销')).click()");await until(()=>menu.isDestroyed(),'more chosen');assert.ok(commands.some(c=>c.kind==='undo'));
  menu=await openMenu({kind:'input'});await click(menu,'live-input-keys');await until(()=>js(menu,"document.querySelectorAll('[role=option]').length===3"),'One input select');await js(menu,"[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.includes('全部按键')).click();document.getElementById('live-input-clicks').click()");await until(()=>state.inputStyle!.keys==='all'&&state.inputStyle!.clicks,'input settings').catch(async error=>{throw Error(error.message+' '+JSON.stringify({state:state.inputStyle,calls:calls.filter(c=>c.name==='recording-toolbar-input-style').slice(-3),fields:await js(menu,"[...document.querySelectorAll('select,input,button')].map(e=>({id:e.id,tag:e.tagName,value:e.value,checked:e.checked})).filter(e=>e.id.includes('input'))")}));});await dismiss(menu);
  menu=await openMenu({kind:'camera'});await until(()=>js(menu,"document.querySelectorAll('.custom-select').length>0"),'camera controls');
  await js(menu,"document.querySelector('input[type=checkbox]').click()");await until(()=>calls.some(c=>c.name==='recording-toolbar-camera-style'),'camera update');
  await click(menu,'camera-reset');await until(()=>JSON.stringify(state.cameraStyle)===JSON.stringify(defaultCameraStyle()),'camera reset');
  await js(menu,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await writeFile(join(evidence,'camera-menu.png'),(await menu.webContents.capturePage()).toPNG());await dismiss(menu);
  menu=await openMenu({kind:'color'});await until(()=>js(menu,"!!document.querySelector('.color-picker-hex input')"),'inline color picker');
  await js(menu,"const field=document.querySelector('.color-picker-hex input');field.value='#24a070';field.dispatchEvent(new Event('input',{bubbles:true}))");
  await js(menu,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await writeFile(join(evidence,'color-menu.png'),(await menu.webContents.capturePage()).toPNG());await dismiss(menu);assert.equal(state.annotationStyle!.color.toLowerCase(),'#24a070');

  // The real toolbar group opens properties and the existing One controls commit styles.
  await js(window,"document.querySelector('#annotation-tools [data-tools~=rectangle] > button').click()");
  await until(()=>js(window,"!document.getElementById('capture-properties').hidden"),'annotation properties');
  await js(window,"const field=document.getElementById('mark-width');field.value='7';field.dispatchEvent(new Event('change'))");await until(()=>state.annotationStyle!.width===7,'annotation width');
  assert.equal(await js(window,"!!document.querySelector('#capture-properties .number-control')"),true);
  await until(()=>js(window,"document.getElementById('mark-width').value==='7'&&!document.getElementById('pause').disabled"),'property refresh');await js(window,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await writeFile(join(evidence,'toolbar-properties.png'),(await window.webContents.capturePage()).toPNG());
  await until(()=>js(window,"!document.getElementById('pause').disabled"),'style settled');rejectPause=true;await click(window,'pause');
  await until(()=>js(window,"document.getElementById('annotation-message').textContent.includes('测试暂停失败')"),'action failure visible');
  await until(()=>js(window,"!document.getElementById('pause').disabled"),'error recovery');await click(window,'pause');await until(()=>state.phase==='paused','retry pause');
  await until(()=>js(window,"!document.getElementById('stop').disabled"),'stop enabled');await click(window,'stop');await until(()=>stops===1,'stop action');
  await until(()=>js(window,"document.getElementById('stop').getAttribute('aria-busy')==='true'"),'stopping feedback');
  state.retryAudio=true;state.phase='stopping';changed();await until(()=>js(window,"!document.getElementById('stop').disabled"),'retry enabled');await click(window,'stop');await until(()=>stops===2,'retry stop');
  state.retryAudio=false;state.phase='arming';state.countdown=3;changed();await until(()=>js(window,"!document.getElementById('stop').disabled&&document.getElementById('time').textContent==='3 s'"),'arming feedback');
  await js(window,"document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");await until(()=>cancels===1,'arming cancel');
  toolbar.close();await pause();assert.deepEqual(errors,[]);assert.equal(BrowserWindow.getAllWindows().length,0);
  console.log(JSON.stringify({result:'PASS',productionRenderer:true,realToolbarHost:true,productionPreload:true,menuKinds:8,sharedControls:true,pauseResume:true,muteRestore:true,colorDismissCommit:true,annotationProperties:true,errorRetry:true,stopAndCancel:true,remainingWindows:0}));
}
main().then(()=>{clearTimeout(timeout);app.exit(0);}).catch(error=>{console.error(error.stack||String(error));if(errors.length)console.error(JSON.stringify(errors).slice(0,4000));for(const window of windows)if(!window.isDestroyed())window.destroy();clearTimeout(timeout);app.exit(1);});
