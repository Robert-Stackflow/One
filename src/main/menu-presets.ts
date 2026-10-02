import {readdir} from 'node:fs/promises';
import {isAbsolute,join,basename} from 'node:path';
import {hereCatalog,registeredPreset,type MenuPreset} from '../shared/menu-presets';
import {registeredHereApplications} from './open-with';
import {programPath,availableProgram} from './program-path';

/** Read on demand; one bounded snapshot, no background polling or disk index. */
export class MenuPresets {
 private value:MenuPreset[]=[];private updated=0;private pending?:Promise<MenuPreset[]>;
 constructor(private programs:()=>string[],private env:NodeJS.ProcessEnv=process.env){}
 read(){if(this.pending)return this.pending;if(Date.now()-this.updated<30000)return Promise.resolve(this.value);this.pending=this.discover().then(value=>{this.value=value;this.updated=Date.now();return value;}).finally(()=>{this.pending=undefined;});return this.pending;}
 private async discover(){
  const registered=await registeredHereApplications().catch(()=>[]),system=registered.map(registeredPreset).filter((p):p is MenuPreset=>!!p),programs=this.programs();
  const roots=new Set([this.env.ProgramFiles,this.env['ProgramFiles(x86)'],this.env.LOCALAPPDATA&&join(this.env.LOCALAPPDATA,'Programs')].filter((p):p is string=>!!p&&isAbsolute(p)));
  for(const file of [...programs,...(this.env.PATH||this.env.Path||'').split(';')]){const root=/^(.+[\\/]Program Files(?: \(x86\))?)(?:[\\/]|$)/i.exec(file)?.[1];if(root)roots.add(root);}
  const jetbrains:string[]=[];for(const root of roots){const base=join(root,'JetBrains');const entries=await readdir(base,{withFileTypes:true}).catch(()=>[]);for(const entry of entries.slice(0,64))if(entry.isDirectory())jetbrains.push(join(base,entry.name,'bin'));}
  const found=await Promise.all(hereCatalog.map(async spec=>{
   const matching=system.find(p=>spec.files.some(f=>basename(p.target).toLowerCase()===f.toLowerCase()));
   const candidates=[...(matching?[matching.target]:[]),...programs.filter(p=>spec.files.some(f=>basename(p).toLowerCase()===f.toLowerCase())),...await Promise.all(spec.files.map(file=>programPath(file,this.env).catch(()=>''))),...[...roots].flatMap(root=>(spec.paths||[]).map(p=>join(root,p))),...jetbrains.flatMap(folder=>spec.files.map(file=>join(folder,file)))].filter(Boolean);
   for(const target of [...new Set(candidates)])if(await availableProgram(target,this.env))return {id:spec.id,label:'在此打开 '+spec.name,kind:'command' as const,target,args:matching?.args||[...spec.args],cwd:'{folder}',program:target,available:true,source:matching?'system' as const:'preset' as const,...(spec.console?{console:true}:{})};
   return {id:spec.id,label:'在此打开 '+spec.name,kind:'command' as const,target:'',args:[...spec.args],cwd:'{folder}',available:false,source:'preset' as const,...(spec.console?{console:true}:{})};
  }));
  const result:MenuPreset[]=[{id:'powershell',label:'在此打开 PowerShell',kind:'builtin',target:'terminal',args:[],cwd:'',available:true,source:'preset',program:await programPath('powershell.exe',this.env).catch(()=>undefined)},...found];
  const files=new Set(result.filter(p=>p.available&&p.program).map(p=>p.program!.toLowerCase()));
  for(const preset of system){if(files.has(preset.target.toLowerCase())||basename(preset.target).toLowerCase()==='powershell.exe')continue;const target=await programPath(preset.target,this.env).catch(()=>undefined);if(target&&!files.has(target.toLowerCase())&&await availableProgram(target,this.env)){files.add(target.toLowerCase());result.push({...preset,target,program:target});}}
  return result.sort((a,b)=>Number(b.available)-Number(a.available));
 }
}
