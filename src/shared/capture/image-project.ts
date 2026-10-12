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
  version: 1;
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
    v.version !== IMAGE_PROJECT_FORMAT.version ||
    typeof v.name !== 'string' ||
    !v.name.trim() ||
    v.name.length > 180 ||
    /[\x00-\x1f\x7f]/.test(v.name)
  )
    throw Error('图片工程信息无效或版本不支持');
  const document = validateImageDocument(v.document, original);
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
    version: IMAGE_PROJECT_FORMAT.version,
    name: v.name,
    document,
    ...(v.history === undefined ? {} : { history: imageHistoryState(v.history, original) }),
  };
}
