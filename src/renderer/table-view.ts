import {PreviewWorkerClient} from './preview-worker-client';
import {virtualRange} from './virtual-rows';
import {textValueDialog} from './text-value-dialog';
import {columnName} from '../shared/workbook';
import type {TableShape,TableRange,TableCell} from '../shared/csv-preview';
import type {PreviewData} from '../shared/types';
import {api,icon,iconButton,toast} from './ui';
import './table-view.css';

const rowHeight=34,columnWidth=160;
export function renderTable(host:HTMLElement,data:PreviewData,metadata:(values:Record<string,string>)=>void){
 const root=document.createElement('div');root.className='table-view';root.innerHTML='<div class="preview-loading">解析表格…</div>';host.append(root);
 const client=new PreviewWorkerClient(),cache=new Map<string,TableRange>(),pending=new Map<string,Promise<TableRange>>();
 let disposed=false,shape:TableShape,scroll:HTMLElement,space:HTMLElement,layer:HTMLElement,head:HTMLElement,body:HTMLElement,numbers:HTMLElement,address:HTMLInputElement,selected={row:1,column:0},frame=0,resize:ResizeObserver|undefined,dialogDispose:(()=>void)|undefined,version=0,queue=Promise.resolve(),revealOnPaint=false,gutter=52;
 const pageRows=32,pageColumns=16;
 function refresh(){if(disposed||frame)return;frame=requestAnimationFrame(()=>{frame=0;paint();});}
 function page(row:number,column:number){
  const startRow=Math.floor(row/pageRows)*pageRows,startColumn=Math.floor(column/pageColumns)*pageColumns,key=startRow+':'+startColumn,found=cache.get(key);
  if(found){cache.delete(key);cache.set(key,found);return Promise.resolve(found);}const active=pending.get(key);if(active)return active;
  const request=client.request<TableRange>({tableAction:'range',row:startRow,column:startColumn,rows:pageRows,columns:pageColumns}).then(result=>{if(!disposed){cache.set(key,result);while(cache.size>12)cache.delete(cache.keys().next().value!);refresh();}return result;}).finally(()=>pending.delete(key));pending.set(key,request);return request;
 }
 function cached(row:number,column:number):TableCell|undefined{
  const key=Math.floor(row/pageRows)*pageRows+':'+Math.floor(column/pageColumns)*pageColumns,result=cache.get(key);if(!result){void page(row,column).catch(error=>{if(!disposed)toast(error);});return;}
  cache.delete(key);cache.set(key,result);return result.cells[(row-result.row)*result.columns+column-result.column];
 }
 function reset(){version++;queue=Promise.resolve();}
 function ranges(){return{x:virtualRange(shape.columns,Math.max(1,scroll.clientWidth-gutter),columnWidth,scroll.scrollLeft,2),y:virtualRange(Math.max(0,shape.rows-1),Math.max(1,scroll.clientHeight-rowHeight),rowHeight,scroll.scrollTop,4)};}
 function choose(row:number,column:number,reveal=true){
  selected={row:Math.max(0,Math.min(shape.rows-1,row)),column:Math.max(0,Math.min(shape.columns-1,column))};address.value=columnName(selected.column)+(selected.row+1);scroll.setAttribute('aria-activedescendant','table-cell-'+selected.row+'-'+selected.column);
  if(reveal){revealOnPaint=true;revealSelection();}refresh();
 }
 function revealSelection(){const extent=ranges();space.style.width=extent.x.physical+gutter+'px';space.style.height=extent.y.physical+rowHeight+'px';const {x,y}=ranges(),width=scroll.clientWidth-gutter,height=scroll.clientHeight-rowHeight;let left=x.logical,top=y.logical;const col=selected.column*columnWidth,line=Math.max(0,selected.row-1)*rowHeight;
   if(col<left)left=col;else if(col+columnWidth>left+width)left=col+columnWidth-width;
   if(line<top)top=line;else if(line+rowHeight>top+height)top=line+rowHeight-height;
   scroll.scrollLeft=x.last?left*x.physicalLast/x.last:0;scroll.scrollTop=y.last?top*y.physicalLast/y.last:0;
 }
 async function fullValue(row=selected.row,column=selected.column){const text=await client.request<string>({tableAction:'cell',row,column});if(disposed)return;dialogDispose?.();dialogDispose=textValueDialog('table-value',columnName(column)+(row+1)+' · 完整值',text,()=>{dialogDispose=undefined;});}
 async function copy(row=selected.row,column=selected.column){const text=await client.request<string>({tableAction:'cell',row,column});if(!disposed){await api.copyText(text);toast('已复制单元格');}}
 function cell(row:number,column:number,header:boolean,previous?:HTMLElement){
  const value=cached(row,column),element=previous||document.createElement('div');element.className='table-cell'+(header?' table-header-cell':'');element.id='table-cell-'+row+'-'+column;element.dataset.cell=row+':'+column;element.setAttribute('role',header?'columnheader':'gridcell');element.setAttribute('aria-colindex',String(column+1));element.setAttribute('aria-selected',String(row===selected.row&&column===selected.column));element.classList.toggle('is-current',row===selected.row&&column===selected.column);
  if(!element.firstElementChild){const text=document.createElement('span');text.dataset.selectable='';element.append(text);}const label=element.firstElementChild as HTMLElement,text=value?value.text.replace(/\r\n|\r|\n/g,' ↵ ')+(value.truncated?'…':''):'';if(label.textContent!==text)label.textContent=text;
  element.setAttribute('aria-busy',String(!value));element.classList.toggle('is-pending',!value);element.title=value?(columnName(column)+(row+1)+(value.truncated?' · 双击查看完整值':'')):'';
  element.onclick=()=>{reset();choose(row,column,false);if(!window.getSelection()?.toString())scroll.focus({preventScroll:true});};element.ondblclick=()=>{reset();choose(row,column,false);void fullValue(row,column).catch(error=>{if(!disposed)toast(error);});};return element;
 }
 function updateCells(container:HTMLElement,row:number,start:number,end:number,header:boolean){
  const previous=new Map(Array.from(container.children).map(element=>[Number((element as HTMLElement).dataset.column),element as HTMLElement]));for(const [column,element]of previous)if(column<start||column>=end){element.remove();previous.delete(column);}
  let cursor=container.firstElementChild;for(let column=start;column<end;column++){const element=cell(row,column,header,previous.get(column));element.dataset.column=String(column);if(element!==cursor)container.insertBefore(element,cursor);cursor=element.nextElementSibling;}
 }
 function paint(){
  if(!shape||!scroll||!shape.rows||!shape.columns)return;if(revealOnPaint){revealOnPaint=false;revealSelection();}const {x,y}=ranges();space.style.width=x.physical+gutter+'px';space.style.height=y.physical+rowHeight+'px';layer.style.width=scroll.clientWidth+'px';layer.style.height=Math.min(scroll.clientHeight,y.physical+rowHeight)+'px';head.style.transform=`translate(${x.offset-scroll.scrollLeft+gutter}px,0)`;updateCells(head,0,x.start,x.end,true);
  const corner=space.querySelector<HTMLElement>('.table-corner')!;corner.style.transform='none';
  const previous=new Map(Array.from(body.children).map(element=>[Number((element as HTMLElement).dataset.row),element as HTMLElement])),labels=new Map(Array.from(numbers.children).map(element=>[Number((element as HTMLElement).dataset.row),element as HTMLElement]));
  for(const [row,element]of previous)if(row<y.start+1||row>=y.end+1){element.remove();previous.delete(row);labels.get(row)?.remove();labels.delete(row);}
  for(let row=y.start+1;row<=y.end;row++){
   let element=previous.get(row);if(!element){element=document.createElement('div');element.className='table-row';element.dataset.row=String(row);element.setAttribute('role','row');body.append(element);}element.setAttribute('aria-rowindex',String(row+1));element.style.transform=`translate(${x.offset-scroll.scrollLeft+gutter}px,${y.offset-scroll.scrollTop+(row-y.start)*rowHeight}px)`;updateCells(element,row,x.start,x.end,false);
   let label=labels.get(row);if(!label){label=document.createElement('div');label.className='table-row-number';label.dataset.row=String(row);label.textContent=String(row+1);numbers.append(label);}label.style.transform=`translate(0,${y.offset-scroll.scrollTop+(row-y.start)*rowHeight}px)`;
  }
 }
 function keyboard(event:KeyboardEvent){
  const modified=event.ctrlKey||event.metaKey,key=event.key,copyKey=modified&&key.toLowerCase()==='c'&&!window.getSelection()?.toString();
  if(modified&&key.toLowerCase()==='g'){event.preventDefault();event.stopPropagation();reset();address.focus();address.select();return;}
  if(modified&&key!=='Home'&&key!=='End'&&!copyKey)return;
  if(!copyKey&&!['ArrowDown','ArrowUp','ArrowRight','ArrowLeft','Home','End','PageDown','PageUp','Enter'].includes(key))return;
  event.preventDefault();event.stopPropagation();const request=version;queue=queue.then(async()=>{
   if(disposed||request!==version)return;if(copyKey)return copy();if(key==='Enter')return fullValue();const step=Math.max(1,Math.floor((scroll.clientHeight-rowHeight)/rowHeight)-1);
   if(key==='Home')choose(modified?0:selected.row,0);else if(key==='End')choose(modified?shape.rows-1:selected.row,shape.columns-1);
   else choose(selected.row+(key==='ArrowDown'?1:key==='ArrowUp'?-1:key==='PageDown'?step:key==='PageUp'?-step:0),selected.column+(key==='ArrowRight'?1:key==='ArrowLeft'?-1:0));
  }).catch(error=>{if(!disposed&&request===version)toast(error);});
 }
 void client.request<TableShape>({table:true,text:data.text,url:data.textURL,delimiter:data.name.toLowerCase().endsWith('.tsv')?'\t':','}).then(result=>{
  if(disposed)return;shape=result;gutter=Math.max(52,String(result.rows).length*7+20);root.style.setProperty('--table-gutter',gutter+'px');metadata({'数据行':String(Math.max(0,result.rows-1)),'列':String(result.columns)});
  if(!result.rows){root.innerHTML='<div class="table-empty">'+icon('list')+'<span>没有表格数据</span></div>';return;}
  root.innerHTML='<div class="table-toolbar"><span class="table-count"></span><div class="spacer"></div><input id="table-address" aria-label="定位单元格" title="输入单元格地址，例如 A1；Ctrl+G" spellcheck="false">'+iconButton('table-go','定位单元格','arrow')+iconButton('table-value-open','查看完整值','ellipsis')+iconButton('table-copy','复制单元格','copy')+'</div><div class="table-scroll" role="grid" tabindex="0" aria-label="表格内容"><div class="table-space"><div class="table-layer"><div class="table-corner" role="rowheader">1</div><div class="table-head" role="row" aria-rowindex="1"></div><div class="table-body"></div><div class="table-numbers"></div></div></div></div>';
  root.querySelector('.table-count')!.textContent=Math.max(0,shape.rows-1).toLocaleString()+' 行 · '+shape.columns.toLocaleString()+' 列';scroll=root.querySelector<HTMLElement>('.table-scroll')!;space=root.querySelector<HTMLElement>('.table-space')!;layer=root.querySelector<HTMLElement>('.table-layer')!;head=root.querySelector<HTMLElement>('.table-head')!;body=root.querySelector<HTMLElement>('.table-body')!;numbers=root.querySelector<HTMLElement>('.table-numbers')!;address=root.querySelector<HTMLInputElement>('#table-address')!;
  scroll.setAttribute('aria-rowcount',String(shape.rows));scroll.setAttribute('aria-colcount',String(shape.columns));scroll.onkeydown=keyboard;scroll.addEventListener('scroll',refresh,{passive:true});resize=new ResizeObserver(()=>{revealOnPaint=true;refresh();});resize.observe(scroll);
  const locate=()=>{const match=address.value.trim().match(/^([A-Za-z]+)([1-9]\d*)$/);if(!match){toast('请输入单元格地址，例如 A1');return;}let column=0;for(const c of match[1].toUpperCase())column=column*26+c.charCodeAt(0)-64;const row=Number(match[2])-1;if(!Number.isSafeInteger(row)||row>=shape.rows||column>shape.columns){toast('单元格超出表格范围');return;}reset();choose(row,column-1);scroll.focus({preventScroll:true});};
  address.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();locate();}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();address.value=columnName(selected.column)+(selected.row+1);scroll.focus({preventScroll:true});}};
  root.querySelector<HTMLButtonElement>('#table-go')!.onclick=locate;root.querySelector<HTMLButtonElement>('#table-copy')!.onclick=()=>{reset();void copy().catch(error=>{if(!disposed)toast(error);});};root.querySelector<HTMLButtonElement>('#table-value-open')!.onclick=()=>{reset();void fullValue().catch(error=>{if(!disposed)toast(error);});};choose(Math.min(1,shape.rows-1),0);
 }).catch(error=>{if(!disposed){client.close();root.replaceChildren();const message=document.createElement('p');message.className='render-error';message.textContent=error.message;root.append(message);}});
 return()=>{disposed=true;reset();client.close();cancelAnimationFrame(frame);resize?.disconnect();scroll?.removeEventListener('scroll',refresh);cache.clear();pending.clear();dialogDispose?.();root.remove();};
}
