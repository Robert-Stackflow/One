"""Independent framing/ZipCrypto/Store/Deflate/BZh checks; DLZ uses pinned oracle hashes."""
from pathlib import Path
import bz2,hashlib,json,struct,zlib

ROOT=Path(__file__).resolve().parent
TABLE=[]
for number in range(256):
 value=number
 for _ in range(8):value=(value>>1)^(0xedb88320 if value&1 else 0)
 TABLE.append(value)

def decrypt(data,password):
 keys=[0x12345678,0x23456789,0x34567890]
 def update(byte):
  keys[0]=(keys[0]>>8)^TABLE[(keys[0]^byte)&255]
  keys[1]=((keys[1]+(keys[0]&255))*134775813+1)&0xffffffff
  keys[2]=(keys[2]>>8)^TABLE[(keys[2]^(keys[1]>>24))&255]
 for byte in password:update(byte)
 result=bytearray()
 for byte in data:
  word=(keys[2]&65535)|2;plain=byte^(((word*(word^1))>>8)&255);update(plain);result.append(plain)
 return bytes(result)

def members(data,password):
 assert data[:8]==bytes.fromhex('414c5a010a000000')
 offset=8
 while struct.unpack_from('<I',data,offset)[0]==0x015a4c42:
  _,length,attributes,date,flags,reserved=struct.unpack_from('<IHBIBB',data,offset);offset+=13
  assert reserved==0 and not flags&6
  width=flags>>4;assert width in (0,1,2,4,8);method=crc=packed=size=0
  if width:
   method,unused,crc=struct.unpack_from('<BBI',data,offset);offset+=6;assert unused==0
   packed=int.from_bytes(data[offset:offset+width],'little');offset+=width
   size=int.from_bytes(data[offset:offset+width],'little');offset+=width
  name=data[offset:offset+length].decode('cp949').replace('\\','/');offset+=length
  secret=data[offset:offset+12] if flags&1 else b'';offset+=len(secret)
  encoded=data[offset:offset+packed];offset+=packed;assert len(encoded)==packed
  ciphertext=secret+encoded
  if flags&1:
   decoded=decrypt(secret+encoded,password);assert decoded[11]==((date>>8 if flags&8 else crc>>24)&255);encoded=decoded[12:]
  yield dict(name=name,bytes=size,packed=packed,crc32=f'{crc:08x}',method=method,directory=bool(attributes&16),flags=flags,time=date),encoded,secret,ciphertext
 assert offset==len(data)-16 and data[offset:]==bytes.fromhex('434c5a010000000000000000434c5a02')

def main():
 manifest=json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'));decoded=dlz=encrypted=entries=0
 for item in manifest['external']+manifest['generated']:
  data=(ROOT/item['name']).read_bytes();assert len(data)==item['bytes'] and hashlib.sha256(data).hexdigest()==item['sha256']
  actual=list(members(data,item['password'].encode('cp949')));assert len(actual)==len(item['expected'])
  for (entry,encoded,_,_),expected in zip(actual,item['expected']):
   for key,value in entry.items():assert expected[key]==value,(item['name'],key)
   assert hashlib.sha256(encoded).hexdigest()==expected['encodedSha256'];entries+=1;encrypted+=bool(entry['flags']&1)
   if entry['method']==0:plain=encoded
   elif entry['method']==2:plain=zlib.decompress(encoded,-15)
   elif encoded.startswith(b'BZh'):plain=bz2.decompress(encoded)
   else:assert entry['method']==1;dlz+=1;continue
   assert len(plain)==entry['bytes'] and f'{zlib.crc32(plain):08x}'==entry['crc32']
   assert hashlib.sha256(plain).hexdigest()==expected['sha256'];decoded+=1
 print(f"ALZ variants reference passed: {len(manifest['external'])+len(manifest['generated'])} archives, {entries} entries, {encrypted} encrypted headers, {decoded} stdlib decoded hashes; {dlz} DLZ hashes separately verified by UnAlz 0.65.")

if __name__=='__main__':main()
