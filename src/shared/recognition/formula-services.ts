import {translationServiceReference,type TranslationServiceReference} from './translation-services';
export type FormulaServiceReference=TranslationServiceReference;
export interface FormulaServiceInput {id?:string;revision?:string;name:string;provider:'simpletex';mode:'standard'|'turbo';appId:string;appSecret?:string;timeoutSeconds:number}
export interface FormulaServiceProfile extends Omit<FormulaServiceInput,'id'|'revision'|'appSecret'> {id:string;revision:string;hasKey:boolean;endpoint:string}
export type RecognitionServiceProfile=Pick<FormulaServiceProfile,'id'|'revision'|'name'|'endpoint'|'hasKey'>;
export const formulaServiceEndpoint=(mode:'standard'|'turbo')=>'https://server.simpletex.cn/api/'+(mode==='turbo'?'latex_ocr_turbo':'latex_ocr');
export function formulaServiceReference(value:unknown):FormulaServiceReference{try{return translationServiceReference(value);}catch{throw Error('公式服务引用无效');}}
export function formulaServiceInput(value:unknown):FormulaServiceInput{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['id','revision','name','provider','mode','appId','appSecret','timeoutSeconds'].includes(key)))throw Error('公式服务配置无效');
  const v=value as FormulaServiceInput;
  if(v.provider!=='simpletex'||!['standard','turbo'].includes(v.mode)||typeof v.name!=='string'||!v.name.trim()||v.name.trim().length>60||/[\x00-\x1f\x7f]/.test(v.name)||typeof v.appId!=='string'||!/^[a-zA-Z0-9_-]{4,128}$/.test(v.appId)||!Number.isInteger(v.timeoutSeconds)||v.timeoutSeconds<5||v.timeoutSeconds>180||v.id!==undefined&&(typeof v.id!=='string'||!/^[a-f\d-]{36}$/i.test(v.id))||v.revision!==undefined&&(typeof v.revision!=='string'||!/^[a-f\d]{64}$/.test(v.revision))||v.appSecret!==undefined&&(typeof v.appSecret!=='string'||v.appSecret.length>4096||/[\x00-\x20\x7f]/.test(v.appSecret)))throw Error('公式服务名称、APP 凭据或参数无效');
  return {id:v.id,revision:v.revision,name:v.name.trim(),provider:'simpletex',mode:v.mode,appId:v.appId,appSecret:v.appSecret,timeoutSeconds:v.timeoutSeconds};
}
