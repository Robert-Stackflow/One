import {ocrDimensions} from './ocr-limits';
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
}export function sensitiveResult(value: unknown): SensitiveResult {
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
