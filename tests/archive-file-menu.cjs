const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),JSZip=require('jszip');
const {_electron:electron,expect}=require('@playwright/test');
async function main(){
 const base=path.resolve('work/temp');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'archive-file-menu-'));let app;
 try{
  const file=path.join(root,'ordinary.txt'),archive=path.join(root,'menu.zip');await fs.writeFile(file,'ordinary');
  const zip=new JSZip();zip.file('inside.txt','archive contents');await fs.writeFile(archive,await zip.generateAsync({type:'nodebuffer'}));
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:path.join(root,'profile'),TEMP:root,TMP:root};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({args:[path.resolve('.')],env});
  await app.evaluate(({shell})=>{globalThis.archiveExplorerCalls=0;shell.showItemInFolder=()=>globalThis.archiveExplorerCalls++;shell.openPath=async()=>{globalThis.archiveExplorerCalls++;return '';};});
  const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.waitForSelector('[data-page="archive"]');
  await page.evaluate(()=>window.one.patchSettings({search:{shortcut:'',programShortcut:''}}));
  const menu=async(file,directory=false)=>{
   await page.evaluate(()=>window.one.showSearch());
   await expect.poll(()=>app.windows().some(p=>/[?&]view=search(?:$|&)/.test(p.url()))).toBe(true);
   const search=app.windows().find(p=>/[?&]view=search(?:$|&)/.test(p.url()));await search.waitForSelector('#file-query');
   await search.evaluate(({file,directory})=>window.one.searchContextMenu(file,{x:40,y:40},directory),{file,directory});
   await expect.poll(()=>app.windows().some(p=>/[?&]view=file-context(?:$|&)/.test(p.url())&&!p.url().includes('submenu='))).toBe(true);
   const popup=app.windows().find(p=>/[?&]view=file-context(?:$|&)/.test(p.url())&&!p.url().includes('submenu='));
   await expect(popup.locator('.file-context-heading strong')).toHaveText(path.basename(file));return popup;
  };
  let popup=await menu(file);await expect(popup.locator('[data-file-action^="archive-"]')).toHaveCount(1);
  await popup.locator('[data-file-action="archive-create"]').click();await expect(page.locator('#archive-sources')).toHaveValue(file);
  popup=await menu(root,true);await expect(popup.locator('[data-file-action^="archive-"]')).toHaveCount(1);
  await popup.locator('[data-file-action="archive-create"]').click();await expect(page.locator('#archive-sources')).toHaveValue(root);
  popup=await menu(archive);await expect(popup.locator('[data-file-action^="archive-"]')).toHaveCount(5);
  await popup.locator('[data-file-action="archive-extract"]').click();await expect(page.locator('#archive-source')).toHaveValue(archive);await expect(page.locator('.archive-entry-name')).toHaveText('inside.txt');
  await assert.rejects(fs.stat(path.join(root,'inside.txt')),{code:'ENOENT'});
  for(const action of ['archive-here','archive-folder','archive-smart']){
   popup=await menu(archive);await popup.locator(`[data-file-action="${action}"]`).click();
   await expect.poll(()=>page.locator('#archive-destination-mode').evaluate(node=>node.value)).toBe(action.slice('archive-'.length));
   await expect(page.locator('#archive-status-text')).toContainText('已解压',{timeout:30000});
   assert.equal(await page.locator('#archive-destination-mode').evaluate(node=>node.value),action.slice('archive-'.length));
  }
  assert.equal(await fs.readFile(path.join(root,'inside.txt'),'utf8'),'archive contents');assert.equal(await fs.readFile(path.join(root,'menu','inside.txt'),'utf8'),'archive contents');
  assert.equal(await app.evaluate(()=>globalThis.archiveExplorerCalls),0);assert.deepEqual(errors,[]);
  console.log('One file menu passed: create file/folder, archive-only actions, browse without extraction, all extraction actions, session routing and no Explorer windows.');
 }finally{if(app)await app.close();const relative=path.relative(base,root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
