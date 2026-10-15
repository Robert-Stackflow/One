const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const sharp=require('sharp');
const {spawn}=require('node:child_process'),{once}=require('node:events'),{createInterface}=require('node:readline'),buildFixture=require('./capture/build-scroll-fixture.cjs');
(async()=>{
  const base=path.resolve('work/current/capture-migration'),root=await fs.mkdtemp(path.join(base,'scroll-browser-'));let app,source,pointer,lines,control,web;
  try{
    const readerPath=path.join(root,'native-frame.cjs');
    await require('esbuild').build({entryPoints:['src/shared/capture/native-frame.ts'],outfile:readerPath,bundle:true,platform:'node',format:'cjs',logLevel:'warning'});
    const {NativeFrameReader}=require(readerPath);
    // Use an independent WGC reference. GDI showed a three-row raster offset
    // on this fractional-DPI browser fixture despite exact shifted overlap.
    const snapshot=rect=>new Promise((resolve,reject)=>{
      const child=spawn(path.resolve('dist/native/One.ScrollCapture.exe'),[rect.x,rect.y,rect.x+rect.width,rect.y+rect.height,process.pid].map(String),{windowsHide:true,stdio:'pipe'});
      let ready=false,header=Buffer.alloc(0);const reader=new NativeFrameReader(),timer=setTimeout(()=>finish(Error('Snapshot timed out')),10000);
      const finish=(error,png)=>{clearTimeout(timer);child.kill();error?reject(error):resolve(png);};
      child.once('error',finish);child.stdout.on('data',chunk=>{try{if(!ready){header=Buffer.concat([header,chunk]);const end=header.indexOf(10);if(end<0)return;assert.equal(JSON.parse(header.subarray(0,end)).ready,true);ready=true;chunk=header.subarray(end+1);child.stdin.write('frame\n');}if(chunk.length){reader.append(chunk);if(reader.complete){const frame=reader.finish();assert.equal(frame.info.backend,'wgc');finish(null,frame.png);}}}catch(error){finish(error);}});
    });
    const executable=await buildFixture(root);pointer=spawn(executable,['--input'],{windowsHide:true,stdio:'pipe'});lines=createInterface({input:pointer.stdout});await once(lines,'line');
    const input=async command=>{const done=once(lines,'line');pointer.stdin.write(command+'\n');await done;};
    const settledScroll=async()=>{let last=-1,stable=0;for(let i=0;i<60;i++){await new Promise(resolve=>setTimeout(resolve,50));const y=await web.evaluate(()=>scrollY);if(y===last)stable++;else stable=0;last=y;if(stable>=4)return y;}throw Error('Browser scrolling did not settle');};
    const fixture=path.join(root,'browser.cjs');
    await fs.writeFile(fixture,`const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{global.source=new BrowserWindow({x:90,y:70,width:920,height:700,frame:false,roundedCorners:false,thickFrame:false,alwaysOnTop:true,webPreferences:{backgroundThrottling:false}});source.setAlwaysOnTop(true,'screen-saver');source.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<style>html{scrollbar-width:none}body{margin:0;background:white;color:#222;font:15px/1.8 Microsoft YaHei,Arial}article{padding:20px 28px}p{margin:0 0 13px}h3{font-size:19px;margin:12px 0}</style><article>'+Array.from({length:120},(_,i)=>'<h3>第 '+i+' 节：OCR 与长截图工作台</h3><p>浏览器网页连续滚动测试。This is paragraph '+i+' with native browser text, punctuation, links and repeated backgrounds. 数字 '+(i*7919)+'；向下滚动追加内容，向上滚动保持已有结果。</p>').join('')+'</article>'));});`);
    const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:path.join(root,'one')};delete env.ELECTRON_RUN_AS_NODE;
    source=await electron.launch({args:[fixture],env});web=await source.firstWindow();await web.waitForFunction(()=>document.querySelectorAll('h3').length===120);
    const geometry=await source.evaluate(({screen})=>{const r=screen.dipToScreenRect(null,global.source.getContentBounds());return {x:r.x+8,y:r.y+8,width:r.width-16,height:r.height-16};});
    app=await electron.launch({args:[path.resolve('.')],env});const home=await app.firstWindow();await home.waitForFunction(()=>!!window.one?.captureScroll);
    await home.locator('.nav[data-page=capture]').click();await home.locator('#capture-modes').getByRole('tab',{name:'区域',exact:true}).click();await home.locator('#take-capture-menu').click();await home.locator('#take-capture-hide').click();
    let capture;await expect.poll(()=>{capture=app.windows().find(p=>p.url().endsWith('?view=capture'));return !!capture;}).toBe(true);await capture.waitForFunction(()=>document.body.dataset.captureReady==='true');
    const data=await capture.evaluate(()=>window.one.capture.data()),physical=await app.evaluate(({screen},geometry)=>{const d=screen.getDisplayNearestPoint(screen.screenToDipPoint(geometry));return screen.dipToScreenRect(null,d.bounds);},geometry);
    await capture.evaluate(({token,rect})=>{setTimeout(()=>void window.one.capture.startScroll(token,rect),20);},{token:data.token,rect:{x:geometry.x-physical.x,y:geometry.y-physical.y,width:geometry.width,height:geometry.height}});
    await expect.poll(async()=>{control=app.windows().find(p=>p.url().endsWith('?view=scroll-capture'));if(!control)return false;const h=await app.browserWindow(control);try{return await h.evaluate(w=>w.isVisible());}finally{await h.dispose();}},{timeout:10000}).toBe(true);
    await control.evaluate(async()=>{const api=window.one.scrollCapture,s=await api.state();await api.command(s.token,{kind:'pause'});await api.command(s.token,{kind:'restart',options:{...s.options,autoFixed:false}});});
    const button=await control.locator('#manual').boundingBox(),handle=await app.browserWindow(control),bounds=await handle.evaluate(w=>w.getContentBounds());await handle.dispose();const point=await app.evaluate(({screen},p)=>screen.dipToScreenPoint(p),{x:Math.round(bounds.x+button.x+button.width/2),y:Math.round(bounds.y+button.y+button.height/2)});const clicked=once(lines,'line');pointer.stdin.write('click '+point.x+' '+point.y+'\n');await clicked;
    await expect.poll(()=>control.evaluate(()=>window.one.scrollCapture.state().then(s=>s.count))).toBe(1);
    const sourceView=await web.evaluate(()=>({dpr:devicePixelRatio,height:innerHeight})),started=Date.now();
    await input('click '+Math.round(geometry.x+geometry.width/2)+' '+Math.round(geometry.y+geometry.height/2));
    const initialScroll=await web.evaluate(()=>scrollY),initialPng=await snapshot(geometry);
    for(let i=0;i<16;i++){await input('wheel -360');await new Promise(resolve=>setTimeout(resolve,20));}
    const first=await settledScroll(),expected=geometry.height+Math.round((first-initialScroll)*sourceView.dpr);
    await expect.poll(()=>control.evaluate(()=>window.one.scrollCapture.state().then(s=>s.match)),{timeout:5000}).toBe('unchanged');
    const forward=await control.evaluate(()=>window.one.scrollCapture.state());assert.ok(Math.abs(forward.height-expected)<=forward.count,'native raster height must stay within one pixel per exact join of CSS scroll distance');
    const forwardMs=Date.now()-started,before=await control.evaluate(()=>window.one.scrollCapture.state());
    for(let i=0;i<8;i++){await input('wheel 360');await new Promise(resolve=>setTimeout(resolve,20));}
    const reversed=await settledScroll();assert.ok(reversed<first);assert.equal((await control.evaluate(()=>window.one.scrollCapture.state())).height,before.height);
    for(let i=0;i<12;i++){await input('wheel -360');await new Promise(resolve=>setTimeout(resolve,20));}
    const last=await settledScroll();
    await expect.poll(()=>control.evaluate(()=>window.one.scrollCapture.state().then(s=>s.match)),{timeout:5000}).toBe('unchanged');
    const result=await control.evaluate(()=>window.one.scrollCapture.state());assert.equal(result.pending,false);assert.equal(result.phase,'running');
    const cssExpected=geometry.height+Math.round((last-initialScroll)*sourceView.dpr);assert.ok(Math.abs(result.height-cssExpected)<=result.count,'fractional CSS raster rounding stays bounded per exact join');
    const finalPng=await snapshot(geometry);await control.locator('#pause').click();assert.equal(await control.locator('#repair-toggle').count(),0);assert.equal(await control.locator('#repair').count(),0);const preview=control.locator('.scroll-preview');await preview.hover({position:{x:5,y:Math.floor((await preview.boundingBox()).height*.5)}});await expect(control.locator('#scroll-inspection')).toBeVisible();assert.equal(await control.locator('#inspection-image').evaluate(node=>node.naturalWidth),Math.min(1600,geometry.width));
    await control.locator('#setup-toggle').hover();await control.locator('#setup-toggle').click();assert.equal(await control.locator('#setup').evaluate(node=>getComputedStyle(node).animationName),'one-popup-in');
    await app.evaluate(({clipboard})=>{clipboard.write=async items=>{global.scrollCopied=Buffer.from(await(await items[0].getType('image/png')).arrayBuffer());};});
    await control.locator('#copy').click();await expect.poll(()=>control.isClosed()).toBe(true);
    const output=Buffer.from(await app.evaluate(()=>global.scrollCopied.toString('base64')),'base64');
    const [joined,head,tail]=await Promise.all([output,initialPng,finalPng].map(png=>sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true})));
    assert.equal(joined.info.width,geometry.width);assert.equal(joined.info.height,result.height);
    assert.ok(joined.data.subarray(0,head.data.length).equals(head.data),'initial native viewport must remain byte exact');
    const ending=joined.data.subarray(joined.data.length-tail.data.length);
    if(!ending.equals(tail.data)){
      let pixels=0,minX=geometry.width,maxX=0,minY=geometry.height,maxY=0;
      for(let at=0;at<ending.length;at+=4)if(!ending.subarray(at,at+4).equals(tail.data.subarray(at,at+4))){const x=at/4%geometry.width,y=Math.floor(at/4/geometry.width);pixels++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
      await fs.writeFile(path.resolve('work/current/capture-reconstruction/scroll-speed-browser-mismatch.json'),JSON.stringify({pixels,minX,maxX,minY,maxY,first,last,geometry,result:{height:result.height,count:result.count,match:result.match,metrics:result.metrics}}));
      await fs.writeFile(path.resolve('work/current/capture-reconstruction/browser-final-native.png'),finalPng);
      await sharp(ending,{raw:{width:geometry.width,height:geometry.height,channels:4}}).png().toFile(path.resolve('work/current/capture-reconstruction/browser-final-stitched.png'));
    }
    assert.ok(ending.equals(tail.data),'last native viewport must remain byte exact');
    console.log(JSON.stringify({nativeEndpointsExact:true,referenceBackend:'wgc',browserViewport:geometry,forwardCssPixels:first,forwardMs,resumedCssPixels:last,stitchedHeight:result.height,count:result.count,pending:result.pending,hoverInspection:true,sharedPopupAnimation:true}));
  }catch(error){if(control)console.error('Browser scroll state:',await control.evaluate(async()=>{const s=await window.one.scrollCapture.state();return {phase:s?.phase,count:s?.count,height:s?.height,match:s?.match,message:s?.message,metrics:s?.metrics};}).catch(()=>null));const records=[];for(const file of ['errors.jsonl','main.jsonl']){const body=await fs.readFile(path.join(root,'one/logs',file),'utf8').catch(()=>'');for(const line of body.split('\n')){try{const row=JSON.parse(line);if(/capture|renderer|quit|fatal/.test(row.event))records.push({event:row.event,detail:row.detail.slice(0,700)});}catch{}}}await fs.writeFile(path.resolve('work/current/capture-reconstruction/scroll-speed-browser-diagnostic.json'),JSON.stringify(records.slice(-20),null,2));console.error('Browser runtime:',records.slice(-5));throw error;}
  finally{if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});if(source)await source.close().catch(()=>{});if(app)await app.close().catch(()=>{});if(pointer&&pointer.exitCode===null){const ended=once(pointer,'close');pointer.stdin.write('quit\n');await ended;}lines?.close();const actual=await fs.realpath(root);assert.equal(path.dirname(actual),await fs.realpath(base));await fs.rm(actual,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
})().catch(error=>{console.error(error);process.exitCode=1;});
