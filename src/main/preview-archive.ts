import type {PreviewData} from '../shared/types';
import type {ArchiveListing,ArchiveRequest,ArchiveResult,PreviewArchiveRequest} from '../shared/archive';
import {isArchivePath} from '../shared/archive-actions';

/** Preview can only list its current file; never forward arbitrary archive operations. */
export async function previewArchive(current:()=>PreviewData|undefined,request:PreviewArchiveRequest,id:string,run:(request:ArchiveRequest,id:string)=>Promise<ArchiveListing|ArchiveResult>):Promise<ArchiveListing>{
 const data=current();
 if(!data||data.type!=='archive'||!isArchivePath(data.path)||!request||request.path!==data.path)throw Error('预览文件已切换，请重新打开');
 const result=await run({operation:'list',path:data.path,offset:request.offset,browse:request.browse,password:request.password,encoding:request.encoding,passwordEncoding:request.passwordEncoding},id);
 if(current()!==data)throw Error('预览文件已切换');
 if(!('entries' in result))throw Error('无法读取压缩包');
 return result;
}
