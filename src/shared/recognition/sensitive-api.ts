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