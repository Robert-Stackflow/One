"""Create a deterministic nonempty 100,000-file ZIP64 without source-file trees."""
from pathlib import Path
import argparse,hashlib,json,time,zipfile
parser=argparse.ArgumentParser();parser.add_argument('--root',default='work/current/archive-small-files-perf');parser.add_argument('--count',type=int,default=100000);args=parser.parse_args();assert 1<=args.count<=100000
root=Path(args.root).resolve();root.mkdir(parents=True,exist_ok=True);target=root/'small-files.zip';metadata=target.with_suffix('.json')
if target.is_file() and metadata.is_file():
 report=json.loads(metadata.read_text(encoding='utf-8'));assert report['count']==args.count and target.stat().st_size==report['bytes'];print(f"Reused {report['count']} nonempty files, {report['bytes']} archive bytes.")
else:
 started=time.perf_counter()
 with zipfile.ZipFile(target,'w',allowZip64=True,compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
  for index in range(args.count):
   name=f'小文件/group-{index%1000:04d}/item-{index:06d}.bin';info=zipfile.ZipInfo(name,(2020,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100600<<16
   archive.writestr(info,hashlib.sha256(f'One small file {index}'.encode()).digest()*8)
 with target.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
 report={'count':args.count,'bytes':target.stat().st_size,'sha256':digest,'uncompressedBytes':args.count*256,'payloadBytes':256,'payload':'SHA256(UTF-8("One small file "+decimal index)) repeated eight times; original generated data, not representative compression entropy','paths':'小文件/group-{index % 1000:04d}/item-{index:06d}.bin','format':'Python stdlib ZIP Deflate, UTF-8 names, ZIP64 entry count when needed, no explicit directory entries','generatedSeconds':time.perf_counter()-started};metadata.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(f"Generated {args.count} nonempty files; {report['bytes']} ZIP bytes; {args.count*256} output bytes.")
