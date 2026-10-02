import {EditorState,Text} from '@codemirror/state';
import {EditorView,lineNumbers,drawSelection,keymap,highlightSpecialChars,highlightActiveLineGutter} from '@codemirror/view';
import {syntaxHighlighting,HighlightStyle,foldGutter,foldKeymap,LanguageDescription} from '@codemirror/language';
import {languages} from '@codemirror/language-data';
import {defaultKeymap} from '@codemirror/commands';
import {SearchQuery,setSearchQuery,findNext,findPrevious,highlightSelectionMatches,search as searchExtension} from '@codemirror/search';
import {tags} from '@lezer/highlight';
import CodeWorker from './code-worker?worker';
import {esc,icon,iconButton,toast} from './ui';
import type {PreviewData} from '../shared/types';
const views=new WeakMap<HTMLElement,EditorView>();
export const codeText=(host:HTMLElement)=>views.get(host)?.state.doc.toString();
const highlight=HighlightStyle.define([
 {tag:[tags.keyword,tags.modifier,tags.operatorKeyword],class:'syntax-keyword'},
 {tag:[tags.string,tags.special(tags.string)],class:'syntax-string'},
 {tag:[tags.number,tags.bool,tags.null],class:'syntax-number'},
 {tag:[tags.comment,tags.meta],class:'syntax-comment'},
 {tag:[tags.propertyName,tags.attributeName,tags.labelName],class:'syntax-property'},
 {tag:[tags.typeName,tags.className,tags.tagName],class:'syntax-type'},
 {tag:[tags.function(tags.variableName),tags.definition(tags.variableName)],class:'syntax-function'},
]);
const theme=EditorView.theme({
 '&':{height:'100%',backgroundColor:'var(--surface)',color:'var(--fg)',fontSize:'12px'},
 '.cm-scroller':{overflow:'auto',fontFamily:'"Cascadia Code",Consolas,"Microsoft YaHei UI",monospace',lineHeight:'1.8'},
 '.cm-content':{padding:'18px 0'},'.cm-line':{padding:'0 22px 0 12px'},
 '.cm-gutters':{backgroundColor:'var(--surface)',color:'var(--muted)',borderRight:'none',padding:'0 5px 0 10px'},
 '.cm-activeLineGutter':{backgroundColor:'var(--soft)'},'.cm-selectionBackground':{backgroundColor:'var(--selected) !important'},
 '&.cm-focused':{outline:'none'},'.cm-foldPlaceholder':{border:'none',backgroundColor:'var(--soft)',color:'var(--muted)',padding:'0 5px'},
 '.cm-searchMatch':{backgroundColor:'#e9bd4f40',outline:'none'},'.cm-searchMatch-selected':{backgroundColor:'#e9bd4f80'},
});
export function languageFor(name:string){
 const lower=name.toLowerCase();let result=LanguageDescription.matchFilename(languages,name)||LanguageDescription.matchFilename(languages,lower);
 if(!result){const type=/^(\.env(?:\..*)?|\.npmrc|\.yarnrc|.*\.(conf|cfg|properties))$/.test(lower)?'properties':/\.(ini|reg)$/.test(lower)?'ini':/\.(poytoml|lock)$/.test(lower)?'toml':/\.(jsonl|ndjson|ipynb)$/.test(lower)?'json':/\.(ps1|psm1|psd1)$/.test(lower)?'powershell':/\.(bat|cmd)$/.test(lower)?'powershell':undefined;if(type)result=LanguageDescription.matchLanguageName(languages,type,true);}
 return result;
}
export function renderCode(host:HTMLElement,data:PreviewData,wrap:boolean,metadata:(v:Record<string,string>)=>void=()=>{},format=false){
 const root=document.createElement('div');root.className='code-reader';root.innerHTML=`<div class="code-search" hidden><input aria-label="查找文本" placeholder="查找文本">${iconButton('code-prev','上一个匹配','up')}${iconButton('code-next','下一个匹配','chevron-down')}${iconButton('code-close','关闭查找','close')}</div><div class="code-mount"><div class="preview-loading">${icon('file')}<span>正在读取…</span></div></div>`;host.append(root);
 let disposed=false,view:EditorView|undefined;const worker=new CodeWorker();const mount=root.querySelector<HTMLElement>('.code-mount')!,search=root.querySelector<HTMLElement>('.code-search')!,input=search.querySelector<HTMLInputElement>('input')!;
 const load=new Promise<string[]>((resolve,reject)=>{worker.onmessage=e=>{worker.terminate();e.data.error?reject(new Error(e.data.error)):resolve(e.data.lines);};worker.onerror=e=>reject(new Error(e.message));});
 worker.postMessage({text:data.text,url:data.textURL,type:data.type,format});
 const searchNext=(back=false)=>{if(!view||!input.value)return;view.dispatch({effects:setSearchQuery.of(new SearchQuery({search:input.value,literal:true}))});if(!(back?findPrevious:findNext)(view))toast('未找到');};
 root.querySelector('#code-next')!.addEventListener('click',()=>searchNext());root.querySelector('#code-prev')!.addEventListener('click',()=>searchNext(true));root.querySelector('#code-close')!.addEventListener('click',()=>{search.hidden=true;view?.focus();});input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();searchNext(e.shiftKey);}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();search.hidden=true;view?.focus();}};
 const showSearch=()=>{search.hidden=false;input.focus();input.select();return true;};
 const key=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'){e.preventDefault();e.stopPropagation();showSearch();}};root.addEventListener('keydown',key);
 void load.then(async lines=>{
  if(disposed)return;const language=languageFor(data.name);mount.replaceChildren();
  // CodeMirror virtualizes the document; creating its rope does not create a DOM row for every line.
  view=new EditorView({parent:mount,state:EditorState.create({doc:Text.of(lines),extensions:[EditorState.readOnly.of(true),EditorView.editable.of(false),EditorView.contentAttributes.of({tabindex:'0','aria-label':'文件源码'}),lineNumbers(),foldGutter(),highlightSpecialChars(),drawSelection(),highlightActiveLineGutter(),highlightSelectionMatches(),searchExtension(),theme,syntaxHighlighting(highlight),keymap.of([{key:'Mod-f',run:showSearch},...defaultKeymap,...foldKeymap]),...(wrap?[EditorView.lineWrapping]:[])]})});
  views.set(host,view);metadata({'行数':lines.length.toLocaleString(),'语言':language?.name||'纯文本'});
  if(language){const support=await language.load();if(!disposed&&view)view.dispatch({effects:importStateEffect.of(support)});}
 }).catch(error=>{if(!disposed){mount.innerHTML=`<p class="render-error">${esc(error.message)}</p>`;toast(error);}});
 return()=>{disposed=true;worker.terminate();view?.destroy();views.delete(host);root.remove();};
}
import {StateEffect} from '@codemirror/state';
const importStateEffect=StateEffect.appendConfig;
