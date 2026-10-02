import {open,type Entry,type ZipFile} from 'yauzl';
import {parser as xmlParser,type Tag} from 'sax';
import iconv from 'iconv-lite';
import type {DocumentPart,DocumentOptions} from './document-text';

const local=(name:string)=>name.split(':').at(-1)!;
const countLines=(text:string)=>{let count=0;for(let i=0;i<text.length;i++)if(text.charCodeAt(i)===10)count++;return count;};
async function archive(path:string,include:(name:string)=>boolean,progress?:DocumentOptions['progress']){
 const zip=await new Promise<ZipFile>((resolve,reject)=>open(path,{lazyEntries:true,autoClose:false,validateEntrySizes:true},(error,value)=>error||!value?reject(error||Error('无法读取文档')):resolve(value)));
 try{const entries=await new Promise<Entry[]>((resolve,reject)=>{
  const entries:Entry[]=[];let total=0,seen=0;
  zip.on('error',reject);zip.on('entry',entry=>{seen++;if(seen>100000){reject(Error('文档目录超过 100,000 项'));return;}if(include(entry.fileName)){total+=entry.uncompressedSize;if(entry.uncompressedSize>32*1024*1024||total>64*1024*1024){reject(Error('文档解压后的正文超过 64 MB'));return;}entries.push(entry);}if(seen%1024===0)progress?.('读取文档目录');zip.readEntry();});zip.on('end',()=>resolve(entries));zip.readEntry();
 });return {zip,entries:entries.sort((a,b)=>a.fileName.localeCompare(b.fileName,undefined,{numeric:true}))};}catch(e){zip.close();throw e;}
}
async function* textStream(zip:ZipFile,entry:Entry,progress?:DocumentOptions['progress']){
 const stream=await new Promise<import('node:stream').Readable>((resolve,reject)=>zip.openReadStream(entry,(error,value)=>error||!value?reject(error||Error('无法提取正文')):resolve(value)));let decoder:ReturnType<typeof iconv.getDecoder>|undefined,size=0;
 try{for await(const bytes of stream){const buffer=bytes as Buffer;size+=buffer.length;if(size>32*1024*1024)throw Error('文档正文超过大小限制');if(!decoder)decoder=iconv.getDecoder(buffer[0]===0xff&&buffer[1]===0xfe?'utf16le':buffer[0]===0xfe&&buffer[1]===0xff?'utf16be':'utf8');const text=decoder.write(buffer);if(text)yield text;progress?.('提取 Office 正文');}const tail=decoder?.end();if(tail)yield tail;}finally{(stream as import('node:stream').Readable).destroy();}
}
function makeParser(){const options={trim:false,normalize:false,strictEntities:true},parser=xmlParser(true,options);parser.onerror=error=>{throw Error('正文 XML 无效：'+error.message.split('\n')[0]);};return parser;}
/** Only the visible text is retained; the parser never builds a document node tree. */
async function* body(zip:ZipFile,entry:Entry,page:number,options:DocumentOptions,spreadsheet:boolean,strings:(index:number)=>string){
 const parser=makeParser(),stack:string[]=[];let paragraphDepth=0,carry='',line=1;const pending:DocumentPart[]=[];
 let cell:{type:string;value:string;text:string;formula:string}|undefined;
 const append=(text:string)=>{carry+=text;while(carry.length>=16000){let end=16000;if(carry.charCodeAt(end-1)>=0xd800&&carry.charCodeAt(end-1)<=0xdbff&&carry.charCodeAt(end)>=0xdc00&&carry.charCodeAt(end)<=0xdfff)end--;const value=carry.slice(0,end);pending.push({text:value,page,line});line+=countLines(value);carry=carry.slice(end);}};
 parser.onopentag=(tag:Tag)=>{
  const name=local(tag.name);stack.push(name);
  if(spreadsheet){if(name==='c')cell={type:String(tag.attributes.t||''),value:'',text:'',formula:''};return;}
  if(['p','h','title'].includes(name))paragraphDepth++;
  if(paragraphDepth){if(['br','cr','line-break'].includes(name))append('\n');else if(name==='tab')append('\t');else if(name==='s'){const raw=tag.attributes['text:c']||tag.attributes.c||1,n=Number(raw);if(!Number.isSafeInteger(n)||n<1||n>10000)throw Error('文档空格重复数无效');append(' '.repeat(n));}}
 };
 const text=(value:string)=>{if(spreadsheet&&cell){const name=stack.at(-1);if(name==='v')cell.value+=value;else if(name==='t'&&!stack.includes('rPh'))cell.text+=value;else if(name==='f')cell.formula+=value;}else if(!spreadsheet&&paragraphDepth)append(value);};parser.ontext=text;parser.oncdata=text;
 parser.onclosetag=tag=>{const name=local(tag);if(spreadsheet&&name==='c'&&cell){const value=cell.type==='s'?(/^\d+$/.test(cell.value.trim())?strings(Number(cell.value)):'' ):cell.value||cell.text||cell.formula;append(value+'\n');cell=undefined;}else if(!spreadsheet&&['p','h','title'].includes(name)){append('\n');paragraphDepth--;}stack.pop();};
 for await(const text of textStream(zip,entry,options.progress)){parser.write(text);while(pending.length)yield pending.shift()!;}parser.close();while(pending.length)yield pending.shift()!;if(carry)yield{text:carry,page,line};
}
async function sharedStrings(zip:ZipFile,entry:Entry,options:DocumentOptions,put:(index:number,text:string)=>void){
 const parser=makeParser(),stack:string[]=[];let index=0,text='',inside=false;
 parser.onopentag=(tag:Tag)=>{const name=local(tag.name);stack.push(name);if(name==='si'){inside=true;text='';}};
 const capture=(value:string)=>{if(inside&&stack.at(-1)==='t'&&!stack.includes('rPh'))text+=value;};parser.ontext=capture;parser.oncdata=capture;
 parser.onclosetag=name=>{if(local(name)==='si'){put(index++,text);text='';inside=false;}stack.pop();};
 for await(const text of textStream(zip,entry,options.progress))parser.write(text);parser.close();
}
export async function* extractOffice(path:string,ext:string,options:DocumentOptions):AsyncGenerator<DocumentPart>{
 const {zip,entries}=await archive(path,name=>ext==='docx'?/^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(name):ext==='pptx'?/^ppt\/slides\/slide\d+\.xml$/.test(name):ext==='xlsx'||ext==='xlsm'?/^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(name):name==='content.xml',options.progress);
 const spreadsheet=ext==='xlsx'||ext==='xlsm',memory:string[]=[],store=options.sharedStrings;
 try{
  const shared=entries.find(e=>e.fileName==='xl/sharedStrings.xml');if(shared){store?.clear();await sharedStrings(zip,shared,options,(id,text)=>store?store.put(id,text):memory[id]=text);}
  let page=0;for(const entry of entries){if(entry===shared)continue;page++;yield* body(zip,entry,page,options,spreadsheet,index=>store?store.get(index):memory[index]||'');}
 }finally{zip.close();store?.clear();}
}
export async function* extractEbook(path:string,options:DocumentOptions,convert:(text:string)=>string):AsyncGenerator<DocumentPart>{
 const {zip,entries}=await archive(path,name=>/\.(xhtml|html|htm)$/i.test(name),options.progress);
 try{let page=0;for(const entry of entries){let text='';for await(const part of textStream(zip,entry,options.progress))text+=part;yield{text:convert(text),page:++page,line:1};}}finally{zip.close();}
}
