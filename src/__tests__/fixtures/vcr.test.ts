/**
 * src/__tests__/fixtures/vcr.test.ts — Phase 24 Plan 02 (SYNTH-07, D-03).
 *
 * Unit tests for the content-addressable VCR cache wrapping the Anthropic
 * SDK. Hermetic: mocks `anthropic.messages.parse` / `.create` via the
 * `src/llm/client.js` singleton and sandboxes the cache dir under a
 * per-run tmp directory so tests never touch the real `tests/fixtures/.vcr/`.
 *
 * Covers per plan Task 1 acceptance:
 *   1. cache MISS writes file, network call observed
 *   2. cache HIT reads file, no new network call
 *   3. hash stability across object-key-insertion order (keys sorted at every level)
 *   4. hash differentiation on any field change
 *   5. atomic write (tmp + rename) leaves no partial file at final path on failure
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock the Anthropic client singleton — all VCR calls flow through here.
vi.mock('../../llm/client.js', () => ({
  anthropic: {
    messages: {
      parse: vi.fn(),
      create: vi.fn(),
    },
  },
}));

// Mock logger so vcr.hit / vcr.miss lines are captured for assertions.
vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { anthropic } = await import('../../llm/client.js');
const { logger } = await import('../../utils/logger.js');
const vcrModule = await import('./vcr.js');
const {
  cachedMessagesParse,
  cachedMessagesCreate,
  hashRequest,
  setVcrDirForTest,
  VCR_DIR: DEFAULT_VCR_DIR,
} = vcrModule;

let sandbox: string;

beforeEach(async () => {
  // Per-test sandbox keeps runs hermetic and parallel-safe.
  sandbox = await mkdtemp(join(tmpdir(), 'vcr-test-'));
  setVcrDirForTest(sandbox);
  vi.mocked(anthropic.messages.parse).mockReset();
  vi.mocked(anthropic.messages.create).mockReset();
  vi.mocked(logger.info).mockReset();
});

afterEach(async () => {
  setVcrDirForTest(DEFAULT_VCR_DIR);
  await rm(sandbox, { recursive: true, force: true });
});

describe('hashRequest', () => {
  it('returns identical hash for objects whose top-level keys are inserted in different order', () => {
    const a = hashRequest({ model: 'x', system: 's', temperature: 0 });
    const b = hashRequest({ temperature: 0, system: 's', model: 'x' });
    expect(a).toBe(b);
  });

  it('returns identical hash for deeply nested objects with different key order', () => {
    const a = hashRequest({
      model: 'x',
      messages: [{ role: 'user', content: 'hi' }],
      output_config: { format: { type: 'json', name: 'X' } },
    });
    const b = hashRequest({
      output_config: { format: { name: 'X', type: 'json' } },
      messages: [{ content: 'hi', role: 'user' }],
      model: 'x',
    });
    expect(a).toBe(b);
  });

  it('returns a different hash when model changes', () => {
    const a = hashRequest({ model: 'haiku', system: 's' });
    const b = hashRequest({ model: 'sonnet', system: 's' });
    expect(a).not.toBe(b);
  });

  it('returns a different hash when system prompt changes', () => {
    const a = hashRequest({ model: 'haiku', system: 's1' });
    const b = hashRequest({ model: 'haiku', system: 's2' });
    expect(a).not.toBe(b);
  });

  it('returns a different hash when messages change', () => {
    const a = hashRequest({
      model: 'haiku',
      messages: [{ role: 'user', content: 'a' }],
    });
    const b = hashRequest({
      model: 'haiku',
      messages: [{ role: 'user', content: 'b' }],
    });
    expect(a).not.toBe(b);
  });

  it('returns a 64-char lowercase hex SHA-256 digest', () => {
    const h = hashRequest({ foo: 'bar' });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('cachedMessagesParse (miss then hit)', () => {
  it('MISS: writes cache file, calls anthropic.messages.parse once, logs vcr.miss', async () => {
    vi.mocked(anthropic.messages.parse).mockResolvedValue({
      parsed_output: { hello: 'world' },
      content: [],
    } as unknown as Awaited<ReturnType<typeof anthropic.messages.parse>>);

    const request = {
      model: 'haiku-test',
      max_tokens: 100,
      system: 'you are a test',
      messages: [{ role: 'user', content: 'hi' }],
    } as unknown as Parameters<typeof anthropic.messages.parse>[0];

    const resp = await cachedMessagesParse(request);

    expect(anthropic.messages.parse).toHaveBeenCalledTimes(1);
    expect((resp as { parsed_output?: { hello: string } }).parsed_output).toEqual({
      hello: 'world',
    });

    const files = await readdir(sandbox);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f]{64}\.json$/);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'parse' }),
      'vcr.miss',
    );
  });

  it('HIT: reads from cache, does NOT invoke anthropic.messages.parse, logs vcr.hit', async () => {
    vi.mocked(anthropic.messages.parse).mockResolvedValue({
      parsed_output: { hello: 'world' },
    } as unknown as Awaited<ReturnType<typeof anthropic.messages.parse>>);

    const request = {
      model: 'haiku-test',
      max_tokens: 100,
      system: 'you are a test',
      messages: [{ role: 'user', content: 'hi' }],
    } as unknown as Parameters<typeof anthropic.messages.parse>[0];

    // First invocation populates cache
    await cachedMessagesParse(request);
    vi.mocked(anthropic.messages.parse).mockReset();
    vi.mocked(logger.info).mockReset();

    // Second invocation reads cache
    const resp = await cachedMessagesParse(request);

    expect(anthropic.messages.parse).not.toHaveBeenCalled();
    expect((resp as { parsed_output?: { hello: string } }).parsed_output).toEqual({
      hello: 'world',
    });

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'parse' }),
      'vcr.hit',
    );
  });

  it('truncates hash to 8 chars in log lines (operator UX)', async () => {
    vi.mocked(anthropic.messages.parse).mockResolvedValue({
      parsed_output: {},
    } as unknown as Awaited<ReturnType<typeof anthropic.messages.parse>>);

    const request = {
      model: 'haiku-test',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
    } as unknown as Parameters<typeof anthropic.messages.parse>[0];

    await cachedMessagesParse(request);

    const infoCalls = vi.mocked(logger.info).mock.calls;
    const missCall = infoCalls.find((c) => c[1] === 'vcr.miss');
    expect(missCall).toBeDefined();
    const payload = missCall![0] as { hash: string };
    expect(payload.hash).toHaveLength(8);
  });

  it('different requests produce different cache files', async () => {
    vi.mocked(anthropic.messages.parse).mockResolvedValue({
      parsed_output: {},
    } as unknown as Awaited<ReturnType<typeof anthropic.messages.parse>>);

    await cachedMessagesParse({
      model: 'haiku',
      system: 'a',
      messages: [{ role: 'user', content: 'x' }],
    } as unknown as Parameters<typeof anthropic.messages.parse>[0]);
    await cachedMessagesParse({
      model: 'haiku',
      system: 'b',
      messages: [{ role: 'user', content: 'x' }],
    } as unknown as Parameters<typeof anthropic.messages.parse>[0]);

    const files = await readdir(sandbox);
    expect(files).toHaveLength(2);
  });
});

describe('cachedMessagesCreate', () => {
  it('MISS then HIT on messages.create path', async () => {
    vi.mocked(anthropic.messages.create).mockResolvedValue({
      content: [{ type: 'text', text: 'created' }],
    } as unknown as Awaited<ReturnType<typeof anthropic.messages.create>>);

    const request = {
      model: 'haiku-test',
      max_tokens: 100,
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
    } as unknown as Parameters<typeof anthropic.messages.create>[0];

    const first = await cachedMessagesCreate(request);
    expect(anthropic.messages.create).toHaveBeenCalledTimes(1);
    expect((first as { content: unknown[] }).content).toBeDefined();

    vi.mocked(anthropic.messages.create).mockReset();
    const second = await cachedMessagesCreate(request);
    expect(anthropic.messages.create).not.toHaveBeenCalled();
    expect((second as { content: unknown[] }).content).toBeDefined();
  });

  it('logs kind:create to differentiate from parse path', async () => {
    vi.mocked(anthropic.messages.create).mockResolvedValue({
      content: [],
    } as unknown as Awaited<ReturnType<typeof anthropic.messages.create>>);

    await cachedMessagesCreate({
      model: 'x',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
    } as unknown as Parameters<typeof anthropic.messages.create>[0]);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'create' }),
      'vcr.miss',
    );
  });
});

describe('atomic-write safety (Pitfall #8)', () => {
  it('hit path: cache file on disk is a valid complete JSON (no partial writes)', async () => {
    vi.mocked(anthropic.messages.parse).mockResolvedValue({
      parsed_output: { many: 'fields', arr: [1, 2, 3] },
    } as unknown as Awaited<ReturnType<typeof anthropic.messages.parse>>);

    const request = {
      model: 'haiku',
      system: 'atomic',
      messages: [{ role: 'user', content: 'x' }],
    } as unknown as Parameters<typeof anthropic.messages.parse>[0];

    await cachedMessagesParse(request);

    const files = await readdir(sandbox);
    expect(files).toHaveLength(1);
    const body = await readFile(join(sandbox, files[0]!), 'utf8');
    expect(() => JSON.parse(body)).not.toThrow();
    const parsed = JSON.parse(body) as { parsed_output: { many: string; arr: number[] } };
    expect(parsed.parsed_output.many).toBe('fields');
    expect(parsed.parsed_output.arr).toEqual([1, 2, 3]);
  });

  it('no .tmp files left behind after a successful write', async () => {
    vi.mocked(anthropic.messages.parse).mockResolvedValue({
      parsed_output: {},
    } as unknown as Awaited<ReturnType<typeof anthropic.messages.parse>>);

    await cachedMessagesParse({
      model: 'haiku',
      system: 's',
      messages: [{ role: 'user', content: 'x' }],
    } as unknown as Parameters<typeof anthropic.messages.parse>[0]);

    const files = await readdir(sandbox);
    const tmpFiles = files.filter((f) => f.includes('.tmp'));
    expect(tmpFiles).toHaveLength(0);
  });

  it('corrupted cache file surfaces as parse error (readCachedOrNull only swallows ENOENT)', async () => {
    // Pre-populate a cache file with invalid JSON at the hash location for
    // a known request. The wrapper should NOT silently fall back to calling
    // the network; it should throw so the corruption is visible.
    const request = {
      model: 'haiku',
      system: 'corruption-test',
      messages: [{ role: 'user', content: 'x' }],
    } as unknown as Parameters<typeof anthropic.messages.parse>[0];
    const hash = hashRequest(request);
    await writeFile(join(sandbox, `${hash}.json`), '{ not valid json');

    await expect(cachedMessagesParse(request)).rejects.toThrow();
  });
});

// Regression for prod operator UAT 2026-04-25:
// `scripts/synthesize-episodic.ts` does `anthropic.messages.parse =
// cachedMessagesParse` (sibling-composition swap pattern) so that the real
// `runConsolidate()` engine reads through VCR. Before the fix, vcr.ts called
// `anthropic.messages.parse(request)` on miss — which AFTER the swap resolved
// back to `cachedMessagesParse` itself, causing infinite recursion (observed:
// 6.1M identical `vcr.miss hash:2a2d5b47` log events in ~3 min, zero cache
// files materialized). The fix: vcr.ts captures `ORIGINAL_PARSE` /
// `ORIGINAL_CREATE` at module-load time and uses those on miss.
describe('property-swap recursion guard (v2.3 post-close prod regression)', () => {
  it('cachedMessagesParse is safe to swap onto anthropic.messages.parse without infinite recursion', async () => {
    const realParseImpl = vi.fn().mockResolvedValue({ ok: 'parsed-real' });
    vi.mocked(anthropic.messages.parse).mockImplementation(realParseImpl);

    // The dangerous swap (mirrors synthesize-episodic.ts:514).
    const before = anthropic.messages.parse;
    anthropic.messages.parse = cachedMessagesParse as typeof anthropic.messages.parse;
    try {
      const request = {
        model: 'sonnet',
        system: 'recursion-guard-test',
        messages: [{ role: 'user', content: 'one' }],
      } as unknown as Parameters<typeof anthropic.messages.parse>[0];

      // If recursion bug returns, this either hangs or stack-overflows.
      // The test framework's per-test timeout would catch a hang.
      const response = await cachedMessagesParse(request);

      // Real impl invoked exactly once — recursion would invoke 0 times
      // (re-entering cachedMessagesParse, never reaching the original).
      expect(realParseImpl).toHaveBeenCalledTimes(1);
      expect(response).toEqual({ ok: 'parsed-real' });

      // Cache file landed (would be absent under recursion since the call
      // never reaches the post-await writeJSON step).
      const files = await readdir(sandbox);
      expect(files).toHaveLength(1);
    } finally {
      anthropic.messages.parse = before;
    }
  });

  it('cachedMessagesCreate is safe to swap onto anthropic.messages.create without infinite recursion', async () => {
    const realCreateImpl = vi.fn().mockResolvedValue({ ok: 'created-real' });
    vi.mocked(anthropic.messages.create).mockImplementation(realCreateImpl);

    const before = anthropic.messages.create;
    anthropic.messages.create = cachedMessagesCreate as typeof anthropic.messages.create;
    try {
      const request = {
        model: 'haiku',
        system: 'recursion-guard-test-create',
        messages: [{ role: 'user', content: 'one' }],
      } as unknown as Parameters<typeof anthropic.messages.create>[0];

      const response = await cachedMessagesCreate(request);

      expect(realCreateImpl).toHaveBeenCalledTimes(1);
      expect(response).toEqual({ ok: 'created-real' });
    } finally {
      anthropic.messages.create = before;
    }
  });
});
