import {watch,type FSWatcher} from 'node:fs';
import {mkdir,readdir,stat} from 'node:fs/promises';
import {join} from 'node:path';

const requestName=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/i;

export class ShellRequestInbox {
 private watcher?:FSWatcher;
 private interval?:ReturnType<typeof setInterval>;
 private delayed?:ReturnType<typeof setTimeout>;
 private scanning=false;
 constructor(private profile:string,private receive:(path:string)=>Promise<void>){}
 async start(){
  const root=join(this.profile,'shell-requests');
  await mkdir(root,{recursive:true});
  try{
   this.watcher=watch(root,()=>this.schedule());
   this.watcher.on('error',()=>{this.watcher?.close();this.watcher=undefined;});
  }catch{/* The timer still recovers requests if directory watching is unavailable. */}
  this.interval=setInterval(()=>void this.scan().catch(()=>{}),5000);
  this.interval.unref();
  await this.scan();
 }
 stop(){this.watcher?.close();this.watcher=undefined;clearInterval(this.interval);clearTimeout(this.delayed);}
 private schedule(){clearTimeout(this.delayed);this.delayed=setTimeout(()=>void this.scan().catch(()=>{}),150);this.delayed.unref();}
 private async scan(){
  if(this.scanning)return;
  this.scanning=true;
  try{
   const root=join(this.profile,'shell-requests');
   for(const name of await readdir(root)){
    if(!requestName.test(name))continue;
    const path=join(root,name),info=await stat(path).catch(()=>null);
    if(!info?.isFile()||Date.now()-info.mtimeMs>5*60*1000||info.size>4*1024*1024)continue;
    await this.receive(path);
   }
  }finally{this.scanning=false;}
 }
}
