/**
 * Smoke tests that hit the real Anthropic API to verify model IDs are valid.
 * These are NOT unit tests — they cost real tokens (~$0.001 per run).
 *
 * Run: ANTHROPIC_API_KEY=... npx vitest run src/llm/__tests__/models-smoke.test.ts
 *
 * Skipped when ANTHROPIC_API_KEY is not set (CI/unit test runs).
 */
import { describe, it, expect } from 'vitest';
import { config } from '../../config.js';

const SKIP = !process.env.ANTHROPIC_API_KEY;
const describeSmoke = SKIP ? describe.skip : describe;

describeSmoke('Model ID smoke tests (real API)', () => {
  // Lazy import to avoid config validation errors when env vars are missing
  let anthropic: any;
  let HAIKU_MODEL: string;
  let SONNET_MODEL: string;
  let OPUS_MODEL: string;

  it('loads client module', async () => {
    const client = await import('../client.js');
    anthropic = client.anthropic;
    HAIKU_MODEL = client.HAIKU_MODEL;
    SONNET_MODEL = client.SONNET_MODEL;
    OPUS_MODEL = client.OPUS_MODEL;
  });

  it(`Haiku model responds (${config.haikuModel})`, async () => {
    const response = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Reply with just the word OK' }],
    });
    expect(response.content).toHaveLength(1);
    expect(response.content[0].type).toBe('text');
  }, 15000);

  it(`Sonnet model responds (${config.sonnetModel})`, async () => {
    const response = await anthropic.messages.create({
      model: SONNET_MODEL,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Reply with just the word OK' }],
    });
    expect(response.content).toHaveLength(1);
    expect(response.content[0].type).toBe('text');
  }, 15000);

  it(`Opus model responds (${config.opusModel})`, async () => {
    const response = await anthropic.messages.create({
      model: OPUS_MODEL,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Reply with just the word OK' }],
    });
    expect(response.content).toHaveLength(1);
    expect(response.content[0].type).toBe('text');
  }, 15000);
});
