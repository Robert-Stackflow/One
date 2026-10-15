// Offline model experiment runner. A Windows Job Object bounds commit and descendant lifetime.
const {spawn}=require('node:child_process'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),koffi=require('koffi');
async function main(){
  const args=process.argv.slice(2),at=args.indexOf('--'),settings=args.slice(0,at),command=args.slice(at+1),option=name=>{const index=settings.indexOf(name);return index<0?undefined:settings[index+1];};
  const memoryMiB=Number(option('--memory-mib')),timeoutMs=Number(option('--timeout-ms')),report=option('--report');
  if(process.platform!=='win32'||process.arch!=='x64'||at<0||!command.length||!report||!Number.isInteger(memoryMiB)||memoryMiB<512||memoryMiB>8192||!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>600000)throw Error('Expected Windows x64, memory 512..8192 MiB, timeout 1000..600000ms, report and command');
  const k=koffi.load('kernel32.dll'),create=k.func('uintptr_t __stdcall CreateJobObjectW(void*,str16)'),set=k.func('bool __stdcall SetInformationJobObject(uintptr_t,int,void*,uint32)'),assign=k.func('bool __stdcall AssignProcessToJobObject(uintptr_t,uintptr_t)'),open=k.func('uintptr_t __stdcall OpenProcess(uint32,bool,uint32)'),close=k.func('bool __stdcall CloseHandle(uintptr_t)'),query=k.func('bool __stdcall QueryInformationJobObject(uintptr_t,int,void*,uint32,void*)');
  const job=create(null,null),limits=Buffer.alloc(144);let processHandle=0,child,timer,reason='',status;
  limits.writeUInt32LE(0x2100,16);limits.writeBigUInt64LE(BigInt(memoryMiB)*1048576n,112);
  try{
    if(!job||!set(job,9,limits,144))throw Error('Cannot create bounded model job');
    const start=Date.now(),availableMiB=Math.round(os.freemem()/1048576);
    child=spawn(command[0],command.slice(1),{shell:false,windowsHide:true,stdio:['ignore','inherit','inherit'],env:{...process.env,TOKENIZERS_PARALLELISM:'false'}});
    status=await new Promise((resolve,reject)=>{
      child.once('error',reject);child.once('spawn',()=>{processHandle=open(0x101,false,child.pid);if(!processHandle||!assign(job,processHandle)){reason='job-attachment-failed';child.kill();}else timer=setTimeout(()=>{reason='timeout';child.kill();},timeoutMs);});child.once('exit',(code,signal)=>resolve({code,signal}));
    });
    const final=Buffer.alloc(144);let peakCommitMiB;
    if(query(job,9,final,144,null))peakCommitMiB=Math.round(Number(final.readBigUInt64LE(128))/1048576);
    await fs.mkdir(path.dirname(path.resolve(report)),{recursive:true});await fs.writeFile(report,JSON.stringify({memoryMiB,timeoutMs,availableMiB,elapsedMs:Date.now()-start,peakCommitMiB,status,...(reason?{reason}:{})},null,2));
    if(reason||status.code!==0)process.exitCode=1;
  }finally{clearTimeout(timer);if(processHandle)close(processHandle);if(job)close(job);}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
