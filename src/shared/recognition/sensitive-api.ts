import { ocrDimensions, type OCRResult, type OCRWord } from './ocr';
import type { Rectangle } from '../capture/region';

export const SENSITIVE_LIMIT = 100;
export type SensitiveKind =
  | 'email'
  | 'phone'
  | 'identifier'
  | 'card'
  | 'name'
  | 'address'
  | 'secret';
export const sensitiveNames: Record<SensitiveKind, string> = {
  email: '邮箱',
  phone: '电话',
  identifier: '证件/账号',
  card: '银行卡',
  name: '姓名',
  address: '地址',
  secret: '密码/密钥',
};
export interface SensitiveRegion extends Rectangle {
  kind: SensitiveKind;
}
export interface SensitiveResult {
  width: number;
  height: number;
  regions: SensitiveRegion[];
}
export interface SensitiveAPI {
  scanSensitive(token: string, png: string): Promise<SensitiveResult>;
  cancelSensitive(token: string): Promise<void>;
}
export function sensitiveResult(value: unknown): SensitiveResult {
  const v = value as SensitiveResult;
  if (!v) throw Error('敏感文字识别结果无效');
  ocrDimensions(v.width, v.height);
  if (!Array.isArray(v.regions) || v.regions.length > SENSITIVE_LIMIT)
    throw Error('敏感文字过多，请缩小选区');
  const regions = v.regions.map((r) => {
    if (
      !r ||
      !Object.hasOwn(sensitiveNames, r.kind) ||
      ![r.x, r.y, r.width, r.height].every(Number.isFinite) ||
      r.x < 0 ||
      r.y < 0 ||
      r.width <= 0 ||
      r.height <= 0 ||
      r.x + r.width > v.width ||
      r.y + r.height > v.height
    )
      throw Error('敏感文字识别区域无效');
    return { kind: r.kind, x: r.x, y: r.y, width: r.width, height: r.height };
  });
  return { width: v.width, height: v.height, regions };
}
const labels =
  /(?<![a-z0-9_])(?:电子邮箱|邮箱|e-?mail|联系电话|手机号码|手机号|手机|电话|telephone|phone|身份证号?码?|证件号?码?|护照号?码?|passport|银行卡号?|卡号|bankcard|收件人|联系人|姓名|full\s*name|name|详细地址|收货地址|联系地址|住址|地址|address|密码|口令|密钥|令牌|password|passwd|api[ _-]?key|secret|token|用户名|账号|帐号|username|account)\s*[:：=]/gi;
function labelKind(text: string): SensitiveKind {
  if (/用户|username|account/i.test(text)) return 'identifier';
  if (/邮箱|mail/i.test(text)) return 'email';
  if (/手机|电话|phone/i.test(text)) return 'phone';
  if (/卡|card/i.test(text)) return 'card';
  if (/姓名|联系人|收件人|name/i.test(text)) return 'name';
  if (/地址|住址|address/i.test(text)) return 'address';
  if (/密码|口令|密钥|令牌|password|passwd|key|secret|token/i.test(text)) return 'secret';
  return 'identifier';
}
function luhn(text: string) {
  let sum = 0;
  for (let i = text.length - 1, double = false; i >= 0; i--, double = !double) {
    let n = Number(text[i]);
    if (double) n *= 2;
    sum += n > 9 ? n - 9 : n;
  }
  return sum % 10 === 0 && !/^(\d)\1+$/.test(text);
}
/** Local OCR and explicit field context; candidates require user review. No extracted text is returned. */
export function detectSensitive(result: OCRResult): SensitiveResult {
  const lines = new Map<number, OCRWord[]>(),
    regions: SensitiveRegion[] = [];
  let characters = 0;
  for (const word of result.words) {
    characters += word.text.length;
    if (characters > 1024 * 1024) throw Error('识别文字过多，请缩小选区');
    if (!word.text.trim() || !word.width || !word.height) continue;
    const group = lines.get(word.line) || [];
    group.push(word);
    lines.set(word.line, group);
  }
  const ordered = [...lines.values()]
    .map((words) => words.sort((a, b) => a.x - b.x))
    .sort((a, b) => a[0].y - b[0].y || a[0].x - b[0].x);
  let continuation: { kind: SensitiveKind; bottom: number; height: number } | undefined;
  for (const words of ordered) {
    let text = '';
    const owners: OCRWord[] = [];
    for (const word of words) {
      // Keep an owner for every normalized UTF-16 code unit, including split OCR numbers.
      const normalized = word.text.normalize('NFKC').replace(/\s+/g, ' ').trim();
      if (text) {
        text += ' ';
        owners.push(word);
      }
      text += normalized;
      for (let i = 0; i < normalized.length; i++) owners.push(word);
      if (text.length > 16384) throw Error('单行识别文字过多，请缩小选区');
    }
    const spans: { start: number; end: number; kind: SensitiveKind }[] = [];
    const fields = [...text.matchAll(labels)];
    if (
      continuation &&
      !fields.length &&
      text &&
      words[0].y <= continuation.bottom + continuation.height * 2
    )
      spans.push({ start: 0, end: text.length, kind: continuation.kind });
    continuation = undefined;
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i],
        start = field.index! + field[0].length;
      let end = fields[i + 1]?.index ?? text.length;
      const stop = text.slice(start, end).search(/[;；|]/);
      if (stop >= 0) end = start + stop;
      const kind = labelKind(field[0]);
      if (end > start) spans.push({ start, end, kind });
      else if (i === fields.length - 1)
        continuation = { kind, bottom: words[0].y + words[0].height, height: words[0].height };
    }
    for (const match of text.matchAll(
      /[a-z0-9.!#$%&'*+\/=?^_`{|}~-]{1,64}\s*@\s*[a-z0-9](?:[a-z0-9.-]{0,253}[a-z0-9])?\.[a-z]{2,63}/gi,
    ))
      spans.push({ start: match.index!, end: match.index! + match[0].length, kind: 'email' });
    for (const match of text.matchAll(/(?<![\da-z])\+?\d(?:[\d -]*\d)?[Xx]?(?![\da-z])/g)) {
      const value = match[0].replace(/[ -]/g, ''),
        digits = value.replace(/\D/g, '');
      const kind = /^(?:\+?86)?1\d{10}$/.test(value)
        ? 'phone'
        : /^\d{17}[\dXx]$/.test(value)
          ? 'identifier'
          : /^\d{13,19}$/.test(value) && luhn(digits)
            ? 'card'
            : undefined;
      if (kind) spans.push({ start: match.index!, end: match.index! + match[0].length, kind });
    }
    for (const span of spans) {
      while (span.start < span.end && /\s/.test(text[span.start])) span.start++;
      while (span.end > span.start && /\s/.test(text[span.end - 1])) span.end--;
      const hits = owners.slice(span.start, span.end);
      if (!hits.length) continue;
      let left = result.width,
        top = result.height,
        right = 0,
        bottom = 0;
      for (const word of hits) {
        left = Math.min(left, word.x);
        top = Math.min(top, word.y);
        right = Math.max(right, word.x + word.width);
        bottom = Math.max(bottom, word.y + word.height);
      }
      const pad = 2,
        x = Math.max(0, Math.floor(left - pad)),
        y = Math.max(0, Math.floor(top - pad));
      right = Math.min(result.width, Math.ceil(right + pad));
      bottom = Math.min(result.height, Math.ceil(bottom + pad));
      // A word may include a label and its value: covering the whole word avoids partial disclosure.
      if (
        regions.some(
          (r) => x >= r.x && y >= r.y && right <= r.x + r.width && bottom <= r.y + r.height,
        )
      )
        continue;
      for (let i = regions.length - 1; i >= 0; i--)
        if (
          regions[i].x >= x &&
          regions[i].y >= y &&
          regions[i].x + regions[i].width <= right &&
          regions[i].y + regions[i].height <= bottom
        )
          regions.splice(i, 1);
      regions.push({ kind: span.kind, x, y, width: right - x, height: bottom - y });
      if (regions.length > SENSITIVE_LIMIT) throw Error('敏感文字超过 100 处，请缩小选区');
    }
  }
  return sensitiveResult({ width: result.width, height: result.height, regions });
}
