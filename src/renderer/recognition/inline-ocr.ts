import type { InlineOCRAPI } from '../../shared/recognition/inline-ocr';
import type { OCRLanguage } from '../../shared/recognition/ocr';
import { translationLanguages, type TranslationLanguage,type TranslationResult,type TranslationConfig } from '../../shared/recognition/translation';
import { mountTextSelection } from './text-selection';
import { icon, registerIcons } from '../ui';
import { ArrowLeft } from 'lucide';
import { customControls } from '../controls';
import { mountImageWorkspace } from './workspace';
import './inline-ocr.css';
import { mountWordCorrection } from './word-correction';
import {mountServiceSettings} from './service-settings';
import {mountTranslationFailures} from './translation-failures';

/** The same image-space selection engine, mounted inside an existing image workspace. */
export function mountInlineOCR(host:HTMLElement, api:InlineOCRAPI, options:{
  source:string; snapshot:()=>Promise<string>; initial:{scale:number;center:{x:number;y:number}};
  back:string; message:(error:unknown)=>void; closed:()=>void;
}) {
  let disposed=false,id='',busy=false,ready=false,panelVisible=false;
  let correction:ReturnType<typeof mountWordCorrection>|undefined;
  let settings:ReturnType<typeof mountServiceSettings>|undefined;
  let translationResult:TranslationResult|undefined,translationOriginal='',serviceConfig:TranslationConfig|undefined;
  let selectedTranslation=false,fullTranslation:{result:TranslationResult|undefined;original:string;text:string}|undefined;
  const scroll={left:host.scrollLeft,top:host.scrollTop},overflow=host.style.overflow;
  host.classList.add('inline-ocr-host');host.scrollLeft=host.scrollTop=0;host.style.overflow='clip';
  const root=document.createElement('section');root.className='inline-ocr';root.setAttribute('aria-label','图片文字识别');
  root.innerHTML=`<header class="inline-ocr-header"><button type="button" class="quiet inline-ocr-back"></button><select class="inline-ocr-language" aria-label="识别语言"><option value="chi_sim+eng">中文与英文</option><option value="eng">英文</option></select><button type="button" class="primary inline-ocr-run">识别文字</button><div class="inline-ocr-image-tools"></div><button type="button" class="quiet icon-button inline-ocr-panel" aria-label="展开识别结果"></button></header><div class="inline-ocr-body"><div class="inline-ocr-image"><img alt="待识别图片" draggable="false"></div><div class="inline-ocr-divider" role="separator" tabindex="0" aria-label="识别结果栏宽度" aria-orientation="vertical"></div><aside class="inline-ocr-result" hidden><label>识别原文</label><textarea class="inline-ocr-original" aria-label="识别原文" placeholder="识别结果"></textarea><div class="inline-ocr-translation-tools"><label>译为</label><select aria-label="翻译目标语言"></select><button type="button" class="quiet inline-ocr-translate">翻译全文</button></div><textarea class="inline-ocr-translated" aria-label="译文" placeholder="译文"></textarea><footer><button type="button" class="quiet inline-ocr-copy">复制原文</button><button type="button" class="primary inline-ocr-copy-translation">复制译文</button></footer></aside><div class="inline-ocr-loading" role="status"><span class="inline-ocr-spinner" aria-hidden="true"></span><span class="inline-ocr-loading-label">准备图片</span><button type="button" class="quiet inline-ocr-cancel">取消</button></div></div>`;
  host.append(root);
  const serviceButton=document.createElement('button');serviceButton.type='button';serviceButton.className='quiet inline-ocr-service';serviceButton.textContent='服务';root.querySelector('.inline-ocr-translation-tools')!.append(serviceButton);
  const serviceDialog=document.createElement('dialog');serviceDialog.id='translation-settings';root.append(serviceDialog);
  serviceButton.onclick=()=>{void settings?.open();};
  const q=<T extends HTMLElement=HTMLElement>(selector:string)=>root.querySelector<T>(selector)!;
  const image=q<HTMLImageElement>('img'),original=q<HTMLTextAreaElement>('.inline-ocr-original'),translated=q<HTMLTextAreaElement>('.inline-ocr-translated');
  const target=q<HTMLSelectElement>('.inline-ocr-translation-tools select');
  const restore=document.createElement('button');restore.type='button';restore.className='quiet inline-ocr-restore-full';restore.textContent='返回全文译文';restore.hidden=true;q('.inline-ocr-translation-tools').append(restore);
  function restoreFull(){if(fullTranslation){translationResult=fullTranslation.result;translationOriginal=fullTranslation.original;translated.value=fullTranslation.text;fullTranslation=undefined;}selectedTranslation=false;renderFailures();}
  restore.onclick=restoreFull;
  const failures=mountTranslationFailures(translated,ids=>void translate(translationResult!.source,ids));
  const translationValid=()=>!!translationResult&&translationOriginal===original.value&&translationResult.target===target.value&&translationResult.revision===serviceConfig?.revision;
  const renderFailures=()=>{restore.hidden=!selectedTranslation||!fullTranslation;restore.disabled=busy||!!correction?.busy();failures.update(translationResult,busy||!!correction?.busy(),translationValid(),translated.value!==translationResult?.text);q<HTMLButtonElement>('.inline-ocr-copy-translation').disabled=busy||!translationValid()||!translated.value.trim();};
  for(const [value,label]of Object.entries(translationLanguages)){const option=document.createElement('option');option.value=value;option.textContent=label;target.append(option);}target.value='zh-Hans';
  customControls(root);
  const workspace=mountImageWorkspace(q('.inline-ocr-body'),q('.inline-ocr-divider'),q<HTMLButtonElement>('.inline-ocr-panel'),false);
  const selection=mountTextSelection(image,{copy:text=>api.copy(id,text),message:options.message,
    rerecognize:value=>void run(value),
    selectionChanged:()=>correction?.sync(),
    selected:(start,end)=>original.setSelectionRange(start,end),translate:text=>void translate(text,undefined,true)});
  const heading=document.createElement('div'),wordLabel=original.previousElementSibling!;wordLabel.replaceWith(heading);heading.append(wordLabel);
  correction=mountWordCorrection(original,heading,{word:()=>selection.wordSelection(),busy:()=>busy,message:options.message,
    apply:(word,text)=>api.correct(id,word.selection,text),
    applied:(result,word)=>{original.value=result.text;translated.value='';translationResult=undefined;fullTranslation=undefined;selectedTranslation=false;selection.setDocument(result.document);selection.selectWord(word.wordId,word.lineId);},
    stateChanged:()=>loading(busy,q('.inline-ocr-loading-label').textContent||''),
  });
  const tools=root.querySelector<HTMLElement>('.text-image-tools')!;q('.inline-ocr-image-tools').append(tools);
  tools.querySelector('.text-image-status')?.remove();
  registerIcons({'inline-ocr-back':ArrowLeft});
  q('.inline-ocr-back').innerHTML=icon('lucide:inline-ocr-back');const label=document.createElement('span');label.textContent=options.back;q('.inline-ocr-back').append(label);
  function panel(show:boolean){panelVisible=show;q('.inline-ocr-result').hidden=!show;workspace.show(show);}
  function loading(value:boolean,label:string){busy=value;const editing=!!correction?.busy();root.ariaBusy=String(value||editing);q('.inline-ocr-loading').hidden=!value;q('.inline-ocr-loading-label').textContent=label;q<HTMLButtonElement>('.inline-ocr-run').disabled=value||editing||!ready;q<HTMLSelectElement>('.inline-ocr-language').disabled=value||editing;q<HTMLButtonElement>('.inline-ocr-translation-tools [role=combobox]').disabled=value||editing;serviceButton.disabled=value||editing||!ready;original.readOnly=value||editing;translated.readOnly=value||editing;selection.setEnabled(!value&&!editing);renderFailures();}
  async function run(region?:import('../../shared/recognition/text-area').OCRLocalSelection){
    if(!ready||busy||disposed||correction?.busy())return;loading(true,'识别中');
    try{const language=q<HTMLSelectElement>('.inline-ocr-language').value as OCRLanguage;
      const result=await (region?api.region(id,language,region):api.run(id,language));if(disposed)return;
      original.value=result.text;translated.value='';translationResult=undefined;fullTranslation=undefined;selectedTranslation=false;selection.setDocument(result.document,!!result.document||!result.text.trim());if(!result.words.length)panel(true);
      q('.inline-ocr-run').title=result.inference?result.inference.model+' · '+result.inference.device:'';
    }catch(error){if(!disposed)options.message(error);}finally{if(!disposed)loading(false,'');}
  }
  async function translate(text:string,retry?:string[],selected=false){
    if(busy||correction?.busy()||!id||!text.trim())return;panel(true);loading(true,'翻译中');
    if(!retry){if(selected){if(!selectedTranslation)fullTranslation={result:translationResult,original:translationOriginal,text:translated.value};translationResult=undefined;translated.value='';}else restoreFull();selectedTranslation=selected;}
    const before=original.value,language=target.value as TranslationLanguage,job=translationResult?.id;
    try{const config=await api.translationConfig(id);if(!config.ready){loading(false,'');await settings?.open();return;}serviceConfig=config;
      if(retry&&(!translationValid()||translated.value!==translationResult?.text||!job))throw Error('原文、译文或服务已改变，请重新翻译');
      const result=await(retry?api.retryTranslation(id,job!,retry,selectedTranslation):api.translate(id,text,language,selectedTranslation));if(!disposed){translationResult=result;translationOriginal=before;translated.value=result.text;}}
    catch(error){const partial=await api.partialTranslation(id,selectedTranslation).catch(()=>undefined);if(!disposed){if(partial?.parts&&partial.source===text&&partial.target===language&&partial.revision===serviceConfig?.revision){translationResult=partial;translationOriginal=before;translated.value=partial.text;}else options.message(error);}}finally{if(!disposed)loading(false,'');}
  }
  function dispose(){
    if(disposed)return;disposed=true;workspace.dispose();correction?.dispose();selection.dispose();failures.dispose();root.remove();host.classList.remove('inline-ocr-host');host.style.overflow=overflow;
    host.scrollLeft=scroll.left;host.scrollTop=scroll.top;if(id)void api.release(id).catch(()=>{});options.closed();
  }
  q('.inline-ocr-back').onclick=dispose;q('.inline-ocr-panel').onclick=()=>panel(!panelVisible);
  q('.inline-ocr-run').onclick=()=>void run();q('.inline-ocr-translate').onclick=()=>void translate(original.value);
  q('.inline-ocr-copy').onclick=()=>void api.copy(id,original.value).then(()=>options.message('已复制原文')).catch(options.message);
  q('.inline-ocr-copy-translation').onclick=()=>void api.copy(id,translated.value).then(()=>options.message('已复制译文')).catch(options.message);
  q('.inline-ocr-cancel').onclick=()=>{if(id)void api.cancel(id).catch(options.message);else dispose();};
  original.oninput=()=>{restoreFull();selection.setDocument(undefined,false);renderFailures();};translated.oninput=renderFailures;target.onchange=renderFailures;
  panel(false);loading(true,'准备图片');
  void (async()=>{
    const png=await options.snapshot();if(disposed)return;
    const state=await api.prepare(options.source,png);id=state.id;if(disposed){await api.release(id);return;}
    settings=mountServiceSettings('translation',{services:()=>api.dedicatedServices(id),load:()=>api.translationConfig(id),save:value=>api.saveTranslation(id,value),clear:rev=>api.clearTranslation(id,rev),profiles:()=>api.taskProfiles(id),verify:async()=>{throw Error('文字翻译无需图片验证');},cancelCheck:async()=>{},migrate:rev=>api.migrateService(id,rev),restore:rev=>api.restoreService(id,rev),manage:()=>api.manageServices(id),available:()=>ready&&!busy&&!disposed&&!correction?.busy(),updated:value=>{if(serviceConfig&&serviceConfig.revision!==value.revision){translated.value='';translationResult=undefined;}serviceConfig=value;renderFailures();},error:options.message});
    const source=selection.setImagePreview(state,region=>api.preview(id,region));selection.setView(options.initial);
    image.src=await source;await image.decode();if(disposed)return;ready=true;loading(false,'');await run();
  })().catch(error=>{if(!disposed){options.message(error);dispose();}});
  return {dispose,reset(){selection.setView({...selection.viewState(),scale:1});},zoom(action:'fit'|'zoom-in'|'zoom-out'){root.querySelector<HTMLButtonElement>(`[data-text-action="${action}"]`)?.click();}};
}
