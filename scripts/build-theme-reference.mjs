import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const source='https://gml.noaa.gov/grad/solcalc/main.js',file='work/current/theme-schedule/reference/noaa-main.js';
await mkdir('work/current/theme-schedule/reference',{recursive:true});
let script=process.argv.includes('--refresh')?null:await readFile(file,'utf8').catch(()=>null);
if(!script){const response=await fetch(source,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error(`NOAA reference HTTP ${response.status}`);script=await response.text();if(script.length>256*1024)throw Error('NOAA reference unexpectedly large');await writeFile(file,script);}
const oracle={};vm.createContext(oracle);vm.runInContext(script,oracle,{timeout:2000});
const dates=['2024-02-29','2024-03-20','2024-06-21','2024-09-22','2024-12-21','2026-03-20','2026-06-21','2026-09-22','2026-12-21'];
const positions=[[39.9,116.4],[40.7,-74],[-33.9,151.2],[64.1,-21.9],[1.35,103.8],[-.18,-78.5],[0,-180],[0,180]];
const cases=dates.flatMap(date=>positions.map(([latitude,longitude])=>{
 const epoch=Date.parse(date+'T00:00:00Z'),jd=epoch/86400000+2440587.5;
 const event=rise=>{const first=oracle.calcSunriseSetUTC(rise,jd,latitude,longitude),minutes=oracle.calcSunriseSetUTC(rise,jd+first/1440,latitude,longitude);return Number.isFinite(minutes)?Math.round(epoch+minutes*60000):null;};
 return {date,latitude,longitude,sunrise:event(true),sunset:event(false)};
}));
await mkdir('tests/fixtures',{recursive:true});await writeFile('tests/fixtures/theme-solar-reference.json',JSON.stringify({source,sha256:createHash('sha256').update(script).digest('hex'),method:'NOAA Julian-century calculator, two-pass UTC sunrise/sunset; government reference, not product code',cases},null,2)+'\n');
console.log(JSON.stringify({referenceCases:cases.length,source}));
