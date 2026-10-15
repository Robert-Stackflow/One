const fs=require('node:fs/promises'),path=require('node:path'),JSZip=require('jszip');
function block(key,value,children=[],type=1){
 const text=typeof value==='string',bytes=text?Buffer.from(value+'\0','utf16le'):value,keyBytes=Buffer.from(key+'\0','utf16le'),align=n=>(n+3)&~3,start=align(6+keyBytes.length),parts=children.map(child=>{const out=Buffer.alloc(align(child.length));child.copy(out);return out;});
 const result=Buffer.alloc(align(start+bytes.length)+parts.reduce((n,p)=>n+p.length,0));result.writeUInt16LE(result.length,0);result.writeUInt16LE(text?bytes.length/2:bytes.length,2);result.writeUInt16LE(type,4);keyBytes.copy(result,6);bytes.copy(result,start);let at=align(start+bytes.length);for(const p of parts){p.copy(result,at);at+=p.length;}return result;
}
function pe(description='Example application',dll=false){
 const fixed=Buffer.alloc(52);fixed.writeUInt32LE(0xfeef04bd);fixed.writeUInt32LE(0x10000,4);fixed.writeUInt32LE(0x10002,8);fixed.writeUInt32LE(0x30004,12);fixed.writeUInt32LE(0x50006,16);fixed.writeUInt32LE(0x70008,20);
 const version=block('VS_VERSION_INFO',fixed,[block('StringFileInfo',Buffer.alloc(0),[block('040904b0',Buffer.alloc(0),[block('CompanyName','Example Company'),block('FileDescription',description),block('OriginalFilename',dll?'example.dll':'example.exe')])])],0);
 const bytes=Buffer.alloc(0xa00);bytes.write('MZ');bytes.writeUInt32LE(0x80,60);bytes.write('PE\0\0',0x80,'binary');bytes.writeUInt16LE(0x8664,0x84);bytes.writeUInt16LE(1,0x86);bytes.writeUInt32LE(1700000000,0x88);bytes.writeUInt16LE(0xf0,0x94);bytes.writeUInt16LE(dll?0x2022:0x22,0x96);
 const o=0x98;bytes.writeUInt16LE(0x20b,o);bytes.writeUInt32LE(0x1000,o+16);bytes.writeUInt32LE(0x2000,o+56);bytes.writeUInt32LE(0x200,o+60);bytes.writeUInt16LE(3,o+68);bytes.writeUInt32LE(16,o+108);
 const directory=(i,rva,size)=>{bytes.writeUInt32LE(rva,o+112+i*8);bytes.writeUInt32LE(size,o+116+i*8);};
 directory(2,0x1000,0x300);directory(1,0x1300,40);directory(0,0x1380,40);
 const section=o+0xf0;bytes.write('.rsrc',section);bytes.writeUInt32LE(0x800,section+8);bytes.writeUInt32LE(0x1000,section+12);bytes.writeUInt32LE(0x800,section+16);bytes.writeUInt32LE(0x200,section+20);bytes.writeUInt32LE(0x40000040,section+36);
 const r=0x200;for(const offset of [0,24,48])bytes.writeUInt16LE(1,r+offset+14);
 bytes.writeUInt32LE(16,r+16);bytes.writeUInt32LE(0x80000018,r+20);bytes.writeUInt32LE(1,r+40);bytes.writeUInt32LE(0x80000030,r+44);bytes.writeUInt32LE(0x409,r+64);bytes.writeUInt32LE(72,r+68);bytes.writeUInt32LE(0x1058,r+72);bytes.writeUInt32LE(version.length,r+76);version.copy(bytes,r+88);
 bytes.writeUInt32LE(0x1340,0x500+12);bytes.write('KERNEL32.dll\0',0x540);
 bytes.writeUInt32LE(1,0x580+20);bytes.writeUInt32LE(1,0x580+24);bytes.writeUInt32LE(0x13c0,0x580+32);bytes.writeUInt32LE(0x13d0,0x5c0);bytes.write('RunExample\0',0x5d0);
 return bytes;
}
async function fixtures(root){
 const files={};files['example.com']=path.join(root,'example.com');await fs.writeFile(files['example.com'],'a local file with a domain-like name');for(const [name,data]of Object.entries({'example.exe':pe(),'example.dll':pe('Example library',true),'unsafe-name.dll':pe('<img src="https://untrusted.invalid/a" onerror="alert(1)">',true),'broken.exe':Buffer.from('not a program')})){files[name]=path.join(root,name);await fs.writeFile(files[name],data);}
 const manifest='<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"><Identity Name="One.Preview.Example" Publisher="CN=Example" Version="1.2.3.4" ProcessorArchitecture="x64"/><Properties><DisplayName>示例应用</DisplayName><PublisherDisplayName>示例公司</PublisherDisplayName><Description>仅供预览</Description></Properties><Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0"/><PackageDependency Name="Microsoft.VCLibs" MinVersion="14.0.0.0" Publisher="CN=Microsoft"/></Dependencies><Applications><Application Id="App" Executable="app.exe" EntryPoint="Windows.FullTrustApplication"/></Applications><Capabilities><Capability Name="internetClient"/></Capabilities></Package>';
 for(const name of ['sample.msix','sample.appx']){const zip=new JSZip();zip.file('AppxManifest.xml',manifest);zip.file('app.exe','never executed');zip.file('AppxSignature.p7x','not a verified signature');files[name]=path.join(root,name);await fs.writeFile(files[name],await zip.generateAsync({type:'nodebuffer'}));}
 const bundle='<Bundle xmlns="http://schemas.microsoft.com/appx/2013/bundle"><Identity Name="One.Preview.Example" Publisher="CN=Example" Version="1.2.3.4"/><Packages><Package Type="application" Architecture="x64" Version="1.2.3.4" FileName="app-x64.msix" Size="42"/><Package Type="application" Architecture="arm64" Version="1.2.3.4" FileName="app-arm64.msix" Size="43"/></Packages></Bundle>';
 for(const name of ['sample.msixbundle','sample.appxbundle']){const zip=new JSZip();zip.file('AppxMetadata/AppxBundleManifest.xml',bundle);zip.file('app-x64.msix','not installed');zip.file('app-arm64.msix','not installed');files[name]=path.join(root,name);await fs.writeFile(files[name],await zip.generateAsync({type:'nodebuffer'}));}
 const bad=new JSZip();bad.file('AppxManifest.xml','<!DOCTYPE Package [<!ENTITY x SYSTEM "file:///C:/Windows/win.ini">]><Package><Identity Name="&x;"/></Package>');files['entity.msix']=path.join(root,'entity.msix');await fs.writeFile(files['entity.msix'],await bad.generateAsync({type:'nodebuffer'}));
 const rtf='{\\rtf1\\ansi\\ansicpg1252{\\info{\\title Preview example}{\\author One}}\\qc\\b Heading\\b0\\par\\ql Normal \\i italic\\i0  \\ul underlined\\ulnone\\par Unicode: \\u20013?\\u25991?\\par Escaped: \\\\ \\{ \\}\\par Literal <img src="https://untrusted.invalid/x">\\par{\\*\\unknown hidden content}{\\object\\objdata dangerous-object}{\\pict\\pngblip deadbeef}}';
 files['document.rtf']=path.join(root,'document.rtf');await fs.writeFile(files['document.rtf'],rtf);
 return files;
}
module.exports={pe,fixtures};
