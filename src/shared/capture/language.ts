export const interfaceLanguages = ['zh-CN', 'en'] as const;
export type InterfaceLanguage = (typeof interfaceLanguages)[number];
export type LanguageChoice = InterfaceLanguage | 'system';
export interface LanguageState {
  choice: LanguageChoice;
  current: InterfaceLanguage;
  next: InterfaceLanguage;
  restartRequired: boolean;
  warning: boolean;
}
export interface LanguageAPI {
  readonly current: InterfaceLanguage;
  state(): Promise<LanguageState>;
}
export function validateLanguageChoice(value: unknown): LanguageChoice {
  if (value !== 'system' && value !== 'zh-CN' && value !== 'en')
    throw new Error('Invalid interface language');
  return value;
}
export function resolveLanguage(choice: LanguageChoice, systemLanguage: string): InterfaceLanguage {
  validateLanguageChoice(choice);
  return choice === 'system' ? (/^zh(?:[-_]|$)/i.test(systemLanguage) ? 'zh-CN' : 'en') : choice;
}
export function languageFromArguments(args: readonly string[]): InterfaceLanguage {
  const values = args.filter((v) => v.startsWith('--one-capture-language='));
  if (values.length !== 1) return 'zh-CN';
  return values[0] === '--one-capture-language=en' ? 'en' : 'zh-CN';
}
