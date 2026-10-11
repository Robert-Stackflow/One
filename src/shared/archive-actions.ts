export type ArchiveOpenAction='create'|'quick-zip'|'quick-7z'|'extract'|'smart'|'here'|'folder'|'choose';
export const archiveShellActions={
 'archive-create':'create','archive-create-zip':'quick-zip','archive-create-7z':'quick-7z','archive-extract':'extract','archive-smart':'smart','archive-here':'here','archive-folder':'folder','archive-choose':'choose',
} as const satisfies Record<string,ArchiveOpenAction>;
export type ArchiveShellAction=keyof typeof archiveShellActions;
export function archiveShellAction(value:string):ArchiveOpenAction|undefined{return Object.hasOwn(archiveShellActions,value)?archiveShellActions[value as ArchiveShellAction]:undefined;}
// Reading is deliberately separate from the supported creation formats.
const archiveSuffix=/\.(?:7z\.001|part\d+\.rar|tar\.(?:gz|xz|bz2|zst|zstd)|zip|zipx|jar|apk|7z|rar|r00|z\d{2}|tar|tgz|txz|tbz2?|tzst|gz|xz|bz2|bzip2|zst|zstd|cab|lha|lzh|iso|wim|alz|[a-k]\d{2}|egg)$/i;
export function isArchivePath(path:string){return archiveSuffix.test(path);}
export function isAlzPath(path:string){return /\.(?:alz|[a-k]\d{2})$/i.test(path);}
export function archiveBaseName(path:string){return path.replace(archiveSuffix,'');}
export function isCompositeArchive(path:string){return /\.(?:tar\.(?:gz|xz|bz2|zst|zstd)|tgz|txz|tbz2?|tzst)$/i.test(path);}
