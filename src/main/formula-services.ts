import {randomUUID,createHash} from 'node:crypto';
import {serviceCredentialCrypto,type ServiceCredentialCrypto} from './service-connections';
import {formulaServiceInput,formulaServiceEndpoint,formulaServiceReference,type FormulaServiceInput,type FormulaServiceProfile} from '../shared/recognition/formula-services';
interface Stored extends Omit<FormulaServiceInput,'id'|'revision'|'appSecret'> {id:string;encrypted:string}
export class FormulaServices {
  constructor(private read:()=>unknown,private write:(value:unknown)=>void,private crypto:ServiceCredentialCrypto=serviceCredentialCrypto){}
  private records():Stored[]{
    const value=this.read();if(value===undefined)return [];if(!Array.isArray(value)||value.length>16)throw Error('公式服务配置无法读取');const ids=new Set<string>();
    return value.map(record=>{if(!record||typeof record!=='object'||Array.isArray(record)||typeof record.encrypted!=='string'||!record.encrypted||record.encrypted.length>24000||!/^[a-z\d+/]+=*$/i.test(record.encrypted))throw Error('公式服务配置无法读取');
      const {encrypted,...fields}=record,checked=formulaServiceInput(fields);if(!checked.id||checked.appSecret!==undefined||checked.revision!==undefined||ids.has(checked.id))throw Error('公式服务配置无法读取');ids.add(checked.id);return {id:checked.id,name:checked.name,provider:checked.provider,mode:checked.mode,appId:checked.appId,timeoutSeconds:checked.timeoutSeconds,encrypted};});
  }
  private revision(record:Stored){return createHash('sha256').update(JSON.stringify(record)).digest('hex');}
  private public(record:Stored):FormulaServiceProfile{const {encrypted,...fields}=record;return {...fields,revision:this.revision(record),hasKey:!!encrypted&&this.crypto.available(),endpoint:formulaServiceEndpoint(record.mode)};}
  list(){return this.records().map(record=>this.public(record));}
  assertReference(value:unknown){const ref=formulaServiceReference(value),profile=this.list().find(record=>record.id===ref.serviceId);if(!profile||profile.revision!==ref.revision)throw Error('公式服务已删除或配置已改变，请重新选择');if(!profile.hasKey)throw Error('系统加密不可用，无法读取公式服务密钥');return profile;}
  connection(value:unknown){const profile=this.assertReference(value),record=this.records().find(record=>record.id===profile.id)!,bytes=Buffer.from(record.encrypted,'base64');
    try{const key=this.crypto.decrypt(bytes);if(!key||key.length>4096||/[\x00-\x20\x7f]/.test(key))throw Error();return {...profile,key};}catch{throw Error('公式服务密钥无法读取，请重新填写');}finally{bytes.fill(0);}
  }
  save(value:unknown){
    const input=formulaServiceInput(value),records=this.records(),previous=input.id?records.find(record=>record.id===input.id):undefined;
    if(input.id&&(!previous||input.revision!==this.revision(previous)))throw Error('公式服务已改变，请重新打开配置');if(!previous&&records.length>=16)throw Error('公式服务数量已满');
    if(!this.crypto.available())throw Error('系统加密不可用，不能保存公式密钥');
    if(previous&&previous.appId!==input.appId&&!input.appSecret)throw Error('更换 APP ID 后请重新填写 APP Secret');
    let encrypted=previous?.encrypted;if(input.appSecret){let bytes:Buffer|undefined;try{bytes=this.crypto.encrypt(input.appSecret);if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>16000)throw Error();encrypted=bytes.toString('base64');}catch{throw Error('公式服务密钥无法加密');}finally{bytes?.fill(0);}}
    if(!encrypted)throw Error('请填写个人应用的 APP Secret');
    const record:Stored={id:previous?.id||randomUUID(),name:input.name,provider:'simpletex',mode:input.mode,appId:input.appId,timeoutSeconds:input.timeoutSeconds,encrypted};
    this.write([...records.filter(value=>value.id!==record.id),record]);return this.public(record);
  }
  remove(id:unknown,revision:unknown){const records=this.records(),record=records.find(record=>record.id===id);if(!record||this.revision(record)!==revision)throw Error('公式服务已改变，请刷新后重试');this.write(records.filter(value=>value!==record));}
}
