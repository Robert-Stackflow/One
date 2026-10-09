const fs=require('node:fs/promises'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const exec=promisify(execFile);
async function buildEditor(root){
 const script=path.join(root,'build-editor.cmd'),binary=path.join(root,'editor.exe');
 const header=(await fs.readFile('work/build-native.cmd','utf8')).split(/\r?\n/).slice(0,3).join('\r\n');
 await fs.writeFile(script,`${header}\r\ncl /nologo /std:c++20 /EHsc /MT /O2 /utf-8 tests\\native\\archive-edit-test-editor.cpp /Fe:"${binary}" /Fo:"${path.join(root,'editor.obj')}"\r\n`);
 await exec('cmd.exe',['/d','/c',script],{cwd:path.resolve('.'),windowsHide:true,timeout:30000});return binary;
}
async function until(work,timeout=10000){const started=Date.now();while(true){const value=await work();if(value)return value;if(Date.now()-started>timeout)throw Error('Timed out waiting for editor state');await new Promise(resolve=>setTimeout(resolve,50));}}
async function opened(root,count=1){return until(async()=>{const files=(await fs.readdir(root)).filter(name=>name.endsWith('.opened'));return files.length>=count?Promise.all(files.map(async name=>({pid:Number(name.split('.')[0]),file:await fs.readFile(path.join(root,name),'utf8')}))):undefined;});}
async function closeEditors(root){for(const name of (await fs.readdir(root)).filter(name=>name.endsWith('.opened')))await fs.writeFile(path.join(root,name.replace('.opened','.close')),'close');await until(async()=>{for(const name of (await fs.readdir(root)).filter(name=>name.endsWith('.opened'))){try{process.kill(Number(name.split('.')[0]),0);return false;}catch{}}return true;});}
module.exports={buildEditor,until,opened,closeEditors};
