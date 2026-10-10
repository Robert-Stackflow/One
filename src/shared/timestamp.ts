export type TimestampUnit='seconds'|'milliseconds';
export type TimestampDisambiguation='earlier'|'later';
export interface ZonedDateTime {year:number;month:number;day:number;hour:number;minute:number;second:number;millisecond:number}
export interface TimestampResult {milliseconds:number;seconds:string;utc:string;zoned:string;timeZone:string;ambiguous:boolean}

const formatterCache=new Map<string,Intl.DateTimeFormat>();
function formatter(timeZone:string){
 let value=formatterCache.get(timeZone);
 if(!value){value=new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hourCycle:'h23'});formatterCache.set(timeZone,value);}
 return value;
}
export function resolvedTimeZone(value:string){const zone=value==='local'?Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC':value;try{formatter(zone);return zone;}catch{throw Error('时区无效');}}
function partsAt(milliseconds:number,timeZone:string):ZonedDateTime{
 const parts=formatter(timeZone).formatToParts(new Date(milliseconds));
 const get=(type:string)=>Number(parts.find(part=>part.type===type)?.value);
 return {year:get('year'),month:get('month'),day:get('day'),hour:get('hour'),minute:get('minute'),second:get('second'),millisecond:get('fractionalSecond')};
}
function pad(value:number,length=2){return String(value).padStart(length,'0');}
function display(value:ZonedDateTime){return `${pad(value.year,4)}-${pad(value.month)}-${pad(value.day)} ${pad(value.hour)}:${pad(value.minute)}:${pad(value.second)}.${pad(value.millisecond,3)}`;}
function utcLike(value:ZonedDateTime){const date=new Date(0);date.setUTCFullYear(value.year,value.month-1,value.day);date.setUTCHours(value.hour,value.minute,value.second,value.millisecond);return date.getTime();}
function matches(a:ZonedDateTime,b:ZonedDateTime){return a.year===b.year&&a.month===b.month&&a.day===b.day&&a.hour===b.hour&&a.minute===b.minute&&a.second===b.second&&a.millisecond===b.millisecond;}
function result(milliseconds:number,timeZone:string,ambiguous=false):TimestampResult{
 if(!Number.isSafeInteger(milliseconds)||Math.abs(milliseconds)>8_640_000_000_000_000)throw Error('时间超出可表示范围');
 const absolute=Math.abs(milliseconds),seconds=`${milliseconds<0?'-':''}${Math.floor(absolute/1000)}${absolute%1000?'.'+pad(absolute%1000,3).replace(/0+$/,''):''}`;
 return {milliseconds,seconds,utc:new Date(milliseconds).toISOString(),zoned:display(partsAt(milliseconds,timeZone)),timeZone,ambiguous};
}
export function timestampToDate(text:string,unit:TimestampUnit,zone:string):TimestampResult{
 const input=text.trim();if(!/^-?\d+(?:\.\d{1,3})?$/.test(input)||unit==='milliseconds'&&input.includes('.'))throw Error('请输入有效的秒或毫秒时间戳；秒最多保留三位小数');
 if(unit!=='seconds'&&unit!=='milliseconds')throw Error('时间戳单位无效');
 const number=Number(input),milliseconds=unit==='seconds'?Math.round(number*1000):number;
 return result(milliseconds,resolvedTimeZone(zone));
}
export function dateToTimestamp(text:string,zone:string,disambiguation:TimestampDisambiguation='earlier'):TimestampResult{
 const match=/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(text.trim());
 if(!match)throw Error('请输入 YYYY-MM-DD HH:mm:ss 格式的日期时间');
 const value:ZonedDateTime={year:Number(match[1]),month:Number(match[2]),day:Number(match[3]),hour:Number(match[4]),minute:Number(match[5]),second:Number(match[6]||0),millisecond:Number((match[7]||'').padEnd(3,'0'))};
 if(value.year<1||value.month<1||value.month>12||value.day<1||value.day>31||value.hour>23||value.minute>59||value.second>59)throw Error('日期时间无效');
 const naive=utcLike(value),calendar=new Date(naive);if(calendar.getUTCFullYear()!==value.year||calendar.getUTCMonth()+1!==value.month||calendar.getUTCDate()!==value.day)throw Error('日期时间无效');
 const timeZone=resolvedTimeZone(zone),offsets=new Set<number>();
 for(const shift of [-172_800_000,-86_400_000,0,86_400_000,172_800_000]){const instant=naive+shift,local=partsAt(instant,timeZone);offsets.add(utcLike(local)-instant);}
 const candidates=[...offsets].map(offset=>naive-offset).filter(instant=>matches(partsAt(instant,timeZone),value)).sort((a,b)=>a-b);
 if(!candidates.length)throw Error('该本地时间在所选时区不存在，可能处于夏令时跳转区间');
 if(disambiguation!=='earlier'&&disambiguation!=='later')throw Error('重复时间选项无效');
 return result(disambiguation==='later'?candidates[candidates.length-1]:candidates[0],timeZone,candidates.length>1);
}
export function currentTimestamp(zone:string){return result(Date.now(),resolvedTimeZone(zone));}
