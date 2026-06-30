import { createContext, useContext } from 'react';
import { translations } from './translations.js';

const STORAGE_KEY = 'xxa_lang';
export const DEFAULT_LANG = 'zh';
export const SUPPORTED_LANGS = ['zh', 'en'];

// Read the persisted language (used by the provider's initial state and by
// non-React callers like the chat request, which tags the AI reply language).
export function getStoredLang() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return SUPPORTED_LANGS.includes(value) ? value : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

// Persist + normalize a language choice; returns the value actually stored.
export function setStoredLang(value) {
  const normalized = SUPPORTED_LANGS.includes(value) ? value : DEFAULT_LANG;
  try { localStorage.setItem(STORAGE_KEY, normalized); } catch { /* ignore */ }
  return normalized;
}

function lookup(dict, key) {
  return key.split('.').reduce((node, part) => (node && node[part] != null ? node[part] : undefined), dict);
}

// Resolve a dotted key against a locale, falling back to zh, then to the key
// itself. Interpolates {name} placeholders for string values; non-strings (e.g.
// arrays of quick prompts) are returned untouched.
function translate(lang, key, vars) {
  const fromLang = lookup(translations[lang], key);
  const value = fromLang != null ? fromLang : (lookup(translations.zh, key) ?? key);
  if (vars && typeof value === 'string') {
    return value.replace(/\{(\w+)\}/g, (_match, name) => (vars[name] != null ? String(vars[name]) : `{${name}}`));
  }
  return value;
}

export function makeT(lang) {
  return (key, vars) => translate(lang, key, vars);
}

// Default context value is a fully working zh translator, so components render
// correctly even without a provider (e.g. unit tests that mount them bare).
export const LanguageContext = createContext({ lang: DEFAULT_LANG, setLang: () => {}, t: makeT(DEFAULT_LANG) });

export function useLanguage() {
  return useContext(LanguageContext);
}

export function useT() {
  return useContext(LanguageContext).t;
}
