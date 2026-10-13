import type { AnnotationPreferencesHost } from '../../shared/capture/annotation-preferences';
import { RECORDING_PROJECT_FORMAT } from '../../shared/media-project';
import { recordingWindowURL, type RecordingWindowHost, type RecordingWindowRole } from './window-host';
import { AudioTestManager } from './audio-test';
import { RECORDING_AUDIO_SOURCES, type RecordingAudioSource } from '../../shared/recording/recording';
import type { RecordingProjectKind } from './recording-project';
import type { CursorEvent } from '../../shared/recording/recording-cursor';
import { t as tr } from '../../shared/capture/i18n';
import { displaySignature, type Region } from '../../shared/capture/region';
import { stat } from 'node:fs/promises';
import { windowExists, captureWindowInfo, captureWindowBounds } from '../capture/native';
import {
  type BrowserWindow,
  screen,
  nativeImage,
  dialog,
  type Session,
} from 'electron';
import { RecordingSources } from './recording-sources';
import { RecordingToolbar } from './recording-toolbar';
import { RecordingPlayer } from './recording-player';
import { RecordingExport } from './recording-export';
import { cleanInterruptedExports } from './recording-export-cleanup';
import { defaultPlayback, playbackSettings } from '../../shared/recording/recording-playback';
import { gifEdit } from '../../shared/recording/recording-gif';
import type { RecordingProject } from '../../shared/recording/recording-project';
import { saveRecordingProject, openRecordingProject } from './recording-project';
import { importRecordingVideo, resolveVideoProbe } from './recording-import';
import { RecordingInputOverlay } from './recording-input-overlay';
import { RecordingCameraOverlay } from './recording-camera-overlay';
import { RecordingAnnotationOverlay } from './recording-annotation-overlay';
import { RecordingRegionOverlay } from './recording-region-overlay';
import type { Rectangle } from '../../shared/capture/region';
import { cameraStyle, type CameraStyle } from '../../shared/recording/recording-camera';
import { inputEnabled, inputStyle, type InputStyle } from '../../shared/recording/recording-input';
import { join, resolve, extname, sep, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { RecordingFile } from './recording-file';
import { NativeAudio, audioDevices } from './native-audio';
import { NativeVideo, cameraDevices } from './native-video';
import { NativeCameraPreview } from './native-camera-preview';
import { RecordingCountdown } from './recording-countdown';
import { flushDesktopComposition } from '../capture/native';
import { nativeMonitorHandle } from '../capture/native';
import { captureMonitorBounds } from '../capture/scroll-native';
import { regionPixels } from '../../shared/capture/region';
import type { NativeVideoTarget } from '../../shared/recording/native-video';
import { listAudioDrafts, recoverAudioDraft, discardAudioDraft } from './audio-drafts';
import type { AudioDraft } from '../../shared/recording/native-audio';
import {
  recordingOptions,
  recordingExtension,
  recordingContentType,
  validRecordingMime,
  recordingRange,
  RECORD_SECONDS,
  RECORD_BYTES,
  RECORD_CHUNK,
  type RecordingOptions,
  type RecordingPhase,
  type RecordingState,
  type RecordingSource,
} from '../../shared/recording/recording';
export interface RecordingContext extends AnnotationPreferencesHost {
  directory: string;
  windowHost: RecordingWindowHost;
  register(name: string, handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown): void;
  openPage(): Promise<void> | void;
  confirm(owner: BrowserWindow, options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue>;
  availabilityChanged?(): void;
  timing?(value: {
    mode: 'audio' | 'video';
    armMs: number;
    toolbarMs: number;
    delayMs: number;
    nativeMs: number;
    overlaysMs: number;
    totalMs: number;
  }): void;
  materials?: import('../materials/library').MaterialLibrary;
  materialsReady?(): Promise<void>;
  openMaterials?(): void;
  chooseRegion(displayId: number, hideMain?: boolean): Promise<Region | null>;
  cancelRegion(): void;
  blocked(): boolean;
  dark(): boolean;
  prepare(): void;
  protect(file: string): void;
  copy(file: string, valid: () => boolean): Promise<void>;
  windows(): BrowserWindow[];
  background<T>(task: Promise<T>): Promise<T>;
}
const URL = 'one://app/index.html?view=main';
export class RecordingService {
  private client?: BrowserWindow;
  private clientCleanup?: () => void;
  private pageEnabled = false;
  private windowHost: RecordingWindowHost;
  private resourceWindows = new Map<number, {window: BrowserWindow; role: RecordingWindowRole}>();
  private closing = false;
  private disposal?: Promise<void>;
  private draining = false;
  private finishTask?: Promise<void>;
  private finishWaiter?: () => void;
  private clientTasks = new Set<Promise<unknown>>();
  private trackClient<T>(task: Promise<T>) {
    this.clientTasks.add(task);
    void task.then(() => this.clientTasks.delete(task), () => this.clientTasks.delete(task));
    return this.ctx.background(task);
  }

  private clientValid(contents: Electron.WebContents | null | undefined) {
    return !this.closing && !!contents && !contents.isDestroyed() && contents === this.contents && contents.getURL() === URL;
  }
  bindClient(window: BrowserWindow) {
    if (window === this.client) return;
    if (this.client && !this.client.isDestroyed() && this.active) throw Error('当前录制尚未结束');
    this.clientCleanup?.();
    this.client = window;
    const contents = window.webContents;
    const lost = () => {
      if (this.client !== window) return;
      void this.ctx.background(this.pageActive(false)).catch(() => {});
      if (this.active) {
        if (this.capture) this.sourceStopped('录制页面已关闭，正在保留结果');
        else void this.ctx.background(this.reset('录制页面已关闭，未完成录制已取消')).catch(() => {});
      }
    };
    const navigate = (_event: Electron.Event, _url: string, inPlace: boolean, mainFrame: boolean) => { if (mainFrame && !inPlace) lost(); };
    contents.on('render-process-gone', lost);
    contents.on('did-start-navigation', navigate);
    window.on('closed', lost);
    this.clientCleanup = () => {
      if (!contents.isDestroyed()) {
        contents.removeListener('render-process-gone', lost);
        contents.removeListener('did-start-navigation', navigate);
      }
      window.removeListener('closed', lost);
    };
  }
  async pageActive(value: unknown) {
    if (typeof value !== 'boolean') throw Error('录制页面状态无效');
    if (value && !this.clientValid(this.contents)) throw Error('录制页面已失效');
    this.pageEnabled = value;
    if (!value) {
      this.canStart = false;
      this.microphoneList = undefined;
      this.listing++;
      await Promise.all([this.audioTests.stopAll(), this.stopSetupCamera(), this.previews.stop()]);
      this.ctx.availabilityChanged?.();
    }
  }
  /** Called by One's central one-file request authorization before the protocol response. */
  authorize(value: string, owner: number) {
    if (this.closing || this.ctx.blocked()) return false;
    let url: globalThis.URL;
    try { url = new globalThis.URL(value); } catch { return false; }
    if (url.protocol !== 'one-file:' || url.hash || url.username || url.password || url.port) return false;
    const client = this.contents, current = this.resourceWindows.get(owner);
    const isClient = client?.id === owner && this.clientValid(client);
    const isWindow = current && !current.window.isDestroyed() && current.window.webContents.getURL() === recordingWindowURL(current.role);
    const contents = isClient ? client : isWindow ? current!.window.webContents : undefined;
    if (!contents || contents.mainFrame.frames.length) return false;
    if (url.host === 'recording-camera-setup') return !!isClient && this.pageEnabled && !!this.setupCamera && url.pathname === '/' + this.setupCameraToken;
    if (url.pathname !== '/' + this.token || !this.token) return false;
    if (url.host === 'recording-camera-live') return !!(isClient || isWindow && current!.role === 'recording-camera-overlay') && this.capture instanceof NativeVideo && !!this.capture.previewCamera && ['arming','recording','paused'].includes(this.phase);
    if (url.search || !['ready','saving'].includes(this.phase) || !(isClient || isWindow && ['recording-player','recording-export'].includes(current!.role))) return false;
    if (url.host === 'recording') return !!this.file;
    if (url.host === 'recording-camera') return !!this.cameraFile;
    if (url.host === 'recording-system' || url.host === 'recording-microphone') return !!this.audioFiles[url.host.slice(10) as RecordingAudioSource];
    return false;
  }
  resource(request: Request): Response | Promise<Response> {
    const url = new globalThis.URL(request.url);
    const owners = [this.contents?.id, ...this.resourceWindows.keys()];
    if (!owners.some(owner => owner !== undefined && this.authorize(request.url, owner))) return new Response(null,{status:404});
    if (url.host === 'recording-camera-live') return this.cameraPreview(request);
    if (url.host === 'recording-camera-setup') {
      if (request.method !== 'GET') return new Response(null,{status:404});
      try { return new Response(new Uint8Array(this.setupCamera!.frame()),{headers:{'Content-Type':'image/jpeg','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*'}}); }
      catch { return new Response(null,{status:503}); }
    }
    const kind = url.host === 'recording' ? 'screen' : url.host.slice(10) as RecordingProjectKind;
    return this.media(request,kind);
  }

  permissionCheck: NonNullable<Parameters<Session['setPermissionCheckHandler']>[0]> = (wc, p, _o, d) =>
        this.clientValid(wc) &&
        d.isMainFrame && this.pageEnabled &&
        d.requestingUrl === URL &&
        !this.ctx.blocked() &&
        ((p === 'fullscreen' && this.phase === 'ready') ||
          (p === 'media' &&
            d.mediaType === 'audio' &&
            ((this.armed() && this.needsDisplay() && !!this.options?.microphone) ||
              (this.microphoneList?.expires || 0) > Date.now())));

  permissionRequest: NonNullable<Parameters<Session['setPermissionRequestHandler']>[0]> = (wc, p, cb, d) => {
      let allowed =
        this.clientValid(wc) &&
        d.isMainFrame && this.pageEnabled &&
        d.requestingUrl === URL &&
        !this.ctx.blocked() &&
        p === 'fullscreen' &&
        this.phase === 'ready';
      if (
        this.clientValid(wc) &&
        d.isMainFrame && this.pageEnabled &&
        d.requestingUrl === URL &&
        this.armed() &&
        p === 'media' &&
        'mediaTypes' in d &&
        d.mediaTypes
      ) {
        if (d.mediaTypes.length === 0) allowed = this.needsDisplay() && !this.displayGrant;
        else if (
          d.mediaTypes.length === 1 &&
          d.mediaTypes[0] === 'audio' &&
          this.options?.microphone &&
          this.needsDisplay() &&
          !this.micGrant
        ) {
          allowed = true;
          this.micGrant = true;
        }
      }
      cb(allowed);
    };

  displayMediaRequest: NonNullable<Parameters<Session['setDisplayMediaRequestHandler']>[0]> = (request, callback) => {
      if (
        !this.clientValid(this.contents) || !this.pageEnabled || !this.armed() ||
        this.displayGrant ||
        request.frame !== this.contents?.mainFrame ||
        request.frame?.url !== URL ||
        !request.videoRequested ||
        request.audioRequested !== !!this.options?.systemAudio ||
        !this.needsDisplay()
      ) {
        callback({});
        return;
      }
      this.displayGrant = true;
      callback({
        video: this.source,
        audio: this.options?.systemAudio ? 'loopback' : undefined,
      });
    };

  private get contents() { return this.client && !this.client.isDestroyed() ? this.client.webContents : undefined; }
  private get owner() { return this.client && !this.client.isDestroyed() ? this.client : undefined; }
  private selectedRegion?: { token: string; region: Region };
  private region?: Region;
  private picking = false;
  private file?: RecordingFile;
  private cameraFile?: RecordingFile;
  private audioFiles: Partial<Record<RecordingAudioSource, RecordingFile>> = {};
  private capture?: NativeAudio | NativeVideo;
  private nativeBytes = 0;
  private nativeRetry = false;
  private nativeFinishing?: Promise<void>;
  private audioLevels = { system: 0, microphone: 0, mixed: 0, clipped: false };
  private audioGains = { system: 1, microphone: 1 };
  private audioDrafts: AudioDraft[] = [];
  private recovering = false;
  private recoveredDraft?: string;
  private phase: RecordingPhase = 'idle';
  private token = '';
  private options?: RecordingOptions;
  private mime = '';
  private seconds = 0;
  private message = '';
  private saved = '';
  private cameraSaved = '';
  private savedFile?: { path: string; size: number; mtimeMs: number; ino: number };
  private generation = 0;
  private heartbeatAt = 0;
  private created = 0;
  private displayGrant = false;
  private micGrant = false;
  private source?: Electron.DesktopCapturerSource;
  private shown: BrowserWindow[] = [];
  private pendingBytes = 0;
  private timer: NodeJS.Timeout;
  private toolbar: RecordingToolbar;
  private player: RecordingPlayer;
  private playback = defaultPlayback();
  private restored?: RecordingProject;
  private projectOperation = false;
  private importAbort?: AbortController;
  private projectName = '';
  private materialId = '';
  private materialDraftId = '';
  private materialSaving?: Promise<void>;
  canStart = false;
  private projectRevision = 0;
  private savedProjectRevision?: number;
  private inputOverlay: RecordingInputOverlay;
  private cameraOverlay: RecordingCameraOverlay;
  private annotationOverlay: RecordingAnnotationOverlay;
  private regionOverlay: RecordingRegionOverlay;
  private activeCrop?: Rectangle;
  private countdownUntil = 0;
  private cancelDelay?: () => void;
  private audioTests: AudioTestManager;
  private initError = '';
  private sourceChoices = new Map<
    string,
    {
      source: Electron.DesktopCapturerSource;
      pid?: number;
      executable?: string;
      signature?: string;
    }
  >();
  private listing = 0;
  readonly directory: string;
  private exporter: RecordingExport;
  private countdown: RecordingCountdown;
  private setupCamera?: NativeCameraPreview;
  private setupCameraRevision = 0;
  private setupCameraToken = '';
  private setupCameraStopping: Promise<void> = Promise.resolve();
  // A short metadata-only check exposes device choices. Input requests still require arm().
  private microphoneList: { token: string; expires: number } | undefined;
  constructor(
    private ctx: RecordingContext,
    private createAudio = NativeAudio.create,
    private createVideo = NativeVideo.create,
    private listCameras = cameraDevices,
    private createCameraPreview = (device: string) => new NativeCameraPreview(device),
    private previews: Pick<RecordingSources, 'run' | 'stop'> = new RecordingSources(),
  ) {
    this.directory = ctx.directory;
    this.windowHost = {
      register: (name, handler, roles) => ctx.windowHost.register(name, handler, roles),
      createWindow: (role, options) => {
        const window = ctx.windowHost.createWindow(role, options), id = window.webContents.id;
        this.resourceWindows.set(id, {window, role});
        window.once('closed', () => this.resourceWindows.delete(id));
        return window;
      },
    };
    this.countdown = new RecordingCountdown(
      this.windowHost,
      () => void this.ctx.background(this.reset()),
    );
    this.audioTests = new AudioTestManager(
      (event) => {
        const target = this.contents;
        if (target && !target.isDestroyed()) target.send('one:recording-audio-test', event);
      },
      () =>
        !this.ctx.blocked() &&
        !this.projectOperation &&
        !this.picking &&
        ['idle', 'ready'].includes(this.phase) &&
        this.pageEnabled,
    );
    this.exporter = new RecordingExport(this.windowHost, this.directory, {
      protect: file => this.ctx.protect(file),
      token: () => this.token,
      allowed: () => this.phase === 'ready' && !this.projectOperation && !this.ctx.blocked(),
      changed: () => {
        if (this.exporter?.state?.phase === 'preparing') this.message = '';
        this.changed();
      },
      snapshot: () => {
        if (!this.file || !this.options) throw Error('请先完成录制');
        const state = this.state(),
          sources = RECORDING_AUDIO_SOURCES.filter((source) => this.audioFiles[source]);
        return {
          project: this.projectSnapshot(),
          video: state.url!,
          camera: state.cameraUrl,
          audio: sources.length
            ? sources.map((kind) => ({ kind, file: this.audioFiles[kind]!, extension: 'wav' }))
            : this.options.systemAudio || this.options.microphone
              ? [{ kind: 'mixed', file: this.file, extension: this.options.container || 'mp4' }]
              : [],
        };
      },
    });
    this.player = new RecordingPlayer(this.windowHost, {
      state: () => ({ ...this.state(), playback: this.playback }),
      blocked: () => this.ctx.blocked(),
      inputEvents: (after) => this.resultInputs(after),
      annotationEvents: (after) => this.resultAnnotations(after),
      cameraLayouts: () => this.resultLayouts(),
      cursorEvents: (after) => this.resultCursorEvents(after),
      cursorShapes: () => this.resultCursor()?.shapes || [],
      edit: (value) => {
        const next = playbackSettings(value);
        if (next.gif) {
          if (!this.state().video) throw Error('声音素材不能编辑 GIF 帧');
          next.gif = gifEdit(next.gif, this.state().seconds, this.state().video);
        }
        if (JSON.stringify(next) === JSON.stringify(this.playback)) return;
        this.playback = next;
        this.projectRevision++;
        if (this.materialId && this.ctx.materials) {
          const id = this.materialId,
            revision = this.projectRevision;
          void this.ctx
            .background(this.ctx.materials.updateRecording(id, next))
            .then(() => {
              if (this.materialId === id) {
                this.savedProjectRevision = revision;
                this.changed();
              }
            })
            .catch((error) => {
              this.message = '素材工程保存失败：' + error.message;
              this.changed();
            });
        }
        this.changed();
      },
      save: (camera, owner) => this.save(camera, owner),
      saveProject: (owner) => this.saveProject(owner),
      export: (options, owner) => this.exporter.start(options, owner),
      previewGif: (options, complete) => this.exporter.preview(options, complete),
      cancelExport: (id) => this.exporter.cancel(id),
      background: (task) => this.ctx.background(task),
    });
    this.regionOverlay = new RecordingRegionOverlay(this.windowHost, {
      valid: (token) =>
        token === this.token &&
        !!this.region &&
        this.capture instanceof NativeVideo &&
        ['arming', 'recording', 'paused'].includes(this.phase) &&
        !this.nativeFinishing &&
        !this.ctx.blocked(),
      crop: () => this.activeCrop,
      bounds: () => this.captureBounds(),
      move: async (x, y) => {
        const capture = this.capture,
          token = this.token;
        if (
          !(capture instanceof NativeVideo) ||
          !this.region ||
          this.nativeFinishing ||
          !['recording', 'paused'].includes(this.phase)
        )
          throw Error('录制区域移动已结束');
        try {
          await capture.moveRegion(x, y);
        } catch (error) {
          if (capture === this.capture) this.sourceStopped((error as Error).message);
          throw error;
        } finally {
          if (capture === this.capture && token === this.token) {
            this.activeCrop = capture.crop;
            const bounds = this.captureBounds();
            this.inputOverlay.syncPosition(bounds);
            this.annotationOverlay.syncPosition(bounds);
            this.cameraOverlay.syncPosition();
            this.changed();
          }
        }
      },
      changed: () => this.changed(),
      failed: (message) => this.sourceStopped(message),
    });
    this.annotationOverlay = new RecordingAnnotationOverlay(this.windowHost, {
      annotationStyles:ctx.annotationStyles,
      saveAnnotationStyle:ctx.saveAnnotationStyle,
      frame: async () => {
        const capture = this.capture,
          token = this.token;
        if (!(capture instanceof NativeVideo)) throw Error('录制标注已结束');
        const frame = await capture.annotationFrame();
        if (
          capture !== this.capture ||
          token !== this.token ||
          !['recording', 'paused'].includes(this.phase) ||
          this.ctx.blocked()
        )
          throw Error('录制标注已结束');
        return frame;
      },
      valid: (token) =>
        token === this.token &&
        this.capture instanceof NativeVideo &&
        ['recording', 'paused'].includes(this.phase) &&
        !this.ctx.blocked(),
      scene: async (value) => {
        const capture = this.capture,
          token = this.token;
        if (!(capture instanceof NativeVideo)) throw Error('录制标注已结束');
        await capture.annotate(
          value,
          () =>
            this.capture === capture &&
            this.token === token &&
            ['recording', 'paused'].includes(this.phase) &&
            !this.ctx.blocked(),
        );
      },
      failed: (message) => this.sourceStopped(message),
      selected: () => this.changed(),
      controls: () => this.toolbar?.controlBounds() || [],
      raised: () => {
        this.regionOverlay?.raise();
        this.cameraOverlay?.window?.moveTop();
        this.inputOverlay?.window?.moveTop();
        this.toolbar?.raise();
      },
    });
    this.inputOverlay = new RecordingInputOverlay(
      this.windowHost,
      () => this.state(),
      () => this.sourceStopped('键鼠回显意外关闭，正在保留录制结果'),
    );
    this.cameraOverlay = new RecordingCameraOverlay(this.windowHost, {
      valid: (token) =>
        token === this.token &&
        !!this.capture &&
        ['arming', 'recording', 'paused'].includes(this.phase) &&
        !this.ctx.blocked(),
      layout: (value) => this.cameraLayout(value),
      failed: (message) => this.sourceStopped(message),
    });
    this.toolbar = new RecordingToolbar(this.windowHost, {
      state: () => this.state(),
      blocked: () => this.ctx.blocked(),
      pause: (token, paused) => this.nativePause(token, paused),
      stop: (token) => {
        this.check(token);
        return this.nativeFinish();
      },
      gain: (token, system, microphone) => this.nativeGain(token, system, microphone),
      camera: async (token) => {
        this.check(token);
        await this.cameraOverlay.toggle();
        this.changed();
      },
      cameraStyle: async (token, style) => {
        this.check(token);
        await this.cameraOverlay.setStyle(style);
        this.changed();
      },
      inputStyle: (token, style) => this.configureInput(token, style),
      region: async (token) => {
        this.check(token);
        if (
          !this.regionOverlay.window ||
          this.nativeFinishing ||
          !['recording', 'paused'].includes(this.phase)
        )
          throw Error('当前录制不支持移动区域');
        if (!this.regionOverlay.active && this.annotationOverlay.interactive)
          await this.annotationOverlay.command({ kind: 'interact' });
        this.regionOverlay.toggle();
      },
      annotate: async (token, command) => {
        this.check(token);
        const capture = this.capture;
        if (
          !(capture instanceof NativeVideo) ||
          this.options?.videoSource === 'camera' ||
          !capture.video ||
          !['recording', 'paused'].includes(this.phase) ||
          this.nativeFinishing
        )
          throw Error('无法进行录制标注');
        if (!this.annotationOverlay.window)
          await this.annotationOverlay.open(token, capture.video.width, capture.video.height, () =>
            this.token === token ? this.captureBounds() : null,
          );
        if (this.token !== token || this.nativeFinishing) throw Error('录制标注已结束');
        await this.annotationOverlay.command(command);
        this.changed();
      },
      cancel: (token) => {
        this.check(token);
        if (this.phase !== 'arming') throw Error('录制已经开始，请停止并保存');
        return this.reset();
      },
      failed: (message) => {
        if (this.phase === 'arming') void this.ctx.background(this.reset(message));
        else if (this.active) this.sourceStopped(message);
      },
      background: (task) => this.ctx.background(task),
    });
    const handle = (name: string, fn: (...args: any[]) => unknown) =>
      this.ctx.register('recording-' + name, (event, ...args) => {
        if (
          this.ctx.blocked() ||
          !this.clientValid(this.contents) ||
          event.sender !== this.contents ||
          event.senderFrame !== event.sender.mainFrame ||
          event.senderFrame.url !== URL
        )
          throw new Error(tr('拒绝访问录制'));
        return this.trackClient(
          Promise.resolve().then(() => {
            if (this.ctx.blocked() || !this.clientValid(event.sender) || event.senderFrame !== event.sender.mainFrame) throw new Error(tr('录制已锁定'));
            if (!this.pageEnabled && ['sources','cameras','audio-devices','microphones-begin','choose-region','arm','native-start','audio-recover','open-project','import-video'].includes(name)) throw Error('录制页面已停用');
            return fn(...args);
          }),
        );
      });
    handle('page-active', value => this.pageActive(value));
    handle('microphones-begin', () => {
      if (!this.pageEnabled || !['idle', 'ready'].includes(this.phase) || this.picking)
        throw new Error(tr('请先完成当前录制'));
      const token = randomUUID();
      this.microphoneList = { token, expires: Date.now() + 5000 };
      return token;
    });
    handle('microphones-end', (token) => {
      if (this.microphoneList?.token === token) this.microphoneList = undefined;
    });
    handle('choose-region', (source, hideMain = true) => this.chooseRegion(source, hideMain));
    handle('state', () => this.state());
    handle('materials', () => this.ctx.openMaterials?.());
    handle('start-availability', (value) => {
      if (typeof value !== 'boolean') throw Error('录制操作状态无效');
      if (this.canStart !== value) {
        this.canStart = value;
        this.ctx.availabilityChanged?.();
        this.changed();
      }
    });
    handle('prepare-next', async () => {
      if (this.phase !== 'ready' || this.projectOperation || this.exporter.busy)
        throw Error('请先完成当前操作');
      await this.archiveMaterial();
      const region = this.selectedRegion,
        choices = new Map(this.sourceChoices);
      await this.reset();
      this.selectedRegion = region;
      this.sourceChoices = choices;
    });
    handle('open-player', () => this.player.open());
    handle('open-project', () => this.openProject());
    handle('import-video', () => this.openProject('video'));
    handle('cancel-import', () => {
      if (!this.importAbort) return;
      this.importAbort.abort();
      this.message = '视频导入已取消，原有结果仍保留';
      this.changed();
    });
    handle('input-events', (token, after) => {
      this.check(token);
      if (!['ready', 'saving'].includes(this.phase)) throw Error('键鼠预览已经失效');
      return this.resultInputs(after);
    });
    handle('cursor-events', (token, after) => {
      this.check(token);
      if (!['ready', 'saving'].includes(this.phase)) throw Error('光标预览已失效');
      return this.resultCursorEvents(after);
    });
    handle('cursor-shapes', (token) => {
      this.check(token);
      if (!['ready', 'saving'].includes(this.phase)) throw Error('光标预览已失效');
      return this.resultCursor()?.shapes || [];
    });
    handle('cameras', () => {
      if (!['idle', 'ready'].includes(this.phase)) throw Error('请先完成当前录制');
      return this.listCameras();
    });
    handle('camera-setup', (device) => this.previewSetupCamera(device));
    handle('camera-layouts', (token) => {
      this.check(token);
      if (!['ready', 'saving'].includes(this.phase)) throw Error('摄像头预览已经失效');
      return this.resultLayouts();
    });
    handle('annotation-events', (token, after) => {
      this.check(token);
      if (!['ready', 'saving'].includes(this.phase)) throw Error('标注预览已失效');
      return this.resultAnnotations(after);
    });
    handle('sources', (type) => this.sources(type));
    handle('audio-test', (channel, enabled, device) =>
      this.audioTests.set(channel, enabled, device),
    );
    handle('audio-devices', () => {
      if (!['idle', 'ready'].includes(this.phase)) throw Error('请先完成当前录制');
      return audioDevices();
    });
    handle('native-start', (value) => this.nativeStart(value));
    handle('audio-recover', (id) => this.recoverDraft(id));
    handle('audio-discard', async (id) => {
      this.checkDraft(id);
      this.picking = true;
      const generation = this.generation;
      try {
        await discardAudioDraft(join(this.directory, 'native'), id);
        this.audioDrafts = await listAudioDrafts(join(this.directory, 'native'));
      } finally {
        if (generation === this.generation) {
          this.picking = false;
          this.changed();
        }
      }
    });
    handle('native-pause', (token, paused) => this.nativePause(token, paused));
    handle('native-stop', (token) => {
      this.check(token);
      return this.nativeFinish();
    });
    handle('native-gain', (token, system, microphone) =>
      this.nativeGain(token, system, microphone),
    );
    handle('arm', (value) => {
      const options = recordingOptions(value);
      if (options.mode !== 'video' || options.container !== 'webm')
        throw Error('此格式使用原生采集');
      return this.arm(value);
    });
    handle('started', (token, mime) => this.started(token, mime));
    handle('chunk', (token, index, data) => this.chunk(token, index, data));
    handle('heartbeat', (token, seconds) => {
      this.check(token);
      if (!this.needsDisplay()) throw Error('原生录制由采集进程计时');
      this.time(seconds);
      this.heartbeatAt = Date.now();
    });
    handle('paused', (token, paused) => {
      this.check(token);
      if (!this.needsDisplay()) throw Error('原生录制由采集进程暂停');
      if (typeof paused !== 'boolean' || !['recording', 'paused'].includes(this.phase))
        throw new Error(tr('无法暂停录制'));
      this.phase = paused ? 'paused' : 'recording';
      this.changed();
    });
    handle('finish', (token, seconds, reason, mime) => this.finish(token, seconds, reason, mime));
    handle('cancel', () => this.reset());
    handle('fail', (token, message) => {
      this.check(token);
      return this.reset(typeof message === 'string' ? message.slice(0, 500) : tr('录制失败'));
    });
    handle('save', () => this.save());
    handle('save-camera', () => this.save(true));
    handle('copy-saved', async () => {
      const saved = this.savedFile;
      if (this.phase !== 'ready' || !saved) throw new Error(tr('请先保存录制'));
      const current = await stat(saved.path);
      if (
        this.savedFile !== saved ||
        this.ctx.blocked() ||
        !current.isFile() ||
        current.size !== saved.size ||
        current.mtimeMs !== saved.mtimeMs ||
        current.ino !== saved.ino
      )
        throw new Error(tr('已保存文件发生改变，请重新保存'));
      await this.ctx.copy(saved.path, () => this.savedFile === saved && !this.ctx.blocked());
    });
    this.timer = setInterval(() => {
      if (this.active) {
        if (this.draining) return;
        if (this.recovering) return;
        if (this.countdownUntil && !this.ctx.blocked()) return;
        // Finishing and retained failure states do not depend on renderer
        // heartbeat. Never erase an encoded result awaiting a seal retry.
        if (this.capture && (this.nativeFinishing || this.capture.terminal)) return;
        const age = Date.now() - this.heartbeatAt;
        if (this.ctx.blocked() || age > 15000) {
          if (this.capture && !this.ctx.blocked()) {
            void this.ctx.background(this.nativeFinish()).catch(() => {});
            return;
          }
          void this.ctx.background(
            this.abort(this.ctx.blocked() ? tr('录制已停止') : tr('录制窗口长时间未响应，已停止')),
          );
          return;
        }
        if (this.phase === 'arming' && Date.now() - this.created > 12000) {
          void this.ctx.background(this.reset(tr('未能取得录制来源，请重试')));
          return;
        }
        if (this.phase !== 'stopping' && this.region) {
          const display = screen.getAllDisplays().find((d) => d.id === this.region!.displayId);
          if (!display || displaySignature(display) !== this.region.signature) {
            this.sourceStopped(tr('显示器配置已改变，请重新选择录制区域'));
          }
        }
        if (
          this.phase !== 'stopping' &&
          this.source &&
          this.options?.mode === 'video' &&
          (this.source.id.startsWith('window:')
            ? !windowExists(Number(this.source.id.split(':')[1]))
            : !screen.getAllDisplays().some((d) => String(d.id) === this.source!.display_id))
        ) {
          this.sourceStopped(tr('录制来源已关闭或断开'));
        }
        if (
          this.phase !== 'stopping' &&
          (this.seconds >= RECORD_SECONDS ||
            (this.file && this.file.bytes >= RECORD_BYTES - 32 * 1024 * 1024) ||
            Date.now() - this.created >= 2 * RECORD_SECONDS * 1000)
        ) {
          if (this.capture) {
            void this.ctx.background(this.nativeFinish()).catch(() => {});
            return;
          }
          this.phase = 'stopping';
          this.message = tr('已达到录制时长或容量上限');
          this.contents?.send('one:recording-stop');
          this.changed();
        }
      }
    }, 1000);
    this.timer.unref();
  }
  async init() {
    try {
      await RecordingFile.clean(this.directory);
      await cleanInterruptedExports(this.directory);
      this.audioDrafts = await listAudioDrafts(join(this.directory, 'native'));
      this.changed();
    } catch {
      this.initError = tr('录制暂存目录无法清理，请检查目录权限后重启');
      this.message = this.initError;
    }
  }
  get active() {
    return ['arming', 'recording', 'paused', 'stopping'].includes(this.phase);
  }
  get hasUnsaved() {
    const projectSaved = this.savedProjectRevision === this.projectRevision;
    return (
      this.picking ||
      this.active ||
      this.projectOperation ||
      (!projectSaved &&
        ((!!this.file && (!this.saved || this.projectRevision > 0)) ||
          (!!this.cameraFile && !this.cameraSaved)))
    );
  }
  private armed() {
    return !this.ctx.blocked() && this.phase === 'arming' && Date.now() - this.created < 12000;
  }
  private needsDisplay() {
    return this.options?.mode === 'video' && this.options.container === 'webm';
  }
  private sourceStopped(message: string) {
    this.phase = 'stopping';
    this.message = message;
    if (this.capture) void this.ctx.background(this.nativeFinish(message)).catch(() => {});
    else this.contents?.send('one:recording-stop');
    this.changed();
  }
  refreshAppearance() {
    this.changed();
  }
  private changed() {
    this.ctx.availabilityChanged?.();
    if (this.contents && !this.contents.isDestroyed()) this.contents.send('one:recording-changed');
    this.toolbar?.changed();
    this.inputOverlay?.changed();
    this.player?.changed();
  }
  private check(token: unknown) {
    if (
      typeof token !== 'string' ||
      !token ||
      token !== this.token ||
      !this.file ||
      this.ctx.blocked()
    )
      throw new Error(tr('录制会话已失效'));
  }
  private time(value: unknown) {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > RECORD_SECONDS + 10 ||
      value < this.seconds - 1
    )
      throw new Error(tr('录制计时无效'));
    this.seconds = value;
  }
  state(): RecordingState {
    return {
      export: this.exporter?.state,
      projectSaved: this.projectName,
      projectDirty:
        this.savedProjectRevision === undefined
          ? this.projectRevision > 0
          : this.savedProjectRevision !== this.projectRevision,
      projectBusy: this.projectOperation,
      importing: !!this.importAbort,
      importedVideo: this.restored?.origin === 'video',
      ...(this.restored
        ? {
            video: this.restored.video,
            camera: this.restored.camera,
            cameraSeconds: this.restored.cameraSeconds,
            cameraStyle: this.restored.cameraStyle,
            inputCount: this.restored.inputs.length,
            inputStyle: this.restored.inputStyle,
            recordedInput: this.restored.recordedInput,
            annotationCount: this.restored.annotations.length,
          }
        : {}),
      phase: this.phase,
      cursorCount: this.resultCursor()?.events.length || 0,
      token: this.token,
      seconds: this.seconds,
      ...(this.countdownUntil
        ? { countdown: Math.max(0, Math.ceil((this.countdownUntil - Date.now()) / 1000)) }
        : {}),
      bytes: Math.max(this.nativeBytes, this.file?.bytes || 0),
      audioDrafts: this.audioDrafts,
      ...(this.capture
        ? {
            backend:
              this.capture instanceof NativeVideo
                ? this.options?.videoSource === 'camera'
                  ? ('camera' as const)
                  : ('wgc' as const)
                : ('wasapi' as const),
            ...(this.capture instanceof NativeVideo
              ? {
                  video: this.capture.video,
                  inputCount: this.capture.inputCount,
                  inputStyle: this.capture.inputStyle,
                  recordedInput: this.capture.recordedInput,
                  annotationCount: this.capture.annotationCount,
                  annotating: this.annotationOverlay.interactive,
                  annotationTool: this.annotationOverlay.tool,
                  annotationSelection: this.annotationOverlay.selection,
                  annotationStyle: this.annotationOverlay.style,
                  regionMovable: !!this.regionOverlay.window,
                  movingRegion: this.regionOverlay.active,
                  regionCrop: this.activeCrop,
                  camera: this.capture.camera,
                  cameraStyle: this.cameraOverlay.currentStyle,
                  cameraSeconds: this.capture.cameraSamples / 48000,
                }
              : {}),
            levels: this.audioLevels,
            gains: this.audioGains,
            retryAudio: this.nativeRetry,
          }
        : {}),
      dark: this.ctx.dark(),
      message: this.message,
      ...(this.mime ? { mime: this.mime } : {}),
      ...(this.options ? { options: this.options } : {}),
      ...(this.region ? { region: this.region } : {}),
      ...(this.saved ? { saved: this.saved } : {}),
      ...(this.cameraSaved ? { cameraSaved: this.cameraSaved } : {}),
      ...(this.options?.videoSource === 'camera' &&
      this.capture instanceof NativeVideo &&
      this.capture.cameraSerial &&
      ['recording', 'paused'].includes(this.phase)
        ? {
            cameraLiveUrl:
              'one-file://recording-camera-live/' +
              this.token +
              '?frame=' +
              this.capture.cameraSerial,
          }
        : {}),
      ...(['ready', 'saving'].includes(this.phase) && this.file
        ? { url: 'one-file://recording/' + this.token }
        : {}),
      ...(['ready', 'saving'].includes(this.phase) && this.cameraFile
        ? { cameraUrl: 'one-file://recording-camera/' + this.token }
        : {}),
      ...(['ready', 'saving'].includes(this.phase) && Object.keys(this.audioFiles).length
        ? {
            audioSources: Object.fromEntries(
              RECORDING_AUDIO_SOURCES.filter((source) => this.audioFiles[source]).map((source) => [
                source,
                'one-file://recording-' + source + '/' + this.token,
              ]),
            ),
          }
        : {}),
    };
  }
  async open() { if (!this.ctx.blocked()) await this.ctx.openPage(); }
  private async sources(type: unknown = 'screen') {
    if (!this.pageEnabled) return [];
    if (!['idle', 'ready'].includes(this.phase)) throw new Error(tr('请先完成当前录制'));
    if (type !== 'screen' && type !== 'window') throw new Error(tr('录制来源已失效'));
    const generation = this.generation,
      listing = ++this.listing;
    const valid = () =>
      generation === this.generation &&
      listing === this.listing &&
      this.pageEnabled &&
      !this.ctx.blocked() &&
      ['idle', 'ready'].includes(this.phase);
    let all: Awaited<ReturnType<RecordingSources['run']>>;
    try {
      all = await this.previews.run(type, valid);
    } catch (error) {
      if (!valid()) return [];
      throw error;
    }
    if (!valid()) return [];
    const own = new Set(
      this.ctx.windows().map((w) => String(w.getNativeWindowHandle().readBigUInt64LE())),
    );
    if (this.owner) own.add(String(this.owner.getNativeWindowHandle().readBigUInt64LE()));
    const choices: RecordingSource[] = [],
      catalog = new Map(this.sourceChoices);
    catalog.clear();
    for (const source of all) {
      if (choices.length === 150) break;
      let pid: number | undefined, executable: string | undefined, signature: string | undefined;
      let bounds: Electron.Rectangle | null = null;
      if (type === 'window') {
        const hwnd = source.id.split(':')[1],
          info = captureWindowInfo(Number(hwnd));
        if (own.has(hwnd) || !info || info.pid === process.pid || info.pid !== source.pid) continue;
        bounds = captureWindowBounds(Number(hwnd));
        pid = info.pid;
        executable = info.executable;
      } else {
        const display = screen.getAllDisplays().find((d) => String(d.id) === source.display_id);
        if (!display) continue;
        signature = displaySignature(display);
        bounds = captureMonitorBounds(display);
      }
      catalog.set(source.id, {
        source: {
          id: source.id,
          name: source.name,
          display_id: source.display_id,
          thumbnail: nativeImage.createEmpty(),
          appIcon: nativeImage.createEmpty(),
        },
        pid,
        executable,
        signature,
      });
      choices.push({
        id: source.id,
        name: source.name,
        type,
        thumbnail: source.thumbnail,
        width: bounds?.width,
        height: bounds?.height,
      });
    }
    this.sourceChoices = catalog;
    return choices;
  }
  private selectedSource(id: string) {
    const choice = this.sourceChoices.get(id);
    // Validate live identity below rather than expiring a still-open source and
    // forcing another full catalog/thumbnail scan on every recording start.
    if (!choice) throw new Error(tr('录制来源已失效'));
    if (id.startsWith('window:')) {
      const info = captureWindowInfo(Number(id.split(':')[1]));
      if (
        !info ||
        info.pid !== choice.pid ||
        info.executable !== choice.executable ||
        info.pid === process.pid
      )
        throw new Error(tr('录制来源已关闭，请重新选择'));
    } else {
      const display = screen
        .getAllDisplays()
        .find((d) => String(d.id) === choice.source.display_id);
      if (!display || displaySignature(display) !== choice.signature)
        throw new Error(tr('录制来源已失效'));
    }
    return choice.source;
  }
  /** Resolve the fresh user-selected source to native identity in physical pixels. */
  private videoTarget(): NativeVideoTarget {
    if (this.options?.videoSource === 'camera') return { kind: 'camera', handle: 0, pid: 0 };
    const source = this.selectedSource(this.options!.sourceId);
    if (source.id.startsWith('window:')) {
      const handle = Number(source.id.split(':')[1]),
        info = captureWindowInfo(handle);
      if (!info || info.pid === process.pid) throw Error('录制窗口已经关闭');
      return { kind: 'window', handle, pid: info.pid };
    }
    const display = screen.getAllDisplays().find((d) => String(d.id) === source.display_id);
    if (!display) throw Error('录制显示器已经断开');
    const bounds = captureMonitorBounds(display);
    if (
      this.region &&
      (this.region.screen.width !== bounds.width || this.region.screen.height !== bounds.height)
    )
      throw Error('显示器像素尺寸已改变，请重新选择录制区域');
    return {
      kind: 'monitor',
      handle: nativeMonitorHandle({
        x: Math.floor(bounds.x + bounds.width / 2),
        y: Math.floor(bounds.y + bounds.height / 2),
      }),
      pid: 0,
      ...(this.region ? { crop: regionPixels(this.region.rect, bounds.width, bounds.height) } : {}),
    };
  }
  private async chooseRegion(sourceId: unknown, hideMain: unknown = true) {
    if (
      !['idle', 'ready'].includes(this.phase) ||
      this.picking ||
      typeof sourceId !== 'string' ||
      typeof hideMain !== 'boolean' ||
      !/^screen:\d+:\d+$/.test(sourceId)
    )
      throw new Error(tr('请先选择屏幕'));
    const generation = this.generation;
    this.picking = true;
    try {
      const source = this.selectedSource(sourceId);
      if (!source || generation !== this.generation || this.ctx.blocked())
        throw new Error(tr('录制来源已失效'));
      this.ctx.prepare();
      const region = await this.ctx.chooseRegion(Number(source.display_id), hideMain);
      if (generation !== this.generation || this.ctx.blocked() || !region) return null;
      // Native monitor capture has its own source identity; bind this region to
      // the already validated Chromium recording source selected by the user.
      region.sourceId = source.id;
      this.selectedRegion = { token: randomUUID(), region };
      return { token: this.selectedRegion.token, ...region.pixels };
    } finally {
      if (generation === this.generation) this.picking = false;
    }
  }
  private async arm(value: unknown) {
    if (!this.pageEnabled || !this.clientValid(this.contents)) throw Error('录制页面已停用');
    if (this.initError) throw new Error(this.initError);
    if (this.phase !== 'idle' || this.picking || this.projectOperation)
      throw new Error(tr('请先完成选区、工程操作或当前录制'));
    const options = recordingOptions(value);
    if (options.regionToken) {
      const selected = this.selectedRegion,
        display = screen.getAllDisplays().find((d) => d.id === selected?.region.displayId);
      if (
        !selected ||
        selected.token !== options.regionToken ||
        selected.region.sourceId !== options.sourceId ||
        !display ||
        displaySignature(display) !== selected.region.signature
      )
        throw new Error(tr('录制选区已失效，请重新选择'));
      this.region = selected.region;
    } else this.region = undefined;
    const generation = ++this.generation;
    this.microphoneList = undefined;
    this.options = options;
    this.phase = 'arming';
    this.created = this.heartbeatAt = Date.now();
    this.message = tr('正在准备录制');
    this.displayGrant = false;
    this.micGrant = false;
    this.seconds = 0;
    this.saved = '';
    this.savedFile = undefined;
    this.token = randomUUID();
    const file = new RecordingFile(this.directory, RECORD_BYTES, options.container || 'mp4');
    this.file = file;
    this.changed();
    try {
      await this.audioTests.stopAll();
      await this.stopSetupCamera();
      if (options.mode === 'video' && options.videoSource !== 'camera') {
        const source = this.selectedSource(options.sourceId);
        if (generation !== this.generation || this.ctx.blocked()) throw new Error(tr('录制已取消'));
        this.source = source;
        if (!this.source) throw new Error(tr('录制来源已关闭，请重新选择'));
        const own = this.ctx
          .windows()
          .concat(this.owner ? [this.owner] : [])
          .some(
            (w) =>
              String(w.getNativeWindowHandle().readBigUInt64LE()) ===
              options.sourceId.split(':')[1],
          );
        if (options.sourceId.startsWith('window:') && own)
          throw new Error(tr('不能录制 One 自己的窗口'));
      }
      await file.create();
      if (generation !== this.generation || this.ctx.blocked()) throw new Error(tr('录制已取消'));
      this.ctx.prepare();
      return this.token;
    } catch (e) {
      if (generation === this.generation) await this.reset(String((e as Error).message));
      else await file.dispose();
      throw e;
    }
  }
  private checkDraft(id: unknown): asserts id is string {
    if (
      this.phase !== 'idle' ||
      this.picking ||
      this.ctx.blocked() ||
      typeof id !== 'string' ||
      !this.audioDrafts.some((draft) => draft.id === id)
    )
      throw Error('请先完成当前录制，再处理草稿');
  }
  private async recoverDraft(id: unknown) {
    this.checkDraft(id);
    const draft = this.audioDrafts.find((value) => value.id === id)!;
    if (!draft.samples) throw Error('录音草稿没有可恢复的声音，请丢弃');
    const generation = ++this.generation;
    this.recovering = true;
    this.phase = 'stopping';
    this.token = randomUUID();
    this.options = {
      mode: 'audio',
      container: 'wav',
      sourceId: '',
      systemAudio: draft.systemAudio,
      microphone: draft.microphone,
      microphoneId: '',
      fps: 30,
      maxWidth: 1920,
    };
    this.seconds = draft.samples / 48000;
    this.saved = '';
    this.savedFile = undefined;
    this.message = '正在恢复录音草稿';
    const file = new RecordingFile(this.directory, RECORD_BYTES, 'wav');
    this.file = file;
    this.changed();
    try {
      await file.create();
      const result = await recoverAudioDraft(
        join(this.directory, 'native'),
        id,
        file,
        () => generation === this.generation && !this.ctx.blocked(),
      );
      if (generation !== this.generation || this.ctx.blocked()) return;
      this.recoveredDraft = id;
      this.seconds = result.samples / 48000;
      this.mime = 'audio/wav';
      this.phase = 'ready';
      this.message = '已恢复为 WAV，请预览并保存';
      await this.presentPreview();
    } catch (error) {
      // No original is removed until an explicit save/discard after recovery.
      if (generation === this.generation)
        await this.reset((error as Error).message + '。原始草稿已保留，可重试。');
      throw error;
    } finally {
      if (generation === this.generation) {
        this.recovering = false;
        this.changed();
      }
    }
  }
  private async nativePause(token: unknown, paused: unknown) {
    this.check(token);
    if (
      !this.capture ||
      typeof paused !== 'boolean' ||
      !['recording', 'paused'].includes(this.phase)
    )
      throw Error('无法暂停录制');
    const capture = this.capture;
    await capture.pause(paused);
    if (capture !== this.capture || !['recording', 'paused'].includes(this.phase)) return;
    this.phase = paused ? 'paused' : 'recording';
    this.audioLevels = { system: 0, microphone: 0, mixed: 0, clipped: false };
    this.changed();
  }
  private async nativeGain(token: unknown, system: number, microphone: number) {
    this.check(token);
    if (!this.capture || !['recording', 'paused'].includes(this.phase))
      throw Error('无法调整录制音量');
    const capture = this.capture;
    await capture.gain(system, microphone);
    if (capture !== this.capture || !['recording', 'paused'].includes(this.phase)) return;
    this.audioGains = { system, microphone };
    this.changed();
  }
  private async waitDelay(seconds: number, generation: number) {
    if (!seconds) return;
    const target = this.captureBounds(),
      display = target
        ? screen.getDisplayMatching(screen.screenToDipRect(null, target))
        : this.owner
          ? screen.getDisplayMatching(this.owner.getBounds())
          : screen.getPrimaryDisplay();
    await this.countdown.open(display.bounds, seconds);
    if (generation !== this.generation || this.ctx.blocked()) {
      this.countdown.close();
      return;
    }
    this.countdownUntil = Date.now() + seconds * 1000;
    this.changed();
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearInterval(timer);
        if (this.cancelDelay === finish) this.cancelDelay = undefined;
        this.countdownUntil = 0;
        resolve();
      };
      const timer = setInterval(() => {
        if (
          generation !== this.generation ||
          this.ctx.blocked() ||
          Date.now() >= this.countdownUntil
        )
          finish();
        else {
          this.countdown.update(Math.ceil((this.countdownUntil - Date.now()) / 1000));
          this.changed();
        }
      }, 200);
      this.cancelDelay = finish;
    });
    this.countdown.close();
    await new Promise<void>((resolve) => setImmediate(resolve));
    flushDesktopComposition();
  }
  private async nativeStart(value: unknown) {
    const started = performance.now();
    const options = recordingOptions(value);
    if (options.mode === 'video' && options.container === 'webm')
      throw Error('原生视频暂不支持 WebM');
    await this.arm(options);
    const armed = performance.now();
    const generation = this.generation;
    try {
      if (options.mode === 'video') {
        const display = this.region
          ? screen.getAllDisplays().find((d) => d.id === this.region!.displayId)
          : undefined;
        const rect = this.region?.rect;
        await this.toolbar.open(
          this.token,
          display && rect
            ? {
                x: display.bounds.x + rect.x * display.bounds.width,
                y: display.bounds.y + rect.y * display.bounds.height,
                width: rect.width * display.bounds.width,
                height: rect.height * display.bounds.height,
              }
            : undefined,
        );
        if (generation !== this.generation || this.ctx.blocked()) return;
        this.presentRecording();
      }
      const toolbarReady = performance.now();
      await this.waitDelay(options.delay || 0, generation);
      if (generation !== this.generation || this.ctx.blocked()) return;
      const delayFinished = performance.now();
      this.created = this.heartbeatAt = Date.now();
      this.changed();
      const update = (event: import('../../shared/recording/native-audio').AudioProgress) => {
        if (generation !== this.generation || !this.capture) return;
        this.heartbeatAt = Date.now();
        this.seconds = event.samples / 48000;
        this.nativeBytes = event.bytes;
        this.audioLevels = {
          system: event.system,
          microphone: event.microphone,
          mixed: event.mixed,
          clipped: event.clipped,
        };
        this.changed();
      };
      const audio =
        options.mode === 'audio'
          ? await this.createAudio(join(this.directory, 'native'), options, update)
          : await this.createVideo(
              join(this.directory, 'native'),
              options,
              this.videoTarget(),
              update,
            );
      if (generation !== this.generation || this.ctx.blocked()) {
        await audio.dispose();
        throw Error('录音已取消');
      }
      this.capture = audio;
      await audio.ready;
      if (generation !== this.generation) return;
      const nativeReady = performance.now();
      if (audio instanceof NativeVideo && options.videoSource === 'camera') {
        let lastFrame = 0;
        audio.onCameraFrame = () => {
          if (
            this.capture !== audio ||
            generation !== this.generation ||
            Date.now() - lastFrame < 100
          )
            return;
          lastFrame = Date.now();
          this.changed();
        };
      }
      if (audio instanceof NativeVideo && this.region && audio.movableRegion) {
        this.activeCrop = audio.crop;
        await this.regionOverlay.open(this.token);
        if (generation !== this.generation) return;
      }
      if (audio instanceof NativeVideo && options.camera && audio.camera) {
        await this.cameraOverlay.open(
          this.token,
          options.camera.style,
          audio.video!,
          audio.camera,
          () => (generation === this.generation ? this.captureBounds() : null),
        );
        if (generation !== this.generation) return;
        audio.onCameraFrame = () => {
          if (this.capture === audio && generation === this.generation)
            this.cameraOverlay.frame(audio.cameraSerial);
        };
        this.cameraOverlay.frame(audio.cameraSerial);
      }
      if (audio instanceof NativeVideo) {
        if (inputEnabled(options.input))
          await this.inputOverlay.open(
            this.token,
            options.input!,
            audio.video!.width,
            audio.video!.height,
            () => (generation === this.generation ? this.captureBounds() : null),
          );
        if (generation !== this.generation) return;
        audio.onInput = (events) => {
          if (this.capture === audio && generation === this.generation)
            this.inputOverlay.push(events);
        };
      }
      this.phase = 'recording';
      this.message = '';
      this.heartbeatAt = Date.now();
      this.mime =
        options.mode === 'video'
          ? 'video/mp4'
          : options.container === 'wav'
            ? 'audio/wav'
            : 'audio/mp4;codecs=mp4a.40.2';
      this.changed();
      const completed = performance.now();
      this.ctx.timing?.({
        mode: options.mode,
        armMs: Math.round(armed - started),
        toolbarMs: Math.round(toolbarReady - armed),
        delayMs: Math.round(delayFinished - toolbarReady),
        nativeMs: Math.round(nativeReady - delayFinished),
        overlaysMs: Math.round(completed - nativeReady),
        totalMs: Math.round(completed - started),
      });
      void audio.done
        .then(() => {
          if (this.capture === audio && generation === this.generation)
            void this.ctx.background(this.nativeFinish()).catch(() => {});
        })
        .catch((error) => {
          if (this.capture === audio && generation === this.generation) {
            this.message = String(error.message);
            void this.ctx.background(this.nativeFinish()).catch(() => {});
          }
        });
    } catch (error) {
      if (generation === this.generation) await this.reset((error as Error).message);
      throw error;
    }
  }
  private nativeFinish(reason = ''): Promise<void> {
    if (this.nativeFinishing) return this.nativeFinishing;
    const audio = this.capture,
      generation = this.generation;
    if (!audio || !this.options) return Promise.reject(Error('原生录音已经结束'));
    const operation = (async () => {
      this.regionOverlay.close();
      let annotationWarning = '';
      try {
        await this.annotationOverlay.flush();
      } catch (error) {
        annotationWarning = (error as Error).message;
      }
      this.annotationOverlay.close();
      this.inputOverlay.close();
      this.cameraOverlay.close();
      this.phase = 'stopping';
      this.nativeRetry = false;
      this.message = this.options!.mode === 'video' ? '正在处理视频' : '正在处理录音';
      this.changed();
      try {
        if (audio instanceof NativeVideo) {
          await audio.flushRegions();
          await audio.flushCameraLayouts();
          await audio.flushAnnotations();
        }
        let result: { samples: number; bytes: number; warning: string } | undefined;
        let interrupted = '';
        try {
          result = await audio.finish();
        } catch (error) {
          interrupted = (error as Error).message || '原生采集意外结束';
          await audio.waitClosed();
        }
        if (generation !== this.generation) return;
        const separateAudio = !interrupted;
        if (interrupted && audio instanceof NativeVideo) {
          result = await audio.recover(() => generation === this.generation && !this.ctx.blocked());
          interrupted = '';
        }
        // A failed seal leaves the native result intact. Each retry receives a
        // fresh encrypted file, so acknowledged fragments cannot be duplicated.
        const previous = this.file!;
        const file = new RecordingFile(
          this.directory,
          RECORD_BYTES,
          interrupted ? 'wav' : this.options!.container || 'mp4',
        );
        this.file = file;
        await previous.dispose();
        if (generation !== this.generation) {
          await file.dispose();
          return;
        }
        await file.create();
        const valid = () => generation === this.generation && !this.ctx.blocked();
        if (interrupted) {
          const recovered = await recoverAudioDraft(
            join(this.directory, 'native'),
            basename(audio.directory),
            file,
            valid,
          );
          result = {
            ...recovered,
            warning: '录音中断，已恢复为 WAV，请预览并保存。' + interrupted.slice(0, 300),
          };
          if (valid()) this.options = { ...this.options!, container: 'wav' };
        } else await audio.seal(file, valid);
        if (audio instanceof NativeVideo && audio.camera && audio.cameraSamples) {
          const previousCamera = this.cameraFile;
          const cameraFile = new RecordingFile(this.directory, RECORD_BYTES, 'mp4');
          this.cameraFile = cameraFile;
          await previousCamera?.dispose();
          if (!valid()) {
            await cameraFile.dispose();
            return;
          }
          await cameraFile.create();
          await audio.sealCamera(cameraFile, valid);
        }
        const previousAudio = this.audioFiles;
        this.audioFiles = {};
        await Promise.all(Object.values(previousAudio).map((track) => track.dispose()));
        if (separateAudio)
          for (const source of RECORDING_AUDIO_SOURCES) {
            if (!(source === 'system' ? this.options!.systemAudio : this.options!.microphone))
              continue;
            const track = new RecordingFile(this.directory, RECORD_BYTES, 'wav');
            this.audioFiles[source] = track;
            if (!valid()) {
              await track.dispose();
              return;
            }
            await track.create();
            await audio.sealAudioSource(source, track, valid);
          }
        if (generation !== this.generation) return;
        this.seconds = result!.samples / 48000;
        this.nativeBytes = result!.bytes;
        this.phase = 'ready';
        this.mime =
          this.options!.mode === 'video'
            ? 'video/mp4'
            : this.options!.container === 'wav'
              ? 'audio/wav'
              : 'audio/mp4;codecs=mp4a.40.2';
        await this.presentPreview();
        this.message = [
          this.message.startsWith('素材工程自动保存失败') ? this.message : '',
          result!.warning,
          reason,
          annotationWarning,
          !separateAudio && (this.options!.systemAudio || this.options!.microphone)
            ? '恢复结果使用原片混合声音，独立声源未恢复'
            : '',
        ]
          .filter(Boolean)
          .join('。');
        this.audioLevels = { system: 0, microphone: 0, mixed: 0, clipped: false };
        this.changed();
        // Keep ownership until reset: the original remains available if an
        // encrypted export later fails. Explicit cancel releases both copies.
      } catch (error) {
        if (generation === this.generation) {
          this.nativeRetry = true;
          this.message =
            (error as Error).message +
            (audio.retryable
              ? '。录制已保留，可重试处理。'
              : audio instanceof NativeVideo
                ? '。原始视频暂存已保留，尚未完成修复。'
                : '。原始草稿已保留，可重试恢复为 WAV。');
          this.changed();
        }
        throw error;
      }
    })();
    this.nativeFinishing = operation;
    void operation
      .finally(() => {
        if (this.nativeFinishing === operation) this.nativeFinishing = undefined;
      })
      .catch(() => {});
    return operation;
  }
  private started(token: unknown, mime: unknown) {
    this.check(token);
    if (
      !this.armed() ||
      !this.needsDisplay() ||
      !validRecordingMime(mime, this.options!) ||
      (this.needsDisplay() && !this.displayGrant)
    )
      throw new Error(tr('录制来源或编码器无效'));
    this.mime = mime;
    this.phase = 'recording';
    this.message = '';
    this.heartbeatAt = Date.now();
    this.presentRecording();
    this.changed();
  }
  private presentRecording() {
    if (this.options?.videoSource === 'camera') return;
    if (!this.needsDisplay()) {
      this.shown = [
        ...new Set([...this.ctx.windows(), ...(this.owner ? [this.owner] : [])]),
      ].filter((w) => w !== this.toolbar.window && w.isVisible());
      for (const window of this.shown) window.hide();
      return;
    }
    this.shown = this.ctx.windows().filter((w) => w !== this.owner && w.isVisible());
    for (const w of this.shown) w.hide();
  }
  private async chunk(token: unknown, index: unknown, data: unknown) {
    this.check(token);
    if (
      !this.needsDisplay() ||
      !['recording', 'paused', 'stopping'].includes(this.phase) ||
      typeof index !== 'number' ||
      !(data instanceof Uint8Array) ||
      this.pendingBytes + data.byteLength > RECORD_CHUNK * 2
    )
      throw new Error(tr('录制片段无法接收'));
    const generation = this.generation,
      file = this.file!;
    this.pendingBytes += data.byteLength;
    try {
      await file.append(index, data);
      if (generation !== this.generation) throw new Error(tr('录制已取消'));
    } finally {
      this.pendingBytes -= data.byteLength;
    }
  }
  private async finish(token: unknown, seconds: unknown, reason: unknown, mime: unknown) {
    this.check(token);
    if (this.capture || this.options?.mode === 'audio') throw Error('原生录制由采集进程完成');
    if (!['recording', 'paused', 'stopping'].includes(this.phase))
      throw new Error(tr('录制尚未开始'));
    if (!validRecordingMime(mime, this.options!)) throw new Error(tr('实际编码格式不受支持'));
    this.mime = mime;
    this.time(seconds);
    const generation = this.generation,
      file = this.file!;
    this.phase = 'stopping';
    await file.finish();
    if (generation !== this.generation || this.ctx.blocked()) return;
    this.phase = 'ready';
    this.message = typeof reason === 'string' && reason ? reason.slice(0, 300) : this.message;
    await this.presentPreview();
    this.changed();
    this.finishWaiter?.();
  }
  startFromHost() {
    if (!this.contents || this.contents.isDestroyed()) throw Error('录制页面仍在加载，请稍后重试');
    if (!this.pageEnabled || !this.canStart || !['idle', 'ready'].includes(this.phase)) {
      this.changed();
      return;
    }
    this.canStart = false;
    this.ctx.availabilityChanged?.();
    this.changed();
    this.contents.send('one:recording-start');
  }
  async removeMaterial(id: string) {
    if (!this.ctx.materials) throw Error('素材不可用');
    if (
      this.materialId === id &&
      (this.projectOperation || this.exporter.busy || this.materialSaving)
    )
      throw Error('请等待当前工程操作完成');
    await this.ctx.materials.removeRecording(id);
    if (this.materialId === id) await this.reset();
  }
  async importMaterial(kind: 'project' | 'video' = 'project') {
    if (kind !== 'project' && kind !== 'video') throw Error('不支持的素材类型');
    if (!this.owner) await this.open();
    return this.openProject(kind);
  }
  async openExternalProject(file:string){
    if(!this.owner)await this.open();
    return this.openProject('project',file);
  }
  async openMaterial(id: string) {
    const materials = this.ctx.materials;
    if (!materials || typeof id !== 'string') throw Error('素材不存在');
    const path = materials.recordingPath(id),
      playback = await materials.playback(id);
    if (!this.owner) await this.open();
    return this.openProject('project', path, id, playback);
  }
  private archiveMaterial() {
    if (!this.ctx.materials || !this.file || this.phase !== 'ready') return Promise.resolve();
    if (this.materialSaving) return this.materialSaving;
    if (this.materialId) return this.ctx.materials.updateRecording(this.materialId, this.playback);
    const id = this.materialDraftId ||= randomUUID(),
      generation = this.generation,
      revision = this.projectRevision;
    const valid = () => generation === this.generation && !this.ctx.blocked();
    const snapshot = this.projectSnapshot(),
      media: { kind: RecordingProjectKind; file: RecordingFile }[] = [
        { kind: 'screen', file: this.file },
      ];
    if (this.cameraFile) media.push({ kind: 'camera', file: this.cameraFile });
    for (const kind of RECORDING_AUDIO_SOURCES)
      if (this.audioFiles[kind]) media.push({ kind, file: this.audioFiles[kind]! });
    const promise = Promise.resolve()
      .then(() => this.ctx.materialsReady?.())
      .then(() => {
        if (!valid()) throw Error('录制素材保存已取消');
        return this.ctx.materials!.addRecording(
        {
          id,
          title:
            (this.options?.mode === 'audio' ? '录音 ' : '录制 ') +
            new Date().toLocaleString('zh-CN'),
          created: Date.now(),
          seconds: this.seconds,
          bytes: media.reduce((total, entry) => total + entry.file.bytes, 0),
          mode: this.options!.mode,
        },
        (destination) => saveRecordingProject(destination, snapshot, media, valid),
        this.playback,
      );
      })
      .then(() => {
        if (valid()) {
          this.materialId = id;
          this.projectName = '已自动保存到素材';
          this.savedProjectRevision = revision;
          this.changed();
        }
      })
      .finally(() => {
        if (this.materialSaving === promise) this.materialSaving = undefined;
      });
    this.materialSaving = promise;
    return promise;
  }
  private async presentPreview() {
    try {
      await this.archiveMaterial();
    } catch (error) {
      this.message = '素材工程自动保存失败，请保存工程后继续：' + (error as Error).message;
    }

    this.toolbar.close();
    this.restore();
    if (this.draining) return;
    const token = this.token;
    void this.ctx.background(this.player.open()).catch((error) => {
      if (this.token !== token || !['ready', 'saving'].includes(this.phase)) return;
      this.message = '无法打开录制结果窗口，请从素材页面重新打开工程。' + String(error.message);
      this.changed();
    });
  }
  private restore() {
    for (const w of this.shown) if (!w.isDestroyed() && !this.ctx.blocked()) w.show();
    this.shown = [];
  }
  private async reset(message = '') {
    const testsStopping = this.audioTests.stopAll();
    const cameraStopping = this.stopSetupCamera();
    this.importAbort?.abort();
    this.importAbort = undefined;
    this.player.close();
    this.playback = defaultPlayback();
    this.restored = undefined;
    this.projectName = '';
    this.materialId = '';
    this.materialDraftId = '';
    this.projectRevision = 0;
    this.savedProjectRevision = undefined;
    this.cancelDelay?.();
    this.countdown.close();
    this.toolbar.close();
    this.inputOverlay.close();
    this.cameraOverlay.close();
    this.annotationOverlay.close();
    this.regionOverlay.close();
    this.activeCrop = undefined;
    this.microphoneList = undefined;
    // Native camera streams live in the helper, which is disposed below.
    // Keep the device and capture settings in the page so cancellation can be retried.
    const generation = ++this.generation;
    if (this.picking) this.ctx.cancelRegion();
    this.picking = false;
    this.listing++;
    this.sourceChoices.clear();
    this.selectedRegion = undefined;
    this.region = undefined;
    const file = this.file;
    const cameraFile = this.cameraFile;
    const audioFiles = this.audioFiles;
    this.audioFiles = {};
    this.cameraFile = undefined;
    this.cameraSaved = '';
    const audio = this.capture;
    const draft = this.recoveredDraft;
    this.recoveredDraft = undefined;
    this.recovering = false;
    this.capture = undefined;
    this.nativeBytes = 0;
    this.nativeRetry = false;
    this.nativeFinishing = undefined;
    this.audioLevels = { system: 0, microphone: 0, mixed: 0, clipped: false };
    this.audioGains = { system: 1, microphone: 1 };
    this.file = undefined;
    this.token = '';
    this.source = undefined;
    this.options = undefined;
    this.mime = '';
    this.seconds = 0;
    this.saved = '';
    this.savedFile = undefined;
    this.phase = 'idle';
    this.message = message;
    this.displayGrant = false;
    this.micGrant = false;
    this.contents?.send('one:recording-stop');
    this.restore();
    this.changed();
    await Promise.all([
      testsStopping,
      cameraStopping,
      this.exporter.reset(),
      file?.dispose(),
      cameraFile?.dispose(),
      ...Object.values(audioFiles).map((track) => track.dispose()),
      audio?.dispose(),
      draft ? discardAudioDraft(join(this.directory, 'native'), draft) : undefined,
      this.previews.stop(),
    ]);
    if (generation === this.generation) {
      const drafts = await listAudioDrafts(join(this.directory, 'native'));
      if (generation === this.generation) {
        this.audioDrafts = drafts;
        this.changed();
      }
    }
    if (!this.active) this.finishWaiter?.();
  }
  abort(message = '') { return this.reset(message); }
  private resultInputs(after: number): RecordingProject['inputs'] {
    if (this.capture instanceof NativeVideo) return this.capture.inputEvents(after);
    const events = this.restored?.inputs || [];
    if (!Number.isSafeInteger(after) || after < 0 || after > events.length)
      throw Error('键鼠时间轴页码无效');
    return events.slice(after, after + 512);
  }
  private resultAnnotations(after: number): RecordingProject['annotations'] {
    if (this.capture instanceof NativeVideo) return this.capture.annotationEvents(after);
    const events = this.restored?.annotations || [];
    if (!Number.isSafeInteger(after) || after < 0 || after > events.length)
      throw Error('标注时间轴页码无效');
    const page: RecordingProject['annotations'] = [];
    let bytes = 0;
    for (const event of events.slice(after, after + 128)) {
      const size = Buffer.byteLength(JSON.stringify(event));
      if (bytes + size > 2 * 1024 * 1024 && page.length) break;
      page.push(event);
      bytes += size;
    }
    return page;
  }
  private resultLayouts(): RecordingProject['layouts'] {
    return this.capture instanceof NativeVideo
      ? this.capture.cameraLayouts()
      : this.restored?.layouts || [];
  }
  private resultCursor() {
    return this.capture instanceof NativeVideo ? this.capture.cursor : this.restored?.cursor;
  }
  private resultCursorEvents(after: number): CursorEvent[] {
    const events = this.resultCursor()?.events || [];
    if (!Number.isSafeInteger(after) || after < 0 || after > events.length)
      throw Error('光标预览页无效');
    return events.slice(after, after + 1024);
  }
  private projectSnapshot(): RecordingProject {
    const state = this.state(),
      inputs: RecordingProject['inputs'] = [],
      annotations: RecordingProject['annotations'] = [],
      layouts = this.resultLayouts(),
      sources = RECORDING_AUDIO_SOURCES.filter((source) => this.audioFiles[source]);
    for (;;) {
      const page = this.resultInputs(inputs.length);
      if (!page.length) break;
      inputs.push(...page);
    }
    for (;;) {
      const page = this.resultAnnotations(annotations.length);
      if (!page.length) break;
      annotations.push(...page);
    }
    return {
      format: RECORDING_PROJECT_FORMAT.id,
      version: RECORDING_PROJECT_FORMAT.version,
      ...(this.restored?.origin ? { origin: this.restored.origin } : {}),
      ...(this.resultCursor() ? { cursor: this.resultCursor() } : {}),
      ...(sources.length ? { sources } : {}),
      seconds: this.seconds,
      options: this.options!,
      playback: this.playback,
      video: state.video,
      camera: state.camera,
      cameraSeconds: state.cameraSeconds,
      cameraStyle: state.cameraStyle || layouts.at(-1)?.style || state.options?.camera?.style,
      inputStyle: state.inputStyle,
      recordedInput: state.recordedInput,
      inputs,
      annotations,
      layouts,
    };
  }
  private async saveProject(owner: BrowserWindow) {
    if (
      this.phase !== 'ready' ||
      !this.file ||
      this.projectOperation ||
      this.exporter.busy ||
      this.ctx.blocked()
    )
      throw Error('请先完成当前录制或工程操作');
    const generation = this.generation,
      valid = () => generation === this.generation && !this.ctx.blocked();
    this.projectOperation = true;
    this.changed();
    try {
      const chosen = await dialog.showSaveDialog(owner, {
        title: '保存录制工程',
        defaultPath: this.projectName || 'One-录制.onerec',
        filters: [{ name: 'One 录制工程', extensions: ['onerec'] }],
      });
      if (chosen.canceled || !chosen.filePath || !valid()) return null;
      const destination =
        extname(chosen.filePath).toLowerCase() === '.onerec'
          ? chosen.filePath
          : chosen.filePath + '.onerec';
      this.ctx.protect(destination);
      if (
        resolve(destination)
          .toLowerCase()
          .startsWith(resolve(this.directory).toLowerCase() + sep)
      )
        throw Error('不能保存到录制暂存目录');
      const snapshot = this.projectSnapshot(),
        revision = this.projectRevision,
        media: { kind: RecordingProjectKind; file: RecordingFile }[] = [
          { kind: 'screen', file: this.file! },
        ];
      if (this.cameraFile) media.push({ kind: 'camera', file: this.cameraFile });
      for (const source of RECORDING_AUDIO_SOURCES)
        if (this.audioFiles[source]) media.push({ kind: source, file: this.audioFiles[source]! });
      this.phase = 'saving';
      this.changed();
      await saveRecordingProject(destination, snapshot, media, valid);
      if (!valid()) return null;
      this.projectName = basename(destination);
      this.savedProjectRevision = revision;
      return this.projectName;
    } finally {
      this.projectOperation = false;
      if (valid() && this.phase === 'saving') this.phase = 'ready';
      this.changed();
    }
  }
  private async openProject(
    kind: 'project' | 'video' = 'project',
    materialPath?: string,
    materialId = '',
    materialPlayback?: import('../../shared/recording/recording-playback').PlaybackSettings,
  ) {
    const owner = this.owner;
    if (
      !owner ||
      this.ctx.blocked() ||
      this.active ||
      this.picking ||
      this.phase === 'saving' ||
      this.exporter.busy ||
      this.projectOperation
    )
      throw Error('请先完成当前录制或工程操作');
    const abort = kind === 'video' ? new AbortController() : undefined;
    this.importAbort = abort;
    const generation = this.generation,
      unsaved = this.hasUnsaved,
      valid = () =>
        generation === this.generation &&
        !this.ctx.blocked() &&
        !owner.isDestroyed() &&
        !abort?.signal.aborted;
    this.projectOperation = true;
    this.changed();
    let imported: Awaited<ReturnType<typeof openRecordingProject>> | undefined;
    try {
      const chosen = materialPath
        ? { canceled: false, filePaths: [materialPath] }
        : await dialog.showOpenDialog(owner, {
            title: kind === 'video' ? '导入视频制作 GIF' : '打开录制工程',
            properties: ['openFile'],
            filters:
              kind === 'video'
                ? [{ name: '视频', extensions: ['mp4', 'm4v', 'webm'] }]
                : [{ name: 'One 录制工程', extensions: ['onerec'] }],
          });
      if (chosen.canceled || !chosen.filePaths[0] || !valid()) return;
      // Keep the existing result until the complete replacement passes validation.
      if (kind === 'video') {
        this.message = '正在分析视频…';
        this.changed();
        const executable = await resolveVideoProbe(join(__dirname, '../native'));
        let lastChanged = 0;
        imported = await importRecordingVideo(
          chosen.filePaths[0],
          this.directory,
          executable,
          abort!.signal,
          valid,
          (value) => {
            if (!valid() || Date.now() - lastChanged < 100) return;
            lastChanged = Date.now();
            this.message = '正在导入视频… ' + Math.floor(value * 100) + '%';
            this.changed();
          },
        );
      } else imported = await openRecordingProject(chosen.filePaths[0], this.directory, valid);
      if (!valid()) throw Error('打开工程已取消');
      if (unsaved) {
        const answer = await this.ctx.confirm(owner, {
          type: 'question',
          message: '替换当前尚未保存的录制？',
          detail:
            (kind === 'video' ? '视频已校验。' : '工程已校验。') +
            '替换后，当前未保存的结果和编辑将被放弃。',
          buttons: ['保留当前录制', kind === 'video' ? '导入视频' : '打开工程'],
          defaultId: 0,
          cancelId: 0,
        });
        if (answer.response !== 1 || !valid()) return;
      }
      this.importAbort = undefined;
      const resetting = this.reset(),
        installedGeneration = this.generation;
      await resetting;
      if (this.ctx.blocked() || this.generation !== installedGeneration || owner.isDestroyed())
        throw Error('打开工程已取消');
      const { project, file, cameraFile, audioFiles } = imported;
      this.restored = project;
      this.file = file;
      this.cameraFile = cameraFile;
      this.audioFiles = audioFiles;
      imported = undefined;
      this.options = project.options;
      this.playback = materialPlayback || project.playback;
      this.materialId = materialId;
      this.seconds = project.seconds;
      this.nativeBytes = file.bytes;
      this.mime = recordingContentType(project.options);
      this.projectName = kind === 'video' ? '' : basename(chosen.filePaths[0]);
      this.savedProjectRevision = kind === 'video' ? undefined : 0;
      this.token = randomUUID();
      this.phase = 'ready';
      this.message =
        kind === 'video'
          ? '已导入 ' +
            basename(chosen.filePaths[0]).slice(0, 180) +
            '。可选择片段导出 GIF；GIF 不包含声音。'
          : '已打开录制工程';
      await this.presentPreview();
    } catch (error) {
      if (abort?.signal.aborted) {
        if (generation === this.generation && !owner.isDestroyed())
          this.message = '视频导入已取消，原有结果仍保留';
        return;
      }
      if (valid())
        this.message =
          (kind === 'video' ? '无法导入视频：' : '无法打开工程：') +
          (error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      await Promise.all([
        imported?.file.dispose(),
        imported?.cameraFile?.dispose(),
        ...Object.values(imported?.audioFiles || {}).map((track) => track.dispose()),
      ]);
      if (this.importAbort === abort) this.importAbort = undefined;
      this.projectOperation = false;
      this.changed();
    }
  }
  private async save(camera = false, owner = this.owner) {
    const track = camera ? this.cameraFile : this.file;
    if (this.phase !== 'ready' || !track || this.projectOperation || this.exporter.busy)
      throw new Error(tr('请先停止录制或完成工程操作'));
    const generation = this.generation,
      file = track,
      extension = camera ? 'mp4' : recordingExtension(this.options!);
    this.phase = 'saving';
    this.changed();
    try {
      const choice = await dialog.showSaveDialog(owner!, {
        title: tr(camera ? '保存摄像头原片' : '保存录制（未加密的新文件）'),
        defaultPath: `One-${camera ? 'Camera-' : ''}${new Date().toISOString().replaceAll(':', '-').slice(0, 19)}.${extension}`,
        filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
      });
      if (choice.canceled || !choice.filePath) return null;
      if (generation !== this.generation || this.ctx.blocked()) throw new Error(tr('录制已取消'));
      let destination = choice.filePath;
      if (extname(destination).toLowerCase() !== '.' + extension) destination += '.' + extension;
      this.ctx.protect(destination);
      if (
        resolve(destination)
          .toLowerCase()
          .startsWith(resolve(this.directory).toLowerCase() + sep)
      )
        throw new Error(tr('不能保存到录制暂存目录'));
      try {
        const result = await file.export(
          destination,
          () => generation === this.generation && !this.ctx.blocked(),
        );
        if (generation !== this.generation || this.ctx.blocked()) throw new Error(tr('录制已取消'));
        const info = await stat(destination);
        if (generation !== this.generation || this.ctx.blocked()) throw new Error(tr('录制已取消'));
        if (camera) this.cameraSaved = result;
        else {
          this.savedFile = {
            path: destination,
            size: info.size,
            mtimeMs: info.mtimeMs,
            ino: info.ino,
          };
          this.saved = result;
        }
        this.message = tr`已保存：${result}`;
        return result;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EEXIST')
          throw new Error(tr('文件已存在，请选择新文件名'));
        throw e;
      }
    } finally {
      if (generation === this.generation) {
        this.phase = 'ready';
        this.changed();
      }
    }
  }
  private async cameraLayout(value: CameraStyle) {
    const style = cameraStyle(value),
      audio = this.capture,
      generation = this.generation;
    if (
      !(audio instanceof NativeVideo) ||
      !['recording', 'paused'].includes(this.phase) ||
      this.nativeFinishing ||
      this.ctx.blocked()
    )
      throw Error('摄像头会话已经结束');
    await audio.layoutCamera(
      style,
      () => this.capture === audio && generation === this.generation && !this.ctx.blocked(),
    );
  }
  private async configureInput(token: string, value: InputStyle) {
    this.check(token);
    const style = inputStyle(value),
      capture = this.capture,
      generation = this.generation;
    const current = () =>
      this.capture === capture && generation === this.generation && !this.ctx.blocked();
    const active = () =>
      current() && ['recording', 'paused'].includes(this.phase) && !this.nativeFinishing;
    if (!(capture instanceof NativeVideo) || !capture.video || !active())
      throw Error('键鼠录制会话已结束');
    // Accepted settings finish journaling before native stop; do not reopen visual layers while stopping.
    await capture.configureInput(style, current);
    if (!active()) return;
    if (!inputEnabled(style)) this.inputOverlay.close();
    else if (this.inputOverlay.window) this.inputOverlay.setStyle(style);
    else {
      await this.inputOverlay.open(token, style, capture.video.width, capture.video.height, () =>
        generation === this.generation ? this.captureBounds() : null,
      );
      if (!active()) {
        this.inputOverlay.close();
        return;
      }
    }
    this.changed();
  }
  private captureBounds(): Electron.Rectangle | null {
    if (!this.source) return null;
    if (this.source.id.startsWith('window:'))
      return captureWindowBounds(Number(this.source.id.split(':')[1]));
    const display = screen.getAllDisplays().find((d) => String(d.id) === this.source!.display_id);
    if (!display) return null;
    const bounds = captureMonitorBounds(display),
      crop =
        this.activeCrop ||
        (this.region
          ? regionPixels(this.region.rect, bounds.width, bounds.height)
          : { x: 0, y: 0, width: bounds.width, height: bounds.height });
    return { x: bounds.x + crop.x, y: bounds.y + crop.y, width: crop.width, height: crop.height };
  }
  private async stopSetupCamera() {
    this.setupCameraRevision++;
    this.setupCameraToken = '';
    const preview = this.setupCamera;
    this.setupCamera = undefined;
    this.setupCameraStopping = Promise.all([this.setupCameraStopping, preview?.stop()]).then(
      () => {},
    );
    await this.setupCameraStopping;
  }
  private async previewSetupCamera(device: unknown): Promise<string | null> {
    await this.stopSetupCamera();
    if (device === null) return null;
    if (
      typeof device !== 'string' ||
      device.length > 2048 ||
      this.ctx.blocked() ||
      !['idle', 'ready'].includes(this.phase) ||
      !this.pageEnabled
    )
      throw Error('摄像头预览已失效');
    const revision = this.setupCameraRevision;
    const devices = await this.listCameras();
    if (revision !== this.setupCameraRevision || !['idle', 'ready'].includes(this.phase))
      return null;
    if (!devices.some((camera) => camera.id === device)) throw Error('摄像头已断开');
    const preview = this.createCameraPreview(device);
    this.setupCamera = preview;
    try {
      await preview.ready;
      if (this.setupCamera !== preview || revision !== this.setupCameraRevision) return null;
      this.setupCameraToken = randomUUID();
      return 'one-file://recording-camera-setup/' + this.setupCameraToken;
    } catch (error) {
      if (this.setupCamera !== preview) return null;
      await this.stopSetupCamera();
      throw error;
    }
  }
  private async cameraPreview(request: Request): Promise<Response> {
    const url = new globalThis.URL(request.url),
      audio = this.capture,
      token = this.token;
    if (
      this.ctx.blocked() ||
      url.pathname !== '/' + token ||
      !(audio instanceof NativeVideo) ||
      !audio.previewCamera ||
      !['arming', 'recording', 'paused'].includes(this.phase) ||
      request.method !== 'GET'
    )
      return new Response('Not found', { status: 404 });
    try {
      const bytes = await audio.cameraPreview();
      if (this.capture !== audio || token !== this.token || this.ctx.blocked())
        return new Response('Not found', { status: 404 });
      return new Response(new Uint8Array(bytes), {
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  }
  private media(request: Request, kind: RecordingProjectKind = 'screen'): Response {
    const url = new globalThis.URL(request.url);
    const file =
      kind === 'camera' ? this.cameraFile : kind === 'screen' ? this.file : this.audioFiles[kind];
    if (
      this.ctx.blocked() ||
      url.pathname !== '/' + this.token ||
      !file ||
      !['ready', 'saving'].includes(this.phase) ||
      !['GET', 'HEAD'].includes(request.method)
    )
      return new Response('Not found', { status: 404 });
    let range;
    try {
      range = recordingRange(request.headers.get('Range'), file.bytes);
    } catch {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${file.bytes}` },
      });
    }
    const headers: Record<string, string> = {
      'Content-Type':
        kind === 'system' || kind === 'microphone'
          ? 'audio/wav'
          : recordingContentType(this.options!),
      'Accept-Ranges': 'bytes',
      'Content-Length': String(range.end - range.start + 1),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': 'one://app',
    };
    if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${file.bytes}`;
    return new Response(
      request.method === 'HEAD'
        ? null
        : (Readable.toWeb(Readable.from(file.read(range.start, range.end))) as ReadableStream),
      { status: range.partial ? 206 : 200, headers },
    );
  }
  /** Drain capture before One asks the user to save/discard. Keep result and client alive. */
  finishCapture(): Promise<void> {
    if (this.finishTask) return this.finishTask;
    this.draining = true;
    const task = (async () => {
      if (this.picking) this.ctx.cancelRegion();
      this.importAbort?.abort();
      await this.pageActive(false);
      if (this.capture && this.active) await this.nativeFinish();
      else if (this.phase === 'arming') await this.reset();
      else if (this.active) {
        if (!this.clientValid(this.contents)) throw Error('录制页面已关闭，无法完成录制');
        await new Promise<void>((resolve, reject) => {
          const done = () => { clearTimeout(timer); this.finishWaiter = undefined; resolve(); };
          const timer = setTimeout(() => {
            if (this.finishWaiter === done) this.finishWaiter = undefined;
            reject(Error('录制数据尚未写入完成，请保留应用并重试'));
          }, 20000);
          this.finishWaiter = done;
          this.phase = 'stopping';
          this.changed();
          this.contents!.send('one:recording-stop');
        });
      }
      await Promise.allSettled([...this.clientTasks]);
    })();
    this.finishTask = task;
    void task.finally(() => { this.draining = false; if (this.finishTask === task) this.finishTask = undefined; }).catch(() => {});
    return task;
  }
  saveCurrentProject() {
    if (!this.owner) throw Error('录制页面已关闭');
    return this.saveProject(this.owner);
  }
  cancelExport() { return this.exporter.reset(); }
  /** One calls this only after saving, or with explicit discard intent from its close flow. */
  dispose(discard = false): Promise<void> {
    if (this.disposal) return this.disposal;
    if (!discard && this.hasUnsaved) return Promise.reject(Error('请先保存或放弃录制'));
    this.closing = true;
    clearInterval(this.timer);
    this.clientCleanup?.();
    this.clientCleanup = undefined;
    return this.disposal = (async () => {
      await this.pageActive(false);
      await this.abort();
      await Promise.allSettled([...this.clientTasks]);
      this.client = undefined;
      this.resourceWindows.clear();
    })();
  }
}
