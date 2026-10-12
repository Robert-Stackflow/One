import type {ServiceConnectionStorage,ServiceCredentialCrypto} from '../service-connections';
import { randomUUID } from 'node:crypto';
import { formulaSettings } from '../../shared/recognition/formula';
import {
  translationSettings,
  type TranslationConfig,
  type TranslationConnection,
  type TranslationSettings,
} from '../../shared/recognition/translation';
interface Stored {
  revision: string;
  provider: 'chat' | 'azure';
  endpoint: string;
  model: string;
  region: string;
  encrypted: string;
}
export class RecognitionConnectionStore {
  private stored?: Stored;
  private loading?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private revision: string = randomUUID();
  private error = '';
  constructor(
    private storage:ServiceConnectionStorage,
    private crypto:ServiceCredentialCrypto,
    private purpose: 'translation' | 'formula' = 'translation',
  ) {}
  private get label() {
    return this.purpose === 'formula' ? '公式识别' : '翻译';
  }
  private checked(value: unknown) {
    return this.purpose === 'formula' ? formulaSettings(value) : translationSettings(value);
  }
  private async load() {
    if (!this.loading)
      this.loading = (async () => {
        try {
          const v=await this.storage.read(this.purpose) as any;
          if(v===undefined)return;
          if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error();
          if (
            v.format !== 'one-recognition-connection' || v.purpose !== this.purpose || v.version !== 1 ||
            typeof v.encrypted !== 'string' ||
            v.encrypted.length > 24000 ||
            !v.encrypted ||
            !/^[\da-z+/]+=*$/i.test(v.encrypted)
          )
            throw Error();
          const cfg = this.checked({ ...v, key: undefined });
          this.stored = { ...cfg, encrypted: v.encrypted };
          this.revision = cfg.revision;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            this.error = `${this.label}配置无法读取，请重新配置服务`;
        }
      })();
    await this.loading;
  }
  async state(): Promise<TranslationConfig> {
    await this.load();
    const s = this.stored;
    let error = this.error,
      ready = !!s;
    if (s && !this.crypto.available()) {
      ready = false;
      error = `系统加密不可用，无法读取${this.label}密钥`;
    }
    return {
      revision: this.revision,
      provider: s?.provider || 'chat',
      endpoint: s?.endpoint || '',
      model: s?.model || '',
      region: s?.region || '',
      keySaved: !!s,
      ready: ready && !error,
      error,
    };
  }
  save(value: unknown) {
    const task = this.queue.then(() => this.write(value));
    this.queue = task.catch(() => {});
    return task;
  }
  private async write(value: unknown) {
    await this.load();
    const cfg = this.checked(value);
    if (cfg.revision !== this.revision) throw Error(`${this.label}配置已改变，请重新打开配置`);
    if (!this.crypto.available()) throw Error(`系统加密不可用，无法保存${this.label}密钥`);
    const same = this.stored?.provider === cfg.provider && this.stored?.endpoint === cfg.endpoint;
    if (!cfg.key && !same) throw Error('首次配置或更换服务地址后，请重新填写密钥');
    let bytes: Buffer | undefined;
    try {
      try {
        bytes = cfg.key
          ? this.crypto.encrypt(cfg.key)
          : Buffer.from(this.stored!.encrypted, 'base64');
      } catch {
        throw Error(`${this.label}密钥无法加密`);
      }
      if (!bytes.length || bytes.length > 16000) throw Error(`${this.label}密钥无法加密`);
      const record: Stored = {
        revision: randomUUID(),
        provider: cfg.provider,
        endpoint: cfg.endpoint,
        model: cfg.model,
        region: cfg.region,
        encrypted: bytes.toString('base64'),
      };
      await this.storage.write(this.purpose,{format:'one-recognition-connection',purpose:this.purpose,version:1,...record});
      this.stored = record;
      this.revision = record.revision;
      this.error = '';
      return this.state();
    } finally {
      bytes?.fill(0);
    }
  }
  clear(revision: unknown) {
    const task = this.queue.then(async () => {
      await this.load();
      if (revision !== this.revision) throw Error(`${this.label}配置已改变，请重新打开配置`);
      await this.storage.clear(this.purpose);
      this.stored = undefined;
      this.error = '';
      this.revision = randomUUID();
      return this.state();
    });
    this.queue = task.catch(() => {});
    return task;
  }
  async connection(revision: unknown): Promise<TranslationConnection> {
    const state = await this.state();
    const stored = this.stored;
    if (revision !== state.revision) throw Error(`${this.label}服务已改变，请核对后重试`);
    if (stored && stored.revision !== state.revision)
      throw Error(`${this.label}服务已改变，请核对后重试`);
    if (!state.ready || !stored) throw Error(state.error || `请先配置${this.label}服务`);
    const bytes = Buffer.from(stored.encrypted, 'base64');
    try {
      const key = this.crypto.decrypt(bytes);
      const checked = this.checked({ ...stored, key });
      return { ...checked, key: key };
    } catch {
      throw Error(`${this.label}密钥无法读取，请重新填写`);
    } finally {
      bytes.fill(0);
    }
  }
  async settle() {
    await this.queue;
  }
}
