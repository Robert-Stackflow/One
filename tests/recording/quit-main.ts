import {app,type BrowserWindow} from 'electron';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {RecordingHost} from '../../src/main/recording/host';
import type {RecordingContext,RecordingService} from '../../src/main/recording/service';

app.setPath('userData',join(process.env.ONE_RECORDING_TEST_DIRECTORY!,'profile'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check:()=>boolean){for(let i=0;i<100;i++){if(check())return;await tick();}throw Error('Quit coordinator did not settle');}
function fixture(){
  const handlers=new Map<string,(...args:any[])=>unknown>(),questions:{options:Electron.MessageBoxOptions;answer:(value:{response:number;checkboxChecked:boolean})=>void}[]=[],disposed:boolean[]=[],throttling:boolean[]=[];
  let dirty=true,active=true,page=true,busy=false,saveResult:string|null='saved.onerec',finishError:Error|undefined,saveError:Error|undefined,resolvePreview:(()=>void)|undefined;
  const window={isDestroyed:()=>false,webContents:{isDestroyed:()=>false,setBackgroundThrottling:(value:boolean)=>throttling.push(value)}} as unknown as BrowserWindow;
  let context:RecordingContext;
  const service={init:async()=>{},bindClient:()=>{},get active(){return active;},get hasUnsaved(){return dirty;},state:()=>({phase:active?'recording':'ready',export:busy?{busy:true}:undefined}),
    pageActive:async(value:boolean)=>{page=value;},finishCapture:async()=>{if(finishError)throw finishError;active=false;page=false;context.availabilityChanged?.();},
    saveCurrentProject:async()=>{if(saveError)throw saveError;if(saveResult)dirty=false;return saveResult;},
    cancelExport:async()=>{busy=false;resolvePreview?.();},dispose:async(discard:boolean)=>{assert.ok(discard||!dirty);disposed.push(discard);active=false;},
    importMaterial:async()=>{},openMaterial:async()=>{},removeMaterial:async()=>{},
  } as unknown as RecordingService;
  const host=new RecordingHost({directory:'unused',mainWindow:()=>window,openPage:()=>{},cancelRegion:()=>{},chooseRegion:async()=>null,blocked:()=>false,dark:()=>false,prepare:()=>{},protect:()=>{},copy:async()=>{},windows:()=>[],
    register:(name,handler)=>{handlers.set(name,handler);},windowHost:{createWindow:()=>{throw Error('No windows in coordinator tests');},register:(name,handler)=>{handlers.set(name,handler);}},
    confirm:(_owner,options)=>new Promise(resolve=>questions.push({options,answer:resolve})),
  },ctx=>{
    context=ctx;
    ctx.register('recording-page-active',(_event,value)=>service.pageActive(value));
    ctx.register('recording-arm',()=>true);ctx.register('recording-chunk',()=>true);ctx.register('recording-state',()=>service.state());
    ctx.windowHost.register('recording-player-edit',()=>true,['recording-player']);
    ctx.windowHost.register('recording-player-preview-gif',()=>{busy=true;return ctx.background(new Promise<void>(resolve=>{resolvePreview=resolve;}));},['recording-player']);
    return service;
  });
  host.bindClient(window);
  return {host,questions,disposed,throttling,invoke:(name:string,...args:any[])=>handlers.get(name)!({} as any,...args),get dirty(){return dirty;},set dirty(value:boolean){dirty=value;},get page(){return page;},get busy(){return busy;},set saveResult(value:string|null){saveResult=value;},set finishError(value:Error|undefined){finishError=value;},set saveError(value:Error|undefined){saveError=value;}};
}
async function run(){
  await app.whenReady();
  const f=fixture();await f.invoke('recording-page-active',true);
  const first=f.host.prepareQuit();assert.equal(f.host.prepareQuit(),first);await until(()=>f.questions.length===1);
  assert.throws(()=>f.invoke('recording-arm'),/准备退出/);assert.throws(()=>f.invoke('recording-player-edit'),/准备退出/);
  assert.equal(await f.invoke('recording-chunk'),true);assert.equal((await f.invoke('recording-state') as any).phase,'ready');
  f.questions[0].answer({response:2,checkboxChecked:false});assert.equal(await first,false);assert.equal(f.page,true);assert.equal(f.dirty,true);assert.equal(await f.invoke('recording-arm'),true);
  const second=f.host.prepareQuit();await until(()=>f.questions.length===2);f.questions[1].answer({response:1,checkboxChecked:false});assert.equal(await second,true);
  assert.equal(f.host.needsQuitPreparation,false);assert.deepEqual(f.disposed,[]);
  await f.host.resetQuitApproval();assert.equal(f.page,true);assert.equal(f.host.needsQuitPreparation,true);assert.equal(await f.invoke('recording-player-edit'),true);
  f.saveResult=null;const cancelled=f.host.prepareQuit();await until(()=>f.questions.length===3);f.questions[2].answer({response:0,checkboxChecked:false});assert.equal(await cancelled,false);assert.equal(f.dirty,true);
  f.saveResult='saved.onerec';const saved=f.host.prepareQuit();await until(()=>f.questions.length===4);f.questions[3].answer({response:0,checkboxChecked:false});assert.equal(await saved,true);
  const stopped=f.host.stop();assert.equal(f.host.stop(),stopped);await stopped;assert.deepEqual(f.disposed,[false]);assert.deepEqual(f.throttling,[false,true]);
  const discard=fixture(),discarded=discard.host.prepareQuit();await until(()=>discard.questions.length===1);discard.questions[0].answer({response:1,checkboxChecked:false});assert.equal(await discarded,true);await discard.host.stop();assert.deepEqual(discard.disposed,[true]);
  const preview=fixture();preview.dirty=false;const previewWork=preview.invoke('recording-player-preview-gif');await until(()=>preview.busy);
  const keepExport=preview.host.prepareQuit();await until(()=>preview.questions.length===1);preview.questions[0].answer({response:1,checkboxChecked:false});assert.equal(await keepExport,false);assert.equal(preview.busy,true);
  const cancelExport=preview.host.prepareQuit();await until(()=>preview.questions.length===2);preview.questions[1].answer({response:0,checkboxChecked:false});assert.equal(await cancelExport,true);await previewWork;assert.equal(preview.busy,false);await preview.host.stop();
  const failed=fixture();await failed.invoke('recording-page-active',true);failed.finishError=Error('Tail still pending');await assert.rejects(failed.host.prepareQuit(),/Tail still pending/);assert.equal(failed.page,true);assert.equal(await failed.invoke('recording-arm'),true);assert.deepEqual(failed.disposed,[]);
  failed.finishError=undefined;failed.saveError=Error('Disk full');const badSave=failed.host.prepareQuit();await until(()=>failed.questions.length===1);failed.questions[0].answer({response:0,checkboxChecked:false});await assert.rejects(badSave,/Disk full/);assert.equal(failed.page,true);assert.equal(failed.dirty,true);assert.deepEqual(failed.disposed,[]);
  console.log(JSON.stringify({result:'PASS',deduplicatedQuit:true,completionChannelsOpen:true,newMutationsBlocked:true,quitCancel:true,saveCancel:true,laterFeatureCancel:true,explicitDiscard:true,saveFailureRetained:true,tailFailureRetained:true,exportPreviewCancelAndResume:true}));
}
void run().then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});
