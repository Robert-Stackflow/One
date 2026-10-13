import { app, BrowserWindow, ipcMain, protocol, screen, type IpcMainInvokeEvent, type Rectangle } from 'electron';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { RecordingToolbar } from '../../src/main/recording/recording-toolbar';
import { RecordingInputOverlay } from '../../src/main/recording/recording-input-overlay';
import { RecordingCameraOverlay } from '../../src/main/recording/recording-camera-overlay';
import { RecordingAnnotationOverlay } from '../../src/main/recording/recording-annotation-overlay';
import { RecordingRegionOverlay } from '../../src/main/recording/recording-region-overlay';
import { RecordingCountdown } from '../../src/main/recording/recording-countdown';
import { recordingWindowURL, type RecordingWindowHost, type RecordingWindowRole } from '../../src/main/recording/window-host';
import { defaultCameraStyle, type CameraStyle } from '../../src/shared/recording/recording-camera';
import { defaultInputStyle, type RecordingInput } from '../../src/shared/recording/recording-input';
import { defaultAnnotationStyle } from '../../src/shared/recording/recording-annotations';
import { annotationStylesFrom } from '../../src/shared/capture/annotation-preferences';
import type { RecordingState } from '../../src/shared/recording/recording';
import type { VideoReady } from '../../src/shared/recording/native-video';

const directory = process.env.ONE_RECORDING_TEST_DIRECTORY!;
app.setPath('userData',join(directory,'profile'));
app.setPath('crashDumps',join(directory,'crashes'));
app.on('window-all-closed',()=>{});
protocol.registerSchemesAsPrivileged([{scheme:'one',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const timeout = setTimeout(()=>{console.error('Overlay tests timed out');app.exit(1);},45000);
const roles = new Map<number,RecordingWindowRole>();
const windows: BrowserWindow[] = [];
const shows = new Map<BrowserWindow,number>();
const protections = new Map<BrowserWindow,boolean>();
const passthrough = new Map<BrowserWindow,boolean>();
const shapes = new Map<BrowserWindow,Rectangle[]>();
const registrations = new Map<string,{handler:(event:IpcMainInvokeEvent,...args:any[])=>unknown,roles:readonly RecordingWindowRole[]}>();
const host: RecordingWindowHost = {
  createWindow(role,options) {
    assert.equal('webPreferences' in options,false);
    const window = new BrowserWindow({width:64,height:64,...options,show:false,webPreferences:{
      ...(role==='recording-region-outline'?{}:{preload:join(directory,(role==='recording-toolbar-menu'?'recording-toolbar':role)+'.cjs')}),
      sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false,
    }});
    roles.set(window.webContents.id,role);windows.push(window);shows.set(window,0);
    // Exercise real native window configuration without displaying test surfaces on the desktop.
    window.show = window.showInactive = ()=>{shows.set(window,shows.get(window)!+1);};
    const protect=window.setContentProtection.bind(window), ignore=window.setIgnoreMouseEvents.bind(window), shape=window.setShape.bind(window);
    window.setContentProtection=value=>{protections.set(window,value);protect(value);};
    window.setIgnoreMouseEvents=(value,options)=>{passthrough.set(window,value);ignore(value,options);};
    window.setShape=value=>{shapes.set(window,value);shape(value);};
    return window;
  },
  register(name,handler,allowed) {
    assert.ok(name.startsWith('recording-'));assert.ok(!registrations.has(name));
    registrations.set(name,{handler,roles:allowed});
    ipcMain.handle('one:'+name,(event,...args)=>{
      assert.ok(allowed.includes(roles.get(event.sender.id)!),'One role rejected');
      return handler(event,...args);
    });
  },
};
const featurePrefixes:Record<string,string>={'recording-toolbar-':'recordingToolbar','recording-input-':'recordingInput','recording-camera-':'recordingCamera','recording-annotation-':'recordingAnnotation','recording-region-':'recordingRegion','recording-countdown-':'recordingCountdown'};
const call = (window:BrowserWindow,name:string,...args:unknown[]) => {
  const prefix=Object.keys(featurePrefixes).find(value=>name.startsWith(value))!;
  const action=name.slice(prefix.length),method=action==='menu-close'?'closeMenu':action==='menu-fit'?'fitMenu':action.replace(/-([a-z])/g,(_match,letter:string)=>letter.toUpperCase());
  return window.webContents.executeJavaScript(`window.one[${JSON.stringify(featurePrefixes[prefix])}][${JSON.stringify(method)}](...${JSON.stringify(args)})`);
};
const lastPacket = (window:BrowserWindow,name:string) =>
  window.webContents.executeJavaScript(`window.recordingFixture.events().filter(item=>item.name===${JSON.stringify(name)}).at(-1)?.value`);
const drain = ()=>new Promise(resolve=>setTimeout(resolve,20));
async function scopedBridge(window:BrowserWindow,feature:string) {
  const result=await window.webContents.executeJavaScript(`({features:Object.keys(window.one).filter(key=>key.startsWith('recording')),legacy:Object.keys(window).filter(key=>/^frame(Recording|Countdown)/.test(key)),broad:typeof window.one.aiState})`);
  assert.deepEqual(result,{features:[feature],legacy:[],broad:'undefined'});
}
async function subscribe(window:BrowserWindow,feature:string,method='onChange') {
  assert.equal(await window.webContents.executeJavaScript(`window.__notifications=0;window.__unsubscribe=window.one[${JSON.stringify(feature)}][${JSON.stringify(method)}](()=>window.__notifications++);typeof window.__unsubscribe`),'function');
}
async function wrongOwner(window:BrowserWindow,name:string) {
  const stranger=host.createWindow(roles.get(window.webContents.id)!,{});
  try {await stranger.loadURL(window.webContents.getURL());await assert.rejects(call(stranger,name),/失效|结束/);} finally {stranger.destroy();}
}
async function wrongFrame(window:BrowserWindow,name:string) {
  const frame=window.webContents.mainFrame;
  const event={sender:window.webContents,senderFrame:{url:frame.url}} as unknown as IpcMainInvokeEvent;
  await assert.rejects(Promise.resolve().then(()=>registrations.get(name)!.handler(event)),/失效|结束/);
}

async function run() {
  await app.whenReady();
  protocol.handle('one',()=>new Response('<!doctype html><meta charset="utf-8"><title>One overlay fixture</title>',{headers:{'content-type':'text/html'}}));
  const display=screen.getPrimaryDisplay(), dip={x:display.workArea.x+100,y:display.workArea.y+100,width:640,height:360};
  const physical=screen.dipToScreenRect(null,dip), bounds=()=>({...physical});
  const state:RecordingState={phase:'recording',token:'current',seconds:2,bytes:0,dark:false,message:'',options:{mode:'video',container:'mp4',sourceId:'screen:0:0',systemAudio:false,microphone:false,microphoneId:'',fps:30,maxWidth:1920}};
  let failures=0, cancelled=0, stops=0, paused=0, blocked=false, raised=0, selected=0;
  const valid=(token:string)=>token===state.token;
  const countdown=new RecordingCountdown(host,()=>{cancelled++;});
  await countdown.open(dip,3);let window=countdown.window!;
  await scopedBridge(window,'recordingCountdown');await subscribe(window,'recordingCountdown','onTick');
  assert.equal(await call(window,'recording-countdown-state'),3);
  countdown.update(2);await drain();assert.equal(await lastPacket(window,'one:recording-countdown-tick'),2);
  assert.equal(await window.webContents.executeJavaScript('window.__notifications'),1);
  await window.webContents.executeJavaScript('window.__unsubscribe()');countdown.update(1);await drain();assert.equal(await window.webContents.executeJavaScript('window.__notifications'),1);
  await wrongOwner(window,'recording-countdown-state');await wrongFrame(window,'recording-countdown-state');
  await call(window,'recording-countdown-cancel');assert.equal(cancelled,1);
  countdown.close();assert.equal(cancelled,1);assert.ok(window.isDestroyed());
  await countdown.open(dip,1);countdown.window!.destroy();assert.equal(cancelled,2);
  const pendingCountdown=countdown.open(dip,3);window=countdown.window!;
  const lateCountdown=pendingCountdown.catch(error=>{assert.match(String(error),/ERR_ABORTED|ERR_FAILED|destroyed|closed/i);});
  countdown.close();await lateCountdown;assert.equal(shows.get(window),0);

  const input=new RecordingInputOverlay(host,()=>state,()=>{failures++;});
  await input.open(state.token,defaultInputStyle(),physical.width,physical.height,bounds);window=input.window!;
  await scopedBridge(window,'recordingInput');await subscribe(window,'recordingInput');
  assert.equal(protections.get(window),true);assert.equal(passthrough.get(window),true);
  input.push(Array.from({length:600},(_,id)=>({id,sample:id*500,kind:'move',x:0.5,y:0.5}) as RecordingInput));
  const packet=await call(window,'recording-input-state');
  assert.equal(await window.webContents.executeJavaScript('window.__notifications'),1);await window.webContents.executeJavaScript('window.__unsubscribe()');
  assert.ok(packet.events.length<=512);assert.ok(packet.events.every((event:RecordingInput)=>event.sample>=299500-240000));
  state.phase='paused';assert.equal((await call(window,'recording-input-state')).paused,true);state.phase='recording';
  await wrongOwner(window,'recording-input-state');await wrongFrame(window,'recording-input-state');
  state.token='replaced';await assert.rejects(call(window,'recording-input-state'),/失效/);state.token='current';
  input.setStyle({...defaultInputStyle(),clicks:true});assert.equal((await call(window,'recording-input-state')).events.length,0);
  assert.equal(await window.webContents.executeJavaScript('window.__notifications'),1);
  input.close();assert.equal(failures,0);assert.ok(window.isDestroyed());

  let layout:CameraStyle|undefined, delayLayout:Promise<void>|undefined;
  const video:VideoReady={width:1280,height:720,fps:30,encoder:'fixture'}, camera:VideoReady={width:640,height:480,fps:30,encoder:'fixture'};
  const cameraOverlay=new RecordingCameraOverlay(host,{valid,layout:async value=>{layout=value;await delayLayout;},failed:()=>{failures++;}});
  await cameraOverlay.open(state.token,defaultCameraStyle(),video,camera,bounds);window=cameraOverlay.window!;
  await scopedBridge(window,'recordingCamera');await subscribe(window,'recordingCamera');
  assert.equal(protections.get(window),true);cameraOverlay.frame(7);
  const cameraPacket=await call(window,'recording-camera-state');
  assert.equal(cameraPacket.url,'one-file://recording-camera-live/current?serial=7');
  assert.equal(await window.webContents.executeJavaScript('window.__notifications'),1);await window.webContents.executeJavaScript('window.__unsubscribe()');
  cameraOverlay.frame(8);await drain();assert.equal(await window.webContents.executeJavaScript('window.__notifications'),1);
  await wrongOwner(window,'recording-camera-state');await wrongFrame(window,'recording-camera-state');
  await assert.rejects(call(window,'recording-camera-style','old',defaultCameraStyle()),/失效/);
  await call(window,'recording-camera-drag',state.token,'start',false,{x:100,y:100});
  await call(window,'recording-camera-drag',state.token,'end',false,{x:180,y:140});
  assert.ok(layout!.x>defaultCameraStyle().x);assert.ok(layout!.y>defaultCameraStyle().y);
  await call(window,'recording-camera-drag',state.token,'start',true,{x:0,y:0});
  await call(window,'recording-camera-drag',state.token,'end',true,{x:9999,y:0});assert.equal(layout!.width,0.6);
  let releaseLayout!:()=>void;delayLayout=new Promise(resolve=>{releaseLayout=resolve;});
  const lateStyle=cameraOverlay.setStyle(defaultCameraStyle());cameraOverlay.close();releaseLayout();await lateStyle;
  assert.ok(window.isDestroyed());assert.equal(cameraOverlay.currentStyle,undefined);

  const annotationStyles=annotationStylesFrom();let styleWrites=0;
  const annotation=new RecordingAnnotationOverlay(host,{annotationStyles:()=>annotationStyles,saveAnnotationStyle:async(tool,style)=>{annotationStyles[tool as keyof typeof annotationStyles]=style;styleWrites++;},valid,scene:async()=>{},frame:async()=>({}) as any,failed:()=>{failures++;},raised:()=>{raised++;},selected:()=>{selected++;},controls:()=>[{x:dip.x+50,y:dip.y+50,width:100,height:30}]});
  await annotation.open(state.token,physical.width,physical.height,bounds);window=annotation.window!;
  await scopedBridge(window,'recordingAnnotation');
  assert.equal(protections.get(window),true);assert.equal(passthrough.get(window),true);
  assert.equal(shapes.get(window)!.reduce((total,r)=>total+r.width*r.height,0),dip.width*dip.height-3000);
  await wrongOwner(window,'recording-annotation-state');await wrongFrame(window,'recording-annotation-state');
  await annotation.command({kind:'tool',tool:'brush'});assert.equal(annotation.interactive,true);assert.equal(passthrough.get(window),false);
  await call(window,'recording-annotation-selected',state.token,'brush',defaultAnnotationStyle());assert.equal(selected,1);assert.ok(raised>0);
  assert.equal(styleWrites,0,'Selecting existing annotations must not replace defaults');
  await annotation.command({kind:'style',style:{...annotation.style,color:'#4488cc',width:9}});
  await annotation.command({kind:'tool',tool:'text'});assert.equal(annotation.style.width,3);
  await annotation.command({kind:'style',style:{...annotation.style,fontWeight:700,italic:true,textOutline:true}});
  await annotation.command({kind:'tool',tool:'brush'});assert.equal(annotation.style.width,9);assert.equal(annotation.style.fontWeight,400);
  await annotation.command({kind:'tool',tool:'text'});assert.equal(annotation.style.textOutline,true);assert.equal(annotation.style.italic,true);assert.equal(annotation.style.fontWeight,700);
  assert.equal(styleWrites,2);
  const flush=annotation.flush();assert.equal(annotation.flush(),flush);await drain();
  const flushPacket=await lastPacket(window,'one:recording-annotation-changed');assert.ok(flushPacket.flush);
  await call(window,'recording-annotation-flushed',state.token,'other','');
  await call(window,'recording-annotation-flushed',state.token,flushPacket.flush,'');await flush;
  const interrupted=annotation.flush();const rejected=assert.rejects(interrupted,/关闭/);await drain();annotation.close();await rejected;
  assert.ok(window.isDestroyed());assert.equal(annotation.interactive,false);

  let crop={x:100,y:100,width:320,height:180};
  const region=new RecordingRegionOverlay(host,{valid,crop:()=>({...crop}),bounds,move:async(x,y)=>{crop={...crop,x,y};},changed:()=>{},failed:()=>{failures++;}});
  await region.open(state.token);const outline=region.window!,handle=region.handle!;
  await scopedBridge(handle,'recordingRegion');
  assert.equal(roles.get(outline.webContents.id),'recording-region-outline');
  assert.equal(await outline.webContents.executeJavaScript('typeof window.recordingFixture'),'undefined');
  assert.equal(passthrough.get(outline),true);assert.equal(passthrough.get(handle),false);
  assert.equal(shapes.get(outline)!.length,4);assert.ok(!registrations.get('recording-region-state')!.roles.includes('recording-region-outline'));
  await wrongOwner(handle,'recording-region-state');await wrongFrame(handle,'recording-region-state');
  await assert.rejects(call(handle,'recording-region-drag',state.token,'start',{x:0,y:0}),/无效/);
  region.toggle();const first={...crop};
  await call(handle,'recording-region-drag',state.token,'start',{x:20,y:20});
  await call(handle,'recording-region-drag',state.token,'end',{x:40,y:35});
  const physicalDisplay=screen.dipToScreenRect(null,display.bounds);
  assert.equal(crop.x,Math.round(first.x+20*physicalDisplay.width/display.bounds.width));
  assert.equal(crop.y,Math.round(first.y+15*physicalDisplay.height/display.bounds.height));
  assert.equal(crop.width,first.width);assert.equal(crop.height,first.height);region.close();assert.ok(outline.isDestroyed()&&handle.isDestroyed());

  const toolbar=new RecordingToolbar(host,{state:()=>state,blocked:()=>blocked,pause:async()=>{paused++;},stop:async()=>{stops++;},gain:async()=>{},camera:async()=>{},cameraStyle:async()=>{},inputStyle:async()=>{},region:async()=>{},annotate:async()=>{},cancel:async()=>{cancelled++;},failed:()=>{failures++;},background:task=>task});
  await toolbar.open(state.token,dip);window=toolbar.window!;
  await scopedBridge(window,'recordingToolbar');
  assert.equal(window.isAlwaysOnTop(),true);await wrongOwner(window,'recording-toolbar-state');await wrongFrame(window,'recording-toolbar-state');
  await call(window,'recording-toolbar-pause',state.token,true);assert.equal(paused,1);
  await call(window,'recording-toolbar-fit',state.token,540);assert.equal(window.getContentBounds().width,540);
  await call(window,'recording-toolbar-menu',state.token,{kind:'color'},{x:20,y:10,width:20,height:20});
  const menu=[...windows].reverse().find(candidate=>!candidate.isDestroyed()&&roles.get(candidate.webContents.id)==='recording-toolbar-menu')!;
  assert.ok(menu);assert.equal((await call(menu,'recording-toolbar-menu-state')).menu.kind,'color');
  await assert.rejects(call(menu,'recording-toolbar-stop',state.token),/失效/);
  const menuClosed=new Promise<void>(resolve=>menu.once('closed',()=>resolve()));
  // Closing destroys the IPC caller; completion is the native window event, not its reply.
  void call(menu,'recording-toolbar-menu-close',state.token).catch(()=>{});await menuClosed;assert.ok(menu.isDestroyed());
  blocked=true;await assert.rejects(call(window,'recording-toolbar-pause',state.token,true),/失效/);blocked=false;
  window.close();await drain();assert.equal(stops,1);assert.equal(window.isDestroyed(),false);
  toolbar.close();assert.ok(window.isDestroyed());assert.equal(failures,0);
  for(const [role,feature] of [['recording-player','recordingPlayer'],['recording-export','recordingExport']] as const){
    const extra=host.createWindow(role,{});await extra.loadURL(recordingWindowURL(role));await scopedBridge(extra,feature);extra.destroy();
  }
  assert.equal(BrowserWindow.getAllWindows().length,0);
  console.log(JSON.stringify({result:'PASS',realWindows:windows.length,registeredChannels:registrations.size,productionPreloads:8,scopedAPIs:true,unsubscribe:true,countdown:true,inputRetention:true,cameraLayout:true,annotationFlush:true,regionDpi:true,outlineWithoutBridge:true,toolbarMenuScope:true,lateReplies:true,remainingWindows:0,visibleWindows:0}));
}
run().catch(error=>{console.error(String(error.stack||error).slice(0,5000));process.exitCode=1;}).finally(()=>{
  for(const window of BrowserWindow.getAllWindows()) if(!window.isDestroyed()) window.destroy();
  clearTimeout(timeout);app.exit(Number(process.exitCode||0));
});
