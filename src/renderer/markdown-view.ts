import {Marked} from 'marked';
import markedKatex from 'marked-katex-extension';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';
import {parseDocument} from 'yaml';
import katexStylesheet from 'katex/dist/katex.min.css?url';
import {isolatedFrame} from './document-frame';
import {api,esc,icon,toast} from './ui';
import type {PreviewData} from '../shared/types';
import type {SetOutline} from './preview-outline';

const codeAliases:Record<string,string>={js:'javascript',ts:'typescript',py:'python',sh:'bash',shell:'bash',yml:'yaml',html:'xml',md:'markdown',csharp:'cs',cxx:'cpp'};
const textSizeLimit=300_000;

function frontmatter(text:string){
  const match=/^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]{0,65536}?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if(!match)return {body:text,html:''};
  let html='';
  try{
    const doc=parseDocument(match[1],{uniqueKeys:true});
    if(doc.errors.length)throw doc.errors[0];
    const values=doc.toJS({maxAliasCount:20});
    if(!values||typeof values!=='object'||Array.isArray(values))throw new Error('invalid frontmatter');
    const rows=Object.entries(values as Record<string,unknown>).slice(0,80).map(([key,value])=>{
      const shown=typeof value==='string'?value:JSON.stringify(value);
      return `<div><dt>${esc(key.slice(0,120))}</dt><dd>${esc((shown??'').slice(0,4000))}</dd></div>`;
    }).join('');
    html=frontmatterShell(`<dl>${rows}</dl>`);
  }catch{html=frontmatterShell(`<pre>${esc(match[1])}</pre>`);}
  return {body:text.slice(match[0].length),html};
}

function frontmatterShell(content:string){
  return `<section class="frontmatter" data-expanded="true"><button class="frontmatter-toggle" type="button" aria-expanded="true">${icon('chevron')}<span>文档属性</span></button><div class="frontmatter-body"><div class="frontmatter-inner">${content}</div></div></section>`;
}

function markdownExtraStyles(){
  return `.code-block code{padding:0;border:0;border-radius:0}.frontmatter-toggle{display:flex;gap:6px;align-items:center;width:100%;padding:10px 14px;border:0;background:transparent;color:inherit;font:600 13px Segoe UI,Microsoft YaHei,sans-serif;text-align:left;cursor:pointer}.frontmatter-toggle svg{width:15px;height:15px;transition:transform .22s ease;transform:rotate(90deg)}.frontmatter[data-expanded=false] .frontmatter-toggle svg{transform:rotate(0)}.frontmatter-body{display:grid;grid-template-rows:1fr;overflow:hidden;transition:grid-template-rows .24s ease,opacity .24s ease;opacity:1;border-top:1px solid #e9e9e9}.frontmatter[data-expanded=false] .frontmatter-body{grid-template-rows:0fr;max-height:0;opacity:0;border-top:0}.frontmatter-inner{min-height:0;overflow:hidden}a[data-external-url]{cursor:pointer}.link-card{position:fixed;z-index:100;width:min(390px,calc(100vw - 24px));border:1px solid #e5e5e5;border-radius:12px;background:#fff;color:#282828;box-shadow:0 16px 48px #0002,0 2px 8px #0001;font:13px/1.5 Segoe UI,Microsoft YaHei,sans-serif;overflow:visible;opacity:0;transform:translateY(5px);transition:opacity .16s ease,transform .16s ease}.link-card[data-visible=true]{opacity:1;transform:translateY(0)}.link-card:before{content:'';position:absolute;top:-6px;left:var(--arrow-left,24px);width:10px;height:10px;background:#fff;border-left:1px solid #e5e5e5;border-top:1px solid #e5e5e5;transform:rotate(45deg)}.link-card[data-above=true]:before{top:auto;bottom:-6px;transform:rotate(225deg)}.link-card-head{display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid #eee;min-width:0}.link-card-icon{width:34px;height:34px;border:1px solid #e9e9e9;border-radius:8px;background:#f7f7f7;display:grid;place-items:center;font-size:15px;font-weight:600;flex:none}.link-card-head div{min-width:0}.link-card-head strong,.link-card-head small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.link-card-head small{color:#8b8b8b}.link-card-main{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:13px;padding:16px}.link-card-main strong{display:block;font-size:14px;line-height:1.45}.link-card-main p{margin:8px 0 0;font-size:12px;color:#777;line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.link-card-main img{width:90px;height:72px;object-fit:cover;border-radius:7px}.link-card-footer{display:flex;align-items:center;justify-content:space-between;width:100%;padding:10px 16px;border:0;border-top:1px solid #eee;background:transparent;color:#777;text-align:left;cursor:pointer;font:inherit}.link-card-footer:hover{color:#222;background:#fafafa;border-radius:0 0 12px 12px}@media(prefers-reduced-motion:reduce){.frontmatter-body,.frontmatter-toggle svg,.link-card{transition:none}}`;
}

function interactionStyles(){
  return `.frontmatter dl{border-top:0}.frontmatter-body{display:block;grid-template-rows:none;transition:height .24s ease,opacity .24s ease}.frontmatter[data-expanded=false] .frontmatter-body{max-height:none}.link-card-footer svg{width:16px;height:16px;stroke-width:1.8}`;
}

function lightboxStyles(){
  return `.markdown-content img{cursor:zoom-in}.markdown-lightbox{position:fixed;inset:0;z-index:200;display:flex;flex-direction:column;background:rgba(18,20,24,.96);color:#f5f5f5;font:13px Segoe UI,Microsoft YaHei,sans-serif}.markdown-lightbox[hidden]{display:none}.lightbox-header,.lightbox-footer{display:flex;align-items:center;gap:12px;flex:none;padding:10px 16px;background:rgba(255,255,255,.035)}.lightbox-header{min-height:54px}.lightbox-title{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lightbox-count{color:#b8b8b8;font-variant-numeric:tabular-nums}.lightbox-button{display:grid;place-items:center;width:34px;height:34px;flex:none;border:0;border-radius:7px;background:transparent;color:#f5f5f5;cursor:pointer}.lightbox-button:hover{background:#ffffff22}.lightbox-button:disabled{opacity:.35;cursor:default}.lightbox-button svg{width:19px;height:19px}.lightbox-stage{display:flex;align-items:center;justify-content:center;flex:1;min-height:0;overflow:auto;padding:16px}.lightbox-stage img{display:block;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;cursor:zoom-in}.lightbox-stage img[data-zoomed=true]{max-width:none;max-height:none;cursor:zoom-out}.lightbox-thumbs{display:flex;align-items:center;gap:7px;min-width:0;flex:1;overflow:auto;scrollbar-width:thin}.lightbox-thumb{width:48px;height:42px;padding:2px;border:1px solid transparent;border-radius:6px;background:transparent;flex:none;cursor:pointer}.lightbox-thumb[aria-current=true]{border-color:#fff;background:#ffffff22}.lightbox-thumb img{width:100%;height:100%;object-fit:cover;border-radius:3px}.lightbox-controls{display:flex;align-items:center;gap:3px;flex:none}`;
}

function lightboxLayout(){
  return `.markdown-lightbox{background:#1b1d21}.lightbox-footer{flex-direction:column;align-items:stretch;gap:8px;padding:9px 14px 11px}.lightbox-thumbs{width:100%;min-width:0;max-height:50px;flex:none;justify-content:safe center;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}.lightbox-thumbs::-webkit-scrollbar{display:none}.lightbox-controls{justify-content:center;min-height:34px}.lightbox-thumb{height:46px}`;
}

function markdownStyles(){
  const root=getComputedStyle(document.documentElement);
  const color=(name:string,fallback:string)=>root.getPropertyValue(name).trim()||fallback;
  const fg=color('--fg','#252525'),muted=color('--muted','#767676'),line=color('--line','#e9e9e9'),soft=color('--soft','#f6f6f6'),surface=color('--surface','#fff');
  return `html,body{background:${surface};color:${fg}}body{padding:clamp(22px,5vw,48px);font-size:15px;line-height:1.75}.markdown-content{max-width:920px;margin:0 auto;padding-bottom:60px}h1,h2,h3,h4,h5,h6{line-height:1.3;scroll-margin-top:24px;overflow-wrap:anywhere}h1{font-size:2em;letter-spacing:-.035em;margin:0 0 24px}h2{font-size:1.52em;margin:38px 0 18px;border-bottom:1px solid ${line};padding-bottom:9px}h3{font-size:1.25em;margin:30px 0 14px}p,ul,ol,blockquote,table,pre{margin:0 0 18px}li{padding-left:3px}li+li{margin-top:4px}blockquote{border-left:3px solid ${line};padding:2px 16px;color:${muted};margin-left:0}hr{border:0;border-top:1px solid ${line};margin:28px 0}a{color:#3e70b8;text-decoration:none;border-bottom:1px solid #3e70b855}a:hover{border-bottom-color:currentColor}code{font-family:Consolas,SFMono-Regular,monospace;font-size:.9em}p code,li code,td code{padding:2px 5px;background:${soft};border:1px solid ${line};border-radius:5px}.code-block{border:1px solid ${line};border-radius:10px;overflow:hidden;margin:18px 0 24px;background:${soft}}.code-toolbar{height:38px;display:flex;align-items:center;justify-content:space-between;padding:0 10px 0 15px;border-bottom:1px solid ${line};color:${muted};font:12px Segoe UI,Microsoft YaHei,sans-serif}.code-copy{appearance:none;border:0;background:transparent;color:${muted};padding:5px 8px;border-radius:5px;cursor:pointer;font:inherit}.code-copy:hover{background:${line};color:${fg}}.code-block pre{margin:0;padding:16px 18px;overflow:auto;white-space:pre;overflow-wrap:normal;max-height:700px}.code-block code{font-size:13px;line-height:1.6;background:none}.hljs{color:${fg}}.hljs-comment,.hljs-quote{color:#718096}.hljs-keyword,.hljs-selector-tag,.hljs-literal{color:#9b53ad}.hljs-string,.hljs-attribute,.hljs-addition{color:#24805f}.hljs-number,.hljs-symbol,.hljs-built_in{color:#b56a26}.hljs-title,.hljs-function,.hljs-type{color:#3567b0}.hljs-variable,.hljs-params{color:#b3594c}.table-scroll{max-width:100%;overflow:auto;border:1px solid ${line};border-radius:10px;margin:20px 0 24px}.table-scroll:focus-visible{outline:2px solid #6b8fd8;outline-offset:2px}.table-scroll table{border-collapse:separate;border-spacing:0;width:100%;min-width:max-content;margin:0;font-size:14px}.table-scroll th,.table-scroll td{padding:10px 14px;border-right:1px solid ${line};border-bottom:1px solid ${line};text-align:left;vertical-align:top}.table-scroll tr>:last-child{border-right:0}.table-scroll tbody tr:last-child>*{border-bottom:0}.table-scroll th{background:${soft};font-weight:600;white-space:nowrap}.table-scroll tbody tr:nth-child(even){background:${soft}80}.markdown-image{margin:22px 0 26px;text-align:center}.markdown-image img{display:block;max-width:100%;max-height:780px;width:auto;margin:0 auto;border-radius:8px;cursor:zoom-in;object-fit:contain}.markdown-image figcaption{margin-top:8px;color:${muted};font-size:12px}.markdown-image.is-zoomed img{max-height:none;max-width:none;cursor:zoom-out}.markdown-image.is-zoomed{overflow:auto;text-align:left}.image-unavailable{display:inline-block;padding:16px 20px;background:${soft};border:1px solid ${line};border-radius:8px;color:${muted}}.frontmatter{border:1px solid ${line};border-radius:10px;margin:0 0 28px;background:${soft}60}.frontmatter summary{cursor:pointer;padding:10px 14px;font-size:13px;font-weight:600}.frontmatter dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px 24px;border-top:1px solid ${line};padding:14px;margin:0}.frontmatter dl>div{min-width:0}.frontmatter dt{font-size:12px;color:${muted};margin-bottom:3px}.frontmatter dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}.frontmatter pre{padding:0 14px 14px;margin:0;white-space:pre-wrap}.katex-display{overflow:auto hidden;max-width:100%;padding:8px 0}.mdx-source{display:block;padding:8px 11px;border-radius:6px;background:${soft};border:1px solid ${line};overflow:auto}.mdx-inline{color:${muted}}@media(max-width:600px){body{padding:18px}.frontmatter dl{grid-template-columns:1fr}}`;
}

async function rewriteImages(doc:Document){
  const images=Array.from(doc.querySelectorAll<HTMLImageElement>('img')).slice(0,100);
  const cache=new Map<string,Promise<string|null>>();
  await Promise.all(Array.from({length:Math.min(8,images.length)},async(_,worker)=>{
    for(let i=worker;i<images.length;i+=8){
      const img=images[i],source=img.getAttribute('src')||'';
      if(!/^data:image\//i.test(source)){
        if(!cache.has(source))cache.set(source,api.previewResource(source).catch(()=>null));
        const local=await cache.get(source)!;
        if(local)img.src=local;else{const missing=doc.createElement('span');missing.className='image-unavailable';missing.textContent=img.alt||'图片不可用';img.replaceWith(missing);continue;}
      }
      img.loading='lazy';img.decoding='async';
      if(img.parentElement?.tagName==='P'&&img.parentElement.childNodes.length===1){
        const parent=img.parentElement,figure=doc.createElement('figure');figure.className='markdown-image';parent.replaceWith(figure);figure.append(img);
        if(img.alt){const caption=doc.createElement('figcaption');caption.textContent=img.alt;figure.append(caption);}
      }
    }
  }));
}

function installLightbox(content:Document){
  const images=Array.from(content.querySelectorAll<HTMLImageElement>('.markdown-content img[src]'));
  const lightbox=content.createElement('div');lightbox.className='markdown-lightbox';lightbox.hidden=true;lightbox.setAttribute('role','dialog');lightbox.setAttribute('aria-label','图片预览');
  lightbox.innerHTML=`<header class="lightbox-header"><span class="lightbox-title"></span><span class="lightbox-count"></span><button class="lightbox-button" type="button" data-gallery-action="close" aria-label="关闭图片预览">${icon('close')}</button></header><div class="lightbox-stage"><img alt=""></div><footer class="lightbox-footer"><div class="lightbox-thumbs"></div><div class="lightbox-controls"><button class="lightbox-button" type="button" data-gallery-action="zoom-out" aria-label="缩小">${icon('minus')}</button><button class="lightbox-button" type="button" data-gallery-action="zoom-in" aria-label="放大">${icon('plus')}</button><button class="lightbox-button" type="button" data-gallery-action="previous" aria-label="上一张">${icon('back')}</button><button class="lightbox-button" type="button" data-gallery-action="next" aria-label="下一张">${icon('arrow')}</button></div></footer>`;
  content.body.append(lightbox);
  const photo=lightbox.querySelector<HTMLImageElement>('.lightbox-stage img')!,title=lightbox.querySelector<HTMLElement>('.lightbox-title')!,count=lightbox.querySelector<HTMLElement>('.lightbox-count')!,thumbs=lightbox.querySelector<HTMLElement>('.lightbox-thumbs')!;
  let index=0,zoom=1,zoomBaseWidth=0,previousOverflow='',previousFocus:HTMLElement|null=null;
  const setZoom=(value:number)=>{zoom=Math.min(4,Math.max(1,value));if(zoom>1&&!zoomBaseWidth)zoomBaseWidth=Math.max(photo.naturalWidth,photo.clientWidth);photo.dataset.zoomed=String(zoom>1);photo.style.width=zoom>1&&zoomBaseWidth?Math.round(zoomBaseWidth*zoom)+'px':'';photo.style.height='';if(zoom===1)zoomBaseWidth=0;};
  const select=(value:number)=>{
    index=(value+images.length)%images.length;const image=images[index];photo.src=image.src;photo.alt=image.alt||'图片';title.textContent=image.alt||image.src.split('/').pop()||'图片';count.textContent=`${index+1} / ${images.length}`;setZoom(1);
    thumbs.querySelectorAll<HTMLButtonElement>('.lightbox-thumb').forEach((thumb,i)=>thumb.setAttribute('aria-current',String(i===index)));
    thumbs.querySelectorAll<HTMLButtonElement>('.lightbox-thumb')[index]?.scrollIntoView({block:'nearest',inline:'nearest'});
  };
  const open=(image:HTMLImageElement)=>{
    if(!images.length)return;
    if(!thumbs.childElementCount){for(const [i,item] of images.entries()){const button=content.createElement('button');button.type='button';button.className='lightbox-thumb';button.dataset.galleryIndex=String(i);button.setAttribute('aria-label',`${i+1}：${item.alt||'图片'}`);const thumb=content.createElement('img');thumb.src=item.src;thumb.alt='';thumb.loading='lazy';button.append(thumb);thumbs.append(button);}}
    previousFocus=content.activeElement as HTMLElement|null;previousOverflow=content.documentElement.style.overflow;content.documentElement.style.overflow='hidden';lightbox.hidden=false;select(images.indexOf(image));lightbox.querySelector<HTMLButtonElement>('[data-gallery-action=close]')?.focus();
  };
  const close=()=>{lightbox.hidden=true;content.documentElement.style.overflow=previousOverflow;previousFocus?.focus();};
  const handleClick=(event:MouseEvent)=>{
    if(lightbox.hidden)return false;
    const target=event.target as Element;
    const thumb=target.closest<HTMLButtonElement>('[data-gallery-index]');if(thumb){select(Number(thumb.dataset.galleryIndex));return true;}
    const action=target.closest<HTMLButtonElement>('[data-gallery-action]')?.dataset.galleryAction;
    if(action==='close'){close();return true;}if(action==='previous'){select(index-1);return true;}if(action==='next'){select(index+1);return true;}
    if(action==='zoom-in'){setZoom(zoom+.5);return true;}if(action==='zoom-out'){setZoom(zoom-.5);return true;}
    if(target===photo){setZoom(zoom===1?2:1);return true;}
    if(target===lightbox||target.classList.contains('lightbox-stage')){close();return true;}
    return false;
  };
  content.addEventListener('keydown',event=>{if(lightbox.hidden)return;if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}else if(event.key==='ArrowRight'){event.preventDefault();select(index+1);}else if(event.key==='ArrowLeft'){event.preventDefault();select(index-1);}});
  return {open,handleClick};
}

export async function renderMarkdown(host:HTMLElement,data:PreviewData,outline:SetOutline){
  const isMdx=/\.mdx$/i.test(data.name);
  const {body,html:metadata}=frontmatter(data.text||'');
  const parser=new Marked({gfm:true,breaks:false});
  parser.use(markedKatex({throwOnError:false,trust:false}));
  let highlighted=0;
  parser.use({renderer:{
    code({text,lang}){
      const label=(lang||'').trim().split(/\s+/)[0].slice(0,40);
      const language=codeAliases[label.toLowerCase()]||label.toLowerCase();
      let value=esc(text);
      if(language&&hljs.getLanguage(language)&&text.length<100_000&&highlighted+text.length<textSizeLimit){
        try{value=hljs.highlight(text,{language,ignoreIllegals:true}).value;highlighted+=text.length;}catch{/* Keep readable plain code. */}
      }
      return `<div class="code-block"><div class="code-toolbar"><span>${esc(label||'代码')}</span><button class="code-copy" type="button" aria-label="复制代码">复制</button></div><pre><code class="hljs">${value}</code></pre></div>`;
    },
    html({text,block}){
      if(!isMdx)return text;
      return block?`<pre class="mdx-source"><code>${esc(text)}</code></pre>`:`<code class="mdx-inline">${esc(text)}</code>`;
    }
  }});
  const generated=await parser.parse(body);
  const safe=DOMPurify.sanitize(metadata+generated,{FORBID_TAGS:['script','iframe','object','embed','form','input','textarea','select','base','meta'],FORBID_ATTR:['srcset','action','formaction'],ADD_TAGS:['math','annotation','semantics']});
  const doc=new DOMParser().parseFromString(`<main class="markdown-content">${safe}</main>`,'text/html');
  doc.querySelectorAll('a').forEach(a=>{const href=a.getAttribute('href')||'';if(/^https?:\/\//i.test(href))a.dataset.externalUrl=href;else if(href.startsWith('#'))a.dataset.localHref=href.slice(1);a.removeAttribute('href');});
  doc.querySelectorAll('table').forEach(table=>{const container=doc.createElement('div');container.className='table-scroll';container.tabIndex=0;container.setAttribute('role','region');container.setAttribute('aria-label','表格，可横向滚动');table.replaceWith(container);container.append(table);});
  await rewriteImages(doc);
  const headings=Array.from(doc.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')).slice(0,1000);
  headings.forEach((heading,i)=>heading.id='one-heading-'+i);
  const frame=isolatedFrame(host,doc.body.innerHTML,markdownStyles()+markdownExtraStyles()+interactionStyles()+lightboxStyles()+lightboxLayout(),[katexStylesheet]);
  outline(headings.map((heading,i)=>({label:heading.textContent||'标题',depth:Number(heading.tagName[1])-1,activate:()=>frame.contentDocument?.getElementById('one-heading-'+i)?.scrollIntoView({behavior:'smooth',block:'start'})})));
  let hoverTimer:ReturnType<typeof setTimeout>|undefined,hideTimer:ReturnType<typeof setTimeout>|undefined,hoverRevision=0;
  const onLoad=()=>{
    const content=frame.contentDocument;if(!content)return;
    const gallery=installLightbox(content);
    const card=content.createElement('aside');card.className='link-card';card.hidden=true;content.body.append(card);
    let active:HTMLAnchorElement|undefined;
    const hide=()=>{clearTimeout(hoverTimer);clearTimeout(hideTimer);hoverRevision++;card.dataset.visible='false';card.hidden=true;active=undefined;};
    const scheduleHide=()=>{clearTimeout(hideTimer);hideTimer=setTimeout(hide,160);};
    const show=(anchor:HTMLAnchorElement)=>{
      const url=anchor.dataset.externalUrl;if(!url)return;
      let domain='';try{domain=new URL(url).hostname.replace(/^www\./,'');}catch{return;}
      const title=anchor.textContent?.trim().slice(0,160)||domain;
      const render=(info:{domain:string;title:string;description:string;image?:string})=>{
        const image=info.image&&/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(info.image)?`<img alt="" src="${info.image}">`:'';
        card.innerHTML=`<div class="link-card-head"><span class="link-card-icon">${esc(domain[0]?.toUpperCase()||'A')}</span><div><strong>${esc(info.domain||domain)}</strong><small>${esc(domain)}</small></div></div><div class="link-card-main"><div><strong>${esc(info.title||title)}</strong>${info.description?`<p>${esc(info.description)}</p>`:''}</div>${image}</div><button class="link-card-footer" type="button" aria-label="打开原网页"><span>打开原网页</span>${icon('open')}</button>`;
      };
      render({domain,title,description:''});card.hidden=false;card.dataset.visible='true';card.dataset.url=url;
      if(!content.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches)card.animate([{opacity:0,transform:'translateY(8px) scale(.985)'},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:220,easing:'cubic-bezier(.2,.8,.2,1)'});
      const bounds=anchor.getBoundingClientRect(),width=Math.min(390,content.documentElement.clientWidth-24);
      const left=Math.max(12,Math.min(bounds.left,content.documentElement.clientWidth-width-12));
      const above=bounds.bottom+card.offsetHeight+12>content.documentElement.clientHeight&&bounds.top>card.offsetHeight+12;
      card.dataset.above=String(above);card.style.left=left+'px';card.style.top=(above?bounds.top-card.offsetHeight-10:bounds.bottom+10)+'px';card.style.setProperty('--arrow-left',Math.max(18,Math.min(width-28,bounds.left-left+12))+'px');
      const revision=++hoverRevision;
      void api.previewLinkCard(url).then(info=>{if(revision!==hoverRevision||card.hidden)return;render(info);const top=above?bounds.top-card.offsetHeight-10:bounds.bottom+10;card.style.top=Math.max(8,Math.min(top,content.documentElement.clientHeight-card.offsetHeight-8))+'px';}).catch(()=>{});
    };
    content.addEventListener('pointerover',event=>{
      const anchor=(event.target as Element).closest<HTMLAnchorElement>('a[data-external-url]');
      if(!anchor){if(card.contains(event.target as Node))clearTimeout(hideTimer);return;}
      clearTimeout(hideTimer);if(active===anchor)return;active=anchor;clearTimeout(hoverTimer);hoverTimer=setTimeout(()=>show(anchor),650);
    });
    content.addEventListener('wheel',hide,{passive:true});
    content.addEventListener('pointerout',event=>{
      const target=event.target as Element,related=event.relatedTarget as Node|null;
      if(target.closest('a[data-external-url]')&&!target.closest('a[data-external-url]')?.contains(related)||card.contains(target)&&!card.contains(related))scheduleHide();
    });
    content.addEventListener('click',event=>{
      const target=event.target as HTMLElement;
      if(gallery.handleClick(event))return;
      const anchor=target.closest<HTMLAnchorElement>('a[data-external-url]');
      if(anchor){event.preventDefault();void api.previewOpenLink(anchor.dataset.externalUrl!).catch(toast);hide();return;}
      if(target.closest('.link-card-footer')){event.preventDefault();const url=card.dataset.url;if(url)void api.previewOpenLink(url).catch(toast);hide();return;}
      const local=target.closest<HTMLAnchorElement>('a[data-local-href]');if(local){content.getElementById(decodeURIComponent(local.dataset.localHref||''))?.scrollIntoView({behavior:'smooth'});return;}
      const toggle=target.closest<HTMLButtonElement>('.frontmatter-toggle');
      if(toggle){
        const section=toggle.closest<HTMLElement>('.frontmatter')!,panel=section.querySelector<HTMLElement>('.frontmatter-body')!;
        const expanded=section.dataset.expanded!=='true',from=panel.getBoundingClientRect().height;
        panel.style.maxHeight='none';panel.style.height=from+'px';section.dataset.expanded=String(expanded);toggle.setAttribute('aria-expanded',String(expanded));
        requestAnimationFrame(()=>{const next=expanded?panel.scrollHeight:0;panel.style.height=next+'px';if(expanded)setTimeout(()=>{if(section.isConnected&&section.dataset.expanded==='true')panel.style.height='auto';},260);});
        return;
      }
      const copy=target.closest<HTMLButtonElement>('.code-copy');
      if(copy){const value=copy.closest('.code-block')?.querySelector('code')?.textContent||'';void api.copyText(value).then(()=>{copy.textContent='已复制';setTimeout(()=>{if(copy.isConnected)copy.textContent='复制';},1600);toast('已复制代码');}).catch(toast);return;}
      const image=target.closest<HTMLImageElement>('.markdown-content img');if(image)gallery.open(image);
    });
  };
  frame.addEventListener('load',onLoad);
  return()=>{clearTimeout(hoverTimer);clearTimeout(hideTimer);hoverRevision++;frame.removeEventListener('load',onLoad);frame.remove();};
}
