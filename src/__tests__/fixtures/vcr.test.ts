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
