import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import type {LookupFunction} from 'node:net';
import type {LinkCard} from '../shared/types';

export function externalURL(value:unknown){
  if(typeof value!=='string'||value.length>4096)throw new Error('链接无效');
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('只支持网页链接');
  return url;
}

function publicIPv4(value:string){
  const parts=value.split('.').map(Number);if(parts.length!==4||parts.some(x=>!Number.isInteger(x)||x<0||x>255))return false;
  const [a,b,c]=parts;
  return a!==0&&a!==10&&a!==127&&a<224&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&b===168)&&!(a===100&&b>=64&&b<=127)&&!(a===198&&b===18||a===198&&b===19)&&!(a===192&&b===0&&c===0);
}

async function publicAddress(hostname:string){
  if(isIP(hostname))return isIP(hostname)===4&&publicIPv4(hostname)?hostname:undefined;
  const addresses=await lookup(hostname,{family:4,all:true,verbatim:true});
  return addresses.find(item=>publicIPv4(item.address))?.address;
}

async function download(url:URL,limit:number,redirects=0):Promise<{body:Buffer;type:string;url:URL}|null>{
  if(redirects>3)return null;
  const address=await publicAddress(url.hostname).catch(()=>undefined);if(!address)return null;
  const transport=url.protocol==='https:'?httpsRequest:httpRequest;
  return new Promise(resolve=>{
    const lookupPinned=((_host:string,options:{all?:boolean},callback:(error:Error|null,value:string|{address:string;family:number}[],family?:number)=>void)=>{
      if(options.all)callback(null,[{address,family:4}]);else callback(null,address,4);
    }) as LookupFunction;
    const request=transport(url,{lookup:lookupPinned,timeout:3500,headers:{'User-Agent':'OneLinkPreview/1.0','Accept':'text/html,image/*;q=0.8','Accept-Encoding':'identity'}},response=>{
      const status=response.statusCode||0;
      if(status>=300&&status<400&&response.headers.location){response.resume();try{const target=externalURL(new URL(response.headers.location,url).href);void download(target,limit,redirects+1).then(resolve).catch(()=>resolve(null));}catch{resolve(null);}return;}
      const type=String(response.headers['content-type']||'').toLowerCase();
      if(status!==200||!(/text\/html|image\/(?:png|jpeg|webp|gif)/.test(type))){response.resume();resolve(null);return;}
      let size=0;const chunks:Buffer[]=[];
      response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>limit){request.destroy();resolve(null);}else chunks.push(chunk);});
      response.on('end',()=>resolve({body:Buffer.concat(chunks),type,url}));
      response.on('error',()=>resolve(null));
    });
    request.on('timeout',()=>request.destroy());request.on('error',()=>resolve(null));request.end();
  });
}

function attribute(tag:string,key:string){
  const found=new RegExp(`(?:^|\\s)${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,'i').exec(tag);
  return found?.[1]??found?.[2]??found?.[3]??'';
}
function plain(value:string){
  return value.replace(/<[^>]*>/g,' ').replace(/&(?:amp|lt|gt|quot|apos|nbsp|#(\d+)|#x([a-f\d]+));/gi,(_match,decimal,hex)=>decimal?String.fromCodePoint(Number(decimal)):hex?String.fromCodePoint(parseInt(hex,16)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '} as Record<string,string>)[_match.slice(1,-1).toLowerCase()]||' ').replace(/\s+/g,' ').trim().slice(0,500);
}

async function describe(url:URL):Promise<LinkCard>{
  const fallback:LinkCard={domain:url.hostname.replace(/^www\./,''),title:'',description:''};
  const response=await download(url,256*1024).catch(()=>null);if(!response||!response.type.includes('text/html'))return fallback;
  const html=new TextDecoder('utf-8').decode(response.body);
  const tags=html.match(/<meta\b[^>]*>/gi)||[];
  const meta=(key:string)=>{
    const tag=tags.find(value=>attribute(value,'property').toLowerCase()===key||attribute(value,'name').toLowerCase()===key);
    return tag?plain(attribute(tag,'content')):'';
  };
  fallback.title=meta('og:title')||plain(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]||'');
  fallback.description=meta('og:description')||meta('description');
  const image=meta('og:image');
  if(image){
    try{const imageURL=externalURL(new URL(image,response.url).href);const picture=await download(imageURL,250*1024);if(picture?.type.startsWith('image/'))fallback.image=`data:${picture.type.split(';')[0]};base64,${picture.body.toString('base64')}`;}catch{/* Text metadata is still useful. */}
  }
  return fallback;
}

type CacheEntry={promise:Promise<LinkCard>;bytes:number;expires:number};

export class LinkCardCache {
  private entries=new Map<string,CacheEntry>();
  private bytes=0;
  constructor(private readonly loader:(url:URL)=>Promise<LinkCard>,private readonly maxBytes=6*1024*1024,private readonly maxEntries=64,private readonly ttlMs=10*60*1000,private readonly now=Date.now){}
  get retainedBytes(){return this.bytes;}
  get size(){return this.entries.size;}
  private remove(key:string,entry:CacheEntry){this.entries.delete(key);this.bytes-=entry.bytes;}
  private trim(){
    while(this.entries.size>this.maxEntries||this.bytes>this.maxBytes){
      const first=this.entries.entries().next().value as [string,CacheEntry]|undefined;
      if(!first)break;
      this.remove(first[0],first[1]);
    }
  }
  get(value:unknown){
    const url=externalURL(value),key=url.href,now=this.now();
    const existing=this.entries.get(key);
    if(existing){
      if(existing.expires>now){this.entries.delete(key);this.entries.set(key,existing);return existing.promise;}
      this.remove(key,existing);
    }
    const entry:CacheEntry={promise:Promise.resolve({domain:'',title:'',description:''}),bytes:0,expires:now+this.ttlMs};
    entry.promise=this.loader(url).catch(():LinkCard=>({domain:url.hostname,title:'',description:''})).then(result=>{
      if(this.entries.get(key)===entry){
        entry.bytes=2*(result.domain.length+result.title.length+result.description.length+(result.image?.length||0));
        this.bytes+=entry.bytes;
        this.trim();
      }
      return result;
    });
    this.entries.set(key,entry);
    this.trim();
    return entry.promise;
  }
}

const cache=new LinkCardCache(describe);
export function linkCard(value:unknown){return cache.get(value);}
