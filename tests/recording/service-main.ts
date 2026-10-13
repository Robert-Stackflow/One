import {app,BrowserWindow,ipcMain,protocol,session,screen,nativeImage,dialog,type IpcMainInvokeEvent} from 'electron';
import {readFile,mkdir,readdir} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {RecordingService,type RecordingContext} from '../../src/main/recording/service';
import {NativeAudio} from '../../src/main/recording/native-audio';
import {NativeCameraPreview} from '../../src/main/recording/native-camera-preview';
import {type RecordingWindowRole,recordingWindowURL} from '../../src/main/recording/window-host';
import type {SourcePreview} from '../../src/main/recording/recording-sources-protocol';
const directory=process.env.ONE_RECORDING_TEST_DIRECTORY!,data=join(directory,'recording');
app.setPath('userData',join(directory,'profile'));app.setPath('crashDumps',join(directory,'crashes'));
app.on('window-all-closed',()=>{});
protocol.registerSchemesAsPrivileged([{scheme:'one',privileges:{standard:true,secure:true,supportFetchAPI:true}},{scheme:'one-file',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
const timeout=setTimeout(()=>{console.error('Recording service tests timed out');app.exit(1);},50000);
let service:RecordingService,client:BrowserWindow,blocked=false,loads=0,sourceStopped=0,cameraStopped=0;
let cameraReady:(()=>void)|undefined,slowCamera=false,slowSources=false,finishSource:(()=>void)|undefined;
const pending=new Set<Promise<unknown>>(),roles=new Map<number,string>(),handlers=new Map<string,(event:IpcMainInvokeEvent,...args:any[])=>unknown>();
const windows:BrowserWindow[]=[];
function makeWindow(role:string,options:Electron.BrowserWindowConstructorOptions={}){
  const window=new BrowserWindow({width:850,height:650,...options,show:false,webPreferences:{preload:join(directory,role==='main'?'main-preload.cjs':role==='recording-region-outline'?'empty-preload.cjs':(role==='recording-toolbar-menu'?'recording-toolbar':role)+'.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  roles.set(window.webContents.id,role);windows.push(window);window.show=window.showInactive=window.focus=()=>{};return window;
}
function register(name:string,handler:(event:IpcMainInvokeEvent,...args:any[])=>unknown,allowed:readonly string[]){
  assert.ok(!handlers.has(name));handlers.set(name,handler);
  ipcMain.handle('one:'+name,(event,...args)=>{assert.ok(allowed.includes(roles.get(event.sender.id)!),'Wrong One window role');return handler(event,...args);});
}
const invoke=(window:BrowserWindow,method:string,...args:unknown[])=>window.webContents.executeJavaScript(`window.one.recording[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
async function until(check:()=>boolean){const limit=Date.now()+7000;while(!check()){if(Date.now()>limit)throw Error('Service fixture did not settle');await new Promise(resolve=>setTimeout(resolve,20));}}
const requestPermission=(window:BrowserWindow,permission:Parameters<RecordingService['permissionRequest']>[1],extra:Record<string,unknown>={})=>new Promise<boolean>(resolve=>service.permissionRequest(window.webContents,permission,resolve,{isMainFrame:true,requestingUrl:window.webContents.getURL(),...extra} as any));
const checkPermission=(window:BrowserWindow,permission:Parameters<RecordingService['permissionCheck']>[1],extra:Record<string,unknown>={})=>service.permissionCheck(window.webContents,permission,'one://app',{isMainFrame:true,requestingUrl:window.webContents.getURL(),...extra} as any);
async function run(){
  await app.whenReady();await mkdir(data,{recursive:true});
  protocol.handle('one',async request=>{
    const url=new URL(request.url);
    if(url.pathname==='/client.js')return new Response(await readFile(join(directory,'client.js'),'utf8'),{headers:{'content-type':'text/javascript'}});
    return new Response('<!doctype html><meta charset="utf-8"><title>One recording service fixture</title><script src="/client.js"></script>',{headers:{'content-type':'text/html'}});
  });
  const display=screen.getPrimaryDisplay(),sourceId=`screen:${display.id}:0`;
  const thumbnail=nativeImage.createFromBitmap(Buffer.alloc(16,255),{width:2,height:2}).toDataURL();
  const sources={async run(_type:'screen'|'window',valid:()=>boolean):Promise<SourcePreview[]>{if(slowSources)await new Promise<void>(resolve=>{finishSource=resolve;});return valid()?[{id:sourceId,name:'Synthetic source',display_id:String(display.id),thumbnail} as SourcePreview]:[];},async stop(){sourceStopped++;finishSource?.();finishSource=undefined;}};
  const context:RecordingContext={
    directory:data,
    windowHost:{createWindow:(role,options)=>makeWindow(role,options),register:(name,handler,roles)=>register(name,handler,roles)},
    register:(name,handler)=>register(name,handler,['main']),openPage:()=>{},confirm:async()=>({response:1,checkboxChecked:false}),
    chooseRegion:async()=>null,cancelRegion:()=>{},blocked:()=>blocked,dark:()=>false,prepare:()=>{},copy:async()=>{},windows:()=>windows.filter(window=>!window.isDestroyed()),
    protect:file=>{const local=relative(resolve(data),resolve(file));assert.ok(isAbsolute(local)||local==='..'||local.startsWith('..'+sep),'Must protect One recording data');},
    background:task=>{pending.add(task);void task.then(()=>pending.delete(task),()=>pending.delete(task));return task;},
  };
  service=new RecordingService(context,(root,options,update)=>NativeAudio.create(root,options,update,(executable,args)=>spawn(executable,['capture-test',...args.slice(1)],{windowsHide:true,stdio:'pipe',env:{...process.env,TEMP:directory,TMP:directory}})),undefined,async()=>[{id:'fixture-camera',name:'Synthetic camera'}],()=>{
    let stopped=false;const ready=slowCamera?new Promise<void>(resolve=>{cameraReady=resolve;}):Promise.resolve();
    return {ready,frame:()=>{if(stopped)throw Error('Camera stopped');return Buffer.from('synthetic-jpeg');},stop:async()=>{stopped=true;cameraStopped++;cameraReady?.();cameraReady=undefined;}} as unknown as NativeCameraPreview;
  },sources);
  await service.init();
  protocol.handle('one-file',request=>service.resource(request));
  session.defaultSession.webRequest.onBeforeRequest({urls:['one-file://*/*']},(details,callback)=>{const owner=details.webContents;callback({cancel:!owner||details.frame!==owner.mainFrame||!service.authorize(details.url,owner.id)});});
  client=makeWindow('main');client.webContents.on('did-finish-load',()=>{loads++;});
  await client.loadURL('one://app/index.html?view=main');service.bindClient(client);
  ipcMain.handle('fixture:display',(event,systemAudio)=>new Promise<void>((resolve,reject)=>{
    if(event.sender!==client.webContents||event.senderFrame!==client.webContents.mainFrame)return reject(Error('Invalid fixture client'));
    service.displayMediaRequest({frame:event.sender.mainFrame,videoRequested:true,audioRequested:systemAudio} as any,result=>result.video?resolve():reject(Error('Display grant denied')));
  }));
  const stranger=makeWindow('main');await stranger.loadURL('one://app/index.html?view=main');
  await assert.rejects(invoke(stranger,'state'),/拒绝/);
  const forged={sender:client.webContents,senderFrame:stranger.webContents.mainFrame} as IpcMainInvokeEvent;
  assert.throws(()=>handlers.get('recording-state')!(forged),/拒绝/);
  await assert.rejects(invoke(client,'sources','screen'),/停用/);await invoke(client,'pageActive',true);
  assert.equal(checkPermission(client,'media',{mediaType:'audio'}),false);
  const listToken=await invoke(client,'beginMicrophoneList');assert.equal(checkPermission(client,'media',{mediaType:'audio'}),true);
  assert.equal(checkPermission(stranger,'media',{mediaType:'audio'}),false);assert.equal(checkPermission(client,'media',{mediaType:'video'}),false);
  assert.equal(await requestPermission(client,'media',{mediaTypes:['audio']}),false);
  await invoke(client,'endMicrophoneList',listToken);assert.equal(checkPermission(client,'media',{mediaType:'audio'}),false);
  const preview=await invoke(client,'cameraSetup','fixture-camera');assert.equal(service.authorize(preview,client.webContents.id),true);assert.equal(service.authorize(preview,stranger.webContents.id),false);
  assert.equal(await client.webContents.executeJavaScript(`fetch(${JSON.stringify(preview)}).then(result=>result.text())`),'synthetic-jpeg');
  await assert.rejects(stranger.webContents.executeJavaScript(`fetch(${JSON.stringify(preview)}).then(result=>result.text())`));
  await client.webContents.executeJavaScript("new Promise(resolve=>{const frame=document.createElement('iframe');frame.id='child';frame.onload=resolve;frame.srcdoc='<!doctype html><p>Fixture</p>';document.body.append(frame);})");
  assert.ok(client.webContents.mainFrame.frames.length>0);assert.equal(service.authorize(preview,client.webContents.id),false);
  await client.webContents.executeJavaScript("document.getElementById('child').remove();true");await until(()=>client.webContents.mainFrame.frames.length===0);
  assert.equal(service.authorize(preview,client.webContents.id),true);
  await invoke(client,'pageActive',false);assert.equal(service.authorize(preview,client.webContents.id),false);assert.ok(cameraStopped>0);
  await invoke(client,'pageActive',true);slowCamera=true;
  await client.webContents.executeJavaScript("window.pendingPreview=window.one.recording.cameraSetup('fixture-camera');true");await until(()=>!!cameraReady);
  await invoke(client,'pageActive',false);assert.equal(await client.webContents.executeJavaScript('window.pendingPreview'),null);slowCamera=false;
  await invoke(client,'pageActive',true);slowSources=true;
  await client.webContents.executeJavaScript("window.pendingSources=window.one.recording.sources('screen');true");await until(()=>!!finishSource);
  await invoke(client,'pageActive',false);assert.deepEqual(await client.webContents.executeJavaScript('window.pendingSources'),[]);slowSources=false;
  await invoke(client,'pageActive',true);assert.equal((await invoke(client,'sources','screen')).length,1);
  const options={mode:'video',container:'webm',sourceId,systemAudio:false,microphone:true,microphoneId:'',fps:15,maxWidth:1920};
  await invoke(client,'arm',options);
  const deniedDisplay=async(frame:Electron.WebFrameMain,audioRequested:boolean)=>new Promise<void>(resolve=>service.displayMediaRequest({frame,videoRequested:true,audioRequested} as any,result=>{assert.deepEqual(result,{});resolve();}));
  await deniedDisplay(stranger.webContents.mainFrame,false);await deniedDisplay(client.webContents.mainFrame,true);
  assert.equal(await requestPermission(client,'media',{mediaTypes:['video']}),false);
  assert.equal(await requestPermission(client,'media',{mediaTypes:['audio','video']}),false);
  assert.equal(await requestPermission(stranger,'media',{mediaTypes:['audio']}),false);
  assert.equal(await requestPermission(client,'media',{mediaTypes:['audio']}),true);
  assert.equal(await requestPermission(client,'media',{mediaTypes:['audio']}),false);
  await invoke(client,'cancel');assert.equal(loads,1);assert.equal(client.isDestroyed(),false);
  await invoke(client,'sources','screen');
  const webmToken=await client.webContents.executeJavaScript(`window.startRecordingFixture(${JSON.stringify(sourceId)})`);
  await deniedDisplay(client.webContents.mainFrame,false);
  await until(()=>service.state().bytes>100);const before=service.state().bytes;
  await invoke(client,'pageActive',false);assert.equal(service.active,true);
  await until(()=>service.state().bytes>before);await invoke(client,'heartbeat',webmToken,0.3);
  await assert.rejects(invoke(client,'nativeStart',{mode:'audio'}),/停用/);
  const draining=service.finishCapture();assert.equal(service.finishCapture(),draining);await draining;
  await client.webContents.executeJavaScript('window.awaitRecordingFixture()');
  assert.equal(service.state().phase,'ready');assert.equal((await client.webContents.executeJavaScript('window.recordingClientStats()')).tailWritten,true);
  assert.equal(loads,1);assert.equal(client.isDestroyed(),false);assert.equal(service.hasUnsaved,true);
  const url=service.state().url!;assert.equal(service.authorize(url,client.webContents.id),true);assert.equal(service.authorize(url,stranger.webContents.id),false);
  const range=await client.webContents.executeJavaScript(`fetch(${JSON.stringify(url)},{headers:{Range:'bytes=0-3'}}).then(async response=>({status:response.status,bytes:Array.from(new Uint8Array(await response.arrayBuffer()))}))`);
  assert.deepEqual(range,{status:206,bytes:[26,69,223,163]});
  await assert.rejects(service.dispose(),/保存或放弃/);assert.equal(service.authorize(url,client.webContents.id),true);
  await invoke(client,'cancel');assert.equal(service.authorize(url,client.webContents.id),false);assert.equal(loads,1);
  await invoke(client,'pageActive',true);
  const audioOptions={mode:'audio',container:'wav',sourceId:'',systemAudio:true,microphone:false,microphoneId:'',fps:30,maxWidth:1920};
  await invoke(client,'nativeStart',audioOptions);await until(()=>service.state().seconds>0.12);
  const audioToken=service.state().token;await invoke(client,'pageActive',false);assert.equal(service.active,true);
  await invoke(client,'nativePause',audioToken,true);assert.equal(service.state().phase,'paused');await invoke(client,'nativePause',audioToken,false);
  await service.finishCapture();assert.equal(service.state().phase,'ready');assert.ok(service.state().bytes>44);
  const destination=join(directory,'result.onerec');
  dialog.showSaveDialog=(async()=>({canceled:false,filePath:destination})) as typeof dialog.showSaveDialog;
  await service.saveCurrentProject();assert.equal((await readFile(destination)).subarray(0,8).toString(),'ONERECRD');assert.equal(service.hasUnsaved,false);
  blocked=true;assert.equal(service.authorize(service.state().url!,client.webContents.id),false);await assert.rejects(invoke(client,'state'),/拒绝/);blocked=false;
  await service.dispose();assert.equal(client.isDestroyed(),false);assert.equal(loads,1);assert.equal(pending.size,0);
  const residual=(await readdir(data)).filter(name=>name.endsWith('.sealed'));assert.deepEqual(residual,[]);
  stranger.destroy();client.destroy();assert.equal(BrowserWindow.getAllWindows().length,0);
  console.log(JSON.stringify({result:'PASS',clientChannels:[...handlers.keys()].filter(name=>!/-player-|-toolbar-|-export-|-camera-|-annotation-|-region-|countdown/.test(name)).length,oneClient:true,scopedPermissions:true,displayReplayDenied:true,subframeResourcesDenied:true,revokedPreviews:true,latePreviewCancelled:true,hiddenWebmContinued:true,tailDrained:true,nativeAudioSynthetic:true,oneProject:true,noMainReload:true,noMainDestroyed:true,sourceStops:sourceStopped,remainingWindows:0}));
}
run().catch(error=>{console.error(String(error.stack||error).slice(0,5000));process.exitCode=1;}).finally(async()=>{
  if(service)await service.dispose(true).catch(()=>{});
  for(const window of BrowserWindow.getAllWindows())if(!window.isDestroyed())window.destroy();
  clearTimeout(timeout);app.exit(Number(process.exitCode||0));
});
