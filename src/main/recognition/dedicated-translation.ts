import {decodeHTML} from 'entities';
import {serviceRequest} from '../service-request';
import type {TranslationServices} from '../translation-services';
import {translationLanguage,TRANSLATION_OUTPUT,type TranslationLanguage} from '../../shared/recognition/translation';
import type {AITaskParagraph} from '../../shared/ai-task';
import type {TranslationServiceReference} from '../../shared/recognition/translation-services';
import {baiduRequest,baiduResponse,waitForBaidu,BaiduTranslationFailure} from './baidu-translation';
export interface DedicatedParagraph {id:string;text?:string;error?:string;sourceLanguage?:string;model?:string}
class TranslationFailure extends Error {}
const language=(value:unknown)=>typeof value==='string'&&/^[a-z]{2,3}(?:-[a-z\d]{2,8})*$/i.test(value)?value.toLowerCase():undefined;
const model=(value:unknown)=>typeof value==='string'&&value.length<=200&&!/[\r\n\0]/.test(value)?value:undefined;
export class DedicatedTranslation {
  constructor(private services:TranslationServices,private transport:typeof fetch=serviceRequest){}
  async run(reference:TranslationServiceReference,paragraphs:AITaskParagraph[],target:TranslationLanguage,signal:AbortSignal){
    const connection=this.services.connection(reference),to=translationLanguage(target);signal.throwIfAborted();
    if(!Array.isArray(paragraphs)||!paragraphs.length||paragraphs.length>connection.maxItems)throw Error('翻译段落数量超过服务上限');const ids=new Set<string>();let length=0;
    for(const p of paragraphs){if(!p||Object.keys(p).some(key=>!['id','text'].includes(key))||typeof p.id!=='string'||!p.id||p.id.length>160||ids.has(p.id)||typeof p.text!=='string'||!p.text.trim()||p.text.includes('\0'))throw Error('翻译段落无效');ids.add(p.id);length+=p.text.length;}
    if(length>connection.maxCharacters)throw Error('翻译原文超过单批上限');
    const url=new URL(connection.endpoint),headers:Record<string,string>={'Content-Type':'application/json; charset=utf-8'};let body:unknown;
    if(connection.provider==='azure'){url.searchParams.set('api-version','3.0');url.searchParams.set('to',to);url.searchParams.set('textType','plain');headers['Ocp-Apim-Subscription-Key']=connection.key;if(connection.region)headers['Ocp-Apim-Subscription-Region']=connection.region;body=paragraphs.map(p=>({Text:p.text}));}
    else if(connection.provider==='deepl'){headers.Authorization='DeepL-Auth-Key '+connection.key;const target_lang=to==='zh-Hans'?'ZH-HANS':to==='zh-Hant'?'ZH-HANT':to==='en'?'EN-US':to==='pt'?'PT-PT':to.toUpperCase();body={text:paragraphs.map(p=>p.text),target_lang};}
    else if(connection.provider==='baidu'){headers['Content-Type']='application/x-www-form-urlencoded; charset=utf-8';body=baiduRequest(connection.appId!,connection.key,paragraphs[0].text,target);}
    else{headers['X-Goog-Api-Key']=connection.key;body={q:paragraphs.map(p=>p.text),target:to==='zh-Hans'?'zh-CN':to==='zh-Hant'?'zh-TW':to,format:'text'};}
    const json=connection.provider==='baidu'?body as string:JSON.stringify(body);if(Buffer.byteLength(json)>128*1024)throw Error('翻译请求超过服务容量');
    const abort=new AbortController(),cancel=()=>abort.abort('cancelled');signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();const timer=setTimeout(()=>abort.abort('timeout'),connection.timeoutSeconds*1000);timer.unref();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;const cancelReader=()=>{void reader?.cancel().catch(()=>{});};abort.signal.addEventListener('abort',cancelReader,{once:true});
    try{
      if(connection.provider==='baidu'){await waitForBaidu(connection.appId!,abort.signal);abort.signal.throwIfAborted();try{this.services.assertReference(reference);}catch{throw new TranslationFailure('翻译服务配置已改变，请重新选择');}}
      const response=await this.transport(url,{method:'POST',headers,body:json,signal:abort.signal,redirect:'error',credentials:'omit',cache:'no-store'});
      if(!response.ok){await response.body?.cancel();throw new TranslationFailure(({400:'翻译服务不接受当前参数',401:'翻译凭据无效，请重新填写',403:'翻译服务拒绝访问，请检查凭据、套餐与区域',404:'翻译服务不可用',413:'翻译请求过大',429:'翻译请求过于频繁，请稍后重试',456:'翻译服务额度已用完'} as Record<number,string>)[response.status]||'翻译服务暂时不可用');}
      const declared=response.headers.get('content-length');if(declared!==null&&(!Number.isSafeInteger(Number(declared))||Number(declared)<0||Number(declared)>1024*1024)){await response.body?.cancel().catch(()=>{});throw new TranslationFailure('翻译响应超过容量');}reader=response.body?.getReader();if(!reader)throw new TranslationFailure('翻译服务未返回内容');const chunks:Uint8Array[]=[];let bytes=0;
      for(;;){abort.signal.throwIfAborted();const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>1024*1024)throw new TranslationFailure('翻译响应超过容量');chunks.push(part.value);}
      abort.signal.throwIfAborted();let data:any;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new TranslationFailure('翻译服务返回格式无效');}
      const baidu=connection.provider==='baidu'?baiduResponse(data,paragraphs[0].text,target):undefined;
      const output=baidu?[baidu]:connection.provider==='azure'?data:connection.provider==='deepl'?data?.translations:data?.data?.translations;
      if(!Array.isArray(output)||output.length!==paragraphs.length)throw new TranslationFailure('翻译服务返回的段落数量不匹配，无法对应原文');let total=0;
      const result:DedicatedParagraph[]=paragraphs.map((p,index)=>{const item=output[index],translation=connection.provider==='azure'?item?.translations?.find((item:any)=>item?.to===to):item;
        const raw=connection.provider==='google'?translation?.translatedText:translation?.text,text=typeof raw==='string'?(connection.provider==='google'?decodeHTML(raw):raw):undefined;
        if(!text?.trim()||text.includes('\0')||Buffer.from(text,'utf8').toString('utf8')!==text||text.length>TRANSLATION_OUTPUT||total+text.length>TRANSLATION_OUTPUT)return {id:p.id,error:'服务未返回可用的段落译文'};total+=text.length;
        return {id:p.id,text,sourceLanguage:language(baidu?baidu.sourceLanguage:connection.provider==='azure'?item?.detectedLanguage?.language:connection.provider==='deepl'?item?.detected_source_language:item?.detectedSourceLanguage),model:model(connection.provider==='deepl'?item?.model_type_used:item?.model)};
      });try{this.services.assertReference(reference);}catch{throw new TranslationFailure('翻译服务配置已改变，请重新选择');}return {paragraphs:result,model:result.find(p=>p.model)?.model};
    }catch(error){if(abort.signal.aborted)throw new TranslationFailure(abort.signal.reason==='timeout'?'翻译服务请求超时':'翻译已取消');if(error instanceof TranslationFailure||error instanceof BaiduTranslationFailure)throw error;throw new TranslationFailure('无法连接翻译服务，请检查网络或重新填写凭据');}
    finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);abort.signal.removeEventListener('abort',cancelReader);await reader?.cancel().catch(()=>{});reader?.releaseLock();}
  }
}
