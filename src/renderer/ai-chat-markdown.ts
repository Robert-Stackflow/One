import {Marked,Renderer,type Tokens,type TokenizerAndRendererExtension} from 'marked';
import 'katex/dist/katex.min.css';
import katex from 'katex';
import {StreamLanguage} from '@codemirror/language';
import {highlightTree,tagHighlighter,tags} from '@lezer/highlight';
import {javascript,typescript,json} from '@codemirror/legacy-modes/mode/javascript';
import {python} from '@codemirror/legacy-modes/mode/python';
import {shell} from '@codemirror/legacy-modes/mode/shell';
import {standardSQL} from '@codemirror/legacy-modes/mode/sql';
import {xml} from '@codemirror/legacy-modes/mode/xml';
import {css} from '@codemirror/legacy-modes/mode/css';
import {c,cpp,java,csharp} from '@codemirror/legacy-modes/mode/clike';
const tr=(text:string)=>text;
import {iconButton} from './ui';
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const languages:Record<string,StreamLanguage<unknown>>={};
for(const [aliases,mode]of [['js javascript jsx',javascript],['ts typescript tsx',typescript],['json jsonc',json],['py python',python],['sh shell bash zsh',shell],['sql',standardSQL],['html xml svg',xml],['css scss less',css],['c',c],['cpp c++',cpp],['java',java],['csharp cs',csharp]] as const){const language=StreamLanguage.define(mode);for(const name of aliases.split(' '))languages[name]=language;}
const colors=tagHighlighter([{tag:[tags.keyword,tags.modifier,tags.operatorKeyword],class:'syntax-keyword'},{tag:[tags.string,tags.special(tags.string)],class:'syntax-string'},{tag:[tags.number,tags.bool,tags.null],class:'syntax-number'},{tag:[tags.comment,tags.meta],class:'syntax-comment'},{tag:[tags.propertyName,tags.attributeName,tags.labelName],class:'syntax-property'},{tag:[tags.typeName,tags.className,tags.tagName],class:'syntax-type'},{tag:[tags.function(tags.variableName),tags.definition(tags.variableName)],class:'syntax-function'}]);
function highlighted(text:string,name:string){const language=languages[name];if(!language||text.length>64000)return escape(text);let output='',cursor=0;try{highlightTree(language.parser.parse(text),colors,(from,to,classes)=>{output+=escape(text.slice(cursor,from))+`<span class="${classes}">${escape(text.slice(from,to))}</span>`;cursor=to;});return output+escape(text.slice(cursor));}catch{return escape(text);}}
function math(text:string,display:boolean){if(text.length>4000)return `<code>${escape(text)}</code>`;try{return `<span class="chat-math ${display?'chat-math-display':''}">${katex.renderToString(text,{displayMode:display,throwOnError:false,trust:false,strict:'ignore',maxExpand:100,maxSize:10,output:'htmlAndMathml'})}</span>`;}catch{return escape(text);}}
const extensions:TokenizerAndRendererExtension[]=[{
 name:'chatMathBlock',level:'block',start:source=>source.search(/\$\$|\\\[/),tokenizer(source){const match=/^(?:\$\$\s*\n?([\s\S]+?)\n?\$\$|\\\[([\s\S]+?)\\\])(?:[ \t]*\n|$)/.exec(source);if(match)return {type:'chatMathBlock',raw:match[0],text:(match[1]||match[2]).trim()};},renderer:token=>math(token.text,true)
},{
 name:'chatMathInline',level:'inline',start:source=>source.search(/\$|\\\(|\\\[/),tokenizer(source){let match=/^\\\(([\s\S]+?)\\\)/.exec(source);if(match)return {type:'chatMathInline',raw:match[0],text:match[1],display:false};match=/^(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])/.exec(source);if(match)return {type:'chatMathInline',raw:match[0],text:match[1]||match[2],display:true};match=/^\$(?!\$)((?:\\.|[^\\$\n])+?)\$(?!\d)/.exec(source);if(match&&match[1].trim()===match[1])return {type:'chatMathInline',raw:match[0],text:match[1],display:false};},renderer:token=>math(token.text,token.display)
}];
const renderer=new Renderer();renderer.html=token=>escape(token.text);renderer.image=token=>escape(token.text);
renderer.link=function(token){try{const url=new URL(token.href);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?`<a href="${escape(url.href)}" rel="noreferrer">${this.parser.parseInline(token.tokens)}</a>`:escape(token.text);}catch{return escape(token.text);}};
const defaultTable=renderer.table;renderer.table=function(token){return `<div class="chat-table">${defaultTable.call(this,token)}</div>`;};
renderer.code=(token:Tokens.Code)=>{const language=(token.lang||'').split(/\s/)[0].slice(0,40).toLowerCase(),label=language||tr('代码');return `<section class="chat-code"><div class="chat-code-heading"><span>${escape(label)}</span>${iconButton('',tr('复制代码'),'copy').replace('<button ','<button data-copy-code="true" ')}</div><pre><code>${highlighted(token.text,language)}\n</code></pre></section>`;};
const parser=new Marked({renderer,extensions,gfm:true,breaks:true,async:false});
/** All model HTML is escaped; math disallows trusted commands and remote images never load. */
export const chatMarkdown=(text:string)=>parser.parse(text) as string;
