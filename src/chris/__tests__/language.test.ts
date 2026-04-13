import { describe, it, expect, beforeEach } from 'vitest';
import { detectLanguage, getLastUserLanguage, setLastUserLanguage, clearLanguageState } from '../language.js';

describe('detectLanguage (LANG-01)', () => {
  it('detects English text', () => {
    const lang = detectLanguage('I had a wonderful day at work today and I feel great about it', null);
    expect(lang).toBe('English');
  });

  it('detects French text', () => {
    const lang = detectLanguage("Aujourd'hui j'ai passé une journée magnifique au bureau", null);
    expect(lang).toBe('French');
  });

  it('detects Russian text', () => {
    const lang = detectLanguage('Сегодня у меня был замечательный день на работе', null);
    expect(lang).toBe('Russian');
  });
});

describe('short message inheritance (LANG-02)', () => {
  it('inherits previous language for < 4 words', () => {
    const lang = detectLanguage('oui merci', 'French');
    expect(lang).toBe('French');
  });

  it('inherits previous language for < 15 chars', () => {
    const lang = detectLanguage('да', 'Russian');
    expect(lang).toBe('Russian');
  });

  it('defaults to English when no previous language and short msg', () => {
    const lang = detectLanguage('ok', null);
    expect(lang).toBe('English');
  });

  it('does NOT inherit for long messages', () => {
    const lang = detectLanguage("Aujourd'hui j'ai passé une journée magnifique au bureau et je suis content", 'English');
    expect(lang).toBe('French');
  });
});

describe('session language state', () => {
  beforeEach(() => {
    clearLanguageState('test-chat');
  });

  it('returns null when no language set', () => {
    expect(getLastUserLanguage('test-chat')).toBeNull();
  });

  it('stores and retrieves language', () => {
    setLastUserLanguage('test-chat', 'French');
    expect(getLastUserLanguage('test-chat')).toBe('French');
  });

  it('isolates by chatId', () => {
    setLastUserLanguage('chat-1', 'French');
    setLastUserLanguage('chat-2', 'Russian');
    expect(getLastUserLanguage('chat-1')).toBe('French');
    expect(getLastUserLanguage('chat-2')).toBe('Russian');
  });
});
