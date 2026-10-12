import { execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import {
  mkdir,
  writeFile,
  rm,
  open,
  lstat,
  unlink,
  readFile,
  rename,
  appendFile,
} from 'node:fs/promises';
import {
  annotationScene,
  annotationDelta,
  type AnnotationEvent,
  type RecordingAnnotationFrame,
} from '../../shared/recording/recording-annotations';
import type { Annotation } from '../../shared/capture/image-document';
import { moveRecordingRegion } from '../../shared/recording/recording-region';
import type { Rectangle } from '../../shared/capture/region';
import { completeVideoPrefix } from './video-fragments';
import { NativeMedia } from './native-media';
import { loadNativeCursor } from './native-cursor';
import type { RecordingCursor } from '../../shared/recording/recording-cursor';
import { videoReady, type VideoReady, type NativeVideoTarget } from '../../shared/recording/native-video';
import type { AudioProgress } from '../../shared/recording/native-audio';
import { recordingOptions, type RecordingOptions } from '../../shared/recording/recording';
import {
  recordingInput,
  inputStyle,
  inputFlags,
  defaultInputStyle,
  type InputStyle,
  type RecordingInput,
} from '../../shared/recording/recording-input';
import {
  cameraDevices as parseCameras,
  cameraStyle,
  type CameraLayout,
  type CameraStyle,
} from '../../shared/recording/recording-camera';
import type { RecordingFile } from './recording-file';
const executable = () =>
  join(__dirname, '../native/One.RecordingVideo.exe').replace('app.asar', 'app.asar.unpacked');
export async function cameraDevices() {
  const result = await promisify(execFile)(executable(), ['cameras'], {
    windowsHide: true,
    timeout: 8000,
    maxBuffer: 512 * 1024,
  });
  return parseCameras(JSON.parse(result.stdout));
}
export class NativeVideo extends NativeMedia {
  private frameTask?: Promise<RecordingAnnotationFrame>;
  private frameAt = 0;
  private framePending = false;
  annotationFrame(): Promise<RecordingAnnotationFrame> {
    if (this.frameTask && (this.framePending || Date.now() - this.frameAt < 100))
      return this.frameTask;
    this.frameAt = Date.now();
    this.framePending = true;
    const task = (async () => {
      await this.control('snapshot');
      const path = this.file + '.annotation.rgba',
        handle = await open(path, 'r');
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size < 12 || stat.size > 1280 * 1280 * 4 + 8)
          throw Error('标注预览帧大小无效');
        const data = await handle.readFile(),
          width = data.readUInt32LE(0),
          height = data.readUInt32LE(4);
        if (
          !width ||
          !height ||
          width > 1280 ||
          height > 1280 ||
          data.length !== 8 + width * height * 4
        )
          throw Error('标注预览帧像素无效');
        return {
          width,
          height,
          pixels: new Uint8Array(data.buffer, data.byteOffset + 8, data.length - 8),
        };
      } finally {
        await handle.close();
        await unlink(path).catch(() => {});
      }
    })();
    this.frameTask = task;
    void task
      .finally(() => {
        this.framePending = false;
        this.frameAt = Date.now();
      })
      .catch(() => {
        if (this.frameTask === task) this.frameTask = undefined;
      });
    return task;
  }
  private regionCrop?: Rectangle;
  private regionSource?: { width: number; height: number };
  private regionChain: Promise<void> = Promise.resolve();
  private queuedRegions = 0;
  private regionEvents = 0;
  private regionSample = 0;
  get movableRegion() {
    return !!this.regionSource && !!this.regionCrop;
  }
  get crop() {
    return this.regionCrop ? { ...this.regionCrop } : undefined;
  }
  async moveRegion(x: number, y: number) {
    if (!this.regionCrop || !this.regionSource || ![x, y].every(Number.isSafeInteger))
      throw Error('当前录制不支持移动区域');
    const crop = moveRecordingRegion(
      this.regionCrop,
      { x: x - this.regionCrop.x, y: y - this.regionCrop.y },
      this.regionSource,
    );
    if (crop.x !== x || crop.y !== y) throw Error('移动录制区域超出当前显示器');
    if (this.queuedRegions >= 2) throw Error('区域移动更新过于频繁');
    this.queuedRegions++;
    let receipt!: { crop: Rectangle; sample: number };
    const operation = this.regionChain.then(async () => {
      if (this.regionEvents >= 100000) throw Error('区域移动时间轴已达到上限，请停止并保存');
      await this.control(`crop ${x} ${y}`);
      receipt = { crop: this.crop!, sample: this.regionSample };
      await appendFile(join(this.directory, 'regions.jsonl'), JSON.stringify(receipt) + '\n', {
        mode: 0o600,
      });
      this.regionEvents++;
    });
    this.regionChain = operation.catch(() => {});
    try {
      await operation;
      return receipt;
    } finally {
      this.queuedRegions--;
    }
  }
  async flushRegions() {
    await this.regionChain;
  }
  override async finish() {
    await Promise.all([this.flushRegions(), this.inputChain]);
    const result = await super.finish();
    if (this.cursorEnabled && !this.pointer) {
      this.cursorRead ||= loadNativeCursor(
        this.file,
        this.info!.width,
        this.info!.height,
        result.samples,
      );
      try {
        this.pointer = await this.cursorRead;
      } catch (error) {
        console.warn('One recording cursor metadata could not be loaded:', (error as Error).message);
        return { ...result, warning: result.warning + ' 光标信息未能读取，屏幕视频已保留。' };
      }
    }
    return result;
  }
  private cursorEnabled = false;
  private pointer?: RecordingCursor;
  private cursorRead?: Promise<RecordingCursor>;
  get cursor() {
    return this.pointer;
  }
  private annotationLog: AnnotationEvent[] = [];
  private annotationMarks: Annotation[] = [];
  private annotationBytes = 0;
  private annotationChain: Promise<void> = Promise.resolve();
  private queuedAnnotations = 0;
  get annotationCount() {
    return this.annotationLog.length;
  }
  annotationEvents(after: number) {
    if (!Number.isSafeInteger(after) || after < 0 || after > this.annotationLog.length)
      throw Error('标注时间轴页码无效');
    // Bound each IPC response as well as the complete journal.
    const page: AnnotationEvent[] = [];
    let bytes = 0;
    for (const event of this.annotationLog.slice(after, after + 128)) {
      const size = Buffer.byteLength(JSON.stringify(event));
      if (bytes + size > 2 * 1024 * 1024 && page.length) break;
      page.push(event);
      bytes += size;
    }
    return structuredClone(page);
  }
  async annotate(value: unknown, valid: () => boolean) {
    if (!this.info) throw Error('标注画布尚未就绪');
    const scene = annotationScene(value, this.info.width, this.info.height);
    if (this.queuedAnnotations >= 4) throw Error('标注更新过于频繁');
    this.queuedAnnotations++;
    const operation = this.annotationChain.then(async () => {
      if (!valid() || this.terminal) throw Error('录制标注已结束');
      // Do not advance the timeline while paused; same-frame changes replay together.
      const sample = await this.markCamera();
      if (!valid()) throw Error('录制标注已结束');
      const event = annotationDelta(this.annotationMarks, scene.annotations, sample);
      if (!event) return;
      const line = JSON.stringify(event) + '\n',
        bytes = Buffer.byteLength(line);
      if (this.annotationLog.length >= 15000 || this.annotationBytes + bytes > 32 * 1024 * 1024)
        throw Error('标注时间轴已达到上限，请停止并保存');
      await appendFile(join(this.directory, 'annotations.jsonl'), line, { mode: 0o600 });
      // Optional undefined fields disappear in JSON; replay and the persisted
      // journal must expose exactly the same canonical event representation.
      this.annotationLog.push(JSON.parse(line) as AnnotationEvent);
      this.annotationMarks = scene.annotations;
      this.annotationBytes += bytes;
    });
    this.annotationChain = operation.catch(() => {});
    try {
      await operation;
    } finally {
      this.queuedAnnotations--;
    }
  }
  async flushAnnotations() {
    await this.annotationChain;
  }
  protected override async settleWrites() {
    await Promise.all([
      this.annotationChain,
      this.layoutChain,
      this.regionChain,
      this.inputChain,
      this.cursorRead?.catch(() => {}),
    ]);
  }
  private layouts: CameraLayout[] = [];
  private layoutChain: Promise<void> = Promise.resolve();
  private queuedLayouts = 0;
  cameraLayouts() {
    return this.layouts.map((v) => ({ sample: v.sample, style: { ...v.style } }));
  }
  async layoutCamera(value: unknown, valid: () => boolean) {
    const style = cameraStyle(value);
    if (this.queuedLayouts >= 4) throw Error('摄像头布局更新过于频繁');
    this.queuedLayouts++;
    const operation = this.layoutChain.then(async () => {
      if (!valid() || !this.cameraInfo || this.terminal) throw Error('摄像头会话已结束');
      const sample = await this.markCamera();
      if (!valid()) throw Error('摄像头会话已结束');
      const previous = this.layouts.slice();
      const last = this.layouts.at(-1);
      if (last?.sample === sample) this.layouts[this.layouts.length - 1] = { sample, style };
      else {
        if (this.layouts.length >= 5000) throw Error('摄像头布局时间轴已达到上限，请停止并保存');
        this.layouts.push({ sample, style });
      }
      try {
        await this.writeLayouts();
      } catch (error) {
        this.layouts = previous;
        throw error;
      }
    });
    this.layoutChain = operation.catch(() => {});
    try {
      await operation;
    } finally {
      this.queuedLayouts--;
    }
  }
  private async writeLayouts() {
    const path = join(this.directory, 'camera-layouts.json');
    await writeFile(path + '.writing', JSON.stringify({ version: 1, layouts: this.layouts }), {
      mode: 0o600,
    });
    await rename(path + '.writing', path);
  }
  async flushCameraLayouts() {
    await this.layoutChain;
  }
  private cameraInfo?: VideoReady;
  private primaryCamera = false;
  private cameraRepaired?: string;
  private cameraLength = 0;
  private cameraPosition = 0;
  private serial = 0;
  onCameraFrame?: () => void;
  get camera() {
    return this.cameraInfo;
  }
  get previewCamera() {
    return this.cameraInfo || (this.primaryCamera ? this.info : undefined);
  }
  get cameraSerial() {
    return this.serial;
  }
  get cameraSamples() {
    return this.cameraPosition;
  }
  async cameraPreview() {
    if (!this.previewCamera || !this.serial) throw Error('摄像头画面尚未就绪');
    const path = this.file + '.camera.jpg',
      info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 4 || info.size > 2 * 1024 * 1024)
      throw Error('摄像头预览无效');
    const bytes = await readFile(path);
    if (bytes.length > 2 * 1024 * 1024 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
      throw Error('摄像头预览无效');
    return bytes;
  }
  async markCamera() {
    await this.control('mark');
    return this.positionSamples;
  }
  async sealCamera(file: RecordingFile, valid: () => boolean) {
    if (!this.retryable || !this.cameraInfo || !this.cameraPosition)
      throw Error('摄像头轨道未完成封装');
    return this.sealFile(
      file,
      this.cameraRepaired || this.file + '.camera.mp4',
      this.cameraLength,
      valid,
    );
  }
  private events: RecordingInput[] = [];
  private liveInput = defaultInputStyle();
  private capturedInput = defaultInputStyle();
  private inputChain: Promise<void> = Promise.resolve();
  private queuedInput = 0;
  private inputChanges = 0;
  private inputSample = 0;
  get inputStyle() {
    return { ...this.liveInput };
  }
  get recordedInput() {
    return { ...this.capturedInput };
  }
  async configureInput(value: unknown, valid: () => boolean) {
    const style = inputStyle(value);
    if (this.queuedInput >= 4) throw Error('键鼠设置更新过于频繁');
    this.queuedInput++;
    const operation = this.inputChain.then(async () => {
      if (!valid() || this.terminal) throw Error('键鼠录制会话已结束');
      if (this.inputChanges >= 10000) throw Error('键鼠设置时间轴已达到上限');
      await this.control('input-flags ' + inputFlags(style));
      if (!valid()) throw Error('键鼠录制会话已结束');
      this.liveInput = style;
      this.capturedInput = {
        ...this.capturedInput,
        keys:
          style.keys === 'all' || this.capturedInput.keys === 'all'
            ? 'all'
            : style.keys === 'shortcuts' || this.capturedInput.keys === 'shortcuts'
              ? 'shortcuts'
              : 'off',
        clicks: style.clicks || this.capturedInput.clicks,
        trail: style.trail || this.capturedInput.trail,
      };
      await appendFile(
        join(this.directory, 'input-settings.jsonl'),
        JSON.stringify({ sample: this.inputSample, style }) + '\n',
        { mode: 0o600 },
      );
      this.inputChanges++;
    });
    this.inputChain = operation.catch(() => {});
    try {
      await operation;
    } finally {
      this.queuedInput--;
    }
  }
  onInput?: (events: RecordingInput[]) => void;
  get inputCount() {
    return this.events.length;
  }
  inputEvents(after: number) {
    if (!Number.isSafeInteger(after) || after < 0 || after > this.events.length)
      throw Error('键鼠时间轴页码无效');
    return this.events.slice(after, after + 512);
  }
  private info?: VideoReady;
  private repaired?: string;
  protected get sealSource() {
    return this.repaired || this.file;
  }
  get video() {
    return this.info;
  }
  private async recoverTrack(valid: () => boolean, camera = false) {
    await this.waitClosed();
    if (!valid()) throw Error('视频恢复已取消');
    const sourceFile = camera ? this.file + '.camera.mp4' : this.file,
      trackInfo = camera ? this.cameraInfo : this.info;
    const sourceInfo = await lstat(sourceFile);
    if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) throw Error('视频草稿无效');
    const bytes = await completeVideoPrefix(sourceFile),
      path = join(this.directory, (camera ? 'camera-' : '') + 'complete-fragments.mp4'),
      repaired = join(this.directory, (camera ? 'camera-' : '') + 'recovered.mp4');
    await unlink(path).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    const source = await open(sourceFile, 'r');
    let destination: Awaited<ReturnType<typeof open>> | undefined;
    try {
      destination = await open(path, 'wx', 0o600);
      const buffer = Buffer.alloc(2 * 1024 * 1024);
      try {
        let offset = 0;
        while (offset < bytes) {
          if (!valid()) throw Error('视频恢复已取消');
          const read = await source.read(
            buffer,
            0,
            Math.min(buffer.length, bytes - offset),
            offset,
          );
          if (!read.bytesRead) throw Error('视频草稿不完整');
          let written = 0;
          while (written < read.bytesRead) {
            const result = await destination.write(
              buffer,
              written,
              read.bytesRead - written,
              offset + written,
            );
            if (!result.bytesWritten) throw Error('视频草稿写入失败');
            written += result.bytesWritten;
          }
          offset += read.bytesRead;
        }
        await destination.sync();
      } finally {
        buffer.fill(0);
      }
    } finally {
      await Promise.all([source.close(), destination?.close()]);
    }
    await unlink(repaired).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    const result = await promisify(execFile)(
      join(__dirname, '../native/One.RecordingVideo.exe').replace('app.asar', 'app.asar.unpacked'),
      ['repair', path, repaired],
      {
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 16384,
      },
    );
    if (!valid()) throw Error('视频恢复已取消');
    const decoded = JSON.parse(result.stdout);
    if (
      !Number.isSafeInteger(decoded.frames) ||
      decoded.frames < 1 ||
      decoded.frames > 60 * 3600 ||
      !Number.isFinite(decoded.duration) ||
      decoded.duration <= 0 ||
      decoded.duration > 3600 ||
      !trackInfo ||
      decoded.width !== trackInfo.width ||
      decoded.height !== trackInfo.height ||
      Math.abs(decoded.duration - decoded.frames / trackInfo.fps) > 0.1
    )
      throw Error('恢复的视频无法完整解码');
    const restored = {
      kind: 'done' as const,
      samples: Math.round((decoded.frames * 48000) / trackInfo.fps),
      bytes: (await lstat(repaired)).size,
      warning: '录制中断，已恢复完整视频片段，请检查预览并保存。末尾未写完的片段已舍弃。',
      discontinuities: 0,
      late: 0,
    };
    return { restored, repaired };
  }
  async recover(valid: () => boolean) {
    const { restored, repaired } = await this.recoverTrack(valid);
    this.repaired = repaired;
    if (this.cameraInfo) {
      try {
        const camera = await this.recoverTrack(valid, true);
        this.cameraRepaired = camera.repaired;
        this.cameraLength = camera.restored.bytes;
        this.cameraPosition = camera.restored.samples;
        if (this.cameraPosition < restored.samples)
          restored.warning += ' 摄像头末端片段较短，请检查预览。';
      } catch (error) {
        if (!valid()) throw error;
        this.cameraInfo = undefined;
        restored.warning += ' 摄像头片段未能恢复，屏幕视频已保留，原始摄像头草稿仍在。';
      }
    }
    this.events = this.events.filter((event) => event.sample <= restored.samples);
    if (this.cursorEnabled)
      try {
        this.cursorRead = loadNativeCursor(
          this.file,
          this.info!.width,
          this.info!.height,
          restored.samples,
          true,
        );
        this.pointer = await this.cursorRead;
      } catch {
        this.pointer = undefined;
        restored.warning += ' 光标轨道未能恢复。';
      }
    this.retainResult(restored);
    return restored;
  }
  private constructor(
    directory: string,
    file: string,
    options: RecordingOptions,
    target: NativeVideoTarget,
    update: (event: AudioProgress) => void,
    launch?: (executable: string, args: string[]) => ChildProcessWithoutNullStreams,
  ) {
    const crop = target.crop;
    super(
      directory,
      file,
      {
        executable: join(__dirname, '../native/One.RecordingVideo.exe').replace(
          'app.asar',
          'app.asar.unpacked',
        ),
        args: [
          'capture',
          file,
          target.kind === 'monitor' ? 'screen' : target.kind,
          String(target.handle),
          String(target.pid),
          String(process.pid),
          ...[crop?.x || 0, crop?.y || 0, crop?.width || 0, crop?.height || 0].map(String),
          String(options.maxWidth),
          String(options.fps),
          String(options.videoBitrate || (options.maxWidth === 2560 ? 12000000 : 6000000)),
          options.systemAudio ? options.systemAudioId || 'default' : 'none',
          options.microphone ? options.microphoneId || 'default' : 'none',
          String(options.audioBitrate || 128000),
          options.cursor === false ? '0' : '1',
          options.videoEncoder || 'auto',
          String(inputFlags(options.input)),
          options.camera?.deviceId || 'none',
        ],
        marker: '.one-video',
        markerText: 'One native video',
        memoryMB: 1024,
        acknowledged: (value, command) => {
          if (command.startsWith('input-flags ')) {
            const v = value as { inputFlags: number; samples: number };
            if (v.inputFlags !== Number(command.split(' ')[1])) throw Error('原生键鼠设置确认无效');
            this.inputSample = v.samples;
            return;
          }
          if (!command.startsWith('crop ')) return;
          const v = value as { crop: Rectangle; samples: number },
            [, x, y] = command.split(' ').map(Number);
          if (
            !this.regionCrop ||
            !v.crop ||
            v.crop.x !== x ||
            v.crop.y !== y ||
            v.crop.width !== this.regionCrop.width ||
            v.crop.height !== this.regionCrop.height
          )
            throw Error('原生录制区域确认无效');
          this.regionCrop = { x, y, width: v.crop.width, height: v.crop.height };
          this.regionSample = v.samples;
        },
        ready: (value) => {
          const info = videoReady(value);
          if (info.fps !== options.fps || Math.max(info.width, info.height) > options.maxWidth)
            throw Error('原生视频尺寸或帧率不符');
          this.info = info;
          if (target.kind === 'monitor' && crop) {
            const v = value as { sourceWidth: number; sourceHeight: number };
            this.regionSource = { width: v.sourceWidth, height: v.sourceHeight };
            this.regionCrop = moveRecordingRegion(crop, { x: 0, y: 0 }, this.regionSource);
          }
          const camera = (value as { camera?: unknown }).camera;
          if (!!camera !== (!!options.camera && target.kind !== 'camera'))
            throw Error('摄像头采集状态不符');
          if (camera) {
            this.cameraInfo = videoReady(camera);
            if (
              this.cameraInfo.width > 1280 ||
              this.cameraInfo.height > 1280 ||
              this.cameraInfo.fps !== info.fps
            )
              throw Error('摄像头尺寸或帧率不符');
          }
        },
        event: (value) => {
          const camera = value as {
            kind: string;
            serial: number;
            bytes: number;
            cameraBytes: number;
            cameraSamples: number;
            samples: number;
          };
          if (camera.kind === 'camera-frame') {
            if (
              !this.previewCamera ||
              !Number.isSafeInteger(camera.serial) ||
              camera.serial <= this.serial ||
              !Number.isSafeInteger(camera.bytes) ||
              camera.bytes < 4 ||
              camera.bytes > 2 * 1024 * 1024
            )
              throw Error('摄像头预览响应无效');
            this.serial = camera.serial;
            this.onCameraFrame?.();
            return true;
          }
          if (camera.kind === 'done' && this.cameraInfo) {
            if (
              !Number.isSafeInteger(camera.cameraBytes) ||
              camera.cameraBytes < 44 ||
              camera.cameraBytes > 1024 ** 3 ||
              !Number.isSafeInteger(camera.cameraSamples) ||
              camera.cameraSamples < 0 ||
              camera.cameraSamples > camera.samples
            )
              throw Error('摄像头轨道响应无效');
            this.cameraLength = camera.cameraBytes;
            this.cameraPosition = camera.cameraSamples;
          }
          const packet = value as { kind: string; events: unknown[] };
          if (packet.kind !== 'input') return false;
          if (
            !this.info ||
            !Array.isArray(packet.events) ||
            !packet.events.length ||
            packet.events.length > 16
          )
            throw Error('键鼠响应无效');
          const events = packet.events.map((event) =>
            recordingInput(event, this.info!.width, this.info!.height),
          );
          let last = this.events.at(-1);
          for (const event of events) {
            if (event.id !== (last?.id || 0) + 1 || event.sample < (last?.sample || 0))
              throw Error('键鼠时间轴顺序无效');
            last = event;
          }
          this.events.push(...events);
          this.onInput?.(events);
          return true;
        },
      },
      update,
      launch,
    );
    this.liveInput = inputStyle(options.input || defaultInputStyle());
    this.cursorEnabled = options.cursor !== false;
    this.primaryCamera = target.kind === 'camera';
    this.capturedInput = { ...this.liveInput };
    if (options.camera && !this.primaryCamera)
      this.layouts = [{ sample: 0, style: { ...options.camera.style } }];
  }
  static async create(
    root: string,
    value: RecordingOptions,
    target: NativeVideoTarget,
    update: (event: AudioProgress) => void,
    launch?: (executable: string, args: string[]) => ChildProcessWithoutNullStreams,
  ) {
    const options = recordingOptions(value),
      crop = target.crop;
    if (
      options.mode !== 'video' ||
      (options.container && options.container !== 'mp4') ||
      !['window', 'monitor', 'camera'].includes(target.kind) ||
      (target.kind === 'camera'
        ? options.videoSource !== 'camera' || target.handle !== 0 || target.pid !== 0 || !!crop
        : options.videoSource === 'camera') ||
      !Number.isSafeInteger(target.handle) ||
      (target.kind === 'camera' ? target.handle !== 0 : target.handle <= 0) ||
      !Number.isSafeInteger(target.pid) ||
      target.pid < 0 ||
      target.pid === process.pid ||
      (target.kind === 'window' && !target.pid) ||
      (crop &&
        (![crop.x, crop.y, crop.width, crop.height].every(Number.isSafeInteger) ||
          crop.x < 0 ||
          crop.y < 0 ||
          crop.width < 2 ||
          crop.height < 2 ||
          crop.x + crop.width > 16384 ||
          crop.y + crop.height > 16384))
    )
      throw Error('原生视频来源或选区无效');
    const directory = join(resolve(root), 'video-' + randomUUID());
    await mkdir(directory, { recursive: true });
    try {
      await writeFile(join(directory, '.one-video'), 'One native video', {
        flag: 'wx',
        mode: 0o600,
      });
      await writeFile(
        join(directory, 'draft.json'),
        JSON.stringify({
          version: 1,
          createdAt: Date.now(),
          format: 'mp4',
          fps: options.fps,
          systemAudio: options.systemAudio,
          microphone: options.microphone,
          input: options.input,
          camera: options.videoSource === 'camera' ? undefined : options.camera,
          videoSource: options.videoSource,
        }),
        { flag: 'wx', mode: 0o600 },
      );
      if (options.camera && options.videoSource !== 'camera')
        await writeFile(
          join(directory, 'camera-layouts.json'),
          JSON.stringify({ version: 1, layouts: [{ sample: 0, style: options.camera.style }] }),
          { flag: 'wx', mode: 0o600 },
        );
      if (target.kind === 'monitor' && crop)
        await writeFile(
          join(directory, 'regions.jsonl'),
          JSON.stringify({ sample: 0, crop }) + '\n',
          { flag: 'wx', mode: 0o600 },
        );
      return new NativeVideo(
        directory,
        join(directory, 'capture.mp4'),
        options,
        target,
        update,
        launch,
      );
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }
}
