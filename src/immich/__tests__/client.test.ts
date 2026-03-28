import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchAssets } from '../client.js';
import { ImmichSyncError } from '../../utils/errors.js';

// Mock config
vi.mock('../../config.js', () => ({
  config: {
    immichApiUrl: 'http://immich.local',
    immichApiKey: 'test-api-key',
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function makeAsset(id: string) {
  return {
    id,
    type: 'IMAGE',
    originalFileName: `IMG_${id}.jpg`,
    exifInfo: { city: 'Nice', country: 'France' },
    people: [],
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Immich client', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('fetches a single page of results', async () => {
    const assets = [makeAsset('1'), makeAsset('2')];
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ assets: { items: assets } }),
    );

    const result = await fetchAssets();

    expect(result).toEqual(assets);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('paginates across multiple pages', async () => {
    // Page 1: 100 items → triggers next page
    const page1 = Array.from({ length: 100 }, (_, i) => makeAsset(`p1-${i}`));
    // Page 2: 100 items → triggers next page
    const page2 = Array.from({ length: 100 }, (_, i) => makeAsset(`p2-${i}`));
    // Page 3: 50 items → last page (< PAGE_SIZE)
    const page3 = Array.from({ length: 50 }, (_, i) => makeAsset(`p3-${i}`));

    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ assets: { items: page1 } }))
      .mockResolvedValueOnce(jsonResponse({ assets: { items: page2 } }))
      .mockResolvedValueOnce(jsonResponse({ assets: { items: page3 } }));

    const result = await fetchAssets();

    expect(result).toHaveLength(250);
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    // Verify page numbers incremented
    const bodies = fetchSpy.mock.calls.map((call) =>
      JSON.parse(call[1]?.body as string),
    );
    expect(bodies[0].page).toBe(1);
    expect(bodies[1].page).toBe(2);
    expect(bodies[2].page).toBe(3);
  });

  it('returns empty array when first page is empty', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ assets: { items: [] } }),
    );

    const result = await fetchAssets();

    expect(result).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('passes updatedAfter when provided', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ assets: { items: [] } }),
    );

    await fetchAssets({ updatedAfter: '2024-01-15T00:00:00.000Z' });

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.updatedAfter).toBe('2024-01-15T00:00:00.000Z');
  });

  it('sends correct x-api-key header', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ assets: { items: [] } }),
    );

    await fetchAssets();

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('test-api-key');
  });

  it('sends withExif and withPeople in request body', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ assets: { items: [] } }),
    );

    await fetchAssets();

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.withExif).toBe(true);
    expect(body.withPeople).toBe(true);
  });

  it('calls POST on the correct URL', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ assets: { items: [] } }),
    );

    await fetchAssets();

    expect(fetchSpy.mock.calls[0][0]).toBe(
      'http://immich.local/api/search/metadata',
    );
    expect(fetchSpy.mock.calls[0][1]?.method).toBe('POST');
  });

  it('throws ImmichSyncError on HTTP 500', async () => {
    fetchSpy.mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    );

    await expect(fetchAssets()).rejects.toThrow(ImmichSyncError);

    fetchSpy.mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    );

    await expect(fetchAssets()).rejects.toThrow(/HTTP 500/);
  });

  it('throws ImmichSyncError on network error', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(fetchAssets()).rejects.toThrow(ImmichSyncError);
    await expect(fetchAssets()).rejects.toThrow(/Network error/);
  });

  it('strips trailing slashes from base URL', async () => {
    // Re-mock config with trailing slash
    const configMod = await import('../../config.js');
    const origUrl = (configMod.config as any).immichApiUrl;
    (configMod.config as any).immichApiUrl = 'http://immich.local/';

    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ assets: { items: [] } }),
    );

    await fetchAssets();

    expect(fetchSpy.mock.calls[0][0]).toBe(
      'http://immich.local/api/search/metadata',
    );

    (configMod.config as any).immichApiUrl = origUrl;
  });
});
