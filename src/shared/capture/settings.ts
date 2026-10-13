import {defaultWorkflows,workflowsFrom,type CaptureWorkflow} from './capture-workflow';
import {defaultWatermarkPreset,watermarkPreset,type WatermarkPreset} from './watermark';
import {defaultCustomCapture,customCaptureFrom,type CustomCapture} from './custom-capture';
import {defaultCaptureShortcuts,validateCaptureShortcuts,type CaptureShortcuts} from './shortcuts';
import {annotationStylesFrom,type AnnotationStyles} from './annotation-preferences';

export const captureScales=[100,110,125,150] as const;
/** Preferences owned by One; live capture state and service credentials are kept elsewhere. */
export interface CapturePreferences {
  workflows:CaptureWorkflow[];
  workflowId:string;
  watermark:WatermarkPreset;
  annotationStyles:AnnotationStyles;
  remoteCompatible:boolean;
  custom:CustomCapture;
  shortcuts:CaptureShortcuts;
  /** Scale for screenshot/recording pages and their independent windows only. */
  uiScale:(typeof captureScales)[number];
}
export const defaultCapturePreferences=():CapturePreferences=>({
  workflows:defaultWorkflows(),workflowId:'copy',watermark:defaultWatermarkPreset(),annotationStyles:annotationStylesFrom(),
  remoteCompatible:true,custom:defaultCustomCapture(),shortcuts:defaultCaptureShortcuts(),uiScale:100,
});
export function validateCapturePreferences(value:unknown):CapturePreferences {
  if(value===undefined)return defaultCapturePreferences();
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('截图设置格式无效');
  const v={...defaultCapturePreferences(),...value as Partial<CapturePreferences>};
  if(typeof v.remoteCompatible!=='boolean'||!captureScales.includes(v.uiScale))throw Error('截图设置格式无效');
  const workflows=workflowsFrom(v.workflows);
  if(typeof v.workflowId!=='string'||!workflows.some(item=>item.id===v.workflowId))throw Error('默认输出流程不存在');
  return {workflows,workflowId:v.workflowId,watermark:watermarkPreset(v.watermark),annotationStyles:annotationStylesFrom(v.annotationStyles),
    remoteCompatible:v.remoteCompatible,custom:customCaptureFrom(v.custom),shortcuts:validateCaptureShortcuts(v.shortcuts),uiScale:v.uiScale};
}
