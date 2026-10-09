const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),Module=require('node:module'),{build}=require('esbuild');
const {buildEditor,opened,closeEditors}=require('./archive-edit-test-helpers.cjs');
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-edit-launch-'));const prior={ONE_TEST_MODE:process.env.ONE_TEST_MODE,ONE_ARCHIVE_EDIT_TEST_PROGRAM:process.env.ONE_ARCHIVE_EDIT_TEST_PROGRAM,ONE_ARCHIVE_EDIT_TEST_CONTROL:process.env.ONE_ARCHIVE_EDIT_TEST_CONTROL};
 let observer;
 try{
  process.env.ONE_TEST_MODE='1';process.env.ONE_ARCHIVE_EDIT_TEST_CONTROL=root;process.env.ONE_ARCHIVE_EDIT_TEST_PROGRAM=await buildEditor(root);
  const result=await build({entryPoints:['src/main/archive-edit-launch.ts'],bundle:true,platform:'node',format:'cjs',write:false}),file=path.resolve('dist/main/edit-launch-test.cjs'),mod=new Module(file);mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file));mod._compile(result.outputFiles[0].text,file);
  const document=path.join(root,'中文 空格.txt');await fs.writeFile(document,'unchanged');
  observer=await mod.exports.launchArchiveEditor(document,'text',new AbortController().signal);assert.equal(observer.tracked,true);let records=await opened(root);assert.equal(records[0].file,document);let ended=false;void observer.exited.then(()=>ended=true);await new Promise(resolve=>setTimeout(resolve,100));assert.equal(ended,false);
  await fs.writeFile(path.join(root,records[0].pid+'.close'),'close');assert.equal(await observer.exited,'closed');
  observer=await mod.exports.launchArchiveEditor(document,'associated',new AbortController().signal);records=await opened(root,2);const active=records.find(record=>{try{process.kill(record.pid,0);return true;}catch{return false;}});assert.ok(active);observer.release();assert.equal(await observer.exited,'unknown');process.kill(active.pid,0);await closeEditors(root);
  const controller=new AbortController();controller.abort();await assert.rejects(mod.exports.launchArchiveEditor(document,'text',controller.signal),/停止/);
  process.env.ONE_ARCHIVE_EDIT_TEST_PROGRAM=path.join(root,'missing-editor.exe');await assert.rejects(mod.exports.launchArchiveEditor(document,'associated',new AbortController().signal),/无法打开/);
  assert.equal(await fs.readFile(document,'utf8'),'unchanged');console.log(JSON.stringify({result:'PASS',scope:'real ShellExecuteEx launch, Unicode path, process handle exit, releasing observer preserves editor, cancelled launch'}));
 }finally{observer?.release();await closeEditors(root);for(const [key,value] of Object.entries(prior)){if(value===undefined)delete process.env[key];else process.env[key]=value;}assert.ok(root.startsWith(path.resolve('work/temp')+path.sep));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
