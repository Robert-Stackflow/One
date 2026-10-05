export type FileToolKind='duplicates'|'diff'|'rename-preview'|'rename-apply'|'rename-undo'|'document-index'|'document-search'|'integrity-create'|'integrity-verify';
export interface RenameOptions {search:string;replace:string;regex:boolean;caseSensitive:boolean;all:boolean;target:'name'|'stem'|'extension';caseMode:'keep'|'lower'|'upper'|'title';enumerate:boolean;start:number;increment:number;padding:number}
export const defaultRename=():RenameOptions=>({search:'',replace:'',regex:false,caseSensitive:false,all:true,target:'stem',caseMode:'keep',enumerate:false,start:1,increment:1,padding:3});
export type FileToolTask =
 |{kind:'duplicates';roots:string[];recursive:boolean;minBytes:number;extensions:string}
 |{kind:'diff';left:string;right:string;mode:'file'|'folder';ignoreWhitespace:boolean;encoding:string}
 |{kind:'rename-preview';paths:string[];recursive:boolean;files:boolean;folders:boolean;selectedOnly?:boolean;options:RenameOptions}
 |{kind:'rename-apply';report:string;ids?:number[];excluded?:number[]}
 |{kind:'rename-undo';receipt:string}
 |{kind:'document-index';roots:string[];recursive:boolean;extensions:string}
 |{kind:'document-search';roots:string[];query:string;recursive?:boolean}
 |{kind:'integrity-create';roots:string[];recursive:boolean}
 |{kind:'integrity-verify';manifest:string};
export interface FileStamp {path:string;size:number;mtime:string;birthtime:number;identity:string;directory:boolean}
export interface FileToolRow {id:number;[key:string]:unknown}
export interface FileToolReport {id:string;kind:FileToolKind;created:number;count:number;pageSize:number;summary:string;stats:Record<string,number>;issues:{path:string;error:string}[];issueCount:number;receipt?:string;scope?:string[];manifest?:string}
export interface FileToolProgress {id:string;kind:FileToolKind;phase:string;completed:number;total:number;path?:string;bytes?:number;found?:number}
export interface FileToolActive {id:string;kind:FileToolKind;started:number;phase:string;completed:number;total:number;path:string}
export interface FileToolFailure {kind:FileToolKind;at:number;message:string}
export interface FileToolOverview {version:string;index:{count:number;running:boolean;error:string};disk:{running:boolean;root:string;files:number;directories:number};volumes:import('./disk-monitor').VolumeStatus[];active:FileToolActive[];failures:FileToolFailure[];recent:FileToolReport[]}
export function renameName(name:string,options:RenameOptions,index:number,date:number,directory=false){
 const at=name.lastIndexOf('.'),hasExtension=!directory&&at>0,stem=hasExtension?name.slice(0,at):name,extension=hasExtension?name.slice(at+1):'';
 let value=options.target==='stem'?stem:options.target==='extension'?extension:name;
 const d=new Date(date),pad=(n:number,length=2)=>String(n).padStart(length,'0'),counter=options.start+index*options.increment;
 const replacements:Record<string,string>={$YYYY:String(d.getFullYear()),$YY:pad(d.getFullYear()%100),$MM:pad(d.getMonth()+1),$DD:pad(d.getDate()),$hh:pad(d.getHours()),$mm:pad(d.getMinutes()),$ss:pad(d.getSeconds())};
 let replacement=options.replace.replace(/\$(YYYY|YY|MM|DD|hh|mm|ss)/g,token=>replacements[token]).replace(/\$\{([^}]*)\}/g,(_,body:string)=>{if(body==='n'||body==='')return pad(counter,options.padding);const values=Object.fromEntries(body.split(';').map(s=>s.split('=')));if(!Object.keys(values).every(k=>['start','increment','padding'].includes(k)))throw Error('序号变量无效');const number=Number(values.start??options.start)+index*Number(values.increment??options.increment),length=Number(values.padding??options.padding);if(!Number.isSafeInteger(number)||!Number.isInteger(length)||length<0||length>12)throw Error('序号变量超出范围');return pad(number,length);});
 if(options.search){const source=options.regex?options.search:options.search.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),pattern=new RegExp(source,(options.all?'g':'')+(options.caseSensitive?'':'i'));value=options.regex?value.replace(pattern,replacement):value.replace(pattern,()=>replacement);}
 else if(replacement)value=replacement;
 if(options.enumerate&&!/\$\{/.test(options.replace))value+='_'+pad(counter,options.padding);
 if(options.caseMode==='lower')value=value.toLocaleLowerCase();else if(options.caseMode==='upper')value=value.toLocaleUpperCase();else if(options.caseMode==='title')value=value.toLocaleLowerCase().replace(/(^|[\s_-])(\p{L})/gu,(_,space:string,c:string)=>space+c.toLocaleUpperCase());
 const result=options.target==='stem'?value+(hasExtension?'.'+extension:''):options.target==='extension'?stem+(value?'.'+value:''):value;
 if(!result||/[<>:"/\\|?*\x00-\x1f]/.test(result)||/[ .]$/.test(result)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result)||result.length>255||result==='.'||result==='..')throw Error('名称包含 Windows 不允许的字符或保留名称');
 return result;
}
