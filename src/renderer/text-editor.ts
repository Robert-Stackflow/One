import {Compartment,EditorState,StateEffect,StateField,type Extension} from '@codemirror/state';
import {EditorView,drawSelection,keymap,lineNumbers,highlightActiveLineGutter,placeholder} from '@codemirror/view';
import {defaultKeymap,history,historyKeymap,invertedEffects} from '@codemirror/commands';
import {search,searchKeymap,openSearchPanel} from '@codemirror/search';
import {editEndings,parseText,serializeText,serializeTextAsync,yieldText,type LineEndings} from './text-document';
const restoreEndings=StateEffect.define<LineEndings>();
const endingsField=StateField.define<LineEndings>({
 create:()=>({codes:'',preferred:'1',extra:0}),
 update:(value,tr)=>{for(const effect of tr.effects)if(effect.is(restoreEndings))return effect.value;return tr.docChanged?editEndings(value,tr.startState.doc,tr.changes):value;},
});
const theme=EditorView.theme({
 '&':{height:'100%',fontSize:'12px',backgroundColor:'var(--surface)',color:'var(--fg)'},
 '.cm-scroller':{overflow:'auto',fontFamily:'"Cascadia Code",Consolas,"Microsoft YaHei UI",monospace',lineHeight:'1.8'},
 '.cm-content':{padding:'16px 0'},'.cm-line':{padding:'0 18px 0 12px'},
 '.cm-gutters':{backgroundColor:'var(--surface)',color:'var(--muted)',border:'none',padding:'0 4px 0 8px'},
 '.cm-activeLineGutter':{backgroundColor:'var(--soft)'},'&.cm-focused':{outline:'none'},
 '.cm-selectionBackground':{backgroundColor:'var(--selected) !important'},
 '.cm-panels':{backgroundColor:'var(--surface)',color:'var(--fg)',borderColor:'var(--line)'},
 '.cm-searchMatch':{backgroundColor:'#e9bd4f40'},'.cm-searchMatch-selected':{backgroundColor:'#e9bd4f80'},
});
export interface TextEditor {setText:(text:string)=>Promise<void>;settled:()=>Promise<void>;text:()=>Promise<string>;snapshot:()=>EditorState;restore:(state:EditorState)=>void;length:()=>number;readOnly:(value:boolean)=>void;search:()=>void;wrap:(value:boolean)=>void;cancelLoad:()=>void;destroy:()=>void}
export function createTextEditor(host:HTMLElement,label:string,changed:(length:number,lines:number)=>void,failed:(error:unknown)=>void,loadingChanged:(value:boolean)=>void=()=>{}):TextEditor {
 const readonly=new Compartment(),wrapping=new Compartment();let revision=0,loading=false,locked=false,disposed=false,wrapped=false;
 const mount=document.createElement('div');mount.className='text-editor-mount';const status=document.createElement('div');status.className='text-editor-loading';status.setAttribute('role','status');status.hidden=true;status.textContent='正在加载文本…';host.replaceChildren(mount,status);
 const notify=()=>changed(view.state.doc.length+view.state.field(endingsField).extra,view.state.doc.length?view.state.doc.lines:0);
 const permissions=()=>[EditorState.readOnly.of(locked||loading),EditorView.editable.of(!(locked||loading))];
 const extensions:Extension[]=[endingsField,readonly.of(permissions()),wrapping.of([]),theme,lineNumbers(),highlightActiveLineGutter(),drawSelection(),placeholder(label==='原文'?'输入或粘贴文本':'选择处理操作'),history({minDepth:20}),
  EditorState.phrases.of({'Find':'查找','Replace':'替换','next':'下一个','previous':'上一个','all':'全部','match case':'区分大小写','regexp':'正则','by word':'整词','replace':'替换','replace all':'全部替换','close':'关闭','No matches':'没有匹配项'}),
  invertedEffects.of(tr=>tr.docChanged?[restoreEndings.of(tr.startState.field(endingsField))]:[]),search({top:true}),keymap.of([...defaultKeymap,...historyKeymap,...searchKeymap]),
  EditorView.contentAttributes.of({'aria-label':label,'aria-multiline':'true',role:'textbox'}),
  EditorState.changeFilter.of(tr=>{const saved=tr.effects.find(e=>e.is(restoreEndings)),endings=saved?.value as LineEndings|undefined??editEndings(tr.startState.field(endingsField),tr.startState.doc,tr.changes);if(tr.newDoc.length+endings.extra<=10_000_000)return true;failed(new Error('编辑上限为 1,000 万字符，可改用分文件批处理'));return false;}),
  EditorView.updateListener.of(update=>{if(update.docChanged)notify();}),
  EditorView.domEventHandlers({paste:(event)=>{
   const value=event.clipboardData?.getData('text/plain');if(!value||locked||loading)return false;
   event.preventDefault();void paste(value).catch(failed);return true;
  }}),
 ];
 const view=new EditorView({parent:mount,state:EditorState.create({extensions})});
 const refreshReadonly=()=>{view.dispatch({effects:[readonly.reconfigure(permissions()),wrapping.reconfigure(wrapped?EditorView.lineWrapping:[])]});host.setAttribute('aria-busy',String(loading));status.hidden=!loading;};
 const setLoading=(value:boolean)=>{if(value===loading)return;loading=value;refreshReadonly();loadingChanged(value);};
 async function paste(text:string){
  const focused=view.hasFocus,selection=view.state.selection.main;if(view.state.doc.length-(selection.to-selection.from)+text.length>10_000_000)throw new Error('编辑上限为 1,000 万字符，可改用分文件批处理');
  const current=++revision;setLoading(true);
  try{const parsed=await parseText(text,()=>disposed||current!==revision);if(!parsed)return;const changes=view.state.changes({from:selection.from,to:selection.to,insert:parsed.doc}),endings=editEndings(view.state.field(endingsField),view.state.doc,changes,parsed.endings);view.dispatch({changes,effects:restoreEndings.of(endings),selection:{anchor:selection.from+parsed.doc.length},userEvent:'input.paste',scrollIntoView:true});}
  finally{if(!disposed&&current===revision){setLoading(false);if(focused&&host.getClientRects().length&&(document.activeElement===document.body||view.dom.contains(document.activeElement)))view.focus();}}
 }
 // A value facade supports form integrations without keeping a second full text buffer in the DOM.
 Object.defineProperty(host,'value',{configurable:true,get:()=>serializeText(view.state.doc,view.state.field(endingsField))});
 notify();return {
  async setText(text){if(text.length>10_000_000)throw new Error('编辑上限为 1,000 万字符');const current=++revision;setLoading(true);try{const parsed=await parseText(text,()=>disposed||current!==revision);if(!parsed)return;view.setState(EditorState.create({doc:parsed.doc,extensions:[...extensions,endingsField.init(()=>parsed.endings)]}));notify();}finally{if(!disposed&&current===revision){setLoading(false);refreshReadonly();}}},
  async settled(){while(loading&&!disposed)await yieldText();},async text(){while(loading&&!disposed)await yieldText();return serializeTextAsync(view.state.doc,view.state.field(endingsField));},snapshot:()=>view.state,
  restore(state){revision++;setLoading(false);view.setState(state);refreshReadonly();notify();},length:()=>view.state.doc.length+view.state.field(endingsField).extra,
  readOnly(value){locked=value;refreshReadonly();},search:()=>{openSearchPanel(view);view.dom.querySelector<HTMLInputElement>('.cm-search input[name=search]')?.focus();},wrap(value){wrapped=value;view.dispatch({effects:wrapping.reconfigure(value?EditorView.lineWrapping:[])});},
  cancelLoad(){revision++;setLoading(false);refreshReadonly();},destroy(){disposed=true;revision++;setLoading(false);view.destroy();delete (host as any).value;host.replaceChildren();},
 };
}
