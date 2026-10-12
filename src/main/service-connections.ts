import {safeStorage} from 'electron';

export type ServiceConnectionPurpose='translation'|'formula';
/** Main-process storage; encrypted records never become renderer-visible settings. */
export interface ServiceConnectionStorage {
  read(purpose:ServiceConnectionPurpose):Promise<unknown|undefined>;
  write(purpose:ServiceConnectionPurpose,value:unknown):Promise<void>;
  clear(purpose:ServiceConnectionPurpose):Promise<void>;
}
export interface ServiceCredentialCrypto {
  available():boolean;
  encrypt(value:string):Buffer;
  decrypt(value:Buffer):string;
}
export const serviceCredentialCrypto:ServiceCredentialCrypto={
  available:()=>safeStorage.isEncryptionAvailable(),
  encrypt:value=>safeStorage.encryptString(value),
  decrypt:value=>safeStorage.decryptString(value),
};
export function serviceConnectionPurpose(value:unknown):asserts value is ServiceConnectionPurpose {
  if(value!=='translation'&&value!=='formula')throw Error('功能服务类型无效');
}
