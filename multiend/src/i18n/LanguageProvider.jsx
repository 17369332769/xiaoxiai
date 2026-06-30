import * as React from 'react';
import { LanguageContext, getStoredLang, makeT, setStoredLang } from './index.js';

const { useState, useCallback, useMemo } = React;

// Provides the active language + a t() translator to the tree, persisting changes
// to localStorage. Kept in its own file (only a component export) so the
// react-refresh lint rule stays happy.
export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => getStoredLang());

  const setLang = useCallback((next) => {
    setLangState(setStoredLang(next));
  }, []);

  const t = useMemo(() => makeT(lang), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
