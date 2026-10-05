export const informationTabs = [
 ['overview','概览','info'],['cpu','处理器','cpu'],['memory','内存','memory'],['board','主板与 BIOS','board'],['display','显卡与显示器','monitor'],['storage','存储','disk'],['network','网络','network'],['proxy','代理','network'],['bluetooth','蓝牙','bluetooth'],['devices','音频与设备','devices'],['battery','电源与电池','battery'],['os','操作系统','window'],['drivers','驱动','system']
] as const;
export type InformationKind = typeof informationTabs[number][0];
export interface InformationField { key:string;label:string;value:string }
export interface InformationRecord { title:string;fields:InformationField[] }
export interface InformationGroup { id:string;title:string;records:InformationRecord[];error?:string }
export interface InformationReport { kind:InformationKind;created:number;elapsed:number;groups:InformationGroup[] }
export const informationCacheMs=300000;
export interface InformationProgress { kind:InformationKind;group:string;completed:number;total:number }
export const validInformationKind = (value:unknown):value is InformationKind => informationTabs.some(t=>t[0]===value);
