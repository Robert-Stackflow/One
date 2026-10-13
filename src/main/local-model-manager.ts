import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { LocalModelChoice, LocalModelEntry, LocalModelManagerState, LocalModelProgress, LocalModelPurpose, LocalModelState } from '../shared/local-models';
import { inferencePreference } from '../shared/inference-devices';
import { LocalModelStore } from './local-model-store';
import { localModelCatalog } from './local-model-catalog';
import { readInferenceDevices } from './inference-devices';
import { OCRModels, ocrPacks } from './recognition/ocr-models';
import { aiModelPath, repairModel, validAiModel } from './image-ai-model';

const defaults = () => ({ ocr: { modelId: 'tesseract', device: { mode: 'auto' as const } }, repair: { modelId: 'migan-pipeline-v2', device: { mode: 'auto' as const } } });
export class LocalModelManager {
  readonly store: LocalModelStore;
  private choices: LocalModelManagerState['choices'] = defaults();
  private revision = randomUUID();
  private loading?: Promise<void>;
  private saving = false;
  private deviceTask?: Promise<void>;
  private devicesAbort?: AbortController;
  private devices: LocalModelManagerState['devices'] = { gpus: [] };
  private states = new Map<string, LocalModelState>();
  private tasks = new Map<string, { abort: AbortController; promise: Promise<unknown> }>();
  private progress = new Map<string, LocalModelProgress>();
  private errors = new Map<string, string>();
  private usage = new Map<string, number>();
  private legacyRepairReady = false;
  private stopped = false;
  constructor(private dataDirectory: string, private tesseract: OCRModels, transport: typeof fetch = fetch,
      private deviceReader: typeof readInferenceDevices = readInferenceDevices) {
    this.dataDirectory = resolve(dataDirectory);
    this.store = new LocalModelStore(join(dataDirectory, 'models', 'library'), transport);
  }
  private preset(id: unknown) {
    const model = localModelCatalog.find(model => model.id === id);
    if (!model) throw Error('此模型尚未适配，无法下载或使用');
    return model;
  }
  private choice(purpose: unknown, input: unknown): LocalModelChoice {
    if (purpose !== 'ocr' && purpose !== 'repair') throw Error('此功能尚未接入本地模型');
    const value = input as LocalModelChoice;
    if (!value || typeof value.modelId !== 'string') throw Error('模型选择无效');
    const backends = purpose === 'ocr' && value.modelId === 'tesseract' ? ['cpu'] : (() => {
      const model = this.preset(value.modelId); if (model.purpose !== purpose) throw Error('模型与功能不匹配'); return model.backends;
    })();
    const device = inferencePreference(value.device);
    if (device.mode === 'gpu' && !backends.includes('dml')) throw Error('此模型尚未适配 GPU，请使用 CPU 或自动模式');
    return { modelId: value.modelId, device };
  }
  private load() {
    return this.loading ||= (async () => {
      const path = join(this.dataDirectory, 'local-models.json');
      let stat;
      try { stat = await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw Error('本地模型设置文件无效');
      const value = JSON.parse(await readFile(path, 'utf8'));
      this.choices = { ocr: this.choice('ocr', value.ocr), repair: this.choice('repair', value.repair) };
    })();
  }
  async selection(purpose: 'ocr' | 'repair') { await this.load(); return structuredClone(this.choices[purpose]); }
  async save(purpose: unknown, choice: unknown, revision: unknown) {
    await this.load();
    if (this.stopped) throw Error('本地模型服务已关闭');
    if (revision !== this.revision) throw Error('模型设置已更新，请刷新后重试');
    if (this.saving) throw Error('正在保存模型设置');
    const validated = this.choice(purpose, choice), next = { ...this.choices, [purpose as string]: validated };
    this.saving = true;
    const temporary = join(this.dataDirectory, '.local-models-' + randomUUID() + '.tmp');
    try {
      await mkdir(this.dataDirectory, { recursive: true });
      const file = await open(temporary, 'wx');
      try { await file.writeFile(JSON.stringify(next)); await file.sync(); } finally { await file.close(); }
      await rename(temporary, join(this.dataDirectory, 'local-models.json'));
      this.choices = next; this.revision = randomUUID();
      return this.revision;
    } finally { this.saving = false; await unlink(temporary).catch(() => {}); }
  }
  async refreshDevices() {
    if (this.stopped) throw Error('本地模型服务已关闭');
    if (!this.deviceTask) {
      const abort = this.devicesAbort = new AbortController();
      const task = this.deviceReader(abort.signal).then(value => { this.devices = value; }).finally(() => { if (this.deviceTask === task) { this.deviceTask = undefined; this.devicesAbort = undefined; } });
      this.deviceTask = task;
    }
    await this.deviceTask;
    return structuredClone(this.devices);
  }
  private async modelState(id: string, refresh = false) {
    const model = this.preset(id);
    // UI reads installed-file metadata only. Download publication and acquire()
    // verify SHA-256; opening/polling a dialog must never stream model weights.
    if (model.purpose === 'ocr') return this.store.state(model, undefined, false);
    if (!this.states.has(id) || refresh) {
      this.states.set(id, await this.store.state(model));
      if (model.purpose === 'repair') this.legacyRepairReady = await validAiModel(this.dataDirectory, repairModel);
    }
    const current = await this.store.state(model, undefined, false), verified = this.states.get(id)!;
    if (model.purpose === 'repair') {
      const legacy = await lstat(aiModelPath(this.dataDirectory, repairModel)).catch(() => undefined);
      if (!legacy?.isFile() || legacy.isSymbolicLink()) this.legacyRepairReady = false;
      return { ...current, ready: current.ready && verified.ready || this.legacyRepairReady,
        diskBytes: current.diskBytes + (legacy?.isFile() && !legacy.isSymbolicLink() ? legacy.size : 0) };
    }
    return { ...current, ready: current.ready && verified.ready };
  }
  async state(refresh = false, purpose?: LocalModelPurpose): Promise<LocalModelManagerState> {
    await this.load();
    const legacy = await this.tesseract.state(), legacyBytes = ocrPacks.reduce((sum, file) => sum + file.bytes, 0);
    const entries: LocalModelEntry[] = [{ id: 'tesseract', title: 'Tesseract', size: 'fast', purpose: 'ocr', revision: 'tessdata_fast@8741641',
      languages: ['中文', 'English'], backends: ['cpu'], weightLicense: 'Apache-2.0', runtime: 'tesseract.js', precision: 'traineddata',
      ready: legacy.ready, downloading: legacy.downloading, inUse: !!this.usage.get('tesseract'), totalBytes: legacyBytes,
      diskBytes: legacy.diskBytes, downloadedBytes: legacy.ready ? legacyBytes : 0,
      progress: legacy.progress, error: legacy.error, note: '兼容引擎；支持真实字符框选择' }];
    for (const model of localModelCatalog) {
      if(purpose&&model.purpose!==purpose)continue;
      const cached = await this.modelState(model.id, refresh), progress = this.progress.get(model.id), downloading = this.tasks.has(model.id);
      entries.push({ ...cached, downloading, inUse: cached.inUse || !!this.usage.get(model.id), id: model.id, title: model.title, size: model.size,
        purpose: model.purpose, revision: model.revision, languages: [...model.languages], backends: [...model.backends], weightLicense: model.weightLicense.name,
        runtime: model.runtime, precision: model.precision, measuredMemoryMiB: model.measuredMemoryMiB, measuredVRAMMiB: model.measuredVRAMMiB,
        progress: progress ? progress.received / progress.total : 0, downloadedBytes: downloading && progress ? progress.received : cached.downloadedBytes,
        error: this.errors.get(model.id) || '', note: model.purpose === 'ocr' ? '实验阶段；已验证 CPU/DirectML；当前选择粒度为真实整行框' : '已验证 CPU；保留旧缓存供旧版使用' });
    }
    return { revision: this.revision, choices: structuredClone(this.choices), entries, devices: structuredClone(this.devices) };
  }
  async selectedState() {
    const selected = await this.selection('ocr');
    if (selected.modelId === 'tesseract') return { ...await this.tesseract.state(), title: 'Tesseract fast' };
    const model = this.preset(selected.modelId), state = await this.modelState(model.id), progress = this.progress.get(model.id);
    return { ready: state.ready, downloading: this.tasks.has(model.id), progress: progress ? progress.received / progress.total : 0,
      error: this.errors.get(model.id) || '', title: model.title + ' ' + model.size };
  }
  install(id: unknown) {
    if (this.stopped) return Promise.reject(Error('本地模型服务已关闭'));
    if (id === 'tesseract') return this.tesseract.install();
    const model = this.preset(id);
    if (this.tasks.has(model.id)) return Promise.reject(Error('正在下载此模型'));
    const abort = new AbortController(); this.errors.delete(model.id);
    // The legacy MI-GAN file can migrate without another download.
    const sources: Record<string, string> = model.purpose === 'repair' ? { repair: aiModelPath(this.dataDirectory, repairModel) } : {};
    const task = this.store.install(model, abort.signal, value => this.progress.set(model.id, value), sources).catch(error => {
      if (!abort.signal.aborted) this.errors.set(model.id, error instanceof Error ? error.message : '模型下载失败'); throw error;
    }).finally(async () => { this.tasks.delete(model.id); this.states.delete(model.id); await this.modelState(model.id).catch(() => {}); });
    this.tasks.set(model.id, { abort, promise: task });
    return task;
  }
  cancel(id: unknown) { if (id === 'tesseract') this.tesseract.cancel(); else this.tasks.get(this.preset(id).id)?.abort.abort(); }
  async remove(id: unknown) {
    if (this.stopped) throw Error('本地模型服务已关闭');
    if (typeof id !== 'string' || this.usage.get(id)) throw Error('模型正在使用，请结束当前任务后删除');
    if (id === 'tesseract') await this.tesseract.remove();
    else {
      const preset = this.preset(id); await this.store.remove(preset);
      if (preset.purpose === 'repair') {
        const root = await lstat(join(this.dataDirectory, 'models')).catch(error => { if (error.code !== 'ENOENT') throw error; });
        if (root && (!root.isDirectory() || root.isSymbolicLink())) throw Error('旧模型缓存目录无效');
        await unlink(aiModelPath(this.dataDirectory, repairModel)).catch(error => { if (error.code !== 'ENOENT') throw error; });
        this.legacyRepairReady = false;
      }
      this.states.delete(id); this.errors.delete(id); this.progress.delete(id);
    }
  }
  use(id: string) {
    this.usage.set(id, (this.usage.get(id) || 0) + 1); let released = false;
    return () => { if (released) return; released = true; const count = (this.usage.get(id) || 1) - 1; if (count) this.usage.set(id, count); else this.usage.delete(id); };
  }
  async settle() { this.devicesAbort?.abort(); this.tesseract.cancel(); for (const task of this.tasks.values()) task.abort.abort(); await Promise.allSettled([this.deviceTask, this.tesseract.settle(), ...[...this.tasks.values()].map(task => task.promise)]); }
  async stop() { this.stopped = true; await this.settle(); await this.deviceTask; }
}
