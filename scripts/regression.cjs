const {spawnSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const names=['electron','refinement','experience','redesign','utilities','search','search-menu','native-scan','text-tools','special-preview','preview-redesign','preview-sidebar','font-preview-polish','preview-performance','fonts','ui-polish','preferences','system-information'];
const output=path.join('work','regression-'+require('../package.json').version);
fs.mkdirSync(output,{recursive:true});const results=[];
for(const name of names){const start=Date.now(),result=spawnSync(process.execPath,[`tests/${name}-smoke.cjs`],{encoding:'utf8',env:process.env,timeout:180000});const log=(result.stdout||'')+(result.stderr||'');fs.writeFileSync(path.join(output,name+'.log'),log);const row={name,exit:result.status,elapsed:Date.now()-start,error:result.error?.message};results.push(row);console.log(JSON.stringify(row));if(result.status!==0)console.log(log.slice(-8000));fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(results,null,2));}
if(results.some(r=>r.exit!==0))process.exitCode=1;
