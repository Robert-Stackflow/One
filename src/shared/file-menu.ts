export interface FileMenuTarget{session:string;path:string;name:string;directory:boolean;launchKind?:'app'|'setting';submenu?:'apps'}
export type FileMenuAction='open'|'preview'|'reveal'|'copy-path'|'copy-name'|'copy'|'cut'|'rename'|'trash'|'open-with'|'native';
export function renameDestinationName(value:unknown){if(typeof value!=='string'||!value||value.length>255||/[\\/:*?"<>|\x00-\x1f]/.test(value)||/[ .]$/.test(value)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)||value==='.'||value==='..')throw new Error('请输入有效的文件名');return value;}
