import DOMPurify from 'dompurify';
import {marked} from 'marked';
import {isolatedFrame} from './office-view';
import {api,esc,icon,iconButton,toast} from './ui';
import {renderCode} from './code-view';
import {renderStructured} from './structured-view';
import {renderTable} from './table-view';
import {fileIcon} from './file-icons';
import type {SetOutline} from './preview-outline';
import {decodePreviewText} from '../shared/preview';
export async function previewText(url:string){const response=await fetch(url);if(!response.ok)throw new Error('无法读取文件');const bytes=await response.arrayBuffer();return decodePreviewText(new Uint8Array(bytes));}
import type {PreviewData,FileEntry} from '../shared/types';
export function plainText(host:HTMLElement,text:string,wrap=true){return renderCode(host,{name:'text.txt',path:'',size:text.length,type:'text',text,siblings:[]},wrap);}
export async function renderDocument(host:HTMLElement,data:PreviewData,source=false,wrap=true,outline:SetOutline=()=>{},metadata:(v:Record<string,string>)=>void=()=>{},format=false){
  if(source||data.type==='text')return renderCode(host,data,wrap,metadata,format);
  if(data.type==='json'||data.type==='yaml'||data.type==='csv'){
    if(data.textURL&&data.size>5*1024*1024)throw new Error('结构化视图上限为 5 MB，请使用源码视图');
    return data.type==='csv'?renderTable(host,data,metadata):renderStructured(host,data,metadata);
  }
  if(data.textURL){if(data.size>5*1024*1024)throw new Error('渲染视图上限为 5 MB，请使用源码视图');data={...data,text:await previewText(data.textURL)};}
  if(data.type==='markdown'||data.type==='html'){
    const html=data.type==='markdown'?await marked.parse(data.text||'',{gfm:true}):data.text||'';
    const safe=DOMPurify.sanitize(html,{WHOLE_DOCUMENT:true,FORBID_TAGS:['script','iframe','object','embed','form','input','button','textarea','select','base','meta'],FORBID_ATTR:['srcset','action','formaction'],ADD_TAGS:['style','link']});
    const doc=new DOMParser().parseFromString(safe,'text/html');doc.querySelectorAll('a').forEach(a=>a.removeAttribute('href'));
    for(const img of Array.from(doc.querySelectorAll('img')).slice(0,100)){const src=img.getAttribute('src')||'';if(!/^data:image\//i.test(src)){const local=await api.previewResource(src);if(local)img.src=local;else img.removeAttribute('src');}}
    for(const link of Array.from(doc.querySelectorAll('link'))){if(link.rel!=='stylesheet'){link.remove();continue;}const local=await api.previewResource(link.getAttribute('href')||'');if(local)link.href=local;else link.remove();}
    const style=getComputedStyle(document.documentElement);const css=data.type==='markdown'?`body{max-width:900px;margin:auto;background:${style.getPropertyValue('--surface')};color:${style.getPropertyValue('--fg')};padding:30px 36px;font-size:14px;line-height:1.8}body> :first-child{margin-top:0}h1,h2,h3{line-height:1.35}h1{font-size:26px}h2{font-size:20px}pre{padding:16px;border-radius:8px;background:${style.getPropertyValue('--soft')};overflow-x:auto}code{font-family:Consolas,monospace;font-size:.92em}p,li,td{overflow-wrap:anywhere}table{width:100%;display:table;font-size:13px}th,td{padding:9px 13px;text-align:left;border:1px solid ${style.getPropertyValue('--line')}}blockquote{border-left:3px solid ${style.getPropertyValue('--line')};padding-left:16px;margin-left:0;color:${style.getPropertyValue('--muted')}}hr{border:0;border-top:1px solid ${style.getPropertyValue('--line')}}img{display:block;max-width:100%}`:'body{padding:20px}';
    const headings=Array.from(doc.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')).slice(0,1000);headings.forEach((h,i)=>h.id='one-heading-'+i);
    const frame=isolatedFrame(host,doc.head.innerHTML+doc.body.innerHTML,css);
    outline(headings.map((h,i)=>({label:h.textContent||'标题',depth:Number(h.tagName[1])-1,activate:()=>frame.contentDocument?.getElementById('one-heading-'+i)?.scrollIntoView({behavior:'smooth',block:'start'})})));
    return()=>frame.remove();
  }
}
export function archiveTree(entries:FileEntry[]){
  interface Node{entry:FileEntry;children:Map<string,Node>};const root:Node={entry:{name:'',path:'',directory:true},children:new Map()};
  for(const entry of entries){const parts=entry.path.replace(/\\/g,'/').split('/').filter(Boolean);if(parts.length>50)continue;let node=root,path='';for(let i=0;i<parts.length;i++){const name=parts[i];path+=name+'/';let child=node.children.get(name);if(!child){child={entry:i===parts.length-1?entry:{name,path,directory:true},children:new Map()};node.children.set(name,child);}node=child;}}
  const list=document.createElement('div');list.className='file-tree';
  const render=(nodes:Map<string,Node>,host:HTMLElement)=>{for(const node of [...nodes.values()].sort((a,b)=>Number(b.entry.directory)-Number(a.entry.directory)||a.entry.name.localeCompare(b.entry.name,undefined,{numeric:true}))){const branch=document.createElement('div'),button=document.createElement('button');button.className='file-tree-row';button.innerHTML=`${node.entry.directory?icon('chevron'):'<span class="tree-spacer"></span>'}${fileIcon(node.entry.name,node.entry.directory)}<span>${esc(node.entry.name)}</span>${node.entry.directory?'':`<small>${((node.entry.size||0)/1024).toFixed(1)} KB</small>`}`;branch.append(button);host.append(branch);if(node.children.size){button.setAttribute('aria-expanded','false');const children=document.createElement('div');children.className='tree-children';children.hidden=true;branch.append(children);button.onclick=()=>{children.hidden=!children.hidden;button.setAttribute('aria-expanded',String(!children.hidden));button.querySelector('.file-type-icon')?.replaceWith(new DOMParser().parseFromString(fileIcon(node.entry.name,true,!children.hidden),'text/html').body.firstChild!);if(!children.childElementCount)render(node.children,children);};}}};render(root.children,list);return list;
}
