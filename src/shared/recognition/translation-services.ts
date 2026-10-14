import {translationLanguages,type TranslationLanguage} from './translation';
export type DedicatedTranslationKind='azure'|'deepl'|'google';
export interface TranslationServiceReference {serviceId:string;revision:string}
export interface TranslationServiceInput {id?:string;revision?:string;name:string;provider:DedicatedTranslationKind;plan:'free'|'pro';region:string;timeoutSeconds:number;apiKey?:string}
export interface TranslationServiceProfile extends Omit<TranslationServiceInput,'apiKey'|'id'|'revision'> {id:string;revision:string;hasKey:boolean;endpoint:string;maxCharacters:number;maxItems:number;languages:TranslationLanguage[];capabilities:{batch:true;detectLanguage:true;glossary:false;images:false;quota:'unknown'}}
export const translationServiceLabels={azure:'Azure Translator',deepl:'DeepL',google:'Google Cloud Translation'};
export function translationServiceEndpoint(provider:DedicatedTranslationKind,plan:'free'|'pro'){
  return provider==='azure'?'https://api.cognitive.microsofttranslator.com/translate':provider==='deepl'?(plan==='free'?'https://api-free.deepl.com/v2/translate':'https://api.deepl.com/v2/translate'):'https://translation.googleapis.com/language/translate/v2';
}
export function translationServiceLimits(provider:DedicatedTranslationKind){return provider==='azure'?{maxCharacters:10000,maxItems:1000}:provider==='deepl'?{maxCharacters:12000,maxItems:50}:{maxCharacters:5000,maxItems:128};}
export function translationServiceLanguages(){return Object.keys(translationLanguages) as TranslationLanguage[];}
export function translationServiceReference(value:unknown):TranslationServiceReference{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['serviceId','revision'].includes(key)))throw Error('翻译服务引用无效');
  const ref=value as TranslationServiceReference;if(typeof ref.serviceId!=='string'||!ref.serviceId.trim()||ref.serviceId.length>200||/[\r\n\0]/.test(ref.serviceId)||typeof ref.revision!=='string'||!/^[a-f0-9]{64}$/.test(ref.revision))throw Error('翻译服务引用无效');return {...ref};
}
export function translationServiceInput(value:unknown):TranslationServiceInput{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['id','revision','name','provider','plan','region','timeoutSeconds','apiKey'].includes(key)))throw Error('翻译服务配置无效');
  const v=value as TranslationServiceInput;
  if(typeof v.name!=='string'||!v.name.trim()||v.name.trim().length>60||/[\x00-\x1f\x7f]/.test(v.name)||!Object.hasOwn(translationServiceLabels,v.provider)||!['free','pro'].includes(v.plan)||typeof v.region!=='string'||v.region.length>64||!/^[a-z\d-]*$/i.test(v.region)||!Number.isInteger(v.timeoutSeconds)||v.timeoutSeconds<5||v.timeoutSeconds>180||(v.id!==undefined&&(typeof v.id!=='string'||!/^[a-f\d-]{36}$/i.test(v.id)))||(v.revision!==undefined&&(typeof v.revision!=='string'||!/^[a-f\d]{64}$/.test(v.revision)))||(v.apiKey!==undefined&&(typeof v.apiKey!=='string'||v.apiKey.length>4096||/[\x00-\x20\x7f]/.test(v.apiKey))))throw Error('翻译服务名称、凭据或参数无效');
  return {id:v.id,revision:v.revision,name:v.name.trim(),provider:v.provider,plan:v.provider==='deepl'?v.plan:'pro',region:v.provider==='azure'?v.region:'',timeoutSeconds:v.timeoutSeconds,apiKey:v.apiKey};
}
