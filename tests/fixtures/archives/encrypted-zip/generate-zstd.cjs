// Deterministic public test data only. Never use fixed salts in product code.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
const directory=path.resolve(__dirname,'..'),manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8')),source=manifest.files.find(file=>file.stored==='test_read_format_zip_zstd.zipx'),original=fs.readFileSync(path.join(directory,source.stored));assert.equal(digest(original),source.sha256);
const end=original.length-22;assert.equal(original.readUInt32LE(end),0x06054b50);assert.equal(original.readUInt16LE(end+10),1);const central=original.readUInt32LE(end+16);assert.equal(original.readUInt32LE(central),0x02014b50);assert.equal(original.readUInt32LE(central+42),0);assert.equal(original.readUInt16LE(central+8),0);assert.equal(original.readUInt16LE(central+10),93);
const data=30+original.readUInt16LE(26)+original.readUInt16LE(28),packed=original.readUInt32LE(central+20);assert.equal(data+packed,central);
function fixture(strength,version){
 const keySize=strength===1?16:32,salt=crypto.createHash('sha256').update(original).update(`${strength}/${version}`).digest().subarray(0,keySize/2),keys=crypto.pbkdf2Sync('secret',salt,1000,keySize*2+2,'sha1');
 const plain=original.subarray(data,data+packed),cipher=Buffer.alloc(plain.length),aes=crypto.createCipheriv('aes-'+keySize*8+'-ecb',keys.subarray(0,keySize),null);aes.setAutoPadding(false);
 for(let offset=0;offset<plain.length;offset+=16){const counter=Buffer.alloc(16);counter.writeUInt32LE(offset/16+1);const mask=aes.update(counter);for(let i=0;i<Math.min(16,plain.length-offset);i++)cipher[offset+i]=plain[offset+i]^mask[i];}assert.equal(aes.final().length,0);
 const mac=crypto.createHmac('sha1',keys.subarray(keySize,keySize*2)).update(cipher).digest().subarray(0,10),payload=Buffer.concat([salt,keys.subarray(keySize*2),cipher,mac]);
 const extra=Buffer.alloc(11);extra.writeUInt16LE(0x9901);extra.writeUInt16LE(7,2);extra.writeUInt16LE(version,4);extra.write('AE',6,'ascii');extra[8]=strength;extra.writeUInt16LE(93,9);
 const local=Buffer.from(original.subarray(0,data)),record=Buffer.from(original.subarray(central,end)),eocd=Buffer.from(original.subarray(end));
 local.writeUInt16LE(51,4);local.writeUInt16LE(1,6);local.writeUInt16LE(99,8);local.writeUInt32LE(payload.length,18);local.writeUInt16LE(local.readUInt16LE(28)+extra.length,28);if(version===2)local.writeUInt32LE(0,14);
 record.writeUInt16LE(51,6);record.writeUInt16LE(1,8);record.writeUInt16LE(99,10);record.writeUInt32LE(payload.length,20);record.writeUInt16LE(record.readUInt16LE(30)+extra.length,30);if(version===2)record.writeUInt32LE(0,16);
 // Extra fields precede the central record's comment, whose bytes are retained.
 const commentSize=record.readUInt16LE(32),recordEnd=record.length-commentSize,updated=Buffer.concat([record.subarray(0,recordEnd),extra,record.subarray(recordEnd)]),prefix=Buffer.concat([local,extra,payload]);
 eocd.writeUInt32LE(updated.length,12);eocd.writeUInt32LE(prefix.length,16);return Buffer.concat([prefix,updated,eocd]);
}
const generated={generator:'Node/OpenSSL PBKDF2-SHA1, independent AES-ECB little-endian CTR and HMAC-SHA1; deterministic public test salts',repository:manifest.repository,commit:manifest.commit,password:'secret',source:{file:'../'+source.stored,sha256:source.sha256},files:[]};
for(const [strength,version] of [[1,2],[3,1],[3,2]]){const bytes=fixture(strength,version),stored=`independent-aes${strength===1?128:256}-ae${version}-zstd.zipx`;fs.writeFileSync(path.join(__dirname,stored),bytes);generated.files.push({stored,bytes:bytes.length,sha256:digest(bytes),aesVersion:version,aesStrength:strength,method:93,flags:1,extensions:['.zipx'],nativeClose:false,expected:source.expected[0]});}
fs.writeFileSync(path.join(__dirname,'zstd-manifest.json'),JSON.stringify(generated,null,2)+'\n');console.log('Generated three pinned AES/ZSTD fixtures from unchanged external codec bytes.');
