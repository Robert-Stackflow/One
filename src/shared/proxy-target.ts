export function normalizeProxyTarget(value:unknown):string {
 if(typeof value!=='string'||value.length>4096||/[\u0000-\u0020\u007f]/.test(value.trim()))throw Error('请输入完整的 HTTP / HTTPS 地址或域名');
 const input=value.trim();
 if(!input)throw Error('请输入要检测的地址');
 let url:URL;
 try{url=new URL(/^[a-z][\w+.-]*:\/\//i.test(input)?input:`https://${input}`);}catch{throw Error('地址格式无效');}
 if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.username||url.password)throw Error('仅支持不含用户名和密码的 HTTP / HTTPS 地址');
 url.hash='';return url.href;
}
// Reports and errors never carry query strings, credentials or fragments.
export function publicProxyUrl(value:string):string {
 try{const url=new URL(value),query=!!url.search;url.username='';url.password='';url.search='';url.hash='';return url.href+(query?'?[参数已隐藏]':'');}catch{return '地址不可用';}
}
