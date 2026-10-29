export const SUPPORTED_LANGS = ['ru', 'en', 'kk', 'tr', 'zh', 'de', 'es', 'hi', 'ar'];
export const DEFAULT_LANG = 'ru';

export function pickLang(value) {
  return SUPPORTED_LANGS.includes(value) ? value : DEFAULT_LANG;
}
