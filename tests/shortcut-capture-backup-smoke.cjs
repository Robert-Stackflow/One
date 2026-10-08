const { _electron: electron, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function run() {
  const output = path.resolve('work/current/shortcut-capture-backup');
  await fs.mkdir(output, {recursive:true});
  const profile = await fs.mkdtemp(path.join(output,'profile-'));
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({args:[path.resolve('.')],env});
  try {
    const page=await app.firstWindow();
    await page.locator('[data-page=color]').click();
    const input=page.locator('#color-shortcut');
    await input.click();
    await page.keyboard.press('Shift+Meta+C');
    await expect(input).toHaveValue('Shift+Win+C');
    await expect(input).not.toBeFocused();

    const current=await page.evaluate(()=>window.one.settings());
    const updated={...current,colorShortcut:'Ctrl+Alt+P',appearance:{...current.appearance,mode:'dark'}};
    const backupPath=path.join(profile,'settings-backup.json');
    await fs.writeFile(backupPath,JSON.stringify({format:'one-settings-backup',schema:1,exportedAt:new Date().toISOString(),settings:updated}));
    await app.evaluate(({dialog,globalShortcut},file)=>{
      globalThis.originalShortcutRegister=globalShortcut.register;
      globalThis.originalBackupDialog=dialog.showOpenDialog;
      globalShortcut.register=()=>false;
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});
    },backupPath);
    const result=await page.evaluate(()=>window.one.settingsBackupImport());
    assert.equal(result.imported,true);
    assert.match(result.shortcutError,/已被占用/);
    const imported=await page.evaluate(()=>window.one.settings());
    assert.equal(imported.colorShortcut,'Ctrl+Alt+P');
    assert.equal(imported.appearance.mode,'dark');
    await app.evaluate(({dialog,globalShortcut})=>{
      globalShortcut.register=globalThis.originalShortcutRegister;
      dialog.showOpenDialog=globalThis.originalBackupDialog;
    });
    console.log(JSON.stringify({result:'PASS',winChordCaptured:true,conflictingBackupImported:true}));
  } finally {
    await app.close();
    const resolved=await fs.realpath(profile),parent=await fs.realpath(output);
    assert.equal(path.dirname(resolved).toLowerCase(),parent.toLowerCase());
    await fs.rm(resolved,{recursive:true,force:true,maxRetries:3,retryDelay:100});
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
