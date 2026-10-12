import { sensitiveResult, type SensitiveResult } from '../recognition/sensitive-api';
import type { ImageDocument, Annotation } from './image-document';

export function sensitiveAnnotations(
  before: ImageDocument,
  result: SensitiveResult,
  mode: 'solid' | 'mosaic',
  id = () => crypto.randomUUID(),
): ImageDocument {
  const value = sensitiveResult(result),
    region = before.selection;
  if (
    !region ||
    value.width !== Math.ceil(region.width) ||
    value.height !== Math.ceil(region.height)
  )
    throw Error('敏感文字识别尺寸不一致');
  if (before.annotations.length + value.regions.length > 300)
    throw Error('标注过多，请减少标注后重试');
  const annotations: Annotation[] = value.regions.map((r) => ({
    id: id(),
    tool: mode,
    color: '#000000',
    width: 1,
    strength: 16,
    number: 1,
    text: '',
    filled: true,
    brush: false,
    points: [],
    start: { x: region.x + r.x, y: region.y + r.y },
    end: {
      x: region.x + Math.min(region.width, r.x + r.width),
      y: region.y + Math.min(region.height, r.y + r.height),
    },
  }));
  return { ...before, annotations: [...before.annotations, ...annotations] };
}
