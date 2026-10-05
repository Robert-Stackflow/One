const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);

test('a process launched with a document path is reported separately from an open handle',async()=>{
 const out=path.resolve(process.env.ONE_UNIT_OUTPUT_DIR||'work','locksmith-commandline-tests');
 await fs.mkdir(out,{recursive:true});
 const target=path.join(out,'editor document.mdx');
 await fs.writeFile(target,'fixture');
 const helper=path.resolve('dist/native/One.Native.exe');
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)',target],{windowsHide:true,stdio:'ignore'});
 try{
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  let entry;
  for(let i=0;i<10&&!entry;i++){
   const {stdout}=await run(helper,['snapshot'],{windowsHide:true,maxBuffer:16*1024*1024});
   entry=JSON.parse(stdout).processes.find(process=>process.pid===child.pid);
   if(!entry)await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(entry,'child process appears in handle snapshot');
  const {stdout}=await run(helper,['inspect',String(child.pid),entry.handles.slice(0,1200).join(','),target],{windowsHide:true,maxBuffer:16*1024*1024});
  const result=JSON.parse(stdout);
  assert.deepEqual(result.references,[target]);
  assert.deepEqual(result.files,[]);
  assert.equal(result.denied,false);
 }finally{child.kill();}
});

test('a held file remains a confirmed file match',async()=>{
 const out=path.resolve(process.env.ONE_UNIT_OUTPUT_DIR||'work','locksmith-commandline-tests');
 await fs.mkdir(out,{recursive:true});
 const target=path.join(out,'held document.mdx');
 await fs.writeFile(target,'fixture');
 const helper=path.resolve('dist/native/One.Native.exe');
 const child=spawn(process.execPath,['-e',"require('node:fs').openSync(process.argv[1],'r');setInterval(()=>{},1000)",target],{windowsHide:true,stdio:'ignore'});
 try{
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  let result;
  for(let i=0;i<10;i++){
   const snapshot=JSON.parse((await run(helper,['snapshot'],{windowsHide:true,maxBuffer:16*1024*1024})).stdout);
   const entry=snapshot.processes.find(process=>process.pid===child.pid);
   if(entry){result=JSON.parse((await run(helper,['inspect',String(child.pid),entry.handles.slice(0,1200).join(','),target],{windowsHide:true,maxBuffer:16*1024*1024})).stdout);if(result.files.length)break;}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(result?.files.some(file=>file.toLowerCase()===target.toLowerCase()));
 }finally{child.kill();}
});

test('an editor window title is a non-destructive clue when no file handle remains',async()=>{
 const out=path.resolve(process.env.ONE_UNIT_OUTPUT_DIR||'work','locksmith-commandline-tests');
 await fs.mkdir(out,{recursive:true});
 const target=path.join(out,'window document.mdx'),title='window document - Test Editor';
 await fs.writeFile(target,'fixture');
 const script=path.join(out,'window-fixture.cjs');
 await fs.writeFile(script,`const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const window=new BrowserWindow({x:-30000,y:-30000,width:300,height:200,show:false});window.showInactive();window.setTitle(${JSON.stringify(title)});process.stdout.write('ready\\n');});app.on('window-all-closed',()=>app.quit());`);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(require('electron'),[script],{windowsHide:true,env,stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Editor fixture did not open')),15000);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);reject(new Error('Editor fixture exited: '+code));});});
  const helper=path.resolve('dist/native/One.Native.exe');
  const snapshot=JSON.parse((await run(helper,['snapshot'],{windowsHide:true,maxBuffer:16*1024*1024})).stdout);
  const entry=snapshot.processes.find(process=>process.pid===child.pid);
  assert.ok(entry,'editor process appears in snapshot');
  let result;
  for(let attempt=0;attempt<20;attempt++){
   result=JSON.parse((await run(helper,['inspect',String(child.pid),entry.handles.slice(0,1200).join(','),target],{windowsHide:true,maxBuffer:16*1024*1024})).stdout);
   if(result.windows.length)break;
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.deepEqual(result.windows,[title]);
  assert.deepEqual(result.files,[]);
  assert.deepEqual(result.references,[]);
 }finally{child.kill();}
});
