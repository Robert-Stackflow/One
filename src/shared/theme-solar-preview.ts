import {solarDay} from './theme-schedule';
/** Estimates for the current system calendar day, using the same instants as the scheduler. */
export function solarSchedulePreview(latitude:number|null,longitude:number|null,sunriseOffset:number,sunsetOffset:number,now=new Date()){
 if(latitude===null||longitude===null)return null;
 if(!Number.isInteger(sunriseOffset)||Math.abs(sunriseOffset)>180||!Number.isInteger(sunsetOffset)||Math.abs(sunsetOffset)>180)throw Error('偏移需在前后 180 分钟内');
 const day=solarDay(now.getFullYear(),now.getMonth()+1,now.getDate(),latitude,longitude);
 return {...day,lightAt:day.sunrise===undefined?undefined:day.sunrise+sunriseOffset*60000,darkAt:day.sunset===undefined?undefined:day.sunset+sunsetOffset*60000};
}
