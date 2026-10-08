const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const { _electron:electron,expect }=require('@playwright/test');

async function main(){
  await fs.mkdir('work/temp',{recursive:true});
  const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-ui-'));
  const profile=path.join(root,'profile');
  const source=path.join(root,'源文件.txt');
  const target=path.join(root,'bundle.zip');
  await fs.writeFile(source,'One archive UI smoke\n');
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,TEMP:root,TMP:root};
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  const errors=[];
  try{
    app=await electron.launch({args:[path.resolve('.')],env});
    app.on('window',page=>page.on('pageerror',error=>errors.push(String(error))));
    const page=await app.firstWindow();
    await app.evaluate(({shell})=>{globalThis.archiveRevealCount=0;globalThis.archiveOpenPathCount=0;shell.showItemInFolder=()=>{globalThis.archiveRevealCount++;};shell.openPath=async()=>{globalThis.archiveOpenPathCount++;return '';};});
    await page.waitForSelector('[data-page="archive"]');
    const files=page.locator('.sidebar-group[aria-label="文件"] .nav');
    assert.equal(await files.last().getAttribute('data-page'),'archive');
    await files.last().click();
    await expect(page.locator('#page-name')).toHaveText('压缩与解压');
    assert.equal(await page.locator('#archive-open-completed').isChecked(),false);
    await expect(page.locator('[data-archive-pane="create"]')).toBeVisible();
    await expect(page.locator('[data-archive-pane="browse"]')).toBeHidden();
    await page.locator('#archive-sources').fill(source);
    await page.locator('#archive-target').fill(target);
    await page.locator('#archive-create').click();
    await expect(page.locator('#archive-status-text')).toContainText('已创建压缩包',{timeout:30000});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('one:archive-progress',{id:'31f6cb32-26c6-4dd9-aae0-b9b234239113',operation:'test',done:1,total:1}));
    await expect(page.locator('#archive-status-text')).toContainText('已创建压缩包');
    assert.equal((await fs.readFile(target)).subarray(0,2).toString(),'PK');
    await page.locator('[data-archive-mode="browse"]').click();
    await page.locator('#archive-source').fill(target);
    await page.locator('#archive-open').click();
    await expect(page.locator('.archive-entry')).toHaveCount(1);
    await expect(page.locator('.archive-entry-name')).toHaveText('源文件.txt');
    await page.locator('#archive-parent').fill(root);
    await page.locator('#archive-extract-all').click();
    await expect(page.locator('#archive-status-text')).toContainText('已解压',{timeout:30000});
    assert.equal(await fs.readFile(path.join(root,'bundle','源文件.txt'),'utf8'),'One archive UI smoke\n');
    const large=path.join(root,'large.bin'),split=path.join(root,'split.zip');
    await fs.writeFile(large,crypto.randomBytes(3*1024*1024));
    await page.locator('[data-archive-mode="create"]').click();
    await page.locator('#archive-sources').fill(large);
    await page.locator('#archive-target').fill(split);
    await page.locator('#archive-volume').fill('1');
    await page.locator('#archive-create').click();
    await expect(page.locator('#archive-status-text')).toContainText('已创建压缩包',{timeout:30000});
    assert.equal((await fs.stat(path.join(root,'split.z01'))).isFile(),true);
    assert.equal((await fs.readdir(root)).some(name=>name.startsWith('.one-archive-')),false);
    const smartParent=path.join(root,'smart-output');await fs.mkdir(smartParent);
    await page.locator('[data-archive-mode="browse"]').click();
    await page.locator('#archive-source').fill(split);
    await page.locator('#archive-open').click();
    await expect(page.locator('.archive-entry-name')).toHaveText('large.bin');
    await page.locator('#archive-parent').fill(smartParent);
    await page.locator('#archive-destination-mode').click();
    await page.locator('#archive-destination-mode-options [role="option"][aria-label="智能解压"]').click();
    await page.locator('#archive-extract-all').click();
    await expect(page.locator('#archive-status-text')).toContainText('已解压',{timeout:30000});
    assert.deepEqual(await fs.readFile(path.join(smartParent,'large.bin')),await fs.readFile(large));
    const second=path.join(root,'second.txt'),multi=path.join(root,'multi.zip');
    await fs.writeFile(second,'second');
    await page.locator('[data-archive-mode="create"]').click();
    await page.locator('#archive-sources').fill([source,second].join('\n'));
    await page.locator('#archive-target').fill(multi);
    await page.locator('#archive-volume').fill('');
    await page.locator('#archive-create').click();
    await expect(page.locator('#archive-status-text')).toContainText('已创建压缩包',{timeout:30000});
    await page.locator('[data-archive-mode="browse"]').click();
    await page.locator('#archive-source').fill(multi);
    await page.locator('#archive-open').click();
    await expect(page.locator('.archive-entry')).toHaveCount(2);
    await page.locator('#archive-parent').fill(smartParent);
    await page.locator('#archive-extract-all').click();
    await expect(page.locator('#archive-status-text')).toContainText('已解压',{timeout:30000});
    assert.equal(await fs.readFile(path.join(smartParent,'multi','second.txt'),'utf8'),'second');
    const occupied=path.join(root,'occupied.zip');
    await fs.writeFile(path.join(root,'occupied.z01'),'existing volume');
    await page.locator('[data-archive-mode="create"]').click();
    await page.locator('#archive-sources').fill(large);
    await page.locator('#archive-target').fill(occupied);
    await page.locator('#archive-volume').fill('1');
    await page.locator('#archive-create').click();
    await expect(page.locator('#archive-status-text')).toContainText('同名分卷',{timeout:30000});
    assert.equal(await fs.readFile(path.join(root,'occupied.z01'),'utf8'),'existing volume');
    await assert.rejects(fs.stat(occupied),{code:'ENOENT'});
    assert.equal((await fs.readdir(root)).some(name=>name.startsWith('.one-archive-')),false);
    const seven=path.join(root,'encrypted.7z');
    const made=spawnSync('7z',['a','-t7z','-y','-psecret','-mhe=on',seven,source],{encoding:'utf8'});
    if(!made.error){
      assert.equal(made.status,0,made.stdout+'\n'+made.stderr);
      await page.locator('[data-archive-mode="browse"]').click();
      await page.locator('#archive-source').fill(seven);
      await page.locator('#archive-password').fill('secret');
      await page.locator('#archive-open').click();
      await expect(page.locator('.archive-entry-name')).toHaveText('源文件.txt');
      await page.locator('#archive-test').click();
      await expect(page.locator('#archive-status-text')).toContainText('校验完成',{timeout:30000});
    }
    await page.locator('[data-archive-mode="create"]').click();
    await page.locator('#archive-format').click();
    await page.locator('#archive-format-options [role="option"][aria-label="7Z"]').click();
    const appSeven=path.join(root,'app-created.7z');
    await page.locator('#archive-sources').fill(source);
    await page.locator('#archive-target').fill(appSeven);
    await page.locator('#archive-volume').fill('');
    await page.locator('#archive-create-password').fill('secret');
    await page.locator('#archive-create').click();
    await expect(page.locator('#archive-status-text')).toContainText('已创建压缩包',{timeout:30000});
    await page.locator('[data-archive-mode="browse"]').click();
    await page.locator('#archive-source').fill(appSeven);
    await page.locator('#archive-password').fill('secret');
    await page.locator('#archive-open').click();
    await expect(page.locator('.archive-entry-name')).toHaveText('源文件.txt');
    const appSplit=path.join(root,'app-split.7z');
    await page.locator('[data-archive-mode="create"]').click();
    await page.locator('#archive-sources').fill(large);
    await page.locator('#archive-target').fill(appSplit);
    await page.locator('#archive-create-password').fill('');
    await page.locator('#archive-volume').fill('1');
    await page.locator('#archive-create').click();
    await expect(page.locator('#archive-status-text')).toContainText('已创建压缩包',{timeout:30000});
    assert.equal((await fs.stat(appSplit+'.001')).isFile(),true);
    assert.equal((await fs.stat(appSplit+'.002')).isFile(),true);
    if(!made.error){const external=spawnSync('7z',['t','-y',appSplit+'.001'],{encoding:'utf8'});assert.equal(external.status,0,external.stdout+'\n'+external.stderr);}
    await page.locator('[data-archive-mode="browse"]').click();
    await page.locator('#archive-source').fill(appSplit+'.001');
    await page.locator('#archive-password').fill('');
    await page.locator('#archive-open').click();
    await expect(page.locator('.archive-entry-name')).toHaveText('large.bin');
    await page.locator('#archive-test').click();
    await expect(page.locator('#archive-status-text')).toContainText('校验完成',{timeout:30000});
    if(!made.error){
      const tar=path.join(root,'documents.tar'),gzip=tar+'.gz',xz=tar+'.xz',tgz=path.join(root,'documents.tgz'),txz=path.join(root,'documents.txz');
      for(const args of [['a','-ttar',tar,source,second],['a','-tgzip',gzip,tar],['a','-txz',xz,tar],['a','-tgzip',tgz,tar],['a','-txz',txz,tar]]){
        const generated=spawnSync('7z',args,{encoding:'utf8'});assert.equal(generated.status,0,generated.stdout+'\n'+generated.stderr);
      }
      for(const archive of [tar,xz,tgz,txz,gzip]){
        await page.locator('#archive-source').fill(archive);
        await page.locator('#archive-open').click();
        await expect(page.locator('.archive-entry')).toHaveCount(2,{timeout:30000});
        await page.locator('#archive-test').click();
        await expect(page.locator('#archive-status-text')).toContainText('校验完成',{timeout:30000});
      }
      const unpack=path.join(root,'composite-output');await fs.mkdir(unpack);
      const cacheBefore=(await fs.readdir(path.join(profile,'archive-cache'))).sort();
      await page.locator('#archive-source').fill(gzip);
      await page.locator('#archive-open').click();
      await expect(page.locator('#archive-status-text')).toContainText('已读取',{timeout:30000});
      const cacheAfter=(await fs.readdir(path.join(profile,'archive-cache'))).sort();
      assert.deepEqual(cacheAfter,cacheBefore,'reopening an unchanged composite archive should reuse its prepared TAR');
      await page.locator('#archive-parent').fill(unpack);
      await page.locator('#archive-extract-all').click();
      await expect(page.locator('#archive-status-text')).toContainText('已解压',{timeout:30000});
      assert.equal(await fs.readFile(path.join(unpack,'documents','second.txt'),'utf8'),'second');
      const revisedTar=path.join(root,'revised.tar'),revisedGzip=revisedTar+'.gz';
      for(const args of [['a','-ttar',revisedTar,source],['a','-tgzip',revisedGzip,revisedTar]]){
        const generated=spawnSync('7z',args,{encoding:'utf8'});assert.equal(generated.status,0,generated.stdout+'\n'+generated.stderr);
      }
      await fs.rm(gzip);await fs.rename(revisedGzip,gzip);
      await page.locator('#archive-source').fill(gzip);
      await page.locator('#archive-open').click();
      await expect(page.locator('.archive-entry')).toHaveCount(1,{timeout:30000});
      await expect(page.locator('.archive-entry-name')).toHaveText('源文件.txt');
    }
    for(const [format,label,inputs,count] of [
      ['tar','TAR',[source,second],2],
      ['tar.gz','TAR.GZ',[source,second],2],
      ['tgz','TAR.GZ',[source,second],2],
      ['tar.xz','TAR.XZ',[source,second],2],
      ['txz','TAR.XZ',[source,second],2],
      ['gz','GZ（单文件）',[source],1],
      ['xz','XZ（单文件）',[source],1],
    ]){
      const archive=path.join(root,`one-created-${format.replaceAll('.','-')}.${format}`);
      await page.locator('[data-archive-mode="create"]').click();
      await page.locator('#archive-format').click();
      await page.locator(`#archive-format-options [role="option"][aria-label="${label}"]`).click();
      assert.equal(await page.locator('#archive-volume').isDisabled(),true);
      assert.equal(await page.locator('#archive-create-password').isDisabled(),true);
      await page.locator('#archive-sources').fill(inputs.join('\n'));
      await page.locator('#archive-target').fill(archive);
      await page.locator('#archive-create').click();
      await expect(page.locator('#archive-status-text')).toContainText('已创建压缩包',{timeout:30000});
      if(!made.error){const external=spawnSync('7z',['t','-y',archive],{encoding:'utf8'});assert.equal(external.status,0,external.stdout+'\n'+external.stderr);}
      await page.locator('[data-archive-mode="browse"]').click();
      await page.locator('#archive-source').fill(archive);
      await page.locator('#archive-open').click();
      await expect(page.locator('.archive-entry')).toHaveCount(count,{timeout:30000});
      await page.locator('#archive-test').click();
      await expect(page.locator('#archive-status-text')).toContainText('校验完成',{timeout:30000});
      const output=path.join(root,`output-${format.replaceAll('.','-')}`);await fs.mkdir(output);
      await page.locator('#archive-parent').fill(output);
      await page.locator('#archive-extract-all').click();
      await expect(page.locator('#archive-status-text')).toContainText('已解压',{timeout:30000});
      const entries=await fs.readdir(output,{recursive:true});
      if(format==='xz')assert.equal(await fs.readFile(path.join(output,entries[0]),'utf8'),'One archive UI smoke\n');
      else assert(entries.some(name=>name.endsWith('源文件.txt')),`${format} should extract the source file`);
    }
    assert.equal(await app.evaluate(()=>globalThis.archiveRevealCount),0,'Default operations must not open Explorer');
    await page.locator('#archive-open-completed').check();
    await expect.poll(()=>page.evaluate(async()=>(await window.one.settings()).archive.openCompleted)).toBe(true);
    await page.locator('[data-archive-mode="create"]').click();
    await page.locator('#archive-format').click();await page.locator('#archive-format-options [role="option"][aria-label="ZIP"]').click();
    const optin=path.join(root,'optin-created.zip');
    await page.locator('#archive-sources').fill(source);await page.locator('#archive-target').fill(optin);
    await page.locator('#archive-create-password').fill('');await page.locator('#archive-volume').fill('');
    await page.locator('#archive-create').click();await expect(page.locator('#archive-status-text')).toContainText('已创建压缩包',{timeout:30000});
    await expect.poll(()=>app.evaluate(()=>globalThis.archiveRevealCount)).toBe(1);
    await page.locator('[data-archive-mode="browse"]').click();await page.locator('#archive-source').fill(optin);await page.locator('#archive-open').click();
    await expect(page.locator('.archive-entry-name')).toHaveText('源文件.txt');
    await page.locator('#archive-parent').fill(root);await page.locator('#archive-extract-all').click();
    await expect(page.locator('#archive-status-text')).toContainText('已解压',{timeout:30000});
    await expect.poll(()=>app.evaluate(()=>globalThis.archiveRevealCount)).toBe(2);
    await page.reload();
    await page.locator('[data-page="archive"]').click();
    assert.equal(await page.locator('#archive-open-completed').isChecked(),true);
    await page.locator('#archive-open-completed').uncheck();
    await expect.poll(()=>page.evaluate(async()=>(await window.one.settings()).archive.openCompleted)).toBe(false);
    await page.reload();await page.locator('[data-page="archive"]').click();
    await expect(page.locator('#archive-open-completed')).not.toBeChecked();
    assert.equal(await app.evaluate(()=>globalThis.archiveOpenPathCount),0,'archive operations must not open directories through another route');
    assert.deepEqual(errors,[]);
    console.log('Archive UI smoke passed: ZIP/7Z/TAR/GZ/XZ creation, encryption, split archives, composites, late progress protection and open-folder preference.');
  }finally{
    if(app)await app.close();
    await assert.rejects(fs.stat(path.join(profile,'archive-cache')),{code:'ENOENT'});
    await fs.rm(root,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
