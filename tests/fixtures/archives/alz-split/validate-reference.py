"""Independent standard-library framing/Store/Deflate/CRC/hash oracle.
No One native code or Rust decoder is imported. Run from any directory.
"""
from pathlib import Path
import hashlib,json,struct,zlib

folder=Path(__file__).resolve().parent
manifest=json.loads((folder/'manifest.json').read_text(encoding='utf-8'))
for file in manifest['files']:
    data=(folder/file['name']).read_bytes()
    assert len(data)==file['bytes'] and hashlib.sha256(data).hexdigest()==file['sha256']
for archive in manifest['sets']:
    joined=bytearray()
    for ordinal,name in enumerate(archive['volumes']):
        data=(folder/name).read_bytes()
        assert struct.unpack('<IHH',data[:8])==(0x015a4c41,10,ordinal)
        assert data[-16:-4]==bytes.fromhex('434c5a010000000000000000')
        assert data[-4:]==bytes.fromhex('434c5a03' if ordinal+1<len(archive['volumes']) else '434c5a02')
        joined+=data[:8] if ordinal==0 else b''
        joined+=data[8:-16]
        joined+=data[-16:] if ordinal+1==len(archive['volumes']) else b''
    position=8;actual=[]
    while position<len(joined)-16:
        signature,n,attributes,time,flags,reserved=struct.unpack_from('<IHBIBB',joined,position);position+=13
        assert signature==0x015a4c42 and reserved==0 and not flags&15
        width=flags>>4;method=crc=packed=size=0
        if width:
            assert width in (1,2,4,8)
            method,unused,crc=struct.unpack_from('<BBI',joined,position);position+=6;assert unused==0
            packed=int.from_bytes(joined[position:position+width],'little');position+=width
            size=int.from_bytes(joined[position:position+width],'little');position+=width
        name=bytes(joined[position:position+n]).decode('cp949').replace('\\','/');position+=n
        encoded=bytes(joined[position:position+packed]);position+=packed
        assert method in (0,2) and size<=64*1024*1024
        if method==0:plain=encoded
        else:
            decoder=zlib.decompressobj(-15);plain=decoder.decompress(encoded,size+1)
            assert decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail
        assert len(plain)==size and zlib.crc32(plain)==crc
        actual.append({'name':name,'bytes':size,'packed':packed,'method':method,'crc32':f'{crc:08x}','encrypted':False,'sha256':hashlib.sha256(plain).hexdigest()})
    assert position==len(joined)-16 and actual==archive['expected']
print('Independent ALZ reference passed: 11 pinned volumes, 14 files, framing, exact sizes, CRC32 and SHA256.')
