import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readdir,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {workspace,pruneWorkspace} from './workspace.mjs';
const {root,temp}=await workspace(),output=join(root,'current','test-suite'),artifacts=join(output,'artifacts'),marker=join(artifacts,'.one-unit-artifacts');await mkdir(output,{recursive:true});await mkdir(artifacts,{recursive:true});
if(!(await readdir(artifacts)).includes('.one-unit-artifacts')&&(await readdir(artifacts)).length)throw new Error('单元测试目录没有 One 标记，拒绝使用');await writeFile(marker,'One unit test artifacts\n');
await writeFile(join(output,'.one-generated-case'),'One generated unit verification result\n');
await writeFile(join(output,'.active'),String(process.pid));
const files=(await readdir('tests')).filter(name=>name.endsWith('.test.cjs')).sort().map(name=>'tests/'+name);
try{const result=await promisify(execFile)(process.execPath,['--test',...files],{cwd:resolve('.'),windowsHide:true,timeout:180000,maxBuffer:4*1024*1024,env:{...process.env,TEMP:temp,TMP:temp,ONE_UNIT_OUTPUT_DIR:artifacts}});await writeFile(join(output,'run.log'),result.stdout+result.stderr);process.stdout.write(result.stdout);process.stderr.write(result.stderr);}
catch(error){await writeFile(join(output,'run.log'),(error.stdout||'')+(error.stderr||'')+'\n'+String(error));process.stdout.write(error.stdout||'');process.stderr.write(error.stderr||'');process.exitCode=1;}
finally{const inside=relative(output,artifacts);if(inside!=='artifacts'||await readFile(marker,'utf8')!=='One unit test artifacts\n')throw new Error('测试清理路径或标记变化');await rm(artifacts,{recursive:true,force:true});await rm(join(output,'.active'),{force:true});await pruneWorkspace(root);}
