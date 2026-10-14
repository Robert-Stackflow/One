import type {TranslationResult} from '../../shared/recognition/translation';
import './translation-failures.css';
/** Only failures need extra UI. Successful output stays in One's existing editable result. */
export function mountTranslationFailures(after:HTMLElement,retry:(ids:string[])=>void){
  const root=document.createElement('section');root.className='translation-failures';root.hidden=true;root.setAttribute('aria-label','未完成的翻译段落');after.insertAdjacentElement('afterend',root);
  let job='',shown=24;
  function update(result:TranslationResult|undefined,busy:boolean,valid:boolean,edited=false){
    const parts=result?.parts?.filter(part=>part.status!=='translated')||[];root.hidden=!parts.length||!valid;if(root.hidden){root.replaceChildren();return;}
    if(job!==result!.id){job=result!.id||'';shown=24;}root.replaceChildren();
    const header=document.createElement('header'),count=document.createElement('span'),all=document.createElement('button');count.textContent=parts.length+' 段未完成';all.type='button';all.className='quiet';all.textContent='重试全部';all.disabled=busy||edited;all.title=edited?'译文已修改，请重新翻译':'';all.onclick=()=>retry(parts.map(part=>part.id));header.append(count,all);root.append(header);
    const list=document.createElement('ul');
    for(const part of parts.slice(0,shown)){
      const item=document.createElement('li'),copy=document.createElement('div'),source=document.createElement('span'),error=document.createElement('small'),button=document.createElement('button');item.dataset.translationPart=part.id;
      const text=result!.source.slice(part.start,part.end);source.textContent='第 '+part.paragraph+' 段'+(part.chunk>1?' · 片段 '+part.chunk:'')+'：'+text.slice(0,90)+(text.length>90?'…':'');error.textContent=part.error||'尚未发送';copy.append(source,error);
      button.type='button';button.className='quiet';button.textContent='重试';button.disabled=busy||edited;button.title=all.title;button.onclick=()=>retry([part.id]);item.append(copy,button);list.append(item);
    }
    root.append(list);if(parts.length>shown){const more=document.createElement('button');more.type='button';more.className='quiet';more.textContent='显示更多';more.onclick=()=>{shown+=24;update(result,busy,valid,edited);};root.append(more);}
  }
  return {update,dispose:()=>root.remove()};
}
