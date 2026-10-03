import {win32} from 'node:path';
import type {SearchSettings} from '../shared/search';
import {indexPriorityKey,indexedUnder,validateIndexPriorities,type IndexPriorityRule} from '../shared/search-priority';

/** Expand machine-specific defaults once, without filesystem scans or changing index scope. */
export function defaultIndexPriorities(environment:NodeJS.ProcessEnv):IndexPriorityRule[]{
 const env=new Map(Object.entries(environment).filter((entry):entry is [string,string]=>typeof entry[1]==='string').map(([key,value])=>[key.toLowerCase(),value]));
 const templates:[string,IndexPriorityRule['priority']][]=[
  ['%USERPROFILE%\\AppData\\Roaming\\Microsoft\\Internet Explorer','normal'],
  ['%USERPROFILE%\\AppData\\Roaming\\Microsoft\\Windows','normal'],
  ['%ProgramData%\\Microsoft\\Windows\\Start Menu','normal'],
  ['%SystemDrive%\\Windows.old','uncommon'],
  ['%SystemDrive%\\$WINDOWS.~BT','uncommon'],
  ['%SystemDrive%\\$Windows.~WS','uncommon'],
  ['%ProgramData%','uncommon'],['%SystemRoot%','uncommon'],
  ['%USERPROFILE%\\AppData','uncommon'],['%ProgramW6432%','uncommon'],['%ProgramFiles(x86)%','uncommon']
 ];
 const rules:IndexPriorityRule[]=[];
 for(const [template,priority] of templates){
  const expanded=template.replace(/%([^%]+)%/g,(token,name)=>env.get(name.toLowerCase())||token);
  if(expanded.includes('%')||!win32.isAbsolute(expanded))continue;
  rules.push({path:win32.normalize(expanded),priority});
 }
 return validateIndexPriorities(rules);
}

export function migrateSearchDefaults(settings:SearchSettings,environment:NodeJS.ProcessEnv):SearchSettings{
 if(settings.priorityDefaultsVersion===1)return settings;
 const priorities=[...settings.priorities],keys=new Set(priorities.map(rule=>indexPriorityKey(rule.path)));
 for(const rule of defaultIndexPriorities(environment)){
  // User rules, including explicit normal roots and excluded ancestors, take precedence.
  if(priorities.length>=64||keys.has(indexPriorityKey(rule.path))||settings.roots.some(path=>indexPriorityKey(path)===indexPriorityKey(rule.path))||settings.excluded.some(path=>indexedUnder(rule.path,path)))continue;
  priorities.push(rule);keys.add(indexPriorityKey(rule.path));
 }
 return {...settings,priorities,priorityDefaultsVersion:1};
}
