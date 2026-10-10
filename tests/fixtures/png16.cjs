const {deflateSync}=require('node:zlib');

function chunk(type,data){
 const header=Buffer.alloc(8),body=Buffer.concat([Buffer.from(type),data]);header.writeUInt32BE(data.length);header.write(type,4);
 let crc=0xffffffff;for(const byte of body){crc^=byte;for(let bit=0;bit<8;bit++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}
 const tail=Buffer.alloc(4);tail.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([header,data,tail]);
}
function png16(channels){
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(2,0);ihdr.writeUInt32BE(2,4);ihdr[8]=16;ihdr[9]=channels===4?6:channels===3?2:0;
 const stride=1+2*channels*2,rows=Buffer.alloc(stride*2);
 for(let y=0;y<2;y++)for(let x=0;x<2;x++)for(let channel=0;channel<channels;channel++)rows.writeUInt16BE(1000+(y*2+x)*7000+channel*111,y*stride+1+x*channels*2+channel*2);
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
module.exports={png16};
