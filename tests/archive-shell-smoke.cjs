const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {_electron:electron,expect}=require('@playwright/test');

async function main(){
  await fs.mkdir('work/temp',{recursive:true});
  const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-shell-'));
  const profile=path.join(root,'profile'),inbox=path.join(profile,'shell-requests');
  const source=path.join(root,'右键 源文件.txt'),second=path.join(root,'第二个文件.txt'),archive=path.join(root,'右键测试.zip');
  await fs.mkdir(inbox,{recursive:true});
  await fs.writeFile(source,'Archive shell request\n');
  await fs.writeFile(second,'Second request\n');
  const request=async(tool,paths)=>{const file=path.join(inbox,crypto.randomUUID()+'.json');await fs.writeFile(file,JSON.stringify({tool,paths}));return file;};
  const initial=await request('archive-create',[source]);
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({args:[path.resolve('.'),`--one-shell-request=${initial}`],env});
  try{
    const page=await app.firstWindow();
    await expect(page.locator('[data-page="archive"]')).toHaveClass(/active/,{timeout:20000});
    await expect(page.locator('[data-archive-pane="create"]')).toBeVisible();
    assert.equal(await page.locator('#archive-sources').inputValue(),source);
    await assert.rejects(fs.stat(initial),{code:'ENOENT'});
    const privateInput=Buffer.alloc(4);
    const created=spawnSync(path.resolve('dist/native/One.Archive.exe'),['create',archive,source],{input:privateInput,encoding:'utf8'});
    assert.equal(created.status,0,created.stdout+'\n'+created.stderr);
    const extract=await request('archive-extract',[archive]);
    await expect(page.locator('[data-archive-pane="browse"]')).toBeVisible({timeout:15000});
    await expect(page.locator('#archive-source')).toHaveValue(archive);
    await expect(page.locator('.archive-entry-name')).toHaveText('右键 源文件.txt',{timeout:15000});
    await assert.rejects(fs.stat(extract),{code:'ENOENT'});
    assert.equal(await page.locator('#archive-open-completed').isChecked(),false);
    const repeat=await request('archive-create',[second]);
    await expect(page.locator('[data-archive-pane="create"]')).toBeVisible({timeout:15000});
    await expect(page.locator('#archive-sources')).toHaveValue(second);
    await assert.rejects(fs.stat(repeat),{code:'ENOENT'});
    await page.locator('[data-page="settings"]').click();
    await expect(page.locator('#shell-archive-create')).toBeVisible();
    await expect(page.locator('#shell-archive-extract')).toBeVisible();
    console.log('Archive shell request smoke passed: create selection and archive browse through startup/inbox requests.');
  }finally{await app.close();await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
