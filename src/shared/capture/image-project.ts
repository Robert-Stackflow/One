import { IMAGE_PROJECT_FORMAT } from '../media-project';
import { imageDimensions } from './image-limits';
import {
  validateImageDocument,
  imageHistoryState,
  type ImageDocument,
  type ImageHistoryState,
} from './image-document';

export const IMAGE_PROJECT_METADATA_BYTES = 16 * 1024 * 1024;
export interface ImageProject {
  format: typeof IMAGE_PROJECT_FORMAT.id;
  version: 1|2;
  name: string;
  document: ImageDocument;
  history?: ImageHistoryState;
}
/** Projects preserve the original PNG and editable vector state, without session credentials. */
export function imageProject(
  value: unknown,
  original: { width: number; height: number },
): ImageProject {
  const v = value as ImageProject;
  imageDimensions(original.width, original.height);
  if (
    !v ||
    v.format !== IMAGE_PROJECT_FORMAT.id ||
    ![1,2].includes(v.version) ||
    typeof v.name !== 'string' ||
    !v.name.trim() ||
    v.name.length > 180 ||
    /[\x00-\x1f\x7f]/.test(v.name)
  )
    throw Error('图片工程信息无效或版本不支持');
  const document = validateImageDocument(v.document, original);
  const history=v.history===undefined?undefined:imageHistoryState(v.history,original);
  const revisions=new Map<string,string>();
  for(const scene of [document,...history?.past||[],...history?.future||[]])if(scene.translation){const layer=scene.translation.document,key=layer.id+':'+layer.version,content=JSON.stringify(layer);if(revisions.has(key)&&revisions.get(key)!==content)throw Error('翻译文字层版本不一致');revisions.set(key,content);}
  if(v.version===1&&(document.translation||history?.past.some(item=>item.translation)||history?.future.some(item=>item.translation)))throw Error('翻译文字层需要新版图片工程');
  if (
    !document.selection ||
    document.selection.x !== 0 ||
    document.selection.y !== 0 ||
    document.selection.width !== document.width ||
    document.selection.height !== document.height
  )
    throw Error('请先应用或取消裁剪选区');
  return {
    format: IMAGE_PROJECT_FORMAT.id,
    version: v.version,
    name: v.name,
    document,
    ...(history === undefined ? {} : { history }),
  };
}
export function imageProjectVersion(document:unknown,history?:unknown):1|2{const value=document as Partial<ImageDocument>|undefined,state=history as Partial<ImageHistoryState>|undefined;return value?.translation||Array.isArray(state?.past)&&state.past.some(item=>item?.translation)||Array.isArray(state?.future)&&state.future.some(item=>item?.translation)?2:1;}
