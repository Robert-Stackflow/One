export type FileAction='locksmith'|'rename'|'archive-create'|'archive-extract';
export interface FileActionTarget {tool:FileAction;paths:string[]}
export interface ExplorerMenuState {locksmith:boolean;rename:boolean;archiveCreate:boolean;archiveExtract:boolean;modern:boolean;error?:string}
