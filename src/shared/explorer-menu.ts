export type FileAction='locksmith'|'rename';
export interface FileActionTarget {tool:FileAction;paths:string[]}
export interface ExplorerMenuState {locksmith:boolean;rename:boolean;modern:boolean;error?:string}
