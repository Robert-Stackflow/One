import * as OpenCC from 'opencc-js';
import type { TextRequest } from './types';
let toSimple:ReturnType<typeof OpenCC.Converter>|undefined;
let toTraditional:ReturnType<typeof OpenCC.Converter>|undefined;
export const lines = (text: string) => text.replace(/\r\n?/g, '\n').split('\n');
/** Keep only bounded output pieces instead of several arrays of every input line. */
function mapLines(text:string,map:(line:string)=>string|undefined,separator='\r\n'){
  const blocks:string[]=[],parts:string[]=[];let at=0,lf=text.indexOf('\n'),cr=text.indexOf('\r'),size=0,emitted=false;
  while(true){
    const end=lf<0?cr:cr<0?lf:Math.min(lf,cr),value=map(text.slice(at,end<0?text.length:end));
    if(value!==undefined){
      if(emitted){parts.push(separator);size+=separator.length;}emitted=true;parts.push(value);size+=value.length;
      if(size>=65536||parts.length>=4096){blocks.push(parts.join(''));parts.length=0;size=0;}
    }
    if(end<0)break;
    at=end+(end===cr&&lf===end+1?2:1);
    if(lf>=0&&lf<at)lf=text.indexOf('\n',at);
    if(cr>=0&&cr<at)cr=text.indexOf('\r',at);
  }
  if(parts.length)blocks.push(parts.join(''));return blocks.join('');
}
export function transform(request: TextRequest): string {
  const { text, operation } = request;
  if (typeof text !== 'string' || text.length > 10_000_000) throw new Error('文本超过本版处理限制');
  switch (operation) {
    case 'clean': return mapLines(text,line=>line.trim()||undefined);
    case 'unique': {const seen=new Set<string>();return mapLines(text,line=>{if(seen.has(line))return;seen.add(line);return line;});}
    case 'sort': return lines(text).sort().join('\r\n');
    case 'simple': return (toSimple??=OpenCC.Converter({from:'twp',to:'cn'}))(text);
    case 'traditional': return (toTraditional??=OpenCC.Converter({from:'cn',to:'twp'}))(text);
    case 'half': return text.replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\u3000/g, ' ');
    case 'full': return text.replace(/[!-~]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xFEE0)).replace(/ /g, '\u3000');
    case 'trim': return mapLines(text,line=>line.trim());
    case 'trimEnd': return text.replace(/[^\S\r\n]+(?=\r?$)/gm,'');
    case 'empty': return mapLines(text,line=>line.trim()?line:undefined);
    case 'paragraphSpace': return mapLines(text,line=>line.trim()?line:undefined,'\r\n\r\n');
    case 'joinParagraph': return text.replace(/\r\n?/g,'\n').replace(/([^\n])\n(?=[^\n \t\u3000])/g,'$1').replace(/\n/g,'\r\n');
    case 'indent': return mapLines(text,line=>line.trim()?'\u3000\u3000'+line.trimStart():line);
    case 'layout': return mapLines(text,line=>{const value=line.trim();return value?'\u3000\u3000'+value:undefined;});
    case 'punctuation': {const map:Record<string,string>={',':'，',';':'；',':':'：','!':'！','?':'？','(':'（',')':'）'};return text.replace(/(?<!\d)[,;:!?()]|[,;:!?()](?!\d)/g,c=>map[c]).replace(/"([^"\r\n]*)"/g,'“$1”').replace(/'([^'\r\n]*)'/g,'‘$1’').replace(/\.{3,6}/g,'……');}
    case 'vertical': {const from='︐︑︒︓︔︕︖︵︶︷︸︹︺︻︼︽︾︿﹀﹁﹂﹃﹄',to='，、。：；！？（）{}〔〕【】《》〈〉「」『』';return text.replace(/[︐-﹄]/g,c=>from.includes(c)?to[from.indexOf(c)]:c);}
    case 'upper':return text.toLocaleUpperCase();case 'lower':return text.toLocaleLowerCase();
    case 'reverse':return lines(text).reverse().join('\r\n');
    case 'natural':return lines(text).sort(new Intl.Collator('zh-CN',{numeric:true}).compare).join('\r\n');
    case 'removeLetters':return text.replace(/[A-Za-z]/g,'');case 'removeDigits':return text.replace(/[0-9０-９]/g,'');case 'removePunctuation':return text.replace(/\p{P}/gu,'');
    case 'normalize':return text.normalize('NFC');
    case 'wrap': {const width=request.width||80;if(!Number.isInteger(width)||width<10||width>1000)throw new Error('行宽应为 10–1000');return lines(text).map(line=>{let col=0,out='';for(const char of line){const w=char.codePointAt(0)!>255?2:1;if(col+w>width){out+='\r\n';col=0;}out+=char;col+=w;}return out;}).join('\r\n');}
    case 'brackets': {const pairs:Record<string,string>={'(' :')','[':']','{':'}','（':'）','【':'】','《':'》','「':'」','『':'』','“':'”','‘':'’'},ends=new Set(Object.values(pairs)),stack:{end:string;index:number}[]=[];for(let i=0;i<text.length;i++){const c=text[i];if(pairs[c])stack.push({end:pairs[c],index:i});else if(ends.has(c)&&stack.pop()?.end!==c)throw new Error(`第 ${i+1} 个字符的括号未配对：${c}`);}if(stack.length)throw new Error(`第 ${stack[0].index+1} 个字符的括号未闭合`);return text;}
    case 'replace': {
      if (!request.pattern) throw new Error('请输入查找内容');
      const flags = 'gm' + (request.ignoreCase ? 'i' : '');
      if (request.regex) return text.replace(new RegExp(request.pattern, flags), request.replacement ?? '');
      const literal = request.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return text.replace(new RegExp(literal, flags), () => request.replacement ?? '');
    }
    default: throw new Error('不支持的处理方式');
  }
}
