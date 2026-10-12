/** GIF edits use source timestamps and integer centiseconds, independently of source FPS. */
export interface GifFrame {
  source: number;
  delay: number;
}
export interface GifEdit {
  output?: GifOutput;
  frames: GifFrame[];
  direction: 'forward' | 'reverse' | 'pingpong';
  /** -1 plays once; 0 loops forever; positive values count additional repeats. */
  repeat: number;
}
export interface GifText {
  text: string;
  position:
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-center'
    | 'bottom-right';
  size: number;
  color: string;
  opacity: number;
}
export interface GifOutput {
  width?: number;
  colors?: 16 | 32 | 64 | 128 | 256;
  optimize: boolean;
  crop?: { x: number; y: number; width: number; height: number };
  caption?: GifText;
  watermark?: GifText;
}
export function gifOutput(value: unknown, video?: { width: number; height: number }): GifOutput {
  const v = value as GifOutput;
  if (
    !v ||
    (v.colors !== undefined && ![16, 32, 64, 128, 256].includes(v.colors)) ||
    typeof v.optimize !== 'boolean' ||
    (v.width !== undefined && (!Number.isSafeInteger(v.width) || v.width < 2 || v.width > 8192))
  )
    throw Error('GIF 输出参数无效');
  const crop = v.crop;
  if (
    crop !== undefined &&
    (!crop ||
      ![crop.x, crop.y, crop.width, crop.height].every(Number.isSafeInteger) ||
      crop.x < 0 ||
      crop.y < 0 ||
      crop.width < 2 ||
      crop.height < 2 ||
      crop.x + crop.width > (video?.width ?? 8192) ||
      crop.y + crop.height > (video?.height ?? 8192))
  )
    throw Error('GIF 裁剪范围超出原片');
  const text = (input: GifText): GifText => {
    if (
      !input ||
      typeof input.text !== 'string' ||
      input.text.length > 120 ||
      /[\x00-\x1f\x7f]/.test(input.text) ||
      ![
        'top-left',
        'top-center',
        'top-right',
        'bottom-left',
        'bottom-center',
        'bottom-right',
      ].includes(input.position) ||
      !Number.isSafeInteger(input.size) ||
      input.size < 12 ||
      input.size > 128 ||
      typeof input.color !== 'string' ||
      !/^#[\da-f]{6}$/i.test(input.color) ||
      !Number.isFinite(input.opacity) ||
      input.opacity < 0.05 ||
      input.opacity > 1
    )
      throw Error('GIF 文字或水印无效');
    return {
      text: input.text.trim(),
      position: input.position,
      size: input.size,
      color: input.color,
      opacity: input.opacity,
    };
  };
  return {
    ...(v.colors === undefined ? {} : { colors: v.colors }),
    optimize: v.optimize,
    ...(v.width === undefined ? {} : { width: v.width }),
    ...(crop ? { crop: { x: crop.x, y: crop.y, width: crop.width, height: crop.height } } : {}),
    ...(v.caption === undefined ? {} : { caption: text(v.caption) }),
    ...(v.watermark === undefined ? {} : { watermark: text(v.watermark) }),
  };
}
export const GIF_FRAME_LIMIT = 10000;
export function gifEdit(
  value: unknown,
  seconds = 3601,
  video?: { width: number; height: number },
): GifEdit {
  const v = value as GifEdit;
  if (
    !v ||
    !Array.isArray(v.frames) ||
    !v.frames.length ||
    v.frames.length > GIF_FRAME_LIMIT ||
    !['forward', 'reverse', 'pingpong'].includes(v.direction) ||
    !Number.isSafeInteger(v.repeat) ||
    v.repeat < -1 ||
    v.repeat > 65535
  )
    throw Error('GIF 帧编辑无效');
  const frames = v.frames.map((frame) => {
    if (
      !frame ||
      !Number.isFinite(frame.source) ||
      frame.source < 0 ||
      frame.source >= seconds ||
      !Number.isSafeInteger(frame.delay) ||
      frame.delay < 2 ||
      frame.delay > 6000
    )
      throw Error('GIF 帧时间或延时无效');
    return { source: frame.source, delay: frame.delay };
  });
  return {
    frames,
    direction: v.direction,
    repeat: v.repeat,
    ...(v.output === undefined ? {} : { output: gifOutput(v.output, video) }),
  };
}
export function gifSequence(edit: GifEdit, speed: number): GifFrame[] {
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) throw Error('GIF 速度无效');
  const frames = edit.direction === 'reverse' ? edit.frames.slice().reverse() : edit.frames.slice();
  if (edit.direction === 'pingpong' && frames.length > 2)
    frames.push(...edit.frames.slice(1, -1).reverse());
  let time = 0,
    previous = 0;
  return frames.map((frame) => {
    time += frame.delay / speed;
    const next = Math.round(time),
      delay = Math.max(2, next - previous);
    previous = next;
    return { ...frame, delay };
  });
}
export function gifFrames(start: number, end: number, fps: number): GifEdit {
  const count = Math.ceil((end - start) * fps - 1e-8);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <= start ||
    end > 3601 ||
    !Number.isFinite(fps) ||
    fps < 1 ||
    fps > 50 ||
    count > GIF_FRAME_LIMIT
  )
    throw Error('请缩短片段或降低抽帧率，最多编辑 10000 帧');
  return gifEdit(
    {
      direction: 'forward',
      repeat: 0,
      frames: Array.from({ length: count }, (_, index) => ({
        source: start + index / fps,
        delay: Math.max(
          2,
          Math.round(Math.min((index + 1) / fps, end - start) * 100) -
            Math.round((index / fps) * 100),
        ),
      })),
    },
    end,
  );
}
