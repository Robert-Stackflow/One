const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,readFile,writeFile,rm}=require('node:fs/promises');
const path=require('node:path');
const {_electron:electron,expect}=require('@playwright/test');

test('Base64 handles Unicode text, binary files and invalid input',async()=>{
 const root=await mkdtemp(path.resolve('work/current/base64-ui-')),profile=path.join(root,'profile'),output=path.join(root,'output'),source=path.join(root,'source.bin');
 await mkdir(output);await writeFile(source,Buffer.from([0,1,2,255]));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,ONE_SEARCH_BACKEND:'memory'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({executablePath:require('electron'),args:['.'],cwd:process.cwd(),env,timeout:30000});
 try{
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.locator('[data-page="developer"]').click();await page.locator('#tool-tab-base64').click();
  await page.locator('#base64-input').fill('中文 🌄');await page.locator('#base64-run').click();
  await expect(page.locator('#base64-status')).toHaveText('已编码');
  const encoded=await page.locator('#base64-output').inputValue();assert.equal(encoded,Buffer.from('中文 🌄').toString('base64'));
  await page.locator('#base64-mode').selectOption('decode-text');await page.locator('#base64-input').fill(encoded);await page.locator('#base64-run').click();
  await expect(page.locator('#base64-output')).toHaveValue('中文 🌄');
  await page.locator('#base64-input').fill('%%not-base64');await page.locator('#base64-run').click();await expect(page.locator('#base64-status')).toContainText('无效');
  await page.locator('#base64-mode').selectOption('encode-file');await page.locator('#base64-file').setInputFiles(source);await page.locator('#base64-run').click();
  await expect(page.locator('#base64-output')).toHaveValue('AAEC/w==');
  await page.locator('#base64-mode').selectOption('decode-file');await page.locator('#base64-input').fill('AAEC/w==');
  const newWindow=app.waitForEvent('window');await page.locator('#base64-run').click();const picker=await newWindow;
  await picker.locator('#picker-path').fill(output);await picker.locator('#picker-go').click();
  await picker.locator('#picker-name').fill('decoded.bin');await picker.locator('#picker-confirm').click();
  await expect(page.locator('#base64-status')).toHaveText('已保存文件');
  assert.deepEqual(await readFile(path.join(output,'decoded.bin')),Buffer.from([0,1,2,255]));
  assert.deepEqual(errors,[]);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
