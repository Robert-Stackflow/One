const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),vm=require('node:vm');
const {spawnSync}=require('node:child_process');
test('Windows One project association lifecycle uses an isolated registry branch',()=>{
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('tests/media-associations.ps1'),'-Source',path.resolve('src/main/media-associations.ps1')],{encoding:'utf8',windowsHide:true,maxBuffer:65536});
  assert.equal(result.status,0,result.stderr);const state=JSON.parse(result.stdout.replace(/^\uFEFF/,'').trim());assert.equal(state.result,'PASS');assert.ok(state.checks>=25);assert.equal(state.productRegistryUnchanged,true);
});
test('The installer verifies registration with quoted arguments and keeps verification identities isolated',async()=>{
  const source=fs.readFileSync('installer/main.cjs','utf8'),start=source.indexOf('async function mediaAssociation('),end=source.indexOf('\nfunction registeredDirectory',start),calls=[];
  const context={info:{product:'One'},path:path.win32,fs:{existsSync:()=>true},execute:async(file,args,options)=>{calls.push({file,args,options});return {stdout:'{"registered":true}'};}};
  vm.createContext(context);vm.runInContext(source.slice(start,end)+';this.invoke=mediaAssociation;',context);
  assert.equal(await context.invoke('D:\\安装目录 with spaces','register'),true);
  const call=calls[0];assert.equal(call.file,'powershell.exe');assert.ok(call.args.includes('D:\\安装目录 with spaces\\One.exe'));assert.equal(call.options.windowsHide,true);
  context.execute=async()=>({stdout:'{"registered":false}'});await assert.rejects(context.invoke('D:\\One','register'),/恢复失败/);
  assert.equal(await context.invoke('D:\\One','status'),false);
  context.fs.existsSync=()=>false;assert.equal(await context.invoke('D:\\旧版','status'),false);await assert.rejects(context.invoke('D:\\旧版','register'),/缺少/);
  context.info.product='OneVerification';assert.equal(await context.invoke('D:\\验证','register'),false);assert.equal(calls.length,1);
});
for(const scenario of [
  {name:'successful move',previous:'D:\\旧目录',wanted:true,fail:false},
  {name:'failed move restores the previous association',previous:'D:\\旧目录',wanted:true,fail:true},
  {name:'failed same-directory update restores the previous association',previous:'D:\\新目录',wanted:true,fail:true},
  {name:'failed update of a version without project associations leaves them absent',previous:'D:\\旧目录',wanted:false,fail:true},
  {name:'failed first install removes newly created associations',previous:null,wanted:false,fail:true},
])test('Installer transaction: '+scenario.name,async()=>{
  const source=fs.readFileSync('installer/main.cjs','utf8'),start=source.indexOf('async function install(directory)'),end=source.indexOf('\napp.whenReady()',start),target='D:\\新目录',events=[],operations=[];
  let owner=scenario.wanted?scenario.previous:null,engineRan=false,restored=false;
  const context={installing:false,installedDirectory:'',process:{env:{}},app:{isPackaged:false},path:path.win32,os:{arch:()=> 'x64'},crypto:require('node:crypto'),info:{product:'One',version:'1.0.0',engineHash:'engine',engineBytes:1,asarHash:'asar'},payload:'fixture',console:{error:()=>{}},send:value=>events.push(value),validDirectory:()=>true,runningOne:async()=>[],registry:async()=>scenario.previous?{}:null,newerThan:()=>false,registeredDirectory:()=>scenario.previous,archiveAssociationWanted:async()=>false,
    mediaAssociation:async(directory,operation)=>{operations.push([directory,operation]);if(operation==='register')owner=directory;if(operation==='remove'&&owner===directory)owner=null;return operation==='status'&&engineRan&&scenario.fail?false:owner===directory;},
    backupPrevious:async previous=>({previous}),removePrevious:async()=>{},restorePrevious:async()=>{restored=true;},registerArchiveAssociation:async()=>assert.fail('Archive association should remain independent'),
    execute:async()=>({stdout:String(1024**4)}),checkedCopy:async()=>{},run:async()=>{engineRan=true;owner=target;return 0;},hash:async()=> 'asar',fs:{existsSync:()=>true},fsp:{mkdir:async()=>{},rm:async()=>{}}};
  vm.createContext(context);vm.runInContext(source.slice(start,end)+';this.invoke=install;',context);await context.invoke(target);
  const result=events.at(-1);assert.equal(result.stage,scenario.fail?'failed':'done');assert.equal(context.installing,false);
  if(scenario.fail){assert.equal(owner,scenario.wanted?scenario.previous:null);assert.equal(restored,!!scenario.previous);assert.ok(operations.some(([directory,operation])=>directory===target&&operation==='remove'));}
  else{assert.equal(owner,target);assert.equal(context.installedDirectory,target);assert.equal(restored,false);assert.ok(!operations.some(([,operation])=>operation==='remove'));}
});
