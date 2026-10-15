import type {PreviewData} from '../shared/types';
import {esc,icon,size} from './ui';
import {systemFileIcon} from './shell-icons';
import './application-preview.css';

export function renderApplicationPreview(host:HTMLElement,data:PreviewData){
  const application=data.application;if(!application)throw Error('未找到程序信息');
  const article=document.createElement('article');article.className='application-preview';article.setAttribute('aria-label','应用程序详情');
  const section=(title:string,content:string)=>'<section><h3>'+esc(title)+'</h3>'+content+'</section>';
  article.innerHTML='<header><span class="application-preview-icon">'+systemFileIcon(data.path)+'</span><div><h2>'+esc(application.title)+'</h2><p>'+esc(data.name)+' · '+size(data.size)+'</p></div></header>'+
    application.sections.map(item=>section(item.title,'<dl>'+item.facts.map(fact=>'<div><dt>'+esc(fact.label)+'</dt><dd>'+esc(fact.value||'—')+'</dd></div>').join('')+'</dl>')).join('')+
    (application.packages?.length?section('包含的安装包','<div class="application-preview-table"><table><thead><tr><th>文件</th><th>架构</th><th>版本</th><th>大小</th></tr></thead><tbody>'+application.packages.map(item=>'<tr><td>'+esc(item.name)+'</td><td>'+esc(item.architecture||'—')+'</td><td>'+esc(item.version||'—')+'</td><td>'+(item.size&&Number.isFinite(Number(item.size))?size(Number(item.size)):'—')+'</td></tr>').join('')+'</tbody></table></div>'):'')+
    (application.dependencies?.length?section(application.kind==='pe'?'依赖模块':'依赖包','<ul class="application-preview-names">'+application.dependencies.map(name=>'<li>'+esc(name)+'</li>').join('')+'</ul>'):'')+
    (application.exports?.length?section('导出函数'+(application.exports.length>=512?' · 前 512 项':''),'<ul class="application-preview-names">'+application.exports.map(name=>'<li>'+esc(name)+'</li>').join('')+'</ul>'):'');
  host.replaceChildren(article);return ()=>article.remove();
}
export function renderRtfPreview(host:HTMLElement,data:PreviewData){
  if(!data.richText)throw Error('未找到 RTF 正文');
  const paper=document.createElement('article');paper.className='rich-text-preview';paper.setAttribute('aria-label','RTF 文档');
  const fragment=document.createDocumentFragment();
  for(const paragraph of data.richText.paragraphs){
    const p=document.createElement('p');p.style.textAlign=paragraph.align;
    if(!paragraph.runs.length)p.append(document.createElement('br'));
    for(const run of paragraph.runs){
      const span=document.createElement('span');span.textContent=run.text;
      if(run.bold)span.style.fontWeight='700';if(run.italic)span.style.fontStyle='italic';
      const decorations=[run.underline?'underline':'',run.strike?'line-through':''].filter(Boolean);if(decorations.length)span.style.textDecoration=decorations.join(' ');
      if(run.fontSize&&Number.isFinite(run.fontSize))span.style.fontSize=Math.max(6,Math.min(72,run.fontSize/2))+'pt';
      p.append(span);
    }
    fragment.append(p);
  }
  paper.append(fragment);host.replaceChildren(paper);return ()=>paper.remove();
}
