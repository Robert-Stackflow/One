import {mathjax} from '@mathjax/src/js/mathjax.js';
import {MathML} from '@mathjax/src/js/input/mathml.js';
import {SVG} from '@mathjax/src/js/output/svg.js';
import {liteAdaptor} from '@mathjax/src/js/adaptors/liteAdaptor.js';
import {RegisterHTMLHandler} from '@mathjax/src/js/handlers/html.js';
import {MathJaxTexFont} from '@mathjax/mathjax-tex-font/js/svg.js';
import {renderFormulaPreview} from '../../shared/recognition/formula-preview';
import {FORMULA_SVG_BYTES,FORMULA_RENDER_PIXELS} from '../../shared/recognition/formula-image';
import {validateSvg} from '../image-svg';
/** Parse the same trusted KaTeX MathML as the preview; never run a TeX loader. */
export function formulaVector(text:string){
  const html=renderFormulaPreview(text),math=html.match(/<math\b[\s\S]*?<\/math>/)?.[0];if(!math)throw Error('无法生成公式图像');
  const adaptor=liteAdaptor();RegisterHTMLHandler(adaptor);
  const document=mathjax.document('',{InputJax:new MathML(),OutputJax:new SVG({fontData:MathJaxTexFont,fontCache:'local'})});
  const node=document.convert(math,{display:true}),svg=adaptor.tags(node,'svg')[0];if(!svg)throw Error('无法生成公式矢量图');
  const bounds=adaptor.getAttribute(svg,'viewBox').split(/\s+/).map(Number);
  if(bounds.length!==4||!bounds.every(Number.isFinite)||bounds[2]<=0||bounds[3]<=0)throw Error('公式图像尺寸无效');
  const [x,y,w,h]=bounds,padding=500,width=Math.ceil((w+padding*2)*.024),height=Math.ceil((h+padding*2)*.024);
  if(width>16384||height>16384||width*height>FORMULA_RENDER_PIXELS)throw Error('公式图像过大，请分段导出');
  for(const [name,value] of Object.entries({xmlns:'http://www.w3.org/2000/svg',width,height,viewBox:[x-padding,y-padding,w+padding*2,h+padding*2].join(' '),style:'color:#171717;background:#ffffff'}))adaptor.setAttribute(svg,name,value);
  const encoded=adaptor.outerHTML(svg);if(Buffer.byteLength(encoded)>FORMULA_SVG_BYTES||/\son[a-z]+\s*=/i.test(encoded))throw Error('公式矢量图过大或格式无效');
  return {svg:validateSvg(encoded),width,height};
}
