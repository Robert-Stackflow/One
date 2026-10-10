export const maxBase64FileBytes=6*1024*1024;
export function normalizeBase64(value:string){
 if(value.length>10_000_000)throw Error('Base64 内容超过 10 MB 上限');
 const normalized=value.replace(/\s/g,'');
 if(normalized.length%4!==0||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized))throw Error('Base64 内容无效，请检查字符和填充');
 if(normalized.length>8*1024*1024)throw Error('解码后的文件可能超过 6 MB 上限');
 return normalized;
}
