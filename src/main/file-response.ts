import {stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {Readable} from 'node:stream';

/** Media decoders require byte ranges and a definite length to seek reliably. */
export async function fileResponse(path:string,mime:string,request:Request){
  const size=(await stat(path)).size;let start=0,end=size-1,status=200;
  const headers=new Headers({'Content-Type':mime,'Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'one://app'});
  const range=request.headers.get('range');
  if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);if(!match||(!match[1]&&!match[2]))return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
    if(match[1]){start=Number(match[1]);end=match[2]?Math.min(end,Number(match[2])):end;}else start=Math.max(0,size-Number(match[2]));
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
    status=206;headers.set('Content-Range',`bytes ${start}-${end}/${size}`);
  }
  headers.set('Content-Length',String(Math.max(0,end-start+1)));
  if(request.method==='HEAD'||!size)return new Response(null,{status,headers});
  const stream=createReadStream(path,{start,end});const abort=()=>stream.destroy();request.signal.addEventListener('abort',abort,{once:true});stream.once('close',()=>request.signal.removeEventListener('abort',abort));
  return new Response(Readable.toWeb(stream) as ReadableStream,{status,headers});
}
