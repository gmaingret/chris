/**
 * src/__tests__/fixtures/freshness.test.ts — Phase 24 Plan 01 (FRESH-01).
 *
 * Unit tests for isSnapshotStale + autoRefreshIfStale.
 *
 * Mocks:
 *   - node:fs/promises::stat — controls mtime for TTL boundary testing.
 *   - node:child_process::spawn — verifies refresh invocation without
 *     actually spawning `npx tsx scripts/fetch-prod-data.ts`.
 *   - ../../utils/logger.js — captures 'freshness.auto-refresh' log calls.
 *
 * Table-driven boundaries per VALIDATION.md §Wave 0: 23h (fresh), 25h (stale),
 * ENOENT (stale / force-refresh), noRefresh=true (short-circuit).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// Mock logger — captured via spies so we can assert the 'freshness.auto-refresh' line.
vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock node:fs/promises so we can control mtime for stale/fresh boundaries.
vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
}));

// Mock node:child_process so autoRefreshIfStale's spawn doesn't actually run
// fetch-prod-data.ts during unit tests.
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

// Import after mocks are registered.
const { stat } = await import('node:fs/promises');
const { spawn } = await import('node:child_process');
const { logger } = await import('../../utils/logger.js');
const { isSnapshotStale, autoRefreshIfStale } = await import('./freshness.js');

const HOUR_MS = 60 * 60 * 1000;

describe('isSnapshotStale', () => {
  beforeEach(() => {
    vi.mocked(stat).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false when path mtime is 23 hours ago (within 24h TTL)', async () => {
    vi.mocked(stat).mockResolvedValue({
      mtimeMs: Date.now() - 23 * HOUR_MS,
    } as Awaited<ReturnType<typeof stat>>);

    expect(await isSnapshotStale('/some/LATEST', 24)).toBe(false);
  });

  it('returns true when path mtime is 25 hours ago (beyond 24h TTL)', async () => {
    vi.mocked(stat).mockResolvedValue({
      mtimeMs: Date.now() - 25 * HOUR_MS,
    } as Awaited<ReturnType<typeof stat>>);

    expect(await isSnapshotStale('/some/LATEST', 24)).toBe(true);
  });

  it('returns true when path does not exist (ENOENT — force refresh on missing)', async () => {
    const err = Object.assign(new Error('no such file'), { code: 'ENOENT' });
    vi.mocked(stat).mockRejectedValue(err);

    expect(await isSnapshotStale('/nonexistent/LATEST', 24)).toBe(true);
  });

  it('re-throws non-ENOENT stat errors (permission denied etc.)', async () => {
    const err = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    vi.mocked(stat).mockRejectedValue(err);

    await expect(isSnapshotStale('/forbidden/LATEST', 24)).rejects.toThrow(
      'permission denied',
    );
  });

  it('defaults ttlHours to 24 when unspecified', async () => {
    // 25h ago with default TTL should be stale.
    vi.mocked(stat).mockResolvedValue({
      mtimeMs: Date.now() - 25 * HOUR_MS,
    } as Awaited<ReturnType<typeof stat>>);

    expect(await isSnapshotStale('/some/LATEST')).toBe(true);
  });

  it('respects custom ttlHours (48h: 25h is still fresh)', async () => {
    vi.mocked(stat).mockResolvedValue({
      mtimeMs: Date.now() - 25 * HOUR_MS,
    } as Awaited<ReturnType<typeof stat>>);

    expect(await isSnapshotStale('/some/LATEST', 48)).toBe(false);
  });
});

/**
 * Helper: build a mocked ChildProcess that behaves like a spawned process —
 * EventEmitter + exit/error event plumbing. Lets the test drive the child's
 * exit code to verify autoRefreshIfStale's await-and-resolve contract.
 */
function makeMockChild(): EventEmitter {
  const em = new EventEmitter();
  return em;
}

describe('autoRefreshIfStale', () => {
  beforeEach(() => {
    vi.mocked(stat).mockReset();
    vi.mocked(spawn).mockReset();
    vi.mocked(logger.info).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('short-circuits without spawning fetch-prod-data when noRefresh=true (FRESH-02)', async () => {
    // Even though stat would say stale (25h ago), noRefresh must bypass.
    vi.mocked(stat).mockResolvedValue({
      mtimeMs: Date.now() - 25 * HOUR_MS,
    } as Awaited<ReturnType<typeof stat>>);

    const result = await autoRefreshIfStale('/some/LATEST', { noRefresh: true });

    expect(result).toBe('/some/LATEST');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('returns path without spawning when snapshot is fresh (<TTL)', async () => {
    vi.mocked(stat).mockResolvedValue({
      mtimeMs: Date.now() - 1 * HOUR_MS,
    } as Awaited<ReturnType<typeof stat>>);

    const result = await autoRefreshIfStale('/some/LATEST');

    expect(result).toBe('/some/LATEST');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('invokes `npx tsx scripts/fetch-prod-data.ts` via spawn when stale, awaits exit', async () => {
    vi.mocked(stat).mockResolvedValue({
      mtimeMs: Date.now() - 25 * HOUR_MS,
    } as Awaited<ReturnType<typeof stat>>);

    const child = makeMockChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = autoRefreshIfStale('/some/LATEST');

    // Let the microtask queue drain so spawn is invoked and listeners attached.
    await new Promise((r) => setImmediate(r));

    // Simulate successful fetch-prod-data exit.
    child.emit('exit', 0);

    await expect(promise).resolves.toBe('/some/LATEST');

    expect(spawn).toHaveBeenCalledTimes(1);
    const [cmd, args] = vi.mocked(spawn).mock.calls[0]!;
    expect(cmd).toBe('npx');
    expect(args).toEqual(['tsx', 'scripts/fetch-prod-data.ts']);
  });

  it('logs freshness.auto-refresh with ageHours and ttlHours when refreshing', async () => {
    vi.mocked(stat).mockResolvedValue({
      mtimeMs: Date.now() - 25 * HOUR_MS,
    } as Awaited<ReturnType<typeof stat>>);

    const child = makeMockChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = autoRefreshIfStale('/some/LATEST');
    await new Promise((r) => setImmediate(r));
    child.emit('exit', 0);
    await promise;

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        ageHours: expect.any(Number),
        ttlHours: 24,
      }),
      'freshness.auto-refresh',
    );
  });

  it('rejects with ChrisError when fetch-prod-data exits non-zero', async () => {
    vi.mocked(stat).mockResolvedValue({
      mtimeMs: Date.now() - 25 * HOUR_MS,
    } as Awaited<ReturnType<typeof stat>>);

    const child = makeMockChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = autoRefreshIfStale('/some/LATEST');
    await new Promise((r) => setImmediate(r));
    child.emit('exit', 1);

    await expect(promise).rejects.toThrow(/fetch-prod-data exited 1/);
  });

  it('rejects with ChrisError when spawn emits error (e.g. ENOENT for npx)', async () => {
    vi.mocked(stat).mockResolvedValue({
      mtimeMs: Date.now() - 25 * HOUR_MS,
    } as Awaited<ReturnType<typeof stat>>);

    const child = makeMockChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = autoRefreshIfStale('/some/LATEST');
    await new Promise((r) => setImmediate(r));
    child.emit('error', new Error('spawn ENOENT'));

    await expect(promise).rejects.toThrow(/fetch-prod-data spawn failed/);
  });

  it('handles ENOENT on LATEST as infinite age (forces refresh)', async () => {
    const err = Object.assign(new Error('no such file'), { code: 'ENOENT' });
    vi.mocked(stat).mockRejectedValue(err);

    const child = makeMockChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = autoRefreshIfStale('/nonexistent/LATEST');
    await new Promise((r) => setImmediate(r));
    child.emit('exit', 0);
    await promise;

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ ageHours: Infinity }),
      'freshness.auto-refresh',
    );
  });
});
