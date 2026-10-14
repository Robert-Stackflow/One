const {expect}=require('@playwright/test'),assert=require('node:assert/strict');
const tokens=doc=>doc.blocks.flatMap(block=>block.lines.flatMap(line=>line.tokens)).sort((a,b)=>a.order-b.order);
async function center(page,width,x,y){await page.locator('.text-image-viewport').evaluate((viewport,{width,x,y})=>{
  const stage=viewport.querySelector('.text-image-stage'),inner=viewport.querySelector('.text-image-inner'),scale=parseFloat(inner.style.width)/width,matrix=new DOMMatrix(getComputedStyle(inner).transform),point=matrix.transformPoint(new DOMPoint(x*scale,y*scale));
  viewport.scrollLeft=stage.offsetLeft+point.x-viewport.clientWidth/2;viewport.scrollTop=stage.offsetTop+point.y-viewport.clientHeight/2;
},{width,x,y});}
async function draw(page,width,region,reverse=false){
  await center(page,width,region.left+region.width/2,region.top+region.height/2);
  await page.locator('[data-text-action=area]').click();await expect(page.locator('[data-text-action=area]')).toHaveAttribute('aria-pressed','true');
  const points=await page.locator('.text-image-stage').evaluate((stage,{width,region})=>{
    const inner=stage.querySelector('.text-image-inner'),scale=parseFloat(inner.style.width)/width,matrix=new DOMMatrix(getComputedStyle(inner).transform),bounds=stage.getBoundingClientRect();
    return [[region.left,region.top],[region.left+region.width,region.top+region.height]].map(([x,y])=>{const point=matrix.transformPoint(new DOMPoint(x*scale,y*scale));return{x:bounds.left+point.x,y:bounds.top+point.y};});
  },{width,region});
  const [a,b]=reverse?points.reverse():points;await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:6});await expect(page.locator('.text-recognition-rectangle')).toBeVisible();await page.mouse.up();
  await expect(page.locator('[data-text-action=area]')).toHaveAttribute('aria-pressed','false');return points;
}
module.exports=async function areaWindow({app,page,inline=false,id,baseline,long=false,cancelWorker=true,device}){
  const original=page.locator(inline?'.inline-ocr-original':'#result'),loading=page.locator(inline?'.inline-ocr-loading':'#image-loading'),channel=inline?'one:inline-ocr-region':'one:recognition-region';
  const state=inline?{width:baseline.width,height:baseline.height}:await page.evaluate(()=>window.one.recognition.state());
  await app.evaluate(({ipcMain},channel)=>{global.areaResults=[];global.areaErrors=[];const old=ipcMain._invokeHandlers.get(channel);ipcMain.removeHandler(channel);ipcMain.handle(channel,async(event,...args)=>{try{const result=await old(event,...args);global.areaResults.push({selection:args[2],result});return result;}catch(error){global.areaErrors.push(String(error));throw error;}});},channel);
  const areaButton=page.locator('[data-text-action=area]');await areaButton.click();await page.keyboard.press('Escape');await expect(areaButton).toHaveAttribute('aria-pressed','false');assert.equal(await app.evaluate(()=>global.areaResults.length),0);
  await page.locator('[data-text-action=fit]').click();if(long)for(let step=0;step<4;step++)await page.locator('[data-text-action=zoom-in]').click();
  await areaButton.click();const bounds=await page.locator('.text-image-viewport').boundingBox(),point={x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};await page.mouse.click(point.x,point.y);await expect(areaButton).toHaveAttribute('aria-pressed','true');assert.equal(await app.evaluate(()=>global.areaResults.length),0);
  const panBefore=await page.locator('.text-image-viewport').evaluate(node=>node.scrollLeft);await page.keyboard.down('Space');await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+12,point.y);await page.mouse.up();await page.keyboard.up('Space');assert.notEqual(await page.locator('.text-image-viewport').evaluate(node=>node.scrollLeft),panBefore);await expect(areaButton).toHaveAttribute('aria-pressed','true');await page.keyboard.press('Escape');
  let initial=baseline;
  if(!inline){
    const region={left:15,top:80,width:600,height:105};await draw(page,state.width,region);
    await expect.poll(()=>app.evaluate(()=>global.areaResults.length),{timeout:60000}).toBe(1);await expect(loading).toBeHidden();
    const first=await app.evaluate(()=>global.areaResults[0]);assert.match(first.result.text,/ONE OCR 2026/);assert.doesNotMatch(first.result.text,/KEEP THIS LINE/);initial=first.result;
    if(device!==undefined){assert.equal(initial.inference.backend,'dml');assert.match(initial.inference.device,device===0?/NVIDIA/:/AMD/);assert.equal(initial.inference.fallbackReason,undefined);}
    for(const key of ['left','top','width','height'])assert.ok(Math.abs(first.selection.region[key]-region[key])<=2,key+' source coordinate');
    assert.equal(initial.document.source.width,state.width);assert.equal(initial.document.source.height,state.height);
    await page.locator('[data-text-action=rotate]').click();const last=long?8600:310,bottom={left:15,top:last-70,width:600,height:100};
    await draw(page,state.width,bottom,true);await expect.poll(()=>app.evaluate(()=>global.areaResults.length),{timeout:60000}).toBe(2);await expect(loading).toBeHidden();
    const added=await app.evaluate(()=>global.areaResults[1].result);assert.match(added.text,/ONE OCR 2026[\s\S]*KEEP THIS LINE/);assert.equal(added.document.source.sha256,initial.document.source.sha256);
    for(const token of tokens(initial.document)){const next=tokens(added.document).find(value=>value.id===token.id);assert(next);assert.deepEqual(next.quad,token.quad);assert.equal(next.text,token.text);}
    if(long)assert.ok(added.words.some(word=>word.y>8000));initial=added;
  }
  const old=tokens(initial.document),head=old[0],word=old.filter(token=>token.wordId===head.wordId&&token.lineId===head.lineId),quads=word.flatMap(token=>token.sourceQuads||[token.quad]);
  const xs=quads.flatMap(quad=>quad.map(point=>point.x)),ys=quads.flatMap(quad=>quad.map(point=>point.y)),region={left:Math.max(0,Math.floor(Math.min(...xs)-1)),top:Math.max(0,Math.floor(Math.min(...ys)-1)),width:Math.ceil(Math.max(...xs)-Math.min(...xs)+2),height:Math.ceil(Math.max(...ys)-Math.min(...ys)+2)};
  const count=await app.evaluate(()=>global.areaResults.length);await draw(page,state.width,region,true);await expect.poll(()=>app.evaluate(()=>global.areaResults.length),{timeout:60000}).toBe(count+1);await expect(loading).toBeHidden();
  const mergeRecord=await app.evaluate(()=>global.areaResults.at(-1)),merged=mergeRecord.result,requested=mergeRecord.selection.region;
  const touched=new Set(old.filter(token=>(token.sourceQuads||[token.quad]).some(quad=>{const xs=quad.map(point=>point.x),ys=quad.map(point=>point.y);return Math.min(...xs)<requested.left+requested.width&&Math.max(...xs)>requested.left&&Math.min(...ys)<requested.top+requested.height&&Math.max(...ys)>requested.top;})).map(token=>token.lineId+'\0'+token.wordId));
  for(const token of old.filter(token=>!touched.has(token.lineId+'\0'+token.wordId))){const next=tokens(merged.document).find(value=>value.id===token.id);if(!next)console.log('Untouched area evidence',JSON.stringify({text:token.text,id:token.id,quad:token.quad,requested,core:merged.document.revisions.at(-1).region}));assert(next);assert.deepEqual(next.quad,token.quad);assert.equal(next.text,token.text);}
  assert.equal(merged.document.revision,initial.document.revision+1);assert.equal(merged.document.revisions.at(-1).kind,'rectangle');
  for(const token of tokens(merged.document))assert.equal(merged.text.slice(token.sourceStart,token.sourceEnd),token.text);
  await assert.rejects(page.evaluate(({inline,id,selection})=>inline?window.one.inlineOCR.region(id,'eng',selection):window.one.recognition.region(id,'eng',selection),{inline,id,selection:{revision:initial.document.revision,region}}),/已改变/);
  const errorCount=await app.evaluate(()=>global.areaErrors.length),blank={left:state.width-70,top:state.height-80,width:60,height:60};await draw(page,state.width,blank);
  await expect.poll(()=>app.evaluate(()=>global.areaErrors.length),{timeout:60000}).toBe(errorCount+1);await expect(loading).toBeHidden();await expect(original).toHaveValue(merged.text);
  if(cancelWorker){const workerCount=await app.evaluate(()=>global.regionWorkers?.length??global.inlineWorkers?.length??0);await draw(page,state.width,region);
    await expect.poll(()=>app.evaluate((_electron,count)=>{const workers=global.regionWorkers||global.inlineWorkers;return workers.length>count&&workers.at(-1).active;},workerCount)).toBe(true);
    await page.locator(inline?'.inline-ocr-cancel':'#overlay-cancel').click();await expect(loading).toBeHidden();assert.equal(await app.evaluate(()=>(global.regionWorkers||global.inlineWorkers).at(-1).active),false);await expect(original).toHaveValue(merged.text);}
  const retryCount=await app.evaluate(()=>global.areaResults.length);await draw(page,state.width,region);await expect.poll(()=>app.evaluate(()=>global.areaResults.length),{timeout:60000}).toBe(retryCount+1);await expect(loading).toBeHidden();
  await page.locator('.text-image-viewport').focus();await page.keyboard.press('Control+a');await page.keyboard.press('Control+c');assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),await original.inputValue());
  assert.equal(await original.evaluate(node=>node.value.slice(node.selectionStart,node.selectionEnd)),await original.inputValue());
  await original.fill('manually edited source');await expect(areaButton).toBeDisabled();await expect(original).toHaveValue('manually edited source');
  console.log((inline?'Inline':'Standalone')+' rectangle OCR: first region/missed-area insertion, original coordinates, rotated/reversed drag, untouched tokens, stale/empty rejection, '+(cancelWorker?'actual worker cancel/retry, ':'')+'full copy'+(device===undefined?'':' and DirectML device '+device)+' passed');
};
