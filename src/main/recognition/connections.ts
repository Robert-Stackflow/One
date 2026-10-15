import type {ServiceConnectionStorage,ServiceCredentialCrypto} from '../service-connections';
import { randomUUID,createHash } from 'node:crypto';
import type {OneAIService} from '../ai-service';
import type {AITaskReference} from '../../shared/ai-task';
import type {TranslationServiceReference} from '../../shared/recognition/translation-services';
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
  private binding?:{revision:string;reference:AITaskReference;legacy?:Stored};
  private serviceBinding?:{revision:string;serviceReference:TranslationServiceReference;legacy?:Stored};
  private stored?: Stored;
  private loading?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private revision: string = randomUUID();
  private error = '';
  constructor(
    private storage:ServiceConnectionStorage,
    private crypto:ServiceCredentialCrypto,
    private purpose: 'translation' | 'formula' = 'translation',
    private ai?:OneAIService,
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
          if(v.format==='one-recognition-service-binding'&&v.version===3&&v.purpose===this.purpose){
            const cfg=this.checked({...v,provider:'service'});
            if(v.legacy){const legacy=this.checked({...v.legacy,key:undefined});if(['ai','service'].includes(legacy.provider)||typeof v.legacy.encrypted!=='string'||!v.legacy.encrypted||v.legacy.encrypted.length>24000||!/^[\da-z+/]+=*$/i.test(v.legacy.encrypted))throw Error();}
            this.serviceBinding={revision:cfg.revision,serviceReference:cfg.serviceReference!,legacy:v.legacy};this.revision=cfg.revision;return;
          }
          if(v.format==='one-recognition-task-binding'&&v.version===2&&v.purpose===this.purpose){
            const cfg=this.checked({...v,provider:'ai'});
            if(v.legacy){const legacy=this.checked({...v.legacy,key:undefined});if(['ai','service'].includes(legacy.provider)||typeof v.legacy.encrypted!=='string'||!v.legacy.encrypted||v.legacy.encrypted.length>24000||!/^[\da-z+/]+=*$/i.test(v.legacy.encrypted))throw Error();}
            this.binding={revision:cfg.revision,reference:cfg.reference!,legacy:v.legacy};this.revision=cfg.revision;return;
          }
          if (
            v.format !== 'one-recognition-connection' || v.purpose !== this.purpose || v.version !== 1 ||
            typeof v.encrypted !== 'string' ||
            v.encrypted.length > 24000 ||
            !v.encrypted ||
            !/^[\da-z+/]+=*$/i.test(v.encrypted)
          )
            throw Error();
          const cfg = this.checked({ ...v, key: undefined });
          if(cfg.provider==='ai'||cfg.provider==='service')throw Error();
          this.stored = { ...cfg, provider:cfg.provider, encrypted: v.encrypted };
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
    if(this.serviceBinding){
      const binding=this.serviceBinding;let profile:{id:string;revision:string;name:string;hasKey:boolean}|undefined,error='';
      try{profile=(this.purpose==='formula'?this.ai?.formulators.list():this.ai?.translators.list())?.find(profile=>profile.id===binding.serviceReference.serviceId);}catch{error=this.label+'服务配置无法读取，请打开服务管理';}
      const serviceReference={...binding.serviceReference,revision:profile?.revision||binding.serviceReference.revision};
      const hash=createHash('sha256').update(binding.revision+':'+(profile?.revision||'missing')+':'+!!profile?.hasKey).digest('hex').slice(0,32),revision=`${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20)}`;
      error=error||(!profile?this.label+'服务已删除，请重新选择':!profile.hasKey?'系统加密不可用，无法读取服务密钥':'');return {revision,provider:'service',endpoint:'',model:'',region:'',serviceReference,serviceName:profile?.name||'',keySaved:false,ready:!error,error,canRestoreLegacy:!!binding.legacy};
    }
    if(this.binding){
      const binding=this.binding,profile=this.ai?.taskProfiles().find(profile=>profile.id===binding.reference.profileId),model=profile?.models.find(model=>model.id===binding.reference.model);
      const reference={...binding.reference,revision:profile?.revision||binding.reference.revision};
      const supported=this.purpose!=='formula'||!!profile?.imageModels.includes(reference.model);
      const hash=createHash('sha256').update(binding.revision+':'+(profile?.revision||'missing')+':'+supported).digest('hex').slice(0,32),revision=`${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20)}`;
      const error=!this.ai?'AI 服务不可用':!profile?'所选 AI 服务已删除，请重新选择':!model?'所选模型已移除，请重新选择':!supported?'请验证该模型的图片输入能力':'';
      return {revision,provider:'ai',endpoint:'',model:reference.model,region:'',reference,serviceName:profile?.name||'',keySaved:false,ready:!error,error,canRestoreLegacy:!!binding.legacy};
    }
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
    if (cfg.revision !== (await this.state()).revision) throw Error(`${this.label}配置已改变，请重新打开配置`);
    if(cfg.provider==='service'){
      if(!this.ai)throw Error('专用服务不可用');(this.purpose==='formula'?this.ai.formulators:this.ai.translators).assertReference(cfg.serviceReference);
      const binding={revision:randomUUID(),serviceReference:cfg.serviceReference!,legacy:this.stored||this.binding?.legacy||this.serviceBinding?.legacy};
      await this.storage.write(this.purpose,{format:'one-recognition-service-binding',purpose:this.purpose,version:3,...binding});this.serviceBinding=binding;this.binding=undefined;this.stored=undefined;this.revision=binding.revision;this.error='';return this.state();
    }
    if(cfg.provider==='ai'){
      const profile=this.ai?.taskProfiles().find(profile=>profile.id===cfg.reference!.profileId);
      if(!profile||profile.revision!==cfg.reference!.revision||!profile.models.some(model=>model.id===cfg.reference!.model))throw Error('AI 服务或模型已改变，请重新选择');
      if(this.purpose==='formula'&&!profile.imageModels.includes(cfg.reference!.model))throw Error('请先验证该模型的图片输入能力');
      const binding={revision:randomUUID(),reference:cfg.reference!,legacy:this.stored||this.binding?.legacy||this.serviceBinding?.legacy};
      await this.storage.write(this.purpose,{format:'one-recognition-task-binding',purpose:this.purpose,version:2,...binding});
      this.binding=binding;this.serviceBinding=undefined;this.stored=undefined;this.revision=binding.revision;this.error='';return this.state();
    }
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
      this.binding=undefined;
      this.serviceBinding=undefined;
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
      if (revision !== (await this.state()).revision) throw Error(`${this.label}配置已改变，请重新打开配置`);
      await this.storage.clear(this.purpose);
      this.stored = undefined;
      this.binding=undefined;
      this.serviceBinding=undefined;
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
    if(this.serviceBinding){if(!state.ready)throw Error(state.error);return {provider:'service',serviceReference:state.serviceReference!,model:'',endpoint:'',region:'',key:'',revision:state.revision};}
    if(this.binding){if(!state.ready)throw Error(state.error);return {provider:'ai',reference:state.reference!,model:state.model,endpoint:'',region:'',key:'',revision:state.revision};}
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
  async migrateLegacy(revision:unknown){
    const state=await this.state();if(revision!==state.revision)throw Error(`${this.label}配置已改变，请重新打开配置`);
    if(!this.ai||!['chat','azure'].includes(state.provider))throw Error('当前服务不能自动迁入 AI 服务，原配置已保留');
    const connection=await this.connection(revision);
    if(connection.provider==='azure')return this.ai.translators.importAzure(connection.region,connection.key,'Azure 翻译（迁入）');
    return this.ai.importRecognitionConnection(connection.endpoint,connection.model,connection.key,this.label+'服务（迁入）');
  }
  restoreLegacy(revision:unknown){
    const task=this.queue.then(async()=>{const state=await this.state(),legacy=this.binding?.legacy||this.serviceBinding?.legacy;if(revision!==state.revision||!legacy)throw Error('旧配置不可恢复或已改变');
      const record={...legacy,revision:randomUUID()};await this.storage.write(this.purpose,{format:'one-recognition-connection',purpose:this.purpose,version:1,...record});
      this.stored=record;this.binding=undefined;this.serviceBinding=undefined;this.revision=record.revision;this.error='';return this.state();});
    this.queue=task.catch(()=>{});return task;
  }
}
