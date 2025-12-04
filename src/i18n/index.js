import en from './en.json';
import zh from './zh.json';

export const SUPPORTED_LANGUAGES = ['zh', 'en'];
export const DEFAULT_LANGUAGE = 'zh';

const dictionaries = {
  en,
  zh,
};

export function getMessages(locale = DEFAULT_LANGUAGE) {
  return dictionaries[locale] ?? dictionaries[DEFAULT_LANGUAGE];
}

export function t(locale, key) {
  const messages = getMessages(locale);
  return messages[key] ?? key;
}

