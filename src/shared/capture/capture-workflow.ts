import { defaultEffects, outputEffects, type OutputEffects } from './image-output';
import { translationLanguage, type TranslationLanguage } from '../recognition/translation';
export const captureActions = ['copy', 'save', 'pin', 'library', 'ocr', 'translate'] as const;
export type CaptureAction = (typeof captureActions)[number];
export const actionNames: Record<CaptureAction, string> = {
  copy: '复制',
  save: '保存',
  pin: '贴图',
  library: '存入素材',
  ocr: '识别文字',
  translate: '翻译文字（联网）',
};
export interface CaptureWorkflow {
  id: string;
  name: string;
  actions: CaptureAction[];
  effects: OutputEffects;
  translationTarget?: TranslationLanguage;
}
export function actionList(value: unknown): CaptureAction[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > captureActions.length ||
    new Set(value).size !== value.length ||
    value.some((a) => !captureActions.includes(a))
  )
    throw Error('输出动作无效');
  return [...value];
}
export const defaultWorkflows = (): CaptureWorkflow[] => [
  { id: 'copy', name: '复制图片', actions: ['copy'], effects: defaultEffects() },
  { id: 'copy-save', name: '复制并保存', actions: ['copy', 'save'], effects: defaultEffects() },
  { id: 'pin', name: '贴图', actions: ['pin'], effects: defaultEffects() },
];
export function workflowsFrom(value: unknown): CaptureWorkflow[] {
  if (!Array.isArray(value) || !value.length || value.length > 12)
    throw Error('输出流程需要 1～12 个预设');
  const ids = new Set<string>();
  return value.map((v: CaptureWorkflow) => {
    if (
      !v ||
      typeof v.id !== 'string' ||
      !/^[\w-]{1,64}$/.test(v.id) ||
      ids.has(v.id) ||
      typeof v.name !== 'string' ||
      !v.name.trim() ||
      v.name.length > 40 ||
      /[\x00-\x1f]/.test(v.name)
    )
      throw Error('输出流程格式无效');
    ids.add(v.id);
    return {
      id: v.id,
      name: v.name.trim(),
      actions: actionList(v.actions),
      effects: outputEffects(v.effects),
      ...(v.actions.includes('translate')
        ? { translationTarget: translationLanguage(v.translationTarget ?? 'zh-Hans') }
        : {}),
    };
  });
}
export interface CaptureReceipt {
  action: CaptureAction;
  status: 'completed' | 'pending' | 'canceled' | 'failed';
}
export interface CaptureResult {
  completed: boolean;
  receipts: CaptureReceipt[];
  error?: string;
}
