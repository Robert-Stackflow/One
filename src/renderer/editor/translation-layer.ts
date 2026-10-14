import {dialogMarkup,openDialog,closeDialog} from '../dialog';
import {customControls,updateSelectOptions} from '../controls';
import {icon,registerIcons} from '../ui';
import {Image as ImageIcon,Languages} from 'lucide';
import {mappedPoint,annotationBounds,type ImageDocument} from '../../shared/capture/image-document';
import {textBounds} from '../../shared/recognition/text-document';
import {editImageTranslation,type ImageTranslationBlock} from '../../shared/recognition/image-translation';
import {renderImageTranslation} from '../recognition/image-translation-render';
import '../recognition/image-translation.css';

export function mountEditorTranslation(options:{source:HTMLImageElement;document():ImageDocument|undefined;locked():boolean;interactive():boolean;commit(value:ImageDocument):void;draw():void;message(value:unknown):void}){
  const toolbar=document.createElement('div');toolbar.className='editor-tool-group';toolbar.id='editor-translation-tools';toolbar.hidden=true;
  registerIcons({'editor-translation-original':ImageIcon,'editor-translation-edit':Languages});
  const button=(id:string,label:string,name:string,action:()=>void)=>{const node=document.createElement('button');node.id=id;node.type='button';node.className='quiet icon-button';node.title=node.ariaLabel=label;node.innerHTML=icon(name);node.onclick=action;toolbar.append(node);return node;};
  const toggle=button('editor-translation-toggle','查看原图','lucide:editor-translation-original',()=>{const value=options.document();if(value?.translation&&!options.locked())options.commit({...value,translation:{...value.translation,visible:!value.translation.visible}});});
  const edit=button('editor-translation-edit','编辑译文','lucide:editor-translation-edit',()=>{const block=visibleBlocks().find(block=>block.status!=='unsupported');if(block)editBlock(block);});
  document.querySelector('.editor-commandbar')!.append(toolbar);
  const hits=document.createElement('div');hits.id='editor-translation-hits';hits.className='image-translation-hits';document.getElementById('surface')!.append(hits);
  const template=document.createElement('template');template.innerHTML=dialogMarkup({id:'editor-translation-dialog',title:'编辑译文',className:'one-form-dialog image-translation-edit',body:'<form id="editor-translation-form"><label class="field">段落<select id="editor-translation-block"></select></label><label class="field">译文<textarea id="editor-translation-text" maxlength="60000" rows="6"></textarea></label><div class="image-translation-size"><label class="field">区域宽度<input id="editor-translation-width" type="number" min="1" step="1" required></label><label class="field">区域高度<input id="editor-translation-height" type="number" min="1" step="1" required></label></div><p id="editor-translation-error" class="dialog-error" role="status"></p></form>',actions:'<button type="submit" form="editor-translation-form" class="primary">应用</button>'});
  const dialog=template.content.firstElementChild as HTMLDialogElement;document.body.append(dialog);dialog.onkeydown=event=>event.stopPropagation();
  const field=<T extends HTMLElement>(id:string)=>dialog.querySelector<T>('#editor-translation-'+id)!;
  let pixels:ImageData|undefined,disposed=false,serial=0,pending=false,currentKey='',editing='',pendingKey='',painting:Promise<void>|undefined,hitSignature='';
  const cache=new Map<string,Awaited<ReturnType<typeof renderImageTranslation>>>();
  const key=(value:ImageDocument)=>{const layer=value.translation?.document;return layer?layer.id+':'+layer.version+':'+JSON.stringify(layer.blocks.map(({id,text,rect,status,fontSize})=>({id,text,rect,status,fontSize}))):'';};
  function current(){return cache.get(currentKey);}
  function visibleBlocks(){const value=options.document();if(!value?.translation)return [];const area=value.selection||{x:0,y:0,width:value.width,height:value.height};return value.translation.document.blocks.filter(block=>{const r=transformed(block,value);return r.x<area.x+area.width&&r.x+r.width>area.x&&r.y<area.y+area.height&&r.y+r.height>area.y;});}
  function transformed(block:ImageTranslationBlock,value:ImageDocument){const {x,y,width,height}=block.rect;return textBounds([{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}].map(point=>mappedPoint(value.transform,point)) as Parameters<typeof textBounds>[0]);}
  function fields(){const value=options.document()?.translation?.document,block=value?.blocks.find(block=>block.id===editing);if(!block)return;field<HTMLTextAreaElement>('text').value=block.text;field<HTMLInputElement>('width').value=String(block.rect.width);field<HTMLInputElement>('height').value=String(block.rect.height);field('error').textContent=current()?.overflow.has(block.id)?'译文超出区域，请调整文字或扩大区域。':block.reason||'';}
  function editBlock(block:ImageTranslationBlock){if(options.locked()||pending||block.status==='unsupported')return;editing=block.id;const blocks=options.document()!.translation!.document.blocks.filter(block=>block.status!=='unsupported');updateSelectOptions(field('block'),blocks.map(block=>({value:block.id,label:block.source.replace(/\s+/g,' ').slice(0,80)})));field<HTMLInputElement>('block').value=editing;fields();openDialog(dialog);}
  field('block').onchange=()=>{editing=field<HTMLInputElement>('block').value;fields();};
  field<HTMLFormElement>('form').onsubmit=event=>{event.preventDefault();const value=options.document();if(!value?.translation||pending)return;try{const document=editImageTranslation(value.translation.document,editing,field<HTMLTextAreaElement>('text').value,Number(field<HTMLInputElement>('width').value),Number(field<HTMLInputElement>('height').value));void closeDialog(dialog).then(()=>options.commit({...value,translation:{...value.translation!,document}})).catch(options.message);}catch(error){field('error').textContent=error instanceof Error?error.message:String(error);}};
  customControls(dialog);
  function sync(value:ImageDocument){const nextKey=key(value);if(pending&&pendingKey===nextKey&&painting&&value.translation?.visible)return painting;pendingKey=nextKey;painting=syncLayer(value);return painting;}
  async function syncLayer(value:ImageDocument){
    const nextKey=key(value);currentKey=nextKey;
    if(!value.translation?.visible||cache.has(nextKey)){if(pending){serial++;pending=false;}render();return;}
    const ticket=++serial;pending=true;render();options.draw();
    try{
      if(!pixels){const base=document.createElement('canvas');base.width=value.original.width;base.height=value.original.height;try{const context=base.getContext('2d',{willReadFrequently:true})!;context.drawImage(options.source,0,0);pixels=context.getImageData(0,0,base.width,base.height);}finally{base.width=base.height=0;}}
      const result=await renderImageTranslation(value.translation.document,pixels,()=>!disposed&&ticket===serial);
      cache.set(nextKey,result);while(cache.size>2){const oldest=cache.keys().next().value!;const removed=cache.get(oldest)!;removed.canvas.width=removed.canvas.height=0;cache.delete(oldest);}
      if(result.overflow.size)options.message(`${result.overflow.size} 段译文超出区域，请编辑调整`);
    }catch(error){if(ticket===serial)throw error;}finally{if(ticket===serial){pending=false;render();options.draw();}}
  }
  function render(){
    const value=options.document(),layer=value?.translation;toolbar.hidden=!layer;hits.hidden=!layer?.visible||pending;
    toggle.disabled=edit.disabled=options.locked()||pending;toggle.title=toggle.ariaLabel=layer?.visible?'查看原图':'查看译图';toggle.ariaPressed=String(!!layer?.visible);edit.disabled||=!layer?.visible||!visibleBlocks().some(block=>block.status!=='unsupported');
    const signature=value&&layer?[key(value),value.width,value.height,value.transform.join(','),JSON.stringify(value.selection),layer.visible,pending,options.interactive(),options.locked(),JSON.stringify(value.annotations.map(mark=>annotationBounds(mark)))].join(';'):'';
    if(signature===hitSignature)return;hitSignature=signature;hits.replaceChildren();if(!value||!layer?.visible||pending||!options.interactive())return;
    for(const block of visibleBlocks()){
      if(block.status==='unsupported')continue;const rect=transformed(block,value);
      if(value.annotations.some(mark=>{const a=annotationBounds(mark);return rect.x<a.x+a.width&&rect.x+rect.width>a.x&&rect.y<a.y+a.height&&rect.y+rect.height>a.y;}))continue;
      const node=document.createElement('button');node.type='button';node.dataset.editorTranslationBlock=block.id;node.title=node.ariaLabel='编辑译文：'+block.text.slice(0,120);node.disabled=options.locked();Object.assign(node.style,{left:rect.x/value.width*100+'%',top:rect.y/value.height*100+'%',width:rect.width/value.width*100+'%',height:rect.height/value.height*100+'%'});node.onpointerdown=event=>event.stopPropagation();node.onclick=()=>editBlock(block);hits.append(node);
    }
  }
  return {sync,render,image:(value:ImageDocument|undefined)=>value?.translation?.visible?cache.get(key(value))?.canvas||options.source:options.source,busy:()=>pending||dialog.open,
    outputError:()=>{const value=options.document();if(!value?.translation?.visible)return '';if(pending||!current())return '译图尚未生成';const blocks=visibleBlocks();return blocks.some(block=>block.status!=='ready'||current()!.overflow.has(block.id))?'仍有溢出或未翻译段落，请先调整':'';},
    dispose:()=>{disposed=true;serial++;pixels=undefined;for(const value of cache.values())value.canvas.width=value.canvas.height=0;cache.clear();hits.remove();toolbar.remove();dialog.remove();}};
}
