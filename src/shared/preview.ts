export interface PreviewPreferences {
  pinned:boolean; held:boolean; files:boolean;
  leftWidth:number; leftTab:'files'|'details'|'outline'|'overview'; wrap:boolean;
}
export const defaultPreview=():PreviewPreferences=>({pinned:false,held:false,files:false,leftWidth:280,leftTab:'files',wrap:false});
export function validatePreview(value:unknown):PreviewPreferences{
  const result=defaultPreview();if(value===undefined)return result;
  if(!value||typeof value!=='object')throw new Error('预览设置无效');
  const v=value as PreviewPreferences & {details?:boolean};
  for(const k of ['pinned','held','files','wrap'] as const){if(typeof v[k]!=='boolean')throw new Error('预览开关无效');result[k]=v[k];}
  if(!Number.isInteger(v.leftWidth)||v.leftWidth<180||v.leftWidth>480)throw new Error('预览栏宽度无效');result.leftWidth=v.leftWidth;
  if(!['files','details','outline','overview'].includes(v.leftTab))throw new Error('预览侧栏无效');result.leftTab=v.leftTab;
  // Migrate the former right pane into the shared left pane.
  if(v.details&&!v.files){result.files=true;result.leftTab='details';}return result;
}
export interface OpenWithApp {id:string;name:string;icon?:string}
export interface LyricLine {time:number;text:string}
export function decodePreviewText(bytes:Uint8Array){
 if(bytes.byteLength>50*1024*1024)throw new Error('文本超过 50 MB');
 const encoding=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';
 return new TextDecoder(encoding,{fatal:true}).decode(bytes);
}
export function parseLyrics(text:string):LyricLine[]{
  const result:LyricLine[]=[];let offset=Number(text.match(/\[offset:([+-]?\d+)\]/i)?.[1]||0)/1000;
  for(const line of text.split(/\r?\n/).slice(0,10000)){
    const times=[...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];const content=line.replace(/\[[^\]]*\]/g,'').trim();
    if(times.length){for(const t of times)result.push({time:Math.max(0,Number(t[1])*60+Number(t[2])+offset),text:content});}
    else if(content)result.push({time:-1,text:content});
  }
  return result.sort((a,b)=>a.time-b.time);
}
export const textExtensions=/^(ipynb|txt|md|mdx|mdown|markdown|json|jsonc|jsonl|ndjson|csv|tsv|log|ts|tsx|js|jsx|mjs|cjs|css|scss|sass|less|html|htm|xml|xsd|xsl|svg|yaml|yml|ini|conf|cfg|ps1|psm1|psd1|bat|cmd|sh|bash|zsh|fish|py|pyi|pyw|cs|c|cpp|cxx|cc|h|hpp|go|rs|java|kt|kts|sql|toml|poytoml|vue|svelte|properties|gitignore|editorconfig|env|php|rb|r|lua|swift|dart|ex|exs|erl|hrl|clj|cljs|edn|hs|lhs|ml|mli|pl|pm|groovy|gradle|tex|bib|asm|s|f90|f|pas|d|nix|dockerfile|cmake|make|graphql|gql|proto|tf|hcl|v|sv|vhd|vhdl|diff|patch|reg|ahk|m|mm|lock)$/i;
