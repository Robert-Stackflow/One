import type {ArchiveEntryDetails} from './archive';

/** Copy only supported fields from the native protocol. */
export function archiveEntryDetails(value:unknown):ArchiveEntryDetails {
 if(!value||typeof value!=='object')throw Error('文件信息无效');
 const item=value as ArchiveEntryDetails,entry=item.entry;
 if(!entry||typeof entry!=='object'||!Number.isInteger(entry.index)||entry.index<0||entry.index>=1000000||typeof entry.name!=='string'||!entry.name||entry.name.length>131072||entry.name.includes('\0')||typeof entry.directory!=='boolean'||typeof entry.encrypted!=='boolean'||![entry.size,entry.compressed].every(number=>Number.isSafeInteger(number)&&number>=0)||typeof item.packedKnown!=='boolean'||typeof item.packedShared!=='boolean')throw Error('文件信息无效');
 if(item.modified!==undefined&&(!Number.isSafeInteger(item.modified)||item.modified< -11644473600000||item.modified>253402300799999))throw Error('文件时间无效');
 if(item.crc32!==undefined&&(typeof item.crc32!=='string'||!/^[0-9A-F]{8}$/.test(item.crc32)))throw Error('文件校验值无效');
 if(item.method!==undefined&&(typeof item.method!=='string'||item.method.length>4096||/[\0\r\n]/.test(item.method)))throw Error('压缩方式无效');
 return {entry:{index:entry.index,name:entry.name,directory:entry.directory,size:entry.size,compressed:entry.compressed,encrypted:entry.encrypted},packedKnown:item.packedKnown,packedShared:item.packedShared,...(item.modified===undefined?{}:{modified:item.modified}),...(item.crc32===undefined?{}:{crc32:item.crc32}),...(item.method===undefined?{}:{method:item.method})};
}
