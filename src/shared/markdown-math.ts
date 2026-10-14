import type {MarkedExtension,Tokens} from 'marked';
/** Token rules adapted from marked-katex-extension 5.1.13, MIT, © 2021 @markedjs.
 * One renders math in its own bounded worker; no plugin renderer is needed.
 * Full license is preserved in THIRD_PARTY_NOTICES.txt. */
const inline=/^(\${1,2})(?!\$)((?:\\.|[^\\\n$])*?(?:\\.|[^\\\n\$]))\1(?=[\s?!\.,:？！。，：]|$)/;
const block=/^(\${1,2})\n((?:\\[^]|[^\\])+?)\n\1(?:\n|$)/;
export function markedMath():MarkedExtension{
  const token=(source:string,rule:RegExp,type:string)=>{const match=source.match(rule);return match?{type,raw:match[0],text:match[2].trim(),displayMode:match[1].length===2}:undefined;};
  return {extensions:[{name:'inlineKatex',level:'inline',start(source:string){
    let offset=0;while(offset<source.length){const index=source.indexOf('$',offset);if(index<0)return;
      if((index===0||source[index-1]===' ')&&inline.test(source.slice(index)))return index;offset=index+1;
    }
  },tokenizer(source:string,_tokens:Tokens.Generic[]){return token(source,inline,'inlineKatex');}},
  {name:'blockKatex',level:'block',tokenizer(source:string,_tokens:Tokens.Generic[]){return token(source,block,'blockKatex');}}]};
}
