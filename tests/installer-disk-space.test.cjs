const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {checkDiskSpace}=require('../installer/setup-actions.cjs');
const gib=1024n**3n;
const volume=bytes=>({bavail:bytes/4096n,bsize:4096n});

test('sufficient free space and the 1 GiB boundary pass without PowerShell',async()=>{
  for(const bytes of [gib,69n*gib,241n*gib,2n**64n]) {
    let calls=0;
    await checkDiskSpace('E:\\安装位置 with spaces',async(directory,options)=>{
      calls++;
      assert.equal(directory,'E:\\安装位置 with spaces');
      assert.deepEqual(options,{bigint:true});
      return volume(bytes);
    });
    assert.equal(calls,1);
  }
});

test('a full disk and just below the required free space report space',async()=>{
  for(const bavail of [0n,(gib/4096n)-1n]) {
    await assert.rejects(checkDiskSpace('E:\\Apps',async()=>({bavail,bsize:4096n})),{reason:'space'});
  }
});

test('missing or invalid statistics are a detection failure, never a full disk',async()=>{
  for(const stats of [null,{}, {bavail:null,bsize:4096n}, {bavail:0,bsize:4096}, {bavail:-1n,bsize:4096n}, {bavail:1n,bsize:0n}]) {
    await assert.rejects(checkDiskSpace('E:\\Apps',async()=>stats),{reason:'spaceCheck'});
  }
});

test('filesystem access errors preserve the cause and report a detection failure',async()=>{
  for(const code of ['EACCES','ENOENT','EIO']) {
    const cause=Object.assign(Error(code),{code});
    await assert.rejects(checkDiskSpace('E:\\Apps',async()=>{throw cause;}),error=>error.reason==='spaceCheck'&&error.cause===cause);
  }
});

test('the real filesystem query returns valid space information',async()=>{
  const stats=await fs.promises.statfs(__dirname,{bigint:true});
  assert.equal(typeof stats.bavail,'bigint');
  assert(stats.bavail>=0n&&stats.bsize>0n);
  if(stats.bavail*stats.bsize>=gib) await checkDiskSpace(__dirname,fs.promises.statfs.bind(fs.promises));
  else await assert.rejects(checkDiskSpace(__dirname,fs.promises.statfs.bind(fs.promises)),{reason:'space'});
});

// Exercise the production installation flow up to payload preparation without
// running an installer, writing files, or changing the registry.
const source=fs.readFileSync(path.join(__dirname,'../installer/main.cjs'),'utf8');
const installSource=source.slice(source.indexOf('async function install(directory)'),source.indexOf('app.whenReady()'));
for(const scenario of ['sufficient','full','unavailable']) {
  test(`installation preflight: ${scenario}`,async()=>{
    const directory='E:\\mounted-volume\\安装位置 with spaces\\One';
    const parent=path.win32.dirname(directory);
    const events=[],queries=[],directories=[];
    let copied=false;
    const fsp={
      async mkdir(folder){directories.push(folder);},
      async statfs(folder,options){
        assert.equal(this,fsp,'original-fs promises must retain their receiver');
        queries.push(folder);
        assert.deepEqual(JSON.parse(JSON.stringify(options)),{bigint:true});
        if(scenario==='unavailable')throw Object.assign(Error('Access denied'),{code:'EACCES'});
        return volume(scenario==='full'?0n:241n*gib);
      },
      async rm(){}
    };
    const context=vm.createContext({
      installing:false,validDirectory:()=>true,send:event=>events.push(event),
      os:{arch:()=> 'x64'},runningOne:async()=>[],registry:async()=>null,
      newerThan:()=>false,info:{version:'0.16.24'},registeredDirectory:()=>'',
      archiveAssociationWanted:async()=>false,mediaAssociation:async()=>false,
      path:path.win32,fsp,crypto:{randomBytes:()=>Buffer.alloc(8)},checkDiskSpace,
      payload:'fixture-engine.exe',
      checkedCopy:async()=>{copied=true;throw Object.assign(Error('Stop before writing payload'),{reason:'payloadProbe'});},
      console:{error(){}}
    });
    vm.runInContext(installSource,context);
    await context.install(directory);
    assert.deepEqual(queries,[parent],'query the created installation parent, not its drive root');
    assert.equal(directories[0],parent);
    assert.equal(copied,scenario==='sufficient');
    assert.equal(events.at(-1).reason,{sufficient:'payloadProbe',full:'space',unavailable:'spaceCheck'}[scenario]);
    assert.equal(context.installing,false);
  });
}
