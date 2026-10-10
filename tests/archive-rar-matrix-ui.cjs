const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {_electron:electron,expect}=require('@playwright/test'),{testArchive,setArchivePassword}=require('./archive-ui-helpers.cjs');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
async function files(root,prefix=''){return (await Promise.all((await fs.readdir(path.join(root,prefix),{withFileTypes:true})).map(entry=>entry.isDirectory()?files(root,prefix+entry.name+'/'):[prefix+entry.name]))).flat().sort();}
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-rar-matrix-ui-'));let app;
 try{
  const fixtureRoot=path.resolve('tests/fixtures/rar/matrix'),manifest=JSON.parse(await fs.readFile(path.join(fixtureRoot,'manifest.json'),'utf8')),cases=manifest.cases.filter(item=>(item.headers&&item.solid&&item.split)||(!item.headers&&!item.solid&&!item.split));
  for(const fixture of cases){const directory=path.join(root,fixture.id);await fs.mkdir(directory);for(const member of fixture.members)await fs.copyFile(path.join(fixtureRoot,fixture.id,member.name),path.join(directory,member.name));}
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:path.join(root,'profile'),TEMP:root,TMP:root};delete env.ELECTRON_RUN_AS_NODE;app=await electron.launch({args:[path.resolve('.')],env});const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.waitForSelector('[data-page="archive"]');await page.locator('[data-page="archive"]').click();await page.locator('[data-archive-mode="browse"]').click();
  const verify=async(parent,expected)=>{const children=await fs.readdir(parent);assert.equal(children.length,1);const output=path.join(parent,children[0]);assert.deepEqual(await files(output),expected.map(entry=>entry.name).sort());for(const entry of expected){const data=await fs.readFile(path.join(output,entry.name));assert.equal(data.length,entry.bytes);assert.equal(hash(data),entry.sha256);}};
  for(const fixture of cases){
   await page.locator('#archive-source').fill(path.join(root,fixture.id,fixture.first));await setArchivePassword(page,manifest.password);await page.locator('#archive-open').click();await expect(page.locator('#archive-open')).toBeEnabled();await expect(page.locator('.archive-entry')).toHaveCount(3);await expect(page.locator('#archive-editor')).toBeHidden();
   await page.locator('#archive-decode-open').click();await expect(page.locator('#archive-password-encoding-row')).toBeHidden();await page.locator('#archive-decode-dialog-close').click();await expect(page.locator('#archive-decode-dialog')).toBeHidden();
   await testArchive(page);await expect(page.locator('#archive-status-text')).toContainText('校验完成');
   const output=path.join(root,fixture.id+'.out');await fs.mkdir(output);await page.locator('#archive-parent').fill(output);await page.locator('#archive-extract-all').click();await expect(page.locator('#archive-status-text')).toContainText('已解压');await verify(output,manifest.expected);
   const selected=path.join(root,fixture.id+'.selected');await fs.mkdir(selected);await page.locator('#archive-parent').fill(selected);await page.locator('.archive-entry').filter({hasText:'emoji-🔐.txt'}).locator('input[type="checkbox"]').check();await page.locator('#archive-extract-selected').click();await expect(page.locator('#archive-status-text')).toContainText('已解压');await expect.poll(async()=>await fs.readdir(selected)).toHaveLength(1);await verify(selected,manifest.expected.filter(entry=>entry.name==='emoji-🔐.txt'));
  }
  assert.deepEqual(errors,[]);console.log('RAR matrix UI passed: RAR4/5 plain-file and solid/header-encrypted volume cases; Unicode password options, read-only UI, integrity testing, full and emoji-file selective extraction with independent hashes.');
 }finally{await app?.close();const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(String(error.stack||error).slice(-5000));process.exitCode=1;});
