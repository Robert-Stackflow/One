import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {once} from 'node:events';
import {createConnection} from 'node:net';
import {ArchiveService} from './archive-service';
import {CliFailure,cliExit,parseCli,runCli} from './archive-cli';
import {runtimeCli,flushRuntimeLogs} from './runtime-log';

const abort=new AbortController();
const cancel=()=>abort.abort();process.on('SIGINT',cancel);process.on('SIGBREAK',cancel);process.on('SIGTERM',cancel);
const cancellationPipe=process.env.ONE_ARCHIVE_CLI_CANCEL_PIPE?createConnection(process.env.ONE_ARCHIVE_CLI_CANCEL_PIPE):undefined;
cancellationPipe?.on('data',()=>abort.abort());cancellationPipe?.on('error',()=>abort.abort());
cancellationPipe?.on('end',()=>abort.abort());
const args=process.argv.slice(2);let json=args.includes('--json'),service:ArchiveService|undefined,session:string|undefined;
const write=async(stream:NodeJS.WriteStream,line:string)=>{if(!stream.write(line))await once(stream,'drain');};
let outputClosed=false;for(const stream of [process.stdout,process.stderr])stream.on('error',()=>{outputClosed=true;abort.abort();});
const out=async(line:string)=>{if(!outputClosed)await write(process.stdout,line);};
const err=async(line:string)=>{if(!outputClosed)await write(process.stderr,line);};
const profile=resolve(process.env.ONE_ARCHIVE_CLI_PROFILE||join(process.env.APPDATA||process.cwd(),'One'));
const cacheParent=join(profile,'archive-cli','temp');
async function password(){
 if(process.stdin.isTTY)throw new CliFailure('--password-stdin requires piped input');
 const chunks:Buffer[]=[];let length=0;const stop=()=>process.stdin.destroy();abort.signal.addEventListener('abort',stop);
 try{if(abort.signal.aborted)throw new CliFailure('Cancelled',130);for await(const chunk of process.stdin){length+=chunk.length;if(length>1026){process.stdin.destroy();throw new CliFailure('Password input exceeds 1024 UTF-8 bytes');}chunks.push(chunk);}if(abort.signal.aborted)throw new CliFailure('Cancelled',130);
  let value:string;try{value=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}catch{throw new CliFailure('Password input must be UTF-8');}
  value=value.replace(/\r?\n$/,'');if(Buffer.byteLength(value)>1024||/[\0\r\n]/.test(value))throw new CliFailure('Password input must be one line of at most 1024 UTF-8 bytes');return value;
 }finally{abort.signal.removeEventListener('abort',stop);}
}
async function main(){
 if(cancellationPipe)await once(cancellationPipe,'connect');
 if(abort.signal.aborted)throw new CliFailure('Cancelled',130);
 const command=parseCli(args,process.cwd());json=command.json;
 if(command.help){return runCli(command,{} as ArchiveService,{out,err,signal:abort.signal,password});}
 await mkdir(cacheParent,{recursive:true});session=await mkdtemp(join(cacheParent,'session-'));process.env.TEMP=session;process.env.TMP=session;
 let lastProgress=0;
 let progressPending=false;
 service=new ArchiveService(session,(_owner,progress)=>{
  if(abort.signal.aborted)service?.cancel(progress.id,0);
  const now=Date.now();if(command.progress&&!progressPending&&(now-lastProgress>=200||progress.done===progress.total&&progress.total>0)){
   lastProgress=now;progressPending=true;void err(JSON.stringify({schema:1,type:'progress',...progress})+'\n').catch(()=>abort.abort()).finally(()=>{progressPending=false;});
  }
 },()=> '0',()=>{},true);
 runtimeCli(profile,'archive-cli-start','started');
 return runCli(command,service,{out,err,signal:abort.signal,password,event:(operation,outcome,duration)=>runtimeCli(profile,'archive-cli-operation',`operation=${operation} outcome=${outcome}`,duration,outcome!=='ok')});
}
void (async()=>{
 let code=1;try{code=await main();}catch(error){code=abort.signal.aborted?130:cliExit(error);const message=error instanceof Error?error.message:'CLI failed';if(json)await out(JSON.stringify({schema:1,type:'error',exitCode:code,message})+'\n');else await err(message+'\n');}
 finally{
  try{await service?.stop();if(session){const child=relative(cacheParent,session);if(child&&!child.startsWith('..')&&!isAbsolute(child))await rm(session,{recursive:true,force:true});}}
  catch{code=1;await err('CLI cleanup failed; temporary data retained\n').catch(()=>{});}
  finally{
   // Keep signal handlers through final log flush and process exit. A repeated
   // key must not become a default hard termination during cleanup.
   cancellationPipe?.destroy();process.exitCode=code;
   if(service){runtimeCli(profile,'archive-cli-exit',`exitCode=${code}`,undefined,code!==0);await flushRuntimeLogs();}
  }
 }
})().catch(async()=>{await err('CLI shutdown failed\n').catch(()=>{});process.exitCode=1;});
