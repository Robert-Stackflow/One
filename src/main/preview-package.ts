import {open,type Entry} from 'yauzl';
import {DOMParser} from '@xmldom/xmldom';
import {basename} from 'node:path';
import type {ApplicationPreview} from '../shared/application-preview';

const clean=(value:string|null)=>String(value||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,2048);

/** Inspect only the package manifest and ZIP directory; never extract or install. */
export async function inspectPackage(path:string){
  const contents=await manifest(path),xml=decode(contents.xml);
  if(/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)||xml.length>2*1024*1024||(xml.match(/</g)?.length||0)>30000)throw Error('安装包清单超出可解析范围');
  const document=new DOMParser({onError:()=>{throw Error('安装包清单格式无效');}}).parseFromString(xml,'application/xml'),root=document.documentElement;
  if(!root||!['Package','Bundle'].includes(root.localName||''))throw Error('不是有效的 MSIX / APPX 安装包清单');
  const elements=Array.from(document.getElementsByTagName('*'));
  if(elements.length>15000)throw Error('安装包清单项目过多');
  const all=(name:string)=>elements.filter(item=>item.localName===name),first=(name:string)=>all(name)[0],attribute=(name:string,key:string)=>clean(first(name)?.getAttribute(key)||'');
  const identity=first('Identity');
  if(!identity||!identity.getAttribute('Name'))throw Error('安装包缺少标识信息');
  const metadata:Record<string,string>={'格式':root.localName==='Bundle'?'MSIX / APPX Bundle':'MSIX / APPX','包名称':clean(identity.getAttribute('Name')),'版本':clean(identity.getAttribute('Version')),'发布者':clean(identity.getAttribute('Publisher')),'文件数量':String(contents.count),'签名':contents.signed?'包含包签名（未验证）':'未包含包签名'};
  for(const [name,label]of [['DisplayName','显示名称'],['PublisherDisplayName','发布者名称'],['Description','说明']]as const){const value=clean(first(name)?.textContent||'');if(value)metadata[label]=value;}
  const architecture=clean(identity.getAttribute('ProcessorArchitecture'));if(architecture)metadata['架构']=architecture;
  if(attribute('Identity','ResourceId'))metadata['资源标识']=attribute('Identity','ResourceId');
  const sections:ApplicationPreview['sections']=[{title:'安装包信息',facts:[]}];
  const targets=all('TargetDeviceFamily').slice(0,128).map(item=>({label:clean(item.getAttribute('Name')),value:'最低 '+clean(item.getAttribute('MinVersion'))+(item.getAttribute('MaxVersionTested')?' · 测试至 '+clean(item.getAttribute('MaxVersionTested')):'')}));
  if(targets.length)sections.push({title:'系统要求',facts:targets});
  const apps=all('Application').slice(0,128).map(item=>({label:clean(item.getAttribute('Id'))||'应用',value:[item.getAttribute('Executable'),item.getAttribute('EntryPoint')].map(clean).filter(Boolean).join(' · ')}));
  if(apps.length){metadata['应用数量']=String(apps.length);sections.push({title:'应用',facts:apps});}
  const capabilities=elements.filter(item=>['Capability','DeviceCapability'].includes(item.localName||'')).slice(0,128).map(item=>({label:clean(item.localName||''),value:clean(item.getAttribute('Name'))}));if(capabilities.length)sections.push({title:'声明的能力',facts:capabilities});
  const dependencies=all('PackageDependency').slice(0,128).map(item=>[item.getAttribute('Name'),item.getAttribute('MinVersion'),item.getAttribute('Publisher')].map(clean).filter(Boolean).join(' · '));
  const packages=root.localName==='Bundle'?all('Package').slice(0,256).map(item=>({name:clean(item.getAttribute('FileName')),architecture:clean(item.getAttribute('Architecture')),version:clean(item.getAttribute('Version')),size:clean(item.getAttribute('Size'))})).filter(item=>item.name):undefined;
  if(packages)metadata['子包数量']=String(packages.length);
  sections[0].facts=Object.entries(metadata).map(([label,value])=>({label,value}));
  const name=metadata['显示名称'],application:ApplicationPreview={kind:'package',title:name&&!/^ms-resource:/i.test(name)?name:metadata['包名称']||basename(path),sections,dependencies,packages};
  return {metadata,application};
}
function decode(bytes:Buffer){return new TextDecoder(bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8',{fatal:true}).decode(bytes);}
function manifest(path:string):Promise<{xml:Buffer;count:number;signed:boolean}>{
  return new Promise((resolve,reject)=>{
    open(path,{lazyEntries:true,validateEntrySizes:true},(error,zip)=>{
      if(error||!zip){reject(error||Error('无法打开安装包'));return;}
      let count=0,signed=false,xml:Buffer|undefined,done=false,reading=false;
      const fail=(error:unknown)=>{if(done)return;done=true;zip.close();reject(error);};
      zip.on('error',fail);
      zip.on('entry',(entry:Entry)=>{
        if(++count>20000)return fail(Error('安装包超过 20,000 个文件'));
        const name=entry.fileName.replace(/\\/g,'/').toLowerCase();
        if(name==='appxsignature.p7x')signed=true;
        if(!['appxmanifest.xml','appxmetadata/appxbundlemanifest.xml'].includes(name)){zip.readEntry();return;}
        if(xml||reading)return fail(Error('安装包包含重复清单'));
        if(entry.uncompressedSize>2*1024*1024||entry.uncompressedSize/Math.max(1,entry.compressedSize)>1000)return fail(Error('安装包清单过大'));
        reading=true;
        zip.openReadStream(entry,(error,stream)=>{
          if(error||!stream)return fail(error||Error('安装包清单无法读取'));
          const parts:Buffer[]=[];let bytes=0;
          stream.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>2*1024*1024)stream.destroy(Error('安装包清单过大'));else parts.push(chunk);});
          stream.once('error',fail);
          stream.once('end',()=>{if(done)return;xml=Buffer.concat(parts);reading=false;zip.readEntry();});
        });
      });
      zip.once('end',()=>{if(done)return;done=true;if(!xml)reject(Error('未找到安装包清单'));else resolve({xml,count,signed});});
      zip.readEntry();
    });
  });
}
