export interface RegexRequest {pattern:string;flags:string;text:string;replacement:string;replace:boolean;selectedIndex?:number}
export interface RegexMatch {start:number;end:number;value:string;groups:(string|null)[];named:Record<string,string|null>}
export interface RegexResult {matches:RegexMatch[];truncated:boolean;preview?:string}
const matchLimit=100;
export function runRegex(request:RegexRequest):RegexResult{
 const {pattern,flags,text,replacement,replace,selectedIndex}=request;
 if(typeof pattern!=='string'||pattern.length>2000||typeof text!=='string'||text.length>100_000||typeof replacement!=='string'||replacement.length>200)throw Error('输入过长：表达式限 2,000 字符，测试文本限 100,000 字符，替换文本限 200 字符');
 if(typeof flags!=='string'||!/^[gimsu]*$/.test(flags)||new Set(flags).size!==flags.length||typeof replace!=='boolean')throw Error('正则选项无效');
 if(selectedIndex!==undefined&&(!Number.isInteger(selectedIndex)||selectedIndex<0||selectedIndex>=matchLimit||!replace))throw Error('匹配序号无效');
 let expression:RegExp;try{expression=new RegExp(pattern,flags+'d');}catch(error){throw Error(`正则表达式无效：${(error as Error).message}`);}
 const matches:RegexMatch[]=[];let truncated=false;
 while(true){const found=expression.exec(text);if(!found)break;if(matches.length>=matchLimit){truncated=true;break;}
  const indices=found.indices?.[0]||[found.index,found.index+found[0].length];
  matches.push({start:indices[0],end:indices[1],value:found[0].slice(0,300),groups:found.slice(1).map(value=>value===undefined?null:value.slice(0,300)),named:Object.fromEntries(Object.entries(found.groups||{}).map(([key,value])=>[key,value===undefined?null:value.slice(0,300)]))});
  if(!expression.global)break;
  if(found[0]===''){if(expression.lastIndex>=text.length)break;const code=text.codePointAt(expression.lastIndex)!;expression.lastIndex+=flags.includes('u')&&code>0xffff?2:1;}
 }
 let preview:string|undefined;
 if(replace){
  if(selectedIndex===undefined)preview=text.replace(new RegExp(pattern,flags),replacement);
  else {
   const chosen=matches[selectedIndex];if(!chosen)throw Error('所选匹配已失效，请重新测试');
   const single=new RegExp(pattern,flags.replace('g','')+'y');single.lastIndex=chosen.start;
   preview=text.replace(single,replacement);
  }
 }
 if(preview!==undefined&&preview.length>200_000)throw Error('替换结果超过 200,000 字符上限');
 return {matches,truncated,preview};
}
