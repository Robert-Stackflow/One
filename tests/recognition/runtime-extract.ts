import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { extractRuntimeArchive } from '../../src/main/recognition/runtime-extract';
const bytes=Buffer.from('fixed native fixture'),file={archive:'test',entry:'native/fixed.dll',name:'fixed.dll',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
async function fixture(zip:JSZip){const root=await mkdtemp(join(process.env.ONE_MODEL_TEST_ROOT!,'extract-')),source=join(root,'runtime.zip'),target=join(root,'files');await mkdir(target);await writeFile(source,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',platform:'UNIX'}));return {source,target};}
test('runtime extraction streams only pinned files and verifies their bytes',async()=>{
  const zip=new JSZip();zip.file(file.entry,bytes);zip.file('unused.exe','ignored');const {source,target}=await fixture(zip);
  await extractRuntimeArchive(source,[file],target,new AbortController().signal);assert.deepEqual(await readFile(join(target,file.name)),bytes);
  await assert.rejects(readFile(join(target,'unused.exe')),/ENOENT/);
});
test('runtime extraction rejects traversal, symbolic links and case collisions even in ignored entries',async()=>{
  for(const variant of ['traversal','symlink','duplicate']){
    const zip=new JSZip();zip.file(file.entry,bytes);
    if(variant==='traversal')zip.file('../outside.exe','bad');
    if(variant==='symlink')zip.file('unused-link','outside',{unixPermissions:0xa1ff});
    if(variant==='duplicate')zip.file('native/FIXED.dll',bytes);
    const {source,target}=await fixture(zip);await assert.rejects(extractRuntimeArchive(source,[file],target,new AbortController().signal),/无效|重复|invalid|relative/i);
  }
});
test('runtime extraction rejects missing files, size/hash mismatches and invalid destinations',async()=>{
  for(const variant of ['missing','size','hash']){
    const zip=new JSZip();zip.file('readme.txt','fixture');if(variant!=='missing')zip.file(file.entry,variant==='size'?Buffer.concat([bytes,bytes]):Buffer.alloc(bytes.length));
    const {source,target}=await fixture(zip);await assert.rejects(extractRuntimeArchive(source,[file],target,new AbortController().signal),/缺少|大小|校验/);
  }
  const zip=new JSZip();zip.file(file.entry,bytes);const {source,target}=await fixture(zip);
  await assert.rejects(extractRuntimeArchive(source,[{...file,name:'../outside.dll'}],target,new AbortController().signal),/清单/);
});
test('runtime extraction cancellation closes file streams before returning',async()=>{
  const zip=new JSZip();zip.file(file.entry,bytes);zip.file('native/second.dll',bytes);const {source,target}=await fixture(zip),abort=new AbortController();
  await assert.rejects(extractRuntimeArchive(source,[file,{...file,entry:'native/second.dll',name:'second.dll'}],target,abort.signal,()=>abort.abort()),/abort|取消/i);
  await assert.rejects(readFile(join(target,'second.dll')),/ENOENT/);
  const again=join(target,'next');await mkdir(again);await extractRuntimeArchive(source,[file],again,new AbortController().signal);
});
