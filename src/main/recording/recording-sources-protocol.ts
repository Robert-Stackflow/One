export interface SourcePreview {
  id: string;
  name: string;
  display_id: string;
  thumbnail: string;
  pid?: number;
}
export function sourcePreviews(value: unknown, type: 'screen' | 'window'): SourcePreview[] {
  if (!Array.isArray(value) || value.length > 150) throw new Error('Invalid desktop previews');
  const seen = new Set<string>();
  let bytes = 0;
  return value.map((item) => {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.id !== 'string' ||
      !new RegExp('^' + type + ':\\d+:\\d+$').test(item.id) ||
      seen.has(item.id) ||
      typeof item.name !== 'string' ||
      item.name.length > 200 ||
      typeof item.display_id !== 'string' ||
      item.display_id.length > 32 ||
      typeof item.thumbnail !== 'string' ||
      item.thumbnail.length > 256 * 1024 ||
      !/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(item.thumbnail)
    )
      throw new Error('Invalid desktop preview');
    bytes += item.thumbnail.length;
    if (bytes > 16 * 1024 * 1024) throw new Error('Desktop previews too large');
    seen.add(item.id);
    if (
      item.pid !== undefined &&
      (!Number.isSafeInteger(item.pid) || item.pid < 1 || item.pid > 0xffffffff)
    )
      throw new Error('Invalid source identity');
    return {
      id: item.id,
      name: item.name,
      display_id: item.display_id,
      thumbnail: item.thumbnail,
      ...(item.pid === undefined ? {} : { pid: item.pid }),
    };
  });
}
