import { translationSettings, type TranslationSettings } from './translation';
export const FORMULA_IMAGE = 8 * 1024 * 1024,
  FORMULA_TEXT = 16000,
  FORMULA_PREVIEW = 512 * 1024;
export interface FormulaResult {
  model?:string;
  text: string;
  endpoint: string;
  revision: string;
}
export function formulaSettings(value: unknown): TranslationSettings {
  try {
    const checked = translationSettings(value);
    if (checked.provider !== 'chat'&&checked.provider!=='ai')
      throw Error('公式识别需要支持图片的 Chat Completions 兼容服务');
    return checked;
  } catch (error) {
    throw Error(
      error instanceof Error ? error.message.replace(/翻译/g, '公式识别') : '公式识别配置无效',
    );
  }
}
export function formulaText(value: unknown) {
  if (typeof value !== 'string' || value.length > FORMULA_TEXT)
    throw Error('公式最多 16,000 个字符');
  if (
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      value,
    )
  )
    throw Error('公式包含无效字符');
  return value;
}
export function formulaOutput(value: unknown) {
  let text = formulaText(value).trim();
  if (/^```/.test(text)) {
    const match = /^```(?:latex|tex)?\s*\n([\s\S]*?)\n```$/i.exec(text);
    if (!match || match[1].includes('```')) throw Error('公式服务返回格式无效，请检查服务与模型');
    text = match[1].trim();
  }
  let dollars = 0;
  for (let i = 0; i < text.length; i++)
    if (text[i] === '$') {
      let slashes = 0;
      for (let at = i - 1; at >= 0 && text[at] === '\\'; at--) slashes++;
      if (slashes % 2 === 0) dollars++;
    }
  if (
    (text.startsWith('\\[') &&
      text.endsWith('\\]') &&
      (text.match(/\\\[|\\\]/g) || []).length === 2) ||
    (text.startsWith('\\(') &&
      text.endsWith('\\)') &&
      (text.match(/\\\(|\\\)/g) || []).length === 2)
  )
    text = text.slice(2, -2).trim();
  else if (text.startsWith('$$') && text.endsWith('$$') && text.length > 4 && dollars === 4)
    text = text.slice(2, -2).trim();
  else if (text.startsWith('$') && text.endsWith('$') && text.length > 2 && dollars === 2)
    text = text.slice(1, -1).trim();
  if (!text) throw Error('公式服务未返回可用 LaTeX');
  return text;
}
