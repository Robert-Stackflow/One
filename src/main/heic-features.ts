import {open,stat} from 'node:fs/promises';

interface Box {type:string;start:number;end:number}

function boxes(data:Buffer,start:number,end:number):Box[]{
 const result:Box[]=[];
 for(let at=start;at<end;){
  if(at+8>end)throw Error('HEIC 元数据盒不完整');
  let size=data.readUInt32BE(at),header=8;
  if(size===1){if(at+16>end)throw Error('HEIC 扩展盒头不完整');const large=data.readBigUInt64BE(at+8);if(large>BigInt(Number.MAX_SAFE_INTEGER))throw Error('HEIC 元数据盒过大');size=Number(large);header=16;}
  else if(size===0)size=end-at;
  if(size<header||at+size>end)throw Error('HEIC 元数据盒大小无效');
  result.push({type:data.toString('ascii',at+4,at+8),start:at+header,end:at+size});
  at+=size;if(result.length>4096)throw Error('HEIC 元数据盒数量过多');
 }
 return result;
}

/** Only classify bounded primary metadata; an unknown auxiliary image must not disappear silently. */
export async function heicFeatures(path:string):Promise<{hdrGainMap:boolean;unsupportedAuxiliary:boolean}>{
 const info=await stat(path);if(!info.isFile()||info.size>100*1024*1024)throw Error('HEIC 文件无效或超过 100 MB');
 const file=await open(path,'r');
 try{
  let meta:Buffer|undefined,at=0;
  for(let count=0;at+8<=info.size&&count<256;count++){
   const header=Buffer.alloc(16),read=await file.read(header,0,Math.min(16,info.size-at),at);
   if(read.bytesRead<8)break;
   let size=header.readUInt32BE(0),headerBytes=8;
   if(size===1){if(read.bytesRead<16)throw Error('HEIC 扩展盒头不完整');const large=header.readBigUInt64BE(8);if(large>BigInt(Number.MAX_SAFE_INTEGER))throw Error('HEIC 盒过大');size=Number(large);headerBytes=16;}
   else if(size===0)size=info.size-at;
   if(size<headerBytes||at+size>info.size)throw Error('HEIC 盒大小无效');
   if(header.toString('ascii',4,8)==='meta'){
    if(size-headerBytes>4*1024*1024)throw Error('HEIC 元数据超过 4 MB 检查上限');
    meta=Buffer.alloc(size-headerBytes);
    const body=await file.read(meta,0,meta.length,at+headerBytes);
    if(body.bytesRead!==meta.length)throw Error('HEIC 元数据读取不完整');
    break;
   }
   at+=size;
  }
  if(!meta||meta.length<4)throw Error('HEIC 主元数据不可读取');
  let hdrGainMap=false,unsupportedAuxiliary=false,foundAux=false;
  for(const property of boxes(meta,4,meta.length).filter(box=>box.type==='iprp').flatMap(iprp=>boxes(meta!,iprp.start,iprp.end)).filter(box=>box.type==='ipco').flatMap(ipco=>boxes(meta!,ipco.start,ipco.end))){
   if(property.type!=='auxC')continue;
   foundAux=true;
   if(property.start+4>=property.end)throw Error('HEIC 辅助图像类型不完整');
   const value=meta.toString('utf8',property.start+4,property.end).split('\0',1)[0];
   if(/(?:^|:)hdrgainmap$/i.test(value))hdrGainMap=true;else unsupportedAuxiliary=true;
  }
  if(!foundAux&&meta.includes(Buffer.from('auxl','ascii')))unsupportedAuxiliary=true;
  return {hdrGainMap,unsupportedAuxiliary};
 }finally{await file.close();}
}
