export type ArchiveOpenAction='create'|'extract'|'smart'|'here'|'folder';
export const archiveShellActions={
 'archive-create':'create','archive-extract':'extract','archive-smart':'smart','archive-here':'here','archive-folder':'folder',
} as const satisfies Record<string,ArchiveOpenAction>;
export type ArchiveShellAction=keyof typeof archiveShellActions;
export function archiveShellAction(value:string):ArchiveOpenAction|undefined{return Object.hasOwn(archiveShellActions,value)?archiveShellActions[value as ArchiveShellAction]:undefined;}
export function isArchivePath(path:string){return /\.(?:zip|7z|7z\.001|rar|r00|tar|tar\.gz|tgz|gz|tar\.xz|txz|xz)$/i.test(path);}
