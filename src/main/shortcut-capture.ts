import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {join} from 'node:path';

export type CapturedShortcut={vk?:number;ctrlKey?:boolean;altKey?:boolean;shiftKey?:boolean;metaKey?:boolean;released?:boolean};

/** A short-lived low-level hook used only while the main shortcut field has focus. */
export class ShortcutCapture {
  private child:ChildProcessWithoutNullStreams|null=null;
  async start(hwnd:bigint,onKey:(key:CapturedShortcut)=>void){
    this.stop();
    const file=join(__dirname,'../native/One.Shortcut.exe').replace('app.asar\\','app.asar.unpacked\\');
    const child=spawn(file,[String(hwnd)],{windowsHide:true,stdio:'pipe'});
    this.child=child;
    let buffer='',settled=false;
    await new Promise<void>((resolve,reject)=>{
      const fail=(error:Error)=>{if(settled)return;settled=true;clearTimeout(timer);if(this.child===child)this.stop();reject(error);};
      const timer=setTimeout(()=>fail(new Error('快捷键录入未能启动')),3000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data',(part:string)=>{if(this.child!==child)return;buffer+=part;if(buffer.length>4096){fail(new Error('快捷键录入响应异常'));return;}let at;
        while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);try{const event=JSON.parse(line) as CapturedShortcut&{ready?:boolean};
          if(event.ready){if(!settled){settled=true;clearTimeout(timer);resolve();}}else if(settled)onKey(event);
        }catch{}}
      });
      child.on('error',fail);
      child.on('exit',code=>{if(this.child===child)this.child=null;if(!settled)fail(new Error(`快捷键录入已退出 (${code})`));});
      child.stderr.resume();child.stdin.on('error',()=>{});
    });
  }
  stop(){const child=this.child;this.child=null;if(child&&!child.killed){child.stdin.end('q\n');setTimeout(()=>{if(child.exitCode===null)child.kill();},500).unref();}}
}
