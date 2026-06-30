import React from 'react';
import { describe, test, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { makeT, useT } from './index.js';
import { LanguageProvider } from './LanguageProvider.jsx';

void React;

afterEach(() => {
  try { localStorage.removeItem('xxa_lang'); } catch { /* ignore */ }
});

describe('makeT', () => {
  test('translates the same key in zh and en', () => {
    expect(makeT('zh')('actions.feedShop')).toBe('喂食商店');
    expect(makeT('en')('actions.feedShop')).toBe('Feed Shop');
  });

  test('interpolates {var} placeholders', () => {
    expect(makeT('en')('header.online', { count: 5 })).toBe('Online: 5');
    expect(makeT('zh')('tasks.reward', { reward: 30 })).toBe('+30 爱心币');
  });

  test('falls back to the key for a missing entry', () => {
    expect(makeT('en')('nope.missing')).toBe('nope.missing');
  });

  test('returns array values (quick prompts) untouched in both languages', () => {
    const zh = makeT('zh')('chat.quickPrompts');
    const en = makeT('en')('chat.quickPrompts');
    expect(Array.isArray(zh) && Array.isArray(en)).toBe(true);
    expect(zh.length).toBe(5);
    expect(en[0]).toBe('Xiaoxi, are you hungry now?');
  });
});

function Probe() {
  const t = useT();
  return <div>{t('actions.feedShop')}</div>;
}

describe('LanguageProvider', () => {
  test('serves the persisted language from localStorage', () => {
    localStorage.setItem('xxa_lang', 'en');
    render(<LanguageProvider><Probe /></LanguageProvider>);
    expect(screen.getByText('Feed Shop')).toBeTruthy();
  });

  test('defaults to Chinese with no stored preference', () => {
    render(<LanguageProvider><Probe /></LanguageProvider>);
    expect(screen.getByText('喂食商店')).toBeTruthy();
  });
});
