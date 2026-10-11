import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';

// Original One document/zipper artwork. Bandizip is a design reference only;
// none of its images or other resources are included in these files.
export const formats=[
 ['archive','ARC','#203329'],['zip','ZIP','#3376BB'],['7z','7Z','#338267'],
 ['rar','RAR','#865BB0'],['r00','R00','#865BB0'],['tar','TAR','#9A7641'],
 ['tgz','TGZ','#AF7637'],['gz','GZ','#AF7637'],['txz','TXZ','#28848B'],['xz','XZ','#28848B'],
 ['zipx','ZIPX','#3376BB'],['alz','ALZ','#85664C'],['egg','EGG','#85664C'],['cab','CAB','#537E73'],
 ['bh','BH','#85664C'],['001','001','#B57135'],['arj','ARJ','#85664C'],['lha','LHA','#85664C'],['lzh','LZH','#85664C'],
 ['pma','PMA','#85664C'],['ace','ACE','#85664C'],['arc','ARC','#85664C'],['aes','AES','#607687'],
 ['zpaq','ZPAQ','#607687'],['zstd','ZSTD','#28848B'],['zst','ZST','#28848B'],['tzst','TZST','#9A7641'],['br','BR','#28848B'],
 ['bz','BZ','#AF7637'],['bz2','BZ2','#AF7637'],['bzip2','BZIP2','#AF7637'],['tbz','TBZ','#9A7641'],['tbz2','TBZ2','#9A7641'],
 ['lzma','LZMA','#28848B'],['tlz','TLZ','#28848B'],['lz','LZ','#28848B'],['z','Z','#9A7641'],
 ['jar','JAR','#527F92'],['war','WAR','#527F92'],['apk','APK','#338267'],['ipa','IPA','#527F92'],['xpi','XPI','#85664C'],
 ['iso','ISO','#666D99'],['img','IMG','#666D99'],['isz','ISZ','#666D99'],['udf','UDF','#666D99'],
 ['wim','WIM','#666D99'],['bin','BIN','#666D99'],['i00','I00','#666D99'],
];
export const sizes=[16,20,24,32,40,48,64,96,128,256];
const glyphs={A:['010','101','111','101','101'],R:['110','101','110','101','101'],C:['011','100','100','100','011'],Z:['111','001','010','100','111'],I:['111','010','010','010','111'],P:['110','101','110','100','100'],'7':['111','001','010','010','010'],'0':['111','101','101','101','111'],'1':['010','110','010','010','111'],'2':['110','001','010','100','111'],T:['111','010','010','010','010'],G:['011','100','101','101','011'],X:['101','101','010','101','101'],B:['110','101','110','101','110'],H:['101','101','111','101','101'],L:['100','100','100','100','111'],M:['101','111','111','101','101'],S:['011','100','010','001','110'],W:['101','101','111','111','101'],D:['110','101','101','101','110'],U:['101','101','101','101','111'],F:['111','100','110','100','100'],Q:['010','101','101','111','011'],E:['111','100','110','100','111'],J:['001','001','001','101','010'],K:['101','101','110','101','101'],N:['101','111','111','111','101']};
glyphs.O=['010','101','101','101','010'];
function pixelLabel(label){const text=label.slice(0,3),unit=16,start=Math.round((256-(text.length*4-1)*unit)/32)*16;return [...text].flatMap((letter,i)=>glyphs[letter].flatMap((row,y)=>[...row].map((pixel,x)=>pixel==='1'?`<rect x="${start+(i*4+x)*unit}" y="${96+y*unit}" width="${unit}" height="${unit}" fill="#FFFFFF"/>`:''))).join('');}
export function artwork(label,color,size=256){
 const small=size<=20;
 if(small)return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><title>One ${label} archive</title><rect x="8" y="8" width="240" height="240" rx="36" fill="#203329"/><rect x="32" y="32" width="192" height="16" rx="8" fill="${color}"/>${pixelLabel(label)}</svg>`;
 const zip=/^(ZIP|ZIPX|JAR|WAR|APK|IPA|XPI)$/.test(label),seven=/^(7Z|ZPAQ|001)$/.test(label),disc=/^(ISO|IMG|ISZ|UDF|WIM|BIN|I00)$/.test(label),stack=/^(RAR|R00|ALZ|EGG|ACE|ARJ|LHA|LZH|PMA)$/.test(label);
 const motif=zip?`<rect x="97" y="48" width="62" height="94" rx="14" fill="none" stroke="${color}" stroke-width="12"/>${Array.from({length:5},(_,i)=>`<path d="M${i%2?128:110} ${63+i*15}h18" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round"/>`).join('')}<rect x="118" y="122" width="20" height="28" rx="5" fill="#FFFFFF"/>`:
  seven?`<path d="M78 60h96l-17 24H95zm13 34h83l-17 24H74zm-13 34h96l-17 24H95z" fill="${color}" stroke="#FFFFFF" stroke-width="4" stroke-linejoin="round"/>`:
  disc?`<circle cx="128" cy="100" r="51" fill="none" stroke="${color}" stroke-width="15"/><circle cx="128" cy="100" r="15" fill="none" stroke="#FFFFFF" stroke-width="9"/><path d="M128 49v22m0 58v22" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round"/>`:
  stack?`<rect x="77" y="55" width="102" height="26" rx="7" fill="${color}"/><rect x="69" y="87" width="118" height="26" rx="7" fill="#FFFFFF"/><rect x="77" y="119" width="102" height="26" rx="7" fill="${color}"/>`:
  `<path d="M75 81h106v67H75z" fill="none" stroke="${color}" stroke-width="12" stroke-linejoin="round"/><path d="m75 81 27-29h52l27 29m-53-29v54m-53 0h106" fill="none" stroke="#FFFFFF" stroke-width="8" stroke-linejoin="round"/>`;
 return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><title>One ${label} archive</title><rect x="12" y="12" width="232" height="232" rx="48" fill="#203329"/><circle cx="49" cy="49" r="12" fill="none" stroke="#FFFFFF" stroke-width="7"/>${motif}<path d="M48 164h160" stroke="${color}" stroke-width="5" stroke-linecap="round"/><text x="128" y="222" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="${label.length>4?31:label.length>3?39:51}" font-weight="800" letter-spacing="1" fill="#FFFFFF">${label}</text></svg>`;
}
function ico(images){
 const header=Buffer.alloc(6+images.length*16);header.writeUInt16LE(1,2);header.writeUInt16LE(images.length,4);let offset=header.length;
 const frames=images.map(({size,png,rgba})=>size===256?png:dib(size,rgba));
 images.forEach(({size},index)=>{const data=frames[index],at=6+index*16;header[at]=header[at+1]=size===256?0:size;header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(data.length,at+8);header.writeUInt32LE(offset,at+12);offset+=data.length;});
 return Buffer.concat([header,...frames]);
}
// Traditional BGRA DIB + AND mask for small frames also works in older Shell
// icon readers. Keep the compressed PNG frame for the 256px Explorer view.
function dib(size,rgba){
 const stride=Math.ceil(size/32)*4,pixels=size*size*4,bytes=Buffer.alloc(40+pixels+stride*size);
 bytes.writeUInt32LE(40);bytes.writeInt32LE(size,4);bytes.writeInt32LE(size*2,8);bytes.writeUInt16LE(1,12);bytes.writeUInt16LE(32,14);bytes.writeUInt32LE(pixels+stride*size,20);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){const src=(y*size+x)*4,target=40+((size-y-1)*size+x)*4;bytes[target]=rgba[src+2];bytes[target+1]=rgba[src+1];bytes[target+2]=rgba[src];bytes[target+3]=rgba[src+3];if(!rgba[src+3])bytes[40+pixels+(size-y-1)*stride+(x>>3)]|=128>>(x&7);}
 return bytes;
}
async function main(){
 const requested=process.argv.find(value=>value.startsWith('--formats='))?.slice(10).split(',');
 if(requested?.some(name=>!formats.some(format=>format[0]===name)))throw Error('Unknown archive icon format');
 const selected=requested?formats.filter(format=>requested.includes(format[0])):formats;
 const directory=resolve('assets/icons/archive');await mkdir(directory,{recursive:true});
 const save=async(path,bytes)=>{for(let attempt=0;;attempt++){try{await writeFile(path,bytes);return;}catch(error){if(!['UNKNOWN','EBUSY','EPERM'].includes(error.code)||attempt===3)throw error;await new Promise(done=>setTimeout(done,100*(attempt+1)));}}};
 const browser=await chromium.launch({headless:true,...(process.env.ONE_ICON_BROWSER?{executablePath:process.env.ONE_ICON_BROWSER}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1000,height:480},deviceScaleFactor:1});
  for(const [name,label,color] of selected){
   await save(resolve(directory,name+'.svg'),artwork(label,color));
   const images=[];
   for(const size of sizes){
    const data=await page.evaluate(async({svg,size})=>{const img=new Image();img.src='data:image/svg+xml;base64,'+btoa(svg);await img.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=size;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,size,size);let raw='';if(size<256){const pixels=ctx.getImageData(0,0,size,size).data;for(let at=0;at<pixels.length;at+=8192)raw+=String.fromCharCode(...pixels.subarray(at,at+8192));}return {png:canvas.toDataURL('image/png').split(',')[1],rgba:btoa(raw)};},{svg:artwork(label,color,size),size});
    images.push({size,png:Buffer.from(data.png,'base64'),rgba:Buffer.from(data.rgba,'base64')});
   }
   await save(resolve(directory,name+'.ico'),ico(images));
  }
  if(requested){console.log(`Exported ${selected.length} archive icons: ${requested.join(', ')}`);return;}
  const cells=formats.map(([name,label,color])=>`<div class="cell"><img width="96" height="96" src="data:image/svg+xml;base64,${Buffer.from(artwork(label,color)).toString('base64')}"><b>${label}</b><div class="small">${[16,24,32].map(size=>`<img width="${size}" height="${size}" src="data:image/svg+xml;base64,${Buffer.from(artwork(label,color,size)).toString('base64')}">`).join('')}</div></div>`).join('');
  await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;background:#f4f5f4;color:#203329;font:13px 'Segoe UI';padding:20px}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:20px}.cell{display:flex;flex-direction:column;align-items:center;gap:7px}.small{display:flex;align-items:center;justify-content:center;gap:14px;height:38px}</style><div class="grid">${cells}</div>`);
  await page.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(img=>img.decode())));
  await page.screenshot({path:resolve(directory,'preview.png'),fullPage:true});
  console.log(`Exported ${formats.length} original archive icons, ${sizes.length} sizes each: ${directory}`);
 }finally{await browser.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
