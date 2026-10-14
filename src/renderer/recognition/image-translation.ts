import {dialogMarkup,openDialog,closeDialog} from '../dialog';
import {editImageTranslation,imageTextLayout,type ImageTranslationDocument,type ImageTranslationBlock} from '../../shared/recognition/image-translation';
import {repairTranslationBackground} from '../../shared/recognition/image-translation-background';
import type {OCRAPI,OCRState} from '../../shared/recognition/ocr';
import type {TranslationResult} from '../../shared/recognition/translation';
import type {TextDocument} from '../../shared/recognition/text-document';
import './image-translation.css';
import {icon,registerIcons} from '../ui';
import {Image as ImageIcon,Languages,ScanEye,Undo2,Copy,Download} from 'lucide';

export function mountImageTranslation(api:OCRAPI,options:{state():OCRState|undefined;document():TextDocument|undefined;layer():HTMLElement;translate():Promise<TranslationResult|undefined>;available():boolean;valid(id?:string):boolean;changed():void;message(value:unknown):void}){
  const toolbar=document.createElement('div');toolbar.className='ocr-tool-group image-translation-tools';
  const button=(id:string,label:string,action:()=>void)=>{const node=document.createElement('button');node.id=id;node.type='button';node.className='quiet';node.textContent=label;node.onclick=action;toolbar.append(node);return node;};
  let preparing=false,show=false,comparing=false,serial=0,disposed=false,documentValue:ImageTranslationDocument|undefined,pixels:ImageData|undefined,sourceToken='';
  const versions:ImageTranslationDocument[]=[],overflow=new Set<string>(),plates=new Set<string>();
  const overlay=document.createElement('div');overlay.className='image-translation-layer';overlay.hidden=true;options.layer().append(overlay);
  let canvas=document.createElement('canvas');canvas.id='image-translation-canvas';overlay.append(canvas);
  const hits=document.createElement('div');hits.className='image-translation-hits';overlay.append(hits);
  const create=button('image-translate','图片翻译',()=>void prepare());
  const toggle=button('image-translation-toggle','查看原图',()=>{show=!show;render();options.changed();});
  const compare=button('image-translation-compare','按住对照',()=>{});
  compare.onpointerdown=event=>{if(!show)return;compare.setPointerCapture(event.pointerId);comparing=true;render();};
  const stopCompare=()=>{comparing=false;render();};compare.onpointerup=stopCompare;compare.onpointercancel=stopCompare;compare.onlostpointercapture=stopCompare;
  compare.onkeydown=event=>{if(event.code==='Space'||event.code==='Enter'){event.preventDefault();comparing=true;render();}};
  compare.onkeyup=stopCompare;compare.onblur=stopCompare;
  const undo=button('image-translation-undo','撤销修改',()=>{const previous=versions.pop();if(previous)void repaint(previous);});
  const copy=button('image-translation-copy','复制译图',()=>void output('copy'));
  const save=button('image-translation-save','保存译图',()=>void output('export'));
  registerIcons({'translation-original':ImageIcon,'translation-image':Languages,'translation-compare':ScanEye,'translation-undo':Undo2,'translation-copy':Copy,'translation-save':Download});
  for(const [node,name] of [[toggle,'original'],[compare,'compare'],[undo,'undo'],[copy,'copy'],[save,'save']] as const){node.title=node.ariaLabel=node.textContent||'';node.classList.add('icon-button');node.innerHTML=icon('lucide:translation-'+name);}
  document.querySelector('.ocr-commandbar')!.insertBefore(toolbar,document.getElementById('result-panel-toggle'));
  const template=document.createElement('template');template.innerHTML=dialogMarkup({id:'image-translation-edit',title:'编辑译文',className:'one-form-dialog image-translation-edit',body:'<form id="image-translation-edit-form"><label class="field">译文<textarea id="image-translation-edit-text" maxlength="60000" rows="6"></textarea></label><div class="image-translation-size"><label class="field">区域宽度<input id="image-translation-edit-width" type="number" min="1" step="1" required></label><label class="field">区域高度<input id="image-translation-edit-height" type="number" min="1" step="1" required></label></div><p id="image-translation-edit-error" class="dialog-error" role="status"></p></form>',actions:'<button type="submit" form="image-translation-edit-form" class="primary">应用</button>'});
  const dialog=template.content.firstElementChild as HTMLDialogElement;document.body.append(dialog);
  const field=<T extends HTMLElement>(id:string)=>dialog.querySelector<T>('#image-translation-edit-'+id)!;
  let editing='';
  function edit(block:ImageTranslationBlock){
    if(preparing||block.status==='unsupported')return;editing=block.id;
    field<HTMLTextAreaElement>('text').value=block.text;field<HTMLInputElement>('width').value=String(block.rect.width);field<HTMLInputElement>('height').value=String(block.rect.height);field('error').textContent=overflow.has(block.id)?'译文超出区域，请调整文字或扩大区域。':'';openDialog(dialog);
  }
  field<HTMLFormElement>('form').onsubmit=event=>{event.preventDefault();if(!documentValue||preparing)return;
    try{const next=editImageTranslation(documentValue,editing,field<HTMLTextAreaElement>('text').value,Number(field<HTMLInputElement>('width').value),Number(field<HTMLInputElement>('height').value));void closeDialog(dialog).then(()=>repaint(next,true)).catch(options.message);}catch(error){field('error').textContent=error instanceof Error?error.message:String(error);}
  };
  async function paint(value:ImageTranslationDocument,source:ImageData,ticket:number){
    const next=document.createElement('canvas');next.width=value.width;next.height=value.height;const context=next.getContext('2d')!;
    const output=new ImageData(new Uint8ClampedArray(source.data),source.width,source.height),backgrounds=new Map<string,ReturnType<typeof repairTranslationBackground>>();
    const overflowIds=new Set<string>(),plateIds=new Set<string>();
    try{
      for(let index=0;index<value.blocks.length;index++){
        const block=value.blocks[index];if(block.status==='ready'){const background=repairTranslationBackground(source,output,block);backgrounds.set(block.id,background);if(background.kind==='plate')plateIds.add(block.id);}
        if(index%8===0){await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));if(ticket!==serial||disposed)throw Error('图片翻译已取消');}
      }
      context.putImageData(output,0,0);
      for(const block of value.blocks){
        const background=backgrounds.get(block.id);if(!background)continue;
        const layout=imageTextLayout(block,(text,size)=>{context.font=`${size}px system-ui`;return context.measureText(text).width;});
        if(layout.overflow)overflowIds.add(block.id);
        const {x,y,width,height}=block.rect;context.save();context.beginPath();context.rect(x,y,width,height);context.clip();
        if(background.kind==='plate'){context.fillStyle=background.color;context.fillRect(x,y,width,height);}
        context.font=`${layout.fontSize}px system-ui`;context.fillStyle=background.textColor;context.textBaseline='top';context.direction=value.target==='ar'?'rtl':'ltr';context.textAlign=value.target==='ar'?'right':'left';
        layout.lines.forEach((line,index)=>context.fillText(line,value.target==='ar'?x+width-2:x+2,y+2+index*layout.lineHeight));context.restore();
      }
      if(ticket!==serial||disposed)throw Error('图片翻译已取消');
      canvas.replaceWith(next);canvas.width=canvas.height=0;canvas=next;canvas.id='image-translation-canvas';
      overflow.clear();for(const id of overflowIds)overflow.add(id);plates.clear();for(const id of plateIds)plates.add(id);
      hits.replaceChildren();
      for(const block of value.blocks){if(block.status==='unsupported')continue;const node=document.createElement('button');node.type='button';node.dataset.imageTranslationBlock=block.id;node.ariaLabel=(overflow.has(block.id)?'译文溢出：':'编辑译文：')+block.text.slice(0,120);node.title=block.reason|| (overflow.has(block.id)?'译文溢出，点击调整':plates.has(block.id)?'使用可读底板，点击编辑':'点击编辑译文');Object.assign(node.style,{left:block.rect.x+'px',top:block.rect.y+'px',width:block.rect.width+'px',height:block.rect.height+'px'});node.onpointerdown=event=>event.stopPropagation();node.onclick=()=>edit(block);hits.append(node);}
    }catch(error){next.width=next.height=0;throw error;}
  }
  async function repaint(value:ImageTranslationDocument,keepVersion=false){
    if(preparing||!pixels)return;const ticket=++serial;preparing=true;render();options.changed();
    try{await paint(value,pixels,ticket);if(keepVersion&&documentValue){versions.push(documentValue);if(versions.length>20)versions.shift();}documentValue=value;show=true;warnings();}
    catch(error){if(ticket===serial)options.message(error);}finally{if(ticket===serial){preparing=false;render();options.changed();}}
  }
  function warnings(){const skipped=documentValue?.blocks.filter(block=>block.status!=='ready').length||0;const messages=[overflow.size?`${overflow.size} 段译文超出区域，点击译文调整`:'',plates.size?`${plates.size} 段使用可读底板`:'',skipped?`${skipped} 段保留原图`:''].filter(Boolean);if(messages.length)options.message(messages.join('；'));}
  async function prepare(){
    if(preparing||!options.document()||!options.state())return;const ticket=++serial,token=options.state()!.token;preparing=true;render();options.changed();
    try{
      const result=await options.translate();if(ticket!==serial||token!==options.state()?.token)return;if(!result?.id)throw Error('没有可用的图片译文，请重新翻译');
      const value=await api.imageTranslation(token,result.id,result.revision);if(ticket!==serial)return;
      const source=new Image();source.crossOrigin='anonymous';source.decoding='async';source.src=options.state()!.image;await source.decode();
      if(ticket!==serial||token!==options.state()?.token)throw Error('识别图片已改变');
      if(source.naturalWidth!==value.width||source.naturalHeight!==value.height)throw Error('原图尺寸已改变');
      const base=document.createElement('canvas');base.width=value.width;base.height=value.height;
      try{const context=base.getContext('2d',{willReadFrequently:true})!;context.drawImage(source,0,0);const frozen=context.getImageData(0,0,value.width,value.height);await paint(value,frozen,ticket);pixels=frozen;documentValue=value;sourceToken=token;versions.length=0;show=true;warnings();}finally{base.width=base.height=0;source.src='';}
    }catch(error){if(ticket===serial)options.message(error);}finally{if(ticket===serial){preparing=false;render();options.changed();}}
  }
  async function output(mode:'copy'|'export'){
    if(preparing||!documentValue||!live())return;
    if(overflow.size||documentValue.blocks.some(block=>block.status!=='ready')){options.message('仍有溢出或未翻译段落，请先调整或重试');return;}
    const ticket=++serial;preparing=true;render();options.changed();
    try{const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('无法生成译图');const buffer=await blob.arrayBuffer();if(buffer.byteLength>64*1024*1024)throw Error('译图文件过大');const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('无法生成译图'));reader.readAsDataURL(new Blob([buffer]));});if(ticket!==serial||!live())return;const message=await api.outputImageTranslation(sourceToken,documentValue.id,mode,data);if(message)options.message(mode==='copy'?message:'已保存译图');}
    catch(error){if(ticket===serial)options.message(error);}finally{if(ticket===serial){preparing=false;render();options.changed();}}
  }
  function live(){return !!documentValue&&sourceToken===options.state()?.token&&documentValue.sourceId===options.document()?.id&&documentValue.recognitionRevision===(options.document()?.revision||0)&&options.valid(documentValue.translationId);}
  function render(){
    if(!preparing&&documentValue&&(sourceToken!==options.state()?.token||documentValue.sourceId!==options.document()?.id)){documentValue=undefined;pixels=undefined;versions.length=0;canvas.width=canvas.height=0;hits.replaceChildren();}
    const ready=live();if(!ready)show=false;overlay.hidden=!ready||!show||comparing||preparing;
    create.disabled=preparing||!!options.state()?.running||!!options.state()?.translating||!options.document()||!options.available();create.textContent=ready?'重新翻译图片':'图片翻译';
    for(const node of [toggle,compare,undo,copy,save]){node.hidden=!ready;node.disabled=preparing;}undo.disabled=preparing||!versions.length;toggle.title=toggle.ariaLabel=show?'查看原图':'查看译图';toggle.innerHTML=icon(show?'lucide:translation-original':'lucide:translation-image');toggle.ariaPressed=String(show);
    copy.disabled=save.disabled=preparing||!ready||!!overflow.size||!!documentValue?.blocks.some(block=>block.status!=='ready');
  }
  render();return {render,busy:()=>preparing,visible:()=>live()&&show&&!comparing,cancel:()=>{serial++;preparing=false;comparing=false;render();options.changed();void api.cancelTranslation().catch(options.message);},dispose:()=>{disposed=true;serial++;pixels=undefined;versions.length=0;canvas.width=canvas.height=0;overlay.remove();toolbar.remove();dialog.remove();}};
}
