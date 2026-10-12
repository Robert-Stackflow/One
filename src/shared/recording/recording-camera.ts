import type { VideoReady } from './native-video';
export interface CameraDevice {
  id: string;
  name: string;
}
export interface CameraStyle {
  visible: boolean;
  x: number;
  y: number;
  width: number;
  shape: 'rectangle' | 'rounded' | 'circle';
  mirror: boolean;
  border: number;
  color: string;
  shadow: boolean;
  opacity: number;
}
export interface CameraOptions {
  deviceId: string;
  style: CameraStyle;
}
export interface CameraLayout {
  sample: number;
  style: CameraStyle;
}
export const defaultCameraStyle = (): CameraStyle => ({
  visible: true,
  x: 0.72,
  y: 0.7,
  width: 0.24,
  shape: 'rounded',
  mirror: true,
  border: 2,
  color: '#FFFFFF',
  shadow: true,
  opacity: 1,
});
export function cameraStyle(value: unknown): CameraStyle {
  const v = value as CameraStyle;
  if (
    !v ||
    ![v.x, v.y, v.width, v.opacity, v.border].every(Number.isFinite) ||
    v.x < 0 ||
    v.x > 1 ||
    v.y < 0 ||
    v.y > 1 ||
    v.width < 0.1 ||
    v.width > 0.6 ||
    v.opacity < 0.1 ||
    v.opacity > 1 ||
    v.border < 0 ||
    v.border > 8 ||
    !['rectangle', 'rounded', 'circle'].includes(v.shape) ||
    typeof v.visible !== 'boolean' ||
    typeof v.mirror !== 'boolean' ||
    typeof v.shadow !== 'boolean' ||
    typeof v.color !== 'string' ||
    !/^#[\da-f]{6}$/i.test(v.color)
  )
    throw Error('摄像头外观设置无效');
  return {
    visible: v.visible,
    x: v.x,
    y: v.y,
    width: v.width,
    shape: v.shape,
    mirror: v.mirror,
    border: v.border,
    color: v.color.toUpperCase(),
    shadow: v.shadow,
    opacity: v.opacity,
  };
}
export function cameraOptions(value: unknown): CameraOptions {
  const v = value as CameraOptions;
  if (
    !v ||
    typeof v.deviceId !== 'string' ||
    !v.deviceId ||
    v.deviceId === 'none' ||
    v.deviceId.length > 2048 ||
    /[\x00-\x1f]/.test(v.deviceId)
  )
    throw Error('请选择有效的摄像头');
  return { deviceId: v.deviceId, style: cameraStyle(v.style) };
}
export function cameraDevices(value: unknown): CameraDevice[] {
  if (!Array.isArray(value) || value.length > 64) throw Error('摄像头设备响应无效');
  const seen = new Set<string>();
  return value.map((v) => {
    if (
      !v ||
      typeof v.id !== 'string' ||
      !v.id ||
      v.id.length > 2048 ||
      /[\x00-\x1f]/.test(v.id) ||
      typeof v.name !== 'string' ||
      !v.name ||
      v.name.length > 2048 ||
      seen.has(v.id)
    )
      throw Error('摄像头设备响应无效');
    seen.add(v.id);
    return { id: v.id, name: v.name };
  });
}
/** Keep the camera entirely inside the encoded screen, including portrait regions. */
export function cameraBox(
  style: CameraStyle,
  camera: Pick<VideoReady, 'width' | 'height'>,
  video: Pick<VideoReady, 'width' | 'height'>,
) {
  const ratio = style.shape === 'circle' ? 1 : camera.width / camera.height;
  const width = Math.min(
      style.width * video.width,
      video.height * ratio * 0.85,
      video.width * 0.85,
    ),
    height = width / ratio;
  return {
    x: Math.max(0, Math.min(style.x * video.width, video.width - width)),
    y: Math.max(0, Math.min(style.y * video.height, video.height - height)),
    width,
    height,
  };
}
export function cameraAt(events: readonly CameraLayout[], sample: number, fallback: CameraStyle) {
  let l = 0,
    r = events.length;
  while (l < r) {
    const m = (l + r) >>> 1;
    if (events[m].sample <= sample) l = m + 1;
    else r = m;
  }
  return l ? events[l - 1].style : fallback;
}
