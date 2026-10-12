import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { RecordingPlayer } from '../../src/main/recording/recording-player';
import { RecordingExport } from '../../src/main/recording/recording-export';
import { recordingWindowURL, type RecordingWindowHost, type RecordingWindowRole } from '../../src/main/recording/window-host';
import { RECORDING_PROJECT_FORMAT } from '../../src/shared/media-project';
import { defaultPlayback, type PlaybackState } from '../../src/shared/recording/recording-playback';
import type { RecordingProject } from '../../src/shared/recording/recording-project';
import type { RecordingExportPayload } from '../../src/shared/recording/recording-export';

class WindowFixture extends EventEmitter {
  destroyed = false;
  shown = 0;
  focused = 0;
  messages: string[] = [];
  webContents = Object.assign(new EventEmitter(), {
    mainFrame: {url:'', frames:[]},
    setWindowOpenHandler: (_handler: unknown) => {},
    send: (name: string) => this.messages.push(name),
  });
  loading?: Promise<void>;
  async loadURL(url: string) { this.webContents.mainFrame.url = url; await this.loading; }
  isDestroyed() { return this.destroyed; }
  show() { this.shown++; }
  focus() { this.focused++; }
  destroy() { this.destroyed = true; this.emit('closed'); }
  event() { return {sender:this.webContents,senderFrame:this.webContents.mainFrame} as unknown as IpcMainInvokeEvent; }
  asWindow() { return this as unknown as BrowserWindow; }
}
class HostFixture implements RecordingWindowHost {
  windows: WindowFixture[] = [];
  routes: RecordingWindowRole[] = [];
  handlers = new Map<string, {handler:(event:IpcMainInvokeEvent,...args:any[])=>unknown,roles:readonly RecordingWindowRole[]}>();
  loading?: Promise<void>;
  createWindow: RecordingWindowHost['createWindow'] = (role, options) => {
    assert.equal('webPreferences' in options,false);
    const window = new WindowFixture(); window.loading = this.loading;
    this.windows.push(window); this.routes.push(role); return window.asWindow();
  };
  register: RecordingWindowHost['register'] = (name,handler,roles) => {
    assert.ok(name.startsWith('recording-')); assert.ok(!this.handlers.has(name));
    this.handlers.set(name,{handler,roles});
  };
  call(name:string,window:WindowFixture,...args:unknown[]) {
    return this.handlers.get(name)!.handler(window.event(),...args);
  }
}
const directory = process.env.ONE_RECORDING_TEST_DIRECTORY!;
const project: RecordingProject = {
  format: RECORDING_PROJECT_FORMAT.id, version:1, seconds:0.2,
  options:{mode:'video',container:'mp4',sourceId:'screen:0:0',systemAudio:false,microphone:false,microphoneId:'',fps:30,maxWidth:1920},
  video:{width:64,height:48,fps:30,encoder:'fixture'},
  playback:{...defaultPlayback(),gif:{frames:[{source:0,delay:5},{source:0.1,delay:10}],direction:'forward',repeat:-1}},
  inputs:[],annotations:[],layouts:[],
};
async function until(ready:()=>boolean) {
  const deadline = Date.now()+5000;
  while (!ready()) { if (Date.now()>deadline) throw Error('Host fixture did not settle'); await new Promise(resolve=>setTimeout(resolve,10)); }
}
function setDialog(handler: (...args:any[])=>unknown) { Object.assign(globalThis,{__oneRecordingDialog:handler}); }

test('player uses One window roles and rejects other owners, frames, tokens, phases and queued shutdown', async () => {
  const host = new HostFixture();
  let blocked = false, edits = 0;
  const state = {phase:'ready',token:'current',url:'one-file://recording/current',dark:false,playback:project.playback} as PlaybackState;
  const player = new RecordingPlayer(host, {
    state:()=>state,blocked:()=>blocked,inputEvents:()=>[],annotationEvents:()=>[],cameraLayouts:()=>[],cursorEvents:()=>[],cursorShapes:()=>[],
    edit:()=>{edits++;},save:async()=>null,saveProject:async()=>null,export:async()=>null,previewGif:async()=>null,cancelExport:async()=>{},background:task=>task,
  });
  await player.open(); const window = host.windows[0];
  assert.deepEqual(host.routes,['recording-player']);
  for (const {roles} of host.handlers.values()) assert.deepEqual(roles,['recording-player']);
  assert.equal(window.webContents.mainFrame.url,recordingWindowURL('recording-player'));
  assert.equal(await host.call('recording-player-state',window),state);
  assert.throws(()=>host.call('recording-player-state',new WindowFixture()),/失效/);
  const event = {...window.event(),senderFrame:{url:recordingWindowURL('recording-player')} as any};
  assert.throws(()=>host.handlers.get('recording-player-state')!.handler(event),/失效/);
  assert.throws(()=>host.call('recording-player-edit',window,'previous',project.playback),/失效/);
  window.webContents.mainFrame.url = 'one://app/index.html?view=main';
  assert.throws(()=>host.call('recording-player-state',window),/失效/);
  window.webContents.mainFrame.url = recordingWindowURL('recording-player');
  state.phase = 'recording'; assert.throws(()=>host.call('recording-player-state',window),/失效/); state.phase='ready';
  const queued = host.call('recording-player-edit',window,'current',project.playback); blocked=true;
  await assert.rejects(Promise.resolve(queued),/失效/); assert.equal(edits,0); blocked=false;
  await host.call('recording-player-edit',window,'current',project.playback); assert.equal(edits,1);
  player.changed(); assert.deepEqual(window.messages,['one:recording-changed']);
  await player.open(); assert.equal(host.windows.length,1);
  player.close(); assert.equal(window.destroyed,true);
  assert.throws(()=>host.call('recording-player-state',window),/失效/);
});

test('closing a loading player prevents a late result window from becoming visible', async () => {
  const host = new HostFixture(); let loaded!:()=>void;
  host.loading = new Promise<void>(resolve=>{loaded=resolve;});
  const state = {phase:'ready',token:'current',url:'one-file://recording/current',playback:project.playback} as PlaybackState;
  const player = new RecordingPlayer(host,{
    state:()=>state,blocked:()=>false,inputEvents:()=>[],annotationEvents:()=>[],cameraLayouts:()=>[],cursorEvents:()=>[],cursorShapes:()=>[],
    edit:()=>{},save:async()=>null,saveProject:async()=>null,export:async()=>null,previewGif:async()=>null,cancelExport:async()=>{},background:task=>task,
  });
  const pending = player.open(); player.close(); loaded(); await pending;
  assert.equal(host.windows[0].shown,0); assert.equal(host.windows[0].destroyed,true);
});

test('export host renders real GIF bytes through role-bound frames and cleans scratch data', async () => {
  const host = new HostFixture(), scratch = join(directory,'host-export'), destination = join(directory,'host-result.gif');
  const protectedPaths: string[] = [];
  setDialog(async()=>({canceled:false,filePath:destination}));
  const exporter = new RecordingExport(host,scratch,{snapshot:()=>({project,video:'one-file://recording/current',audio:[]}),token:()=>'current',allowed:()=>true,changed:()=>{},protect:file=>protectedPaths.push(file)});
  const id = await exporter.start({format:'gif',quality:'original'},new WindowFixture().asWindow()); assert.ok(id);
  await until(()=>host.windows.length===1); const window = host.windows[0];
  assert.deepEqual(host.routes,['recording-export']);
  for (const {roles} of host.handlers.values()) assert.deepEqual(roles,['recording-export']);
  assert.throws(()=>host.call('recording-export-payload',new WindowFixture()),/失效/);
  assert.throws(()=>host.call('recording-export-frame',window,'wrong',0,new Uint8Array()),/失效/);
  const payload = host.call('recording-export-payload',window) as RecordingExportPayload;
  assert.equal(payload.project.format,RECORDING_PROJECT_FORMAT.id);
  for (let i=0;i<payload.plan.frames;i++) {
    const rgba = new Uint8Array(payload.plan.width*payload.plan.height*4).fill(i?180:80);
    await host.call('recording-export-frame',window,id,i,rgba);
  }
  await host.call('recording-export-finish',window,id); await until(()=>!exporter.busy);
  assert.equal(exporter.state?.phase,'saved');
  assert.equal((await readFile(destination)).toString('ascii',0,6),'GIF89a');
  assert.deepEqual(protectedPaths,[destination,destination]);
  assert.deepEqual(await readdir(scratch),[]); assert.equal(window.destroyed,true);
  assert.throws(()=>host.call('recording-export-payload',window),/失效/);
});

test('export rejects protected destinations before creating scratch or an encoder', async () => {
  const host = new HostFixture(), scratch = join(directory,'protected-export'), destination = join(directory,'protected.gif');
  await writeFile(destination,'user data');
  setDialog(async()=>({canceled:false,filePath:destination.slice(0,-4)}));
  const exporter = new RecordingExport(host,scratch,{snapshot:()=>({project,video:'one-file://recording/current',audio:[]}),token:()=>'current',allowed:()=>true,changed:()=>{},protect:file=>{assert.equal(file,destination);throw Error('请保存到 One 数据目录之外');}});
  await assert.rejects(exporter.start({format:'gif',quality:'original'},new WindowFixture().asWindow()),/数据目录之外/);
  assert.equal(exporter.busy,false); assert.equal(host.windows.length,0);
  assert.equal(await readFile(destination,'utf8'),'user data');
  await assert.rejects(readdir(scratch),{code:'ENOENT'});
});

test('GIF preview completes in owned scratch storage without opening a save dialog', async () => {
  const host = new HostFixture(), scratch = join(directory,'preview-export');
  setDialog(()=>{throw Error('Preview must not open a save dialog');});
  const exporter = new RecordingExport(host,scratch,{snapshot:()=>({project,video:'one-file://recording/current',audio:[]}),token:()=>'current',allowed:()=>true,changed:()=>{},protect:()=>{throw Error('Preview must not request an external destination');}});
  const pending = exporter.preview({format:'gif',quality:'original'},true);
  await until(()=>host.windows.length===1); const window = host.windows[0];
  const payload = host.call('recording-export-payload',window) as RecordingExportPayload;
  for (let i=0;i<payload.plan.frames;i++) await host.call('recording-export-frame',window,payload.id,i,new Uint8Array(payload.plan.width*payload.plan.height*4).fill(i?180:80));
  await host.call('recording-export-finish',window,payload.id);
  const result = await pending; assert.ok(result);
  assert.equal(result.complete,true); assert.equal(result.totalFrames,2);
  assert.equal(Buffer.from(result.bytes).toString('ascii',0,6),'GIF89a');
  assert.equal(exporter.busy,false); assert.deepEqual(await readdir(scratch),[]);
  assert.equal(window.destroyed,true);
});

test('cancelling while the save dialog is pending prevents a late encoder launch', async () => {
  const host = new HostFixture(); let choose!: (value:unknown)=>void;
  setDialog(()=>new Promise(resolve=>{choose=resolve;}));
  const exporter = new RecordingExport(host,join(directory,'late-dialog-export'),{snapshot:()=>({project,video:'one-file://recording/current',audio:[]}),token:()=>'current',allowed:()=>true,changed:()=>{},protect:()=>{throw Error('Cancelled export cannot write');}});
  const pending = exporter.start({format:'gif',quality:'original'},new WindowFixture().asWindow());
  await until(()=>!!choose); await exporter.reset();
  choose({canceled:false,filePath:join(directory,'late.gif')});
  assert.equal(await pending,null); assert.equal(host.windows.length,0); assert.equal(exporter.busy,false);
});

test('export cancellation and stale tokens retain destinations, reject late frames and permit retry', async () => {
  const host = new HostFixture(), scratch = join(directory,'cancelled-export'), destination = join(directory,'cancelled.gif');
  await mkdir(scratch); await writeFile(destination,'user data');
  let token = 'current'; setDialog(async()=>({canceled:false,filePath:destination}));
  const exporter = new RecordingExport(host,scratch,{snapshot:()=>({project,video:'one-file://recording/current',audio:[]}),token:()=>token,allowed:()=>true,changed:()=>{},protect:()=>{}});
  const id = await exporter.start({format:'gif',quality:'original'},new WindowFixture().asWindow()); assert.ok(id);
  await until(()=>host.windows.length===1); const window = host.windows[0]; token='replaced';
  assert.throws(()=>host.call('recording-export-payload',window),/失效/);
  await exporter.cancel(id); assert.equal(exporter.busy,false);
  assert.equal(await readFile(destination,'utf8'),'user data'); assert.deepEqual(await readdir(scratch),[]);
  assert.throws(()=>host.call('recording-export-frame',window,id,0,new Uint8Array()),/失效/);
  const retry = await exporter.start({format:'gif',quality:'original'},new WindowFixture().asWindow()); assert.ok(retry);
  await until(()=>host.windows.length===2); await exporter.reset(); assert.equal(exporter.state,undefined);
  assert.deepEqual(await readdir(scratch),[]); assert.equal(host.windows[1].destroyed,true);
});
