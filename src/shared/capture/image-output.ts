import { imageDimensions } from './image-limits';
export interface OutputEffects {
  radius: number;
  border: { width: number; color: string };
  shadow: { enabled: boolean; blur: number; x: number; y: number; opacity: number; color: string };
}
export const defaultEffects = (): OutputEffects => ({
  radius: 0,
  border: { width: 0, color: '#303030' },
  shadow: { enabled: false, blur: 16, x: 0, y: 8, opacity: 0.24, color: '#000000' },
});
export function outputEffects(value: unknown): OutputEffects {
  const v = value as OutputEffects;
  const integer = (n: number, min: number, max: number) =>
    Number.isSafeInteger(n) && n >= min && n <= max;
  const color = (s: string) => typeof s === 'string' && /^#[\da-f]{6}$/i.test(s);
  if (
    !v ||
    !v.border ||
    !v.shadow ||
    !integer(v.radius, 0, 2048) ||
    !integer(v.border.width, 0, 64) ||
    !color(v.border.color) ||
    typeof v.shadow.enabled !== 'boolean' ||
    !integer(v.shadow.blur, 0, 80) ||
    !integer(v.shadow.x, -80, 80) ||
    !integer(v.shadow.y, -80, 80) ||
    !color(v.shadow.color) ||
    !Number.isFinite(v.shadow.opacity) ||
    v.shadow.opacity < 0 ||
    v.shadow.opacity > 1
  )
    throw Error('输出效果无效');
  return { radius: v.radius, border: { ...v.border }, shadow: { ...v.shadow } };
}
/** Border is inside the image. Shadow adds transparent physical pixels outside it. */
export function outputLayout(width: number, height: number, value: OutputEffects) {
  imageDimensions(width, height);
  const effects = outputEffects(value),
    s = effects.shadow;
  const enabled = s.enabled && s.opacity > 0;
  const extent = enabled ? s.blur * 3 : 0;
  const left = enabled ? Math.max(0, extent - s.x) : 0;
  const right = enabled ? Math.max(0, extent + s.x) : 0;
  const top = enabled ? Math.max(0, extent - s.y) : 0;
  const bottom = enabled ? Math.max(0, extent + s.y) : 0;
  return {
    ...imageDimensions(width + left + right, height + top + bottom),
    x: left,
    y: top,
    radius: Math.min(effects.radius, width / 2, height / 2),
    borderWidth: Math.min(effects.border.width, width / 2, height / 2),
  };
}
