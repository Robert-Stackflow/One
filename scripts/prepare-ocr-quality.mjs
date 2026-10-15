import {readFile,writeFile,mkdir,rename,lstat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';

const root=resolve('work/current/capture-reconstruction/ocr-quality/corpus');
const dataset='wulipc/CC-OCR',revision='c64517e92179991d509776064174776700cdd5a2';
// Fixed contiguous windows from six upstream strata, not a random/representative sample.
const groups=[
  ['FUNSD','multi_scene_ocr',100,['document','en']],
  ['zh_doc','multi_scene_ocr',200,['document','zh']],
  ['ugc_laion','multi_scene_ocr',2200,['ugc']],
  ['zh_dense','multi_scene_ocr',2600,['dense','zh']],
  ['zh_vertical','multi_scene_ocr',2650,['vertical','zh']],
  ['Japanese','multi_lan_ocr',600,['japanese','ja']],
];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function json(url){
  const response=await fetch(url,{signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error(`Dataset request failed: ${response.status}`);
  const parts=[];let bytes=0;
  for await(const part of response.body){bytes+=part.length;if(bytes>24*1024**2){await response.body.cancel().catch(()=>{});throw Error('Dataset page exceeds 24 MiB');}parts.push(part);}
  return {value:JSON.parse(Buffer.concat(parts).toString('utf8')),revision:response.headers.get('x-revision')};
}
async function existing(path){const stat=await lstat(path).catch(error=>{if(error.code!=='ENOENT')throw error;});if(stat?.isSymbolicLink()||stat&&!stat.isFile())throw Error('Corpus file is not a regular file');return stat;}
await mkdir(join(root,'images'),{recursive:true});
if(!process.argv.includes('--download')){
  const manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
  for(const sample of manifest.samples){if(!/^[a-f0-9]{64}\.png$/.test(sample.image))throw Error('Invalid corpus image');const path=join(root,'images',sample.image);await existing(path);if(sha(await readFile(path))!==sample.sha256)throw Error('Corpus image hash differs');}
  console.log(JSON.stringify({verified:manifest.samples.length,network:false,manifest:join(root,'manifest.json')}));
}else{
  const manifest={schema:1,source:{dataset,revision,url:`https://huggingface.co/datasets/${dataset}/tree/${revision}`,sampling:'first 10 rows in each fixed upstream stratum',annotation:'upstream text; not manually reviewed locally',licenseNote:'Dataset card says MIT; upstream README explicitly licenses source code. Images remain local and are not redistributed.'},samples:[]};
  const seen=new Set();
  for(const [name,config,offset,tags] of groups){
    const query=new URLSearchParams({dataset,config,split:'test',offset:String(offset),length:'10'}),response=await json('https://datasets-server.huggingface.co/rows?'+query);
    if(response.revision!==revision)throw Error('Viewer revision differs from the pinned source; do not mix dataset versions');
    const rows=response.value.rows;if(!Array.isArray(rows)||rows.length!==10)throw Error('Incomplete dataset page');
    for(const entry of rows){
      const row=entry.row;
      if(row.split!==name||entry.truncated_cells?.length||typeof row.answer!=='string'||!row.answer.trim()||row.answer.length>20000||typeof row.image!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(row.image)||row.image.length>12*1024**2)throw Error('Dataset stratum, annotation or image is incomplete');
      const original=Buffer.from(row.image,'base64'),parentSha256=sha(original);
      if(seen.has(parentSha256))throw Error('Duplicate source image; cannot count it as an independent sample');seen.add(parentSha256);
      const {data,info}=await sharp(original,{limitInputPixels:40_000_000}).rotate().png().toBuffer({resolveWithObject:true});
      if(info.width>16384||info.height>16384)throw Error('Source image exceeds application capacity');
      const hash=sha(data),image=hash+'.png',path=join(root,'images',image);
      if(await existing(path)){if(sha(await readFile(path))!==hash)throw Error('Existing corpus image differs');}else await writeFile(path,data,{flag:'wx'});
      manifest.samples.push({id:`ccocr-${name.toLowerCase()}-${entry.row_idx}`,image,sha256:hash,parentSha256,width:info.width,height:info.height,tags,expected:row.answer,
        annotation:{kind:'upstream-text',reviewed:false,sourceImage:row.image_name},provenance:{dataset,revision,config,split:'test',row:entry.row_idx,upstreamSplit:name}});
    }
    console.log(name+': 10 unique source images cached');
  }
  const temporary=join(root,'.manifest-'+randomUUID()+'.tmp');await writeFile(temporary,JSON.stringify(manifest,null,2));await rename(temporary,join(root,'manifest.json'));
  console.log(JSON.stringify({samples:manifest.samples.length,annotation:'upstream-text',acceptanceReady:false,root}));
}
