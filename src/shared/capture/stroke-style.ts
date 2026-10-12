export const strokeStyles = [
  { value: 'solid', label: '实线' },
  { value: 'dashed', label: '短虚线' },
  { value: 'long-dash', label: '长虚线' },
  { value: 'dotted', label: '点线' },
  { value: 'dash-dot', label: '点划线' },
  { value: 'double', label: '双线' },
  { value: 'wavy', label: '波浪线' },
] as const;
export type StrokeStyle = (typeof strokeStyles)[number]['value'];
export function strokeDash(style: StrokeStyle, width: number): number[] {
  switch (style) {
    case 'dashed':
      return [width * 3, width * 2.5];
    case 'long-dash':
      return [width * 7, width * 3];
    case 'dotted':
      return [0, width * 2.5];
    case 'dash-dot':
      return [width * 5, width * 2.5, 0, width * 2.5];
    default:
      return [];
  }
}
/** Half the painted envelope, used by selection and hit testing as well as rendering. */
export function strokeRadius(style: StrokeStyle | undefined, width: number): number {
  return width * (style === 'double' ? 1.5 : style === 'wavy' ? 2 : 0.5);
}
