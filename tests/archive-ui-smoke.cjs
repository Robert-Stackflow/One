const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const { _electron:electron,expect }=require('@playwright/test');

async function main(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'one-archive-ui-'));
  const profile=path.join(root,'profile');
  const source=path.join(root,'源文件.txt');
  const target=path.join(root,'bundle.zip');
  await fs.writeFile(source,'One archive UI smoke\n');
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};
  delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({args:[path.resolve('.')],env});
  const errors=[];
  app.on('window',page=>page.on('pageerror',error=>errors.push(String(error))));
  try{
    const page=await app.firstWindow();
    await page.waitForSelector('[data-page="archive"]');
    const files=page.locator('.sidebar-group[aria-label="文件"] .nav');
    assert.equal(await files.last().getAttribute('data-page'),'archive');
    await files.last().click();
    await expect(page.locator('#page-name')).toHaveText('压缩与解压');
    await expect(page.locator('[data-archive-pane="create"]')).toBeVisible();
    await expect(page.locator('[data-archive-pane="browse"]')).toBeHidden();
    await page.locator('#archive-sources').fill(source);
    await page.locator('#archive-target').fill(target);
    await page.locator('#archive-create').click();
    await expect(page.locator('#archive-status-text')).toContainText('已创建压缩包',{timeout:30000});
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
    assert.deepEqual(errors,[]);
    console.log('Archive UI smoke passed: sidebar order, create, browse and extract.');
  }finally{
    await app.close();
    await fs.rm(root,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
