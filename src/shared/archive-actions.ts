export type ArchiveOpenAction='create'|'quick-zip'|'quick-7z'|'quick-tar'|'quick-tar-gz'|'quick-tar-xz'|'quick-gz'|'quick-xz'|'extract'|'smart'|'here'|'folder'|'choose';
export const archiveShellActions={
 'archive-create':'create','archive-create-zip':'quick-zip','archive-create-7z':'quick-7z','archive-create-tar':'quick-tar','archive-create-tar-gz':'quick-tar-gz','archive-create-tar-xz':'quick-tar-xz','archive-create-gz':'quick-gz','archive-create-xz':'quick-xz','archive-extract':'extract','archive-smart':'smart','archive-here':'here','archive-folder':'folder','archive-choose':'choose',
} as const satisfies Record<string,ArchiveOpenAction>;
export type ArchiveShellAction=keyof typeof archiveShellActions;
export function archiveShellAction(value:string):ArchiveOpenAction|undefined{return Object.hasOwn(archiveShellActions,value)?archiveShellActions[value as ArchiveShellAction]:undefined;}
export function isArchiveCreateAction(action:ArchiveOpenAction){return action==='create'||action.startsWith('quick-');}
export function quickArchiveFormat(action:ArchiveOpenAction){return action.startsWith('quick-')?action.slice(6).replaceAll('-', '.'):undefined;}
// Reading is deliberately separate from the supported creation formats.
const archiveSuffix=/\.(?:7z\.001|part\d+\.rar|tar\.(?:gz|xz|bz2|zst|zstd)|zip|zipx|jar|apk|7z|rar|r00|z\d{2}|tar|tgz|txz|tbz2?|tzst|gz|xz|bz2|bzip2|zst|zstd|cab|lha|lzh|iso|wim|alz|[a-k]\d{2}|egg)$/i;
export function isArchivePath(path:string){return archiveSuffix.test(path);}
export function isAlzPath(path:string){return /\.(?:alz|[a-k]\d{2})$/i.test(path);}
export function archiveBaseName(path:string){return path.replace(archiveSuffix,'');}
export function isCompositeArchive(path:string){return /\.(?:tar\.(?:gz|xz|bz2|zst|zstd)|tgz|txz|tbz2?|tzst)$/i.test(path);}
