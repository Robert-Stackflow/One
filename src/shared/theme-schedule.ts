export type ScheduledTheme='light'|'dark';
export interface ThemeSchedulePreferences {
 enabled:boolean;
 source:'fixed'|'sun'|'night-light';
 lightAt:string;
 darkAt:string;
 latitude:number|null;
 longitude:number|null;
 sunriseOffset:number;
 sunsetOffset:number;
 targets:{one:boolean;windowsApps:boolean;windowsSystem:boolean};
 shortcut:string;
}
export interface ThemeTransition {at:number;mode:ScheduledTheme}
export interface ThemeSchedulePlan {
 phase:'off'|'automatic'|'unavailable';
 mode?:ScheduledTheme;
 next?:ThemeTransition;
 token:string;
 detail:string;
}
export interface ThemeScheduleStatus extends Omit<ThemeSchedulePlan,'phase'> {
 phase:ThemeSchedulePlan['phase']|'manual'|'error';
 updated:number;
}
export const defaultThemeSchedule=():ThemeSchedulePreferences=>({enabled:false,source:'fixed',lightAt:'07:00',darkAt:'19:00',latitude:null,longitude:null,sunriseOffset:0,sunsetOffset:0,targets:{one:true,windowsApps:false,windowsSystem:false},shortcut:''});
const validTime=(value:unknown)=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
export function validateThemeSchedule(value:unknown):ThemeSchedulePreferences {
 if(value===undefined)return defaultThemeSchedule();
 const v=value as ThemeSchedulePreferences;
 if(!v||typeof v!=='object'||typeof v.enabled!=='boolean'||!['fixed','sun','night-light'].includes(v.source))throw Error('自动主题设置无效');
 if(!validTime(v.lightAt)||!validTime(v.darkAt)||v.lightAt===v.darkAt)throw Error('浅色和深色切换时间必须有效且不同');
 if(v.latitude!==null&&(typeof v.latitude!=='number'||!Number.isFinite(v.latitude)||Math.abs(v.latitude)>90)||v.longitude!==null&&(typeof v.longitude!=='number'||!Number.isFinite(v.longitude)||Math.abs(v.longitude)>180))throw Error('纬度需在 -90 至 90，经度需在 -180 至 180');
 if((v.latitude===null)!==(v.longitude===null))throw Error('请同时填写经度和纬度');
 if(!Number.isInteger(v.sunriseOffset)||Math.abs(v.sunriseOffset)>180||!Number.isInteger(v.sunsetOffset)||Math.abs(v.sunsetOffset)>180)throw Error('日出和日落偏移需在前后 180 分钟内');
 if(!v.targets||['one','windowsApps','windowsSystem'].some(key=>typeof v.targets[key as keyof typeof v.targets]!=='boolean')||!['one','windowsApps','windowsSystem'].some(key=>v.targets[key as keyof typeof v.targets]))throw Error('请至少选择一个主题应用范围');
 if(typeof v.shortcut!=='string'||v.shortcut.length>100||v.shortcut&&!/^(?:(?:Control|Ctrl|Alt|Shift|Super|Meta|Win)\+)+(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4]))$/i.test(v.shortcut))throw Error('主题切换快捷键格式无效');
 return {enabled:v.enabled,source:v.source,lightAt:v.lightAt,darkAt:v.darkAt,latitude:v.latitude,longitude:v.longitude,sunriseOffset:v.sunriseOffset,sunsetOffset:v.sunsetOffset,targets:{one:v.targets.one,windowsApps:v.targets.windowsApps,windowsSystem:v.targets.windowsSystem},shortcut:v.shortcut};
}

const minute=60000,day=86400000,rad=Math.PI/180;
const dayStart=(date:Date,offset=0)=>new Date(date.getFullYear(),date.getMonth(),date.getDate()+offset);
function fixedEvent(date:Date,time:string,mode:ScheduledTheme):ThemeTransition {
 const [hours,minutes]=time.split(':').map(Number);
 return {at:new Date(date.getFullYear(),date.getMonth(),date.getDate(),hours,minutes).getTime(),mode};
}
function solarTerms(date:number,minutes=720){
 const year=new Date(date).getUTCFullYear(),first=Date.UTC(year,0,1),days=(Date.UTC(year+1,0,1)-first)/day;
 const gamma=2*Math.PI/days*((date-first)/day+(minutes-720)/1440);
 const equation=229.18*(.000075+.001868*Math.cos(gamma)-.032077*Math.sin(gamma)-.014615*Math.cos(2*gamma)-.040849*Math.sin(2*gamma));
 const declination=.006918-.399912*Math.cos(gamma)+.070257*Math.sin(gamma)-.006758*Math.cos(2*gamma)+.000907*Math.sin(2*gamma)-.002697*Math.cos(3*gamma)+.00148*Math.sin(3*gamma);
 return {equation,declination};
}
export interface SolarDay {kind:'normal'|'polar-day'|'polar-night';sunrise?:number;sunset?:number}
/** NOAA fractional-year equations; UTC instants keep offsets and DST independent. */
export function solarDay(year:number,month:number,date:number,latitude:number,longitude:number):SolarDay {
 if(!Number.isInteger(year)||year<1800||year>2300||!Number.isInteger(month)||month<1||month>12||!Number.isInteger(date)||date<1||date>31||!Number.isFinite(latitude)||Math.abs(latitude)>90||!Number.isFinite(longitude)||Math.abs(longitude)>180)throw Error('日出日落计算参数无效');
 const start=Date.UTC(year,month-1,date),check=new Date(start);if(check.getUTCMonth()!==month-1)throw Error('日出日落日期无效');
 const lat=latitude*rad;
 const hourAngle=(declination:number)=>(Math.cos(90.833*rad)-Math.sin(lat)*Math.sin(declination))/(Math.cos(lat)*Math.cos(declination));
 const noon=solarTerms(start),cosHour=hourAngle(noon.declination);
 if(cosHour>1)return {kind:'polar-night'};
 if(cosHour< -1)return {kind:'polar-day'};
 const event=(rise:boolean)=>{
  let utcMinutes=720;
  for(let iteration=0;iteration<3;iteration++){
   const terms=solarTerms(start,utcMinutes),cos=hourAngle(terms.declination);
   if(Math.abs(cos)>1)return undefined;
   const angle=Math.acos(cos)/rad*(rise?1:-1);
   utcMinutes=720-4*(longitude+angle)-terms.equation;
  }
  return Math.round((start+utcMinutes*minute)/1000)*1000;
 };
 return {kind:'normal',sunrise:event(true),sunset:event(false)};
}
function selectPlan(events:ThemeTransition[],now:number):ThemeSchedulePlan|null {
 events.sort((a,b)=>a.at-b.at||a.mode.localeCompare(b.mode));
 const past=events.filter(event=>event.at<=now).at(-1),next=events.find(event=>event.at>now);
 return past?{phase:'automatic',mode:past.mode,next,token:`${past.at}:${past.mode}`,detail:''}:null;
}
export function evaluateThemeSchedule(preferences:ThemeSchedulePreferences,now=new Date(),nightLight?:boolean):ThemeSchedulePlan {
 const p=validateThemeSchedule(preferences),stamp=now.getTime();if(!Number.isFinite(stamp)||now.getFullYear()<1900||now.getFullYear()>2200)throw Error('当前日期超出主题计划支持范围');
 if(!p.enabled)return {phase:'off',token:'off',detail:'自动切换已关闭'};
 if(p.source==='night-light')return typeof nightLight==='boolean'?{phase:'automatic',mode:nightLight?'dark':'light',token:`night-light:${nightLight}`,detail:'跟随 Windows 夜间模式当前状态'}:{phase:'unavailable',token:'night-light:unknown',detail:'暂时无法读取 Windows 夜间模式，保留当前主题'};
 if(p.source==='fixed'){
  const events=Array.from({length:5},(_,i)=>dayStart(now,i-2)).flatMap(date=>[fixedEvent(date,p.lightAt,'light'),fixedEvent(date,p.darkAt,'dark')]);
  return {...selectPlan(events,stamp)!,detail:'按本地时间自动切换'};
 }
 if(p.latitude===null||p.longitude===null)return {phase:'unavailable',token:'sun:no-location',detail:'请先设置日出日落计算使用的位置，保留当前主题'};
 const events:ThemeTransition[]=[];
 const add=(date:Date)=>{
  const times=solarDay(date.getFullYear(),date.getMonth()+1,date.getDate(),p.latitude!,p.longitude!);
  if(times.sunrise!==undefined)events.push({at:times.sunrise+p.sunriseOffset*minute,mode:'light'});
  if(times.sunset!==undefined)events.push({at:times.sunset+p.sunsetOffset*minute,mode:'dark'});
  return times;
 };
 for(let offset=-2;offset<=2;offset++)add(dayStart(now,offset));
 if(!events.some(event=>event.at<=stamp))for(let offset=-3;offset>=-370&&!events.some(event=>event.at<=stamp);offset--)add(dayStart(now,offset));
 let plan=selectPlan(events,stamp);
 // Polar periods have no daily crossing; keep the physical day/night state and
 // locate the next real crossing rather than inventing a fallback fixed time.
 if(!plan||!plan.next){
  for(let offset=3;offset<=370&&!events.some(event=>event.at>stamp);offset++)add(dayStart(now,offset));
  plan=selectPlan(events,stamp);
 }
 const today=add(dayStart(now));
 if(plan)return {...plan,detail:today.kind==='polar-day'?'当前位置处于极昼，按最近的日出日落计划同步':today.kind==='polar-night'?'当前位置处于极夜，按最近的日出日落计划同步':'按日出日落估算时间自动切换'};
 if(today.kind==='normal')return {phase:'unavailable',token:'sun:no-event',detail:'当前位置暂时无法计算有效的日出日落时间，保留当前主题'};
 const mode=today.kind==='polar-day'?'light':'dark';
 return {phase:'automatic',mode,next:events.sort((a,b)=>a.at-b.at).find(event=>event.at>stamp),token:`sun:${today.kind}`,detail:today.kind==='polar-day'?'当前位置处于极昼，使用浅色主题':'当前位置处于极夜，使用深色主题'};
}
