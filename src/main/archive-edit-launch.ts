import {spawn} from 'node:child_process';
import {join} from 'node:path';
export type ArchiveEditLaunchMode='associated'|'text'|'choose';
export type ArchiveEditLaunch={tracked:boolean;exited:Promise<'closed'|'unknown'>;release:()=>void};
export type ArchiveEditLauncher=(file:string,mode:ArchiveEditLaunchMode,signal:AbortSignal)=>Promise<ArchiveEditLaunch>;

/** Own only the observer process. Releasing it never terminates the user's editor. */
export const launchArchiveEditor:ArchiveEditLauncher=(file,mode,signal)=>new Promise((resolve,reject)=>{
 if(signal.aborted){reject(Error('打开编辑程序已停止，副本已保留'));return;}
 const helper=join(__dirname,'../native/One.OpenWith.exe').replace('app.asar\\','app.asar.unpacked\\');
 const child=spawn(helper,['edit-monitor',file,mode],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let started=false,buffer='',detail='',ended=false,releaseExit!:(state:'closed'|'unknown')=>void;
 const exited=new Promise<'closed'|'unknown'>(done=>releaseExit=done);
 const finish=(state:'closed'|'unknown')=>{if(ended)return;ended=true;releaseExit(state);signal.removeEventListener('abort',abort);clearTimeout(timer);};
 const release=()=>{finish('unknown');if(child.exitCode===null)child.kill();};
 const fail=(error:Error)=>{if(!started)reject(error);release();};
 const abort=()=>fail(Error('打开编辑程序已停止，副本已保留'));
 const timer=mode==='choose'?undefined:setTimeout(()=>fail(Error('编辑程序启动超时，副本已保留，请查看位置后手动打开')),15000);timer?.unref();
 child.stdout.on('data',data=>{
  buffer+=data.toString('utf8');if(buffer.length>4096)return fail(Error('编辑程序观察器返回无效数据'));
  let newline:number;while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
   try{const value=JSON.parse(line);if(value.type==='launched'&&!started&&typeof value.tracked==='boolean'){started=true;clearTimeout(timer);resolve({tracked:value.tracked,exited,release});if(!value.tracked)finish('unknown');}
    else if(value.type==='exited'&&started)finish('closed');else throw Error();
   }catch{return fail(Error('编辑程序观察器返回无效数据'));}
  }
 });
 child.stderr.on('data',data=>{if(detail.length<1024)detail+=data.toString('utf8').slice(0,1024-detail.length);});
 child.once('error',error=>fail(error));child.once('close',()=>{if(!started)reject(Error(/800704c7/i.test(detail)?'已取消选择编辑程序，副本已保留':'无法打开编辑程序，副本已保留；可选择其他编辑程序'));finish('unknown');});
 signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
});
