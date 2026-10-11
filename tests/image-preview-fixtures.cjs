const fs=require('node:fs/promises'),path=require('node:path');
const box=(type,payload=Buffer.alloc(0))=>{const header=Buffer.alloc(8);header.writeUInt32BE(payload.length+8);if(typeof type==='number')header.writeUInt32BE(type,4);else header.write(type,4);return Buffer.concat([header,payload]);};
const id='12345678-1234-1234-1234-123456789abc';
function identifiedMovie(identifier=id,quickTimeMeta=false){
 const hdlr=Buffer.alloc(12);hdlr.write('vide',8);const key=Buffer.from('com.apple.quicktime.content.identifier');const keyEntry=box('mdta',key),keys=box('keys',Buffer.concat([Buffer.alloc(4),Buffer.from([0,0,0,1]),keyEntry]));
 const data=box('data',Buffer.concat([Buffer.from([0,0,0,1,0,0,0,0]),Buffer.from(identifier)]));
 const meta=box('meta',Buffer.concat([...(quickTimeMeta?[box('hdlr',Buffer.alloc(24))]:[Buffer.alloc(4)]),keys,box('ilst',box(1,data))]));
 return Buffer.concat([box('ftyp',Buffer.from('qt  \0\0\0\0qt  ')),box('moov',Buffer.concat([box('trak',box('mdia',box('hdlr',hdlr))),quickTimeMeta?meta:box('udta',meta)])),box('mdat',Buffer.from('synthetic video data'))]);
}
function appleMaker(identifier=id){const note=Buffer.alloc(65);note.write('Apple iOS\0');note.write('MM',12);note.writeUInt16BE(1,14);note.writeUInt16BE(0x11,16);note.writeUInt16BE(2,18);note.writeUInt32BE(37,20);note.writeUInt32BE(28,24);note.write(identifier,28);return note;}
function sef(photo,movie,indirect=false){
 const name=Buffer.from('MotionPhoto_Data'),header=Buffer.alloc(8);header.writeUInt16LE(0x0a30,2);header.writeUInt32LE(name.length,4);
 const pointer=Buffer.alloc(12);pointer.write('mpv2');pointer.writeUInt32BE(photo.length,4);pointer.writeUInt32BE(movie.length,8);
 const block=Buffer.concat([header,name,indirect?pointer:movie]),data=Buffer.concat([photo,...(indirect?[movie]:[]),block]),directory=Buffer.alloc(24);
 directory.write('SEFH');directory.writeUInt32LE(106,4);directory.writeUInt32LE(1,8);directory.writeUInt16LE(0x0a30,14);directory.writeUInt32LE(block.length,16);directory.writeUInt32LE(block.length,20);
 const tail=Buffer.alloc(8);tail.writeUInt32LE(directory.length);tail.write('SEFT',4);return Buffer.concat([data,directory,tail]);
}
async function fixtures(dir){
 await fs.mkdir(dir,{recursive:true});const base=path.join(__dirname,'fixtures/image-preview');for(const name of await fs.readdir(base))if(/\.(gif|apng|webp|png|jpe?g|mp4)$/i.test(name))await fs.copyFile(path.join(base,name),path.join(dir,name));
 const photo=await fs.readFile(path.join(base,'photo.jpg')),movie=await fs.readFile(path.join(base,'motion.mp4'));
 const xmp=text=>{const content=Buffer.from(text),header=Buffer.alloc(4);header.writeUInt16BE(0xffe1);header.writeUInt16BE(content.length+2,2);return Buffer.concat([photo.subarray(0,2),header,content,photo.subarray(2)]);};
 await fs.writeFile(path.join(dir,'google-old.jpg'),Buffer.concat([xmp(`<x GCamera:MicroVideoOffset="${movie.length}" GCamera:MicroVideoPresentationTimestampUs="500000"/>`),movie]));
 await fs.writeFile(path.join(dir,'google-container.jpg'),Buffer.concat([xmp(`<Container:Item Item:Semantic="MotionPhoto" Item:Mime="video/mp4" Item:Length="${movie.length}"/>`),movie]));
 await fs.writeFile(path.join(dir,'motion-missing.jpg'),xmp('<x GCamera:MotionPhoto="1"/>'));
 await fs.writeFile(path.join(dir,'samsung-sef.jpg'),sef(photo,movie));await fs.writeFile(path.join(dir,'samsung-mpv2.jpg'),sef(photo,movie,true));
 await fs.writeFile(path.join(dir,'vendor-trailer.jpg'),Buffer.concat([photo,Buffer.alloc(31),movie,Buffer.from('private-trailer')]));
 await fs.writeFile(path.join(dir,'heic-motion.heic'),Buffer.concat([box('ftyp',Buffer.from('heic\0\0\0\0heic')),box('free',Buffer.alloc(16)),box('mpvd',movie)]));
 await fs.copyFile(path.join(base,'photo.jpg'),path.join(dir,'apple-pair.jpg'));await fs.copyFile(path.join(base,'motion.mp4'),path.join(dir,'apple-pair.MOV'));
 return {photo,movie,xmp};
}
module.exports={fixtures,box,appleMaker,identifiedMovie,sef,id};
