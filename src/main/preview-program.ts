import {open} from 'node:fs/promises';
import {basename,extname} from 'node:path';
import type {ApplicationPreview} from '../shared/application-preview';

const clean=(value:string)=>value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,2048);
const hex=(value:number)=>'0x'+value.toString(16).toUpperCase();
const amount=(value:number)=>value.toLocaleString('en-US')+' B';
interface Section{name:string;virtual:number;raw:number;size:number;flags:number}

/** Read bounded file ranges. No loader, shell handler, or target code is invoked. */
export async function inspectProgram(path:string){
  const file=await open(path,'r');
  try{
    const size=(await file.stat()).size;let consumed=0,requests=0;
    const take=async(offset:number,length:number)=>{
      if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||length<0||offset+length>size||length>4*1024*1024||(consumed+=length)>16*1024*1024||++requests>2048)throw Error('程序文件结构超出可读取范围');
      const bytes=Buffer.alloc(length);let done=0;
      while(done<length){const read=await file.read(bytes,done,length-done,offset+done);if(!read.bytesRead)throw Error('程序文件已截断');done+=read.bytesRead;}return bytes;
    };
    const dos=await take(0,Math.min(64,size));
    const metadata:Record<string,string>={};
    const legacy=()=>({metadata:{'格式':dos.toString('ascii',0,2)==='MZ'?'DOS MZ':'DOS COM','位数':'16 位'},application:{kind:'pe' as const,title:basename(path),sections:[]}});
    if(dos.length<64||dos.toString('ascii',0,2)!=='MZ'){if(extname(path).toLowerCase()==='.com'&&size)return legacy();throw Error('不是有效的 Windows 程序文件');}
    const offset=dos.readUInt32LE(60);
    if(offset<64||offset>1024*1024||offset+24>size){if(extname(path).toLowerCase()==='.exe')return legacy();throw Error('PE 文件头无效');}
    const coff=await take(offset,24);
    if(coff.toString('binary',0,4)!=='PE\0\0'){if(extname(path).toLowerCase()==='.exe')return legacy();throw Error('PE 文件签名无效');}
    const machine=coff.readUInt16LE(4),sectionCount=coff.readUInt16LE(6),timestamp=coff.readUInt32LE(8),optionalSize=coff.readUInt16LE(20),characteristics=coff.readUInt16LE(22);
    if(!sectionCount||sectionCount>96||optionalSize<96||optionalSize>4096)throw Error('PE 文件头大小无效');
    const optional=await take(offset+24,optionalSize),magic=optional.readUInt16LE(0),wide=magic===0x20b,dirs=wide?112:96;
    if(![0x10b,0x20b].includes(magic)||optionalSize<dirs)throw Error('不支持的 PE 文件格式');
    const count=Math.min(16,optional.readUInt32LE(wide?108:92));
    if(dirs+count*8>optional.length)throw Error('PE 数据目录超出头部');
    const directories=Array.from({length:count},(_,i)=>({rva:optional.readUInt32LE(dirs+i*8),size:optional.readUInt32LE(dirs+i*8+4)}));
    const rawSections=await take(offset+24+optionalSize,sectionCount*40),sections:Section[]=[];
    for(let i=0;i<sectionCount;i++){const n=i*40;sections.push({name:clean(rawSections.toString('latin1',n,n+8)),virtual:rawSections.readUInt32LE(n+12),size:rawSections.readUInt32LE(n+16),raw:rawSections.readUInt32LE(n+20),flags:rawSections.readUInt32LE(n+36)});}
    const location=(rva:number,length:number)=>{
      if(!Number.isSafeInteger(rva)||rva<0)throw Error('PE 地址无效');
      if(rva<optional.readUInt32LE(60)&&rva+length<=optional.readUInt32LE(60)&&rva+length<=size)return rva;
      const section=sections.find(s=>rva>=s.virtual&&rva-s.virtual+length<=s.size);
      if(!section||section.raw+rva-section.virtual+length>size)throw Error('PE 地址超出文件');
      return section.raw+rva-section.virtual;
    };
    const bytesAt=(rva:number,length:number)=>take(location(rva,length),length);
    const stringAt=async(rva:number)=>{
      const at=location(rva,1),section=sections.find(s=>rva>=s.virtual&&rva<s.virtual+s.size);
      const bytes=await take(at,Math.min(512,size-at,section?section.raw+section.size-at:optional.readUInt32LE(60)-at)),zero=bytes.indexOf(0);
      return clean(bytes.toString('utf8',0,zero<0?bytes.length:zero));
    };
    metadata['格式']=wide?'PE32+':'PE32';
    metadata['架构']=({0x14c:'x86',0x8664:'x64',0xaa64:'ARM64',0xa641:'ARM64EC',0xa64e:'ARM64X',0x1c4:'ARMv7',0x200:'IA-64'} as Record<number,string>)[machine]||hex(machine);
    metadata['文件类型']=characteristics&0x2000?'动态链接库':'可执行映像';
    metadata['子系统']=({1:'Native',2:'Windows GUI',3:'Windows 控制台',9:'Windows CE',10:'EFI 应用',11:'EFI 启动驱动',12:'EFI 运行时驱动',14:'Xbox'} as Record<number,string>)[optional.readUInt16LE(68)]||String(optional.readUInt16LE(68));
    metadata['入口地址']=hex(optional.readUInt32LE(16));
    metadata['映像大小']=amount(optional.readUInt32LE(56));
    metadata['节区数量']=String(sectionCount);
    if(timestamp&&timestamp!==0xffffffff)metadata['链接时间']=new Date(timestamp*1000).toISOString().replace('T',' ').replace('.000Z',' UTC');
    const certificate=directories[4];
    metadata['签名']=certificate?.rva&&certificate.size?'包含签名表（未验证）':'未包含签名表';
    if(certificate?.rva&&certificate.size){try{const cert=await take(certificate.rva,8);if(cert.readUInt32LE(0)>certificate.size||certificate.rva+certificate.size>size||cert.readUInt32LE(0)<8)throw Error();}catch{metadata['签名']='签名表无法读取';}}
    const resource=directories[2];
    if(resource?.rva&&resource.size){
      try{
        const data=await bytesAt(resource.rva,Math.min(resource.size,4*1024*1024));
        const inside=(offset:number,length:number)=>{if(offset<0||offset+length>data.length)throw Error('版本资源超出文件');};
        let visited=0;
        const leaves:{language:number;rva:number;size:number}[]=[];
        const walk=(at:number,depth:number,language:number)=>{
          inside(at,16);if(++visited>256||depth>3)throw Error('版本资源目录过深');
          const count=data.readUInt16LE(at+12)+data.readUInt16LE(at+14);if(count>256)throw Error('版本资源项目过多');inside(at+16,count*8);
          for(let i=0;i<count;i++){const key=data.readUInt32LE(at+16+i*8),next=data.readUInt32LE(at+20+i*8);if(depth===0&&key!==16)continue;
            const lang=depth===2?key:language;
            if(next&0x80000000)walk(next&0x7fffffff,depth+1,lang);
            else{inside(next,16);leaves.push({language:lang,rva:data.readUInt32LE(next),size:data.readUInt32LE(next+4)});if(leaves.length>16)throw Error('版本资源语言过多');}
          }
        };
        walk(0,0,0);leaves.sort((a,b)=>(a.language===0x804?0:a.language===0x409?1:2)-(b.language===0x804?0:b.language===0x409?1:2));
        for(const leaf of leaves){const version=parseVersion(await bytesAt(leaf.rva,Math.min(leaf.size,2*1024*1024)));for(const [key,value]of Object.entries(version))metadata[key]??=value;}
      }catch{metadata['版本资源']='无法读取或超过预览上限';}
    }
    const dependencies:string[]=[],exports:string[]=[];
    const imports=directories[1];
    if(imports?.rva&&imports.size){try{const table=await bytesAt(imports.rva,Math.min(imports.size,256*20));for(let at=0;at+20<=table.length;at+=20){const name=table.readUInt32LE(at+12);if(!name)break;const value=await stringAt(name);if(value)dependencies.push(value);}metadata['依赖模块']=String(dependencies.length)+(dependencies.length===256?'（前 256 项）':'');}catch{metadata['导入表']='无法读取';}}
    const exported=directories[0];
    if(exported?.rva&&exported.size){try{const table=await bytesAt(exported.rva,40),names=Math.min(table.readUInt32LE(24),512),addresses=names?await bytesAt(table.readUInt32LE(32),names*4):Buffer.alloc(0);metadata['导出函数']=String(table.readUInt32LE(20));for(let i=0;i<names;i++){const name=await stringAt(addresses.readUInt32LE(i*4));if(name)exports.push(name);}}catch{metadata['导出表']='无法读取';}}
    const clr=directories[14];
    if(clr?.rva&&clr.size){try{const header=await bytesAt(clr.rva,24),runtime=await bytesAt(header.readUInt32LE(8),Math.min(header.readUInt32LE(12),512));if(runtime.readUInt32LE(0)===0x424a5342){const length=runtime.readUInt32LE(12);if(length>256||16+length>runtime.length)throw Error();metadata['运行时']='.NET '+clean(runtime.toString('utf8',16,16+length));}}catch{metadata['运行时']='.NET（元数据无法读取）';}}
    const application:ApplicationPreview={kind:'pe',title:metadata['文件说明']||metadata['产品名称']||basename(path),sections:[{title:'文件信息',facts:Object.entries(metadata).map(([label,value])=>({label,value}))},{title:'节区',facts:sections.map(section=>({label:section.name||'未命名',value:hex(section.virtual)+' · '+amount(section.size)+' · '+[section.flags&0x20000000?'执行':'',section.flags&0x40000000?'读取':'',section.flags&0x80000000?'写入':''].filter(Boolean).join(' / ')}))}],dependencies,exports};
    return {metadata,application};
  }finally{await file.close();}
}

function parseVersion(data:Buffer){
  const result:Record<string,string>={},labels:Record<string,string>={CompanyName:'公司',FileDescription:'文件说明',FileVersion:'文件版本',ProductName:'产品名称',ProductVersion:'产品版本',LegalCopyright:'版权',OriginalFilename:'原始文件名',InternalName:'内部名称',Comments:'说明',LegalTrademarks:'商标'};
  let nodes=0;
  const aligned=(value:number)=>(value+3)&~3;
  const read=(start:number,end:number,depth:number):void=>{
    if(++nodes>2048||depth>8||start+6>end)throw Error('版本资源结构无效');
    const length=data.readUInt16LE(start),valueLength=data.readUInt16LE(start+2),type=data.readUInt16LE(start+4),limit=start+length;
    if(length<6||limit>end)throw Error('版本资源已截断');
    let at=start+6;while(at+2<=limit&&data.readUInt16LE(at)!==0){at+=2;if(at-start>1024)throw Error('版本资源键过长');}
    if(at+2>limit)throw Error('版本资源键无效');
    const key=data.toString('utf16le',start+6,at),value=aligned(at+2),bytes=type===1?valueLength*2:valueLength;
    if(value+bytes>limit)throw Error('版本资源值无效');
    if(labels[key]&&type===1){const text=clean(data.toString('utf16le',value,value+bytes));if(text)result[labels[key]]=text;}
    if(key==='VS_VERSION_INFO'&&bytes>=52&&data.readUInt32LE(value)===0xfeef04bd){const version=(at:number)=>[data.readUInt16LE(at+2),data.readUInt16LE(at),data.readUInt16LE(at+6),data.readUInt16LE(at+4)].join('.');result['文件版本']=version(value+8);result['产品版本']=version(value+16);}
    let child=aligned(value+bytes);
    while(child+6<=limit){const size=data.readUInt16LE(child);if(!size)break;read(child,limit,depth+1);child=aligned(child+size);}
  };
  read(0,data.length,0);return result;
}
