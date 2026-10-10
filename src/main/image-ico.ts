import sharp from 'sharp';

export const icoSizes=[16,24,32,48,64,128,256] as const;

export async function encodeIco(source:string|Buffer):Promise<Buffer>{
 const images:Buffer[]=[];
 for(const size of icoSizes)images.push(await sharp(source,{limitInputPixels:50_000_000,failOn:'error'}).rotate().resize(size,size,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png({compressionLevel:9}).toBuffer());
 const directory=Buffer.alloc(6+images.length*16);directory.writeUInt16LE(1,2);directory.writeUInt16LE(images.length,4);
 let offset=directory.length;
 for(let index=0;index<images.length;index++){
  const size=icoSizes[index],position=6+index*16,image=images[index];directory[position]=size===256?0:size;directory[position+1]=size===256?0:size;directory.writeUInt16LE(1,position+4);directory.writeUInt16LE(32,position+6);directory.writeUInt32LE(image.length,position+8);directory.writeUInt32LE(offset,position+12);offset+=image.length;
 }
 return Buffer.concat([directory,...images],offset);
}
