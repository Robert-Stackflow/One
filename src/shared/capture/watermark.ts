import type { Rectangle } from './region';
export const watermarkPositions = [
  'tile',
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
  'custom',
] as const;
export type WatermarkPosition = (typeof watermarkPositions)[number];
export const WATERMARK_IMAGE_EDGE = 512;
export const WATERMARK_IMAGE_BYTES = WATERMARK_IMAGE_EDGE ** 2 * 4;
export const WATERMARK_DOCUMENT_BYTES = 8 * 1024 * 1024;
export interface WatermarkImage {
  width: number;
  height: number;
  /** Portable straight-alpha RGBA snapshot, independent of the original file. */
  rgba: string;
  scale: number;
}
export function watermarkImage(value: unknown): WatermarkImage {
  const v = value as WatermarkImage;
  if (
    !v ||
    ![v.width, v.height].every(
      (n) => Number.isSafeInteger(n) && n >= 1 && n <= WATERMARK_IMAGE_EDGE,
    ) ||
    !Number.isFinite(v.scale) ||
    v.scale < 0.1 ||
    v.scale > 8 ||
    typeof v.rgba !== 'string' ||
    v.rgba.length !== 4 * Math.ceil((v.width * v.height * 4) / 3) ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(v.rgba)
  )
    throw Error('图片水印数据无效');
  const padding = (3 - ((v.width * v.height * 4) % 3)) % 3;
  if ((v.rgba.match(/=+$/)?.[0].length || 0) !== padding) throw Error('图片水印数据无效');
  return { width: v.width, height: v.height, rgba: v.rgba, scale: v.scale };
}
export interface WatermarkStyle {
  position: WatermarkPosition;
  opacity: number;
  angle: number;
  spacing: number;
  capturedAt: number;
  image?: WatermarkImage;
}
export interface WatermarkPreset extends Omit<WatermarkStyle, 'capturedAt'> {
  text: string;
  color: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
}
export const defaultWatermarkPreset = (): WatermarkPreset => ({
  position: 'tile',
  text: 'One',
  color: '#6a9b70',
  opacity: 0.25,
  angle: -30,
  spacing: 60,
  fontSize: 32,
  fontFamily: 'Microsoft YaHei',
  fontWeight: 400,
});
export function watermarkPreset(value: unknown): WatermarkPreset {
  const v = value as WatermarkPreset;
  if (
    !v ||
    typeof v.text !== 'string' ||
    v.text.length > 500 ||
    typeof v.color !== 'string' ||
    !/^#[\da-f]{6}$/i.test(v.color) ||
    !Number.isFinite(v.fontSize) ||
    v.fontSize < 8 ||
    v.fontSize > 240 ||
    typeof v.fontFamily !== 'string' ||
    !v.fontFamily.trim() ||
    v.fontFamily.length > 256 ||
    /[\x00-\x1f\x7f]/.test(v.fontFamily) ||
    ![400, 600, 700].includes(v.fontWeight)
  )
    throw Error('水印预设无效');
  const { capturedAt: _timestamp, ...style } = watermarkStyle({ ...v, capturedAt: 0 });
  return {
    ...style,
    text: v.text,
    color: v.color,
    fontSize: v.fontSize,
    fontFamily: v.fontFamily,
    fontWeight: v.fontWeight,
  };
}
export function watermarkStyle(value: unknown): WatermarkStyle {
  const v = value as WatermarkStyle;
  if (
    !v ||
    !watermarkPositions.includes(v.position) ||
    !Number.isFinite(v.opacity) ||
    v.opacity < 0 ||
    v.opacity > 1 ||
    !Number.isFinite(v.angle) ||
    Math.abs(v.angle) > 90 ||
    !Number.isFinite(v.spacing) ||
    v.spacing < 8 ||
    v.spacing > 600 ||
    !Number.isSafeInteger(v.capturedAt) ||
    v.capturedAt < 0 ||
    v.capturedAt > 8640000000000000
  )
    throw Error('水印设置无效');
  return {
    position: v.position,
    opacity: v.opacity,
    angle: v.angle,
    spacing: v.spacing,
    capturedAt: v.capturedAt,
    ...(v.image !== undefined ? { image: watermarkImage(v.image) } : {}),
  };
}
export function annotationFont(size: number, family = 'Segoe UI', weight = 400, italic = false) {
  return `${italic ? 'italic ' : ''}${weight} ${size}px ${JSON.stringify(family)}, "Microsoft YaHei UI", sans-serif`;
}
export const watermarkTimeFormats = [
  { name: 'ISO 24h', format: 'yyyy-MM-dd HH:mm:ss' },
  { name: 'Slash 24h', format: 'yyyy/MM/dd HH:mm:ss' },
  { name: 'EU 24h', format: 'dd/MM/yyyy HH:mm:ss' },
  { name: 'US 24h', format: 'MM/dd/yyyy HH:mm:ss' },
  { name: 'Date', format: 'yyyy-MM-dd' },
  { name: 'Time', format: 'HH:mm:ss' },
  { name: 'Time 12h', format: 'hh:mm:ss AP' },
  { name: 'Weekday', format: 'dddd' },
  { name: 'Millis', format: 'yyyy-MM-dd HH:mm:ss.zzz' },
  { name: 'Compact', format: 'yyyyMMdd_HHmmss' },
  { name: 'US 12h', format: 'MM/dd/yyyy hh:mm:ss AP' },
] as const;
/** Resolve date placeholders once against the capture's timestamp, never export time. */
export function watermarkText(text: string, capturedAt: number) {
  const date = new Date(capturedAt),
    pad = (n: number) => String(n).padStart(2, '0');
  const fields: Record<string, string> = {
    yyyy: String(date.getFullYear()),
    MM: pad(date.getMonth() + 1),
    dd: pad(date.getDate()),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds()),
    yy: pad(date.getFullYear() % 100),
    M: String(date.getMonth() + 1),
    d: String(date.getDate()),
    H: String(date.getHours()),
    hh: pad(date.getHours() % 12 || 12),
    h: String(date.getHours() % 12 || 12),
    m: String(date.getMinutes()),
    s: String(date.getSeconds()),
    zzz: String(date.getMilliseconds()).padStart(3, '0'),
    z: String(date.getMilliseconds()),
    dddd: new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(date),
    ddd: new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date),
    AP: date.getHours() < 12 ? 'AM' : 'PM',
    ap: date.getHours() < 12 ? 'am' : 'pm',
  };
  return text.replace(/\$([^$\n]+)\$/g, (_match, format: string) =>
    format.replace(
      /yyyy|dddd|ddd|zzz|yy|MM|dd|HH|hh|mm|ss|AP|ap|M|d|H|h|m|s|z/g,
      (key) => fields[key],
    ),
  );
}
/** Rotated layout uses a centered anchor. Every tile stays on a regular grid;
 * clipping is the caller's selection, so partial tiles at edges are intentional. */
export function watermarkAnchors(
  rect: Rectangle,
  text: { width: number; height: number },
  style: WatermarkStyle,
  custom: { x: number; y: number },
) {
  if (style.position === 'custom')
    return [{ x: custom.x + text.width / 2, y: custom.y + text.height / 2 }];
  const radians = (style.angle * Math.PI) / 180;
  const width =
    Math.abs(text.width * Math.cos(radians)) + Math.abs(text.height * Math.sin(radians));
  const height =
    Math.abs(text.width * Math.sin(radians)) + Math.abs(text.height * Math.cos(radians));
  if (style.position === 'tile') {
    const dx = Math.max(16, width + style.spacing),
      dy = Math.max(16, height + style.spacing);
    const points: { x: number; y: number }[] = [];
    for (let row = 0, y = rect.y; y <= rect.y + rect.height + height / 2; row++, y += dy)
      for (let x = rect.x - (row % 2 ? dx / 2 : 0); x <= rect.x + rect.width + width / 2; x += dx) {
        if (points.length >= 20000) throw Error('水印过于密集，请增大间距');
        points.push({ x, y });
      }
    return points;
  }
  const left = style.position.includes('left'),
    right = style.position.includes('right'),
    top = style.position.includes('top'),
    bottom = style.position.includes('bottom'),
    margin = 16;
  return [
    {
      x:
        rect.x +
        (left ? margin + width / 2 : right ? rect.width - margin - width / 2 : rect.width / 2),
      y:
        rect.y +
        (top ? margin + height / 2 : bottom ? rect.height - margin - height / 2 : rect.height / 2),
    },
  ];
}
