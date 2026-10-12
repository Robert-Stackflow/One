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
  const task=async()=>{await expect.poll(()=>app.windows().filter(p=>/[?&]view=archive-task(?:$|&)/.test(p.url())).length,{timeout:15000}).toBe(1);return app.windows().find(p=>/[?&]view=archive-task(?:$|&)/.test(p.url()));};
  const child=async()=>{await expect.poll(()=>app.windows().some(p=>/[?&]view=file-context(?:$|&)/.test(p.url())&&p.url().includes('submenu='))).toBe(true);const pane=app.windows().find(p=>/[?&]view=file-context(?:$|&)/.test(p.url())&&p.url().includes('submenu='));await expect(pane.locator('.file-context-list')).toBeVisible();return pane;};
  const closeTask=async(p)=>{await p.locator('#archive-task-cancel').click({noWaitAfter:true}).catch(error=>{if(!p.isClosed())throw error;});await expect.poll(()=>app.windows().includes(p)).toBe(false);};
  let popup=await menu(file);await expect(popup.locator('[data-file-action^="archive-"]')).toHaveCount(1);
  await popup.locator('[data-file-action="archive-create"]').click();let submenu=await child();for(const format of ['zip','7z','tar','tar-gz','tar-xz','gz','xz'])await expect(submenu.locator(`[data-file-action="archive-create-${format}"]`)).toBeVisible();await expect(popup.locator('.file-context-heading strong')).toHaveText('ordinary.txt');await submenu.locator('[data-file-action="archive-create"]').click();let progress=await task();await expect(progress.locator('#archive-task-path')).toHaveValue(path.join(root,'ordinary.zip'));await closeTask(progress);
  popup=await menu(root,true);await expect(popup.locator('[data-file-action^="archive-"]')).toHaveCount(1);
  await popup.locator('[data-file-action="archive-create"]').click();submenu=await child();await expect(submenu.locator('[data-file-action="archive-create-7z"]')).toBeVisible();await expect(submenu.locator('[data-file-action="archive-create-gz"]')).toHaveCount(0);await expect(submenu.locator('[data-file-action="archive-create-xz"]')).toHaveCount(0);await submenu.locator('[data-file-action="archive-create"]').click();progress=await task();await expect(progress.locator('#archive-task-path')).toHaveValue(root+'.zip');await closeTask(progress);
  popup=await menu(file);await popup.locator('[data-file-action="archive-create"]').click();submenu=await child();await submenu.locator('[data-file-action="archive-create-zip"]').click();progress=await task();await expect(progress.locator('#archive-task-feedback')).toContainText('已创建',{timeout:30000});await closeTask(progress);await fs.stat(path.join(root,'ordinary.zip'));
  popup=await menu(archive);await expect(popup.locator('[data-file-action^="archive-"]')).toHaveCount(3);
  await popup.locator('[data-file-action="archive-extract-menu"]').click();submenu=await child();await expect(submenu.locator('[data-file-action="archive-choose"]')).toBeVisible();await expect(popup.locator('[data-file-action="archive-extract-menu"]')).toBeVisible();
  await popup.locator('[data-file-action="archive-create"]').hover();await expect(submenu.locator('[data-file-action="archive-create-tar-gz"]')).toBeVisible();await popup.locator('[data-file-action="archive-extract-menu"]').hover();await expect(submenu.locator('[data-file-action="archive-choose"]')).toBeVisible();
  await submenu.keyboard.press('Escape');await expect(popup.locator('[data-file-action="archive-extract"]')).toBeVisible();
  await popup.locator('[data-file-action="archive-extract"]').click();await expect(page.locator('#archive-source')).toHaveValue(archive);await expect(page.locator('.archive-entry-name')).toHaveText('inside.txt');
  await assert.rejects(fs.stat(path.join(root,'inside.txt')),{code:'ENOENT'});
  for(const action of ['archive-here','archive-folder','archive-smart']){
   popup=await menu(archive);await popup.locator('[data-file-action="archive-extract-menu"]').click();submenu=await child();await submenu.locator(`[data-file-action="${action}"]`).click();
   progress=await task();await expect(progress.locator('#archive-task-feedback')).toContainText('已解压',{timeout:30000});await closeTask(progress);
  }
  assert.equal(await fs.readFile(path.join(root,'inside.txt'),'utf8'),'archive contents');assert.equal(await fs.readFile(path.join(root,'menu','inside.txt'),'utf8'),'archive contents');
  popup=await menu(archive);await popup.locator('[data-file-action="archive-extract-menu"]').click();submenu=await child();await submenu.locator('[data-file-action="archive-choose"]').click();progress=await task();await expect(progress.locator('#archive-task-directory')).toHaveValue(root);await closeTask(progress);
  const longFile=path.join(root,'a-very-long-filename-for-the-compression-submenu-and-its-format-extension.txt');await fs.writeFile(longFile,'long label');popup=await menu(longFile);await popup.locator('[data-file-action="archive-create"]').click();submenu=await child();await expect(submenu.locator('[data-file-action="archive-create-tar-gz"]')).toBeVisible();
  const layout=await submenu.locator('.file-context-list').evaluate(list=>{const suffix=list.querySelector('[data-file-action="archive-create-tar-gz"] .file-context-suffix').getBoundingClientRect(),row=list.querySelector('[data-file-action="archive-create-tar-gz"]').getBoundingClientRect();return {overflow:list.scrollHeight-list.clientHeight,suffixInside:suffix.right<=row.right&&suffix.left>=row.left};});assert(layout.overflow<=1,JSON.stringify(layout));assert(layout.suffixInside,JSON.stringify(layout));await submenu.keyboard.press('Escape');
  await popup.locator('[data-file-action="apps"]').click();submenu=await child();await expect(submenu.locator('.file-context-loading')).toHaveCount(0);const appsOverflow=await submenu.locator('.file-context-list').evaluate(list=>list.scrollHeight-list.clientHeight);assert(appsOverflow<=1,`open-with submenu overflow: ${appsOverflow}`);await submenu.keyboard.press('Escape');
  assert.equal(await app.evaluate(()=>globalThis.archiveExplorerCalls),0);assert.deepEqual(errors,[]);
  console.log('One file menu passed: create file/folder, archive-only actions, browse without extraction, all extraction actions, session routing and no Explorer windows.');
 }finally{if(app)await app.close();const relative=path.relative(base,root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
