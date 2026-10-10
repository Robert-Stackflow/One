export type URLCodecScope='url'|'parameter';
export type URLCodecAction='encode'|'decode';
export function transformURL(text:string,scope:URLCodecScope,action:URLCodecAction){
 if(typeof text!=='string'||text.length>2*1024*1024)throw Error('输入不能超过 2 MB');
 if(scope!=='url'&&scope!=='parameter'||action!=='encode'&&action!=='decode')throw Error('操作无效');
 try{
  const result=action==='encode'?(scope==='url'?encodeURI(text):encodeURIComponent(text)):(scope==='url'?decodeURI(text):decodeURIComponent(text.replace(/\+/g,'%20')));
  if(result.length>10_000_000)throw Error('结果超过 10 MB 上限');
  return result;
 }catch(error){if(error instanceof URIError)throw Error(action==='decode'?'URL 编码无效，请检查 % 后的十六进制字符和 UTF-8 字节':'文本包含无法编码的字符');throw error;}
}
