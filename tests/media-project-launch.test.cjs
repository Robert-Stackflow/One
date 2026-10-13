const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {buildSync}=require('esbuild');
const bundle=buildSync({entryPoints:['src/main/media-project-launch.ts'],bundle:true,platform:'node',format:'cjs',write:false});
const fixture={exports:{}};new Function('module','exports','require',bundle.outputFiles[0].text)(fixture,fixture.exports,require);
const {mediaProjectKind,mediaProjectLaunchPaths}=fixture.exports;

test('One project arguments preserve quoted Unicode paths, multiple files and the invoking working directory',()=>{
  const root=path.resolve('work/current/工程 参数'),image=path.join(root,'图片 一.ONEIMAGE'),recording=path.join(root,'录制 二.onerec');
  assert.deepEqual(mediaProjectLaunchPaths(['electron.exe','app-root',`"${image}"`,'--one-project=录制 二.onerec',image],root),[image,recording]);
  assert.equal(mediaProjectKind(image),'image');assert.equal(mediaProjectKind(recording),'recording');
  if(process.platform==='win32')assert.deepEqual(mediaProjectLaunchPaths([image,image.toLowerCase()],root),[image]);
});

test('Project launch excludes resource URLs, unrelated switches and old product formats',()=>{
  const root=path.resolve('work/current');
  assert.deepEqual(mediaProjectLaunchPaths([
    'one-file://materials/secret/item.oneimage','one://app/item.onerec','file:///tmp/image.oneimage',
    '--one-shell-request=folder/request.oneimage','--user-data-dir=folder/profile.onerec',
    'previous.frameimage','previous.framerec','ordinary.png','--one-project=',
  ],root),[]);
  assert.equal(mediaProjectKind('project.oneimage.bak'),undefined);
  assert.equal(mediaProjectKind('previous.framerec'),undefined);
});

test('The actual main preload retains early navigation until the renderer subscribes, once and in order',()=>{
  const {EventEmitter}=require('node:events'),ipcRenderer=new EventEmitter();let api;
  ipcRenderer.invoke=async()=>undefined;
  const code=buildSync({entryPoints:['src/preload/index.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['electron']});
  const preload={exports:{}};
  new Function('module','exports','require',code.outputFiles[0].text)(preload,preload.exports,name=>name==='electron'?{ipcRenderer,contextBridge:{exposeInMainWorld:(_name,value)=>{api=value;}},webUtils:{}}:require(name));
  const first={page:'recording'},second={page:'materials'},received=[];
  ipcRenderer.emit('one:navigate-page',{},first);ipcRenderer.emit('one:navigate-page',{},second);
  const unsubscribe=api.onNavigatePage(target=>received.push(target));assert.deepEqual(received,[first,second]);
  ipcRenderer.emit('one:navigate-page',{},first);assert.deepEqual(received,[first,second,first]);
  unsubscribe();ipcRenderer.emit('one:navigate-page',{},second);
  const resumed=[];api.onNavigatePage(target=>resumed.push(target));assert.deepEqual(resumed,[second]);
});
