const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {buildSync}=require('esbuild');
const display={id:1,bounds:{x:0,y:0,width:1280,height:720},scaleFactor:1};
const output=buildSync({stdin:{contents:"export {CaptureService,CAPTURE_URL} from './src/main/capture/service';export {defaultWorkflows} from './src/shared/capture/capture-workflow';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,external:['electron','koffi','./native']});
const fixture={exports:{}};
new Function('module','exports','require','__dirname',output.outputFiles[0].text)(fixture,fixture.exports,name=>name==='electron'?{screen:{getAllDisplays:()=>[display],dipToScreenPoint:point=>point}}:name==='./native'?{alignCaptureWindow:()=>true,nativeMonitorBounds:()=>display.bounds}:require(name),process.cwd());
const {CaptureService,CAPTURE_URL,defaultWorkflows}=fixture.exports;
const snapshot={size:{width:1280,height:720},displayId:1,sourceId:'fixture',signature:'fixture',name:'fixture',png:Buffer.alloc(24),capturedAt:1};
function setup(){
  const handlers=new Map(),windows=[];
  let neverLoads=false,readyFailure='';
  const host={register:(name,handler)=>handlers.set(name,handler),blocked:()=>false,uiScale:()=>100,watermark:()=>({}),workflows:()=>({workflows:defaultWorkflows(),workflowId:defaultWorkflows()[0].id}),failed:()=>{}};
  const service=new CaptureService(host);
  service.prepare=()=>{
    if(service.warm)return;
    const overlay=new EventEmitter();
    Object.assign(overlay,{dead:false,visible:false,raised:0,isDestroyed(){return this.dead;},isVisible(){return this.visible;},getNativeWindowHandle(){const handle=Buffer.alloc(8);handle.writeBigUInt64LE(1n);return handle;},setBounds(bounds){this.bounds=bounds;},setContentProtection(){},show(){this.visible=true;},focus(){},moveTop(){this.raised++;},destroy(){this.dead=true;this.emit('closed');}});
    overlay.webContents=new EventEmitter();
    overlay.webContents.mainFrame={url:CAPTURE_URL};
    overlay.webContents.capturePage=async()=>({isEmpty:()=>false});
    const warm={overlay,loaded:neverLoads?new Promise(()=>{}):Promise.resolve(),probe:{close(){}},provide(data){if(neverLoads)return;queueMicrotask(()=>{void handlers.get('capture-ready')({sender:overlay.webContents,senderFrame:overlay.webContents.mainFrame},data.token,readyFailure);});}};
    overlay.once('closed',()=>{if(service.warm===warm)service.warm=undefined;});
    service.warm=warm;windows.push(overlay);
  };
  const start=()=>service.start(1,[],'capture',false,async()=>snapshot);
  return {service,start,windows,setNeverLoads(value){neverLoads=value;if(!value&&service.warm)service.warm.loaded=Promise.resolve();},setReadyFailure(value){readyFailure=value;}};
}
test('a burst of capture requests keeps one pending/visible session without an error or a queued capture',async()=>{
  const {service,start,windows}=setup();
  const first=start();
  const repeated=await Promise.all(Array.from({length:30},()=>service.take('region',1,[])));
  assert.deepEqual(repeated,Array(30).fill(null));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(windows.length,1);assert.equal(windows[0].visible,true);assert.equal(service.active,true);
  const token=service.run.token;
  assert.equal(await service.take('copy',1,[]),null);assert.equal(service.run.token,token);assert.equal(windows[0].raised,1);
  service.run.finish(null);await first;
  assert.equal(service.active,false);assert.equal(windows[0].dead,true);
});
test('a failed first paint releases the session and the next capture can start',async()=>{
  const fixture=setup();fixture.setReadyFailure('fixture paint failure');
  await assert.rejects(fixture.start(),/fixture paint failure/);
  assert.equal(fixture.service.active,false);assert.equal(fixture.windows[0].dead,true);
  fixture.setReadyFailure('');const next=fixture.start();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(fixture.service.active,true);fixture.service.run.finish(null);await next;
  assert.equal(fixture.service.active,false);
});
test('a renderer that never loads times out, cleans up and permits a retry',{timeout:10000},async()=>{
  const fixture=setup();fixture.setNeverLoads(true);
  await assert.rejects(fixture.start(),/首帧绘制超时/);
  assert.equal(fixture.service.active,false);assert.equal(fixture.windows[0].dead,true);
  fixture.setNeverLoads(false);const next=fixture.start();await new Promise(resolve=>setImmediate(resolve));
  fixture.service.run.finish(null);await next;assert.equal(fixture.service.active,false);
});
