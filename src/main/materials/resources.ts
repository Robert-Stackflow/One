import {randomUUID} from 'node:crypto';
import type {MaterialLibrary} from './library';
import {recordingProjectPreview} from '../recording/recording-project';

type Kind='image'|'image-thumbnail'|'recording'|'recording-thumbnail';
interface Grant {owner:number;id:string;kind:Kind;key:string}
/** Per-window capabilities. The single One session request guard checks owner/frame before dispatch. */
export class MaterialResources {
  private grants=new Map<string,Grant>();
  private keys=new Map<string,string>();
  constructor(private library:MaterialLibrary,private allowed:(owner:number)=>boolean){}
  url(owner:number,id:string,kind:Kind){
    if(!this.allowed(owner))throw Error('素材窗口已关闭');
    if(kind==='image'||kind==='image-thumbnail')this.library.images.get(id);else this.library.recordingPath(id);
    const key=`${owner}:${kind}:${id}`;
    let token=this.keys.get(key);
    if(!token){token=randomUUID();this.keys.set(key,token);this.grants.set(token,{owner,id,kind,key});}
    return `one-file://materials/${token}/${kind==='recording'?'media':'image.png'}`;
  }
  private grant(value:string){
    try{const url=new URL(value);if(url.protocol!=='one-file:'||url.hostname!=='materials'||url.search)return;
      const grant=this.grants.get(url.pathname.split('/')[1]);if(!grant||!this.allowed(grant.owner))return;
      if(grant.kind==='image'||grant.kind==='image-thumbnail')this.library.images.get(grant.id);else this.library.recordingPath(grant.id);
      return grant;
    }catch{return;}
  }
  authorize(url:string,owner:number){return this.grant(url)?.owner===owner;}
  release(owner:number){for(const [token,grant] of this.grants)if(grant.owner===owner){this.grants.delete(token);this.keys.delete(grant.key);}}
  clear(){this.grants.clear();this.keys.clear();}
  prune(){
    const images=new Set(this.library.images.list().map(item=>item.id)),recordings=new Set(this.library.list().map(item=>item.id));
    for(const [token,grant] of this.grants)if(!this.allowed(grant.owner)||!(grant.kind.startsWith('image')?images:recordings).has(grant.id)){
      this.grants.delete(token);this.keys.delete(grant.key);
    }
  }
  async response(request:Request){
    if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
    const grant=this.grant(request.url);if(!grant)return new Response(null,{status:404});
    try{
      if(grant.kind==='recording'){
        const response=await recordingProjectPreview(this.library.recordingPath(grant.id),request);
        if(!this.grant(request.url)){await response.body?.cancel();return new Response(null,{status:404});}
        response.headers.set('Cache-Control','no-store');response.headers.set('Access-Control-Allow-Origin','one://app');return response;
      }
      const bytes=grant.kind==='recording-thumbnail'?await this.library.recordingThumbnail(grant.id):await this.library.images.read(grant.id,grant.kind==='image-thumbnail');
      if(!bytes||!this.grant(request.url))return new Response(null,{status:404});
      return new Response(request.method==='HEAD'?null:new Uint8Array(bytes),{headers:{'Content-Type':'image/png','Content-Length':String(bytes.length),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'one://app'}});
    }catch{return new Response(null,{status:404});}
  }
}
