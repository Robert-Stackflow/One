import { readFile, writeFile, rename, unlink,stat,open } from 'node:fs/promises';
import iconv from 'iconv-lite';
const encodings: Record<string,string> = { 'UTF-8':'utf8', 'UTF-16':'utf16le', 'GBK':'gbk', 'Big5':'big5' };
export async function readText(path: string, encoding: string): Promise<string> {
  if((await stat(path)).size>20*1024*1024)throw new Error('文本编辑上限为 20 MB');const bytes = await readFile(path); if (bytes.length > 20 * 1024 * 1024) throw new Error('文本编辑上限为 20 MB');
  if (encoding !== '自动') { if (!encodings[encoding]) throw new Error('编码无效'); const text = iconv.decode(bytes, encodings[encoding]); if (text.includes('\uFFFD')) throw new Error('存在无法解码的内容，请检查编码'); return text; }
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) return iconv.decode(bytes.subarray(2), 'utf16le');
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) return iconv.decode(bytes.subarray(2), 'utf16be');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('无法确认为 UTF-8，请选择 GBK、Big5 或 UTF-16 后重新打开'); }
}
export async function saveText(path: string, text: string, name: string,temporary?:(path:string|null)=>void) {
  const encoding = encodings[name === '自动' ? 'UTF-8' : name]; if (!encoding) throw new Error('编码无效');
  const bytes = iconv.encode(text, encoding);
  if (iconv.decode(bytes, encoding, { stripBOM: false }) !== text) throw new Error('目标编码无法无损保存这些字符，请选择 UTF-8');
  const output = encoding === 'utf16le' ? Buffer.concat([Buffer.from([0xFF,0xFE]), bytes]) : bytes;
  const temp = path + '.one-' + crypto.randomUUID() + '.tmp';
  temporary?.(temp);
  try { await writeFile(temp, output, { flag: 'wx' }); await rename(temp, path); }
  finally { await unlink(temp).catch(() => {});temporary?.(null); }
}

/** Write a merged batch without retaining or re-encoding the whole result. */
export async function createTextWriter(path:string,name:string,temporary?:(path:string|null)=>void){
 const encoding=encodings[name==='自动'?'UTF-8':name];if(!encoding)throw new Error('编码无效');
 const temp=path+'.one-'+crypto.randomUUID()+'.tmp';temporary?.(temp);
 let handle:Awaited<ReturnType<typeof open>>|undefined;
 try{handle=await open(temp,'wx');if(encoding==='utf16le')await handle.writeFile(Buffer.from([0xff,0xfe]));}
 catch(error){await handle?.close().catch(()=>{});await unlink(temp).catch(()=>{});temporary?.(null);throw error;}
 const file=handle;
 let active=true,handleOpen=true,carry='';
 const write=async(value:string)=>{const bytes=iconv.encode(value,encoding);if(iconv.decode(bytes,encoding,{stripBOM:false})!==value)throw new Error('目标编码无法无损保存这些字符，请选择 UTF-8');await file.writeFile(bytes);};
 const abort=async()=>{if(!active)return;active=false;if(handleOpen){handleOpen=false;await file.close().catch(()=>{});}await unlink(temp).catch(()=>{});temporary?.(null);};
 return{
  async append(value:string){if(!active)throw new Error('文本输出已关闭');let part=carry+value;carry='';if(part&&/^[\uD800-\uDBFF]$/.test(part.at(-1)!)){carry=part.at(-1)!;part=part.slice(0,-1);}if(part)await write(part);},
  async finish(){if(!active)throw new Error('文本输出已关闭');try{if(carry)await write(carry);await file.close();handleOpen=false;await rename(temp,path);active=false;temporary?.(null);}catch(error){await abort();throw error;}},
  abort
 };
}
