import {readFile,writeFile,stat,lstat} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {ocrQualityScore,ocrKeyRegionScores,aggregateOCRQuality,type QualityRecord} from './ocr-quality-metrics';
const option=(name:string,fallback:string)=>{const index=process.argv.indexOf(name);return index<0?fallback:process.argv[index+1]||'';};
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
async function main(){
  const manifestFile=resolve(option('--manifest','work/current/capture-reconstruction/ocr-quality/corpus/manifest.json'));
  const info=await lstat(manifestFile);if(!info.isFile()||info.isSymbolicLink()||info.size>2*1024**2)throw Error('Quality manifest is invalid');
  const bytes=await readFile(manifestFile),manifest=JSON.parse(bytes.toString('utf8'));
  if(manifest.schema!==1||!Array.isArray(manifest.samples)||manifest.samples.length>500||bytes.length>2*1024**2)throw Error('Quality manifest is invalid');
  const paths=option('--runs','').split(',').filter(Boolean).map(value=>resolve(value));
  if(!paths.length||paths.length>8)throw Error('--runs requires 1–8 existing run directories');
  const models=new Map<string,{directory:string;fingerprint:string;settings?:unknown;provenance?:unknown}>();
  // Later explicitly supplied runs replace complete model runs, never individual failed cases.
  for(const directory of paths){const report=JSON.parse(await readFile(join(directory,'summary.json'),'utf8'));if(report.schema!==1||typeof report.fingerprint!=='string'||!report.models)throw Error('Run summary is invalid');
    for(const id of Object.keys(report.models)){if(!/^[a-z0-9-]{1,80}$/.test(id))throw Error('Model identity is invalid');models.set(id,{directory,fingerprint:report.fingerprint,settings:report.settings,provenance:report.provenance});}}
  const summaries:Record<string,unknown>={};
  for(const [model,run] of models){
    const records:QualityRecord[]=[];
    for(const sample of manifest.samples){
      if(!/^[a-z0-9_-]{1,120}$/.test(sample.id)||!/^[a-f0-9]{64}$/.test(sample.sha256))throw Error('Sample identity is invalid');
      const file=join(run.directory,model,sample.id+'.json');if((await stat(file)).size>16*1024**2)throw Error('Prediction record is too large');
      const row=JSON.parse(await readFile(file,'utf8'));
      if(row.model!==model||row.sampleHash!==sample.sha256||row.fingerprint!==run.fingerprint||!['ok','failed'].includes(row.status))throw Error('Prediction provenance differs from the source image/run');
      records.push({...row,tags:sample.tags,score:ocrQualityScore(sample.expected,row.status==='ok'?row.result.text:''),keyRegions:ocrKeyRegionScores(row.result,sample.keyRegions||[])});
    }
    summaries[model]={sourceRun:run.directory,sourceFingerprint:run.fingerprint,settings:run.settings,provenance:run.provenance,...aggregateOCRQuality(records),
      primaryZhEn:aggregateOCRQuality(records.filter(row=>row.tags.some(tag=>['zh','en','zh-en'].includes(tag)))).total,
      reviewedUI:aggregateOCRQuality(records.filter(row=>row.tags.includes('zh-en'))).total};
    console.log(JSON.stringify({model,overallCER:(summaries[model] as any).total.cer,primaryZhEnCER:(summaries[model] as any).primaryZhEn.cer,failed:(summaries[model] as any).total.failed}));
  }
  const output=resolve(option('--output',join(dirname(paths.at(-1)!),'comparison-'+hash(bytes).slice(0,12)+'.json')));
  await writeFile(output,JSON.stringify({schema:1,manifestSHA256:hash(bytes),manifestSource:manifest.source,sourceRuns:paths,
    acceptanceReady:false,defaultModelChanged:false,annotationReview:manifest.samples.reduce((counts:Record<string,number>,sample:any)=>{const key=sample.annotation?.reviewed?'visually-reviewed':'upstream-only';counts[key]=(counts[key]||0)+1;return counts;},{}),
    caveats:['Fixed upstream windows are not a representative screen-capture acceptance set.','Japanese is diagnostic: application input is chi_sim+eng and Tesseract has no Japanese pack.','Five key regions from two screenshots are selection proxies, not detector precision/recall.','RSS scopes differ between Tesseract process and isolated Paddle worker.'],models:summaries},null,2));
  console.log('Re-scored without inference: '+output);
}
void main().catch(error=>{console.error(error instanceof Error?error.stack:error);process.exitCode=1;});
