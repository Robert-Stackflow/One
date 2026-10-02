import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,readdir,rm,stat} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
const execute=promisify(execFile),root=resolve(process.env.ONE_WORK_ROOT||'E:/One-Work'),current=join(root,'current'),marker=join(root,'.one-generated-workspace');
await mkdir(root,{recursive:true});
const existing=await readdir(root);if(!existing.includes('.one-generated-workspace')&&existing.length)throw new Error('测试工作区非空且没有 One 标记，拒绝写入');
await writeFile(marker,'One generated verification workspace; no user files.\n');await mkdir(current,{recursive:true});
const names=process.argv.slice(2);if(!names.length)throw new Error('指定 tests 中的验证名称，如 file-tools-smoke');
const temp=join(root,'temp');await mkdir(temp,{recursive:true});
async function removeOwned(file){const rel=relative(current,file);if(!rel||rel.startsWith('..')||isAbsolute(rel))throw new Error('清理路径越界');await rm(file,{recursive:true,force:true});}
for(const name of names){
 if(!/^[a-z0-9-]+$/.test(name))throw new Error('验证名称无效');await stat(resolve('tests',name+'.cjs'));
 const output=join(current,name);await mkdir(output,{recursive:true});const started=Date.now();
 try{
  const result=await execute(process.execPath,['tests/'+name+'.cjs'],{cwd:resolve('.'),windowsHide:true,timeout:180000,maxBuffer:4*1024*1024,env:{...process.env,TEMP:temp,TMP:temp,ONE_TEST_OUTPUT_DIR:output,ONE_UNIT_OUTPUT_DIR:join(current,'unit'),ONE_STRUCTURE_FIXTURE_DIR:join(current,'fixtures','structure'),ONE_CSV_FIXTURE_DIR:join(current,'fixtures','csv'),ONE_DIRECTORY_FIXTURE_DIR:join(current,'fixtures','directory')}});
  await writeFile(join(output,'run.log'),result.stdout+result.stderr);console.log(JSON.stringify({test:name,result:'PASS',elapsedMs:Date.now()-started,output}));
 }catch(error){await writeFile(join(output,'run.log'),(error.stdout||'')+(error.stderr||'')+'\n'+String(error));throw error;}
 finally{
  // The child test has exited and closed its own app; clear its generated profiles.
  for(const item of await readdir(output,{withFileTypes:true}))if(item.isDirectory()&&/^(?:profile-|files-|docs-|corpus-)/.test(item.name))await removeOwned(join(output,item.name));
 }
}
