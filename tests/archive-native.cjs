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
  const rar4=path.resolve('tests/fixtures/rar4-sample.rar'),rar5=path.resolve('tests/fixtures/rar5-sample.rar');
  assert.equal(call(['list',rar4,'0','50','0']).filter(line=>line.type==='entry').length,5);
  assert.equal(call(['test',rar4,'0']).at(-1).count,5);
  assert.equal(call(['list',rar5,'0','50','0']).filter(line=>line.type==='entry').length,3);
  assert.equal(call(['test',rar5,'0']).at(-1).count,3);
  const rarOut=path.join(root,'rar5-out');call(['extract',rar5,rarOut,'','0']);
  assert.equal(fs.readFileSync(path.join(rarOut,'cebula.txt'),'utf8').slice(0,6),'Cebula');
  if(!sevenZip.error){
    const seven=path.join(root,'中文.7z');
    const made=spawnSync('7z',['a','-t7z','-y',seven,folder],{encoding:'utf8',maxBuffer:1024*1024});
    assert.equal(made.status,0,made.stdout+'\n'+made.stderr);
    const sevenItems=call(['list',seven,'0','50','0']).filter(line=>line.type==='entry');
    assert(sevenItems.some(item=>item.name.replaceAll('\\','/')==='中文目录/nested.txt'),JSON.stringify(sevenItems));
    assert.equal(call(['test',seven,'0']).at(-1).count,sevenItems.length);
    const sevenOut=path.join(root,'seven-out');call(['extract',seven,sevenOut,'','0']);
    assert.equal(fs.readFileSync(path.join(sevenOut,'中文目录','nested.txt'),'utf8'),'nested content');
    const locked=path.join(root,'locked.7z');
    const encrypted=spawnSync('7z',['a','-t7z','-y','-psecret','-mhe=on',locked,folder],{encoding:'utf8',maxBuffer:1024*1024});
    assert.equal(encrypted.status,0,encrypted.stdout+'\n'+encrypted.stderr);
    assert.match(call(['list',locked,'0','50','0'],'',2).at(-1).message,/password|open/i);
    assert(call(['list',locked,'0','50','0'],'secret').some(line=>line.type==='entry'));
    assert.equal(call(['test',locked,'0'],'secret').at(-1).count,sevenItems.length);
    const volumes=path.join(root,'volumes.7z');
    const volumeResult=spawnSync('7z',['a','-t7z','-y','-v1m',volumes,large],{encoding:'utf8',maxBuffer:1024*1024});
    assert.equal(volumeResult.status,0,volumeResult.stdout+'\n'+volumeResult.stderr);
    const firstVolume=volumes+'.001';assert(fs.existsSync(firstVolume));
    assert.equal(call(['test',firstVolume,'0']).at(-1).count,1);
    const volumeOut=path.join(root,'volume-out');call(['extract',firstVolume,volumeOut,'','0']);
    assert.deepEqual(fs.readFileSync(path.join(volumeOut,'large.bin')),largeData);
    const tar=path.join(root,'native.tar'),gzip=path.join(root,'single.gz'),xz=path.join(root,'single.xz');
    for(const args of [['a','-ttar',tar,path.join(folder,'nested.txt')],['a','-tgzip',gzip,path.join(folder,'nested.txt')],['a','-txz',xz,path.join(folder,'nested.txt')]]){
      const made=spawnSync('7z',args,{encoding:'utf8'});assert.equal(made.status,0,made.stdout+'\n'+made.stderr);
    }
    for(const [archive,name] of [[tar,'nested.txt'],[gzip,'nested.txt'],[xz,'single']]){
      assert.equal(call(['list',archive,'0','50','0']).find(line=>line.type==='entry').name,name);
      assert.equal(call(['test',archive,'0']).at(-1).count,1);
      const destination=path.join(root,'native-'+path.basename(archive)+'-out');call(['extract',archive,destination,'','0']);
      assert.equal(fs.readFileSync(path.join(destination,name),'utf8'),'nested content');
    }
  }
  const createdSeven=path.join(root,'created.7z');
  assert.match(call(['create',path.join(root,'not-rar.rar'),folder],'',2).at(-1).message,/read-only/i);
  for(const [extension,source] of [['tar',folder],['gz',path.join(folder,'nested.txt')],['xz',path.join(folder,'nested.txt')]]){
    const archive=path.join(root,`created.${extension}`);
    call(['create',archive,source]);
    const found=call(['list',archive,'0','50','0']).filter(line=>line.type==='entry');
    assert(found.length>0,`${extension} should contain entries`);
    assert.equal(call(['test',archive,'0']).at(-1).count,found.length);
    const destination=path.join(root,`created-${extension}-out`);call(['extract',archive,destination,'','0']);
    const extracted=extension==='tar'?path.join(destination,'中文目录','nested.txt'):path.join(destination,found[0].name);
    assert.equal(fs.readFileSync(extracted,'utf8'),'nested content');
    if(!sevenZip.error){const external=spawnSync('7z',['t','-y',archive],{encoding:'utf8'});assert.equal(external.status,0,external.stdout+'\n'+external.stderr);}
  }
  assert.match(call(['create',path.join(root,'bad-secret.tar'),folder],'secret',2).at(-1).message,/encryption/i);
  assert.match(call(['create',path.join(root,'bad-volume.tar'),'--volume=1048576',folder],'',2).at(-1).message,/volumes/i);
  assert.match(call(['create',path.join(root,'bad-folder.gz'),folder],'',2).at(-1).message,/regular file/i);
  call(['create',createdSeven,folder],'secret');
  assert.match(call(['list',createdSeven,'0','50','0'],'',2).at(-1).message,/password|open/i);
  const createdItems=call(['list',createdSeven,'0','50','0'],'secret').filter(line=>line.type==='entry');
  assert(createdItems.some(item=>item.name.replaceAll('\\','/')==='中文目录/nested.txt'&&item.encrypted));
  assert(createdItems.some(item=>item.name.replaceAll('\\','/')==='中文目录/empty'&&item.directory));
  assert.equal(call(['test',createdSeven,'0'],'secret').at(-1).count,createdItems.length);
  const createdOut=path.join(root,'created-out');call(['extract',createdSeven,createdOut,'','0'],'secret');
  assert.equal(fs.readFileSync(path.join(createdOut,'中文目录','nested.txt'),'utf8'),'nested content');
  if(!sevenZip.error){const external=spawnSync('7z',['t','-y','-psecret',createdSeven],{encoding:'utf8'});assert.equal(external.status,0,external.stdout+'\n'+external.stderr);}
  for(const [index,name] of ['../escape.txt','C:/escape.txt','CON.txt','folder/file.txt:stream'].entries()){
    const evil=path.join(root,`evil-${index}.zip`),outside=path.join(root,`evil-${index}-out`);rawZip(name,evil);
    assert.match(call(['extract',evil,outside,'','0'], '',2).at(-1).message,/unsafe/i);
    assert(!fs.existsSync(path.join(root,'escape.txt')));
  }
  console.log('Archive native smoke passed: AES, Unicode, split ZIP, 7Z, RAR4/5, TAR, GZ, XZ, CRC and unsafe paths.');
}finally{fs.rmSync(root,{recursive:true,force:true});}
