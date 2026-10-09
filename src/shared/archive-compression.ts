export interface ArchiveCompression {
 zipMethod:'deflate'|'xz';
 zipEncryption:'aes256'|'zipcrypto';
 sevenMethod:'lzma'|'lzma2';
 sevenSolid:'off'|'solid'|1|2|4|8|16|32|64|128|256|512|1024;
 autoThreads:boolean;
}
export const defaultArchiveCompression=():ArchiveCompression=>({zipMethod:'deflate',zipEncryption:'aes256',sevenMethod:'lzma2',sevenSolid:64,autoThreads:false});
export const solidSizes=[1,2,4,8,16,32,64,128,256,512,1024] as const;
export function archiveCompression(value:Partial<ArchiveCompression>={},defaults=defaultArchiveCompression()):ArchiveCompression {
 const result={...defaults};
 for(const key of ['zipMethod','zipEncryption','sevenMethod','sevenSolid','autoThreads'] as const)if(value[key]!==undefined)Object.assign(result,{[key]:value[key]});
 if(!['deflate','xz'].includes(result.zipMethod))throw Error('ZIP 压缩方法无效');
 if(!['aes256','zipcrypto'].includes(result.zipEncryption))throw Error('ZIP 加密算法无效');
 if(!['lzma','lzma2'].includes(result.sevenMethod))throw Error('7Z 压缩方法无效');
 if(result.sevenSolid!=='off'&&result.sevenSolid!=='solid'&&!(typeof result.sevenSolid==='number'&&solidSizes.includes(result.sevenSolid)))throw Error('7Z 固实块大小无效');
 if(typeof result.autoThreads!=='boolean')throw Error('自动线程设置无效');
 return result;
}
