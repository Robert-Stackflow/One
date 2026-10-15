import {webTopLevelDomains} from './url-tlds';
import type {SearchEntry} from './search';

/** Web addresses only: never pass arbitrary URI schemes to the operating system. */
const localSuffixes=new Set(['localhost','local','lan','internal','test','example','invalid','onion']);
export function searchUrl(value:unknown):string|null{
  if(typeof value!=='string'||value.length>8192)return null;
  const text=value.trim();
  if(!text||/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069\\]/.test(text)||/^[a-z]:[/\\]/i.test(text))return null;
  const explicit=/^https?:/i.test(text),relative=text.startsWith('//');
  const authority=(relative?text.slice(2):text).split(/[/?#]/,1)[0];
  const ipv4=/^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(authority);
  const local=/^(?:localhost|[a-z0-9_-]+):\d+$/i.test(authority)||/^localhost$/i.test(authority);
  const ipv6=/^\[[0-9a-f:.]+\](?::\d+)?$/i.test(authority);
  if(!explicit&&!relative&&!ipv4&&!local&&!ipv6){
    const host=authority.replace(/:\d+$/,'').replace(/[\u3002\uff0e\uff61]/g,'.');
    if(/[\s@:]|^\./.test(host)||!host.includes('.'))return null;
  }
  try{
    const url=new URL(explicit?text:relative?'https:'+text:(ipv4||local||ipv6?'http://':'https://')+text);
    if(!['http:','https:'].includes(url.protocol)||!url.hostname)return null;
    if(!url.hostname.startsWith('[')){
      const labels=url.hostname.replace(/\.$/,'').split('.');
      if(labels.some(label=>!label||label.length>63||!/^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/i.test(label)))return null;
      if(!explicit&&!relative&&!ipv4&&!local&&!ipv6&&!/:\d+$/.test(authority)&&(labels.length<2||!webTopLevelDomains.has(labels.at(-1)!)&&!localSuffixes.has(labels.at(-1)!)))return null;
    }
    return url.href.length<=8192?url.href:null;
  }catch{return null;}
}
export function urlSearchEntry(value:string):SearchEntry|null{
  const url=searchUrl(value);
  return url?{path:url,name:'在浏览器打开网页',subtitle:url,launchKind:'url',directory:false,size:0,modified:0}:null;
}
