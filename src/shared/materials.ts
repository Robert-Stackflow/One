export interface ImageMaterial {
  id:string;hash:string;title:string;created:number;width:number;height:number;bytes:number;
  source:'capture'|'file'|'clipboard'|'edit';
}
export interface ImageMaterialDetail {id:string;hash:string;title:string;payload:{png?:string}}
/** Resource URLs are issued for the requesting window, never stored in an index. */
export interface ImageMaterialView extends ImageMaterial {thumbnail:string}
export interface RecordingMaterial {id:string;title:string;created:number;seconds:number;bytes:number;mode:'video'|'audio'}
export interface RecordingMaterialView extends RecordingMaterial {thumbnail:string}
export interface MaterialsState {images:ImageMaterialView[];recordings:RecordingMaterialView[];directory:string;error:string}
export interface MaterialsExportResult {completed:string[];failed:{id:string;error:string}[];canceled:boolean}
export interface MaterialsAPI {
  materialsState():Promise<MaterialsState>;
  materialsImportImages():Promise<string[]>;
  materialsImportClipboard():Promise<string>;
  materialsImageURL(id:string):Promise<string>;
  materialsRecordingURL(id:string):Promise<string>;
  materialsSaveRecordingThumbnail(id:string,png:Uint8Array):Promise<void>;
  materialsCopyImage(id:string):Promise<void>;
  materialsExportImage(id:string):Promise<boolean>;
  materialsExportBatch(kind:'images'|'recordings',ids:string[]):Promise<MaterialsExportResult>;
  materialsRemoveImage(id:string):Promise<void>;
  materialsOpenRecording(id:string):Promise<void>;
  materialsImportRecording(kind:'project'|'video'):Promise<void>;
  materialsRemoveRecording(id:string):Promise<void>;
  materialsOpenDirectory():Promise<void>;
  materialsEditImage(id:string):Promise<void>;
  materialsRecognizeImage(id:string):Promise<void>;
  materialsRecognizeFormula(id:string):Promise<void>;
  materialsOpenImageProject():Promise<void>;
  onMaterialsChanged(callback:()=>void):()=>void;
}
export const MATERIAL_INDEX_FORMAT={images:'one-image-materials',recording:'one-recording-material',version:1} as const;
export const validMaterialId=(id:unknown):id is string=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
export function recordingMaterial(value:unknown):RecordingMaterial {
  const v=value as RecordingMaterial;
  if(!v||!validMaterialId(v.id)||typeof v.title!=='string'||v.title.length>200||
    !Number.isSafeInteger(v.created)||v.created<0||!Number.isFinite(v.seconds)||v.seconds<0||
    !Number.isSafeInteger(v.bytes)||v.bytes<1||!['video','audio'].includes(v.mode))throw Error('录制素材索引损坏');
  return {id:v.id,title:v.title,created:v.created,seconds:v.seconds,bytes:v.bytes,mode:v.mode};
}
