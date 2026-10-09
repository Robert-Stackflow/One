"""Windows-only, stdlib-only million-entry native browser benchmark (no extraction)."""
from pathlib import Path
import argparse,ctypes,ctypes.wintypes as wt,hashlib,json,math,os,platform,re,shutil,struct,subprocess,threading,time

class Memory(ctypes.Structure):
 _fields_=[('cb',wt.DWORD),('faults',wt.DWORD)]+[(key,ctypes.c_size_t) for key in ('peakWorking','working','peakPagedPool','pagedPool','peakNonpagedPool','nonpagedPool','commit','peakCommit','private')]

def dataset(root,count,nested):
 target=root/('nested.zip' if nested else 'root.zip');metadata=target.with_suffix('.json')
 if target.is_file() and metadata.is_file():
  saved=json.loads(metadata.read_text());assert saved['entries']==count and target.stat().st_size==saved['bytes'];return target,saved
 assert shutil.disk_usage(root).free>1024**3
 step=count-17
 while math.gcd(step,count)!=1:step-=1
 central=root/('nested.central' if nested else 'root.central');start=time.perf_counter();local=[];directory=[];offset=size=0
 with target.open('wb') as out,central.open('wb') as cd:
  for index in range(count):
   value=index*step%count;name=(f'共享/branch-{value%1000:04d}/' if nested else '')+f'entry-{value:07d}.txt';raw=name.encode();flags=0x800
   header=struct.pack('<IHHHHHIIIHH',0x04034b50,20,flags,0,0,0x5021,0,0,0,len(raw),0)+raw
   item=struct.pack('<IHHHHHHIIIHHHHHII',0x02014b50,20,20,flags,0,0,0x5021,0,0,0,len(raw),0,0,0,0,0,offset)+raw
   local.append(header);directory.append(item);offset+=len(header);size+=len(item)
   if len(local)==4096:out.write(b''.join(local));cd.write(b''.join(directory));local.clear();directory.clear()
  out.write(b''.join(local));cd.write(b''.join(directory))
 with target.open('ab') as out,central.open('rb') as cd:
  shutil.copyfileobj(cd,out,1024**2)
  if count>=65535:
   out.write(struct.pack('<IQHHIIQQQQ',0x06064b50,44,45,45,0,0,count,count,size,offset))
   out.write(struct.pack('<IIQI',0x07064b50,0,offset+size,1))
  out.write(struct.pack('<IHHHHIIH',0x06054b50,0,0,min(count,65535),min(count,65535),size,offset,0))
 central.unlink()
 saved={'entries':count,'bytes':target.stat().st_size,'generator':'Original streaming ZIP/ZIP64, empty stored regular files, permuted insertion order; no extraction workload','nested':nested,'step':step,'generatedSeconds':time.perf_counter()-start}
 metadata.write_text(json.dumps(saved,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');return target,saved

def run(helper,source,query,offset,limit,log,manifest):
 u32=lambda value:struct.pack('<I',value)
 def text(value):raw=value.encode();return u32(len(raw))+raw
 packet=text('')+text(query['directory'])+text(query['search'])+u32(int(query['flat']));started=time.perf_counter();first=metaTime=None;records=[];errors=[]
 env={**os.environ,'ONE_TEST_MODE':'1'};process=subprocess.Popen([str(helper),'browse',str(source),str(offset),str(limit),'0'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env)
 def read():
  nonlocal first,metaTime
  with log.open('wb') as output:
   for line in process.stdout:
    output.write(line)
    try:
     item=json.loads(line);now=time.perf_counter()-started
     if first is None:first=now
     if item.get('type')=='meta' and metaTime is None:metaTime=now
     if item.get('type')!='heartbeat':records.append(item)
    except Exception as error:errors.append(str(error))
 reader=threading.Thread(target=read);reader.start();process.stdin.write(packet);process.stdin.close();peakWorking=peakCommit=peakPrivate=0
 memory=Memory();memory.cb=ctypes.sizeof(memory);info=ctypes.WinDLL('psapi').GetProcessMemoryInfo;info.argtypes=[wt.HANDLE,ctypes.POINTER(Memory),wt.DWORD];info.restype=wt.BOOL
 while True:
  if info(wt.HANDLE(int(process._handle)),ctypes.byref(memory),memory.cb):peakWorking=max(peakWorking,memory.peakWorking);peakCommit=max(peakCommit,memory.peakCommit);peakPrivate=max(peakPrivate,memory.private)
  if process.poll() is not None:break
  if time.perf_counter()-started>180:process.kill();raise TimeoutError('Native browser exceeded 180 seconds')
  time.sleep(.01)
 reader.join();stderr=process.stderr.read();assert process.returncode==0,(process.returncode,stderr[:1000],records[-2:]);assert not errors,errors
 metadata=next(item for item in records if item.get('type')=='meta');entries=[item for item in records if item.get('type')=='entry'];assert len(entries)==min(limit,max(0,metadata['matched']-offset));assert peakWorking>0 and peakCommit>0
 elapsed=time.perf_counter()-started;assert metadata['total']==manifest['entries'];inverse=pow(manifest['step'],-1,manifest['entries']) if manifest['entries']>1 else 0
 for entry in entries:
  if entry['directory']:assert entry['index']==-1 and entry['implicit'];continue
  value=int(entry['name'].rsplit('entry-',1)[1].split('.')[0]);assert entry['index']==value*inverse%manifest['entries']
  assert entry['name']==(f'共享/branch-{value%1000:04d}/' if manifest['nested'] else '')+f'entry-{value:07d}.txt'
 return {'seconds':elapsed,'firstFeedbackSeconds':first,'firstMetaSeconds':metaTime,'peakWorkingBytes':peakWorking,'peakCommitBytes':peakCommit,'sampledPeakPrivateBytes':peakPrivate,'meta':metadata,'resources':next((item for item in records if item.get('type')=='resources'),None),'returned':len(entries),'originalIndexCheck':True,'firstEntries':[{'index':item['index'],'name':item['name']} for item in entries[:3]],'entryDigest':hashlib.sha256(json.dumps(entries,sort_keys=True,ensure_ascii=False).encode()).hexdigest()}

def main():
 assert os.name=='nt','Windows process memory APIs required'
 parser=argparse.ArgumentParser();parser.add_argument('--helper',default='dist/native/One.Archive.exe');parser.add_argument('--root',default='work/current/archive-browser-perf');parser.add_argument('--label',required=True);parser.add_argument('--entries',type=int,default=1000000);parser.add_argument('--repeat',type=int,default=2);parser.add_argument('--compare');args=parser.parse_args();assert 1<=args.entries<=1000000 and 1<=args.repeat<=5
 assert re.fullmatch(r'[A-Za-z0-9_-]{1,40}',args.label),'Use a simple label without path separators'
 root=Path(args.root).resolve();root.mkdir(parents=True,exist_ok=True);helper=Path(args.helper).resolve();cases=[];datasets=[]
 for nested in (False,True):
  source,manifest=dataset(root,args.entries,nested);datasets.append(manifest)
  queries=[('nested-root' if nested else 'root',{'directory':'','search':'','flat':False},0),('nested-flat' if nested else 'flat',{'directory':'','search':'','flat':True},0)]
  if nested:queries.append(('nested-navigation',{'directory':'共享/branch-0007/','search':'','flat':False},0))
  else:queries.extend([('last-page',{'directory':'','search':'','flat':True},max(0,args.entries-200)),('search',{'directory':'','search':'entry-0999' if args.entries==1000000 else 'entry-000','flat':False},0)])
  for name,query,offset in queries:
   for repeat in range(args.repeat):
    result=run(helper,source,query,offset,200,root/f'{args.label}-{name}-{repeat}.jsonl',manifest);cases.append({'case':name,'repeat':repeat,'query':query,'offset':offset,**result});print(f"{name} #{repeat}: {result['seconds']:.3f}s, meta {result['firstMetaSeconds']:.3f}s, peak working {result['peakWorkingBytes']/1024**2:.1f} MiB, commit {result['peakCommitBytes']/1024**2:.1f} MiB",flush=True)
 report={'label':args.label,'helperSha256':hashlib.sha256(helper.read_bytes()).hexdigest(),'machine':{'platform':platform.platform(),'processor':platform.processor(),'logicalCpus':os.cpu_count(),'drive':root.drive,'permissions':'Current developer process; no elevation requested','cache':'Fresh helper per request; first observed and repeated process; OS file cache not purged'},'datasets':datasets,'cases':cases}
 if args.compare:
  before=json.loads(Path(args.compare).read_text(encoding='utf-8'));assert len(before['cases'])==len(cases)
  for old,new in zip(before['cases'],cases):assert (old['case'],old['repeat'],old['entryDigest'],old['meta'])==(new['case'],new['repeat'],new['entryDigest'],new['meta']),(old['case'],'output changed')
  report['comparison']=[{'case':new['case'],'repeat':new['repeat'],'timeRatio':new['seconds']/old['seconds'],'workingRatio':new['peakWorkingBytes']/old['peakWorkingBytes'],'commitRatio':new['peakCommitBytes']/old['peakCommitBytes']} for old,new in zip(before['cases'],cases)]
 target=root/f'{args.label}.json';target.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(f'Saved {len(cases)} measured requests: {target}')

if __name__=='__main__':main()
