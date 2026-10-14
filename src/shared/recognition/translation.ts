export const translationLanguages = {
  'zh-Hans': '简体中文',
  'zh-Hant': '繁体中文',
  en: '英文',
  ja: '日文',
  ko: '韩文',
  fr: '法文',
  de: '德文',
  es: '西班牙文',
  ru: '俄文',
  pt: '葡萄牙文',
  it: '意大利文',
  ar: '阿拉伯文',
} as const;
export type TranslationLanguage = keyof typeof translationLanguages;
export type TranslationProvider = 'chat' | 'azure' | 'ai';
export const TRANSLATION_INPUT = 20000,
  TRANSLATION_OUTPUT = 60000;
export const TRANSLATION_DOCUMENT_INPUT=200000,TRANSLATION_DOCUMENT_OUTPUT=600000,TRANSLATION_DOCUMENT_PARTS=2048;
export interface TranslationPart {id:string;start:number;end:number;paragraph:number;chunk:number;status:'waiting'|'translated'|'failed'|'cancelled';text?:string;error?:string;model?:string}
export interface TranslationConfig {
  canRestoreLegacy?:boolean;
  reference?:import('../ai-task').AITaskReference;
  serviceName?:string;
  revision: string;
  provider: TranslationProvider;
  endpoint: string;
  model: string;
  region: string;
  keySaved: boolean;
  ready: boolean;
  error: string;
}
export interface TranslationSettings {
  reference?:import('../ai-task').AITaskReference;
  revision: string;
  provider: TranslationProvider;
  endpoint: string;
  model: string;
  region: string;
  key?: string;
}
export interface TranslationConnection {
  reference?:import('../ai-task').AITaskReference;
  provider: TranslationProvider;
  endpoint: string;
  model: string;
  region: string;
  key: string;
  revision: string;
}
export interface TranslationResult {
  id?:string;
  parts?:TranslationPart[];
  model?:string;
  source: string;
  text: string;
  target: TranslationLanguage;
  revision: string;
  endpoint: string;
}
export function translationLanguage(value: unknown): TranslationLanguage {
  if (typeof value !== 'string' || !Object.hasOwn(translationLanguages, value))
    throw Error('翻译目标语言无效');
  return value as TranslationLanguage;
}
export function translationText(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) throw Error('请先识别或输入需要翻译的文字');
  if (value.length > TRANSLATION_INPUT) throw Error('每次最多翻译 20,000 个字符，请分段处理');
  return value;
}
export function translationDocumentText(value:unknown){
  if(typeof value!=='string'||!value.trim())throw Error('请先识别或输入需要翻译的文字');
  if(value.includes('\0')||value.length>TRANSLATION_DOCUMENT_INPUT)throw Error('翻译原文支持最多 200,000 个字符');
  return value;
}
export const azureEndpoint = 'https://api.cognitive.microsofttranslator.com/translate';
export function translationEndpoint(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048) throw Error('翻译服务地址无效');
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw Error('请填写完整的翻译服务地址');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (
    (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !u.hostname
  )
    throw Error('服务地址须为 HTTPS，或本机 HTTP 地址，且不含账号、参数或片段');
  return u.href;
}
export function translationSettings(value: unknown): TranslationSettings {
  const v = value as TranslationSettings;
  if (
    !v ||
    typeof v.revision !== 'string' ||
    !/^[\da-f-]{36}$/i.test(v.revision) ||
    !['chat', 'azure','ai'].includes(v.provider)
  )
    throw Error('翻译配置无效');
  if(v.provider==='ai'){
    const ref=v.reference;
    if(!ref||typeof ref.profileId!=='string'||!ref.profileId.trim()||ref.profileId.length>200||typeof ref.model!=='string'||ref.model.length>200||/[\r\n\0]/.test(ref.profileId+ref.model)||typeof ref.revision!=='string'||!/^[a-f0-9]{64}$/.test(ref.revision)||Object.keys(ref).some(key=>!['profileId','model','revision'].includes(key))||(v.key!==undefined&&v.key!==''))throw Error('AI 服务引用无效');
    return {revision:v.revision,provider:'ai',endpoint:'',model:ref.model,region:'',reference:{...ref}};
  }
  const endpoint = v.provider === 'azure' ? azureEndpoint : translationEndpoint(v.endpoint);
  if (
    typeof v.model !== 'string' ||
    v.model.length > 128 ||
    /[\x00-\x1f\x7f]/.test(v.model) ||
    typeof v.region !== 'string' ||
    v.region.length > 64 ||
    !/^[a-z\d-]*$/i.test(v.region)
  )
    throw Error('翻译模型或区域无效');
  if (v.provider === 'chat' && !v.model.trim()) throw Error('请填写服务提供的模型名称');
  if (
    v.key !== undefined &&
    (typeof v.key !== 'string' || !v.key || v.key.length > 4096 || !/^[\x21-\x7e]+$/.test(v.key))
  )
    throw Error('翻译密钥无效');
  return {
    revision: v.revision,
    provider: v.provider,
    endpoint,
    model: v.provider === 'chat' ? v.model.trim() : '',
    region: v.provider === 'azure' ? v.region.trim() : '',
    ...(v.key !== undefined ? { key: v.key } : {}),
  };
}
