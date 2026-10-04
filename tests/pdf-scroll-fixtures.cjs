const fs=require('node:fs/promises');

async function createPDF(file,count,imageSize=0,sizes){
 const handle=await fs.open(file,'wx'),offsets=[0];let position=0;const stride=imageSize?3:2,outlines=4+count*stride;
 const write=async value=>{const data=typeof value==='string'?Buffer.from(value):value;await handle.write(data,0,data.length,position);position+=data.length;};
 const object=async(id,body)=>{offsets[id]=position;await write(`${id} 0 obj\n${body}\nendobj\n`);};
 const stream=async(id,header,data)=>{offsets[id]=position;await write(`${id} 0 obj\n<< ${header} /Length ${data.length} >>\nstream\n`);await write(data);await write('\nendstream\nendobj\n');};
 try{
  await write('%PDF-1.4\n');await object(1,`<< /Type /Catalog /Pages 2 0 R /Outlines ${outlines} 0 R >>`);await object(2,`<< /Type /Pages /Kids [${Array.from({length:count},(_,i)=>`${4+i*stride} 0 R`).join(' ')}] /Count ${count} >>`);await object(3,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for(let i=0;i<count;i++){
   const [width,height]=sizes?.[i%sizes.length]||[612,792];
   const page=4+i*stride;await object(page,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> ${imageSize?`/XObject << /Im0 ${page+2} 0 R >>`:''} >> /Contents ${page+1} 0 R >>`);
   await stream(page+1,'',Buffer.from(`${imageSize?'q 512 0 0 512 40 40 cm /Im0 Do Q\n':''}BT /F1 16 Tf 40 ${height-62} Td (PDF_MARKER_${i+1}_END) Tj ET\n`));
   if(imageSize){const image=Buffer.alloc(imageSize*imageSize*3);for(let y=0;y<imageSize;y++)for(let x=0;x<imageSize;x++){const at=(y*imageSize+x)*3;image[at]=(x+i*13)%256;image[at+1]=(y+i*7)%256;image[at+2]=(x+y+i*5)%256;}await stream(page+2,`/Type /XObject /Subtype /Image /Width ${imageSize} /Height ${imageSize} /ColorSpace /DeviceRGB /BitsPerComponent 8`,image);}
  }
  await object(outlines,`<< /Type /Outlines /First ${outlines+1} 0 R /Last ${outlines+2} 0 R /Count 2 >>`);await object(outlines+1,`<< /Title (First page) /Parent ${outlines} 0 R /Next ${outlines+2} 0 R /Dest [4 0 R /XYZ null null null] >>`);await object(outlines+2,`<< /Title (Last page) /Parent ${outlines} 0 R /Prev ${outlines+1} 0 R /Dest [${4+(count-1)*stride} 0 R /XYZ null null null] >>`);
  const xref=position;await write(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
 }finally{await handle.close();}
}
module.exports={createPDF};
