export type FileAction='locksmith'|'rename'|import('./archive-actions').ArchiveShellAction;
export interface FileActionTarget {tool:FileAction;paths:string[]}
export interface ExplorerMenuState {locksmith:boolean;rename:boolean;archiveCreate:boolean;archiveExtract:boolean;classic:boolean;modern:boolean;error?:string}
