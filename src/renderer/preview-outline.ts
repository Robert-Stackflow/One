export interface OutlineItem {label:string;depth?:number;icon?:string;activate:()=>void}
export type SetOutline=(items:OutlineItem[])=>void;
export interface OverviewItem {label:string;activate:()=>void;thumbnail:()=>HTMLElement|Promise<HTMLElement>;disposeThumbnail?:(element:HTMLElement)=>void}
export type SetOverview=(items:OverviewItem[])=>void;
