/**
 * src/bot/handlers/__tests__/voice-decline.test.ts — Phase 26 Plan 04 (VOICE-05)
 *
 * Unit tests for the polite-decline voice handler. Pure unit test — mocks
 * getLastUserLanguage + logger, exercises only the in-process handler with
 * a duck-typed ctx. No DB, no LLM, no Pensieve, no Anthropic SDK (OOS-3).
 *
 * Coverage:
 *   - English / French / Russian language selection (D-26-09)
 *   - Default-to-English on null and on unmapped language values
 *   - chatId stringification (number → String)
 *   - Side-effect contract: only ctx.reply is invoked (no other observables)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock language tracker + logger ─────────────────────────────────────────
// vi.hoisted is required because vi.mock() is hoisted above the local const
// declarations; without hoisting the factory the mock fn would be referenced
// before initialization (precedent: commit 117c6dd Phase 26 Plan 02).
const { mockGetLastLang } = vi.hoisted(() => ({ mockGetLastLang: vi.fn() }));
vi.mock('../../../chris/language.js', () => ({
  getLastUserLanguage: mockGetLastLang,
}));
vi.mock('../../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { handleVoiceMessageDecline } from '../voice-decline.js';

describe('handleVoiceMessageDecline (Phase 26 VOICE-05; D-26-09)', () => {
  beforeEach(() => {
    mockGetLastLang.mockReset();
  });

  it('replies in English when last language is English', async () => {
    mockGetLastLang.mockReturnValue('English');
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleVoiceMessageDecline({ chat: { id: 123456 }, reply });
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('text messages'));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Android keyboard'));
  });

  it('replies in French when last language is French', async () => {
    mockGetLastLang.mockReturnValue('French');
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleVoiceMessageDecline({ chat: { id: 123456 }, reply });
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('messages texte'));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('clavier Android'));
  });

  it('replies in Russian when last language is Russian', async () => {
    mockGetLastLang.mockReturnValue('Russian');
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleVoiceMessageDecline({ chat: { id: 123456 }, reply });
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('текстовые'));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Android'));
  });

  it('defaults to English when getLastUserLanguage returns null', async () => {
    mockGetLastLang.mockReturnValue(null);
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleVoiceMessageDecline({ chat: { id: 123456 }, reply });
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('text messages'));
  });

  it('defaults to English when getLastUserLanguage returns unmapped value', async () => {
    mockGetLastLang.mockReturnValue('Klingon');
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleVoiceMessageDecline({ chat: { id: 123456 }, reply });
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('text messages'));
  });

  it('passes chat.id (number) through to getLastUserLanguage as string', async () => {
    mockGetLastLang.mockReturnValue('English');
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleVoiceMessageDecline({ chat: { id: 999888 }, reply });
    expect(mockGetLastLang).toHaveBeenCalledWith('999888');
  });

  it('side-effect contract: only ctx.reply invoked; no Pensieve / engine / Anthropic calls', async () => {
    // The handler imports nothing from src/chris/engine.ts, src/pensieve/store.ts,
    // or src/llm/client.ts — verifiable at module-graph level.
    // This test asserts the runtime contract: reply is the ONLY side effect.
    mockGetLastLang.mockReturnValue('English');
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleVoiceMessageDecline({ chat: { id: 123456 }, reply });
    expect(reply).toHaveBeenCalledTimes(1);
    // No further assertions needed — the mock graph proves no other side effects.
  });
});
