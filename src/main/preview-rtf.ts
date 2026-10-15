import {open} from 'node:fs/promises';
import type {RichTextPreview,RichTextParagraph} from '../shared/application-preview';
type State={skip:boolean;capture?:string;bold:boolean;italic:boolean;underline:boolean;strike:boolean;hidden:boolean;fontSize:number;align:RichTextParagraph['align'];uc:number;encoding:string};
const ignored=new Set(['fonttbl','colortbl','stylesheet','listtable','listoverridetable','revtbl','rsidtbl','xmlnstbl','datastore','themedata','colorschememapping','generator','pict','object','objdata','fldinst','header','headerl','headerr','footer','footerl','footerr','annotation','footnote','pntext','nonshppict','shppict']);
const captures:Record<string,string>={title:'标题',author:'作者',subject:'主题',keywords:'关键词',company:'公司',operator:'最后编辑者'};
export async function inspectRtf(path:string){
  const file=await open(path,'r');
  try{
    const before=await file.stat();if(before.size>8*1024*1024)throw Error('RTF 超过 8 MB，无法预览');
    const bytes=Buffer.alloc(before.size);let read=0;
    while(read<bytes.length){const result=await file.read(bytes,read,bytes.length-read,read);if(!result.bytesRead)throw Error('RTF 文件已截断');read+=result.bytesRead;}
    const after=await file.stat();if(after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw Error('RTF 文件已改变，请重新预览');
    return parseRtf(bytes);
  }finally{await file.close();}
}
export function parseRtf(bytes:Buffer){
  let source=bytes.toString('latin1');if(source.startsWith('\xef\xbb\xbf'))source=source.slice(3);
  if(!/^\{\\rtf1\b/.test(source)||bytes.length>8*1024*1024)throw Error('不是有效的 RTF 文档');
  let state:State={skip:false,bold:false,italic:false,underline:false,strike:false,hidden:false,fontSize:24,align:'left',uc:1,encoding:'windows-1252'};
  const stack:State[]=[],metadata:Record<string,string>={'格式':'RTF'},paragraphs:RichTextParagraph[]=[];
  let paragraph:RichTextParagraph={align:'left',runs:[]},ansi:number[]=[],fallback=0,characters=0,runs=0,pictures=0,objects=0,closed=false;
  const emit=(text:string)=>{
    if(!text)return;
    if(state.capture){metadata[state.capture]=((metadata[state.capture]||'')+text).slice(0,2048);return;}
    if(state.skip||state.hidden)return;
    characters+=text.length;if(characters>1024*1024)throw Error('RTF 正文超过预览上限');
    const previous=paragraph.runs.at(-1);
    if(previous&&previous.bold===state.bold&&previous.italic===state.italic&&previous.underline===state.underline&&previous.strike===state.strike&&previous.fontSize===state.fontSize)previous.text+=text;
    else{if(++runs>30000)throw Error('RTF 样式项目过多');paragraph.runs.push({text,bold:state.bold,italic:state.italic,underline:state.underline,strike:state.strike,fontSize:state.fontSize});}
  };
  let decoder:TextDecoder|undefined;
  const flush=(stream=false)=>{
    if(!ansi.length&&!decoder)return;
    decoder??=new TextDecoder(state.encoding);emit(decoder.decode(new Uint8Array(ansi),{stream}));ansi=[];
    if(!stream)decoder=undefined;
  };
  const byte=(value:number)=>{if(fallback){fallback--;return;}if(state.skip&&!state.capture||state.hidden)return;ansi.push(value);if(ansi.length>=4096)flush(true);};
  const character=(text:string)=>{flush();if(fallback){fallback--;return;}emit(text);};
  const line=()=>{flush();if(state.skip||state.hidden)return;paragraphs.push(paragraph);if(paragraphs.length>20000)throw Error('RTF 段落过多');paragraph={align:state.align,runs:[]};};
  for(let at=0;at<source.length;){
    const char=source[at++];
    if(closed){if(!/\s/.test(char))throw Error('RTF 文档尾部无效');continue;}
    if(char==='{'){flush();if(stack.length>=256)throw Error('RTF 嵌套过深');stack.push({...state});continue;}
    if(char==='}'){flush();if(!stack.length)throw Error('RTF 分组无效');state=stack.pop()!;if(!stack.length)closed=true;continue;}
    if(!stack.length)throw Error('RTF 分组无效');
    if(char==='\\'){
      if(at>=source.length)throw Error('RTF 转义已截断');
      const symbol=source[at++];
      if(symbol==="'"){const value=source.slice(at,at+2);if(!/^[0-9a-f]{2}$/i.test(value))throw Error('RTF 字符转义无效');at+=2;byte(parseInt(value,16));continue;}
      if(symbol==='\\'||symbol==='{'||symbol==='}'){byte(symbol.charCodeAt(0));continue;}
      if(!/[a-z]/i.test(symbol)){flush();if(symbol==='*'){state.skip=true;state.capture=undefined;}else if(symbol==='~')character('\u00a0');else if(symbol==='_')character('\u2011');else if(symbol==='-')character('\u00ad');continue;}
      let word=symbol;while(at<source.length&&/[a-z]/i.test(source[at])){word+=source[at++];if(word.length>40)throw Error('RTF 控制字过长');}
      let digits='';if(source[at]==='-')digits+=source[at++];while(at<source.length&&/[0-9]/.test(source[at])){digits+=source[at++];if(digits.length>11)throw Error('RTF 数值无效');}
      if(source[at]===' ')at++;
      const number=digits&&digits!=='-'?Number(digits):undefined;flush();
      if(number!==undefined&&(!Number.isSafeInteger(number)||Math.abs(number)>2147483647))throw Error('RTF 数值超出范围');
      if(word==='bin'){if(number===undefined||number<0||at+number>source.length)throw Error('RTF 二进制内容已截断');at+=number;continue;}
      if(word==='info'){state.skip=true;continue;}
      if(captures[word]&&state.skip){state.capture=captures[word];continue;}
      if(ignored.has(word)){state.skip=true;state.capture=undefined;if(word==='pict')pictures++;if(word==='object')objects++;continue;}
      if(word==='nofpages'&&number!==undefined)metadata['页数']=String(number);
      if(word==='nofwords'&&number!==undefined)metadata['字数']=String(number);
      if(word==='ansicpg'&&number!==undefined){state.encoding=({65001:'utf-8',936:'gbk',950:'big5',932:'shift_jis',949:'euc-kr',54936:'gb18030',866:'ibm866'} as Record<number,string>)[number]||'windows-'+number;try{state.encoding=new TextDecoder(state.encoding).encoding;}catch{throw Error('RTF 字符编码暂不支持');}metadata['编码']=state.encoding;}
      if(word==='uc'&&number!==undefined){if(number<0||number>32)throw Error('RTF Unicode 回退长度无效');state.uc=number;}
      if(word==='u'&&number!==undefined){emit(String.fromCharCode(number&0xffff));fallback=state.uc;continue;}
      if(state.skip&&!state.capture)continue;
      if(word==='par'||word==='page'||word==='sect'){if(state.capture)emit('\n');else line();}
      else if(word==='line')character('\n');
      else if(word==='tab'||word==='cell')character('\t');
      else if(word==='row')line();
      else if(word==='b')state.bold=number!==0;
      else if(word==='i')state.italic=number!==0;
      else if(word==='ul')state.underline=number!==0;
      else if(word==='ulnone')state.underline=false;
      else if(word==='strike')state.strike=number!==0;
      else if(word==='v')state.hidden=number!==0;
      else if(word==='fs'&&number!==undefined)state.fontSize=Math.max(12,Math.min(144,number));
      else if(word==='plain'){state.bold=false;state.italic=false;state.underline=false;state.strike=false;state.hidden=false;state.fontSize=24;}
      else if(['ql','qc','qr','qj','pard'].includes(word)){state.align=({qc:'center',qr:'right',qj:'justify'} as Record<string,State['align']>)[word]||'left';paragraph.align=state.align;}
      else if(['emdash','endash','bullet','lquote','rquote','ldblquote','rdblquote'].includes(word))character(({emdash:'\u2014',endash:'\u2013',bullet:'\u2022',lquote:'\u2018',rquote:'\u2019',ldblquote:'\u201c',rdblquote:'\u201d'} as Record<string,string>)[word]);
      continue;
    }
    if(char!=='\r'&&char!=='\n')byte(char.charCodeAt(0));
  }
  flush();if(stack.length||!closed)throw Error('RTF 文档已截断');
  if(paragraph.runs.length||!paragraphs.length)paragraphs.push(paragraph);
  for(const key of Object.keys(metadata))metadata[key]=metadata[key].trim();
  metadata['正文字符']=String(characters);if(pictures)metadata['嵌入图片']=String(pictures)+'（不加载）';if(objects)metadata['嵌入对象']=String(objects)+'（不加载）';
  const richText:RichTextPreview={paragraphs};return {metadata,richText};
}
