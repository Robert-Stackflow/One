import {randomUUID,createHash} from 'node:crypto';
import {serviceCredentialCrypto,type ServiceCredentialCrypto} from './service-connections';
import {translationServiceInput,translationServiceEndpoint,translationServiceLimits,translationServiceLanguages,translationServiceReference,type TranslationServiceInput,type TranslationServiceProfile,type TranslationServiceReference} from '../shared/recognition/translation-services';
interface Stored extends Omit<TranslationServiceInput,'apiKey'|'revision'|'id'> {id:string;encrypted:string}
/** Same ai-data settings store, independent of chat Profiles and conversations. */
export class TranslationServices {
  constructor(private read:()=>unknown,private write:(records:unknown)=>void,private crypto:ServiceCredentialCrypto=serviceCredentialCrypto){}
  private records():Stored[]{
    const value=this.read();if(value===undefined)return [];
    if(!Array.isArray(value)||value.length>32)throw Error('翻译服务配置无法读取');const ids=new Set<string>();
    return value.map(record=>{
      if(!record||typeof record!=='object'||Array.isArray(record)||typeof record.encrypted!=='string'||!record.encrypted||record.encrypted.length>24000||!/^[\da-z+/]+=*$/i.test(record.encrypted))throw Error('翻译服务配置无法读取');
      const {encrypted,...fields}=record;let checked:TranslationServiceInput;try{checked=translationServiceInput(fields);}catch{throw Error('翻译服务配置无法读取');}
      if(!checked.id||checked.apiKey!==undefined||checked.revision!==undefined||ids.has(checked.id))throw Error('翻译服务配置无法读取');ids.add(checked.id);
      return {id:checked.id,name:checked.name,provider:checked.provider,plan:checked.plan,region:checked.region,timeoutSeconds:checked.timeoutSeconds,encrypted};
    });
  }
  private revision(record:Stored){return createHash('sha256').update(JSON.stringify(record)).digest('hex');}
  private public(record:Stored):TranslationServiceProfile{const {encrypted,...fields}=record;return {...fields,revision:this.revision(record),hasKey:!!encrypted&&this.crypto.available(),endpoint:translationServiceEndpoint(record.provider,record.plan),...translationServiceLimits(record.provider),languages:translationServiceLanguages(),capabilities:{batch:true,detectLanguage:true,glossary:false,images:false,quota:'unknown'}};}
  list(){return this.records().map(record=>this.public(record));}
  reference(id:string){const profile=this.list().find(profile=>profile.id===id);if(!profile)throw Error('翻译服务已删除，请重新选择');return {serviceId:id,revision:profile.revision};}
  assertReference(value:unknown){const ref=translationServiceReference(value),profile=this.list().find(profile=>profile.id===ref.serviceId);if(!profile||profile.revision!==ref.revision)throw Error('翻译服务配置已改变，请重新选择');if(!profile.hasKey)throw Error('系统加密不可用，无法读取翻译密钥');return profile;}
  connection(value:unknown){const profile=this.assertReference(value),record=this.records().find(record=>record.id===profile.id)!,bytes=Buffer.from(record.encrypted,'base64');
    try{const key=this.crypto.decrypt(bytes);if(!key||key.length>4096||/[\x00-\x20\x7f]/.test(key))throw Error();return {...profile,key};}catch{throw Error('翻译密钥无法读取，请在服务管理中重新填写');}finally{bytes.fill(0);}
  }
  save(value:unknown){
    const input=translationServiceInput(value),records=this.records(),previous=input.id?records.find(record=>record.id===input.id):undefined;
    if(input.id&&(!previous||input.revision!==this.revision(previous)))throw Error('翻译服务已改变，请重新打开配置');
    if(!previous&&records.length>=32)throw Error('翻译服务数量已满');if(!this.crypto.available())throw Error('系统加密不可用，无法保存翻译密钥');
    const same=previous&&translationServiceEndpoint(previous.provider,previous.plan)===translationServiceEndpoint(input.provider,input.plan);
    if(!input.apiKey&&!same)throw Error('首次配置或更换服务接口后，请重新填写密钥');
    let bytes:Buffer;try{bytes=input.apiKey?this.crypto.encrypt(input.apiKey):Buffer.from(previous!.encrypted,'base64');}catch{throw Error('翻译密钥无法加密');}
    try{if(!bytes.length||bytes.length>16000)throw Error('翻译密钥无法加密');const id=previous?.id||randomUUID(),record:Stored={id,name:input.name,provider:input.provider,plan:input.plan,region:input.region,timeoutSeconds:input.timeoutSeconds,encrypted:bytes.toString('base64')};
      this.write(previous?records.map(item=>item.id===id?record:item):[...records,record]);return this.public(record);
    }finally{bytes.fill(0);}
  }
  remove(id:unknown,revision:unknown){const records=this.records(),record=records.find(record=>record.id===id);if(!record||this.revision(record)!==revision)throw Error('翻译服务已改变，请刷新后重试');this.write(records.filter(record=>record.id!==id));}
  importAzure(region:string,key:string,name:string):TranslationServiceReference{
    for(const profile of this.list()){if(profile.provider==='azure'&&profile.region===region){try{if(this.connection({serviceId:profile.id,revision:profile.revision}).key===key)return {serviceId:profile.id,revision:profile.revision};}catch{}}}
    const profile=this.save({name,provider:'azure',plan:'pro',region,timeoutSeconds:45,apiKey:key});return {serviceId:profile.id,revision:profile.revision};
  }
}
