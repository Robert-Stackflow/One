export const archiveFormatOptions='<option value="zip">ZIP</option><option value="7z">7Z</option><option value="tar">TAR</option><option value="tar.gz">TAR.GZ</option><option value="tar.xz">TAR.XZ</option><option value="gz">GZ · 单文件</option><option value="xz">XZ · 单文件</option>';

const volumePresets:[number,string][]=[
 [3,'3 MB'],[4,'4 MB'],[5,'5 MB'],[10,'10 MB'],[20,'20 MB'],[25,'25 MB'],
 [100,'100 MB'],[300,'300 MB'],[650,'650 MB'],[700,'700 MB'],
 [1024,'1 GB'],[2048,'2 GB'],[4096,'4 GB'],[4813,'约 4.7 GB'],[8192,'8 GB']
];
export const archiveVolumeOptions='<option value="none">不分卷</option>'+volumePresets.map(([size,label])=>`<option value="${size}">${label}</option>`).join('')+'<option value="custom">自定义大小…</option>';

export function archiveVolumeBytes(preset:string,custom:string):number {
 if(preset==='none')return 0;
 const size=preset==='custom'?Number(custom.trim()):Number(preset);
 if(!Number.isSafeInteger(size)||size<1||size>65536||preset==='custom'&&!/^\d+$/.test(custom.trim()))throw Error('分卷大小须为 1–65536 MB');
 if(preset!=='custom'&&!volumePresets.some(([value])=>value===size))throw Error('分卷大小选项无效');
 return size*1024**2;
}
export function archiveVolumeLabel(preset:string,custom:string):string {
 if(preset==='none')return '';
 return preset==='custom'?`${custom.trim()} MB`:volumePresets.find(([size])=>String(size)===preset)?.[1]??'';
}
