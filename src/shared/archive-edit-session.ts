import type {ArchiveEncoding,ArchivePasswordEncoding} from './archive';

export type ArchiveEditStart={path:string;revision:string;index:number;encoding?:ArchiveEncoding;passwordEncoding?:ArchivePasswordEncoding;password?:string};
export type ArchiveEditSession={id:string;archive:string;name:string;file:string;created:number;state:'ready'|'writing'|'saved';changed?:boolean;token?:string;error?:string;editor?:'idle'|'running'|'closed'|'untracked';notice?:string;conflict?:boolean};
export type ArchiveEditSessionPage={items:ArchiveEditSession[];truncated:boolean};
export type ArchiveEditResolution={id:string;token:string;archive:string;name:string;missing:boolean;same:boolean;committed:boolean};
