import {api,esc} from './ui';
import {fileIcon} from './file-icons';
import {VirtualRows} from './virtual-rows';
import {DirectoryPages} from './directory-pages';
import type {DirectoryInfo} from '../shared/directory';
import './directory-view.css';
export class DirectoryList {
 private pages:DirectoryPages;private rows:VirtualRows;private info:DirectoryInfo;private query='';private count=0;private selected=-1;private current='';private currentPosition=-1;private version=0;private disposed=false;
 get id(){return this.info.id;}
 constructor(private host:HTMLElement,info:DirectoryInfo,private choose:(path:string)=>void,private enter:(path:string)=>void,private error:(error:Error)=>void){
  this.info=info;this.count=info.count;host.replaceChildren();host.classList.add('directory-list');host.tabIndex=0;host.setAttribute('role','listbox');host.setAttribute('aria-label','文件列表');
  this.pages=new DirectoryPages(()=>this.rows.refresh(),error);this.pages.add(info);this.rows=new VirtualRows(host,()=>this.count,(position,previous)=>this.row(position,previous),36);host.addEventListener('keydown',this.key);
 }
 private row(position:number,previous?:HTMLElement){const entry=this.pages.get(this.info,position,this.query),row=previous||document.createElement('button');row.className='file-list-row';row.dataset.position=String(position);row.setAttribute('role','option');row.setAttribute('aria-posinset',String(position+1));row.setAttribute('aria-setsize',String(this.count));row.tabIndex=-1;
  if(entry){if(row.dataset.path!==entry.path){row.innerHTML=fileIcon(entry.name,entry.directory)+'<span>'+esc(entry.name)+'</span>';row.dataset.path=entry.path;row.title=entry.name;}row.classList.toggle('selected',position===this.selected);row.setAttribute('aria-selected',String(position===this.selected));row.setAttribute('aria-current',String(entry.path===this.current));row.onclick=()=>{this.selected=position;this.rows.refresh();this.choose(entry.path);};row.ondblclick=entry.directory?event=>{event.preventDefault();this.enter(entry.path);}:null;}else {row.innerHTML='<span class="directory-skeleton"></span>';delete row.dataset.path;row.removeAttribute('aria-current');row.onclick=null;row.ondblclick=null;}return row;
 }
 setCurrent(path:string,position=-1){this.current=path;this.currentPosition=position;if(!this.query&&position>=0){this.selected=position;this.rows.reveal(position);}this.rows.refresh();}
 async filter(query:string){const version=++this.version;this.query=query;this.host.setAttribute('aria-busy','true');const page=await this.pages.read(this.info,0,query);if(this.disposed||version!==this.version)return;this.count=page.total;this.selected=page.total?(!query&&this.currentPosition>=0?Math.min(page.total-1,this.currentPosition):0):-1;this.host.scrollTop=0;this.host.setAttribute('aria-busy','false');this.host.querySelector('.preview-panel-empty')?.remove();if(!page.total){const note=document.createElement('div');note.className='preview-panel-empty';note.textContent=query?'无匹配文件':'空文件夹';this.host.append(note);}this.rows.reveal(Math.max(0,this.selected));this.rows.refresh();}
 private key=(event:KeyboardEvent)=>{if(event.ctrlKey||event.metaKey||event.altKey)return;if(!['ArrowDown','ArrowUp','Home','End','Enter'].includes(event.key))return;event.preventDefault();event.stopPropagation();if(!this.count)return;
  if(event.key==='Enter'){const position=Math.max(0,this.selected),query=this.query;void this.pages.read(this.info,Math.floor(position/128)*128,query).then(page=>{if(!this.disposed&&query===this.query){const entry=page.entries[position-page.offset];if(entry){this.choose(entry.path);if(entry.directory)this.enter(entry.path);}}}).catch(()=>{});return;}
  this.selected=event.key==='Home'?0:event.key==='End'?this.count-1:Math.max(0,Math.min(this.count-1,this.selected+(event.key==='ArrowDown'?1:-1)));this.rows.reveal(this.selected);this.rows.refresh();
 };
 dispose(){this.disposed=true;this.version++;this.host.removeEventListener('keydown',this.key);this.rows.dispose();this.pages.dispose();void api.directoryRelease(this.info.id).catch(()=>{});this.host.classList.remove('directory-list');}
}
