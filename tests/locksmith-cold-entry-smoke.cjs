const {_electron:electron,expect}=require('@playwright/test'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');

async function run(){
 const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/locksmith-cold-entry');await fs.mkdir(out,{recursive:true});
 const profile=await fs.mkdtemp(path.join(out,'profile-')),target=path.join(out,'cold-entry.txt');await fs.writeFile(target,'fixture');
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[path.resolve('.')],env}),errors=[];app.on('window',page=>page.on('pageerror',error=>errors.push(String(error))));
 try{
  const page=await app.firstWindow();await page.waitForSelector('#overview-index');assert.equal(await page.locator('#page-locksmith').evaluate(node=>node.childElementCount),0);
  await page.evaluate(file=>window.one.inspectLocks(file),target);
  await expect(page.locator('#page-locksmith')).toBeVisible();await expect(page.locator('#lock-targets')).toContainText(target);
  await expect.poll(()=>page.evaluate(async()=>(await window.one.lockState()).running),{timeout:100000}).toBe(false);
  assert.deepEqual((await page.evaluate(()=>window.one.lockState())).targets,[target]);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:'PASS',coldExternalEntry:true,targetPreserved:true,errors}));
 }finally{await app.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
