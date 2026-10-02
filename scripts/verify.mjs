import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,readdir,rm,stat} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {workspace,pruneWorkspace} from './workspace.mjs';
const execute=promisify(execFile),{root,temp}=await workspace(),current=join(root,'current');await mkdir(current,{recursive:true});
const names=process.argv.slice(2);if(!names.length)throw new Error('指定 tests 中的验证名称，如 file-tools-smoke');
async function removeOwned(file){const rel=relative(current,file);if(!rel||rel.startsWith('..')||isAbsolute(rel))throw new Error('清理路径越界');await rm(file,{recursive:true,force:true});}
for(const name of names){
 if(!/^[a-z0-9-]+$/.test(name))throw new Error('验证名称无效');await stat(resolve('tests',name+'.cjs'));
 const output=join(current,name);await mkdir(output,{recursive:true});await writeFile(join(output,'.one-generated-case'),'One generated verification result\n');await writeFile(join(output,'.active'),String(process.pid));const started=Date.now();
 try{
  const result=await execute(process.execPath,['tests/'+name+'.cjs'],{cwd:resolve('.'),windowsHide:true,timeout:180000,maxBuffer:4*1024*1024,env:{...process.env,TEMP:temp,TMP:temp,ONE_TEST_OUTPUT_DIR:output,ONE_UNIT_OUTPUT_DIR:join(current,'unit'),ONE_STRUCTURE_FIXTURE_DIR:join(current,'fixtures','structure'),ONE_CSV_FIXTURE_DIR:join(current,'fixtures','csv'),ONE_DIRECTORY_FIXTURE_DIR:join(current,'fixtures','directory')}});
  await writeFile(join(output,'run.log'),result.stdout+result.stderr);console.log(JSON.stringify({test:name,result:'PASS',elapsedMs:Date.now()-started,output}));
 }catch(error){await writeFile(join(output,'run.log'),(error.stdout||'')+(error.stderr||'')+'\n'+String(error));console.error('验证失败：'+name+'，详见 '+join(output,'run.log'));process.exitCode=1;}
 finally{
  // The child test has exited and closed its own app; clear its generated profiles.
  for(const item of await readdir(output,{withFileTypes:true}))if(item.isDirectory())await removeOwned(join(output,item.name));await rm(join(output,'.active'),{force:true});await pruneWorkspace(root);
 }
 if(process.exitCode)break;
}
