import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger
vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { fetchWithTimeout, withRetry, fetchWithRetry } = await import('../../utils/http.js');

describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns response when fetch completes within timeout', async () => {
    const mockResponse = new Response('ok', { status: 200 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    const result = await fetchWithTimeout('http://example.com', { timeoutMs: 5000 });

    expect(result.status).toBe(200);
  });

  it('aborts fetch when timeout expires', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          (options?.signal as AbortSignal)?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        }),
    );

    await expect(fetchWithTimeout('http://example.com', { timeoutMs: 50 })).rejects.toThrow(
      'aborted',
    );
  });

  it('passes through fetch options (method, headers, body)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));

    await fetchWithTimeout('http://example.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"test":true}',
      timeoutMs: 5000,
    });

    const callOptions = fetchSpy.mock.calls[0]![1]!;
    expect(callOptions.method).toBe('POST');
    expect((callOptions.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
    expect(callOptions.body).toBe('{"test":true}');
  });

  it('uses default 30s timeout when not specified', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));

    await fetchWithTimeout('http://example.com');

    // Verify signal was passed (means AbortController was created)
    expect(fetchSpy.mock.calls[0]![1]?.signal).toBeDefined();
  });
});

describe('withRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('result');

    const result = await withRetry(fn, { maxAttempts: 3 });

    expect(result).toBe('result');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on transient network error and succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce('recovered');

    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 });

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry on non-transient error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('validation failed'));

    await expect(withRetry(fn, { maxAttempts: 3 })).rejects.toThrow('validation failed');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting all attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

    await expect(withRetry(fn, { maxAttempts: 2, baseDelayMs: 10 })).rejects.toThrow(
      'fetch failed',
    );
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('uses exponential backoff between retries', async () => {
    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: any, ms?: number) => {
      if (ms && ms > 0) delays.push(ms);
      return originalSetTimeout(fn, 0); // execute immediately in tests
    });

    const fnMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce('ok');

    await withRetry(fnMock, { maxAttempts: 3, baseDelayMs: 100 });

    expect(delays).toEqual([100, 200]); // 100 * 2^0, 100 * 2^1
  });
});

describe('fetchWithRetry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries on 429 status', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const result = await fetchWithRetry('http://example.com', {
      retryOptions: { maxAttempts: 2, baseDelayMs: 10 },
    });

    expect(result.status).toBe(200);
  });

  it('retries on 503 status', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const result = await fetchWithRetry('http://example.com', {
      retryOptions: { maxAttempts: 2, baseDelayMs: 10 },
    });

    expect(result.status).toBe(200);
  });

  it('does not retry on 400 status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('bad request', { status: 400 }));

    const result = await fetchWithRetry('http://example.com', {
      retryOptions: { maxAttempts: 3, baseDelayMs: 10 },
    });

    expect(result.status).toBe(400);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('combines timeout and retry', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            (options?.signal as AbortSignal)?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const result = await fetchWithRetry('http://example.com', {
      timeoutMs: 50,
      retryOptions: { maxAttempts: 2, baseDelayMs: 10 },
    });

    expect(result.status).toBe(200);
  });
});
