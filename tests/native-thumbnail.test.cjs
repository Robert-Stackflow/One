const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);

test('isolated image decoder produces a bounded PNG from a Unicode path',async()=>{
 const out=path.resolve(process.env.ONE_UNIT_OUTPUT_DIR||'work','native-thumbnail-tests');
 await fs.mkdir(out,{recursive:true});
 const source=path.join(out,'预览图像.png'),original=await fs.readFile('assets/icons/one-256.png');
 await fs.writeFile(source,original);
 const helper=path.resolve('dist/native/One.Thumbnail.exe');
 const {stdout}=await run(helper,[source,'96','84'],{encoding:'buffer',windowsHide:true,timeout:5000,maxBuffer:9*1024*1024});
 assert.ok(Buffer.isBuffer(stdout));
 assert.equal(stdout.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 assert.equal(stdout.readUInt32BE(16),84);
 assert.equal(stdout.readUInt32BE(20),84);
 assert.deepEqual(await fs.readFile(source),original);
 await assert.rejects(run(helper,[source,'99999','84'],{encoding:'buffer',windowsHide:true,timeout:5000}),/Invalid thumbnail dimensions/);
});
