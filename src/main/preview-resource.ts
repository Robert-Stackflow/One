import {open,realpath,stat} from 'node:fs/promises';
import {dirname,resolve,relative,isAbsolute,parse} from 'node:path';

function inside(root:string,path:string){const rel=relative(root,path);return rel!==''&&!rel.startsWith('..')&&!isAbsolute(rel);}

export async function previewResourcePath(documentPath:string,value:string){
  if(value.length>4096||/^[a-z][a-z\d+.-]*:/i.test(value)||value.startsWith('\\'))return null;
  let decoded:string;try{decoded=decodeURIComponent(value.split(/[?#]/,1)[0]);}catch{return null;}
  const folder=await realpath(dirname(documentPath));
  if(!decoded.startsWith('/')){
    const target=await realpath(resolve(folder,decoded)).catch(()=>null);
    return target&&inside(folder,target)?target:null;
  }
  if(decoded.startsWith('//'))return null;
  const asset=decoded.slice(1);
  let ancestor=folder;
  for(let depth=0;depth<12;depth++){
    for(const directory of ['public','static']){
      const base=resolve(ancestor,directory),target=resolve(base,asset);
      if(!inside(base,target))continue;
      const actual=await realpath(target).catch(()=>null),actualBase=await realpath(base).catch(()=>null);
      if(actual&&actualBase&&inside(actualBase,actual)&&(await stat(actual)).isFile())return actual;
    }
    if(ancestor===parse(ancestor).root)break;
    ancestor=dirname(ancestor);
  }
  return null;
}

export async function previewImageDimensions(path:string){
  const file=await open(path,'r');
  const bytes=Buffer.allocUnsafe(65536);
  let length=0;
  try{({bytesRead:length}=await file.read(bytes,0,bytes.length,0));}finally{await file.close();}
  let width=0,height=0;
  if(length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);}
  else if(length>=10&&['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6))){width=bytes.readUInt16LE(6);height=bytes.readUInt16LE(8);}
  else if(length>=30&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'){
    const kind=bytes.toString('ascii',12,16);
    if(kind==='VP8X'){width=1+bytes.readUIntLE(24,3);height=1+bytes.readUIntLE(27,3);}
    else if(kind==='VP8L'&&bytes[20]===0x2f){width=1+(bytes[21]|(bytes[22]&63)<<8);height=1+((bytes[22]>>6)|(bytes[23]<<2)|(bytes[24]&15)<<10);}
    else if(kind==='VP8 '&&bytes[23]===0x9d&&bytes[24]===1&&bytes[25]===0x2a){width=bytes.readUInt16LE(26)&0x3fff;height=bytes.readUInt16LE(28)&0x3fff;}
  }else if(length>=4&&bytes[0]===0xff&&bytes[1]===0xd8){
    for(let offset=2;offset+9<length;){
      if(bytes[offset++]!==0xff)continue;
      while(bytes[offset]===0xff)offset++;
      const marker=bytes[offset++];
      if(marker===0xd9||marker===0xda)break;
      if(marker===0x01||marker>=0xd0&&marker<=0xd7)continue;
      const size=bytes.readUInt16BE(offset);if(size<2||offset+size>length)break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){height=bytes.readUInt16BE(offset+3);width=bytes.readUInt16BE(offset+5);break;}
      offset+=size;
    }
  }else if(path.toLowerCase().endsWith('.svg')){
    const tag=/<svg\b[^>]*>/i.exec(bytes.toString('utf8',0,length))?.[0]||'';
    const attribute=(name:string)=>new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`,'i').exec(tag)?.[1]||'';
    const box=attribute('viewBox').trim().split(/[\s,]+/).map(Number);
    const dimension=(name:string)=>{const value=attribute(name);return /^\d+(?:\.\d+)?(?:px)?$/i.test(value)?Number.parseFloat(value):0;};
    width=dimension('width')||(box.length===4?box[2]:0);
    height=dimension('height')||(box.length===4?box[3]:0);
  }
  return width>0&&height>0&&width<=100000&&height<=100000?{width,height}:null;
}
