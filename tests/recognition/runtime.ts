import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
const nativeOnly=()=>{throw Error('Native image/clipboard operations require the Electron integration test');};
export const nativeImage={createFromBuffer:nativeOnly};
export const clipboard={write:nativeOnly,read:nativeOnly};
export class ClipboardItem { constructor(..._args:unknown[]){nativeOnly();} }
const key=randomBytes(32);
export const safeStorage={
  isEncryptionAvailable:()=>true,
  encryptString(value:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),bytes=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),bytes]);},
  decryptString(value:Buffer){const decipher=createDecipheriv('aes-256-gcm',key,value.subarray(0,12));decipher.setAuthTag(value.subarray(12,28));return Buffer.concat([decipher.update(value.subarray(28)),decipher.final()]).toString('utf8');},
};
export const session={defaultSession:{resolveProxy:async()=> 'DIRECT'}};
let saveFile:string|undefined;
export function chooseSaveFile(path?:string){saveFile=path;}
export const dialog={showSaveDialog:async()=>({canceled:saveFile===undefined,filePath:saveFile})};
