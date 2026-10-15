import {createHash,randomBytes} from 'node:crypto';
import type {TranslationLanguage} from '../../shared/recognition/translation';
export const baiduLanguages:Record<TranslationLanguage,string>={'zh-Hans':'zh','zh-Hant':'cht',en:'en',ja:'jp',ko:'kor',fr:'fra',de:'de',es:'spa',ru:'ru',pt:'pt',it:'it',ar:'ara'};
export const baiduSignature=(appId:string,text:string,salt:string,key:string)=>createHash('md5').update(appId+text+salt+key,'utf8').digest('hex');
export function baiduRequest(appId:string,key:string,text:string,target:TranslationLanguage){
  if(Buffer.byteLength(text,'utf8')>6000||Buffer.from(text,'utf8').toString('utf8')!==text)throw Error('百度翻译原文超过容量或编码无效');
  const salt=randomBytes(16).toString('hex');return new URLSearchParams({q:text,from:'auto',to:baiduLanguages[target],appid:appId,salt,sign:baiduSignature(appId,text,salt,key)}).toString();
}
export class BaiduTranslationFailure extends Error {}
const failures:Record<string,string>={'52001':'百度翻译请求超时','52002':'百度翻译服务暂时不可用','52003':'百度翻译服务未授权，请检查 APPID 和开通状态','54000':'百度翻译参数不完整','54001':'百度翻译签名无效，请检查 APPID 和密钥','54003':'百度翻译请求过于频繁，请稍后重试','54004':'百度翻译账户余额不足','54005':'百度翻译长文本请求过于频繁，请稍后重试','58000':'百度翻译拒绝当前 IP，请检查访问设置','58001':'百度翻译不支持当前语言方向','58002':'百度翻译服务未开通','58003':'百度翻译暂时限制当前 IP','90107':'百度翻译账户认证未完成'};
export function baiduResponse(value:any,source:string,target:TranslationLanguage){
  if(value?.error_code!==undefined)throw new BaiduTranslationFailure(failures[String(value.error_code)]||'百度翻译请求失败，请检查服务状态');
  const result=value?.trans_result;if(value?.to!==baiduLanguages[target]||!Array.isArray(result)||!result.length||result.some(item=>typeof item?.src!=='string'||typeof item?.dst!=='string'))throw new BaiduTranslationFailure('百度翻译返回格式无效');
  let text:string;
  if(result.length===1&&result[0].src===source)text=result[0].dst;
  else{
    const pieces=source.split(/(\r\n|\r|\n)/),lines=pieces.filter((line,index)=>index%2===0&&!!line.trim());
    if(lines.length!==result.length||lines.some((line,index)=>result[index].src!==line&&result[index].src!==line.trim()))throw new BaiduTranslationFailure('百度翻译返回的原文无法对应，已保留当前译文');
    let index=0;text=pieces.map((line,position)=>position%2||!line.trim()?line:(()=>{const item=result[index++];return item.src===line?item.dst:line.slice(0,line.length-line.trimStart().length)+item.dst+line.slice(line.trimEnd().length);})()).join('');
  }
  const names:Record<string,string>={zh:'zh-Hans',cht:'zh-Hant',jp:'ja',kor:'ko',fra:'fr',spa:'es',ara:'ar'},detected=names[value.from]||value.from;
  return {text,sourceLanguage:typeof detected==='string'&&/^[a-z]{2,3}(?:-[a-z\d]{2,8})*$/i.test(detected)?detected.toLowerCase():undefined};
}
/** One conservative request per second for each APPID, shared by OCR windows and service records. */
const starts=new Map<string,number>();
export async function waitForBaidu(appId:string,signal:AbortSignal){
  for(;;){
    signal.throwIfAborted();const now=Date.now(),delay=(starts.get(appId)||0)+1050-now;
    if(delay<=0){for(const [id,time] of starts)if(now-time>60000)starts.delete(id);if(starts.size>=256&&!starts.has(appId))throw new BaiduTranslationFailure('翻译账户切换过于频繁，请稍后重试');starts.set(appId,now);return;}
    await new Promise<void>((resolve,reject)=>{const cancel=()=>{clearTimeout(timer);reject(signal.reason);},timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},delay);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();});
  }
}
