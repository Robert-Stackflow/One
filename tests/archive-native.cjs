const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');

const helper=path.resolve('dist/native/One.Archive.exe');
assert(fs.existsSync(helper),'build One.Archive.exe first');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'one-archive-test-'));
const packet=password=>{const content=Buffer.from(password,'utf8'),data=Buffer.alloc(4+content.length);data.writeUInt32LE(content.length);content.copy(data,4);return data;};
const call=(args,password='',expect=0)=>{const result=spawnSync(helper,args,{input:packet(password),encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(result.status,expect,result.stdout+'\n'+result.stderr);return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));};
function crc32(data){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function rawZip(filename,destination){
  const name=Buffer.from(filename),body=Buffer.from('unsafe');const crc=crc32(body);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(body.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(body.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+body.length,16);
  fs.writeFileSync(destination,Buffer.concat([local,name,body,central,name,end]));
}
try{
  const folder=path.join(root,'中文目录');fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'nested.txt'),'nested content');
  fs.mkdirSync(path.join(folder,'empty'));
  const zip=path.join(root,'secure.zip');
  call(['create',zip,folder],'secret');
  const lines=call(['list',zip,'0','50','0']);const items=lines.filter(line=>line.type==='entry');
  const page=call(['list',zip,'1','1','0']);
  assert.equal(page.find(line=>line.type==='meta').total,items.length);
  assert.deepEqual(page.filter(line=>line.type==='entry').map(line=>line.index),[1]);
  assert(items.some(item=>item.name==='中文目录/nested.txt'&&item.encrypted));
  assert(items.some(item=>item.name==='中文目录/empty/'&&item.directory));
  assert.equal(call(['test',zip,'0'],'secret').at(-1).count,1+2);
  assert.match(call(['test',zip,'0'],'wrong',2).at(-1).message,/integrity|open|ZIP/i);
  const output=path.join(root,'output');call(['extract',zip,output,'','0'],'secret');
  assert.equal(fs.readFileSync(path.join(output,'中文目录','nested.txt'),'utf8'),'nested content');
  assert(fs.statSync(path.join(output,'中文目录','empty')).isDirectory());
  const selected=path.join(root,'selected');const index=items.find(item=>item.name==='中文目录/').index;
  call(['extract',zip,selected,String(index),'0'],'secret');
  assert.equal(fs.readFileSync(path.join(selected,'中文目录','nested.txt'),'utf8'),'nested content');
  const large=path.join(root,'large.bin'),largeData=crypto.randomBytes(3*1024*1024);
  fs.writeFileSync(large,largeData);
  const split=path.join(root,'split.zip');
  call(['create',split,'--volume=1048576',large]);
  assert(fs.existsSync(path.join(root,'split.z01')),'split ZIP must create a .z01 volume');
  assert.equal(call(['test',split,'0']).at(-1).count,1);
  const sevenZip=spawnSync('7z',['t','-y',split],{encoding:'utf8',maxBuffer:1024*1024});
  if(!sevenZip.error)assert.equal(sevenZip.status,0,sevenZip.stdout+'\n'+sevenZip.stderr);
  const splitOutput=path.join(root,'split-output');call(['extract',split,splitOutput,'','0']);
  assert.deepEqual(fs.readFileSync(path.join(splitOutput,'large.bin')),largeData);
  for(const [index,name] of ['../escape.txt','C:/escape.txt','CON.txt','folder/file.txt:stream'].entries()){
    const evil=path.join(root,`evil-${index}.zip`),outside=path.join(root,`evil-${index}-out`);rawZip(name,evil);
    assert.match(call(['extract',evil,outside,'','0'], '',2).at(-1).message,/unsafe/i);
    assert(!fs.existsSync(path.join(root,'escape.txt')));
  }
  console.log('Archive native smoke passed: AES, Unicode, selected folders, empty folders, split ZIP, CRC, unsafe paths.');
}finally{fs.rmSync(root,{recursive:true,force:true});}
