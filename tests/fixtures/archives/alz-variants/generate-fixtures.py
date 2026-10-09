"""Reproduce seven original cases without downloading or rewriting expectations."""
from pathlib import Path
import bz2,hashlib,json,struct,zlib
from importlib.util import spec_from_file_location,module_from_spec
ROOT=Path(__file__).resolve().parent
spec=spec_from_file_location('reference',ROOT/'validate-reference.py');reference=module_from_spec(spec);spec.loader.exec_module(reference)
def encrypt(data,password):
 keys=[0x12345678,0x23456789,0x34567890]
 def update(byte):
  keys[0]=(keys[0]>>8)^reference.TABLE[(keys[0]^byte)&255];keys[1]=((keys[1]+(keys[0]&255))*134775813+1)&0xffffffff;keys[2]=(keys[2]>>8)^reference.TABLE[(keys[2]^(keys[1]>>24))&255]
 for byte in password:update(byte)
 result=bytearray()
 for byte in data:
  word=(keys[2]&65535)|2;result.append(byte^(((word*(word^1))>>8)&255));update(byte)
 return bytes(result)
def archive(entries,password):
 parts=[bytes.fromhex('414c5a010a000000')]
 for entry in entries:
  name=entry['name'].encode('cp949');width=entry.get('width',4);time=entry.get('time',0x56a51234);date=entry.get('date',True);encrypted=entry.get('encrypted',True);encoded=entry['encoded'];crc=int(entry['crc32'],16)
  header=struct.pack('<IHBIBB',0x015a4c42,len(name),32,time,width*16+int(date)*8+int(encrypted),0)
  if width:header+=struct.pack('<BBI',entry['method'],0,crc)+len(encoded).to_bytes(width,'little')+entry['bytes'].to_bytes(width,'little')
  if encrypted:encoded=encrypt(bytes(range(1,12))+bytes([(time>>8 if date else crc>>24)&255])+encoded,password.encode('cp949'))
  parts.extend([header,name,encoded])
 return b''.join(parts)+bytes.fromhex('434c5a010000000000000000434c5a02')
def main():
 original=[{**entry,'encoded':encoded} for entry,encoded,_,_ in reference.members((ROOT.parent/'alz/encrypted.alz').read_bytes(),b'secret')]
 def named(entry,name,**options):return {**entry,'name':name,**options}
 empty={'name':'empty.txt','bytes':0,'crc32':'00000000','method':0,'encoded':b''}
 cases=[('date-all.alz',[named(entry,f'date-{i}.bin') for i,entry in enumerate(original)],'secret'),
  ('mixed.alz',[named(original[0],'legacy.bin',date=False),named(original[1],'date-dlz.bin'),named(original[2],'legacy-deflate.bin',date=False),named(original[0],'plain-date.bin',encrypted=False)],'secret'),
  ('empty-crc.alz',[{**empty,'width':0,'date':False}],'secret'),('empty-date.alz',[{**empty,'width':0}],'secret'),
  ('empty-deflate.alz',[{**empty,'method':2,'encoded':zlib.compress(b'',wbits=-15)}],'secret'),
  ('empty-bzh.alz',[{**empty,'method':1,'encoded':bz2.compress(b'')}],'secret'),('date-korean.alz',[named(original[0],'korean.txt')],'비밀')]
 expected={item['name']:item for item in json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))['generated']}
 for name,entries,password in cases:
  data=archive(entries,password);assert len(data)==expected[name]['bytes'] and hashlib.sha256(data).hexdigest()==expected[name]['sha256'],name;(ROOT/name).write_bytes(data)
 print('Reproduced seven ALZ variants with unchanged pinned hashes.')
if __name__=='__main__':main()
