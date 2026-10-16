const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),sharp=require('sharp');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
(async()=>{
 const parent=path.resolve('work/current');await fs.mkdir(parent,{recursive:true});const directory=await fs.mkdtemp(path.join(parent,'collections-layout-'));
 const profile=path.join(directory,'profile'),files=path.join(directory,'files');await fs.mkdir(files);let app;const errors=[];
 try{
  const names=['01 项目概览','02 运行日志','03 很长的素材名称用于验证卡片标题截断而不是挤压右侧勾选位置','04 交互设计'];
  for(let i=0;i<names.length;i++){
   const lines=Array.from({length:5},(_,n)=>`<rect x="34" y="${105+n*42}" width="${n%2?330:480}" height="10" rx="5" fill="#d5d7d6"/>`).join('');
   const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#f9faf9"/><rect width="640" height="56" fill="${['#d9e9e1','#e8e1d7','#dde2e9','#e8dfe5'][i]}"/><circle cx="26" cy="28" r="7" fill="#668e81"/>${lines}<rect x="34" y="338" width="130" height="30" rx="8" fill="#668e81"/></svg>`;
   await sharp(Buffer.from(svg)).png().toFile(path.join(files,names[i]+'.png'));
  }
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,TEMP:directory,TMP:directory};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({args:[path.resolve('.')],env});app.on('window',p=>p.on('pageerror',e=>errors.push(e.message)));const main=await app.firstWindow();
  await main.waitForSelector('.nav[data-page=materials]');await app.evaluate(({BrowserWindow,dialog},folder)=>{BrowserWindow.getAllWindows()[0].setSize(1200,900);dialog.showOpenDialog=async()=>({canceled:false,filePaths:process.getBuiltinModule('fs').readdirSync(folder).map(name=>process.getBuiltinModule('path').join(folder,name))});},files);
  await main.locator('.nav[data-page=materials]').click();await main.getByRole('button',{name:'导入图片',exact:true}).click();
  const cards=main.locator('#material-results .asset-card');await expect(cards).toHaveCount(4);await main.locator('#page-materials [data-collection-toggle]').click();
  await cards.nth(0).locator('.asset-preview').click();await cards.nth(2).locator('.asset-preview').click({modifiers:['Shift']});await expect(main.locator('#page-materials .collection-selected-count')).toHaveText('已选 3 项');
  assert.equal(app.windows().filter(p=>p.url().includes('view=image-editor')).length,0);
  await main.locator('[data-material-select]').first().focus();await main.keyboard.press('Control+A');await expect(main.locator('[data-material-select]:checked')).toHaveCount(4);
  await main.keyboard.press('Escape');await expect(main.locator('#page-materials [data-collection-toggle]')).toHaveAttribute('aria-pressed','false');await expect(main.locator('[data-material-select]:checked')).toHaveCount(0);
  await main.locator('[data-material-select]').first().check();await cards.first().evaluate(card=>{window.materialCardBefore=card;window.materialPreviewBefore=card.querySelector('img');});await main.locator('[data-material-select]').nth(1).check();
  assert.equal(await cards.first().evaluate(card=>card===window.materialCardBefore&&card.querySelector('img')===window.materialPreviewBefore),true);
  await expect(cards.first()).toHaveClass(/is-selected/);await expect(cards.first().locator('.collection-check>span')).toHaveCSS('border-radius','50%');
  await main.evaluate(async()=>{await new Promise(requestAnimationFrame);await Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{})));});
  const commonActions=await cards.first().locator('.collection-card-actions').evaluate(node=>({order:[...node.children].map(child=>child.className),buttons:[...node.querySelectorAll(':scope>button')].map(button=>({label:button.getAttribute('aria-label'),width:button.getBoundingClientRect().width,height:button.getBoundingClientRect().height}))}));
  await sharp(await main.screenshot()).resize({width:1200,height:1000,fit:'inside',withoutEnlargement:true}).png().toFile(path.join(parent,'collections-layout-materials.png'));
  await main.locator('#material-search').fill('01');await expect(cards).toHaveCount(1);await expect(main.locator('[data-material-select]:checked')).toHaveCount(0);await main.locator('#material-search').press('Control+A');assert.equal(await main.locator('[data-material-select]:checked').count(),0);await main.locator('#material-search').fill('');
  await main.evaluate(async()=>{for(const item of (await window.one.materialsState()).images.slice(0,3))await window.one.pinsOpenMaterial(item.id);await window.one.pinsFiles();await window.one.pinsGroup(null,{kind:'hide'});});await main.locator('.nav[data-page=pins]').click();const pins=main.locator('#page-pins .pin-card');await expect(pins).toHaveCount(4);
  await pins.first().locator('.pin-card-preview').click();await pins.nth(2).locator('.pin-card-preview').click({modifiers:['Shift']});await expect(main.locator('#page-pins .collection-selected-count')).toHaveText('已选 3 项');
  await pins.first().evaluate(card=>{window.pinCardBefore=card;window.pinPreviewBefore=card.querySelector('img');});await pins.last().locator('[data-select-pin]').check();assert.equal(await pins.first().evaluate(card=>card===window.pinCardBefore&&card.querySelector('img')===window.pinPreviewBefore),true);
  const pinActions=await pins.first().locator('.collection-card-actions').evaluate(node=>({order:[...node.children].map(child=>child.className),buttons:[...node.querySelectorAll(':scope>button')].map(button=>({label:button.getAttribute('aria-label'),width:button.getBoundingClientRect().width,height:button.getBoundingClientRect().height}))}));assert.deepEqual(pinActions.order,commonActions.order);assert.deepEqual(pinActions.buttons.map(({width,height})=>({width,height})),commonActions.buttons.map(({width,height})=>({width,height})));
  await main.evaluate(()=>window.one.patchSettings({appearance:{mode:'dark'}}));await expect(main.locator('#page-pins [data-select-pin]:checked')).toHaveCount(4);
  await main.evaluate(async()=>{await new Promise(requestAnimationFrame);await Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{})));});
  await sharp(await main.screenshot()).resize({width:1200,height:1000,fit:'inside',withoutEnlargement:true}).png().toFile(path.join(parent,'collections-layout-pins.png'));
  for(const mode of ['light','dark'])for(const scale of [100,150])for(const width of [800,1200]){
   await (await app.browserWindow(main)).evaluate((window,width)=>window.setSize(width,900),width);
   await main.evaluate(({mode,scale})=>window.one.patchSettings({appearance:{mode},capture:{uiScale:scale}}),{mode,scale});
   for(const page of ['materials','pins']){
    await main.locator('.nav[data-page='+page+']').click();const root=main.locator('#page-'+page);await root.locator('[data-collection-toggle]').click();if(await root.locator('[data-collection-toggle]').getAttribute('aria-pressed')!=='true')await root.locator('[data-collection-toggle]').click();
    await root.locator('.collection-select-all input').check();
    await expect.poll(()=>root.evaluate(node=>{const region=node.querySelector('.collection-scroll,.pins-results').getBoundingClientRect(),bar=node.querySelector('.collection-selection').getBoundingClientRect();return region.bottom<=bar.top+1;})).toBe(true);
    const geometry=await root.evaluate(node=>({overflow:node.scrollWidth>node.clientWidth+1,barOverflow:node.querySelector('.collection-selection').scrollWidth>node.querySelector('.collection-selection').clientWidth+1,gridOverflow:node.querySelector('.asset-grid,.pins-grid').scrollWidth>node.querySelector('.asset-grid,.pins-grid').clientWidth+1}));assert.deepEqual(geometry,{overflow:false,barOverflow:false,gridOverflow:false},JSON.stringify({page,mode,scale,width}));
   }
  }
  await main.emulateMedia({reducedMotion:'reduce'});assert.equal(await main.locator('#page-pins .collection-check>span').first().evaluate(node=>getComputedStyle(node).transitionDuration),'0s');
  console.log('Selected card background:',await pins.first().evaluate(node=>getComputedStyle(node).backgroundColor));
  assert.deepEqual(errors,[]);console.log('PASS: gallery selection/ranges/keyboard, stable card DOM, filtered selection, dock geometry, light/dark, 100/150 scale, 800/1200 width, reduced motion.');
 }catch(error){if(app)console.error('Gallery diagnostic:',await app.firstWindow().then(page=>page.evaluate(()=>({toast:document.getElementById('toast')?.textContent,error:document.querySelector('.materials-error')?.textContent,page:document.querySelector('.content')?.getAttribute('data-current-page')}))).catch(()=>null),errors);throw error;}finally{
  if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
  const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(parent));assert.ok(path.basename(actual).startsWith('collections-layout-'));await fs.rm(actual,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
