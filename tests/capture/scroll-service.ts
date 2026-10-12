import test from 'node:test';
import assert from 'node:assert/strict';
import { ScrollCaptureService } from '../../src/main/capture/scroll-service';
import { displaySignature } from '../../src/shared/capture/region';
import { handlers, display, BrowserWindow, ScrollNative, frame } from './scroll-service-runtime';
import {ScrollCaptureHost} from '../../src/main/capture/scroll-host';
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate: () => boolean) {
  const started = performance.now();
  while (!predicate()) {
    if (performance.now() - started > 12000) throw Error('Session fixture timeout');
    await wait(20);
  }
}
async function fixture(remoteCompatible = true) {
  const workbench = new BrowserWindow(),
    failures: unknown[] = [],
    outputs: Buffer[] = [];
  const service = new ScrollCaptureService({
    createWindow:options=>new BrowserWindow(options) as any,register:(name,fn)=>{handlers.set('one:'+name,fn);},blocked:()=>false,uiScale:()=>100,
    remoteCompatible: () => remoteCompatible,
    choose: async () => ({
      displayId: display.id,
      sourceId: 'screen:1:0',
      signature: displaySignature(display),
      rect: { x: 0.1, y: 0.1, width: 96 / 1920, height: 160 / 1080 },
      pixels: { width: 96, height: 160 },
      screen: { width: 1920, height: 1080 },
    }),
    windows: () => [workbench] as any,
    edit: async (png) => {
      outputs.push(Buffer.from(png));
    },
    failed: (error) => {
      failures.push(error);
    },
  });
  await service.open(display.id);
  const control = service.window!,
    native = ScrollNative.current,
    event = {
      sender: control.webContents,
      senderFrame: control.webContents.mainFrame,
    };
  const state = () => handlers.get('one:scroll-state')!(event);
  const token = state().token;
  const command = (kind: string) => handlers.get('one:scroll-command')!(event, token, { kind });
  return { service, state, command, native, workbench, failures, outputs };
}
test('finishing during an in-flight automatic read stops scrolling and preserves only accepted pixels', async () => {
  const f = await fixture();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await f.command('sample');
    const first = frame();
    f.native.read = async () => {
      await held;
      return frame(f.native.offset);
    };
    await f.command('auto');
    await until(() => f.native.wheels === 1 && f.native.reads === 2);
    const finish = f.command('finish');
    release();
    const result = await finish;
    assert.equal(result.phase, 'review');
    assert.equal(result.count, 1);
    await f.command('edit');
    assert.deepEqual(f.outputs, [first]);
    assert.equal(f.native.wheels, 1);
    assert.equal(f.native.stopped, true);
    assert.equal(f.workbench.isVisible(), true);
    assert.deepEqual(f.failures, []);
  } finally {
    release();
    f.service.cancel();
  }
});

test('remote-compatible long capture hides an overlapping panel only while reading and restores it on failure', async () => {
  const f = await fixture();
  const window = f.service.window as unknown as BrowserWindow;
  window.bounds = { x: 192, y: 108, width: 96, height: 160 };
  try {
    assert.equal(window.protected, false);
    f.native.read = async () => {
      assert.equal(window.isVisible(), false, 'the control must not contaminate source pixels');
      return frame();
    };
    await f.command('sample');
    assert.equal(window.isVisible(), true);
    f.native.read = async () => {
      throw Error('fixture source failed');
    };
    await assert.rejects(() => f.command('sample'), /fixture source failed/);
    assert.equal(window.isVisible(), true);
    assert.equal(f.state().count, 1, 'failed capture preserves accepted content');
  } finally {
    f.service.cancel();
  }
  const local = await fixture(false);
  try {
    assert.equal((local.service.window as unknown as BrowserWindow).protected, true);
  } finally {
    local.service.cancel();
  }
});
test('losing focus while the page settles pauses without appending a partially observed frame', async () => {
  const f = await fixture();
  try {
    await f.command('sample');
    f.native.read = async () => {
      f.native.focus = false;
      return frame(f.native.offset);
    };
    await f.command('auto');
    await until(() => f.state().phase === 'paused');
    assert.match(f.state().message, /原窗口/);
    assert.equal(f.state().count, 1);
    assert.equal(f.native.wheels, 1);
    assert.equal(f.state().canEdit, true);
    await f.command('edit');
    assert.deepEqual(f.outputs, [frame()]);
    assert.deepEqual(f.failures, []);
  } finally {
    f.service.cancel();
  }
});
test('a continuously moving page stops at a bounded wait and leaves its previous result editable', async () => {
  const f = await fixture();
  try {
    await f.command('sample');
    f.native.read = async () => frame(++f.native.offset);
    await f.command('auto');
    await until(() => f.state().phase === 'paused');
    assert.match(f.state().message, /持续变化/);
    assert.equal(f.state().count, 1);
    assert.equal(f.state().canEdit, true);
    assert.equal(f.native.wheels, 1);
    await f.command('edit');
    assert.deepEqual(f.outputs, [frame()]);
    assert.deepEqual(f.failures, []);
  } finally {
    f.service.cancel();
  }
});
test('canceling a pending capture releases its session and an old response cannot alter a new session', async () => {
  const f = await fixture();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await f.command('sample');
    f.native.read = async () => {
      await held;
      return frame(39);
    };
    await f.command('auto');
    await until(() => f.native.reads === 2);
    await f.command('cancel');
    assert.equal(f.native.stopped, true);
    assert.equal(f.service.active, false);
    assert.equal(f.workbench.isVisible(), true);
    await f.service.open(display.id);
    const control = f.service.window!,
      event = { sender: control.webContents, senderFrame: control.webContents.mainFrame };
    const state = () => handlers.get('one:scroll-state')!(event);
    const token = state().token;
    release();
    await wait(180);
    assert.equal(state().token, token);
    assert.equal(state().phase, 'setup');
    assert.equal(state().count, 0);
    assert.deepEqual(f.failures, []);
  } finally {
    release();
    f.service.cancel();
  }
});

test('One quit preparation cancels an owned region selection before draining',async()=>{
  let selected:((value:null)=>void)|undefined,cancelled=0;
  const host=new ScrollCaptureHost({
    createWindow:options=>new BrowserWindow(options) as any,register:(name,fn)=>{handlers.set('one:'+name,fn);},blocked:()=>false,uiScale:()=>100,
    assertAvailable:()=>{},preferredDisplay:()=>display.id,windows:()=>[],edit:async()=>{},failed:()=>{},
    choose:()=>new Promise(resolve=>{selected=resolve;}),cancelSelection:()=>{cancelled++;selected?.(null);},
  });
  const opening=host.open();assert.ok(host.needsQuitPreparation);
  assert.equal(await host.prepareQuit(),true);await opening;assert.equal(cancelled,1);assert.equal(host.service.active,false);await host.stop();
});
test('One quit preparation waits for pending editor delivery before examining retained content',async()=>{
  let entered=false,delivered=false,release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  const host=new ScrollCaptureHost({
    createWindow:options=>new BrowserWindow(options) as any,register:(name,fn)=>{handlers.set('one:'+name,fn);},blocked:()=>false,uiScale:()=>100,
    assertAvailable:()=>{},preferredDisplay:()=>display.id,windows:()=>[],failed:()=>{},cancelSelection:()=>{},
    choose:async()=>({displayId:display.id,sourceId:'screen:1:0',signature:displaySignature(display),rect:{x:.1,y:.1,width:96/1920,height:160/1080},pixels:{width:96,height:160},screen:{width:1920,height:1080}}),
    edit:async()=>{entered=true;await held;delivered=true;},
  });
  try{
    await host.open();const control=host.service.window!,event={sender:control.webContents,senderFrame:control.webContents.mainFrame};
    const token=handlers.get('one:scroll-state')!(event).token;
    await handlers.get('one:scroll-command')!(event,token,{kind:'sample'});
    const output=handlers.get('one:scroll-command')!(event,token,{kind:'edit'});await until(()=>entered);
    let prepared=false;const quit=host.prepareQuit().then(answer=>{prepared=true;return answer;});await wait(30);assert.equal(prepared,false);assert.equal(delivered,false);
    release();await output;assert.equal(await quit,true);assert.equal(delivered,true);assert.equal(host.service.active,false);
  }finally{release();await host.stop();}
});
