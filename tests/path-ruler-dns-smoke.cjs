const {_electron:electron,expect}=require('@playwright/test');
const {mkdtemp,mkdir,writeFile}=require('node:fs/promises');
const {resolve,join}=require('node:path');
const assert=require('node:assert/strict');

async function main(){
 const output=resolve('work/path-ruler-dns-smoke');await mkdir(output,{recursive:true});const profile=await mkdtemp(join(output,'profile-'));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const application=await electron.launch({args:[resolve('.')],env});const errors=[];application.on('window',page=>page.on('pageerror',error=>errors.push(String(error))));
 try{
  const main=await application.firstWindow();await main.waitForSelector('[data-page=color]');await main.locator('[data-page=color]').click();await main.screenshot({path:join(output,'ruler-mode-selector.png')});
  const rulerReady=application.waitForEvent('window',{predicate:page=>page.url().includes('view=screen-ruler')&&page.url().includes('mode=live')});await main.locator('#start-screen-ruler').click();const ruler=await rulerReady;await ruler.waitForSelector('#ruler-surface');
  await expect.poll(()=>main.evaluate(()=>document.hasFocus())).toBe(true);
  assert.equal(await application.evaluate(({globalShortcut})=>globalShortcut.isRegistered('Escape')),true);
  const scale=Number(new URL(ruler.url()).searchParams.get('scale'))||1;
  await ruler.mouse.move(100,110);await ruler.mouse.down();await ruler.mouse.move(240,190);await ruler.mouse.up();
  await expect(ruler.locator('#ruler-readout')).toContainText(`${Math.round(140*scale)} × ${Math.round(80*scale)} px`);
  await expect.poll(()=>main.evaluate(()=>document.hasFocus())).toBe(true);
  assert.equal(await ruler.locator('#ruler-selection').evaluate(element=>getComputedStyle(element).boxShadow),'none');
  const before=await main.evaluate(()=>new Promise(resolve=>requestAnimationFrame(time=>resolve(time))));
  const after=await main.evaluate(()=>new Promise(resolve=>requestAnimationFrame(time=>resolve(time))));
  assert.ok(after>before,'the underlying window should continue rendering after a selection');
  await ruler.screenshot({path:join(output,'screen-ruler.png')});
  await ruler.evaluate(()=>window.one.closeScreenRuler()).catch(error=>{if(!ruler.isClosed())throw error;});await expect.poll(()=>ruler.isClosed()).toBe(true);
  assert.equal(await application.evaluate(({globalShortcut})=>globalShortcut.isRegistered('Escape')),false);
  await main.locator('#screen-ruler-options').click();await expect(main.locator('#screen-ruler-menu')).toBeVisible();
  const staticReady=application.waitForEvent('window',{predicate:page=>page.url().includes('view=screen-ruler')&&page.url().includes('mode=static')});
  await main.locator('[data-ruler-mode=static]').click();const staticRuler=await staticReady;await expect(staticRuler.locator('#ruler-surface')).toBeVisible();
  await expect(staticRuler.locator('.ruler-hint')).toContainText('静态画面');
  await staticRuler.keyboard.press('Escape').catch(error=>{if(!staticRuler.isClosed())throw error;});await expect.poll(()=>staticRuler.isClosed()).toBe(true);
  for(let i=0;i<2;i++){
   const next=application.waitForEvent('window',{predicate:page=>page.url().includes('view=screen-ruler')});
   await main.locator('#start-screen-ruler').click();const reopened=await next;await reopened.waitForSelector('#ruler-surface');
   await reopened.keyboard.press('Escape').catch(error=>{if(!reopened.isClosed())throw error;});await expect.poll(()=>reopened.isClosed()).toBe(true);
   assert.equal(main.isClosed(),false);
  }
  await main.locator('[data-page=hardware]').click();await main.locator('[data-information-tab=proxy]').click();await expect(main.locator('#information-dns')).toBeVisible();
  const pending=main.locator('.proxy-exit-card.pending');if(await pending.count())assert.ok((await pending.first().boundingBox()).height<80,'pending exit card should remain compact');
  await main.locator('#information-dns-domain').fill('example.com');await main.locator('#information-dns-run').click();await expect(main.locator('.information-dns-domain')).toContainText('example.com',{timeout:15000});
  await main.screenshot({path:join(output,'dns-check.png')});
  const file=join(output,'sample.txt');await writeFile(file,'One path menu');const previousClipboard=await application.evaluate(({clipboard})=>clipboard.readText());
  try{
   const searchReady=application.waitForEvent('window',{predicate:page=>page.url().includes('view=search')&&!page.url().includes('search-menu')});await main.evaluate(()=>window.one.showSearch());const search=await searchReady;await search.waitForSelector('#file-query');
   const menuReady=application.waitForEvent('window',{predicate:page=>page.url().includes('view=file-context')&&!page.url().includes('submenu')});await search.evaluate(path=>window.one.searchContextMenu(path,{x:100,y:90}),file);const menu=await menuReady;
   await menu.locator('[data-file-action=copy-relative]').click();assert.equal(await application.evaluate(({clipboard})=>clipboard.readText()),'sample.txt');
   await search.evaluate(path=>window.one.searchContextMenu(path,{x:100,y:90}),file);await menu.locator('[data-file-action=copy-quoted]').click();assert.equal(await application.evaluate(({clipboard})=>clipboard.readText()),`"${file}"`);
  }finally{await application.evaluate(({clipboard},text)=>clipboard.writeText(text),previousClipboard);}
  assert.deepEqual(errors,[]);console.log('Screen ruler and DNS UI smoke passed');
 }finally{await application.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
