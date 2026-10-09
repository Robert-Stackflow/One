import {esc,size} from './ui';
import {dialogMarkup,openDialog} from './dialog';
import type {ArchiveEntryDetails} from '../shared/archive';

export function showArchiveDetails(details:ArchiveEntryDetails){
 const {entry}=details,missing='未提供',bytes=(value:number)=>`${size(value)}（${value.toLocaleString()} 字节）`;
 const ratio=!entry.directory&&entry.size>0&&details.packedKnown&&!details.packedShared?`${((1-entry.compressed/entry.size)*100).toFixed(1)}%`:missing;
 const fields=[['包内路径',entry.name],['类型',entry.directory?'文件夹':'文件'],['原始大小',entry.directory?missing:bytes(entry.size)],['压缩后大小',entry.directory||!details.packedKnown?missing:bytes(entry.compressed)+(details.packedShared?' · 固实块共享':'')],['节省空间',ratio],['修改时间',details.modified===undefined?missing:new Date(details.modified).toLocaleString()],['压缩方式',details.method||missing],['加密',entry.encrypted?'已加密':'未加密'],['CRC32',details.crc32||missing]];
 const template=document.createElement('template');template.innerHTML=dialogMarkup({id:'archive-entry-details',title:'文件信息',className:'archive-entry-details',body:`<dl>${fields.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd${label==='CRC32'?' class="archive-checksum"':''}>${esc(value)}</dd></div>`).join('')}</dl><p>${entry.implicit?'此文件夹由包内路径合成，未单独记录目录信息。':details.packedShared?'固实压缩的大小可能由多个文件共享，不计算单个文件的节省空间。':'显示压缩包记录的信息，尚未验证文件内容；校验请使用“测试完整性”。'}</p>`,actions:'<button type="button" data-dialog-dismiss autofocus>关闭</button>'});
 const dialog=template.content.firstElementChild as HTMLDialogElement;dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);openDialog(dialog);
}
