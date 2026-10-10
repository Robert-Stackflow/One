export type UuidFormat='standard'|'compact'|'braces';

export function generateUuids(count:number,format:UuidFormat,uppercase:boolean):string[]{
 if(!Number.isInteger(count)||count<1||count>1000)throw Error('生成数量需在 1 至 1000 之间');
 if(!['standard','compact','braces'].includes(format)||typeof uppercase!=='boolean')throw Error('UUID 格式无效');
 const result:string[]=[];
 for(let index=0;index<count;index++){
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&0x0f)|0x40;bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
  let value=format==='compact'?hex:`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  if(format==='braces')value=`{${value}}`;result.push(uppercase?value.toUpperCase():value);
 }
 return result;
}
