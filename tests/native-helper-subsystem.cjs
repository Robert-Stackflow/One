const {spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const exec=promisify(execFile),dir=path.resolve(process.env.ONE_NATIVE_HELPER_DIR||'dist/native');
const names=['One.Index','One.Search','One.Levels','One.Monitor','One.Windows'];

async function guiSubsystem(name){
 const file=await fs.readFile(path.join(dir,name+'.exe'));
 const pe=file.readUInt32LE(0x3c);
 assert.equal(file.toString('ascii',pe,pe+4),'PE\0\0',name+' must be a PE executable');
 assert.equal(file.readUInt16LE(pe+24+68),2,name+' should not start a console host');
}

async function windowsProtocol(){
 const child=spawn(path.join(dir,'One.Windows.exe'),[],{windowsHide:true,stdio:'pipe'});
 let output='';child.stdout.on('data',chunk=>output+=chunk);
 child.stdin.end('stop\n');
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 assert.equal(code,0);assert.deepEqual(JSON.parse(output.trim()),{ready:true});
}

async function indexProtocol(){
 const cache=path.resolve('work/native-helper-subsystem-index.bin');
 const child=spawn(path.join(dir,'One.Index.exe'),[cache],{windowsHide:true,stdio:'pipe'});
 let output='';child.stdout.on('data',chunk=>output+=chunk);
 child.stdin.end('{"type":"metadata","id":7}\n');
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 assert.equal(code,0);const message=JSON.parse(output.trim());assert.equal(message.id,7);assert.equal(typeof message.error,'string');
}

async function main(){
 await Promise.all(names.map(guiSubsystem));
 const [search,levels,monitor]=await Promise.all([
  exec(path.join(dir,'One.Search.exe'),['context','0'],{timeout:15000,windowsHide:true}),
  exec(path.join(dir,'One.Levels.exe'),['--display-info'],{timeout:15000,windowsHide:true}),
  exec(path.join(dir,'One.Monitor.exe'),['hardware','overview'],{timeout:20000,windowsHide:true})
 ]);
 assert.equal(JSON.parse(search.stdout).kind,'search');
 assert.ok(Array.isArray(JSON.parse(levels.stdout)));
 assert.ok(Array.isArray(JSON.parse(monitor.stdout)));
 await windowsProtocol();await indexProtocol();
 console.log(JSON.stringify({result:'PASS',guiHelpers:names,protocols:true}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
