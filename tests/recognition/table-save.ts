import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,realpath,rm,writeFile} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {join,dirname,basename,resolve} from 'node:path';
import {saveTable} from '../../src/main/recognition/table-export';
import {blankTable} from '../../src/shared/recognition/table';
import {chooseSaveFile} from './runtime';

test('table export respects cancellation, protected One data, atomic replacement and external destination changes',async()=>{
  const root=resolve(process.env.ONE_RECOGNITION_TEST_ROOT!),directory=await mkdtemp(join(root,'table-save-'));
  try{
    const table=blankTable(2,2),window={} as any,file=join(directory,'export.xlsx');
    chooseSaveFile();assert.equal(await saveTable(window,table,()=>true,()=>{}),null);
    chooseSaveFile(file);await assert.rejects(saveTable(window,table,()=>true,()=>{throw Error('One data is protected');}),/protected/);assert.deepEqual(await readdir(directory),[]);
    assert.equal(await saveTable(window,table,()=>true,()=>{}),'export.xlsx');assert.equal((await readFile(file)).subarray(0,2).toString(),'PK');
    await writeFile(file,'original');chooseSaveFile(file.slice(0,-5));await assert.rejects(saveTable(window,table,()=>true,()=>{}),/重新确认覆盖/);assert.equal(await readFile(file,'utf8'),'original');
    chooseSaveFile(file);let checked=0;
    await assert.rejects(saveTable(window,table,()=>{if(++checked===2)writeFileSync(file,'external edit survives');return true;},()=>{}),/已改变/);
    assert.equal(await readFile(file,'utf8'),'external edit survives');assert.deepEqual(await readdir(directory),['export.xlsx']);
  }finally{chooseSaveFile();const actual=await realpath(directory);assert.equal(dirname(actual),await realpath(root));assert.ok(basename(actual).startsWith('table-save-'));await rm(actual,{recursive:true,force:true});}
});
