const fs=require('node:fs/promises'),path=require('node:path'),JSZip=require('jszip');
const p='http://schemas.openxmlformats.org/presentationml/2006/main',a='http://schemas.openxmlformats.org/drawingml/2006/main',r='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const relations=items=>`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id,type,target])=>`<Relationship Id="${id}" Type="${r}/${type}" Target="${target}"/>`).join('')}</Relationships>`;
const transform=(x,y,w,h)=>`<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>`;
const paragraph=text=>`<a:p><a:r><a:rPr lang="zh-CN" sz="2400"><a:solidFill><a:srgbClr val="24382C"/></a:solidFill><a:latin typeface="Arial"/><a:ea typeface="Microsoft YaHei"/></a:rPr><a:t>${text}</a:t></a:r></a:p>`;
const shape=(id,text,x,y,w,h,title=false)=>`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${text}"/><p:cNvSpPr/><p:nvPr>${title?'<p:ph type="title"/>':''}</p:nvPr></p:nvSpPr><p:spPr>${transform(x,y,w,h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="E5F1E9"/></a:solidFill></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${paragraph(text)}</p:txBody></p:sp>`;
const tree=nodes=>`<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>${transform(0,0,0,0)}</p:grpSpPr>${nodes}</p:spTree>`;
const graphic=(id,name,x,y,w,h,uri,nodes)=>`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${name}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></p:xfrm><a:graphic><a:graphicData uri="${uri}">${nodes}</a:graphicData></a:graphic></p:graphicFrame>`;
module.exports=async function fixtures(root){
 await fs.mkdir(root,{recursive:true});
 async function presentation(count,daily=false){
  const zip=new JSZip();let overrides='',ids='',links=[];
  const override=(name,type)=>{overrides+=`<Override PartName="/${name}" ContentType="application/vnd.openxmlformats-officedocument.${type}+xml"/>`;};
  override('ppt/presentation.xml','presentationml.presentation.main');override('ppt/slideMasters/slideMaster1.xml','presentationml.slideMaster');override('ppt/slideLayouts/slideLayout1.xml','presentationml.slideLayout');override('ppt/theme/theme1.xml','theme');
  zip.file('_rels/.rels',relations([['office','officeDocument','ppt/presentation.xml']]));
  zip.file('ppt/slideLayouts/slideLayout1.xml',`<p:sldLayout xmlns:p="${p}" xmlns:a="${a}" type="blank"><p:cSld>${tree('')}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels',relations([['master','slideMaster','../slideMasters/slideMaster1.xml']]));
  zip.file('ppt/slideMasters/slideMaster1.xml',`<p:sldMaster xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:cSld>${tree(shape(90,'MASTER_MARKER',300000,6200000,3000000,400000))}</p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="layout"/></p:sldLayoutIdLst></p:sldMaster>`);
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels',relations([['theme','theme','../theme/theme1.xml'],['layout','slideLayout','../slideLayouts/slideLayout1.xml']]));
  const colors={dk1:'000000',lt1:'FFFFFF',dk2:'24382C',lt2:'F5F5F5',accent1:'427F5B',accent2:'C86D45',accent3:'5585B5',accent4:'9966AA',accent5:'BB9933',accent6:'55AAAA',hlink:'0000FF',folHlink:'800080'};
  zip.file('ppt/theme/theme1.xml',`<a:theme xmlns:a="${a}" name="One test"><a:themeElements><a:clrScheme name="One">${Object.entries(colors).map(([k,v])=>`<a:${k}><a:srgbClr val="${v}"/></a:${k}>`).join('')}</a:clrScheme><a:fontScheme name="One"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Arial"/></a:minorFont></a:fontScheme><a:fmtScheme name="One"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>`);
  if(daily){override('ppt/notesMasters/notesMaster1.xml','presentationml.notesMaster');zip.file('ppt/notesMasters/notesMaster1.xml',`<p:notesMaster xmlns:p="${p}" xmlns:a="${a}"><p:cSld>${tree('')}</p:cSld><p:clrMap tx1="accent2"/><p:notesStyle><a:lvl2pPr><a:buChar char="◆"/><a:defRPr b="1" sz="1400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl2pPr></p:notesStyle></p:notesMaster>`);zip.file('ppt/notesMasters/_rels/notesMaster1.xml.rels',relations([['theme','theme','../theme/theme1.xml']]));}
  for(let i=1;i<=count;i++){
   ids+=`<p:sldId id="${255+i}" r:id="slide${i}"/>`;links.push([`slide${i}`,'slide',`slides/slide${i}.xml`]);override(`ppt/slides/slide${i}.xml`,'presentationml.slide');
   let nodes=shape(2,`SLIDE_${i}_中文`,300000,250000,10000000,700000,true)+shape(3,`BODY_${i}`,300000,1100000,3200000,700000);
   const slideLinks=[['layout','slideLayout','../slideLayouts/slideLayout1.xml']];
   if(i===1||i===count){
    slideLinks.push(['notes','notesSlide',`../notesSlides/notesSlide${i}.xml`]);override(`ppt/notesSlides/notesSlide${i}.xml`,'presentationml.notesSlide');
    let body=shape(70,`NOTES_${i}_中文`,0,0,4000000,2000000).replace('<p:nvPr></p:nvPr>','<p:nvPr><p:ph type="body"/></p:nvPr>').replace('lang="zh-CN" sz="2400"','lang="zh-CN" sz="1800" b="1" i="1" u="sng"').replace(`NOTES_${i}_中文</a:t>`,`NOTES_${i}_中文</a:t></a:r><a:br/><a:r><a:t>第二行 &lt;script&gt;</a:t>`);
    if(i===count)body=body.replace('<a:lstStyle/>','<a:lstStyle><a:lvl2pPr><a:defRPr i="1"/></a:lvl2pPr></a:lstStyle>').replace('</p:txBody>',`<a:p><a:pPr lvl="1"><a:buChar char="•"/></a:pPr><a:r><a:t>重点事项</a:t></a:r></a:p><a:p><a:pPr lvl="1"><a:buAutoNum type="arabicPeriod" startAt="3"/></a:pPr><a:r><a:t>第三步</a:t></a:r></a:p><a:p><a:pPr lvl="1"><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>第四步</a:t></a:r></a:p><a:p><a:pPr lvl="1"/><a:r><a:t>母版继承</a:t></a:r></a:p><a:p><a:pPr lvl="1"><a:buNone/><a:defRPr sz="1800"/></a:pPr><a:r><a:rPr b="0"/><a:t>无项目符号</a:t></a:r></a:p></p:txBody>`);
    const number=shape(71,'NOTES_SLIDE_NUMBER',0,0,500000,200000).replace('<p:nvPr></p:nvPr>','<p:nvPr><p:ph type="sldNum"/></p:nvPr>');
    zip.file(`ppt/notesSlides/notesSlide${i}.xml`,`<p:notes xmlns:p="${p}" xmlns:a="${a}"><p:cSld>${tree(body+number)}</p:cSld></p:notes>`);
    if(daily)zip.file(`ppt/notesSlides/_rels/notesSlide${i}.xml.rels`,relations([['master','notesMaster','../notesMasters/notesMaster1.xml'],['slide','slide',`../slides/slide${i}.xml`]]));
   }
   if(daily&&i===1){
    nodes+=`<p:grpSp><p:nvGrpSpPr><p:cNvPr id="30" name="GROUP"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="300000" y="4200000"/><a:ext cx="5000000" cy="1000000"/><a:chOff x="0" y="0"/><a:chExt cx="5000000" cy="1000000"/></a:xfrm></p:grpSpPr>${shape(31,'GROUP_MARKER_中文',0,0,5000000,900000)}</p:grpSp>`;
    const cells=['TABLE_A','TABLE_B'].map(text=>`<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${paragraph(text)}</a:txBody><a:tcPr/></a:tc>`).join('');
    nodes+=graphic(40,'TABLE',300000,2400000,4000000,700000,`${a}/table`,`<a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="2000000"/><a:gridCol w="2000000"/></a:tblGrid><a:tr h="700000">${cells}</a:tr></a:tbl>`);
    nodes+=`<p:pic><p:nvPicPr><p:cNvPr id="41" name="IMAGE_MARKER"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="image"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${transform(300000,3300000,1000000,700000)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
    nodes+=graphic(42,'CHART',5000000,1400000,6500000,3500000,`${a}/chart`,`<c:chart xmlns:c="${a}/chart" r:id="chart"/>`);
    slideLinks.push(['image','image','../media/image.png'],['chart','chart','../charts/chart1.xml']);
    zip.file('ppt/media/image.png',await fs.readFile(path.join(__dirname,'fixtures/image-preview/still.png')));
    const cached=(tag,values)=>`<c:${tag}><c:${tag==='cat'?'strLit':'numLit'}><c:ptCount val="${values.length}"/>${values.map((value,index)=>`<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>`).join('')}</c:${tag==='cat'?'strLit':'numLit'}></c:${tag}>`;
    zip.file('ppt/charts/chart1.xml',`<c:chartSpace xmlns:c="${a}/chart" xmlns:a="${a}"><c:chart><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>CHART_SERIES</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="427F5B"/></a:solidFill></c:spPr>${cached('cat',['JAN','FEB'])}${cached('val',[12,24])}</c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:crossAx val="2"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/><c:crossAx val="1"/></c:valAx></c:plotArea></c:chart></c:chartSpace>`);override('ppt/charts/chart1.xml','drawingml.chart');
   }
   zip.file(`ppt/slides/slide${i}.xml`,`<p:sld xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"${i===2?' show="0"':''}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:bgPr></p:bg>${tree(nodes)}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
   zip.file(`ppt/slides/_rels/slide${i}.xml.rels`,relations(slideLinks));
  }
  links.push(['master','slideMaster','slideMasters/slideMaster1.xml']);if(daily)links.push(['notesMaster','notesMaster','notesMasters/notesMaster1.xml']);
  zip.file('ppt/presentation.xml',`<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="master"/></p:sldMasterIdLst>${daily?'<p:notesMasterIdLst><p:notesMasterId r:id="notesMaster"/></p:notesMasterIdLst>':''}<p:sldIdLst>${ids}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels',relations(links));zip.file('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/>${overrides}</Types>`);
  return zip;
 }
 const daily=await presentation(10,true),large=await presentation(150);
 const write=(file,zip)=>zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}).then(bytes=>fs.writeFile(path.join(root,file),bytes));
 await write('daily.pptx',daily);await write('large.pptx',large);const defaults=await JSZip.loadAsync(await daily.generateAsync({type:'nodebuffer'}));defaults.file('ppt/charts/chart1.xml',(await defaults.file('ppt/charts/chart1.xml').async('string')).replace('<c:spPr><a:solidFill><a:srgbClr val="427F5B"/></a:solidFill></c:spPr>',''));await write('default-colors.pptx',defaults);
 daily.file('ppt/slides/slide1.xml','<broken>');await write('malformed.pptx',daily);await fs.writeFile(path.join(root,'plain.txt'),'PLAIN_PPTX_EXIT');
};
