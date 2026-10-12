import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, lstat, stat, open, unlink, type FileHandle } from 'node:fs/promises';
import { join, dirname, resolve, delimiter } from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { limitChildProcess } from '../capture/native';
import { commitRecording } from '../media-file';
import { RECORD_BYTES } from '../../shared/recording/recording';
import { exportAudioFilters, type RecordingExportPlan } from '../../shared/recording/recording-export';
import type { PlaybackSettings } from '../../shared/recording/recording-playback';
import { animateRecordingWebp } from '../../shared/recording/recording-webp';
import { Worker } from 'node:worker_threads';

const run = promisify(execFile);
async function readExactly(file: FileHandle, buffer: Buffer, length: number, position: number) {
  let read = 0;
  while (read < length) {
    const { bytesRead } = await file.read(buffer, read, length - read, position + read);
    if (!bytesRead) throw Error('WebP 合成结果不完整');
    read += bytesRead;
  }
}
const encoderCapabilities = new Map<string, { identity: string; names: Set<string> }>();
export interface ExportAudioFile {
  kind: 'mixed' | 'system' | 'microphone';
  path: string;
}
export async function resolveRecordingEncoder(bundledDirectory: string) {
  const names = [
    join(bundledDirectory, 'ffmpeg.exe'),
    ...(process.env.PATH || '')
      .split(delimiter)
      .filter(Boolean)
      .map((folder) => join(folder, 'ffmpeg.exe')),
  ];
  for (const path of names) {
    try {
      await access(path);
      return resolve(path);
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code || '')) {
        console.warn('One encoder lookup failed:', (error as Error).message);
        throw Error('无法读取合成编码器，请检查 FFmpeg 安装权限后重试。原片仍已保留。');
      }
    }
  }
  throw Error('未找到合成编码器，请安装 FFmpeg 并重启 One 后重试。原片与工程仍已保留。');
}
export async function checkRecordingEncoder(
  executable: string,
  format: RecordingExportPlan['format'],
  signal?: AbortSignal,
) {
  let names: Set<string>;
  try {
    const info = await stat(executable),
      identity = [info.dev, info.ino, info.size, info.mtimeMs].join(':'),
      cached = encoderCapabilities.get(executable);
    if (cached?.identity === identity) names = cached.names;
    else {
      const { stdout } = await run(executable, ['-hide_banner', '-encoders'], {
        windowsHide: true,
        timeout: 12000,
        maxBuffer: 256 * 1024,
        signal,
      });
      names = new Set([...stdout.matchAll(/^\s*[VA][A-Z.]{5}\s+(\S+)/gm)].map((match) => match[1]));
      encoderCapabilities.set(executable, { identity, names });
    }
  } catch (error) {
    if (signal?.aborted) throw Error('合成导出已取消');
    console.warn('One encoder probe failed:', (error as Error).message);
    throw Error('无法启动合成编码器，请检查 FFmpeg 安装后重试。原片仍已保留。');
  }
  const required =
    format === 'mp4' ? ['libx264', 'aac'] : format === 'webp' ? ['libwebp_anim'] : ['gif'];
  for (const name of required)
    if (!names.has(name))
      throw Error(`当前 FFmpeg 缺少 ${name} 编码器，请更换完整版本后重试。原片仍已保留。`);
}
export function recordingEncoderArguments(
  plan: RecordingExportPlan,
  output: string,
  settings: PlaybackSettings,
  audio: ExportAudioFile[],
) {
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-nostats',
    '-progress',
    'pipe:1',
    '-filter_complex_threads',
    '1',
    '-threads',
    '2',
    '-protocol_whitelist',
    'file,pipe',
    '-f',
    'rawvideo',
    '-pixel_format',
    'rgba',
    '-video_size',
    `${plan.width}x${plan.height}`,
    '-framerate',
    String(plan.fps),
    '-i',
    'pipe:0',
  ];
  if (plan.format === 'mp4')
    for (const file of audio) args.push('-protocol_whitelist', 'file,pipe', '-i', file.path);
  if (plan.format === 'gif') {
    const dither = plan.quality === 'light' ? 'bayer:bayer_scale=3' : 'sierra2_4a';
    args.push(
      '-filter_complex',
      `[0:v]split[palette_input][image];[palette_input]palettegen=max_colors=${plan.colors}:stats_mode=single:reserve_transparent=0[palette];[image][palette]paletteuse=new=1:dither=${dither}[video]`,
      '-map',
      '[video]',
      '-an',
      '-loop',
      '0',
      '-f',
      'gif',
    );
  } else if (plan.format === 'webp') {
    args.push(
      '-map',
      '0:v:0',
      '-an',
      '-c:v',
      'libwebp_anim',
      '-quality',
      String(plan.webpQuality),
      '-lossless',
      '0',
      '-compression_level',
      plan.quality === 'light' ? '4' : '6',
      '-loop',
      '0',
      '-f',
      'webp',
    );
  } else {
    const mix = exportAudioFilters(
      settings,
      audio.map((file, i) => ({ kind: file.kind, input: i + 1 })),
      plan.seconds,
      plan.start,
    );
    if (mix.filter) args.push('-filter_complex', mix.filter);
    args.push('-map', '0:v:0');
    if (mix.label)
      args.push(
        '-map',
        mix.label,
        '-c:a',
        'aac',
        '-b:a',
        String(plan.audioBitrate),
        '-ar',
        '48000',
      );
    else args.push('-an');
    args.push(
      '-c:v',
      'libx264',
      '-preset',
      plan.quality === 'light' ? 'veryfast' : 'medium',
      '-crf',
      String(plan.crf),
      '-pix_fmt',
      'yuv420p',
      '-vf',
      'scale=in_range=pc:out_range=tv:out_color_matrix=bt709',
      '-colorspace',
      'bt709',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'bt709',
      '-color_range',
      'tv',
      '-threads',
      '2',
      '-movflags',
      '+faststart',
      '-f',
      'mp4',
    );
  }
  args.push('-frames:v', String(plan.frames), '-fs', String(RECORD_BYTES), '-n', output);
  return args;
}
async function destinationIdentity(path: string) {
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (info && (!info.isFile() || info.isSymbolicLink()))
    throw Error('目标不是普通文件，请选择其他位置');
  return info ? [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(':') : undefined;
}
/** Bounded raw-frame pipe; it never opens or replaces a source recording. */
export class RecordingEncoder {
  readonly stage: string;
  private child?: ChildProcessWithoutNullStreams;
  private release?: () => void;
  private closed?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private cancelled = false;
  private done = false;
  private writing = false;
  private frames = 0;
  private encodedFrames = 0;
  private tail = '';
  private outputLine = '';
  private original?: string;
  private failure?: Error;
  private gifWorker?: Worker;
  private gifFile?: FileHandle;
  private gifBytes = 0;
  bytes = 0;
  private maximumBytes = RECORD_BYTES;
  private constructor(
    readonly plan: RecordingExportPlan,
    readonly destination: string,
    private progress: (frames: number) => void,
    id: string,
  ) {
    this.stage = join(dirname(destination), '.One-compose-' + id + '.part');
  }
  static async create(
    executable: string,
    plan: RecordingExportPlan,
    destination: string,
    settings: PlaybackSettings,
    audio: ExportAudioFile[],
    progress: (frames: number) => void = () => {},
    id: string = randomUUID(),
    gifWorkerPath = join(
      typeof __dirname === 'string' ? __dirname : resolve('dist/main'),
      'recording/recording-gif-worker.cjs',
    ),
    maximumBytes = RECORD_BYTES,
  ) {
    if (
      !Number.isSafeInteger(plan.width) ||
      !Number.isSafeInteger(plan.height) ||
      plan.width < 2 ||
      plan.height < 2 ||
      plan.width > 8192 ||
      plan.height > 8192 ||
      plan.width * plan.height > 40_000_000 ||
      !Number.isFinite(plan.fps) ||
      plan.fps <= 0 ||
      plan.fps > 120 ||
      !Number.isSafeInteger(plan.frames) ||
      plan.frames < 1 ||
      plan.frames > 1728480 ||
      !Number.isFinite(plan.start) ||
      plan.start < 0 ||
      plan.start > 3601 ||
      !Number.isFinite(plan.seconds) ||
      plan.seconds <= 0
    )
      throw Error('合成尺寸或时间无效');
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('合成任务编号无效');
    const encoder = new RecordingEncoder(plan, resolve(destination), progress, id);
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 12 || maximumBytes > RECORD_BYTES)
      throw Error('合成容量限制无效');
    encoder.maximumBytes = maximumBytes;
    encoder.original = await destinationIdentity(destination);
    if (plan.timeline) {
      if (
        plan.format !== 'gif' ||
        plan.timeline.length !== plan.frames ||
        plan.frames > 19998 ||
        ![16, 32, 64, 128, 256].includes(plan.colors)
      )
        throw Error('GIF 合成时间轴无效');
      if (
        !Number.isSafeInteger(plan.repeat) ||
        plan.repeat! < -1 ||
        plan.repeat! > 65535 ||
        plan.timeline.some(
          (frame) =>
            !Number.isFinite(frame.source) ||
            frame.source < 0 ||
            frame.source >= 3601 ||
            !Number.isSafeInteger(frame.delay) ||
            frame.delay < 2 ||
            frame.delay > 24000,
        )
      )
        throw Error('GIF 合成帧时间无效');
      const seconds = plan.timeline.reduce((sum, frame) => sum + frame.delay / 100, 0);
      if (Math.abs(seconds - plan.seconds) > 1e-6) throw Error('GIF 合成时长无效');
      try {
        encoder.gifFile = await open(encoder.stage, 'wx');
        encoder.gifWorker = new Worker(gifWorkerPath, {
          resourceLimits: { maxOldGenerationSizeMb: 512 },
        });
        encoder.gifWorker.on('error', (error) => {
          encoder.failure = error;
        });
        encoder.gifWorker.on('exit', () => {
          if (!encoder.done && !encoder.cancelled) encoder.failure = Error('GIF 编码器已退出');
        });
        encoder.watch();
        return encoder;
      } catch (error) {
        await encoder.cancel();
        throw error;
      }
    }
    const child = spawn(
      executable,
      recordingEncoderArguments(plan, encoder.stage, settings, audio),
      { windowsHide: true, stdio: 'pipe' },
    );
    encoder.child = child;
    encoder.closed = new Promise<void>((accept, reject) => {
      child.once('error', (error) => {
        encoder.failure = error;
        reject(error);
      });
      child.once('close', (code) => {
        clearTimeout(encoder.timer);
        if (encoder.cancelled) reject(encoder.failure || Error('合成导出已取消'));
        else if (code !== 0) {
          console.warn('One composition encoder failed:', encoder.tail);
          encoder.failure = Error('合成编码失败，请重试。原片与工程仍已保留。');
          reject(encoder.failure);
        } else accept();
      });
    });
    void encoder.closed.catch(() => {});
    child.stdin.on('error', () => {});
    child.stderr.on('data', (bytes) => {
      encoder.tail = (encoder.tail + bytes.toString('utf8')).slice(-8192);
    });
    child.stdout.on('data', (bytes) => {
      encoder.outputLine = (encoder.outputLine + bytes.toString('utf8')).slice(-8192);
      let end = encoder.outputLine.indexOf('\n');
      while (end >= 0) {
        const line = encoder.outputLine.slice(0, end).trim();
        encoder.outputLine = encoder.outputLine.slice(end + 1);
        if (/^frame=\d+$/.test(line)) {
          encoder.encodedFrames = Number(line.slice(6));
          encoder.progress(encoder.encodedFrames);
          encoder.watch();
        }
        end = encoder.outputLine.indexOf('\n');
      }
    });
    try {
      await new Promise<void>((accept, reject) => {
        child.once('spawn', accept);
        child.once('error', reject);
      });
      encoder.release = limitChildProcess(child.pid!, 768);
      encoder.watch();
      return encoder;
    } catch (error) {
      await encoder.cancel();
      throw error;
    }
  }
  private watch() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.failure = Error('合成编码器响应超时，请重试。原片仍已保留。');
      void this.cancel();
    }, 60000);
  }
  async frame(index: number, value: unknown) {
    if (this.cancelled || this.done || this.failure) throw this.failure || Error('合成导出已结束');
    if (
      this.writing ||
      !Number.isSafeInteger(index) ||
      index !== this.frames ||
      index >= this.plan.frames ||
      !(value instanceof Uint8Array) ||
      value.byteLength !== this.plan.width * this.plan.height * 4
    )
      throw Error('合成帧顺序或尺寸无效');
    this.writing = true;
    this.watch();
    try {
      if (this.gifWorker) {
        const worker = this.gifWorker;
        const bytes = await new Promise<Uint8Array>((accept, reject) => {
          const cleanup = () => {
            worker.off('message', message);
            worker.off('error', fail);
            worker.off('exit', exit);
          };
          const fail = (error: Error) => {
            cleanup();
            reject(error);
          };
          const exit = () => fail(Error('GIF 编码已中断'));
          const message = (result: { bytes?: Uint8Array; error?: string }) => {
            cleanup();
            if (result.error || !(result.bytes instanceof Uint8Array))
              reject(Error(result.error || 'GIF 编码失败'));
            else accept(result.bytes);
          };
          worker.once('message', message);
          worker.once('error', fail);
          worker.once('exit', exit);
          worker.postMessage({
            rgba: value,
            width: this.plan.width,
            height: this.plan.height,
            colors: this.plan.colors,
            delay: this.plan.timeline![index].delay,
            repeat: this.plan.repeat,
            optimize: this.plan.gifOutput?.optimize || false,
            first: index === 0,
            last: index === this.plan.frames - 1,
          });
        });
        if (this.cancelled || this.failure) throw this.failure || Error('合成导出已取消');
        this.gifBytes += bytes.length;
        if (this.gifBytes > this.maximumBytes)
          throw Error('GIF 合成结果已达到容量上限，请降低输出尺寸或色数');
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesWritten } = await this.gifFile!.write(bytes, offset, bytes.length - offset);
          if (!bytesWritten) throw Error('无法写入 GIF 动画');
          offset += bytesWritten;
        }
        this.frames++;
        this.progress(this.frames);
        return;
      }
      await new Promise<void>((accept, reject) =>
        this.child!.stdin.write(value, (error) => (error ? reject(error) : accept())),
      );
      this.frames++;
    } finally {
      this.writing = false;
    }
  }
  async finish(valid: () => boolean = () => true) {
    if (this.done || this.cancelled || this.writing || this.frames !== this.plan.frames)
      throw Error('合成帧不完整或导出已结束');
    this.child?.stdin.end();
    this.watch();
    try {
      await this.closed;
      // libwebp_anim emits one final packet for the entire animation, not one per input frame.
      if (!this.gifFile && this.plan.format !== 'webp' && this.encodedFrames < this.plan.frames)
        throw Error('合成结果未完成，可能已达到容量上限');
      await this.gifFile?.sync();
      await this.gifFile?.close();
      this.gifFile = undefined;
      const file = await open(this.stage, 'r+');
      try {
        const info = await file.stat();
        if (info.size < 12 || info.size > this.maximumBytes) throw Error('合成结果大小无效');
        this.bytes = info.size;
        if (this.plan.format === 'webp') {
          const header = Buffer.alloc(24);
          await readExactly(file, header, 12, 0);
          if (
            header.toString('ascii', 0, 4) !== 'RIFF' ||
            header.toString('ascii', 8, 12) !== 'WEBP' ||
            header.readUInt32LE(4) + 8 !== info.size
          )
            throw Error('WebP 合成结果不完整');
          let offset = 12,
            duration = 0,
            frames = 0;
          while (offset + 8 <= info.size) {
            if (this.cancelled) throw Error('合成导出已取消');
            await readExactly(file, header, 8, offset);
            const size = header.readUInt32LE(4);
            if (offset + 8 + size + (size % 2) > info.size) throw Error('WebP 合成分块不完整');
            if (header.toString('ascii', 0, 4) === 'ANMF') {
              if (size < 16) throw Error('WebP 动画帧无效');
              await readExactly(file, header, 16, offset + 8);
              duration += header.readUIntLE(12, 3);
              frames++;
              if (frames % 128 === 0) {
                this.progress(this.encodedFrames);
                this.watch();
              }
            }
            offset += 8 + size + (size % 2);
          }
          if (!frames) {
            if (info.size > 64 * 1024 * 1024) throw Error('静态 WebP 素材容量无效');
            const still = Buffer.alloc(info.size);
            await readExactly(file, still, still.length, 0);
            const animated = animateRecordingWebp(
              still,
              this.plan.width,
              this.plan.height,
              Math.max(1, Math.round(this.plan.seconds * 1000)),
            );
            let written = 0;
            while (written < animated.length) {
              const result = await file.write(
                animated,
                written,
                animated.length - written,
                written,
              );
              if (!result.bytesWritten) throw Error('无法写入 WebP 动画');
              written += result.bytesWritten;
            }
            await file.truncate(animated.length);
            frames = 1;
            duration = Math.max(1, Math.round(this.plan.seconds * 1000));
          }
          if (
            offset !== info.size ||
            (frames && Math.abs(duration - this.plan.seconds * 1000) > 1000 / this.plan.fps + 2)
          )
            throw Error('WebP 动画时长不完整');
        }
        await file.sync();
      } finally {
        await file.close();
      }
      if (!valid() || this.cancelled) throw Error('合成导出已取消');
      if ((await destinationIdentity(this.destination)) !== this.original)
        throw Error('目标文件已发生变化，请重新选择保存位置');
      if (!valid() || this.cancelled) throw Error('合成导出已取消');
      commitRecording(this.stage, this.destination, this.original !== undefined);
      this.done = true;
      return this.destination;
    } finally {
      clearTimeout(this.timer);
      this.release?.();
      this.release = undefined;
      await this.gifWorker?.terminate();
      this.gifWorker = undefined;
      await this.gifFile?.close();
      this.gifFile = undefined;
      await unlink(this.stage).catch(() => {});
    }
  }
  async cancel() {
    if (this.done) return;
    this.cancelled = true;
    clearTimeout(this.timer);
    this.release?.();
    this.release = undefined;
    if (this.child && this.child.exitCode === null) this.child.kill();
    await this.gifWorker?.terminate();
    this.gifWorker = undefined;
    await this.gifFile?.close();
    this.gifFile = undefined;
    await this.closed?.catch(() => {});
    await unlink(this.stage).catch(() => {});
  }
}
