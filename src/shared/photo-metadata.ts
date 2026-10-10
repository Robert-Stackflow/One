export interface PhotoLocation {latitude:number;longitude:number}
const text=(value:unknown):string=>{if(typeof value==='string')return value.replace(/\0/g,'').trim().slice(0,240);if(Array.isArray(value))return value.map(text).filter(Boolean).join(' / ').slice(0,240);if(value&&typeof value==='object'){const v=value as Record<string,unknown>;return text(v['x-default']??v.value??v.LocationName);}return '';};
const number=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:undefined;
const decimal=(value:number,places=4)=>String(Number(value.toFixed(places)));
function coordinate(value:unknown,reference:unknown,positive:string,negative:string){
 let parts:number[],direction=text(reference).toUpperCase();
 if(Array.isArray(value))parts=value as number[];
 else if(typeof value==='number')parts=[value];
 else if(typeof value==='string'){const match=/^\s*(-?\d+(?:\.\d+)?)(?:\s*[, ]\s*(\d+(?:\.\d+)?))?(?:\s*[, ]\s*(\d+(?:\.\d+)?))?\s*([NSEW])?\s*$/i.exec(value);if(!match)return undefined;parts=[Number(match[1]),...(match[2]?[Number(match[2])]:[]),...(match[3]?[Number(match[3])]:[])];direction=match[4]?.toUpperCase()||direction;}
 else return undefined;
 if(!parts.length||parts.length>3||parts.some(n=>typeof n!=='number'||!Number.isFinite(n))||parts.slice(1).some(n=>n<0||n>=60)||direction&&direction!==positive&&direction!==negative)return undefined;
 const degrees=Math.abs(parts[0])+(parts[1]||0)/60+(parts[2]||0)/3600;return degrees*(direction===negative||!direction&&parts[0]<0?-1:1);
}
function flash(value:number){if(value&32)return '无闪光灯';const parts=[value&1?'已闪光':'未闪光'],mode=(value>>3)&3;if(mode)parts.push(['','强制开启','关闭','自动'][mode]);if(value&64)parts.push('防红眼');const returned=(value>>1)&3;if(returned===2)parts.push('未检测到回闪');if(returned===3)parts.push('检测到回闪');return parts.join(' · ');}

/** Format only stored metadata. Coordinates are not silently sent to a geocoding service. */
export function photoMetadata(data:Record<string,unknown>){
 const metadata:Record<string,string>={};const add=(name:string,value:unknown)=>{const string=text(value);if(string)metadata[name]=string;};
 for(const [key,name] of Object.entries({Make:'设备品牌',Model:'设备型号',LensMake:'镜头品牌',LensModel:'镜头',Software:'处理软件'}))add(name,data[key]);
 const date=text(data.DateTimeOriginal||data.CreateDate);if(date){const value=date.replace(/^(\d{4}):(\d{2}):(\d{2})/,'$1-$2-$3'),sub=text(data.SubSecTimeOriginal),offset=text(data.OffsetTimeOriginal);metadata['拍摄时间']=value+(/^\d{1,9}$/.test(sub)&&!/[.Z+-]/.test(value.slice(19))?'.'+sub:'')+(/^[+-]\d{2}:\d{2}$/.test(offset)&&!/(Z|[+-]\d{2}:\d{2})$/i.test(value)?' '+offset:'');}
 const numeric=(key:string,name:string,format:(value:number)=>string)=>{const value=number(data[key]);if(value!==undefined)metadata[name]=format(value);};
 numeric('ExposureTime','曝光时间',value=>value>0&&value<1?'1/'+decimal(1/value,1)+' 秒':decimal(value)+' 秒');
 numeric('FNumber','光圈',value=>'f/'+decimal(value));numeric('ISO','ISO',String);
 numeric('FocalLength','焦距',value=>decimal(value)+' mm');numeric('FocalLengthIn35mmFormat','等效焦距（35 mm）',value=>decimal(value)+' mm');
 numeric('ExposureBiasValue','曝光补偿',value=>(value>0?'+':'')+decimal(value)+' EV');
 const enums:Record<string,{name:string;values:Record<number,string>}>={
  ExposureProgram:{name:'曝光程序',values:{0:'未定义',1:'手动',2:'程序自动',3:'光圈优先',4:'快门优先',5:'创意模式',6:'运动模式',7:'人像模式',8:'风景模式'}},
  ExposureMode:{name:'曝光模式',values:{0:'自动',1:'手动',2:'自动包围曝光'}},WhiteBalance:{name:'白平衡',values:{0:'自动',1:'手动'}},
  MeteringMode:{name:'测光方式',values:{0:'未知',1:'平均测光',2:'中央重点',3:'点测光',4:'多点测光',5:'多区测光',6:'局部测光',255:'其他'}},
  LightSource:{name:'光源',values:{0:'未知',1:'日光',2:'荧光灯',3:'白炽灯',4:'闪光灯',9:'晴天',10:'阴天',11:'阴影',12:'日光荧光灯',13:'日白荧光灯',14:'冷白荧光灯',15:'白色荧光灯',17:'标准光源 A',18:'标准光源 B',19:'标准光源 C',20:'D55',21:'D65',22:'D75',23:'D50',24:'摄影棚钨丝灯',255:'其他'}},
  SceneCaptureType:{name:'拍摄场景',values:{0:'标准',1:'风景',2:'人像',3:'夜景'}},ColorSpace:{name:'色彩空间',values:{1:'sRGB',2:'Adobe RGB',65535:'未校准'}},
  Orientation:{name:'方向',values:{1:'正常',2:'水平翻转',3:'旋转 180°',4:'垂直翻转',5:'转置',6:'顺时针 90°',7:'横向转置',8:'逆时针 90°'}}
 };
 for(const [key,{name,values}] of Object.entries(enums)){const value=number(data[key]);if(value!==undefined)metadata[name]=values[value]??'未知（'+value+'）';else add(name,data[key]);}
 const flashed=number(data.Flash);if(flashed!==undefined&&Number.isInteger(flashed)&&flashed>=0&&flashed<=127)metadata['闪光灯']=flash(flashed);
 const width=number(data.ExifImageWidth??data.PixelXDimension??data.ImageWidth),height=number(data.ExifImageHeight??data.PixelYDimension??data.ImageHeight);if(width&&height&&width>0&&height>0&&width*height<1e12)metadata['像素']=decimal(width*height/1e6,2)+' MP';
 const created=Array.isArray(data.LocationCreated)?data.LocationCreated[0]:data.LocationCreated,place=created&&typeof created==='object'?created as Record<string,unknown>:{};
 const parts=[data.Sublocation??data.Location??place.Sublocation??place.LocationName,data.City??place.City,data.State??place.ProvinceState,data.Country??place.CountryName].map(text).filter(Boolean);
 if(parts.length)metadata['拍摄地点']=[...new Set(parts)].join(' · ');
 const latitude=number(data.latitude)??coordinate(data.GPSLatitude,data.GPSLatitudeRef,'N','S'),longitude=number(data.longitude)??coordinate(data.GPSLongitude,data.GPSLongitudeRef,'E','W');let location:PhotoLocation|undefined;
 if(latitude!==undefined&&longitude!==undefined&&Math.abs(latitude)<=90&&Math.abs(longitude)<=180){
  location={latitude,longitude};metadata['GPS 坐标']=decimal(Math.abs(latitude),6)+'° '+(latitude<0?'S':'N')+'，'+decimal(Math.abs(longitude),6)+'° '+(longitude<0?'W':'E');
  const altitudeRef=number(data.GPSAltitudeRef)??(data.GPSAltitudeRef instanceof Uint8Array&&data.GPSAltitudeRef.length===1?data.GPSAltitudeRef[0]:undefined);
  numeric('GPSAltitude','海拔',value=>decimal(altitudeRef===1?-Math.abs(value):value,1)+' m');
 }
 return {metadata,location};
}
