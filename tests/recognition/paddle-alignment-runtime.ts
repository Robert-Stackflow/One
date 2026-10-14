import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {LocalModelStore} from '../../src/main/local-model-store';
import {paddleOCRPresets} from '../../src/main/local-model-catalog';
import {acquirePaddleModel} from '../../src/main/recognition/paddle-models';
import {PaddleOCRPipeline} from '../../src/main/recognition/paddle-pipeline';
import {paddleDetConfig} from '../../src/main/recognition/paddle-detector';
import {paddleRecConfig} from '../../src/main/recognition/paddle-recognizer';
import {paddleOrientationConfig} from '../../src/main/recognition/paddle-orientation';
import {readingTokens} from '../../src/shared/recognition/text-document';
import {insideTextQuad} from '../../src/shared/recognition/text-geometry';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
function distance(a:string,b:string){const aa=[...a],bb=[...b];let row=Array.from({length:bb.length+1},(_,i)=>i);for(let i=0;i<aa.length;i++){const next=[i+1];for(let j=0;j<bb.length;j++)next.push(Math.min(next[j]+1,row[j+1]+1,row[j]+Number(aa[i]!==bb[j])));row=next;}return row[bb.length];}
function pairIndices(a:readonly string[],b:readonly string[]){
 const d=Array.from({length:a.length+1},(_,i)=>Array.from({length:b.length+1},(_,j)=>i?j?0:i:j));
 for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+Number(a[i-1]!==b[j-1]));
 const pairs:[number,number][]=[];let i=a.length,j=b.length;
 while(i||j){if(i&&j&&d[i][j]===d[i-1][j-1]+Number(a[i-1]!==b[j-1])){if(a[i-1]===b[j-1])pairs.push([i-1,j-1]);i--;j--;}
  else if(i&&d[i][j]===d[i-1][j]+1)i--;else j--;}
 return pairs;
}
async function main(){
 const fixture=resolve('work/current/capture-reconstruction'),root=process.env.ONE_CTC_TEST_ROOT!,corpus=JSON.parse(await readFile(join(root,'cases.json'),'utf8'));
 const backend=process.argv.includes('--dml')?'dml':'cpu',deviceAt=process.argv.indexOf('--device'),deviceId=deviceAt<0?0:Number(process.argv[deviceAt+1]);
 if(!Number.isSafeInteger(deviceId)||deviceId<0||deviceId>31)throw Error('Invalid device ordinal');
 const store=new LocalModelStore(join(root,'library'),async()=>{throw Error('Probe must stay offline');}),reports:any[]=[];
 const suffixes:Record<string,string>={detection:'det.onnx',detectionConfig:'det.yml',recognition:'rec.onnx',recognitionConfig:'rec.yml'};
 for(const preset of paddleOCRPresets){
  await store.install(preset,new AbortController().signal,()=>{},Object.fromEntries(preset.artifacts.map(file=>[file.role,join(fixture,file.role==='orientation'?'pp-textline-orientation.onnx':file.role==='orientationConfig'?'pp-textline-orientation.yml':`pp-ocrv6-${preset.size}-${suffixes[file.role]}`)])));
  const lease=await acquirePaddleModel(store,preset.id),m=lease.model;
  const pipeline=await PaddleOCRPipeline.create({det:m.detection.path,rec:m.recognition.path,
   detection:paddleDetConfig(await readFile(m.detectionConfig.path,'utf8')),recognition:paddleRecConfig(await readFile(m.recognitionConfig.path,'utf8')),revision:m.revision,
   ...(m.orientation?{orientation:await readFile(m.orientation.path),orientationConfig:paddleOrientationConfig(await readFile(m.orientationConfig!.path,'utf8'))}:{})},backend,deviceId);
  try{for(const item of corpus.cases){
   const png=await readFile(join(root,item.id+'.png'));
   try{const result=await pipeline.run(png,'chi_sim+eng',undefined,true),tokens=readingTokens(result.document!),approx=tokens.filter(token=>token.geometry==='ctc');
    let correct=0;const clicks=[],predicted=tokens.flatMap(token=>[...token.text].filter(text=>text.trim()).map(text=>({text,token})));
    const pairs=new Map(pairIndices(item.chars.map((c:any)=>c.text),predicted.map(value=>value.text)));
    for(const [charIndex,char] of item.chars.entries()){const point={x:char.quad.reduce((s:any,p:any)=>s+p.x,0)/4,y:char.quad.reduce((s:any,p:any)=>s+p.y,0)/4};
     const token=approx.find(token=>insideTextQuad(point,token.quad)),paired=predicted[pairs.get(charIndex)!]?.token;
     const hit=paired?.geometry==='ctc'&&insideTextQuad(point,paired.quad);
     if(hit)correct++;clicks.push({expected:char.text,actual:token?.text,point,hit,paired:paired?.text});
    }
    const expected=item.text.replace(/\s/g,''),actual=result.text.replace(/\s/g,'');
    const report={model:preset.size,backend,deviceId,case:item.id,normalization:'remove-whitespace',cer:distance(expected,actual)/[...expected].length,centerHit:pairs.size?correct/pairs.size:0,matchedCoverage:pairs.size/item.chars.length,ctcTokens:approx.length,words:result.words.length,text:result.text,clicks,document:result.document};
    assert.equal(result.document!.source.sha256,item.sha256);assert.equal(item.sha256,createHash('sha256').update(png).digest('hex'));
    const supported=item.rotation!==180||preset.artifacts.some(file=>file.role==='orientation');
    if(supported){assert.ok(report.matchedCoverage>=corpus.gate.matchedCoverage,`${preset.size}/${item.id}: recognized coverage ${report.matchedCoverage}`);
      assert.ok(report.centerHit>=corpus.gate.matchedCenterHit,`${preset.size}/${item.id}: matched glyph center hit ${report.centerHit}`);}
    assert.ok(result.document!.blocks.flatMap(block=>block.lines.flatMap(line=>line.tokens)).every(token=>token.geometry==='ctc'||token.geometry==='word'));
    reports.push({...report,supported});
   }finally{png.fill(0);}
  }}finally{await pipeline.close();lease.release();}
 }
 await writeFile(join(root,`results-${backend}${backend==='dml'?'-'+deviceId:''}.json`),JSON.stringify(reports,null,2));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
