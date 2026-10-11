import JSZip from 'jszip';
import {DOMParser,type Element} from '@xmldom/xmldom';

export interface PptxNoteRun {text:string;bold?:boolean;italic?:boolean;underline?:boolean;color?:string;sizePt?:number}
export interface PptxNoteParagraph {runs:PptxNoteRun[];marker?:string;level?:number}
export interface PptxHeading {label:string;hidden:boolean;notes:string;notesRich:PptxNoteParagraph[]}
const presentation='http://schemas.openxmlformats.org/presentationml/2006/main';
const drawing='http://schemas.openxmlformats.org/drawingml/2006/main';
const relations='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageRelations='http://schemas.openxmlformats.org/package/2006/relationships';
const elements=(node:Element,namespace:string,name:string)=>Array.from(node.getElementsByTagNameNS(namespace,name));
const clamp=(value:number)=>Math.max(0,Math.min(1,value));
const noteColor=(hex:string,model:Element):string=>{
 const transforms=Array.from(model.childNodes).filter(node=>node.nodeType===1&&node.namespaceURI===drawing) as Element[];
 if(!transforms.length)return hex;
 let rgb=[1,3,5].map(at=>parseInt(hex.slice(at,at+2),16)/255),alpha=1,changed=false;
 const hsl=()=>{
  const [r,g,b]=rgb,max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
  let hue=0,saturation=0;const lightness=(max+min)/2;
  if(delta){saturation=delta/(1-Math.abs(2*lightness-1));
   switch(max){case r:hue=((g-b)/delta)%6;break;case g:hue=(b-r)/delta+2;break;default:hue=(r-g)/delta+4;}
   hue=(hue*60+360)%360;
  }
  return {hue,saturation,lightness};
 };
 const fromHsl=(hue:number,saturation:number,lightness:number)=>{
  const chroma=(1-Math.abs(2*lightness-1))*saturation,segment=hue/60,part=chroma*(1-Math.abs(segment%2-1));
  const [r,g,b]=segment<1?[chroma,part,0]:segment<2?[part,chroma,0]:segment<3?[0,chroma,part]:segment<4?[0,part,chroma]:segment<5?[part,0,chroma]:[chroma,0,part];
  const shift=lightness-chroma/2;rgb=[r+shift,g+shift,b+shift];
 };
 for(const item of transforms){
  const raw=item.getAttribute('val');if(!raw||!/^[-+]?\d+$/.test(raw))continue;
  const amount=Number(raw)/100000;if(!Number.isFinite(amount))continue;
  if(item.localName==='tint'&&amount>=0&&amount<=1){rgb=rgb.map(value=>value*amount+1-amount);changed=true;}
  else if(item.localName==='shade'&&amount>=0&&amount<=1){rgb=rgb.map(value=>value*amount);changed=true;}
  else if((item.localName==='lumMod'||item.localName==='lumOff')&&amount>=-1&&amount<=2){const color=hsl();fromHsl(color.hue,color.saturation,clamp(item.localName==='lumMod'?color.lightness*amount:color.lightness+amount));changed=true;}
  else if((item.localName==='sat'&&amount>=0&&amount<=1)||(item.localName==='satMod'&&amount>=0&&amount<=2)||(item.localName==='satOff'&&amount>=-1&&amount<=1)){const color=hsl();fromHsl(color.hue,clamp(item.localName==='sat'?amount:item.localName==='satMod'?color.saturation*amount:color.saturation+amount),color.lightness);changed=true;}
  else if(item.localName==='alpha'&&amount>=0&&amount<=1){alpha=amount;changed=true;}
  else if((item.localName==='alphaMod'&&amount>=0&&amount<=2)||(item.localName==='alphaOff'&&amount>=-1&&amount<=1)){alpha=clamp(item.localName==='alphaMod'?alpha*amount:alpha+amount);changed=true;}
 }
 if(!changed)return hex;
 const channels=rgb.map(value=>Math.round(clamp(value)*255+1e-9));
 return alpha<1?`rgba(${channels.join(', ')}, ${alpha})`:'#'+channels.map(value=>value.toString(16).padStart(2,'0')).join('').toUpperCase();
};
const autoNumber=(type:string|null,value:number):string|undefined=>{
 if(!Number.isInteger(value)||value<1||value>32767||!type)return;
 let number:string;
 if(type.startsWith('arabic'))number=String(value);
 else if(type.startsWith('alphaLc')||type.startsWith('alphaUc')){
  let current=value,letters='';
  while(current>0){current--;letters=String.fromCharCode(65+current%26)+letters;current=Math.floor(current/26);}
  number=type.startsWith('alphaLc')?letters.toLowerCase():letters;
 }else if(type.startsWith('romanLc')||type.startsWith('romanUc')){
  let current=value,roman='';
  for(const [amount,digit] of [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']] as const){
   while(current>=amount){roman+=digit;current-=amount;}
  }
  number=type.startsWith('romanLc')?roman.toLowerCase():roman;
 }else return;
 if(type==='arabicPlain')return number;
 if(/^(arabic|alphaLc|alphaUc|romanLc|romanUc)Period$/.test(type))return number+'.';
 if(/^(arabic|alphaLc|alphaUc|romanLc|romanUc)ParenR$/.test(type))return number+')';
 if(/^(arabic|alphaLc|alphaUc|romanLc|romanUc)ParenBoth$/.test(type))return '('+number+')';
};

/** Read titles in presentation order off the UI thread; never rewrite the file. */
export async function preparePptxOutline(bytes:ArrayBuffer):Promise<{bytes:ArrayBuffer;headings:PptxHeading[]}>{
 const archive=await JSZip.loadAsync(bytes);
 const parse=(text:string)=>new DOMParser({onError:(level,message)=>{throw new Error(`演示文稿 XML 无法读取：${level}: ${message}`);}}).parseFromString(text,'application/xml').documentElement!;
 const part=async(path:string)=>{const file=archive.file(path);if(!file)throw new Error('演示文稿缺少页面');return parse(await file.async('string'));};
 const root=await part('ppt/presentation.xml'),rels=await part('ppt/_rels/presentation.xml.rels');
 const paths=new Map(elements(rels,packageRelations,'Relationship').filter(node=>node.getAttribute('TargetMode')!=='External').map(node=>[node.getAttribute('Id'),node.getAttribute('Target')||'']));
 const slides=elements(root,presentation,'sldId');if(!slides.length)throw new Error('演示文稿没有页面');if(slides.length>5000)throw new Error('演示文稿页数超过预览上限');
 const headings:PptxHeading[]=[];
 const notesMasterCache=new Map<string,{levels:Map<number,Element>;colorMap:Map<string,string>;theme:Map<string,string>}>();
 for(const slide of slides){
  const target=paths.get(slide.getAttributeNS(relations,'id'))||'';
  const segments=(target.startsWith('/')?target.slice(1):'ppt/'+target).split('/'),normalized:string[]=[];
  for(const segment of segments){if(segment==='..')normalized.pop();else if(segment&&segment!=='.')normalized.push(segment);}
  const path=normalized.join('/');if(!/^ppt\/slides\/[^/]+\.xml$/.test(path))throw new Error('演示文稿页面引用无效');
  const page=await part(path),shapes=elements(page,presentation,'sp');
  const title=shapes.find(shape=>elements(shape,presentation,'ph').some(node=>['title','ctrTitle'].includes(node.getAttribute('type')||'')));
  const text=(node:Element)=>elements(node,drawing,'t').map(item=>item.textContent||'').join(' ').replace(/\s+/g,' ').trim();
  const label=(title&&text(title))||shapes.map(text).find(Boolean)||`第 ${headings.length+1} 张`;
  let notes='',notesRich:PptxNoteParagraph[]=[];
  const relPart=archive.file(`ppt/slides/_rels/${path.split('/').pop()}.rels`);
  if(relPart){
   const noteRelation=elements(parse(await relPart.async('string')),packageRelations,'Relationship').find(node=>node.getAttribute('Type')===relations+'/notesSlide'&&node.getAttribute('TargetMode')!=='External');
   if(noteRelation){
    const noteTarget=noteRelation.getAttribute('Target')||'',parts=(noteTarget.startsWith('/')?noteTarget.slice(1):'ppt/slides/'+noteTarget).split('/'),resolved:string[]=[];
    for(const segment of parts){if(segment==='..')resolved.pop();else if(segment&&segment!=='.')resolved.push(segment);}
    const notePath=resolved.join('/');if(!/^ppt\/notesSlides\/[^/]+\.xml$/.test(notePath))throw new Error('演示文稿备注引用无效');
    const note=await part(notePath);
    const children=(node:Element)=>Array.from(node.childNodes).filter(child=>child.nodeType===1) as Element[];
    const child=(node:Element|undefined,namespace:string,name:string)=>node&&children(node).find(item=>item.namespaceURI===namespace&&item.localName===name);
    const levels=(node:Element|undefined)=>new Map(Array.from({length:9},(_,index)=>[index,child(node,drawing,`lvl${index+1}pPr`)] as const).filter((pair):pair is readonly [number,Element]=>!!pair[1]));
    let masterLevels=new Map<number,Element>();
    let colorMap=new Map<string,string>(),theme=new Map<string,string>();
    const masterRels=archive.file(`ppt/notesSlides/_rels/${notePath.split('/').pop()}.rels`);
    if(masterRels){
     const masterRelation=elements(parse(await masterRels.async('string')),packageRelations,'Relationship').find(item=>item.getAttribute('Type')===relations+'/notesMaster'&&item.getAttribute('TargetMode')!=='External');
     if(masterRelation){
      const target=masterRelation.getAttribute('Target')||'',parts=(target.startsWith('/')?target.slice(1):'ppt/notesSlides/'+target).split('/'),resolved:string[]=[];
      for(const segment of parts){if(segment==='..')resolved.pop();else if(segment&&segment!=='.')resolved.push(segment);}
      const masterPath=resolved.join('/');if(!/^ppt\/notesMasters\/[^/]+\.xml$/.test(masterPath))throw new Error('演示文稿备注母版引用无效');
      if(!notesMasterCache.has(masterPath)){
       const master=await part(masterPath);
       const mapping=child(master,presentation,'clrMap');
       const mapped=new Map<string,string>();
       if(mapping)for(const name of ['bg1','tx1','bg2','tx2','accent1','accent2','accent3','accent4','accent5','accent6','hlink','folHlink']){
        const value=mapping.getAttribute(name);if(value)mapped.set(name,value);
       }
       const colors=new Map<string,string>();
       const themeRels=archive.file(`ppt/notesMasters/_rels/${masterPath.split('/').pop()}.rels`);
       if(themeRels){
        const themeRelation=elements(parse(await themeRels.async('string')),packageRelations,'Relationship').find(item=>item.getAttribute('Type')===relations+'/theme'&&item.getAttribute('TargetMode')!=='External');
        if(themeRelation){
         const target=themeRelation.getAttribute('Target')||'',parts=(target.startsWith('/')?target.slice(1):'ppt/notesMasters/'+target).split('/'),resolved:string[]=[];
         for(const segment of parts){if(segment==='..')resolved.pop();else if(segment&&segment!=='.')resolved.push(segment);}
         const themePath=resolved.join('/');if(!/^ppt\/theme\/[^/]+\.xml$/.test(themePath))throw new Error('演示文稿主题引用无效');
         const scheme=elements(await part(themePath),drawing,'clrScheme')[0];
         if(scheme)for(const entry of children(scheme)){
          const value=child(entry,drawing,'srgbClr')?.getAttribute('val')||child(entry,drawing,'sysClr')?.getAttribute('lastClr');
           if(entry.localName&&value&&/^[0-9a-fA-F]{6}$/.test(value))colors.set(entry.localName,'#'+value);
         }
        }
       }
       notesMasterCache.set(masterPath,{levels:levels(child(master,presentation,'notesStyle')),colorMap:mapped,theme:colors});
      }
      const cached=notesMasterCache.get(masterPath)!;
      masterLevels=cached.levels;colorMap=cached.colorMap;theme=cached.theme;
     }
    }
    const style=(props:Element|undefined):Omit<PptxNoteRun,'text'>=>{
     if(!props)return {};
     const color=children(props).find(child=>child.namespaceURI===drawing&&child.localName==='solidFill');
     const rgbModel=color&&child(color,drawing,'srgbClr');
     const schemeModel=color&&child(color,drawing,'schemeClr');
     const rgb=rgbModel?.getAttribute('val');
     const scheme=schemeModel?.getAttribute('val');
     const resolved=scheme&&theme.get(colorMap.get(scheme)||scheme);
     const base=rgb&&/^[0-9a-fA-F]{6}$/.test(rgb)?'#'+rgb:resolved||undefined;
     const model=rgbModel||schemeModel;
     const size=Number(props.getAttribute('sz'))/100;
     const bold=props.getAttribute('b'),italic=props.getAttribute('i'),underline=props.getAttribute('u');
     return {...(bold!==null?{bold:['1','true'].includes(bold)}:{}),...(italic!==null?{italic:['1','true'].includes(italic)}:{}),...(underline!==null?{underline:underline!=='none'}:{}),
      ...(base&&model?{color:noteColor(base,model)}:{}),...(Number.isFinite(size)&&size>=6&&size<=48?{sizePt:size}:{})};
    };
    const paragraph=(node:Element,counters:Map<number,number>,localLevels:Map<number,Element>):PptxNoteParagraph=>{
     const props=children(node).find(child=>child.namespaceURI===drawing&&child.localName==='pPr');
     const level=props?Math.max(0,Math.min(8,Number(props.getAttribute('lvl'))||0)):0;
     const master=masterLevels.get(level),local=localLevels.get(level);
     const bullet=[props,local,master].map(source=>source&&children(source).find(item=>item.namespaceURI===drawing&&['buChar','buAutoNum','buNone','buBlip'].includes(item.localName||''))).find(Boolean);
     const inherited={...style(child(master,drawing,'defRPr')),...style(child(local,drawing,'defRPr')),...style(child(props,drawing,'defRPr'))};
     let marker:string|undefined;
     if(bullet?.localName==='buChar')marker=Array.from(bullet.getAttribute('char')||'').slice(0,4).join('');
     if(bullet?.localName==='buAutoNum'){
      const type=bullet.getAttribute('type');
      if(type&&(type==='arabicPlain'||/^(arabic|alphaLc|alphaUc|romanLc|romanUc)(Period|ParenR|ParenBoth)$/.test(type))){
       const start=Number(bullet.getAttribute('startAt'));
       const number=Number.isInteger(start)&&start>=1&&start<=32767?start:(counters.get(level)||0)+1;
       counters.set(level,number);
       for(const key of counters.keys())if(key>level)counters.delete(key);
       marker=autoNumber(type,number);
      }
     }
     const runs:PptxNoteRun[]=[];
     const collect=(item:Element,format:Omit<PptxNoteRun,'text'>={})=>{
      if(item.namespaceURI===drawing){
       if(['pPr','rPr','endParaRPr'].includes(item.localName||''))return;
       if(item.localName==='t'){runs.push({text:item.textContent||'',...format});return;}
       if(item.localName==='br'||item.localName==='tab'){runs.push({text:item.localName==='br'?'\n':'\t'});return;}
       if(item.localName==='r'||item.localName==='fld')format={...format,...style(child(item,drawing,'rPr'))};
      }
      for(const child of children(item))collect(child,format);
     };
     collect(node,inherited);return {runs,...(marker?{marker,level}:{})};
    };
    notesRich=elements(note,presentation,'sp').filter(shape=>!elements(shape,presentation,'ph').some(node=>['sldImg','sldNum','dt','hdr','ftr'].includes(node.getAttribute('type')||''))).flatMap(shape=>{
     const counters=new Map<number,number>();
     const localLevels=levels(elements(shape,drawing,'lstStyle')[0]);
     return elements(shape,drawing,'p').map(node=>paragraph(node,counters,localLevels));
    });
    while(notesRich.length&&!notesRich[0].runs.some(run=>run.text.trim())&&!notesRich[0].marker)notesRich.shift();
    while(notesRich.length&&!notesRich.at(-1)!.runs.some(run=>run.text.trim())&&!notesRich.at(-1)!.marker)notesRich.pop();
    notes=notesRich.map(item=>`${item.marker?item.marker+' ':''}${item.runs.map(run=>run.text).join('')}`).join('\n').trim();
   }
  }
  headings.push({label:label.slice(0,240),hidden:page.getAttribute('show')==='0'||page.getAttribute('show')==='false',notes,notesRich});
 }
 return {bytes,headings};
}
