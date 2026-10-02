const {_electron:electron,expect}=require('@playwright/test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
async function run(){
 const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/color-editor-smoke'),profile=path.join(out,'profile');await fs.mkdir(profile,{recursive:true});
 await require('esbuild').build({entryPoints:['src/shared/settings.ts'],outfile:path.join(out,'settings.cjs'),bundle:true,platform:'node'});
 const settings=require(path.join(out,'settings.cjs')).defaultSettings();settings.search.roots=[];settings.colorHistory=['#F0F3F9','#123456'];settings.diskMonitor.enabled=false;await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify(settings));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;const app=await electron.launch({args:[path.resolve('.')],env}),errors=[],reports=[];
 const child=app.process();app.on('window',p=>p.on('pageerror',e=>errors.push(String(e))));
 try{
  const main=await app.firstWindow();await main.waitForSelector('[data-page=color]');
  await app.evaluate(({BrowserWindow,clipboard,dialog,screen})=>{
   global.colorErrors=[];process.on('uncaughtException',e=>global.colorErrors.push(e.stack));process.on('unhandledRejection',e=>global.colorErrors.push(String(e)));dialog.showErrorBox=(...v)=>global.colorErrors.push(v.join(' '));
   global.copiedColor='';clipboard.writeText=value=>{global.copiedColor=value;};
   BrowserWindow.prototype.focus=function(){};BrowserWindow.prototype.show=function(){this.showInactive();};for(const w of BrowserWindow.getAllWindows())w.setPosition(-10000,-10000);
   // Place the editor off screen before native bounds feedback, not after it.
   const nearest=screen.getDisplayNearestPoint,matching=screen.getDisplayMatching,offscreen=d=>({...d,workArea:{...d.workArea,x:-10000,y:-10000}});screen.getDisplayNearestPoint=point=>offscreen(nearest(point));screen.getDisplayMatching=b=>b.x<-5000?offscreen(matching(b)):matching(b);
   const threads=process.getBuiltinModule('worker_threads'),Original=threads.Worker,{EventEmitter}=process.getBuiltinModule('events');global.colorWorkers=[];
   // Exercise the complete sampling-to-editor lifecycle without hooking the user's mouse.
   threads.Worker=class extends EventEmitter{constructor(file,...args){super();if(!/color-(?:position-)?worker\.cjs$/.test(file))return new Original(file,...args);this.file=file;global.colorWorkers.push(this);}postMessage(value){if(value==='stop'){this.stopped=true;queueMicrotask(()=>this.emit('exit',0));}}terminate(){this.postMessage('stop');return Promise.resolve(0);}};
  });
  await main.locator('[data-page=color]').click();await expect(main.locator('#color-show-editor')).toBeChecked();
  const start=performance.now();await main.locator('#open-color-editor').click();await expect.poll(()=>app.windows().some(p=>p.url().includes('view=color-editor'))).toBe(true);const editor=app.windows().find(p=>p.url().includes('view=color-editor'));await editor.waitForSelector('#color-editor-hex');
  await expect(editor.locator('#color-editor-hex')).toHaveValue('#F0F3F9');await expect(editor.locator('[data-color-copy]')).toHaveCount(3);
  const win=await app.browserWindow(editor),id=await win.evaluate(w=>w.id);reports.push({firstOpenMs:performance.now()-start});
  const layout=()=>editor.evaluate(()=>({width:innerWidth,height:innerHeight,scroll:document.querySelector('.color-editor-scroll').scrollHeight-document.querySelector('.color-editor-scroll').clientHeight,bodyOverflow:document.body.scrollHeight-innerHeight,content:document.querySelector('.color-editor-content').getBoundingClientRect().height,header:document.querySelector('.color-editor-heading').getBoundingClientRect().height}));
  await expect.poll(async()=>(await layout()).scroll).toBeLessThanOrEqual(1);const initial=await layout();console.log(JSON.stringify({initial}));await editor.screenshot({path:path.join(out,'initial.png')});assert.ok(initial.height<440,JSON.stringify(initial));assert.ok(Math.abs(initial.width-420)<=2,JSON.stringify(initial));assert.ok(Math.abs(initial.height-initial.content-initial.header)<=2,JSON.stringify(initial));assert.ok(initial.bodyOverflow<=1,JSON.stringify(initial));
  const title=await editor.locator('.color-editor-heading h1').evaluate(e=>({text:e.textContent,center:e.getBoundingClientRect().left+e.getBoundingClientRect().width/2,width:innerWidth}));assert.equal(title.text,'取色结果');assert.ok(Math.abs(title.center-title.width/2)<=1);
  await editor.locator('[data-color-copy=rgb]').click();assert.equal(await app.evaluate(()=>global.copiedColor),'rgb(240, 243, 249)');
  const variants=await editor.locator('[data-color-variant]').count();assert.ok(variants>=4&&variants<=7);const shade=await editor.locator('[data-color-variant]').last().getAttribute('data-color-hex');await editor.locator('[data-color-variant]').last().click();await expect(editor.locator('#color-editor-hex')).toHaveValue(shade);assert.equal(await editor.locator('[data-color-variant]').count(),variants);
  await editor.locator('[data-color-history] button').first().focus();await editor.keyboard.press('ArrowRight');await expect(editor.locator('#color-editor-hex')).toHaveValue('#123456');
  await editor.locator('#color-editor-hex').fill('#abcd');await editor.keyboard.press('Enter');await expect(editor.locator('#color-editor-hex')).toHaveAttribute('aria-invalid','true');
  await editor.locator('#color-editor-hex').fill('#ABC123');await editor.keyboard.press('Enter');await expect.poll(()=>app.evaluate(()=>global.copiedColor)).toBe('#ABC123');await expect(main.locator('#color-edit')).toHaveValue('#ABC123');
  await expect(editor.locator('[data-color-history] button').first()).toHaveAttribute('data-color-hex','#ABC123');
  // All configured formats remain accessible, with one scroll container only when needed.
  const formats=['hex','rgb','hsl','hsv','cmyk','hsb','hsi','hwb','ncol','xyz','lab','oklab','oklch','vec4','decimal','hexInt'];
  await main.evaluate(formats=>window.one.patchSettings({colorVisibleFormats:formats}),formats);await editor.locator('[data-color-more]').click();await expect(editor.locator('[data-color-copy]')).toHaveCount(16);await editor.locator('[data-color-copy=hexInt]').scrollIntoViewIfNeeded();await editor.locator('[data-color-copy=hexInt]').click();assert.equal(await app.evaluate(()=>global.copiedColor),'0xFFABC123');
  const full=await layout();assert.ok(full.bodyOverflow<=1);assert.ok(full.height<=562&&full.scroll>0,JSON.stringify(full));reports.push({allFormats:full});
  await editor.locator('[data-color-more]').click();await expect(editor.locator('[data-color-copy]')).toHaveCount(3);await expect.poll(async()=>(await layout()).scroll).toBeLessThanOrEqual(1);
  for(const mode of ['light','dark'])for(const density of ['comfortable','compact']){
   await main.evaluate(value=>window.one.patchSettings({appearance:value}),{mode,density});await expect(editor.locator('html')).toHaveAttribute('data-theme',mode);await expect(editor.locator('html')).toHaveAttribute('data-density',density);await expect.poll(async()=>(await layout()).scroll).toBeLessThanOrEqual(1);
   const contrast=await editor.evaluate(()=>{const luminance=color=>color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255<=.04045?v/255/12.92:((v/255+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0),ratio=(a,b)=>(Math.max(a,b)+.05)/(Math.min(a,b)+.05),input=getComputedStyle(document.querySelector('#color-editor-hex')),value=getComputedStyle(document.querySelector('[data-color-copy] strong'));return {input:ratio(luminance(input.color),luminance(input.backgroundColor)),value:ratio(luminance(value.color),luminance(getComputedStyle(document.body).backgroundColor))};});assert.ok(contrast.input>=4.5&&contrast.value>=4.5,JSON.stringify(contrast));
   await editor.screenshot({path:path.join(out,mode+'-'+density+'.png')});reports.push({mode,density,contrast,layout:await layout()});
  }
  await editor.emulateMedia({reducedMotion:'reduce'});assert.equal(await editor.locator('[data-color-variant]').first().evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
  await editor.locator('[data-color-clear]').click();await expect(editor.locator('[data-color-recent]')).toBeHidden();await expect(main.locator('#color-recent')).toBeHidden();
  await editor.keyboard.press('Escape');await expect.poll(()=>win.evaluate(w=>w.isVisible())).toBe(false);
  const warm=performance.now();await main.locator('#open-color-editor').click();await expect.poll(()=>win.evaluate(w=>w.isVisible())).toBe(true);assert.equal(await win.evaluate(w=>w.id),id);reports.push({warmOpenMs:performance.now()-warm});
  // Fractional DPI may round by two DIP when moved off screen, but must never accumulate.
  const reopened=[];for(let count=0;count<10;count++){await editor.locator('#color-editor-close').click();await main.locator('#open-color-editor').click();await expect.poll(()=>win.evaluate(w=>w.isVisible())).toBe(true);const b=await layout();assert.ok(Math.abs(b.width-420)<=2,JSON.stringify(b));assert.ok(Math.abs(b.height-b.content-b.header)<=2,JSON.stringify(b));reopened.push({width:b.width,height:b.height});}reports.push({reopened});
  // Sampling cancellation restores the editor; confirmation opens the new color.
  await editor.locator('#color-editor-pick').click();await expect.poll(()=>win.evaluate(w=>w.isVisible())).toBe(false);await app.evaluate(()=>global.colorWorkers.filter(w=>w.file.endsWith('color-worker.cjs')).at(-1).emit('message',{cancel:true}));await expect.poll(()=>win.evaluate(w=>w.isVisible())).toBe(true);
  await editor.locator('#color-editor-pick').click();await app.evaluate(()=>global.colorWorkers.filter(w=>w.file.endsWith('color-worker.cjs')).at(-1).emit('message',{pick:'#345678'}));await expect(editor.locator('#color-editor-hex')).toHaveValue('#345678');await expect.poll(()=>win.evaluate(w=>w.isVisible())).toBe(true);assert.equal(await app.evaluate(()=>global.copiedColor),'#345678');
  await editor.locator('#color-editor-close').click();await main.evaluate(()=>window.one.patchSettings({colorShowEditor:false}));await main.locator('#start-color').click();await app.evaluate(()=>global.colorWorkers.filter(w=>w.file.endsWith('color-worker.cjs')).at(-1).emit('message',{pick:'#456789'}));await expect(main.locator('#color-edit')).toHaveValue('#456789');assert.equal(await win.evaluate(w=>w.isVisible()),false);
  await main.locator('#open-color-editor').click();await expect.poll(()=>win.evaluate(w=>w.isVisible())).toBe(true);assert.equal(await win.evaluate(w=>w.id),id);
  assert.deepEqual(errors,[]);assert.deepEqual(await app.evaluate(()=>global.colorErrors),[]);assert.ok(await app.evaluate(()=>global.colorWorkers.every(w=>w.stopped)));
  // Open editor must not prevent a natural shutdown or produce destroyed-object errors.
  const exit=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));await app.evaluate(()=>setTimeout(()=>process.getBuiltinModule('inspector').close(),20));await main.evaluate(()=>setTimeout(()=>{void window.one.quit();},100));const ended=await Promise.race([exit,new Promise((_,reject)=>setTimeout(()=>reject(Error('Editor shutdown timed out')),15000).unref())]);assert.deepEqual(ended,{code:0,signal:null});
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({result:'PASS',reports},null,2));console.log(JSON.stringify({result:'PASS',reports}));
 }finally{if(child.exitCode===null)await app.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
