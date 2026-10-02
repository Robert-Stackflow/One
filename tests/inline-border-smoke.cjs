const {_electron:electron,expect}=require('@playwright/test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),{loadImage,createCanvas}=require('@napi-rs/canvas');
async function verify(scale){
 const out=path.resolve('work/inline-border'),profile=await fs.mkdtemp(path.join(out,'profile-'));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const args=['--force-device-scale-factor='+scale,...(process.env.ONE_PACKAGED_EXE?[]:[path.resolve('.')])];
 const app=await electron.launch({...(process.env.ONE_PACKAGED_EXE?{executablePath:process.env.ONE_PACKAGED_EXE}:{}),args,env});
 let pid=0,exited=false;const child=app.process(),exit=new Promise(resolve=>child.once('exit',code=>{exited=true;resolve(code);}));
 try{
  pid=await app.evaluate(()=>process.pid);const main=await app.firstWindow();await main.waitForSelector('[data-page=text]');await main.locator('[data-page=text]').click();await main.waitForSelector('#source');
  await main.evaluate(async()=>{await window.one.patchSettings({appearance:{mode:'light'},search:{shortcut:'',roots:[],bookmarks:['C:\\Windows','C:\\Users'],explorerTyping:true}});await window.one.patchSettings({search:{explorerTyping:false}});});
  await expect.poll(()=>app.windows().some(p=>p.url().includes('embedded=1'))).toBe(true);
  const page=app.windows().find(p=>p.url().includes('embedded=1'));await page.waitForSelector('#file-query');
  await app.evaluate(({ipcMain},packagePath)=>{
   const require=process.getBuiltinModule('module').createRequire(packagePath),koffi=require('koffi'),user=koffi.load('user32.dll');
   const rect=koffi.struct('OneInlineBorderTestRect',{left:'int32',top:'int32',right:'int32',bottom:'int32'});
   const get=user.func('bool __stdcall GetClientRect(uintptr_t hwnd,_Out_ OneInlineBorderTestRect *rect)');
   process.__oneInlineClient=hwnd=>{const r={};if(!get(hwnd,r))throw Error('Invalid test window');return{width:r.right-r.left,height:r.bottom-r.top};};
   ipcMain.removeHandler('one:search-files');ipcMain.handle('one:search-files',()=>({items:[],total:0,elapsed:0}));
  },path.resolve('package.json'));
  const cases=[{name:'idle',height:50,rows:0},{name:'folders',height:142,rows:2},{name:'composition',height:142,rows:2},{name:'empty',height:90,rows:0}];
  const reports=[];
  for(const state of cases){
   await main.evaluate(async rows=>{await window.one.patchSettings({search:{bookmarks:rows?['C:\\Windows','C:\\Users']:[]}});},state.rows);
   await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('embedded=1'));w.webContents.send('one:search-reset');});
   await expect(page.locator('.search-result')).toHaveCount(state.rows);
   if(state.name==='composition')await page.evaluate(()=>{const input=document.querySelector('#file-query');input.dispatchEvent(new CompositionEvent('compositionstart'));input.value='等等';input.dispatchEvent(new InputEvent('input',{bubbles:true,data:'等等',isComposing:true}));});
   if(state.name==='empty'){await page.locator('#file-query').fill('no matching fixture');await expect(page.locator('.search-empty')).toBeVisible();}
   const native=await app.evaluate(({BrowserWindow},height)=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('embedded=1'));w.setBounds({x:500,y:400,width:540,height});return process.__oneInlineClient(Number(w.getNativeWindowHandle().readBigUInt64LE()));},state.height);
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const geometry=await page.evaluate(()=>{const shell=document.querySelector('.search-shell').getBoundingClientRect(),input=document.querySelector('.search-input-row').getBoundingClientRect(),list=document.querySelector('.search-results');return{dpr:devicePixelRatio,shell:shell.toJSON(),input:input.toJSON(),width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollHeight-innerHeight,listOverflow:list.scrollHeight-list.clientHeight};});
   assert.ok(geometry.shell.top>=2&&geometry.shell.left>=2);
   assert.ok(geometry.shell.bottom<=geometry.height-1&&geometry.shell.right<=geometry.width-1);
   assert.ok(geometry.shell.bottom*geometry.dpr<native.height,JSON.stringify({native,geometry}));
   assert.equal(geometry.overflow,0);assert.equal(geometry.listOverflow,0);
   assert.ok(geometry.input.bottom<geometry.shell.bottom,JSON.stringify(geometry));assert.ok(Math.abs(geometry.input.height-44)<1);
   const png=await page.screenshot({path:path.join(out,scale+'-'+state.name+'.png'),omitBackground:true}),image=await loadImage(png),canvas=createCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
   const x=Math.floor(image.width/2),bottom=Math.floor(geometry.shell.bottom*geometry.dpr);let painted=false;
   for(let y=Math.max(0,bottom-3);y<Math.min(image.height,bottom+1);y++){const [r,g,b,a]=ctx.getImageData(x,y,1,1).data;if(a>200&&r>=220&&r<=250&&Math.abs(r-g)<2&&Math.abs(r-b)<2)painted=true;}
   assert.ok(painted,'The bottom border must be painted inside the native client bounds');
   reports.push({state:state.name,nativeHeight:native.height,borderBottom:geometry.shell.bottom*geometry.dpr});
  }
  await app.evaluate(()=>{setTimeout(()=>process.getBuiltinModule('inspector').close(),20);});
  await main.evaluate(()=>setTimeout(()=>{void window.one.quit();},100));
  assert.equal(await Promise.race([exit,new Promise((_,reject)=>setTimeout(()=>reject(Error('Quit exceeded 30 seconds')),30000).unref())]),0);
  return{scale,reports};
 }finally{if(!exited){if(pid)try{process.kill(pid,'SIGKILL');}catch{}if(child.exitCode===null)child.kill('SIGKILL');}}
}
(async()=>{await fs.mkdir(path.resolve('work/inline-border'),{recursive:true});const reports=[];for(const scale of [1,1.25,1.5,2])reports.push(await verify(scale));console.log(JSON.stringify({result:'PASS',reports},null,2));})().catch(error=>{console.error(error);process.exitCode=1;});
