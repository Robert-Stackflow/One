export interface ImageAiProgress {phase:'download'|'process';received?:number;done?:number;total?:number;message:string}
export interface ImageAiResult {source:string;output:string;before:number;after:number;width:number;height:number;message:string}
export type ImageRepairMode='damage'|'remove';
