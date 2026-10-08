import {open,unlink} from 'node:fs/promises';
import {dirname,resolve,isAbsolute} from 'node:path';
import type {FileActionTarget} from '../shared/explorer-menu';
import {archiveShellAction,isArchivePath} from '../shared/archive-actions';
export async function readShellRequest(args:string[],profile:string):Promise<FileActionTarget|undefined>{
 const arg=args.find(a=>a.startsWith('--one-shell-request='));if(!arg)return;
 const path=resolve(arg.slice('--one-shell-request='.length)),root=resolve(profile,'shell-requests');
 if(dirname(path).toLowerCase()!==root.toLowerCase()||!/[\\/][a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/i.test(path))throw Error('右键菜单请求路径无效');
 const handle=await open(path,'r');let value;
 try{const info=await handle.stat();if(!info.isFile()||info.size>4*1024*1024||Date.now()-info.mtimeMs>5*60*1000)throw Error('右键菜单请求已失效');value=JSON.parse(await handle.readFile('utf8'));}finally{await handle.close();}
 const action=typeof value?.tool==='string'?archiveShellAction(value.tool):undefined;
 if(!value||(!action&&!['locksmith','rename'].includes(value.tool))||!Array.isArray(value.paths)||!value.paths.length||value.paths.length>(action?128:value.tool==='locksmith'?32:4096)||value.paths.some((p:unknown)=>typeof p!=='string'||p.length>32767||!isAbsolute(p)||/[\x00\r\n]/.test(p)))throw Error('右键菜单选择无效');
 if(action&&action!=='create'&&value.paths.some((p:string)=>!isArchivePath(p)))throw Error('所选文件不是支持的压缩包');
 const seen=new Set<string>(),paths:string[]=value.paths.filter((p:string)=>{const key=resolve(p).toLowerCase();if(seen.has(key))return false;seen.add(key);return true;});
 await unlink(path);return{tool:value.tool,paths};
}
