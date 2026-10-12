import { english } from './locales/en';
import { type InterfaceLanguage } from './language';
let language: InterfaceLanguage =
  typeof process !== 'undefined' && process.env?.ONE_CAPTURE_LANGUAGE === 'en' ? 'en' : 'zh-CN';
export function setInterfaceLanguage(value: InterfaceLanguage) {
  if (value !== 'zh-CN' && value !== 'en') throw new Error('Invalid interface language');
  language = value;
}
export const interfaceLanguage = () => language;
export const interfaceLanguageArguments = () => ['--one-capture-language=' + language];
export const formatLocale = () => (language === 'zh-CN' ? 'zh-CN' : 'en-US');
const slots = (value: string) =>
  Array.from(value.matchAll(/⟦(\d+)⟧/g), (match) => Number(match[1])).sort((a, b) => a - b);
export function validateMessage(source: string, translation: string) {
  if (!translation.trim() || JSON.stringify(slots(source)) !== JSON.stringify(slots(translation)))
    throw new Error('Invalid translation placeholders');
}
export function renderMessage(
  source: string,
  translation: string,
  values: readonly unknown[] = [],
) {
  validateMessage(source, translation);
  const indices = slots(source);
  if (indices.some((i) => i >= values.length) || values.some((_value, i) => !indices.includes(i)))
    throw new Error('Message argument mismatch');
  return translation.replace(/⟦(\d+)⟧/g, (_match, index) => String(values[Number(index)]));
}
export function templateMessage(parts: readonly string[]) {
  if (parts.some((part) => /[⟦⟧]/.test(part))) throw new Error('Reserved message delimiter');
  return parts.map((part, index) => (index ? '⟦' + (index - 1) + '⟧' : '') + part).join('');
}
export function t(source: string): string;
export function t(parts: TemplateStringsArray, ...values: unknown[]): string;
export function t(source: string | TemplateStringsArray, ...values: unknown[]): string {
  const key = typeof source === 'string' ? source : templateMessage(source);
  const translated = language === 'en' && Object.hasOwn(english, key) ? english[key] : key;
  return typeof source === 'string' ? translated : renderMessage(key, translated, values);
}
export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}) {
  return new Intl.NumberFormat(formatLocale(), options).format(value);
}
export function formatDate(
  value: number | Date,
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  },
) {
  return new Intl.DateTimeFormat(formatLocale(), options).format(value);
}
export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value < 0) throw new Error('Invalid byte count');
  return value < 1024
    ? `${formatNumber(value)} B`
    : value < 1048576
      ? `${formatNumber(Math.round(value / 1024))} KB`
      : `${formatNumber(value / 1048576, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}
